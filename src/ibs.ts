import { auditStatement, clearLimits, id, limited, now, recordAuthEvent } from './db';
import { CURRENT_PASSWORD_ITERATIONS, decryptSensitive, encryptSensitive, passwordHash, randomSalt, sensitiveFingerprint, timingSafeEqual } from './crypto';
import { HttpError, body, json } from './http';
import { cookie, registerSession, requireAdmin, requireRoutine, requireStaff } from './session';
import type { Env, RoutineSession, Session } from './types';
import { roleHasPermission } from './types';
import { clean, date, integer, multiline } from './validation';
import { formatAlert, sendTelegram } from './notify';

type Source = {
  source_id: string;
  source_code: string;
  source_type: 'FASKES' | 'SEKOLAH';
  network_type: 'JEJARING' | 'JARINGAN' | null;
  source_name: string;
  program_area: string | null;
  village_code: string | null;
  subvillage_name: string | null;
  active: number;
  pin_salt: string;
  pin_hash: string;
  pin_iterations: number;
  session_version: number;
  last_login_at?: string | null;
  deactivation_reason?: string | null;
  integration_only?: number;
  created_at: string;
};

type IdentityPolicy = 'REQUIRED' | 'CONDITIONAL' | 'OPTIONAL' | 'NONE';
type Indicator = {
  indicator_code: string;
  indicator_name: string;
  sort_order: number;
  definition: string;
  identity_policy: IdentityPolicy;
  is_total: number;
  lab_tracking: number;
  alert_minimum: number | null;
  alert_rule_text: string;
  catalog_version: string;
};
type W2Value = { code: string; cases: number; lab: number };
type CalendarSubmission = {
  epi_week: number;
  submission_status: 'DRAFT' | 'SUBMITTED';
  first_submitted_at: string | null;
  submitted_at: string;
  revision: number;
};
type StoredCaseDetail = {
  case_detail_id: string;
  submission_id: string;
  indicator_code: string;
  patient_name_encrypted: string;
  age_value: number | null;
  age_unit: 'DAY' | 'MONTH' | 'YEAR' | null;
  sex: 'L' | 'P' | 'UNKNOWN';
  village_code: string | null;
  address_encrypted: string;
  phone_encrypted: string;
  onset_date: string | null;
  visit_date: string | null;
  lab_status: string;
  patient_fingerprint: string | null;
  is_complete: number;
  created_at: string;
  updated_at: string;
  created_by: string;
};
type Period = { year: number; week: number };
type DeadlinePolicy = {
  policy_id: string;
  effective_epi_year: number;
  effective_epi_week: number;
  deadline_hour: number;
  deadline_minute: number;
  created_at: string;
  created_by: string;
};

const placeholders = (count: number): string => new Array(count).fill('?').join(',');
const OUTSIDE_WORK_AREA_VILLAGE = 'LUAR_WILAYAH';

function periodFrom(value: Record<string, unknown> | URLSearchParams): Period {
  const get = (key: string): unknown => value instanceof URLSearchParams ? value.get(key) : value[key];
  const year = integer(get('epi_year'), 'Tahun epidemiologi');
  const week = integer(get('epi_week'), 'Minggu epidemiologi');
  if (year < 2020 || year > 2100 || week < 1 || week > epiWeeksInYear(year))
    throw new HttpError('Periode epidemiologi tidak valid.');
  return { year, week };
}

function epiWeekStart(period: Period): Date {
  const januaryFourth = new Date(Date.UTC(period.year, 0, 4));
  const sunday = new Date(januaryFourth);
  sunday.setUTCDate(januaryFourth.getUTCDate() - januaryFourth.getUTCDay() + (period.week - 1) * 7);
  sunday.setUTCHours(0, 0, 0, 0);
  return sunday;
}

function epiWeeksInYear(year: number): number {
  return Math.round((epiWeekStart({ year: year + 1, week: 1 }).getTime() - epiWeekStart({ year, week: 1 }).getTime()) / (7 * 86400000));
}

function schoolAcademicYear(period: Period): number {
  const weekEnd = epiWeekStart(period);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  return weekEnd.getUTCMonth() >= 6 ? weekEnd.getUTCFullYear() : weekEnd.getUTCFullYear() - 1;
}

function currentEpiPeriod(): Period {
  // Epidemiological weeks run Sunday through Saturday. Week 1 is the week
  // containing at least four January days (equivalently, the week containing
  // January 4). Convert the instant to its WIB calendar date first.
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const date = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()));
  let year = date.getUTCFullYear();
  if (date.getTime() < epiWeekStart({ year, week: 1 }).getTime()) year -= 1;
  else if (date.getTime() >= epiWeekStart({ year: year + 1, week: 1 }).getTime()) year += 1;
  return { year, week: Math.floor((date.getTime() - epiWeekStart({ year, week: 1 }).getTime()) / (7 * 86400000)) + 1 };
}

function assertNotFuturePeriod(period: Period): void {
  if (epiWeekStart(period).getTime() > epiWeekStart(currentEpiPeriod()).getTime())
    throw new HttpError('Laporan untuk minggu yang belum dimulai tidak dapat diisi.', 409);
}

function reportingDeadline(period: Period, wibHour = 12, wibMinute = 0): Date {
  const deadline = epiWeekStart(period);
  // The reporting week ends Saturday; its deadline is the following Monday.
  deadline.setUTCDate(deadline.getUTCDate() + 8);
  // WIB has no DST; convert the requested local hour to UTC.
  deadline.setUTCHours(wibHour - 7, wibMinute, 0, 0);
  return deadline;
}

function policyForPeriod(period: Period, policies: DeadlinePolicy[]): DeadlinePolicy {
  return policies
    .filter(policy => policy.effective_epi_year < period.year
      || (policy.effective_epi_year === period.year && policy.effective_epi_week <= period.week))
    .sort((a, b) => b.effective_epi_year - a.effective_epi_year || b.effective_epi_week - a.effective_epi_week)[0]
    || { policy_id: 'FALLBACK', effective_epi_year: 2020, effective_epi_week: 1,
      deadline_hour: 9, deadline_minute: 0, created_at: '', created_by: 'SYSTEM' };
}

async function w2DeadlinePolicies(env: Env): Promise<DeadlinePolicy[]> {
  const rows = await env.DB.prepare(`SELECT policy_id,effective_epi_year,effective_epi_week,deadline_hour,
    deadline_minute,created_at,created_by FROM w2_deadline_policies
    ORDER BY effective_epi_year,effective_epi_week`).all<DeadlinePolicy>();
  return rows.results;
}

function w2Deadline(period: Period, policies: DeadlinePolicy[]): Date {
  const policy = policyForPeriod(period, policies);
  return reportingDeadline(period, Number(policy.deadline_hour), Number(policy.deadline_minute));
}

function w2DeadlineRule(period: Period, policies: DeadlinePolicy[]): string {
  const policy = policyForPeriod(period, policies);
  return `Senin pukul ${String(policy.deadline_hour).padStart(2, '0')}.${String(policy.deadline_minute).padStart(2, '0')} WIB`;
}

function reportingCalendar(year: number, rows: CalendarSubmission[], sourceCreatedAt: string, wibHour = 12,
  policies: DeadlinePolicy[] | null = null): Record<string, unknown> {
  const byWeek = new Map(rows.map(row => [Number(row.epi_week), row]));
  const checkedAt = new Date();
  const sourceStartedAt = new Date(sourceCreatedAt);
  const weeks = Array.from({ length: epiWeeksInYear(year) }, (_, index) => {
    const week = index + 1;
    const period = { year, week };
    const weekStart = epiWeekStart(period);
    const deadline = policies ? w2Deadline(period, policies) : reportingDeadline(period, wibHour);
    const submission = byWeek.get(week);
    const firstSubmittedAt = submission?.first_submitted_at || null;
    const expected = Boolean(submission) || Number.isNaN(sourceStartedAt.getTime()) || deadline.getTime() >= sourceStartedAt.getTime();
    let status = 'OPEN';
    if (submission?.submission_status === 'SUBMITTED') {
      status = firstSubmittedAt && new Date(firstSubmittedAt).getTime() <= deadline.getTime() ? 'ON_TIME' : 'LATE';
    } else if (submission?.submission_status === 'DRAFT') {
      status = 'DRAFT';
    } else if (!expected) {
      status = 'NOT_REQUIRED';
    } else if (checkedAt.getTime() > deadline.getTime()) {
      status = 'MISSING';
    } else if (checkedAt.getTime() < weekStart.getTime()) {
      status = 'UPCOMING';
    }
    return {
      week,
      status,
      submission_status: submission?.submission_status || null,
      first_submitted_at: firstSubmittedAt,
      last_saved_at: submission?.submitted_at || null,
      revision: Number(submission?.revision || 0),
      deadline_at: deadline.toISOString(),
      deadline_passed: checkedAt.getTime() > deadline.getTime(),
      expected,
    };
  });
  return {
    year,
    checked_at: checkedAt.toISOString(),
    deadline_rule: policies ? 'Mengikuti batas waktu W2 yang berlaku pada masing-masing minggu'
      : `Senin pukul ${String(wibHour).padStart(2, '0')}.00 WIB setelah minggu laporan berakhir`,
    weeks,
  };
}

async function activeSource(env: Env, session: RoutineSession): Promise<Source> {
  const source = await env.DB.prepare('SELECT * FROM routine_sources WHERE source_id=? AND active=1')
    .bind(session.sourceId)
    .first<Source>();
  if (!source) throw new HttpError('Akun institusi tidak aktif.', 403);
  return source;
}

async function reportingSource(env: Env, session: Session | null, requestedSourceId: unknown): Promise<{ source: Source; actor: string; adminMode: boolean }> {
  if (session?.kind === 'routine') {
    const source = await activeSource(env, session);
    return { source, actor: source.source_code, adminMode: false };
  }
  const admin = requireAdmin(session);
  const sourceId = clean(requestedSourceId, 60);
  if (!sourceId) throw new HttpError('Pilih institusi untuk entri administratif.');
  const source = await env.DB.prepare('SELECT * FROM routine_sources WHERE source_id=? AND active=1')
    .bind(sourceId).first<Source>();
  if (!source) throw new HttpError('Institusi aktif tidak ditemukan.', 404);
  return { source, actor: admin.email, adminMode: true };
}

async function assertOpenWeek(env: Env, period: Period): Promise<void> {
  const lock = await env.DB.prepare('SELECT 1 FROM routine_week_locks WHERE epi_year=? AND epi_week=?')
    .bind(period.year, period.week)
    .first();
  if (lock) throw new HttpError('Periode ini sudah dikunci oleh petugas.', 409);
}

function isPastReportingDeadline(period: Period, policies: DeadlinePolicy[]): boolean {
  return Date.now() > w2Deadline(period, policies).getTime();
}

async function currentIndicators(env: Env): Promise<Indicator[]> {
  const rows = await env.DB.prepare(
    `SELECT indicator_code,indicator_name,sort_order,definition,identity_policy,is_total,
      lab_tracking,alert_minimum,alert_rule_text,catalog_version
     FROM w2_indicators WHERE active=1 ORDER BY sort_order,indicator_name`
  )
    .all<Indicator>();
  return rows.results;
}

const patientSecret = (env: Env): string => env.PATIENT_DATA_KEY || env.JWT_SECRET;

function requiredDetailCount(indicator: Indicator, value: W2Value): number {
  if (!value.cases || indicator.is_total || indicator.identity_policy === 'NONE' || indicator.identity_policy === 'OPTIONAL') return 0;
  if (indicator.identity_policy === 'REQUIRED') return value.cases;
  const reachedStaticAlert = indicator.alert_minimum !== null && value.cases >= Number(indicator.alert_minimum);
  return reachedStaticAlert ? value.cases : Math.min(value.cases, value.lab);
}

async function readableCaseDetails(env: Env, submissionId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await env.DB.prepare('SELECT * FROM w2_case_details WHERE submission_id=? ORDER BY indicator_code,created_at,case_detail_id')
    .bind(submissionId)
    .all<StoredCaseDetail>();
  const secret = patientSecret(env);
  return Promise.all(rows.results.map(async row => ({
    case_detail_id: row.case_detail_id,
    indicator_code: row.indicator_code,
    patient_name: await decryptSensitive(row.patient_name_encrypted, secret),
    age_value: row.age_value,
    age_unit: row.age_unit,
    sex: row.sex,
    village_code: row.village_code,
    address: await decryptSensitive(row.address_encrypted, secret),
    phone: await decryptSensitive(row.phone_encrypted, secret),
    onset_date: row.onset_date,
    visit_date: row.visit_date,
    lab_status: row.lab_status,
    is_complete: row.is_complete,
  })));
}

// Returns how many review markers were raised (threshold exceedances), so the
// caller can flag them in its notification.
async function markerStatements(
  env: Env,
  sourceId: string,
  period: Period,
  targetType: 'W2' | 'SEKOLAH',
  values: Array<{ code: string; value: number }>
): Promise<{ statements: D1PreparedStatement[]; raised: number }> {
  const thresholds = await env.DB.prepare('SELECT target_code,minimum_value FROM ibs_thresholds WHERE target_type=? AND active=1')
    .bind(targetType)
    .all<{ target_code: string; minimum_value: number }>();
  const limit = new Map(thresholds.results.map(row => [row.target_code, Number(row.minimum_value)]));
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM ibs_review_markers WHERE source_id=? AND epi_year=? AND epi_week=? AND target_type=?')
      .bind(sourceId, period.year, period.week, targetType),
  ];
  let raised = 0;
  for (const item of values) {
    const threshold = limit.get(item.code);
    if (threshold !== undefined && item.value >= threshold) {
      raised += 1;
      statements.push(env.DB.prepare(
        'INSERT INTO ibs_review_markers (marker_id,source_id,epi_year,epi_week,target_type,target_code,observed_value,threshold_value,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
      ).bind(id('MRK'), sourceId, period.year, period.week, targetType, item.code, item.value, threshold, now()));
    }
  }
  return { statements, raised };
}

export async function routineLogin(request: Request, env: Env): Promise<Response> {
  const data = await body(request);
  const code = clean(data.source_code, 40).toUpperCase();
  const pin = String(data.pin || '');
  await limited(request, env, 'routine-login', 10, 900, code, 20);
  const source = await env.DB.prepare('SELECT * FROM routine_sources WHERE source_code=? AND COALESCE(integration_only,0)=0')
    .bind(code)
    .first<Source>();
  const salt = source?.pin_salt || 'AAAAAAAAAAAAAAAAAAAAAA';
  const iterations = source ? Number(source.pin_iterations || 100000) : CURRENT_PASSWORD_ITERATIONS;
  const candidate = await passwordHash(pin, salt, iterations);
  if (!source || !/^\d{6}$/.test(pin) || !timingSafeEqual(candidate, source.pin_hash)) {
    await recordAuthEvent(request, env, 'LOGIN_FAILED', 'routine', code || 'unknown');
    throw new HttpError('Kode institusi atau PIN tidak sesuai.', 401);
  }
  if (Number(source.active) !== 1) {
    await clearLimits(request, env, 'routine-login', code);
    await recordAuthEvent(request, env, 'LOGIN_FAILED', 'routine', code, 'Kredensial benar untuk akun nonaktif.');
    throw new HttpError('Akun institusi ini tidak aktif. Hubungi pengelola layanan.', 403);
  }
  if (iterations < CURRENT_PASSWORD_ITERATIONS) {
    const upgradedSalt = randomSalt();
    await env.DB.prepare('UPDATE routine_sources SET pin_salt=?,pin_hash=?,pin_iterations=?,updated_at=? WHERE source_id=?')
      .bind(upgradedSalt, await passwordHash(pin, upgradedSalt), CURRENT_PASSWORD_ITERATIONS, now(), source.source_id).run();
  }
  const token = await registerSession(env, {
    kind: 'routine', sessionId: crypto.randomUUID(), sourceId: source.source_id, sourceCode: source.source_code, sourceType: source.source_type,
    sessionVersion: Number(source.session_version),
    exp: Math.floor(Date.now() / 1000) + 28800,
  });
  await clearLimits(request, env, 'routine-login', code);
  await env.DB.prepare('UPDATE routine_sources SET last_login_at=?,updated_at=? WHERE source_id=?').bind(now(), now(), source.source_id).run();
  await recordAuthEvent(request, env, 'LOGIN_SUCCESS', 'routine', code);
  return json({ source: { name: source.source_name, type: source.source_type } }, 200, {
    'set-cookie': cookie(token),
  });
}

async function getW2(env: Env, session: Session | null, query: URLSearchParams): Promise<Response> {
  const { source, adminMode } = await reportingSource(env, session, query.get('source_id'));
  if (source.source_type !== 'FASKES' || source.network_type !== 'JEJARING') throw new HttpError('Akun ini tidak berwenang mengirim W2.', 403);
  const period = periodFrom(query);
  const indicators = await currentIndicators(env);
  const submission = await env.DB.prepare('SELECT * FROM w2_submissions WHERE source_id=? AND epi_year=? AND epi_week=?')
    .bind(source.source_id, period.year, period.week)
    .first<Record<string, unknown>>();
  const values = submission
    ? await env.DB.prepare('SELECT indicator_code,case_count,lab_examined_count FROM w2_values WHERE submission_id=?').bind(submission.submission_id).all()
    : { results: [] };
  const map = new Map((values.results as Array<Record<string, unknown>>).map(row => [String(row.indicator_code), {
    cases: Number(row.case_count), lab: Number(row.lab_examined_count),
  }]));
  const [locked, villages, calendarRows, pendingRevision, deadlinePolicies] = await Promise.all([
    env.DB.prepare('SELECT 1 FROM routine_week_locks WHERE epi_year=? AND epi_week=?').bind(period.year, period.week).first(),
    env.DB.prepare('SELECT village_code,village_name FROM villages WHERE active=1 ORDER BY sort_order').all(),
    env.DB.prepare(`SELECT epi_week,submission_status,first_submitted_at,submitted_at,revision
      FROM w2_submissions WHERE source_id=? AND epi_year=? ORDER BY epi_week`)
      .bind(source.source_id, period.year)
      .all<CalendarSubmission>(),
    submission ? env.DB.prepare(`SELECT request_id,proposed_revision,requested_at,status
      FROM w2_revision_requests WHERE submission_id=? AND status='PENDING' ORDER BY requested_at DESC LIMIT 1`)
      .bind(submission.submission_id).first() : Promise.resolve(null),
    w2DeadlinePolicies(env),
  ]);
  const caseDetails = submission ? await readableCaseDetails(env, String(submission.submission_id)) : [];
  const diseaseCodes = indicators.filter(item => !item.is_total).map(item => item.indicator_code);
  let storedReviewedCodes: string[] = [];
  try {
    const parsed = JSON.parse(String(submission?.reviewed_codes_json || '[]'));
    if (Array.isArray(parsed)) storedReviewedCodes = parsed.map(String).filter(code => diseaseCodes.includes(code));
  } catch { storedReviewedCodes = []; }
  const normalizedSubmission = submission ? {
    ...submission,
    reviewed_codes: submission.submission_status === 'SUBMITTED' ? diseaseCodes : storedReviewedCodes,
    total_visits_reviewed: submission.submission_status === 'SUBMITTED' ? 1 : Number(submission.total_visits_reviewed || 0),
  } : null;
  return json({
    source: {
      source_code: source.source_code,
      source_name: source.source_name,
      village_code: source.village_code,
      subvillage_name: source.subvillage_name,
    },
    administrative_entry: adminMode,
    period,
    locked: Boolean(locked) || (!adminMode && isPastReportingDeadline(period, deadlinePolicies) && submission?.submission_status !== 'SUBMITTED'),
    deadline_at: w2Deadline(period, deadlinePolicies).toISOString(),
    deadline_policy: policyForPeriod(period, deadlinePolicies),
    revision_requires_approval: !adminMode && isPastReportingDeadline(period, deadlinePolicies) && submission?.submission_status === 'SUBMITTED',
    pending_revision: pendingRevision,
    submission: normalizedSubmission,
    catalog_version: indicators[0]?.catalog_version || 'SKDR-2025',
    indicators: indicators.map(item => {
      const value = map.get(item.indicator_code) || { cases: 0, lab: 0 };
      return { ...item, value: value.cases, lab_examined_count: value.lab, required_detail_count: requiredDetailCount(item, { code: item.indicator_code, ...value }) };
    }),
    case_details: caseDetails,
    villages: villages.results,
    reporting_calendar: reportingCalendar(period.year, calendarRows.results, source.created_at, 9, deadlinePolicies),
  });
}

async function saveW2(request: Request, env: Env, session: Session | null, ctx: ExecutionContext): Promise<Response> {
  const data = await body(request);
  const { source, actor, adminMode } = await reportingSource(env, session, data.source_id);
  if (source.source_type !== 'FASKES' || source.network_type !== 'JEJARING') throw new HttpError('Hanya faskes jejaring aktif yang dapat mengirim W2.', 403);
  const period = periodFrom(data);
  await assertOpenWeek(env, period);
  const deadlinePolicies = await w2DeadlinePolicies(env);
  const pastDeadline = isPastReportingDeadline(period, deadlinePolicies);
  const indicators = await currentIndicators(env);
  if (!indicators.length) throw new HttpError('Administrator belum mengatur indikator W2.', 409);
  if (!data.values || typeof data.values !== 'object' || Array.isArray(data.values)) throw new HttpError('Nilai indikator W2 tidak valid.');
  const rawValues = data.values as Record<string, unknown>;
  const values: W2Value[] = indicators.map(indicator => {
    if (!Object.prototype.hasOwnProperty.call(rawValues, indicator.indicator_code))
      throw new HttpError(`Nilai ${indicator.indicator_name} wajib diisi, termasuk nol.`);
    const raw = rawValues[indicator.indicator_code];
    const entry = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : { cases: raw };
    const cases = integer(entry.cases ?? entry.value, indicator.indicator_name);
    const lab = indicator.lab_tracking ? integer(entry.lab ?? entry.lab_examined_count, `Pemeriksaan laboratorium ${indicator.indicator_name}`) : 0;
    if (cases > 100000 || lab > cases) throw new HttpError(`Jumlah kasus ${indicator.indicator_name} melebihi batas, atau jumlah yang diperiksa di laboratorium melebihi jumlah kasus.`);
    return { code: indicator.indicator_code, cases, lab };
  });
  const indicatorMap = new Map(indicators.map(item => [item.indicator_code, item]));
  const valueMap = new Map(values.map(item => [item.code, item]));
  const rawDetails = data.case_details ?? [];
  if (!Array.isArray(rawDetails) || rawDetails.length > 500) throw new HttpError('Rincian kasus lokal tidak valid atau terlalu banyak.');
  const detailVillages = [...new Set(rawDetails.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
    return clean((raw as Record<string, unknown>).village_code, 50).toUpperCase();
  }).filter(code => code && code !== OUTSIDE_WORK_AREA_VILLAGE))];
  if (detailVillages.length) {
    const villageCount = await env.DB.prepare(
      `SELECT COUNT(*) count FROM villages WHERE active=1 AND village_code IN (${placeholders(detailVillages.length)})`
    ).bind(...detailVillages).first<{ count: number }>();
    if (Number(villageCount?.count || 0) !== detailVillages.length)
      throw new HttpError('Desa pada rincian kasus tidak valid.');
  }
  const detailCounts = new Map<string, number>();
  const completeCounts = new Map<string, number>();
  const timestamp = now();
  const reportStart = epiWeekStart(period).toISOString().slice(0, 10);
  const reportEndDate = epiWeekStart(period);
  reportEndDate.setUTCDate(reportEndDate.getUTCDate() + 6);
  const reportEnd = reportEndDate.toISOString().slice(0, 10);
  const secret = patientSecret(env);
  const details = await Promise.all(rawDetails.map(async (raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(`Rincian kasus ke-${index + 1} tidak valid.`);
    const item = raw as Record<string, unknown>;
    const code = clean(item.indicator_code, 40).toUpperCase();
    const indicator = indicatorMap.get(code);
    const value = valueMap.get(code);
    if (!indicator || indicator.is_total || !value?.cases) throw new HttpError(`Rincian kasus ${code || index + 1} tidak sesuai dengan jumlah W2.`);
    detailCounts.set(code, (detailCounts.get(code) || 0) + 1);
    if ((detailCounts.get(code) || 0) > value.cases) throw new HttpError(`Rincian ${indicator.indicator_name} melebihi jumlah kasus.`);
    const patientName = clean(item.patient_name, 150);
    const address = multiline(item.address, 500);
    const phone = clean(item.phone, 30);
    const ageText = String(item.age_value ?? '').trim();
    const ageValue = ageText === '' ? null : integer(ageText, `Usia rincian ke-${index + 1}`);
    const ageUnit = ['DAY', 'MONTH', 'YEAR'].includes(clean(item.age_unit, 10)) ? clean(item.age_unit, 10) as 'DAY' | 'MONTH' | 'YEAR' : null;
    if ((ageUnit === 'DAY' && Number(ageValue) > 365) || (ageUnit === 'MONTH' && Number(ageValue) > 240) || (ageUnit === 'YEAR' && Number(ageValue) > 130))
      throw new HttpError(`Usia rincian ke-${index + 1} tidak masuk akal.`);
    const sex = ['L', 'P'].includes(clean(item.sex, 10)) ? clean(item.sex, 10) as 'L' | 'P' : 'UNKNOWN';
    const village = clean(item.village_code, 50).toUpperCase() || null;
    const onsetDate = date(item.onset_date);
    const visitDate = date(item.visit_date);
    if (visitDate && (visitDate < reportStart || visitDate > reportEnd))
      throw new HttpError(`Tanggal kunjungan rincian ke-${index + 1} harus berada pada minggu laporan.`);
    if (onsetDate && onsetDate > reportEnd)
      throw new HttpError(`Tanggal mulai sakit rincian ke-${index + 1} tidak boleh melewati minggu laporan.`);
    if (onsetDate && visitDate && onsetDate > visitDate)
      throw new HttpError(`Tanggal mulai sakit rincian ke-${index + 1} tidak boleh setelah tanggal kunjungan.`);
    const labStatus = ['NOT_TESTED','PENDING','POSITIVE','NEGATIVE','INCONCLUSIVE','UNKNOWN'].includes(clean(item.lab_status, 20))
      ? clean(item.lab_status, 20) : 'NOT_TESTED';
    const complete = Boolean(patientName && address && ageValue !== null && ageUnit && sex !== 'UNKNOWN' && onsetDate && visitDate);
    if (complete) completeCounts.set(code, (completeCounts.get(code) || 0) + 1);
    return {
      case_detail_id: id('W2C'), submission_id: '', indicator_code: code,
      patient_name_encrypted: await encryptSensitive(patientName, secret),
      age_value: ageValue, age_unit: ageUnit, sex, village_code: village,
      address_encrypted: await encryptSensitive(address, secret),
      phone_encrypted: await encryptSensitive(phone, secret),
      onset_date: onsetDate, visit_date: visitDate, lab_status: labStatus,
      patient_fingerprint: await sensitiveFingerprint(`${patientName}|${ageValue ?? ''}|${ageUnit || ''}|${village || ''}|${address}`, secret),
      is_complete: complete ? 1 : 0, created_at: timestamp, updated_at: timestamp, created_by: actor,
    };
  }));
  let detailRequiredCount = 0;
  let detailProvidedCount = 0;
  for (const indicator of indicators) {
    const required = requiredDetailCount(indicator, valueMap.get(indicator.indicator_code) || { code: indicator.indicator_code, cases: 0, lab: 0 });
    detailRequiredCount += required;
    detailProvidedCount += Math.min(required, completeCounts.get(indicator.indicator_code) || 0);
  }
  const localDetailStatus = detailProvidedCount >= detailRequiredCount ? 'COMPLETE' : 'NEEDS_DETAILS';
  const requestedStatus = clean(data.action, 20).toUpperCase() === 'DRAFT' ? 'DRAFT' : 'SUBMITTED';
  const diseaseCodes = indicators.filter(item => !item.is_total).map(item => item.indicator_code);
  const reviewedCodes = [...new Set((Array.isArray(data.reviewed_codes) ? data.reviewed_codes : [])
    .map(code => clean(code, 40).toUpperCase()).filter(code => diseaseCodes.includes(code)))];
  const totalVisitsReviewed = data.total_visits_reviewed === true || data.total_visits_reviewed === 1;
  if (requestedStatus === 'SUBMITTED' && (reviewedCodes.length !== diseaseCodes.length || !totalVisitsReviewed))
    throw new HttpError('Periksa seluruh penyakit dan total kunjungan sebelum mengirim W2.', 409);
  const submittedVisitCount = values.find(item => indicatorMap.get(item.code)?.is_total)?.cases ?? 0;
  const zeroVisitsConfirmed = data.zero_visits_confirmed === true || data.zero_visits_confirmed === 1;
  if (requestedStatus === 'SUBMITTED' && submittedVisitCount === 0 && !zeroVisitsConfirmed)
    throw new HttpError('Konfirmasikan bahwa tidak ada kunjungan di fasilitas kesehatan selama minggu epidemiologi ini.', 409);
  const existing = await env.DB.prepare('SELECT submission_id,revision,submission_status,first_submitted_at FROM w2_submissions WHERE source_id=? AND epi_year=? AND epi_week=?')
    .bind(source.source_id, period.year, period.week)
    .first<{ submission_id: string; revision: number; submission_status: 'DRAFT' | 'SUBMITTED'; first_submitted_at: string | null }>();
  if (!adminMode && pastDeadline && existing?.submission_status !== 'SUBMITTED') {
    throw new HttpError(`Batas pelaporan ${w2DeadlineRule(period, deadlinePolicies)} telah lewat. Hubungi admin untuk entri laporan terlambat.`, 409);
  }
  if (existing?.submission_status === 'SUBMITTED' && requestedStatus === 'DRAFT') {
    throw new HttpError('Laporan sudah terkirim. Perubahan harus ditinjau dan dikirim sebagai revisi.', 409);
  }
  const isCheckpoint = requestedStatus === 'DRAFT' && data.checkpoint === true;
  const submissionId = existing?.submission_id || id('W2');
  const revision = existing && isCheckpoint && existing.submission_status === 'DRAFT'
    ? Number(existing.revision) : Number(existing?.revision || 0) + 1;
  const submissionStatus = existing?.submission_status === 'SUBMITTED' ? 'SUBMITTED' : requestedStatus;
  const persistedReviewedCodes = submissionStatus === 'SUBMITTED' ? diseaseCodes : reviewedCodes;
  const persistedTotalVisitsReviewed = submissionStatus === 'SUBMITTED' ? 1 : Number(totalVisitsReviewed);
  const firstSubmittedAt = submissionStatus === 'SUBMITTED' ? existing?.first_submitted_at || timestamp : null;
  const notes = multiline(data.notes, 1000);
  const needsApproval = !adminMode && pastDeadline && existing?.submission_status === 'SUBMITTED';
  if (needsApproval) {
    const requestId = id('W2R');
    const payload = {
      values, notes, details, local_detail_status: localDetailStatus,
      detail_required_count: detailRequiredCount, detail_provided_count: detailProvidedCount,
      catalog_version: indicators[0]?.catalog_version || 'SKDR-2025',
      reviewed_codes: diseaseCodes, total_visits_reviewed: 1,
    };
    await env.DB.batch([
      env.DB.prepare("DELETE FROM w2_revision_requests WHERE submission_id=? AND status='PENDING'").bind(existing!.submission_id),
      env.DB.prepare(`INSERT INTO w2_revision_requests
        (request_id,submission_id,source_id,epi_year,epi_week,proposed_revision,payload_json,status,requested_at,requested_by)
        VALUES(?,?,?,?,?,?,?,'PENDING',?,?)`)
        .bind(requestId, existing!.submission_id, source.source_id, period.year, period.week,
          Number(existing!.revision) + 1, JSON.stringify(payload), timestamp, actor),
      auditStatement(env, actor, 'REQUEST_W2_REVISION', 'W2_REVISION_REQUEST', requestId, {}, {
        submission_id: existing!.submission_id, proposed_revision: Number(existing!.revision) + 1,
        epi_year: period.year, epi_week: period.week,
      }, 'Revisi setelah batas waktu; identitas pasien tidak dicatat dalam audit.'),
    ]);
    return json({
      submission_id: existing!.submission_id, revision: existing!.revision, proposed_revision: Number(existing!.revision) + 1,
      submission_status: 'SUBMITTED', approval_status: 'PENDING', request_id: requestId,
      message: 'Revisi diajukan dan menunggu persetujuan admin.',
      local_detail_status: localDetailStatus, detail_required_count: detailRequiredCount,
      detail_provided_count: detailProvidedCount,
      visit_count_warning: (valueMap.get('X')?.cases || 0) < values.filter(item => item.code !== 'X').reduce((sum, item) => sum + item.cases, 0),
    }, 202);
  }
  const statements: D1PreparedStatement[] = existing
    ? [env.DB.prepare(`UPDATE w2_submissions SET submitted_at=?,submitted_by=?,revision=?,notes=?,submission_status=?,
        first_submitted_at=?,local_detail_status=?,detail_required_count=?,detail_provided_count=?,catalog_version=?,updated_at=?,
        reviewed_codes_json=?,total_visits_reviewed=? WHERE submission_id=?`)
      .bind(timestamp, actor, revision, notes, submissionStatus, firstSubmittedAt, localDetailStatus, detailRequiredCount,
        detailProvidedCount, indicators[0]?.catalog_version || 'SKDR-2025', timestamp, JSON.stringify(persistedReviewedCodes),
        persistedTotalVisitsReviewed, submissionId),
      env.DB.prepare('DELETE FROM w2_case_details WHERE submission_id=?').bind(submissionId),
      env.DB.prepare('DELETE FROM w2_values WHERE submission_id=?').bind(submissionId)]
    : [env.DB.prepare(`INSERT INTO w2_submissions (
        submission_id,source_id,epi_year,epi_week,submitted_at,submitted_by,revision,notes,submission_status,first_submitted_at,
        local_detail_status,detail_required_count,detail_provided_count,catalog_version,updated_at,reviewed_codes_json,total_visits_reviewed
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(submissionId, source.source_id, period.year, period.week, timestamp, actor, revision, notes,
        submissionStatus, firstSubmittedAt, localDetailStatus, detailRequiredCount, detailProvidedCount,
        indicators[0]?.catalog_version || 'SKDR-2025', timestamp, JSON.stringify(persistedReviewedCodes), persistedTotalVisitsReviewed)];
  statements.push(...values.map(item => env.DB.prepare('INSERT INTO w2_values (submission_id,indicator_code,case_count,lab_examined_count) VALUES(?,?,?,?)')
    .bind(submissionId, item.code, item.cases, item.lab)));
  statements.push(...details.map(item => {
    item.submission_id = submissionId;
    return env.DB.prepare(`INSERT INTO w2_case_details (
      case_detail_id,submission_id,indicator_code,patient_name_encrypted,age_value,age_unit,sex,village_code,
      address_encrypted,phone_encrypted,onset_date,visit_date,lab_status,patient_fingerprint,is_complete,
      created_at,updated_at,created_by
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...Object.values(item));
  }));
  if (!isCheckpoint || !existing) {
    statements.push(env.DB.prepare('INSERT INTO routine_revision_log (revision_id,submission_type,submission_id,source_id,epi_year,epi_week,revision,changed_at,changed_by,snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind(id('REV'), 'W2', submissionId, source.source_id, period.year, period.week, revision, timestamp, actor,
        JSON.stringify({ values, notes, submission_status: submissionStatus, reviewed_codes: persistedReviewedCodes,
          total_visits_reviewed: Boolean(persistedTotalVisitsReviewed), detail_required_count: detailRequiredCount, detail_provided_count: detailProvidedCount })));
    statements.push(auditStatement(env, actor, existing ? 'UPDATE_W2' : 'CREATE_W2', 'W2_SUBMISSION', submissionId,
      existing ? { revision: existing.revision, submission_status: existing.submission_status } : {},
      { revision, submission_status: submissionStatus, local_detail_status: localDetailStatus, detail_count: details.length },
      adminMode ? 'Entri administratif atas nama institusi. Identitas pasien tidak dicatat dalam audit.' : 'Identitas pasien tidak dicatat dalam audit.'));
  }
  const markerBatch = submissionStatus === 'SUBMITTED'
    ? await markerStatements(env, source.source_id, period, 'W2', values.filter(item => item.code !== 'X').map(item => ({ code: item.code, value: item.cases })))
    : { statements: [], raised: 0 };
  statements.push(...markerBatch.statements);
  await env.DB.batch(statements);
  const raised = markerBatch.raised;
  const origin = new URL(request.url).origin;
  const total = values.filter(item => item.code !== 'X').reduce((sum, item) => sum + item.cases, 0);
  const totalVisits = valueMap.get('X')?.cases || 0;
  if (submissionStatus === 'SUBMITTED') ctx.waitUntil(sendTelegram(env, formatAlert(`${raised ? '⚠️ ' : ''}Laporan W2 mingguan${existing ? ' (revisi)' : ''}`, [
      ['Institusi', `${source.source_name} (${source.source_code})`],
      ['Periode', `${period.year} minggu ${period.week}`],
      ['Total kasus', total],
      ['Total kunjungan', totalVisits],
      ['Rincian lokal', localDetailStatus === 'NEEDS_DETAILS' ? `${detailProvidedCount}/${detailRequiredCount} lengkap` : 'Lengkap'],
      ['Perlu ditinjau', raised ? `${raised} indikator` : null],
      ['Tautan', `${origin}/#staff-ibs`],
    ])));
  const message = submissionStatus === 'DRAFT'
    ? 'Draf W2 disimpan dengan aman.'
    : existing ? 'Revisi W2 disimpan.' : 'W2 berhasil dikirim.';
  return json({
    submission_id: submissionId, revision, submission_status: submissionStatus,
    first_submitted_at: firstSubmittedAt,
    reviewed_codes: persistedReviewedCodes, total_visits_reviewed: Boolean(persistedTotalVisitsReviewed),
    local_detail_status: localDetailStatus, detail_required_count: detailRequiredCount,
    detail_provided_count: detailProvidedCount, visit_count_warning: totalVisits < total,
    message,
  }, existing ? 200 : 201);
}

async function getSchool(env: Env, session: Session | null, query: URLSearchParams): Promise<Response> {
  const { source, adminMode } = await reportingSource(env, session, query.get('source_id'));
  if (source.source_type !== 'SEKOLAH') throw new HttpError('Akun ini tidak berwenang mengirim absensi sekolah.', 403);
  const period = periodFrom(query);
  assertNotFuturePeriod(period);
  const submission = await env.DB.prepare('SELECT * FROM school_submissions WHERE source_id=? AND epi_year=? AND epi_week=?')
    .bind(source.source_id, period.year, period.week).first();
  const academicYear = schoolAcademicYear(period);
  const enrollmentProfile = await env.DB.prepare(`SELECT enrolled_count,confirmed_at,confirmed_by,updated_at,updated_by
    FROM school_enrollment_profiles WHERE source_id=? AND academic_year_start=?`)
    .bind(source.source_id, academicYear).first();
  const latestEnrollment = await env.DB.prepare(`SELECT enrolled_count,epi_year,epi_week,submitted_at
    FROM school_submissions WHERE source_id=? AND (epi_year<? OR (epi_year=? AND epi_week<?))
    ORDER BY epi_year DESC,epi_week DESC LIMIT 1`)
    .bind(source.source_id, period.year, period.year, period.week).first();
  const locked = await env.DB.prepare('SELECT 1 FROM routine_week_locks WHERE epi_year=? AND epi_week=?').bind(period.year, period.week).first();
  const calendarRows = await env.DB.prepare(`SELECT epi_week,'SUBMITTED' submission_status,
      first_submitted_at,submitted_at,revision
    FROM school_submissions WHERE source_id=? AND epi_year=? ORDER BY epi_week`)
    .bind(source.source_id, period.year).all<CalendarSubmission>();
  return json({
    period,
    locked: Boolean(locked),
    submission,
    administrative_entry: adminMode,
    source: { source_code: source.source_code, source_name: source.source_name, village_code: source.village_code },
    enrollment: {
      academic_year_start: academicYear,
      academic_year_label: `${academicYear}/${academicYear + 1}`,
      default_count: Number((submission || enrollmentProfile || latestEnrollment)?.enrolled_count ?? 0),
      has_default: Boolean(submission || enrollmentProfile || latestEnrollment),
      review_required: !enrollmentProfile,
      confirmed_at: enrollmentProfile?.confirmed_at || null,
      updated_at: enrollmentProfile?.updated_at || null,
      carried_from: !submission && !enrollmentProfile && latestEnrollment
        ? { epi_year: latestEnrollment.epi_year, epi_week: latestEnrollment.epi_week, submitted_at: latestEnrollment.submitted_at }
        : null,
    },
    calendar: reportingCalendar(period.year, calendarRows.results, source.created_at),
  });
}

async function saveSchool(request: Request, env: Env, session: Session | null, ctx: ExecutionContext): Promise<Response> {
  const data = await body(request);
  const { source, actor, adminMode } = await reportingSource(env, session, data.source_id);
  if (source.source_type !== 'SEKOLAH') throw new HttpError('Hanya satuan pendidikan yang dapat mengirim absensi sekolah.', 403);
  const period = periodFrom(data);
  assertNotFuturePeriod(period);
  await assertOpenWeek(env, period);
  const enrolled = integer(data.enrolled_count, 'Jumlah siswa terdaftar');
  const sick = integer(data.sick_absent_count, 'Jumlah siswa sakit');
  if (sick > enrolled) throw new HttpError('Jumlah siswa sakit tidak boleh melebihi jumlah siswa terdaftar.');
  const existing = await env.DB.prepare(`SELECT submission_id,revision,enrolled_count,sick_absent_count,
      notes,first_submitted_at FROM school_submissions WHERE source_id=? AND epi_year=? AND epi_week=?`)
    .bind(source.source_id, period.year, period.week).first<{ submission_id: string; revision: number }>();
  if (data.confirmed !== true) throw new HttpError('Tinjau dan konfirmasi laporan sebelum mengirim.', 409);
  const expectedRevision = integer(data.expected_revision ?? 0, 'Revisi laporan');
  if (Number(existing?.revision || 0) !== expectedRevision)
    throw new HttpError('Laporan telah berubah. Muat ulang sebelum menyimpan revisi.', 409);
  const timestamp = now();
  const submissionId = existing?.submission_id || id('SCH');
  const revision = Number(existing?.revision || 0) + 1;
  const percentage = enrolled ? Number(((sick / enrolled) * 100).toFixed(2)) : 0;
  const notes = multiline(data.notes, 1000);
  const academicYear = schoolAcademicYear(period);
  const enrollmentProfile = await env.DB.prepare(`SELECT enrolled_count,confirmed_at,confirmed_by,updated_at,updated_by
    FROM school_enrollment_profiles WHERE source_id=? AND academic_year_start=?`)
    .bind(source.source_id, academicYear).first();
  if (!enrollmentProfile && data.enrollment_confirmed !== true)
    throw new HttpError(`Konfirmasi jumlah siswa untuk tahun ajaran ${academicYear}/${academicYear + 1} sebelum mengirim.`, 409);
  const enrollmentChanged = !enrollmentProfile || Number(enrollmentProfile.enrolled_count) !== enrolled;
  if (existing && Number((existing as Record<string, unknown>).enrolled_count) === enrolled
      && Number((existing as Record<string, unknown>).sick_absent_count) === sick
      && String((existing as Record<string, unknown>).notes || '') === notes && !enrollmentChanged) {
    return json({
      submission_id: submissionId,
      revision: existing.revision,
      sick_percentage: percentage,
      unchanged: true,
      message: 'Tidak ada perubahan pada laporan.',
    });
  }
  const firstSubmittedAt = String((existing as Record<string, unknown> | null)?.first_submitted_at || timestamp);
  const submissionStatement = existing
    ? env.DB.prepare('UPDATE school_submissions SET enrolled_count=?,sick_absent_count=?,sick_percentage=?,notes=?,submitted_at=?,submitted_by=?,revision=?,first_submitted_at=? WHERE submission_id=?')
      .bind(enrolled, sick, percentage, notes, timestamp, actor, revision, firstSubmittedAt, submissionId)
    : env.DB.prepare('INSERT INTO school_submissions (submission_id,source_id,epi_year,epi_week,enrolled_count,sick_absent_count,sick_percentage,notes,submitted_at,submitted_by,revision,first_submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(submissionId, source.source_id, period.year, period.week, enrolled, sick, percentage, notes, timestamp, actor, revision, firstSubmittedAt);
  const markerBatch = await markerStatements(env, source.source_id, period, 'SEKOLAH', [{ code: 'SICK_PERCENT', value: percentage }]);
  const statements = [
    submissionStatement,
    env.DB.prepare('INSERT INTO routine_revision_log (revision_id,submission_type,submission_id,source_id,epi_year,epi_week,revision,changed_at,changed_by,snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind(id('REV'), 'SEKOLAH', submissionId, source.source_id, period.year, period.week, revision, timestamp, actor, JSON.stringify({ enrolled, sick, percentage, notes })),
    auditStatement(env, actor, existing ? 'UPDATE_SCHOOL' : 'CREATE_SCHOOL', 'SCHOOL_SUBMISSION', submissionId,
      existing ? { revision: existing.revision } : {}, { revision, enrolled, sick, percentage }, adminMode ? 'Entri administratif atas nama institusi.' : ''),
    ...markerBatch.statements,
  ];
  if (enrollmentChanged) statements.push(enrollmentProfile
    ? env.DB.prepare(`UPDATE school_enrollment_profiles SET enrolled_count=?,updated_at=?,updated_by=?
        WHERE source_id=? AND academic_year_start=?`)
      .bind(enrolled, timestamp, actor, source.source_id, academicYear)
    : env.DB.prepare(`INSERT INTO school_enrollment_profiles
        (source_id,academic_year_start,enrolled_count,confirmed_at,confirmed_by,updated_at,updated_by)
        VALUES(?,?,?,?,?,?,?)`)
      .bind(source.source_id, academicYear, enrolled, timestamp, actor, timestamp, actor));
  await env.DB.batch(statements);
  const raised = markerBatch.raised;
  const origin = new URL(request.url).origin;
  ctx.waitUntil(sendTelegram(env, formatAlert(`${raised ? '⚠️ ' : ''}Absensi sekolah mingguan${existing ? ' (revisi)' : ''}`, [
    ['Institusi', `${source.source_name} (${source.source_code})`],
    ['Periode', `${period.year} minggu ${period.week}`],
    ['Terdaftar', enrolled],
    ['Sakit', sick],
    ['Persentase sakit', `${percentage}%`],
    ['Perlu ditinjau', raised ? 'ya, di atas ambang' : null],
    ['Tautan', `${origin}/#staff-ibs`],
  ])));
  return json({ submission_id: submissionId, revision, sick_percentage: percentage, first_submitted_at: firstSubmittedAt,
    enrollment_default_updated: enrollmentChanged,
    message: existing ? 'Revisi absensi disimpan.' : 'Absensi sekolah dikirim.' }, existing ? 200 : 201);
}

async function dashboard(env: Env, session: Session | null, query: URLSearchParams): Promise<Response> {
  const staff = requireStaff(session, 'DASHBOARD_READ');
  const period = periodFrom(query);
  const [sources, w2, schools, w2Totals, markers, lock, w2Submissions, pendingDetails, w2Completeness, schoolCompleteness] = await env.DB.batch([
    env.DB.prepare("SELECT source_type,COUNT(*) count FROM routine_sources WHERE active=1 AND (source_type='SEKOLAH' OR network_type='JEJARING') GROUP BY source_type"),
    env.DB.prepare("SELECT COUNT(*) count FROM w2_submissions WHERE epi_year=? AND epi_week=? AND submission_status='SUBMITTED'").bind(period.year, period.week),
    env.DB.prepare('SELECT COUNT(*) count FROM school_submissions WHERE epi_year=? AND epi_week=?').bind(period.year, period.week),
    env.DB.prepare("SELECT v.indicator_code,i.indicator_name,SUM(v.case_count) total,SUM(v.lab_examined_count) lab_total FROM w2_values v JOIN w2_submissions s ON s.submission_id=v.submission_id JOIN w2_indicators i ON i.indicator_code=v.indicator_code WHERE s.epi_year=? AND s.epi_week=? AND s.submission_status='SUBMITTED' GROUP BY v.indicator_code,i.indicator_name,i.sort_order ORDER BY i.sort_order").bind(period.year, period.week),
    env.DB.prepare('SELECT m.*,s.source_name FROM ibs_review_markers m JOIN routine_sources s ON s.source_id=m.source_id WHERE m.epi_year=? AND m.epi_week=? ORDER BY m.created_at DESC').bind(period.year, period.week),
    env.DB.prepare('SELECT locked_at,locked_by FROM routine_week_locks WHERE epi_year=? AND epi_week=?').bind(period.year, period.week),
    env.DB.prepare(`SELECT submission.submission_id,submission.submitted_at,submission.revision,
        submission.local_detail_status,submission.detail_required_count,submission.detail_provided_count,
        source.source_name,source.source_code,
        COALESCE((SELECT SUM(value.case_count) FROM w2_values value
          WHERE value.submission_id=submission.submission_id AND value.indicator_code<>'X'),0) total_cases,
        COALESCE((SELECT value.case_count FROM w2_values value
          WHERE value.submission_id=submission.submission_id AND value.indicator_code='X'),0) total_visits
      FROM w2_submissions submission JOIN routine_sources source ON source.source_id=submission.source_id
      WHERE submission.epi_year=? AND submission.epi_week=? AND submission.submission_status='SUBMITTED'
      ORDER BY submission.submitted_at DESC`).bind(period.year, period.week),
    env.DB.prepare("SELECT COUNT(*) count FROM w2_submissions WHERE epi_year=? AND epi_week=? AND submission_status='SUBMITTED' AND local_detail_status='NEEDS_DETAILS'").bind(period.year, period.week),
    env.DB.prepare(`SELECT source.source_id,source.source_code,source.source_name,source.network_type,
        source.village_code,source.subvillage_name,submission.submission_id,submission.submitted_at,
        submission.revision,submission.local_detail_status
      FROM routine_sources source
      LEFT JOIN w2_submissions submission ON submission.source_id=source.source_id
        AND submission.epi_year=? AND submission.epi_week=? AND submission.submission_status='SUBMITTED'
      WHERE source.active=1 AND source.source_type='FASKES' AND source.network_type='JEJARING'
      ORDER BY CASE WHEN submission.submission_id IS NULL THEN 0 ELSE 1 END,source.source_name`).bind(period.year, period.week),
    env.DB.prepare(`SELECT source.source_id,source.source_code,source.source_name,source.village_code,
        submission.submission_id,submission.enrolled_count,submission.sick_absent_count,
        submission.sick_percentage,submission.notes,submission.submitted_at,
        submission.first_submitted_at,submission.revision
      FROM routine_sources source
      LEFT JOIN school_submissions submission ON submission.source_id=source.source_id
        AND submission.epi_year=? AND submission.epi_week=?
      WHERE source.active=1 AND source.source_type='SEKOLAH'
      ORDER BY CASE WHEN submission.submission_id IS NULL THEN 0 ELSE 1 END,source.source_name`).bind(period.year, period.week),
  ]);
  const count = (rows: D1Result<unknown>) => Number((rows.results[0] as Record<string, unknown> | undefined)?.count || 0);
  const sourceCounts = new Map((sources.results as Array<Record<string, unknown>>).map(row => [String(row.source_type), Number(row.count)]));
  const pendingMarkerCount = (markers.results as Array<Record<string, unknown>>).filter(row => !row.reviewed_at).length;
  return json({
    period, locked: lock.results[0] || null,
    completeness: {
      w2: { expected: sourceCounts.get('FASKES') || 0, submitted: count(w2) },
      schools: { expected: sourceCounts.get('SEKOLAH') || 0, submitted: count(schools) },
    },
    w2_totals: w2Totals.results,
    w2_submissions: w2Submissions.results,
    w2_completeness: w2Completeness.results,
    school_completeness: schoolCompleteness.results,
    can_view_local_details: roleHasPermission(staff.role, 'IBS_PATIENT_READ'),
    pending_details: count(pendingDetails),
    pending_marker_count: pendingMarkerCount,
    school_summary: await env.DB.prepare('SELECT SUM(enrolled_count) enrolled,SUM(sick_absent_count) sick,CASE WHEN SUM(enrolled_count)>0 THEN ROUND(100.0*SUM(sick_absent_count)/SUM(enrolled_count),2) ELSE 0 END sick_percentage FROM school_submissions WHERE epi_year=? AND epi_week=?').bind(period.year, period.week).first(),
    markers: markers.results,
  });
}

async function staffSchoolDetail(env: Env, session: Session | null, submissionId: string): Promise<Response> {
  requireStaff(session, 'DASHBOARD_READ');
  const submission = await env.DB.prepare(`SELECT submission.*,source.source_name,source.source_code,source.village_code
    FROM school_submissions submission JOIN routine_sources source ON source.source_id=submission.source_id
    WHERE submission.submission_id=?`).bind(submissionId).first<Record<string, unknown>>();
  if (!submission) throw new HttpError('Laporan sekolah tidak ditemukan.', 404);
  const revisions = await env.DB.prepare(`SELECT revision,changed_at,changed_by,snapshot_json
    FROM routine_revision_log WHERE submission_type='SEKOLAH' AND submission_id=?
    ORDER BY revision DESC`).bind(submissionId).all<Record<string, unknown>>();
  return json({
    submission,
    revisions: revisions.results.map(row => {
      let snapshot: Record<string, unknown> = {};
      try { snapshot = JSON.parse(String(row.snapshot_json || '{}')) as Record<string, unknown>; } catch { /* keep an empty snapshot */ }
      return { revision: row.revision, changed_at: row.changed_at, changed_by: row.changed_by, ...snapshot };
    }),
  });
}

async function schoolAggregateExport(env: Env, session: Session | null, query: URLSearchParams): Promise<Response> {
  requireStaff(session, 'DASHBOARD_READ');
  const period = periodFrom(query);
  const rows = await env.DB.prepare(`SELECT source.source_code,source.source_name,source.village_code,
      submission.epi_year,submission.epi_week,submission.enrolled_count,submission.sick_absent_count,
      submission.sick_percentage,submission.notes,submission.revision,submission.first_submitted_at,submission.submitted_at
    FROM school_submissions submission JOIN routine_sources source ON source.source_id=submission.source_id
    WHERE submission.epi_year=? AND submission.epi_week=?
    ORDER BY source.source_name`).bind(period.year, period.week).all<Record<string, unknown>>();
  const columns = ['source_code','source_name','village_code','epi_year','epi_week','enrolled_count','sick_absent_count','sick_percentage','notes','revision','first_submitted_at','submitted_at'];
  const cell = (value: unknown): string => {
    const output = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(output) ? `"${output.replaceAll('"', '""')}"` : output;
  };
  const csv = [columns.join(','), ...rows.results.map(row => columns.map(column => cell(row[column])).join(','))].join('\r\n');
  return new Response(`\uFEFF${csv}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="absensi-sekolah-${period.year}-ME${String(period.week).padStart(2, '0')}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

async function staffW2Detail(env: Env, session: Session | null, submissionId: string): Promise<Response> {
  const staff = requireStaff(session, 'DASHBOARD_READ');
  const submission = await env.DB.prepare(`SELECT submission.*,source.source_name,source.source_code
    FROM w2_submissions submission JOIN routine_sources source ON source.source_id=submission.source_id
    WHERE submission.submission_id=?`).bind(submissionId).first<Record<string, unknown>>();
  if (!submission) throw new HttpError('Laporan W2 tidak ditemukan.', 404);
  const values = await env.DB.prepare(`SELECT value.indicator_code,indicator.indicator_name,indicator.definition,
      indicator.identity_policy,indicator.is_total,value.case_count,value.lab_examined_count
    FROM w2_values value JOIN w2_indicators indicator ON indicator.indicator_code=value.indicator_code
    WHERE value.submission_id=? ORDER BY indicator.sort_order`).bind(submissionId).all();
  const canView = roleHasPermission(staff.role, 'IBS_PATIENT_READ');
  const caseDetails = canView ? await readableCaseDetails(env, submissionId) : [];
  if (canView) await auditStatement(env, staff.email, 'VIEW_W2_LOCAL_DETAILS', 'W2_SUBMISSION', submissionId, {}, {
    detail_count: caseDetails.length,
  }, 'Akses rincian identitas lokal.').run();
  return json({ submission, values: values.results, case_details: caseDetails, can_view_local_details: canView });
}

async function w2AggregateExport(env: Env, session: Session | null, query: URLSearchParams): Promise<Response> {
  requireStaff(session, 'DASHBOARD_READ');
  const period = periodFrom(query);
  const rows = await env.DB.prepare(`SELECT source.source_code,source.source_name,submission.epi_year,submission.epi_week,
      value.indicator_code,indicator.indicator_name,value.case_count,value.lab_examined_count,
      submission.revision,submission.submitted_at
    FROM w2_submissions submission
    JOIN routine_sources source ON source.source_id=submission.source_id
    JOIN w2_values value ON value.submission_id=submission.submission_id
    JOIN w2_indicators indicator ON indicator.indicator_code=value.indicator_code
    WHERE submission.epi_year=? AND submission.epi_week=? AND submission.submission_status='SUBMITTED'
    ORDER BY source.source_name,indicator.sort_order`).bind(period.year, period.week).all<Record<string, unknown>>();
  const columns = ['source_code','source_name','epi_year','epi_week','indicator_code','indicator_name','case_count','lab_examined_count','revision','submitted_at'];
  const cell = (value: unknown): string => {
    const output = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(output) ? `"${output.replaceAll('"', '""')}"` : output;
  };
  const csv = [columns.join(','), ...rows.results.map(row => columns.map(column => cell(row[column])).join(','))].join('\r\n');
  return new Response('\ufeff' + csv, { headers: {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="w2-agregat-${period.year}-minggu-${period.week}.csv"`,
    'cache-control': 'no-store',
  }});
}

async function admin(request: Request, env: Env, session: Session | null, path: string): Promise<Response | null> {
  const admin = requireAdmin(session);
  if (request.method === 'GET' && path === '/api/admin/ibs/deadline') {
    const policies = await w2DeadlinePolicies(env);
    const current = currentEpiPeriod();
    return json({ current_period: current, active: policyForPeriod(current, policies), history: [...policies].reverse() });
  }
  if (request.method === 'POST' && path === '/api/admin/ibs/deadline') {
    const data = await body(request);
    const hour = integer(data.deadline_hour, 'Jam batas pelaporan');
    const minute = integer(data.deadline_minute, 'Menit batas pelaporan');
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new HttpError('Waktu batas pelaporan tidak valid.');
    const effective = currentEpiPeriod();
    const timestamp = now();
    const existing = await env.DB.prepare(`SELECT * FROM w2_deadline_policies
      WHERE effective_epi_year=? AND effective_epi_week=?`).bind(effective.year, effective.week).first<Record<string, unknown>>();
    const policyId = String(existing?.policy_id || id('W2D'));
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO w2_deadline_policies
        (policy_id,effective_epi_year,effective_epi_week,deadline_hour,deadline_minute,created_at,created_by)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(effective_epi_year,effective_epi_week) DO UPDATE SET
        deadline_hour=excluded.deadline_hour,deadline_minute=excluded.deadline_minute,
        created_at=excluded.created_at,created_by=excluded.created_by`)
        .bind(policyId, effective.year, effective.week, hour, minute, timestamp, admin.email),
      auditStatement(env, admin.email, existing ? 'UPDATE_W2_DEADLINE' : 'CREATE_W2_DEADLINE',
        'W2_DEADLINE_POLICY', policyId, existing || {}, {
          effective_epi_year: effective.year, effective_epi_week: effective.week,
          deadline_hour: hour, deadline_minute: minute,
        }, 'Perubahan hanya berlaku mulai minggu efektif; status historis menggunakan kebijakan sebelumnya.'),
    ]);
    return json({ ok: true, policy_id: policyId, effective_period: effective, deadline_hour: hour, deadline_minute: minute });
  }
  if (request.method === 'GET' && path === '/api/admin/ibs/revision-requests') {
    const rows = await env.DB.prepare(`SELECT request.request_id,request.submission_id,request.epi_year,request.epi_week,
      request.proposed_revision,request.status,request.requested_at,request.requested_by,
      source.source_code,source.source_name
      FROM w2_revision_requests request JOIN routine_sources source ON source.source_id=request.source_id
      WHERE request.status='PENDING' ORDER BY request.requested_at`).all();
    return json(rows.results);
  }
  const revisionDecision = path.match(/^\/api\/admin\/ibs\/revision-requests\/([^/]+)\/decision$/);
  if (request.method === 'POST' && revisionDecision) {
    const requestId = decodeURIComponent(revisionDecision[1]);
    const data = await body(request);
    const decision = clean(data.decision, 20).toUpperCase();
    const decisionNotes = multiline(data.notes, 500);
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw new HttpError('Keputusan revisi tidak valid.');
    if (decision === 'REJECTED' && !decisionNotes) throw new HttpError('Alasan penolakan revisi wajib diisi.');
    const requestRow = await env.DB.prepare(`SELECT request.*,submission.revision current_revision
      FROM w2_revision_requests request JOIN w2_submissions submission ON submission.submission_id=request.submission_id
      WHERE request.request_id=?`).bind(requestId).first<Record<string, unknown>>();
    if (!requestRow) throw new HttpError('Permintaan revisi tidak ditemukan.', 404);
    if (requestRow.status !== 'PENDING') throw new HttpError('Permintaan revisi ini sudah diputuskan.', 409);
    const timestamp = now();
    if (decision === 'REJECTED') {
      await env.DB.batch([
        env.DB.prepare(`UPDATE w2_revision_requests SET status='REJECTED',decided_at=?,decided_by=?,decision_notes=? WHERE request_id=?`)
          .bind(timestamp, admin.email, decisionNotes, requestId),
        auditStatement(env, admin.email, 'REJECT_W2_REVISION', 'W2_REVISION_REQUEST', requestId,
          { status: 'PENDING' }, { status: 'REJECTED' }, decisionNotes),
      ]);
      return json({ ok: true, status: 'REJECTED' });
    }
    if (Number(requestRow.current_revision) + 1 !== Number(requestRow.proposed_revision))
      throw new HttpError('Laporan aktif telah berubah. Tolak permintaan lama dan minta faskes mengajukan ulang.', 409);
    const payload = JSON.parse(String(requestRow.payload_json)) as Record<string, unknown>;
    const values = payload.values as W2Value[];
    const details = payload.details as Array<Record<string, unknown>>;
    if (!Array.isArray(values) || !Array.isArray(details)) throw new HttpError('Data permintaan revisi rusak.', 500);
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`UPDATE w2_submissions SET submitted_at=?,submitted_by=?,revision=?,notes=?,local_detail_status=?,
        detail_required_count=?,detail_provided_count=?,catalog_version=?,updated_at=?,reviewed_codes_json=?,total_visits_reviewed=1
        WHERE submission_id=?`).bind(timestamp, admin.email, requestRow.proposed_revision, payload.notes,
          payload.local_detail_status, payload.detail_required_count, payload.detail_provided_count, payload.catalog_version,
          timestamp, JSON.stringify(payload.reviewed_codes || []), requestRow.submission_id),
      env.DB.prepare('DELETE FROM w2_case_details WHERE submission_id=?').bind(requestRow.submission_id),
      env.DB.prepare('DELETE FROM w2_values WHERE submission_id=?').bind(requestRow.submission_id),
      ...values.map(item => env.DB.prepare('INSERT INTO w2_values (submission_id,indicator_code,case_count,lab_examined_count) VALUES(?,?,?,?)')
        .bind(requestRow.submission_id, item.code, item.cases, item.lab)),
      ...details.map(item => env.DB.prepare(`INSERT INTO w2_case_details (
        case_detail_id,submission_id,indicator_code,patient_name_encrypted,age_value,age_unit,sex,village_code,
        address_encrypted,phone_encrypted,onset_date,visit_date,lab_status,patient_fingerprint,is_complete,
        created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(item.case_detail_id, requestRow.submission_id, item.indicator_code, item.patient_name_encrypted,
          item.age_value, item.age_unit, item.sex, item.village_code, item.address_encrypted, item.phone_encrypted,
          item.onset_date, item.visit_date, item.lab_status, item.patient_fingerprint, item.is_complete,
          item.created_at, timestamp, item.created_by)),
      env.DB.prepare(`UPDATE w2_revision_requests SET status='APPROVED',decided_at=?,decided_by=?,decision_notes=? WHERE request_id=?`)
        .bind(timestamp, admin.email, decisionNotes, requestId),
      env.DB.prepare('INSERT INTO routine_revision_log (revision_id,submission_type,submission_id,source_id,epi_year,epi_week,revision,changed_at,changed_by,snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .bind(id('REV'), 'W2', requestRow.submission_id, requestRow.source_id, requestRow.epi_year, requestRow.epi_week,
          requestRow.proposed_revision, timestamp, admin.email, JSON.stringify({ values, notes: payload.notes, approved_request_id: requestId })),
      auditStatement(env, admin.email, 'APPROVE_W2_REVISION', 'W2_REVISION_REQUEST', requestId,
        { status: 'PENDING' }, { status: 'APPROVED', revision: requestRow.proposed_revision }, decisionNotes),
    ];
    const markerBatch = await markerStatements(env, String(requestRow.source_id),
      { year: Number(requestRow.epi_year), week: Number(requestRow.epi_week) }, 'W2',
      values.filter(item => item.code !== 'X').map(item => ({ code: item.code, value: item.cases })));
    await env.DB.batch([...statements, ...markerBatch.statements]);
    return json({ ok: true, status: 'APPROVED', revision: Number(requestRow.proposed_revision) });
  }
  if (request.method === 'GET' && path === '/api/admin/ibs/sources') {
    const rows = await env.DB.prepare(`SELECT source.source_id,source.source_code,source.source_type,source.network_type,
      source.source_name,source.program_area,source.village_code,village.village_name,source.subvillage_name,source.active,
      source.last_login_at,source.deactivation_reason,
      (SELECT COUNT(*) FROM auth_sessions sessions WHERE sessions.account_kind='routine' AND sessions.account_id=source.source_id AND sessions.revoked_at IS NULL AND sessions.expires_at>?) AS active_sessions
      FROM routine_sources source LEFT JOIN villages village ON village.village_code=source.village_code
      ORDER BY source.source_type,source.source_name`).bind(Math.floor(Date.now() / 1000)).all();
    return json(rows.results);
  }
  if (request.method === 'POST' && path === '/api/admin/ibs/sources') {
    const data = await body(request);
    const type = clean(data.source_type, 20) as Source['source_type'];
    const network = clean(data.network_type, 20) as Source['network_type'];
    const code = clean(data.source_code, 40).toUpperCase();
    const pin = String(data.pin || '');
    const villageCode = clean(data.village_code, 50).toUpperCase() || null;
    const subvillageName = clean(data.subvillage_name, 100) || null;
    if (!['FASKES', 'SEKOLAH'].includes(type) || !/^[A-Z0-9-]{3,40}$/.test(code) || !clean(data.source_name, 150) || !/^\d{6}$/.test(pin))
      throw new HttpError('Pilih jenis institusi, lalu isi kode, nama, dan PIN 6 digit yang valid.');
    if (type === 'FASKES' && !['JEJARING', 'JARINGAN'].includes(network || '')) throw new HttpError('Jenis jejaring faskes wajib dipilih.');
    if (villageCode && !(await env.DB.prepare('SELECT 1 FROM villages WHERE village_code=? AND active=1').bind(villageCode).first()))
      throw new HttpError('Desa institusi tidak valid.');
    if (await env.DB.prepare('SELECT 1 FROM routine_sources WHERE source_code=?').bind(code).first())
      throw new HttpError('Kode institusi sudah digunakan.', 409);
    const timestamp = now();
    const source = { source_id: id('SRC'), source_code: code, source_type: type, network_type: type === 'FASKES' ? network : null, source_name: clean(data.source_name, 150), program_area: clean(data.program_area, 100), village_code: villageCode, subvillage_name: subvillageName, active: 1, pin_salt: randomSalt(), created_at: timestamp, updated_at: timestamp };
    const pinHash = await passwordHash(pin, source.pin_salt);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO routine_sources (source_id,source_code,source_type,network_type,source_name,program_area,village_code,subvillage_name,active,pin_salt,pin_hash,pin_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(source.source_id, source.source_code, source.source_type, source.network_type, source.source_name, source.program_area, source.village_code, source.subvillage_name, source.active, source.pin_salt, pinHash, CURRENT_PASSWORD_ITERATIONS, source.created_at, source.updated_at),
      auditStatement(env, admin.email, 'CREATE_IBS_SOURCE', 'ROUTINE_SOURCE', source.source_id, {}, {
        source_code: code, source_type: type, network_type: source.network_type, village_code: villageCode,
      }),
    ]);
    return json({ source_id: source.source_id }, 201);
  }
  const editSource = path.match(/^\/api\/admin\/ibs\/sources\/([^/]+)$/);
  if (request.method === 'DELETE' && editSource) {
    const sourceId = decodeURIComponent(editSource[1]);
    const target = await env.DB.prepare(`SELECT source_id,source_code,source_type,source_name,active
      FROM routine_sources WHERE source_id=?`).bind(sourceId).first<Record<string, unknown>>();
    if (!target) throw new HttpError('Institusi tidak ditemukan.', 404);
    const data = await body(request); const reason = multiline(data.reason, 500);
    if (!reason) throw new HttpError('Alasan penghapusan institusi wajib diisi.');
    const counts = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM w2_submissions WHERE source_id=?) w2_count,
      (SELECT COUNT(*) FROM school_submissions WHERE source_id=?) school_count`)
      .bind(sourceId, sourceId).first<Record<string, unknown>>();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM w2_case_details WHERE submission_id IN (SELECT submission_id FROM w2_submissions WHERE source_id=?)').bind(sourceId),
      env.DB.prepare('DELETE FROM w2_values WHERE submission_id IN (SELECT submission_id FROM w2_submissions WHERE source_id=?)').bind(sourceId),
      env.DB.prepare('DELETE FROM w2_submissions WHERE source_id=?').bind(sourceId),
      env.DB.prepare('DELETE FROM school_submissions WHERE source_id=?').bind(sourceId),
      env.DB.prepare('DELETE FROM ibs_review_markers WHERE source_id=?').bind(sourceId),
      env.DB.prepare('DELETE FROM routine_revision_log WHERE source_id=?').bind(sourceId),
      env.DB.prepare('DELETE FROM school_enrollment_profiles WHERE source_id=?').bind(sourceId),
      env.DB.prepare('DELETE FROM routine_sources WHERE source_id=?').bind(sourceId),
      auditStatement(env, admin.email, 'DELETE_IBS_SOURCE', 'ROUTINE_SOURCE', sourceId, { ...target, ...counts }, {}, reason),
    ]);
    return json({ ok: true, deleted_w2: Number(counts?.w2_count || 0), deleted_school: Number(counts?.school_count || 0) });
  }
  if (request.method === 'PATCH' && editSource) {
    const sourceId = decodeURIComponent(editSource[1]);
    const target = await env.DB.prepare(`SELECT source_id,source_code,source_type,network_type,source_name,
      program_area,village_code,subvillage_name,active FROM routine_sources WHERE source_id=?`)
      .bind(sourceId).first<Source>();
    if (!target) throw new HttpError('Institusi tidak ditemukan.', 404);
    const data = await body(request);
    const code = clean(data.source_code, 40).toUpperCase();
    const name = clean(data.source_name, 150);
    const network = target.source_type === 'FASKES' ? clean(data.network_type, 20) as Source['network_type'] : null;
    const programArea = clean(data.program_area, 100) || null;
    const villageCode = clean(data.village_code, 50).toUpperCase() || null;
    const subvillageName = clean(data.subvillage_name, 100) || null;
    if (!/^[A-Z0-9-]{3,40}$/.test(code) || !name)
      throw new HttpError('Isi kode dan nama institusi yang valid.');
    if (target.source_type === 'FASKES' && !['JEJARING', 'JARINGAN'].includes(network || ''))
      throw new HttpError('Jenis jejaring faskes wajib dipilih.');
    if (villageCode && !(await env.DB.prepare('SELECT 1 FROM villages WHERE village_code=? AND active=1').bind(villageCode).first()))
      throw new HttpError('Desa institusi tidak valid.');
    const duplicate = await env.DB.prepare('SELECT 1 FROM routine_sources WHERE source_code=? AND source_id<>?').bind(code, sourceId).first();
    if (duplicate) throw new HttpError('Kode institusi sudah digunakan.', 409);
    const timestamp = now();
    const after = {
      source_code: code, source_type: target.source_type, network_type: network,
      source_name: name, program_area: programArea, village_code: villageCode,
      subvillage_name: subvillageName, active: target.active,
    };
    await env.DB.batch([
      env.DB.prepare(`UPDATE routine_sources SET source_code=?,network_type=?,source_name=?,program_area=?,
        village_code=?,subvillage_name=?,session_version=session_version+1,updated_at=? WHERE source_id=?`)
        .bind(code, network, name, programArea, villageCode, subvillageName, timestamp, sourceId),
      auditStatement(env, admin.email, 'UPDATE_IBS_SOURCE', 'ROUTINE_SOURCE', sourceId, target, after),
    ]);
    return json({ source_id: sourceId, ...after });
  }
  const reset = path.match(/^\/api\/admin\/ibs\/sources\/([^/]+)\/reset-pin$/);
  if (request.method === 'POST' && reset) {
    const data = await body(request); const pin = String(data.pin || '');
    if (!/^\d{6}$/.test(pin)) throw new HttpError('PIN harus tepat 6 digit.');
    const sourceId = decodeURIComponent(reset[1]);
    const target = await env.DB.prepare('SELECT source_id,source_code FROM routine_sources WHERE source_id=?').bind(sourceId).first<Source>();
    if (!target) throw new HttpError('Institusi tidak ditemukan.', 404);
    const salt = randomSalt();
    await env.DB.batch([
      env.DB.prepare('UPDATE routine_sources SET pin_salt=?,pin_hash=?,pin_iterations=?,session_version=session_version+1,updated_at=? WHERE source_id=?')
        .bind(salt, await passwordHash(pin, salt), CURRENT_PASSWORD_ITERATIONS, now(), sourceId),
      auditStatement(env, admin.email, 'RESET_IBS_SOURCE_PIN', 'ROUTINE_SOURCE', sourceId, {}, {}, `PIN ${target.source_code} direset.`),
    ]);
    return json({ ok: true });
  }
  const sourceSessionReset = path.match(/^\/api\/admin\/ibs\/sources\/([^/]+)\/revoke-sessions$/);
  if (request.method === 'POST' && sourceSessionReset) {
    const sourceId = decodeURIComponent(sourceSessionReset[1]);
    const target = await env.DB.prepare('SELECT source_id,source_code FROM routine_sources WHERE source_id=?').bind(sourceId).first<Source>();
    if (!target) throw new HttpError('Institusi tidak ditemukan.', 404);
    await env.DB.batch([
      env.DB.prepare('UPDATE routine_sources SET session_version=session_version+1,updated_at=? WHERE source_id=?').bind(now(), sourceId),
      env.DB.prepare("UPDATE auth_sessions SET revoked_at=? WHERE account_kind='routine' AND account_id=? AND revoked_at IS NULL").bind(now(), sourceId),
      auditStatement(env, admin.email, 'REVOKE_IBS_SOURCE_SESSIONS', 'ROUTINE_SOURCE', sourceId, {}, {}, `Semua sesi ${target.source_code} dicabut.`),
    ]);
    return json({ ok: true });
  }
  const sourceStatus = path.match(/^\/api\/admin\/ibs\/sources\/([^/]+)\/status$/);
  if (request.method === 'POST' && sourceStatus) {
    const data = await body(request); const active = Number(data.active) === 1 ? 1 : 0;
    const reason = multiline(data.reason, 500);
    if (!active && !reason) throw new HttpError('Alasan penonaktifan institusi wajib diisi.');
    const sourceId = decodeURIComponent(sourceStatus[1]);
    const target = await env.DB.prepare('SELECT source_id,active FROM routine_sources WHERE source_id=?').bind(sourceId).first<Source>();
    if (!target) throw new HttpError('Institusi tidak ditemukan.', 404);
    await env.DB.batch([
      env.DB.prepare('UPDATE routine_sources SET active=?,deactivation_reason=?,session_version=session_version+1,updated_at=? WHERE source_id=?')
        .bind(active, active ? null : reason, now(), sourceId),
      auditStatement(env, admin.email, 'UPDATE_IBS_SOURCE_STATUS', 'ROUTINE_SOURCE', sourceId, { active: target.active }, { active }, reason),
    ]);
    return json({ ok: true });
  }
  // Admin sees every indicator including inactive ones (the W2 form itself uses
  // currentIndicators, which filters to active).
  if (request.method === 'GET' && path === '/api/admin/ibs/indicators') {
    const rows = await env.DB.prepare('SELECT indicator_code,indicator_name,sort_order,active,identity_policy,is_total,lab_tracking,catalog_version FROM w2_indicators ORDER BY sort_order,indicator_name').all();
    return json(rows.results);
  }
  if (request.method === 'POST' && path === '/api/admin/ibs/indicators') {
    const data = await body(request); const code = clean(data.indicator_code, 40).toUpperCase(); const name = clean(data.indicator_name, 150);
    if (!/^[A-Z0-9_-]{1,40}$/.test(code) || !name) throw new HttpError('Isi kode dan nama indikator yang valid.');
    const identityPolicy = clean(data.identity_policy, 20).toUpperCase() || 'CONDITIONAL';
    if (!['REQUIRED', 'CONDITIONAL', 'OPTIONAL'].includes(identityPolicy))
      throw new HttpError('Kebijakan rincian pasien tidak valid.');
    const labTracking = data.lab_tracking === undefined ? 1 : Number(data.lab_tracking);
    if (![0, 1].includes(labTracking)) throw new HttpError('Pengaturan pemeriksaan laboratorium tidak valid.');
    const timestamp = now();
    const sortOrder = integer(data.sort_order, 'Urutan');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO w2_indicators (indicator_code,indicator_name,active,sort_order,identity_policy,lab_tracking,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        .bind(code, name, 1, sortOrder, identityPolicy, labTracking, timestamp, timestamp),
      auditStatement(env, admin.email, 'CREATE_W2_INDICATOR', 'W2_INDICATOR', code, {}, {
        indicator_name: name, sort_order: sortOrder, identity_policy: identityPolicy, lab_tracking: labTracking,
      }),
    ]);
    return json({ indicator_code: code }, 201);
  }
  if (request.method === 'POST' && path === '/api/admin/ibs/indicators/lab-tracking') {
    const data = await body(request);
    const labTracking = Number(data.lab_tracking);
    if (![0, 1].includes(labTracking)) throw new HttpError('Pengaturan pemeriksaan laboratorium tidak valid.');
    const rows = await env.DB.prepare(
      'SELECT indicator_code,indicator_name,lab_tracking FROM w2_indicators WHERE active=1 AND is_total=0 ORDER BY sort_order,indicator_name'
    ).all<{ indicator_code: string; indicator_name: string; lab_tracking: number }>();
    const changed = rows.results.filter(item => Number(item.lab_tracking) !== labTracking);
    if (!changed.length) return json({ ok: true, unchanged: true, lab_tracking: labTracking, updated_count: 0 });
    const timestamp = now();
    const statements = changed.flatMap(item => [
      env.DB.prepare('UPDATE w2_indicators SET lab_tracking=?,updated_at=? WHERE indicator_code=? AND active=1 AND is_total=0')
        .bind(labTracking, timestamp, item.indicator_code),
      auditStatement(env, admin.email, 'UPDATE_W2_INDICATOR_LAB_TRACKING', 'W2_INDICATOR', item.indicator_code,
        { lab_tracking: Number(item.lab_tracking) }, { lab_tracking: labTracking },
        `Pencatatan pemeriksaan laboratorium ${item.indicator_name} diperbarui melalui aksi massal.`),
    ]);
    await env.DB.batch(statements);
    return json({ ok: true, lab_tracking: labTracking, updated_count: changed.length, updated_at: timestamp });
  }
  const indicatorLabTracking = path.match(/^\/api\/admin\/ibs\/indicators\/([^/]+)\/lab-tracking$/);
  if (request.method === 'POST' && indicatorLabTracking) {
    const data = await body(request);
    const code = decodeURIComponent(indicatorLabTracking[1]).toUpperCase();
    const labTracking = Number(data.lab_tracking);
    if (![0, 1].includes(labTracking)) throw new HttpError('Pengaturan pemeriksaan laboratorium tidak valid.');
    const target = await env.DB.prepare(
      'SELECT indicator_code,indicator_name,lab_tracking,is_total FROM w2_indicators WHERE indicator_code=?'
    ).bind(code).first<{ indicator_code: string; indicator_name: string; lab_tracking: number; is_total: number }>();
    if (!target) throw new HttpError('Indikator tidak ditemukan.', 404);
    if (Number(target.is_total)) throw new HttpError('Pemeriksaan laboratorium tidak berlaku untuk indikator total.', 409);
    if (Number(target.lab_tracking) === labTracking)
      return json({ ok: true, unchanged: true, lab_tracking: labTracking });
    const timestamp = now();
    await env.DB.batch([
      env.DB.prepare('UPDATE w2_indicators SET lab_tracking=?,updated_at=? WHERE indicator_code=? AND is_total=0')
        .bind(labTracking, timestamp, code),
      auditStatement(env, admin.email, 'UPDATE_W2_INDICATOR_LAB_TRACKING', 'W2_INDICATOR', code,
        { lab_tracking: Number(target.lab_tracking) }, { lab_tracking: labTracking },
        `Pencatatan pemeriksaan laboratorium ${target.indicator_name} diperbarui.`),
    ]);
    return json({ ok: true, lab_tracking: labTracking, updated_at: timestamp });
  }
  const indicatorIdentityPolicy = path.match(/^\/api\/admin\/ibs\/indicators\/([^/]+)\/identity-policy$/);
  if (request.method === 'POST' && indicatorIdentityPolicy) {
    const data = await body(request);
    const code = decodeURIComponent(indicatorIdentityPolicy[1]).toUpperCase();
    const identityPolicy = clean(data.identity_policy, 20).toUpperCase() as IdentityPolicy;
    if (!['REQUIRED', 'CONDITIONAL', 'OPTIONAL'].includes(identityPolicy))
      throw new HttpError('Kebijakan rincian pasien tidak valid.');
    const target = await env.DB.prepare(
      'SELECT indicator_code,indicator_name,identity_policy,is_total FROM w2_indicators WHERE indicator_code=?'
    ).bind(code).first<{ indicator_code: string; indicator_name: string; identity_policy: IdentityPolicy; is_total: number }>();
    if (!target) throw new HttpError('Indikator tidak ditemukan.', 404);
    if (Number(target.is_total)) throw new HttpError('Kebijakan rincian pasien untuk indikator total tidak dapat diubah.', 409);
    if (target.identity_policy === identityPolicy) return json({ ok: true, unchanged: true, identity_policy: identityPolicy });
    const timestamp = now();
    await env.DB.batch([
      env.DB.prepare('UPDATE w2_indicators SET identity_policy=?,updated_at=? WHERE indicator_code=?')
        .bind(identityPolicy, timestamp, code),
      auditStatement(env, admin.email, 'UPDATE_W2_INDICATOR_IDENTITY_POLICY', 'W2_INDICATOR', code,
        { identity_policy: target.identity_policy }, { identity_policy: identityPolicy },
        `Kebijakan rincian pasien ${target.indicator_name} diperbarui.`),
    ]);
    return json({ ok: true, identity_policy: identityPolicy, updated_at: timestamp });
  }
  const indicatorStatus = path.match(/^\/api\/admin\/ibs\/indicators\/([^/]+)\/status$/);
  if (request.method === 'POST' && indicatorStatus) {
    const data = await body(request); const active = Number(data.active) === 1 ? 1 : 0;
    const reason = multiline(data.reason, 500);
    if (!active && !reason) throw new HttpError('Alasan penonaktifan indikator wajib diisi.');
    const code = decodeURIComponent(indicatorStatus[1]);
    const target = await env.DB.prepare('SELECT indicator_code,active FROM w2_indicators WHERE indicator_code=?').bind(code).first<{ indicator_code: string; active: number }>();
    if (!target) throw new HttpError('Indikator tidak ditemukan.', 404);
    await env.DB.batch([
      env.DB.prepare('UPDATE w2_indicators SET active=?,updated_at=? WHERE indicator_code=?').bind(active, now(), code),
      auditStatement(env, admin.email, 'UPDATE_W2_INDICATOR_STATUS', 'W2_INDICATOR', code, { active: target.active }, { active }, reason),
    ]);
    return json({ ok: true });
  }
  if (request.method === 'GET' && path === '/api/admin/ibs/thresholds') {
    const rows = await env.DB.prepare('SELECT * FROM ibs_thresholds ORDER BY target_type,target_code').all(); return json(rows.results);
  }
  const thresholdDelete = path.match(/^\/api\/admin\/ibs\/thresholds\/([^/]+)$/);
  if (request.method === 'DELETE' && thresholdDelete) {
    const thresholdId = decodeURIComponent(thresholdDelete[1]);
    const target = await env.DB.prepare('SELECT * FROM ibs_thresholds WHERE threshold_id=?').bind(thresholdId).first<Record<string, unknown>>();
    if (!target) throw new HttpError('Ambang tinjauan tidak ditemukan.', 404);
    const data = await body(request); const reason = multiline(data.reason, 500);
    if (!reason) throw new HttpError('Alasan penghapusan ambang wajib diisi.');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM ibs_thresholds WHERE threshold_id=?').bind(thresholdId),
      auditStatement(env, admin.email, 'DELETE_IBS_THRESHOLD', 'IBS_THRESHOLD', thresholdId, target, {}, reason),
    ]);
    return json({ ok: true });
  }
  const w2Delete = path.match(/^\/api\/admin\/ibs\/w2-submissions\/([^/]+)$/);
  if (request.method === 'DELETE' && w2Delete) {
    const submissionId = decodeURIComponent(w2Delete[1]);
    const target = await env.DB.prepare(`SELECT submission.*,source.source_code,source.source_name
      FROM w2_submissions submission JOIN routine_sources source ON source.source_id=submission.source_id
      WHERE submission.submission_id=?`).bind(submissionId).first<Record<string, unknown>>();
    if (!target) throw new HttpError('Laporan W2 tidak ditemukan.', 404);
    const data = await body(request); const reason = multiline(data.reason, 500);
    if (!reason) throw new HttpError('Alasan penghapusan laporan W2 wajib diisi.');
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO integration_w2_tombstones
        (submission_id,source_id,epi_year,epi_week,deleted_at,deleted_by,deletion_reason)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET
        deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,deletion_reason=excluded.deletion_reason`)
        .bind(submissionId,target.source_id,target.epi_year,target.epi_week,now(),admin.email,reason),
      env.DB.prepare('DELETE FROM w2_case_details WHERE submission_id=?').bind(submissionId),
      env.DB.prepare('DELETE FROM w2_values WHERE submission_id=?').bind(submissionId),
      env.DB.prepare("DELETE FROM ibs_review_markers WHERE source_id=? AND epi_year=? AND epi_week=? AND target_type='W2'")
        .bind(target.source_id, target.epi_year, target.epi_week),
      env.DB.prepare("DELETE FROM routine_revision_log WHERE submission_type='W2' AND submission_id=?").bind(submissionId),
      env.DB.prepare('DELETE FROM w2_submissions WHERE submission_id=?').bind(submissionId),
      auditStatement(env, admin.email, 'DELETE_W2_SUBMISSION', 'W2_SUBMISSION', submissionId, target, {}, reason),
    ]);
    return json({ ok: true });
  }
  const schoolDelete = path.match(/^\/api\/admin\/ibs\/school-submissions\/([^/]+)$/);
  if (request.method === 'DELETE' && schoolDelete) {
    const submissionId = decodeURIComponent(schoolDelete[1]);
    const target = await env.DB.prepare(`SELECT submission.*,source.source_code,source.source_name
      FROM school_submissions submission JOIN routine_sources source ON source.source_id=submission.source_id
      WHERE submission.submission_id=?`).bind(submissionId).first<Record<string, unknown>>();
    if (!target) throw new HttpError('Laporan sekolah tidak ditemukan.', 404);
    const data = await body(request); const reason = multiline(data.reason, 500);
    if (!reason) throw new HttpError('Alasan penghapusan laporan sekolah wajib diisi.');
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO integration_school_tombstones
        (submission_id,source_id,epi_year,epi_week,deleted_at,deleted_by,deletion_reason)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET
        deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,deletion_reason=excluded.deletion_reason`)
        .bind(submissionId,target.source_id,target.epi_year,target.epi_week,now(),admin.email,reason),
      env.DB.prepare("DELETE FROM ibs_review_markers WHERE source_id=? AND epi_year=? AND epi_week=? AND target_type='SEKOLAH'")
        .bind(target.source_id, target.epi_year, target.epi_week),
      env.DB.prepare("DELETE FROM routine_revision_log WHERE submission_type='SEKOLAH' AND submission_id=?").bind(submissionId),
      env.DB.prepare('DELETE FROM school_submissions WHERE submission_id=?').bind(submissionId),
      auditStatement(env, admin.email, 'DELETE_SCHOOL_SUBMISSION', 'SCHOOL_SUBMISSION', submissionId, target, {}, reason),
    ]);
    return json({ ok: true });
  }
  if (request.method === 'POST' && path === '/api/admin/ibs/thresholds') {
    const data = await body(request); const type = clean(data.target_type, 20); const code = clean(data.target_code, 40).toUpperCase(); const minimum = Number(data.minimum_value);
    if (!['W2', 'SEKOLAH'].includes(type) || !code || !Number.isFinite(minimum) || minimum < 0) throw new HttpError('Aturan ambang tidak valid.');
    if (type === 'W2') {
      if (!(await env.DB.prepare('SELECT 1 FROM w2_indicators WHERE indicator_code=? AND active=1 AND is_total=0').bind(code).first()))
        throw new HttpError('Pilih indikator W2 aktif yang valid.');
    } else if (code !== 'SICK_PERCENT') {
      throw new HttpError('Indikator sekolah harus menggunakan SICK_PERCENT.');
    }
    const timestamp = now();
    const existing = await env.DB.prepare('SELECT threshold_id,minimum_value,active FROM ibs_thresholds WHERE target_type=? AND target_code=?')
      .bind(type, code).first<{ threshold_id: string; minimum_value: number; active: number }>();
    const thresholdId = existing?.threshold_id || id('THR');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO ibs_thresholds (threshold_id,target_type,target_code,minimum_value,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(target_type,target_code) DO UPDATE SET minimum_value=excluded.minimum_value,active=1,updated_at=excluded.updated_at')
        .bind(thresholdId, type, code, minimum, 1, timestamp, timestamp),
      auditStatement(env, admin.email, existing ? 'UPDATE_IBS_THRESHOLD' : 'CREATE_IBS_THRESHOLD', 'IBS_THRESHOLD', thresholdId,
        existing || {}, { target_type: type, target_code: code, minimum_value: minimum, active: 1 }),
    ]);
    return json({ ok: true });
  }
  if (request.method === 'GET' && path === '/api/admin/ibs/locks') {
    const rows = await env.DB.prepare('SELECT epi_year,epi_week,locked_at,locked_by FROM routine_week_locks ORDER BY epi_year DESC,epi_week DESC').all();
    return json(rows.results);
  }
  if (request.method === 'POST' && path === '/api/admin/ibs/locks') {
    const data = await body(request); const period = periodFrom(data); const timestamp = now();
    const lockId = `${period.year}-W${String(period.week).padStart(2, '0')}`;
    const existing = await env.DB.prepare('SELECT locked_at,locked_by FROM routine_week_locks WHERE epi_year=? AND epi_week=?')
      .bind(period.year, period.week).first<{ locked_at: string; locked_by: string }>();
    await env.DB.batch([
      env.DB.prepare('INSERT OR REPLACE INTO routine_week_locks (epi_year,epi_week,locked_at,locked_by) VALUES(?,?,?,?)').bind(period.year, period.week, timestamp, admin.email),
      auditStatement(env, admin.email, existing ? 'UPDATE_IBS_WEEK_LOCK' : 'CREATE_IBS_WEEK_LOCK', 'IBS_WEEK_LOCK', lockId,
        existing || {}, { epi_year: period.year, epi_week: period.week, locked_at: timestamp, locked_by: admin.email }),
    ]);
    return json({ ok: true });
  }
  if (request.method === 'DELETE' && path === '/api/admin/ibs/locks') {
    const data = await body(request); const period = periodFrom(data); const reason = multiline(data.reason, 500);
    if (!reason) throw new HttpError('Alasan membuka kunci periode wajib diisi.');
    const existing = await env.DB.prepare('SELECT epi_year,epi_week,locked_at,locked_by FROM routine_week_locks WHERE epi_year=? AND epi_week=?')
      .bind(period.year, period.week).first<Record<string, unknown>>();
    if (!existing) throw new HttpError('Periode tersebut tidak sedang terkunci.', 404);
    const lockId = `${period.year}-W${String(period.week).padStart(2, '0')}`;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM routine_week_locks WHERE epi_year=? AND epi_week=?').bind(period.year, period.week),
      auditStatement(env, admin.email, 'UNLOCK_IBS_WEEK', 'IBS_WEEK_LOCK', lockId, existing, {}, reason),
    ]);
    return json({ ok: true });
  }
  return null;
}

export async function handleIbsApi(request: Request, env: Env, session: Session | null, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  if (path.startsWith('/api/admin/ibs/')) return admin(request, env, session, path);
  if (request.method === 'GET' && path === '/api/ibs/me') {
    const routine = requireRoutine(session); const source = await activeSource(env, routine);
    return json({ source_id: source.source_id, source_code: source.source_code, source_name: source.source_name, source_type: source.source_type, network_type: source.network_type, village_code: source.village_code, subvillage_name: source.subvillage_name });
  }
  if (request.method === 'GET' && path === '/api/ibs/w2') return getW2(env, session, url.searchParams);
  if (request.method === 'POST' && path === '/api/ibs/w2') return saveW2(request, env, session, ctx);
  if (request.method === 'GET' && path === '/api/ibs/w2-export') return w2AggregateExport(env, session, url.searchParams);
  const w2Detail = path.match(/^\/api\/ibs\/w2-submissions\/([^/]+)$/);
  if (request.method === 'GET' && w2Detail) return staffW2Detail(env, session, decodeURIComponent(w2Detail[1]));
  if (request.method === 'GET' && path === '/api/ibs/school') return getSchool(env, session, url.searchParams);
  if (request.method === 'POST' && path === '/api/ibs/school') return saveSchool(request, env, session, ctx);
  if (request.method === 'GET' && path === '/api/ibs/school-export') return schoolAggregateExport(env, session, url.searchParams);
  const schoolDetail = path.match(/^\/api\/ibs\/school-submissions\/([^/]+)$/);
  if (request.method === 'GET' && schoolDetail) return staffSchoolDetail(env, session, decodeURIComponent(schoolDetail[1]));
  if (request.method === 'GET' && path === '/api/ibs/dashboard') return dashboard(env, session, url.searchParams);
  const review = path.match(/^\/api\/ibs\/markers\/([^/]+)\/review$/);
  if (request.method === 'POST' && review) {
    const staff = requireStaff(session, 'IBS_REVIEW');
    const data = await body(request);
    const markerId = decodeURIComponent(review[1]);
    const marker = await env.DB.prepare('SELECT marker_id,reviewed_at,reviewed_by,notes FROM ibs_review_markers WHERE marker_id=?')
      .bind(markerId).first<Record<string, unknown>>();
    if (!marker) throw new HttpError('Penanda tidak ditemukan.', 404);
    const reviewedAt = now(); const notes = multiline(data.notes, 500);
    await env.DB.batch([
      env.DB.prepare('UPDATE ibs_review_markers SET reviewed_at=?,reviewed_by=?,notes=? WHERE marker_id=?')
        .bind(reviewedAt, staff.email, notes, markerId),
      auditStatement(env, staff.email, 'REVIEW_IBS_MARKER', 'IBS_REVIEW_MARKER', markerId, marker,
        { reviewed_at: reviewedAt, reviewed_by: staff.email, notes }),
    ]);
    return json({ ok: true });
  }
  return null;
}
