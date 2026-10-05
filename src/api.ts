import {
  base32,
  base64url,
  CURRENT_PASSWORD_ITERATIONS,
  decryptSensitive,
  encryptSensitive,
  passwordHash,
  randomPin,
  randomSalt,
  timingSafeEqual,
  verifyTotp,
} from './crypto';
import {
  activeMasters,
  auditStatement,
  clearLimits,
  getReport,
  historyStatement,
  id,
  limited,
  now,
  pruneRateLimits,
  recordAuthEvent,
  validMaster,
  validMasterCodes,
} from './db';
import { HttpError, body, fail, json } from './http';
import { canManageSurveillance } from './deployment';
import { requireValidReport } from './report-assessment';
import {
  canAccessReport,
  clearCookie,
  cookie,
  minimalReport,
  requireAdmin,
  requireCadre,
  requireStaff,
  registerSession,
  revokeSession,
  safeReport,
  sessionFrom,
} from './session';
import { EVENT_CLOSED_STATUSES, EVENT_TRANSITIONS, PERMISSIONS, REPORT_TRANSITIONS } from './types';
import type { CadreSession, Env, Report, Role } from './types';
import { bool, clean, codeList, date, integer, likePattern, multiline, triage } from './validation';
import type { Priority } from './validation';
import { handleIbsApi, routineLogin } from './ibs';
import { formatAlert, sendTelegram } from './notify';
import { handleSkdklbIntegration } from './integration';
import { publicDiseaseSituation } from './public-snapshots';
import { handleSbm } from './sbm';
import { handleEbs, activeEbsWork } from './ebs';
import { cadreIdentity, cadreProfile, handleCadreProfile } from './cadre-profile';

// 16 zero bytes; used to run a PBKDF2 pass on the "no such account" path so login
// and status lookups take the same time whether or not the identifier exists.
const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA';

const placeholders = (count: number): string => new Array(count).fill('?').join(',');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOCKED_PASSWORD_PARTS = [
  'password', 'qwerty', 'admin123', 'administrator', 'letmein', 'welcome',
  '123456789', '11111111', 'puskesmas', 'indonesia', 'rahasia',
];

function validNewPassword(password: string, email = '', name = ''): boolean {
  const normalized = password.toLocaleLowerCase('id-ID');
  const identityParts = `${email.split('@')[0]} ${name}`.toLocaleLowerCase('id-ID').split(/[^a-z0-9]+/).filter(part => part.length >= 5);
  return password.length >= 15 &&
    !BLOCKED_PASSWORD_PARTS.some(part => normalized.includes(part)) &&
    !identityParts.some(part => normalized.includes(part)) &&
    !/^(.)\1+$/.test(password);
}

const MASTERS_CACHE = 'public, max-age=300';

const CADRE_SIGNAL_EVENT_MAP: Record<string, string> = {
  PERSON_ILLNESS: 'PERSON_ILLNESS',
  FOOD: 'CLUSTER',
  CLUSTER: 'CLUSTER',
  DEATH: 'UNUSUAL_DEATH',
  SCHOOL: 'SCHOOL_WORKPLACE',
  ENV: 'ENVIRONMENTAL',
  ZOONOSIS: 'ANIMAL_EVENT',
  ZOONOSIS_HUMAN: 'PERSON_ILLNESS',
  ANIMAL_EXPOSURE: 'ANIMAL_EXPOSURE',
  OTHER: 'OTHER',
};

const CADRE_SIGNAL_CONTEXT_MAP: Record<string, string> = {
  FOOD: 'SHARED_FOOD',
  SCHOOL: 'SCHOOL_WORKPLACE_CLUSTER',
  ZOONOSIS_HUMAN: 'SICK_DEAD_ANIMAL_CONTACT',
};

const AFFECTED_GROUP_CODES = new Set([
  'NEWBORN',
  'UNDER_FIVE',
  'SCHOOL_AGE',
  'ADULT',
  'OLDER_ADULT',
  'MIXED',
  'ANIMAL',
  'UNKNOWN',
]);

async function attachment(data: Record<string, unknown>): Promise<string | null> {
  const raw = data.attachment;
  if (!raw || typeof raw !== 'object') return null;
  throw new HttpError('Lampiran belum diaktifkan pada deployment ini.');
}

function reportNotificationText(origin: string, report: Report): string {
  const priority = String(report.current_priority);
  const channel = String(report.submission_channel);
  return formatAlert(`${priority === 'TINGGI' ? '⚠️ ' : ''}Laporan ${channel === 'PUBLIC' ? 'warga' : 'kader'} perlu notifikasi segera`, [
    ['Prioritas', priority],
    ['Jenis kejadian', channel === 'PUBLIC' ? report.event_type : report.signal_code],
    ['Desa', report.village_code],
    ['Lokasi', report.location_text],
    ['Terdampak', report.reported_cases_known === 0 ? 'Belum diketahui' : report.reported_cases],
    ['Meninggal', report.reported_deaths_known === 0 ? 'Belum diketahui' : report.reported_deaths],
    ['Kasus berat', Number(report.severe_cases) > 0 ? report.severe_cases : null],
    ['ID', report.report_id],
    ['Tautan', `${origin}/#staff-report/${report.report_id}`],
  ]);
}

async function deliverReportNotification(env: Env, report: Report, origin: string) {
  const attemptedAt = now();
  const delivery = await sendTelegram(env, reportNotificationText(origin, report));
  await env.DB.prepare(
    `UPDATE reports SET notification_status=?,notification_attempts=notification_attempts+1,
       last_notification_attempt_at=?,notification_sent_at=CASE WHEN ?='SENT' THEN ? ELSE notification_sent_at END,
       notification_error=? WHERE report_id=?`
  ).bind(
    delivery.status, attemptedAt, delivery.status, attemptedAt, delivery.error, report.report_id
  ).run();
  return delivery;
}

async function submitReport(
  request: Request,
  env: Env,
  channel: 'PUBLIC' | 'CADRE',
  ctx: ExecutionContext,
  session?: CadreSession
): Promise<Record<string, unknown>> {
  const data = await body(request);
  if (channel === 'PUBLIC') {
    await limited(request, env, 'submit', 5, 900);
    if (clean(data.website, 100)) throw new HttpError('Pengiriman tidak dapat diproses.');
    // Client-measured elapsed time on the form: immune to clock skew between
    // the visitor's device and the server, unlike comparing timestamps.
    if (Number(data.form_elapsed_ms) < 3000) throw new HttpError('Mohon membaca formulir sebelum mengirim.');
    if (!bool(data.privacy_consent)) throw new HttpError('Persetujuan privasi wajib diberikan.');
  }

  let signal = clean(data.signal_code, 50);
  let eventType = '';
  let observationCodes: string[] = [];
  let contextCodes: string[] = [];
  let eventTriage: { default_priority: 'RENDAH' | 'SEDANG' | 'TINGGI'; immediate_notification: number } | null = null;
  const village = clean(data.village_code, 50);
  const description = multiline(data.event_description ?? data.description, 2000);
  if (channel === 'PUBLIC') {
    eventType = clean(data.event_type, 50);
    observationCodes = codeList(data.observation_codes, 'Tanda yang terlihat');
    contextCodes = codeList(data.context_codes, 'Konteks kejadian');
    eventTriage = await env.DB.prepare(
      'SELECT default_priority,immediate_notification FROM event_type_master WHERE event_type=? AND active=1'
    )
      .bind(eventType)
      .first<{ default_priority: 'RENDAH' | 'SEDANG' | 'TINGGI'; immediate_notification: number }>();
    if (!eventType || !eventTriage) throw new HttpError('Jenis kejadian tidak tersedia.');
    if (!(await validMasterCodes(env, 'observation_master', 'observation_code', observationCodes)))
      throw new HttpError('Tanda yang terlihat tidak tersedia.');
    if (!(await validMasterCodes(env, 'context_master', 'context_code', contextCodes)))
      throw new HttpError('Konteks kejadian tidak tersedia.');
    if (contextCodes.includes('UNKNOWN_CONTEXT') && contextCodes.length > 1)
      throw new HttpError('Pilihan "Tidak diketahui" tidak dapat digabung dengan konteks lain.');
    if (['PERSON_ILLNESS', 'CLUSTER', 'SCHOOL_WORKPLACE'].includes(eventType) && !observationCodes.length)
      throw new HttpError('Pilih sedikitnya satu tanda yang terlihat.');
    if (eventType === 'ANIMAL_EXPOSURE' && !contextCodes.some((code) => ['ANIMAL_BITE', 'SNAKE_BITE', 'SICK_DEAD_ANIMAL_CONTACT'].includes(code)))
      throw new HttpError('Pilih jenis gigitan atau kontak hewan yang terjadi.');
    if (eventType === 'ANIMAL_EVENT' && !contextCodes.length)
      throw new HttpError('Pilih jenis hewan/unggas atau pilih belum diketahui.');

    // Keep the established signal_code contract for dashboards and linked
    // events. This compatibility value is derived by the server, never chosen
    // as a diagnosis by a resident.
    signal = ({
      PERSON_ILLNESS: 'PERSON_ILLNESS',
      CLUSTER: 'CLUSTER',
      UNUSUAL_DEATH: 'DEATH',
      ANIMAL_EXPOSURE: 'ANIMAL_EXPOSURE',
      ANIMAL_EVENT: 'ZOONOSIS',
      ENVIRONMENTAL: 'ENV',
      SCHOOL_WORKPLACE: 'SCHOOL',
      OTHER: 'OTHER',
    } as Record<string, string>)[eventType] || 'OTHER';
  } else {
    // Accept the retired code during rolling deployments and from tabs that
    // loaded cadre master data before migration 0016. Persist only the neutral
    // replacement so new analytics never reintroduce the legacy category.
    if (signal === 'RABIES') signal = 'ANIMAL_EXPOSURE';
    observationCodes = codeList(data.observation_codes, 'Tanda yang terlihat');
    contextCodes = codeList(data.context_codes, 'Konteks kejadian');
    const impliedContext = CADRE_SIGNAL_CONTEXT_MAP[signal];
    if (impliedContext) {
      contextCodes = contextCodes.filter((code) => code !== 'UNKNOWN_CONTEXT');
      contextCodes = [...new Set([...contextCodes, impliedContext])];
    }
    eventType = CADRE_SIGNAL_EVENT_MAP[signal] || '';
    const validSignal = signal && await validMaster(env, 'signal_master', 'signal_code', signal);
    eventTriage = await env.DB.prepare(
      'SELECT default_priority,immediate_notification FROM event_type_master WHERE event_type=? AND active=1'
    )
      .bind(eventType)
      .first<{ default_priority: 'RENDAH' | 'SEDANG' | 'TINGGI'; immediate_notification: number }>();
    if (!validSignal || !eventType || !eventTriage) throw new HttpError('Jenis sinyal tidak tersedia.');
    if (!(await validMasterCodes(env, 'observation_master', 'observation_code', observationCodes)))
      throw new HttpError('Tanda yang terlihat tidak tersedia.');
    if (!(await validMasterCodes(env, 'context_master', 'context_code', contextCodes)))
      throw new HttpError('Konteks kejadian tidak tersedia.');
    if (contextCodes.includes('UNKNOWN_CONTEXT') && contextCodes.length > 1)
      throw new HttpError('Pilihan "Tidak diketahui" tidak dapat digabung dengan konteks lain.');
    if (['PERSON_ILLNESS', 'CLUSTER', 'SCHOOL_WORKPLACE'].includes(eventType) && !observationCodes.length)
      throw new HttpError('Pilih sedikitnya satu tanda yang terlihat.');
    if (eventType === 'ANIMAL_EXPOSURE' && !contextCodes.some((code) => ['ANIMAL_BITE', 'SNAKE_BITE', 'SICK_DEAD_ANIMAL_CONTACT'].includes(code)))
      throw new HttpError('Pilih jenis gigitan atau kontak hewan yang terjadi.');
    if (eventType === 'ANIMAL_EVENT' && !contextCodes.length)
      throw new HttpError('Pilih jenis hewan/unggas atau pilih belum diketahui.');
  }
  const [observationTriage, contextTriage] = await env.DB.batch([
    env.DB.prepare(
      `SELECT observation_code code,default_priority,immediate_notification
       FROM observation_master WHERE active=1 AND observation_code IN (${placeholders(Math.max(1, observationCodes.length))})`
    ).bind(...(observationCodes.length ? observationCodes : ['__NONE__'])),
    env.DB.prepare(
      `SELECT context_code code,default_priority,immediate_notification
       FROM context_master WHERE active=1 AND context_code IN (${placeholders(Math.max(1, contextCodes.length))})`
    ).bind(...(contextCodes.length ? contextCodes : ['__NONE__'])),
  ]);
  const observationTriageRows = observationTriage.results as Array<{ code: string; default_priority: Priority; immediate_notification: number }>;
  const contextTriageRows = contextTriage.results as Array<{ code: string; default_priority: Priority; immediate_notification: number }>;
  const observationPriorities = Object.fromEntries(observationTriageRows.map(row => [row.code, row.default_priority])) as Record<string, Priority>;
  const contextPriorities = Object.fromEntries(contextTriageRows.map(row => [row.code, row.default_priority])) as Record<string, Priority>;
  const masterImmediateNotification = Boolean(
    eventTriage?.immediate_notification
    || observationTriageRows.some(row => Boolean(row.immediate_notification))
    || contextTriageRows.some(row => Boolean(row.immediate_notification))
  );
  if (!village || !(await validMaster(env, 'villages', 'village_code', village)))
    throw new HttpError('Desa/wilayah tidak tersedia.');
  if (!description) throw new HttpError('Ceritakan singkat kejadian yang dilaporkan.');

  const minimumCases = ({
    PERSON_ILLNESS: 1, CLUSTER: 2, UNUSUAL_DEATH: 1,
    ANIMAL_EXPOSURE: 1, ANIMAL_EVENT: 1, SCHOOL_WORKPLACE: 2,
  } as Record<string, number>)[eventType] || 0;
  const casesKnown = !bool(data.estimated_cases_unknown);
  const deathsKnown = !bool(data.estimated_deaths_unknown);
  const hospitalizedKnown = !(channel === 'PUBLIC' && bool(data.hospitalized_cases_unknown)) && !(channel==='CADRE'&&data.hospitalized_cases===undefined);
  const enteredCases = casesKnown ? integer(data.estimated_cases ?? data.reported_cases, 'Jumlah terdampak') : 0;
  const deaths = deathsKnown ? integer(data.estimated_deaths ?? data.reported_deaths, 'Jumlah meninggal') : eventType === 'UNUSUAL_DEATH' ? 1 : 0;
  const severeCases = bool(data.has_severe_case) ? 1 : integer(data.severe_cases, 'Jumlah kasus berat');
  const hospitalizedCases = hospitalizedKnown ? integer(data.hospitalized_cases, 'Jumlah rawat') : 0;
  // Numeric columns retain a conservative lower bound for triage; certainty flags
  // distinguish it from a resident's actual estimate in every downstream view.
  const cases = casesKnown ? enteredCases : Math.max(minimumCases, deaths, severeCases, hospitalizedCases);
  if (casesKnown && deathsKnown && deaths > cases) throw new HttpError('Jumlah meninggal tidak boleh melebihi jumlah terdampak.');
  if (casesKnown && (severeCases > cases || (hospitalizedKnown && hospitalizedCases > cases)))
    throw new HttpError('Jumlah kasus berat atau pasien yang dirawat tidak boleh melebihi jumlah terdampak.');
  if (eventType === 'UNUSUAL_DEATH' && deathsKnown && deaths < 1)
    throw new HttpError('Untuk kematian tidak biasa, isi sedikitnya satu orang meninggal.');
  if (casesKnown && cases < minimumCases)
    throw new HttpError(`Untuk jenis kejadian ini, isi sedikitnya ${minimumCases} orang atau hewan terdampak.`);
  const notifyImmediately = masterImmediateNotification
    || deaths > 0
    || severeCases > 0
    || hospitalizedCases > 0
    || cases >= 5
    || (contextCodes.includes('SHARED_FOOD') && cases >= 2);

  const eventStartDate = date(data.event_start_date);
  if (!eventStartDate) throw new HttpError('Tanggal mulai atau pertama diketahui wajib diisi.');
  const affectedGroup = clean(data.affected_group, 30).toUpperCase();
  if (!AFFECTED_GROUP_CODES.has(affectedGroup)) throw new HttpError('Pilih kelompok yang terdampak.');
  if (eventType === 'ANIMAL_EVENT' && affectedGroup !== 'ANIMAL')
    throw new HttpError('Kelompok terdampak untuk kejadian hewan harus hewan atau unggas.');
  if (eventType !== 'ANIMAL_EVENT' && affectedGroup === 'ANIMAL')
    throw new HttpError('Pilih kelompok manusia yang terdampak.');

  const anonymous = channel === 'PUBLIC' && bool(data.anonymous);
  const allowContact = channel === 'PUBLIC' && bool(data.allow_contact);
  // Do not retain a public phone number unless the resident explicitly opts
  // into follow-up contact, even if a crafted client sends one anyway.
  const reporterPhone = allowContact ? clean(data.reporter_phone, 30) : null;
  let locationText = clean(data.location_text, 300);
  const locationIds={dukuh_id:null as string|null,rw_id:null as string|null,rt_id:null as string|null};
  if(channel==='CADRE'&&['dukuh_id','rw_id','rt_id'].some(key=>data[key]!==undefined)) {
    const labels:string[]=[];let parent:string|null=null;
    for(const [key,level] of [['dukuh_id','DUKUH'],['rw_id','RW'],['rt_id','RT']] as const) {
      const value=clean(data[key],80);if(!value)continue;
      if(level!=='DUKUH'&&!parent)throw new HttpError('Pilih wilayah induk sebelum RW atau RT.');
      const row=await env.DB.prepare('SELECT label,parent_id FROM report_locations WHERE location_id=? AND village_code=? AND level=? AND active=1').bind(value,village,level).first<{label:string;parent_id:string|null}>();
      if(!row||row.parent_id!==parent)throw new HttpError('Pilihan Dukuh/RW/RT tidak sesuai dengan desa atau wilayah induk.');
      locationIds[key]=value;parent=value;labels.push(`${level==='DUKUH'?'Dukuh':level} ${row.label}`);
    }
    locationText=labels.join(' · ')||'Dukuh / RW / RT belum diketahui';
  }
  const latitude = clean(data.latitude, 20);
  const longitude = clean(data.longitude, 20);
  if (channel === 'PUBLIC' && !anonymous && !clean(data.reporter_name, 100))
    throw new HttpError('Nama pelapor wajib diisi atau pilih anonim.');
  if (allowContact && !reporterPhone)
    throw new HttpError('Nomor telepon diperlukan bila bersedia dihubungi.');
  const phoneDigits = reporterPhone?.replace(/\D/g, '') || '';
  if (allowContact && reporterPhone && (!/^\+?[0-9][0-9\s().-]*$/.test(reporterPhone) || phoneDigits.length < 8 || phoneDigits.length > 15))
    throw new HttpError('Nomor telepon tidak valid. Gunakan 8–15 angka.');
  if (Boolean(latitude) !== Boolean(longitude))
    throw new HttpError('Titik lokasi tidak lengkap. Pilih kembali lokasi pada peta.');
  if (channel === 'PUBLIC' && !locationText && !(latitude && longitude) && !(allowContact && reporterPhone))
    throw new HttpError('Tambahkan lokasi kejadian atau nomor telepon agar petugas dapat memverifikasi laporan.');
  if (channel === 'CADRE' && !locationText && !(latitude && longitude))
    throw new HttpError('Tambahkan lokasi kejadian atau pilih titik pada peta.');

  const reportId = id('RPT');
  const triageResult = eventTriage
    ? triage({ ...data, estimated_cases: cases, estimated_deaths: deaths, hospitalized_cases: hospitalizedCases }, {
        eventType,
        basePriority: eventTriage.default_priority,
        observations: observationCodes,
        contexts: contextCodes,
        observationPriorities,
        contextPriorities,
      })
    : triage({ ...data, estimated_cases: cases, estimated_deaths: deaths, hospitalized_cases: hospitalizedCases });
  const pin = randomPin(8);
  const pinSalt = randomSalt();
  const pinHash = await passwordHash(pin, pinSalt);
  const attachmentKey = await attachment(data);
  const timestamp = now();

  const reporter = session
    ? await env.DB.prepare('SELECT * FROM reporters WHERE reporter_id=? AND active=1').bind(session.reporterId).first<Report>()
    : null;
  if (session && !reporter) throw new HttpError('Akun kader tidak aktif.', 403);
  if (reporter && !clean(reporter.nickname, 50))
    throw new HttpError('Lengkapi nama panggilan di Profil Saya sebelum mengirim laporan.');
  const actor = reporter ? `CADRE:${reporter.cadre_code}` : 'PUBLIC';

  const report = {
    report_id: reportId,
    event_id: null,
    submission_channel: channel,
    reporter_type: reporter ? 'CADRE' : 'PUBLIC',
    reporter_id: reporter?.reporter_id ?? null,
    reporter_name: anonymous ? null : (reporter?.name ?? clean(data.reporter_name, 100)),
    reporter_phone: reporter?.phone ?? reporterPhone,
    reporter_verified: reporter ? 1 : 0,
    anonymous: anonymous ? 1 : 0,
    allow_contact: allowContact ? 1 : 0,
    submitted_at: timestamp,
    signal_code: signal,
    event_type: eventType || null,
    village_code: village,
    location_text: locationText,
    ...locationIds,
    event_start_date: eventStartDate,
    reported_cases: cases,
    reported_cases_known: casesKnown ? 1 : 0,
    reported_deaths: deaths,
    reported_deaths_known: deathsKnown ? 1 : 0,
    severe_cases: severeCases,
    severe_cases_known:channel==='CADRE'&&data.severe_cases===undefined&&data.has_severe_case===undefined?0:1,
    hospitalized_cases: hospitalizedCases,
    hospitalized_cases_known: hospitalizedKnown ? 1 : 0,
    affected_group: affectedGroup,
    epidemiological_link: clean(data.epidemiological_link, 500),
    description,
    initial_action: multiline(data.initial_action, 1000),
    contact_person: clean(data.contact_person, 100),
    latitude: latitude ? Number(latitude) : null,
    longitude: longitude ? Number(longitude) : null,
    attachment_key: attachmentKey,
    immediate_notification: notifyImmediately ? 1 : 0,
    notification_status: notifyImmediately ? 'PENDING' : 'NOT_REQUIRED',
    notification_attempts: 0,
    last_notification_attempt_at: null,
    notification_sent_at: null,
    notification_error: null,
    initial_priority: triageResult.priority,
    current_priority: triageResult.priority,
    triage_reason: triageResult.reason,
    triage_rule_version: triageResult.version,
    current_status: 'BARU',
    assigned_to: null,
    public_pin_salt: pinSalt,
    public_pin_hash: pinHash,
    public_pin_iterations: CURRENT_PASSWORD_ITERATIONS,
    created_at: timestamp,
    created_by: actor,
    updated_at: timestamp,
    updated_by: actor,
  };

  if (
    (report.latitude !== null && (!Number.isFinite(report.latitude) || report.latitude < -90 || report.latitude > 90)) ||
    (report.longitude !== null && (!Number.isFinite(report.longitude) || report.longitude < -180 || report.longitude > 180))
  )
    throw new HttpError('Koordinat tidak valid.');

  const columns = Object.keys(report).join(',');
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO reports (${columns}) VALUES(${placeholders(Object.keys(report).length)})`).bind(
      ...Object.values(report)
    ),
    ...observationCodes.map((code) =>
      env.DB.prepare('INSERT INTO report_observations(report_id,observation_code) VALUES(?,?)').bind(reportId, code)
    ),
    ...contextCodes.map((code) =>
      env.DB.prepare('INSERT INTO report_contexts(report_id,context_code) VALUES(?,?)').bind(reportId, code)
    ),
    historyStatement(env, 'REPORT', reportId, null, 'BARU', actor, 'Laporan diterima sistem.'),
    auditStatement(env, actor, 'CREATE_REPORT', 'REPORT', reportId, {}, minimalReport(report), `Laporan dari ${channel}`),
  ]);

  // Immediate alerts are distinct from risk priority. Fire-and-forget (summary
  // only, no reporter name/phone) so messaging outages never block submission.
  const origin = new URL(request.url).origin;
  if (notifyImmediately) {
    ctx.waitUntil(deliverReportNotification(env, report, origin));
  }

  return channel === 'PUBLIC'
    ? { report_id: reportId, pin, priority: triageResult.priority, message: 'Laporan berhasil dikirim. Simpan ID dan PIN Anda.' }
    : { report_id: reportId, priority: triageResult.priority, message: 'Laporan kader berhasil dikirim.' };
}

export async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const session = await sessionFrom(request, env);

  // Opportunistically prune the rate-limit table without blocking the response.
  if (Math.random() < 0.01) ctx.waitUntil(pruneRateLimits(env).catch(() => {}));

  try {
    if (path === '/api/cadre/profile' || path === '/api/cadre/change-pin') return await handleCadreProfile(request, env, session);
    if (path.startsWith('/api/sbm/')) return await handleSbm(request, env, session);
    if (path.startsWith('/api/ebs/')) return await handleEbs(request, env, session);
    const integrationResponse = await handleSkdklbIntegration(request, env);
    if (integrationResponse) return integrationResponse;

    if (path === '/api/public/disease-situation') return await publicDiseaseSituation(request, env);

    if (method === 'GET' && path === '/api/public/masters')
      return json(await activeMasters(env), 200, { 'cache-control': MASTERS_CACHE });

    if (method === 'GET' && path === '/api/public/reporter-accounts') {
      const institutions = await env.DB.prepare(
        `SELECT source_code,source_name,source_type,village_code
         FROM routine_sources WHERE active=1 AND COALESCE(integration_only,0)=0 ORDER BY source_type,source_name`
      ).all();
      return json({ institutions: institutions.results }, 200, { 'cache-control': MASTERS_CACHE });
    }

    if (method === 'POST' && path === '/api/public/reports') return json(await submitReport(request, env, 'PUBLIC', ctx), 201);

    // `await` is load-bearing: without it a rejected promise escapes this try
    // block and surfaces as a raw 500 instead of the HttpError's status.
    if (method === 'POST' && path === '/api/auth/ibs-login') return await routineLogin(request, env);

    if (path.startsWith('/api/ibs/') || path.startsWith('/api/admin/ibs/')) {
      const response = await handleIbsApi(request, env, session, ctx);
      if (response) return response;
    }

    if (method === 'POST' && path === '/api/public/status') {
      await limited(request, env, 'status', 20, 900);
      const data = await body(request);
      const report = await env.DB.prepare('SELECT * FROM reports WHERE report_id=?')
        .bind(clean(data.report_id, 40))
        .first<Report>();
      const salt = report ? String(report.public_pin_salt) : DUMMY_SALT;
      const pin = clean(data.pin, 20);
      const iterations = report ? Number(report.public_pin_iterations || 100000) : CURRENT_PASSWORD_ITERATIONS;
      const candidate = await passwordHash(pin, salt, iterations);
      if (!report || !timingSafeEqual(candidate, String(report.public_pin_hash)))
        throw new HttpError('ID laporan atau PIN tidak sesuai.', 404);
      if (iterations < CURRENT_PASSWORD_ITERATIONS) {
        const upgradedSalt = randomSalt();
        await env.DB.prepare('UPDATE reports SET public_pin_salt=?,public_pin_hash=?,public_pin_iterations=? WHERE report_id=?')
          .bind(upgradedSalt, await passwordHash(pin, upgradedSalt), CURRENT_PASSWORD_ITERATIONS, report.report_id).run();
      }
      return json(minimalReport(report));
    }

    if (method === 'POST' && path === '/api/auth/login') {
      const data = await body(request);
      const email = clean(data.email, 254).toLowerCase();
      const password = String(data.password || '');
      await limited(request, env, 'staff-login', 10, 900, email, 20);
      const user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first<Report>();
      const salt = user ? String(user.password_salt) : DUMMY_SALT;
      const iterations = user ? Number(user.password_iterations || 100000) : CURRENT_PASSWORD_ITERATIONS;
      const candidate = await passwordHash(password, salt, iterations);
      if (!user || !password || !timingSafeEqual(candidate, String(user.password_hash))) {
        await recordAuthEvent(request, env, 'LOGIN_FAILED', 'staff', email || 'unknown');
        return fail('Email atau kata sandi tidak sesuai.', 401);
      }
      if (Number(user.active) !== 1) {
        await clearLimits(request, env, 'staff-login', email);
        await recordAuthEvent(request, env, 'LOGIN_FAILED', 'staff', email, 'Kredensial benar untuk akun nonaktif.');
        return fail('Akun ini tidak aktif. Hubungi administrator instalasi.', 403);
      }
      if (Number(user.mfa_enabled)) {
        const code = String(data.mfa_code || '');
        const encrypted = String(user.mfa_secret_encrypted || '');
        const secret = encrypted ? await decryptSensitive(encrypted, env.PATIENT_DATA_KEY || env.JWT_SECRET) : '';
        if (!secret || !(await verifyTotp(secret, code))) {
          await recordAuthEvent(request, env, 'LOGIN_FAILED', 'staff', email, code ? 'Kode MFA tidak valid.' : 'Kode MFA diperlukan.');
          return json({ error: code ? 'Kode autentikator tidak valid.' : 'Masukkan kode 6 digit dari aplikasi autentikator.', code: 'MFA_REQUIRED' }, 401);
        }
      }
      if (iterations < CURRENT_PASSWORD_ITERATIONS) {
        const upgradedSalt = randomSalt();
        await env.DB.prepare('UPDATE users SET password_salt=?,password_hash=?,password_iterations=?,updated_at=? WHERE user_id=?')
          .bind(upgradedSalt, await passwordHash(password, upgradedSalt), CURRENT_PASSWORD_ITERATIONS, now(), user.user_id).run();
      }
      const token = await registerSession(env,
        {
          kind: 'staff',
          sessionId: crypto.randomUUID(),
          userId: String(user.user_id),
          email: String(user.email),
          role: user.role as Role,
          program: String(user.program || ''),
          sessionVersion: Number(user.session_version),
          exp: Math.floor(Date.now() / 1000) + 28800,
        }
      );
      await clearLimits(request, env, 'staff-login', email);
      await env.DB.prepare('UPDATE users SET last_login_at=?,updated_at=? WHERE user_id=?').bind(now(), now(), user.user_id).run();
      await recordAuthEvent(request, env, 'LOGIN_SUCCESS', 'staff', email, Number(user.mfa_enabled) ? 'MFA diverifikasi.' : 'Login tanpa MFA.');
      return json({ user: { name: user.name, role: user.role, email: user.email } }, 200, { 'set-cookie': cookie(token) });
    }

    if (method === 'POST' && path === '/api/auth/cadre-login') {
      const data = await body(request);
      const code = clean(data.cadre_code, 40).toUpperCase();
      const pin = String(data.pin || '');
      await limited(request, env, 'cadre-login', 10, 900, code, 20);
      const reporter = await env.DB.prepare('SELECT * FROM reporters WHERE cadre_code=?')
        .bind(code)
        .first<Report>();
      const salt = reporter ? String(reporter.pin_salt) : DUMMY_SALT;
      const iterations = reporter ? Number(reporter.pin_iterations || 100000) : CURRENT_PASSWORD_ITERATIONS;
      const candidate = await passwordHash(pin, salt, iterations);
      if (!reporter || !/^\d{6}(?:\d{2})?$/.test(pin) || !timingSafeEqual(candidate, String(reporter.pin_hash))) {
        await recordAuthEvent(request, env, 'LOGIN_FAILED', 'cadre', code || 'unknown');
        return fail('Kode kader atau PIN tidak sesuai.', 401);
      }
      if (Number(reporter.active) !== 1) {
        await clearLimits(request, env, 'cadre-login', code);
        await recordAuthEvent(request, env, 'LOGIN_FAILED', 'cadre', code, 'Kredensial benar untuk akun nonaktif.');
        return fail('Akun kader ini tidak aktif. Hubungi pengelola layanan.', 403);
      }
      if (iterations < CURRENT_PASSWORD_ITERATIONS) {
        const upgradedSalt = randomSalt();
        await env.DB.prepare('UPDATE reporters SET pin_salt=?,pin_hash=?,pin_iterations=?,updated_at=? WHERE reporter_id=?')
          .bind(upgradedSalt, await passwordHash(pin, upgradedSalt), CURRENT_PASSWORD_ITERATIONS, now(), reporter.reporter_id).run();
      }
      const token = await registerSession(env,
        {
          kind: 'cadre',
          sessionId: crypto.randomUUID(),
          reporterId: String(reporter.reporter_id),
          cadreCode: String(reporter.cadre_code),
          sessionVersion: Number(reporter.session_version),
          exp: Math.floor(Date.now() / 1000) + 28800,
        }
      );
      await clearLimits(request, env, 'cadre-login', code);
      await env.DB.prepare('UPDATE reporters SET last_login_at=?,updated_at=? WHERE reporter_id=?').bind(now(), now(), reporter.reporter_id).run();
      await recordAuthEvent(request, env, 'LOGIN_SUCCESS', 'cadre', code);
      return json({ reporter: { name: reporter.name, nickname: reporter.nickname, village_code: reporter.village_code,
        profile_complete: Boolean(clean(reporter.nickname, 50)) } }, 200, {
        'set-cookie': cookie(token),
      });
    }

    if (method === 'POST' && path === '/api/auth/logout') {
      await revokeSession(env, session);
      if (session) {
        const identifier = session.kind === 'staff' ? session.email : session.kind === 'cadre' ? session.cadreCode : session.sourceCode;
        await recordAuthEvent(request, env, 'LOGOUT', session.kind, identifier);
      }
      return json({ ok: true }, 200, { 'set-cookie': clearCookie });
    }

    if (method === 'GET' && path === '/api/auth/mfa') {
      const staff = requireStaff(session, 'DASHBOARD_READ');
      const user = await env.DB.prepare('SELECT mfa_enabled FROM users WHERE user_id=?').bind(staff.userId).first<{ mfa_enabled: number }>();
      return json({ enabled: Number(user?.mfa_enabled) === 1 });
    }
    if (method === 'POST' && path === '/api/auth/mfa/setup') {
      const staff = requireStaff(session, 'DASHBOARD_READ');
      const existing = await env.DB.prepare('SELECT mfa_enabled FROM users WHERE user_id=?').bind(staff.userId).first<{ mfa_enabled: number }>();
      if (Number(existing?.mfa_enabled)) throw new HttpError('MFA sudah aktif. Nonaktifkan dengan kode saat ini sebelum mengatur ulang.', 409);
      const secret = base32(crypto.getRandomValues(new Uint8Array(20)));
      const encrypted = await encryptSensitive(secret, env.PATIENT_DATA_KEY || env.JWT_SECRET);
      await env.DB.prepare('UPDATE users SET mfa_secret_encrypted=?,mfa_enabled=0,updated_at=? WHERE user_id=?')
        .bind(encrypted, now(), staff.userId).run();
      const issuer = env.AUTH_ISSUER?.trim() || 'Survantara';
      return json({ secret, otpauth_uri: `otpauth://totp/${encodeURIComponent(`${issuer}:${staff.email}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30` });
    }
    if (method === 'POST' && path === '/api/auth/mfa/confirm') {
      const staff = requireStaff(session, 'DASHBOARD_READ');
      const data = await body(request);
      const user = await env.DB.prepare('SELECT mfa_secret_encrypted FROM users WHERE user_id=?').bind(staff.userId).first<{ mfa_secret_encrypted: string }>();
      if (!user?.mfa_secret_encrypted) throw new HttpError('Mulai pengaturan autentikator terlebih dahulu.');
      const secret = await decryptSensitive(user.mfa_secret_encrypted, env.PATIENT_DATA_KEY || env.JWT_SECRET);
      if (!(await verifyTotp(secret, String(data.code || '')))) throw new HttpError('Kode autentikator tidak valid.');
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET mfa_enabled=1,updated_at=? WHERE user_id=?').bind(now(), staff.userId),
        env.DB.prepare('UPDATE auth_sessions SET revoked_at=? WHERE account_kind=? AND account_id=? AND session_id<>? AND revoked_at IS NULL')
          .bind(now(), 'staff', staff.userId, staff.sessionId),
      ]);
      await recordAuthEvent(request, env, 'MFA_ENABLED', 'staff', staff.email);
      return json({ enabled: true });
    }
    if (method === 'POST' && path === '/api/auth/mfa/disable') {
      const staff = requireStaff(session, 'DASHBOARD_READ');
      const data = await body(request);
      const user = await env.DB.prepare('SELECT mfa_secret_encrypted,mfa_enabled FROM users WHERE user_id=?').bind(staff.userId).first<{ mfa_secret_encrypted: string; mfa_enabled: number }>();
      if (!user?.mfa_enabled || !user.mfa_secret_encrypted) throw new HttpError('MFA belum aktif.');
      const secret = await decryptSensitive(user.mfa_secret_encrypted, env.PATIENT_DATA_KEY || env.JWT_SECRET);
      if (!(await verifyTotp(secret, String(data.code || '')))) throw new HttpError('Kode autentikator tidak valid.');
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET mfa_secret_encrypted=NULL,mfa_enabled=0,updated_at=? WHERE user_id=?').bind(now(), staff.userId),
        env.DB.prepare('UPDATE auth_sessions SET revoked_at=? WHERE account_kind=? AND account_id=? AND session_id<>? AND revoked_at IS NULL')
          .bind(now(), 'staff', staff.userId, staff.sessionId),
      ]);
      await recordAuthEvent(request, env, 'MFA_DISABLED', 'staff', staff.email);
      return json({ enabled: false });
    }

    if (method === 'GET' && path === '/api/me') {
      if (!session) return fail('Belum masuk.', 401);
      if (session.kind === 'cadre') {
        return json(await cadreProfile(env, session.reporterId));
      }
      if (session.kind === 'routine') {
        const source = await env.DB.prepare('SELECT source_name FROM routine_sources WHERE source_id=?').bind(session.sourceId).first<{ source_name: string }>();
        return json({ kind: 'routine', source_code: session.sourceCode, source_type: session.sourceType, source_name: source?.source_name || session.sourceCode });
      }
      return json({ kind: 'staff', email: session.email, role: session.role, program: session.program, can_manage_surveillance: canManageSurveillance(env, session) });
    }

    if (method === 'POST' && path === '/api/cadre/reports')
      return json(await submitReport(request, env, 'CADRE', ctx, requireCadre(session)), 201);

    if (method === 'GET' && path === '/api/cadre/reports') {
      const cadre = requireCadre(session);
      const requestedLimit = Number(url.searchParams.get('limit') || 20);
      const requestedOffset = Number(url.searchParams.get('offset') || 0);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || !Number.isInteger(requestedOffset) || requestedOffset < 0)
        throw new HttpError('Parameter daftar laporan tidak valid.');
      const limit = Math.min(requestedLimit, 50);
      const view = clean(url.searchParams.get('view') || 'all', 20);
      if (!['all','pending','review','closed'].includes(view)) throw new HttpError('Filter riwayat tidak valid.');
      const pending = "EXISTS(SELECT 1 FROM sbm_clarifications c WHERE c.report_id=reports.report_id AND c.answered_at IS NULL) AND reports.workflow_status<>'CLOSED'";
      const filter = view==='pending'?` AND (${pending})`:view==='review'?" AND reports.workflow_status<>'CLOSED'":view==='closed'?" AND reports.workflow_status='CLOSED'":'';
      const order = `CASE WHEN ${pending} THEN 0 ELSE 1 END,reports.submitted_at DESC,reports.report_id DESC`;
      const focusReport=clean(url.searchParams.get('focus_report'),80);
      let offset=requestedOffset;
      if (focusReport) {
        const focused=await env.DB.prepare(`SELECT position FROM (SELECT report_id,ROW_NUMBER() OVER (ORDER BY ${order})-1 position
          FROM reports WHERE reporter_id=?${filter}) WHERE report_id=?`).bind(cadre.reporterId,focusReport).first<{position:number}>();
        if (focused) offset=Math.floor(focused.position/limit)*limit;
      }
      const [rows, count, summary] = await env.DB.batch([
        env.DB.prepare(
          `SELECT reports.report_id,reports.signal_code,signal_master.cadre_definition AS signal_label,
             reports.event_type,reports.village_code,villages.village_name,reports.location_text,reports.event_start_date,
             reports.reported_cases,reports.reported_cases_known,reports.reported_deaths,reports.reported_deaths_known,
             reports.severe_cases,reports.severe_cases_known,reports.hospitalized_cases,reports.hospitalized_cases_known,reports.affected_group,
             reports.description,reports.initial_action,reports.current_priority,reports.current_status,reports.workflow_status,
             reports.submitted_at,reports.updated_at,decisions.outcome AS decision_result,
             (SELECT status FROM report_validations WHERE report_id=reports.report_id) validation_status,
             (SELECT CASE WHEN origin='SIGNAL' THEN 'SIGNAL' ELSE 'INCIDENT' END FROM events WHERE event_id=reports.event_id) contribution_stage,
             (SELECT event_title FROM events WHERE event_id=reports.event_id AND origin='CONFIRMED') incident_title,
             (SELECT COUNT(*) FROM sbm_clarifications c WHERE c.report_id=reports.report_id AND c.answered_at IS NULL) AS pending_clarifications,
             (SELECT GROUP_CONCAT(master.public_label,'|') FROM report_observations selected
                JOIN observation_master master ON master.observation_code=selected.observation_code
                WHERE selected.report_id=reports.report_id) AS observation_labels,
             (SELECT GROUP_CONCAT(master.public_label,'|') FROM report_contexts selected
                JOIN context_master master ON master.context_code=selected.context_code
                WHERE selected.report_id=reports.report_id) AS context_labels
           FROM reports
           LEFT JOIN signal_master ON signal_master.signal_code=reports.signal_code
           LEFT JOIN villages ON villages.village_code=reports.village_code
           LEFT JOIN report_decisions decisions ON decisions.report_id=reports.report_id
           WHERE reports.reporter_id=?${filter}
           ORDER BY ${order} LIMIT ? OFFSET ?`
        ).bind(cadre.reporterId, limit, offset),
        env.DB.prepare(`SELECT COUNT(*) AS count FROM reports WHERE reporter_id=?${filter}`).bind(cadre.reporterId),
        env.DB.prepare(`SELECT COUNT(*) total,
          COALESCE(SUM(CASE WHEN ${pending} THEN 1 ELSE 0 END),0) pending,
          COALESCE(SUM(CASE WHEN workflow_status<>'CLOSED' THEN 1 ELSE 0 END),0) review,
          COALESCE(SUM(CASE WHEN workflow_status='CLOSED' THEN 1 ELSE 0 END),0) closed
          FROM reports WHERE reporter_id=?`).bind(cadre.reporterId),
      ]);
      const total = Number((count.results[0] as { count?: number } | undefined)?.count || 0);
      return json({ rows: rows.results, total, limit, offset, summary: summary.results[0] });
    }

    if (method === 'POST' && path === '/api/bootstrap') {
      const supplied = request.headers.get('x-bootstrap-token') || '';
      const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
      if (!env.BOOTSTRAP_TOKEN || !timingSafeEqual(supplied, env.BOOTSTRAP_TOKEN) || Number(count?.count) !== 0)
        return fail('Bootstrap tidak diizinkan.', 403);
      const data = await body(request);
      const email = clean(data.email, 254).toLowerCase();
      const password = String(data.password || '');
      if (!email || !validNewPassword(password, email, clean(data.name, 100)))
        throw new HttpError('Gunakan kata sandi minimal 15 karakter yang tidak memuat nama, email, atau frasa umum.');
      const salt = randomSalt();
      const user = {
        user_id: id('USR'),
        email,
        name: clean(data.name, 100) || 'Administrator',
        role: 'ADMIN',
        program: '',
        active: 1,
        password_salt: salt,
        password_hash: await passwordHash(password, salt),
        password_iterations: CURRENT_PASSWORD_ITERATIONS,
        created_at: now(),
        updated_at: now(),
      };
      await env.DB.prepare(`INSERT INTO users (${Object.keys(user).join(',')}) VALUES(${placeholders(Object.keys(user).length)})`)
        .bind(...Object.values(user))
        .run();
      return json({ ok: true }, 201);
    }

    if (method === 'POST' && path === '/api/admin/users') {
      const admin = requireAdmin(session);
      const data = await body(request);
      const email = clean(data.email, 254).toLowerCase();
      const name = clean(data.name, 100);
      const password = String(data.password || '');
      const role = clean(data.role, 30) as Role;
      const program = clean(data.program, 100);
      if (!EMAIL_PATTERN.test(email) || !name || !validNewPassword(password, email, name) || !Object.prototype.hasOwnProperty.call(PERMISSIONS, role))
        throw new HttpError('Isi nama, email, peran yang valid, serta kata sandi aman minimal 15 karakter. Hindari nama, email, atau frasa umum.');
      if (role === 'PETUGAS_PROGRAM' && !program) throw new HttpError('Program wajib diisi untuk Petugas Program.');
      if (await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first())
        throw new HttpError('Email petugas sudah digunakan.', 409);
      const salt = randomSalt();
      const user = {
        user_id: id('USR'),
        email,
        name,
        role,
        program: role === 'PETUGAS_PROGRAM' ? program : '',
        active: 1,
        password_salt: salt,
        password_hash: await passwordHash(password, salt),
        password_iterations: CURRENT_PASSWORD_ITERATIONS,
        created_at: now(),
        updated_at: now(),
      };
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO users (${Object.keys(user).join(',')}) VALUES(${placeholders(Object.keys(user).length)})`).bind(
          ...Object.values(user)
        ),
        auditStatement(env, admin.email, 'CREATE_USER', 'USER', user.user_id, {}, { user_id: user.user_id, email, role }),
      ]);
      return json({ user_id: user.user_id }, 201);
    }

    if (method === 'POST' && path === '/api/admin/cadres') {
      const admin = requireAdmin(session);
      const data = await body(request);
      const code = clean(data.cadre_code, 40).toUpperCase();
      const { name, nickname, phone } = cadreIdentity(data);
      const pin = String(data.pin || '');
      const village = clean(data.village_code, 50);
      if (!name || !/^[A-Z0-9-]{3,40}$/.test(code) || !/^\d{6}$/.test(pin) || !(await validMaster(env, 'villages', 'village_code', village)))
        throw new HttpError('Isi nama dan kode kader yang valid, masukkan PIN 6 digit, lalu pilih desa yang aktif.');
      if (await env.DB.prepare('SELECT 1 FROM reporters WHERE cadre_code=?').bind(code).first())
        throw new HttpError('Kode kader sudah digunakan.', 409);
      const salt = randomSalt();
      const reporter = {
        reporter_id: id('CAD'),
        cadre_code: code,
        name,
        nickname,
        phone,
        village_code: village,
        active: 1,
        pin_salt: salt,
        pin_hash: await passwordHash(pin, salt),
        pin_iterations: CURRENT_PASSWORD_ITERATIONS,
        created_at: now(),
        updated_at: now(),
      };
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO reporters (${Object.keys(reporter).join(',')}) VALUES(${placeholders(Object.keys(reporter).length)})`).bind(
          ...Object.values(reporter)
        ),
        auditStatement(env, admin.email, 'CREATE_CADRE', 'REPORTER', reporter.reporter_id, {}, {
          reporter_id: reporter.reporter_id,
          cadre_code: code,
          name, nickname, phone,
          village_code: village,
        }),
      ]);
      return json({ reporter_id: reporter.reporter_id }, 201);
    }

    if (method === 'GET' && path === '/api/admin/users') {
      requireAdmin(session);
      const rows = await env.DB.prepare(
        `SELECT user_id,email,name,role,program,active,mfa_enabled,last_login_at,deactivation_reason,
          (SELECT COUNT(*) FROM auth_sessions sessions WHERE sessions.account_kind='staff' AND sessions.account_id=users.user_id AND sessions.revoked_at IS NULL AND sessions.expires_at>?) AS active_sessions
         FROM users ORDER BY active DESC,role,email`
      ).bind(Math.floor(Date.now() / 1000)).all();
      return json(rows.results);
    }

    const userEditMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (method === 'DELETE' && userEditMatch) {
      const admin = requireAdmin(session);
      const userId = decodeURIComponent(userEditMatch[1]);
      const target = await env.DB.prepare('SELECT user_id,email,name,role,program,active FROM users WHERE user_id=?')
        .bind(userId).first<Record<string, unknown>>();
      if (!target) throw new HttpError('Pengguna tidak ditemukan.', 404);
      const data = await body(request); const reason = multiline(data.reason, 500);
      if (!reason) throw new HttpError('Alasan penghapusan petugas wajib diisi.');
      if (String(target.email) === admin.email) throw new HttpError('Anda tidak dapat menghapus akun yang sedang digunakan.');
      if (String(target.role) === 'ADMIN' && Number(target.active)) {
        const remaining = await env.DB.prepare("SELECT COUNT(*) count FROM users WHERE role='ADMIN' AND active=1 AND user_id<>?")
          .bind(userId).first<{ count: number }>();
        if (!Number(remaining?.count || 0)) throw new HttpError('Administrator aktif terakhir tidak dapat dihapus.', 409);
      }
      await env.DB.batch([
        env.DB.prepare('DELETE FROM users WHERE user_id=?').bind(userId),
        auditStatement(env, admin.email, 'DELETE_USER', 'USER', userId, target, {}, reason),
      ]);
      return json({ ok: true });
    }
    if (method === 'PATCH' && userEditMatch) {
      const admin = requireAdmin(session);
      const userId = decodeURIComponent(userEditMatch[1]);
      const target = await env.DB.prepare('SELECT user_id,email,name,role,program,active FROM users WHERE user_id=?')
        .bind(userId).first<Record<string, unknown>>();
      if (!target) throw new HttpError('Pengguna tidak ditemukan.', 404);
      const data = await body(request);
      const email = clean(data.email, 254).toLowerCase();
      const name = clean(data.name, 100);
      const role = clean(data.role, 30) as Role;
      const programInput = clean(data.program, 100);
      if (!EMAIL_PATTERN.test(email) || !name || !Object.prototype.hasOwnProperty.call(PERMISSIONS, role))
        throw new HttpError('Isi nama dan email yang valid, lalu pilih peran petugas.');
      if (role === 'PETUGAS_PROGRAM' && !programInput) throw new HttpError('Program wajib diisi untuk Petugas Program.');
      const program = role === 'PETUGAS_PROGRAM' ? programInput : '';
      if (await env.DB.prepare('SELECT 1 FROM users WHERE email=? AND user_id<>?').bind(email, userId).first())
        throw new HttpError('Email petugas sudah digunakan.', 409);
      if (String(target.email) === admin.email && (email !== String(target.email) || role !== String(target.role) || program !== String(target.program || '')))
        throw new HttpError('Email, peran, dan program akun yang sedang digunakan tidak dapat diubah dari sesi ini.');
      const sessionBump = email !== String(target.email) || role !== String(target.role) || program !== String(target.program || '') ? 1 : 0;
      const after = { user_id: userId, email, name, role, program, active: target.active };
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET email=?,name=?,role=?,program=?,session_version=session_version+?,updated_at=? WHERE user_id=?')
          .bind(email, name, role, program, sessionBump, now(), userId),
        auditStatement(env, admin.email, 'UPDATE_USER', 'USER', userId, target, after),
      ]);
      return json(after);
    }

    const userStatusMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
    if (method === 'POST' && userStatusMatch) {
      const admin = requireAdmin(session);
      const target = await env.DB.prepare('SELECT user_id,email,active FROM users WHERE user_id=?')
        .bind(decodeURIComponent(userStatusMatch[1]))
        .first<Report>();
      if (!target) throw new HttpError('Pengguna tidak ditemukan.', 404);
      const data = await body(request);
      const active = Number(data.active) === 1 ? 1 : 0;
      const reason = multiline(data.reason, 500);
      if (!active && !reason) throw new HttpError('Alasan penonaktifan petugas wajib diisi.');
      if (!active && String(target.email) === admin.email)
        throw new HttpError('Anda tidak dapat menonaktifkan akun sendiri.');
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET active=?,deactivation_reason=?,session_version=session_version+1,updated_at=? WHERE user_id=?')
          .bind(active, active ? null : reason, now(), target.user_id),
        auditStatement(env, admin.email, 'UPDATE_USER_STATUS', 'USER', String(target.user_id), {
          active: target.active,
        }, { active }, reason),
      ]);
      return json({ ok: true });
    }

    const userResetMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
    if (method === 'POST' && userResetMatch) {
      const admin = requireAdmin(session);
      const target = await env.DB.prepare('SELECT user_id,email,name FROM users WHERE user_id=?')
        .bind(decodeURIComponent(userResetMatch[1]))
        .first<Report>();
      if (!target) throw new HttpError('Pengguna tidak ditemukan.', 404);
      const data = await body(request);
      const password = String(data.password || '');
      if (!validNewPassword(password, String(target.email), String(target.name || '')))
        throw new HttpError('Kata sandi baru minimal 15 karakter dan tidak boleh memuat nama, email, atau frasa umum.');
      const salt = randomSalt();
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET password_salt=?,password_hash=?,password_iterations=?,session_version=session_version+1,updated_at=? WHERE user_id=?').bind(
          salt,
          await passwordHash(password, salt),
          CURRENT_PASSWORD_ITERATIONS,
          now(),
          target.user_id
        ),
        auditStatement(env, admin.email, 'RESET_PASSWORD', 'USER', String(target.user_id), {}, {}),
      ]);
      return json({ ok: true });
    }

    const userMfaResetMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/reset-mfa$/);
    if (method === 'POST' && userMfaResetMatch) {
      const admin = requireAdmin(session);
      const target = await env.DB.prepare('SELECT user_id,email,mfa_enabled FROM users WHERE user_id=?')
        .bind(decodeURIComponent(userMfaResetMatch[1])).first<Report>();
      if (!target) throw new HttpError('Pengguna tidak ditemukan.', 404);
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET mfa_secret_encrypted=NULL,mfa_enabled=0,session_version=session_version+1,updated_at=? WHERE user_id=?')
          .bind(now(), target.user_id),
        auditStatement(env, admin.email, 'RESET_MFA', 'USER', String(target.user_id), { enabled: target.mfa_enabled }, { enabled: 0 }),
      ]);
      return json({ ok: true });
    }

    const userSessionResetMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/revoke-sessions$/);
    if (method === 'POST' && userSessionResetMatch) {
      const admin = requireAdmin(session);
      const target = await env.DB.prepare('SELECT user_id,email FROM users WHERE user_id=?')
        .bind(decodeURIComponent(userSessionResetMatch[1])).first<Report>();
      if (!target) throw new HttpError('Pengguna tidak ditemukan.', 404);
      if (String(target.user_id) === admin.userId) throw new HttpError('Gunakan tombol Keluar untuk mengakhiri sesi Anda sendiri.');
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET session_version=session_version+1,updated_at=? WHERE user_id=?').bind(now(), target.user_id),
        env.DB.prepare("UPDATE auth_sessions SET revoked_at=? WHERE account_kind='staff' AND account_id=? AND revoked_at IS NULL").bind(now(), target.user_id),
        auditStatement(env, admin.email, 'REVOKE_USER_SESSIONS', 'USER', String(target.user_id), {}, {}),
      ]);
      return json({ ok: true });
    }

    if (method === 'GET' && path === '/api/admin/cadres') {
      requireAdmin(session);
      const rows = await env.DB.prepare(
        `SELECT reporter_id,cadre_code,name,nickname,phone,village_code,active,last_login_at,deactivation_reason,
          (SELECT name FROM posyandu WHERE posyandu_id=reporters.posyandu_id) posyandu_name,
          (SELECT COUNT(*) FROM auth_sessions sessions WHERE sessions.account_kind='cadre' AND sessions.account_id=reporters.reporter_id AND sessions.revoked_at IS NULL AND sessions.expires_at>?) AS active_sessions
         FROM reporters ORDER BY active DESC,cadre_code`
      ).bind(Math.floor(Date.now() / 1000)).all();
      return json(rows.results);
    }

    const cadreEditMatch = path.match(/^\/api\/admin\/cadres\/([^/]+)$/);
    if (method === 'DELETE' && cadreEditMatch) {
      const admin = requireAdmin(session);
      const reporterId = decodeURIComponent(cadreEditMatch[1]);
      const target = await env.DB.prepare('SELECT reporter_id,cadre_code,name,phone,village_code,active FROM reporters WHERE reporter_id=?')
        .bind(reporterId).first<Record<string, unknown>>();
      if (!target) throw new HttpError('Kader tidak ditemukan.', 404);
      const data = await body(request); const reason = multiline(data.reason, 500);
      if (!reason) throw new HttpError('Alasan penghapusan kader wajib diisi.');
      const reportCount = await env.DB.prepare('SELECT COUNT(*) count FROM reports WHERE reporter_id=?')
        .bind(reporterId).first<{ count: number }>();
      await env.DB.batch([
        env.DB.prepare('UPDATE reports SET reporter_id=NULL,reporter_verified=0 WHERE reporter_id=?').bind(reporterId),
        env.DB.prepare('DELETE FROM reporters WHERE reporter_id=?').bind(reporterId),
        auditStatement(env, admin.email, 'DELETE_CADRE', 'REPORTER', reporterId,
          { ...target, retained_reports: Number(reportCount?.count || 0) }, {}, reason),
      ]);
      return json({ ok: true, retained_reports: Number(reportCount?.count || 0) });
    }
    if (method === 'PATCH' && cadreEditMatch) {
      const admin = requireAdmin(session);
      const reporterId = decodeURIComponent(cadreEditMatch[1]);
      const target = await env.DB.prepare('SELECT reporter_id,cadre_code,name,nickname,phone,village_code,active FROM reporters WHERE reporter_id=?')
        .bind(reporterId).first<Record<string, unknown>>();
      if (!target) throw new HttpError('Kader tidak ditemukan.', 404);
      const data = await body(request);
      const code = clean(data.cadre_code, 40).toUpperCase();
      const { name, nickname, phone } = cadreIdentity(data);
      const village = clean(data.village_code, 50);
      if (!name || !/^[A-Z0-9-]{3,40}$/.test(code) || !(await validMaster(env, 'villages', 'village_code', village)))
        throw new HttpError('Isi nama dan kode kader yang valid, lalu pilih desa yang aktif.');
      if (await env.DB.prepare('SELECT 1 FROM reporters WHERE cadre_code=? AND reporter_id<>?').bind(code, reporterId).first())
        throw new HttpError('Kode kader sudah digunakan.', 409);
      const after = { reporter_id: reporterId, cadre_code: code, name, nickname, phone, village_code: village, active: target.active };
      await env.DB.batch([
        env.DB.prepare('UPDATE reporters SET cadre_code=?,name=?,nickname=?,phone=?,village_code=?,session_version=session_version+1,updated_at=? WHERE reporter_id=?')
          .bind(code, name, nickname, phone, village, now(), reporterId),
        auditStatement(env, admin.email, 'UPDATE_CADRE', 'REPORTER', reporterId, target, after),
      ]);
      return json(after);
    }

    const cadreStatusMatch = path.match(/^\/api\/admin\/cadres\/([^/]+)\/status$/);
    if (method === 'POST' && cadreStatusMatch) {
      const admin = requireAdmin(session);
      const target = await env.DB.prepare('SELECT reporter_id,active FROM reporters WHERE reporter_id=?')
        .bind(decodeURIComponent(cadreStatusMatch[1]))
        .first<Report>();
      if (!target) throw new HttpError('Kader tidak ditemukan.', 404);
      const data = await body(request);
      const active = Number(data.active) === 1 ? 1 : 0;
      const reason = multiline(data.reason, 500);
      if (!active && !reason) throw new HttpError('Alasan penonaktifan kader wajib diisi.');
      await env.DB.batch([
        env.DB.prepare('UPDATE reporters SET active=?,deactivation_reason=?,session_version=session_version+1,updated_at=? WHERE reporter_id=?')
          .bind(active, active ? null : reason, now(), target.reporter_id),
        auditStatement(env, admin.email, 'UPDATE_CADRE_STATUS', 'REPORTER', String(target.reporter_id), {
          active: target.active,
        }, { active }, reason),
      ]);
      return json({ ok: true });
    }

    const cadreResetMatch = path.match(/^\/api\/admin\/cadres\/([^/]+)\/reset-pin$/);
    if (method === 'POST' && cadreResetMatch) {
      const admin = requireAdmin(session);
      const target = await env.DB.prepare('SELECT reporter_id FROM reporters WHERE reporter_id=?')
        .bind(decodeURIComponent(cadreResetMatch[1]))
        .first<Report>();
      if (!target) throw new HttpError('Kader tidak ditemukan.', 404);
      const data = await body(request);
      const pin = String(data.pin || '');
      if (!/^\d{6}$/.test(pin)) throw new HttpError('PIN harus tepat 6 digit.');
      const salt = randomSalt();
      await env.DB.batch([
        env.DB.prepare('UPDATE reporters SET pin_salt=?,pin_hash=?,pin_iterations=?,session_version=session_version+1,updated_at=? WHERE reporter_id=?').bind(
          salt,
          await passwordHash(pin, salt),
          CURRENT_PASSWORD_ITERATIONS,
          now(),
          target.reporter_id
        ),
        auditStatement(env, admin.email, 'RESET_PIN', 'REPORTER', String(target.reporter_id), {}, {}),
      ]);
      return json({ ok: true });
    }

    const cadreSessionResetMatch = path.match(/^\/api\/admin\/cadres\/([^/]+)\/revoke-sessions$/);
    if (method === 'POST' && cadreSessionResetMatch) {
      const admin = requireAdmin(session);
      const target = await env.DB.prepare('SELECT reporter_id,cadre_code FROM reporters WHERE reporter_id=?')
        .bind(decodeURIComponent(cadreSessionResetMatch[1])).first<Report>();
      if (!target) throw new HttpError('Kader tidak ditemukan.', 404);
      await env.DB.batch([
        env.DB.prepare('UPDATE reporters SET session_version=session_version+1,updated_at=? WHERE reporter_id=?').bind(now(), target.reporter_id),
        env.DB.prepare("UPDATE auth_sessions SET revoked_at=? WHERE account_kind='cadre' AND account_id=? AND revoked_at IS NULL").bind(now(), target.reporter_id),
        auditStatement(env, admin.email, 'REVOKE_CADRE_SESSIONS', 'REPORTER', String(target.reporter_id), {}, {}),
      ]);
      return json({ ok: true });
    }

    if (method === 'GET' && path === '/api/dashboard') {
      const staff = requireStaff(session, 'DASHBOARD_READ');
      const scope =
        staff.role === 'VERIFIKATOR'
          ? ' WHERE assigned_to=?'
          : staff.role === 'PETUGAS_PROGRAM'
            ? ' WHERE event_id IN (SELECT event_id FROM events WHERE program_owner=?)'
            : '';
      const binds =
        staff.role === 'VERIFIKATOR' ? [staff.email] : staff.role === 'PETUGAS_PROGRAM' ? [staff.program || ''] : [];
      const [reports, activeEvents] = await env.DB.batch([
        env.DB.prepare(`SELECT workflow_status,current_status,current_priority,immediate_notification,notification_status,
          ${activeEbsWork('reports')} active_work,COUNT(*) count
          FROM reports${scope} GROUP BY workflow_status,current_status,current_priority,immediate_notification,notification_status,active_work`).bind(
          ...binds
        ),
        env.DB.prepare(
          `SELECT COUNT(*) count FROM events WHERE origin='CONFIRMED' AND current_status NOT IN ('SELESAI','DIBATALKAN')${staff.role === 'PETUGAS_PROGRAM' ? ' AND program_owner=?' : ''}`
        ).bind(...(staff.role === 'PETUGAS_PROGRAM' ? [staff.program || ''] : [])),
      ]);
      const reportSummary = reports.results as Array<Record<string, unknown>>;
      return json({
        reports: reportSummary,
        notification_attention_reports: reportSummary
          .filter(row => Number(row.immediate_notification) === 1 && String(row.notification_status) !== 'SENT')
          .reduce((sum, row) => sum + Number(row.count || 0), 0),
        pending_reports: reportSummary.filter(row => Number(row.active_work) === 1)
          .reduce((sum, row) => sum + Number(row.count || 0), 0),
        active_events: Number((activeEvents.results[0] as Record<string, unknown>)?.count || 0),
      });
    }

    if (method === 'GET' && path === '/api/staff/verifiers') {
      requireStaff(session, 'EVENT_WRITE');
      const rows = await env.DB.prepare(
        "SELECT email,name FROM users WHERE role='VERIFIKATOR' AND active=1 ORDER BY name,email"
      ).all<{ email: string; name: string }>();
      return json(rows.results);
    }

    // Shared WHERE builder for the report list and the CSV export so filters
    // and role scoping can never drift between the two.
    const reportFilters = (staff: { role: Role; email: string; program?: string }) => {
      const query = clean(url.searchParams.get('q'), 100);
      const status = clean(url.searchParams.get('status'), 40);
      const priority = clean(url.searchParams.get('priority'), 20);
      const notification = clean(url.searchParams.get('notification'), 20);
      const dateFrom = date(url.searchParams.get('date_from'));
      const dateTo = date(url.searchParams.get('date_to'));
      const clauses: string[] = [];
      const values: unknown[] = [];
      if (staff.role === 'VERIFIKATOR') {
        clauses.push('assigned_to=?');
        values.push(staff.email);
      }
      if (staff.role === 'PETUGAS_PROGRAM') {
        clauses.push('event_id IN (SELECT event_id FROM events WHERE program_owner=?)');
        values.push(staff.program || '');
      }
      if (status) {
        clauses.push('current_status=?');
        values.push(status);
      }
      if (priority) {
        clauses.push('current_priority=?');
        values.push(priority);
      }
      if (notification === 'ATTENTION') {
        clauses.push("immediate_notification=1 AND notification_status<>'SENT'");
      } else if (notification === 'SENT') {
        clauses.push("notification_status='SENT'");
      }
      if (dateFrom) {
        clauses.push('submitted_at>=?');
        values.push(dateFrom);
      }
      if (dateTo) {
        // submitted_at is ISO 8601, so "next day" makes the end date inclusive.
        clauses.push('submitted_at<?');
        values.push(new Date(Date.parse(`${dateTo}T00:00:00Z`) + 86400000).toISOString().slice(0, 10));
      }
      if (query) {
        clauses.push("(report_id LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
        values.push(likePattern(query), likePattern(query));
      }
      return { where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', values };
    };

    if (method === 'GET' && path === '/api/reports') {
      const staff = requireStaff(session, 'REPORT_READ');
      const { where, values } = reportFilters(staff);
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 250);
      const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
      const [rows, count] = await env.DB.batch([
        env.DB.prepare(`SELECT reports.*,
          (SELECT public_label FROM event_type_master WHERE event_type=reports.event_type) AS event_type_label
          FROM reports${where} ORDER BY submitted_at DESC LIMIT ${limit} OFFSET ${offset}`).bind(...values),
        env.DB.prepare(`SELECT COUNT(*) count FROM reports${where}`).bind(...values),
      ]);
      return json({
        rows: (rows.results as Report[]).map((report) => ({
          ...safeReport(report, staff.role),
          can_open_detail: canAccessReport(staff, report),
        })),
        total: Number((count.results[0] as Record<string, unknown>)?.count || 0),
        limit,
        offset,
      });
    }

    if (method === 'GET' && path === '/api/reports.csv') {
      const staff = requireStaff(session, 'REPORT_READ');
      const { where, values } = reportFilters(staff);
      const rows = await env.DB.prepare(`SELECT reports.*,
          (SELECT public_label FROM event_type_master WHERE event_type=reports.event_type) AS event_type_label,
          (SELECT disease_name FROM ebs_disease_master WHERE ebs_id=reports.verified_ebs_id) AS verified_ebs_name,
          (SELECT GROUP_CONCAT(observation_code, ';') FROM report_observations WHERE report_id=reports.report_id) AS observation_codes,
          (SELECT GROUP_CONCAT(context_code, ';') FROM report_contexts WHERE report_id=reports.report_id) AS context_codes
        FROM reports${where} ORDER BY submitted_at DESC LIMIT 5000`)
        .bind(...values)
        .all<Report>();
      const columns = [
        'report_id', 'submitted_at', 'submission_channel', 'reporter_type', 'event_type', 'event_type_label',
        'observation_codes', 'context_codes', 'signal_code', 'verified_ebs_id', 'verified_ebs_name', 'village_code',
        'location_text', 'event_start_date', 'reported_cases', 'reported_cases_known', 'reported_deaths', 'reported_deaths_known', 'severe_cases', 'severe_cases_known',
        'hospitalized_cases', 'hospitalized_cases_known', 'affected_group', 'immediate_notification', 'notification_status', 'notification_attempts',
        'last_notification_attempt_at', 'notification_sent_at', 'notification_error', 'current_priority', 'current_status',
        'assigned_to', 'event_id', 'description',
      ];
      const cell = (value: unknown): string => {
        const text = value === null || value === undefined ? '' : String(value);
        return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
      };
      const lines = [columns.join(',')];
      for (const row of rows.results) {
        const safe = safeReport(row, staff.role);
        lines.push(columns.map((column) => cell(safe[column])).join(','));
      }
      // BOM so Excel opens the UTF-8 file with Indonesian text intact.
      return new Response('﻿' + lines.join('\r\n'), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="laporan-sbm-${now().slice(0, 10)}.csv"`,
          'cache-control': 'no-store',
        },
      });
    }

    if (method === 'GET' && path === '/api/analytics') {
      const staff = requireStaff(session, 'DASHBOARD_READ');
      const scopeClauses: string[] = ['submitted_at>=?'];
      const scopeValues: unknown[] = [];
      if (staff.role === 'VERIFIKATOR') {
        scopeClauses.push('assigned_to=?');
        scopeValues.push(staff.email);
      }
      if (staff.role === 'PETUGAS_PROGRAM') {
        scopeClauses.push('event_id IN (SELECT event_id FROM events WHERE program_owner=?)');
        scopeValues.push(staff.program || '');
      }
      // 12 epidemiological weeks of history.
      const cutoff = new Date(Date.now() - 84 * 86400000).toISOString().slice(0, 10);
      const where = (extra = '') => ` WHERE ${[...scopeClauses, ...(extra ? [extra] : [])].join(' AND ')}`;
      const [daily, villages, points] = await env.DB.batch([
        env.DB.prepare(`SELECT substr(submitted_at,1,10) day,submission_channel,event_type,signal_code,
          COALESCE(NULLIF(event_type,''),signal_code) taxonomy_code,
          CASE WHEN submission_channel='CADRE' THEN signal_code ELSE COALESCE(NULLIF(event_type,''),signal_code) END reporting_code,
          COUNT(*) count FROM reports${where()}
          GROUP BY day,submission_channel,event_type,signal_code,taxonomy_code,reporting_code`).bind(cutoff, ...scopeValues),
        env.DB.prepare(`SELECT village_code, COUNT(*) count FROM reports${where()} GROUP BY village_code ORDER BY count DESC`).bind(cutoff, ...scopeValues),
        env.DB.prepare(`SELECT report_id,latitude,longitude,submission_channel,event_type,signal_code,
          COALESCE(NULLIF(event_type,''),signal_code) taxonomy_code,
          CASE WHEN submission_channel='CADRE' THEN signal_code ELSE COALESCE(NULLIF(event_type,''),signal_code) END reporting_code,
          current_priority,current_status,substr(submitted_at,1,10) day
          FROM reports${where('latitude IS NOT NULL AND longitude IS NOT NULL')} ORDER BY submitted_at DESC LIMIT 500`).bind(cutoff, ...scopeValues),
      ]);
      return json({
        since: cutoff,
        daily: daily.results,
        villages: villages.results,
        // VIEWER never receives coordinates (same policy as safeReport).
        points: staff.role === 'VIEWER' ? [] : points.results,
      });
    }

    const notificationRetryMatch = path.match(/^\/api\/reports\/([^/]+)\/notification\/retry$/);
    if (method === 'POST' && notificationRetryMatch) {
      const staff = requireStaff(session, 'REPORT_VERIFY');
      const report = await getReport(env, decodeURIComponent(notificationRetryMatch[1]));
      if (!canAccessReport(staff, report)) throw new HttpError('Anda tidak berwenang membuka laporan ini.', 403);
      if (!Number(report.immediate_notification)) throw new HttpError('Laporan ini tidak memerlukan notifikasi segera.');
      const before = {
        notification_status: report.notification_status,
        notification_attempts: report.notification_attempts,
      };
      const delivery = await deliverReportNotification(env, report, url.origin);
      await auditStatement(env, staff.email, 'RETRY_NOTIFICATION', 'REPORT', String(report.report_id), before, {
        notification_status: delivery.status,
        notification_attempts: Number(report.notification_attempts || 0) + 1,
      }).run();
      return json(delivery);
    }

    const reportMatch = path.match(/^\/api\/reports\/([^/]+)$/);
    if (method === 'GET' && reportMatch) {
      const staff = requireStaff(session, 'REPORT_READ');
      const report = await getReport(env, decodeURIComponent(reportMatch[1]));
      if (!canAccessReport(staff, report)) throw new HttpError('Anda tidak berwenang membuka laporan ini.', 403);
      const [history, verifications, observations, contexts, ebsOptions, ebsSuggestions] = await env.DB.batch([
        env.DB.prepare('SELECT * FROM status_history WHERE entity_type=? AND entity_id=? ORDER BY changed_at DESC').bind(
          'REPORT',
          report.report_id
        ),
        env.DB.prepare('SELECT * FROM verifications WHERE report_id=? ORDER BY verified_at DESC').bind(report.report_id),
        env.DB.prepare(
          `SELECT master.observation_code,master.public_label,master.public_help
           FROM report_observations selected JOIN observation_master master
             ON master.observation_code=selected.observation_code
           WHERE selected.report_id=? ORDER BY master.sort_order`
        ).bind(report.report_id),
        env.DB.prepare(
          `SELECT master.context_code,master.public_label,master.public_help
           FROM report_contexts selected JOIN context_master master ON master.context_code=selected.context_code
           WHERE selected.report_id=? ORDER BY master.sort_order`
        ).bind(report.report_id),
        env.DB.prepare(
          `SELECT ebs_id,disease_name,taxonomy_domain,classification_level,taxonomy_group,auto_suggestible,
             catalog_version,source_authority,source_url,source_published_at,source_artifact_sha256,source_artifact_bytes
           FROM ebs_disease_master WHERE active=1 ORDER BY sort_order`
        ),
        env.DB.prepare(
          `SELECT disease.ebs_id,disease.disease_name,disease.taxonomy_domain,disease.classification_level,
             disease.taxonomy_group,COUNT(*) AS matched_rules,totals.total_rules,disease.suggestion_min_matches
           FROM ebs_mapping_rules rule
           JOIN ebs_disease_master disease ON disease.ebs_id=rule.ebs_id
           JOIN (SELECT ebs_id,COUNT(*) AS total_rules FROM ebs_mapping_rules GROUP BY ebs_id) totals
             ON totals.ebs_id=disease.ebs_id
           WHERE disease.active=1 AND disease.auto_suggestible=1
             AND (
             (rule.trigger_type='EVENT' AND rule.trigger_code=?) OR
             (rule.trigger_type='OBSERVATION' AND EXISTS (
               SELECT 1 FROM report_observations selected
               WHERE selected.report_id=? AND selected.observation_code=rule.trigger_code
             )) OR
             (rule.trigger_type='CONTEXT' AND EXISTS (
               SELECT 1 FROM report_contexts selected
               WHERE selected.report_id=? AND selected.context_code=rule.trigger_code
             ))
           )
           GROUP BY disease.ebs_id,disease.disease_name,disease.taxonomy_domain,disease.classification_level,
             disease.taxonomy_group,disease.sort_order,totals.total_rules,disease.suggestion_min_matches
           HAVING matched_rules >= disease.suggestion_min_matches
           ORDER BY matched_rules DESC,
             CASE disease.classification_level
               WHEN 'SYNDROME' THEN 1 WHEN 'SUSPECT' THEN 2 WHEN 'EXPOSURE' THEN 3
               WHEN 'ANIMAL_SIGNAL' THEN 4 WHEN 'EVENT' THEN 5 ELSE 6
             END,
             disease.sort_order LIMIT 12`
        ).bind(report.event_type || '', report.report_id, report.report_id),
      ]);
      return json({
        report: safeReport(report, staff.role),
        transitions: REPORT_TRANSITIONS[String(report.current_status)] ?? [],
        history: staff.role === 'VIEWER' ? [] : history.results,
        verifications: staff.role === 'VIEWER' ? [] : verifications.results,
        observations: observations.results,
        contexts: contexts.results,
        ebs_options: ebsOptions.results,
        ebs_suggestions: ebsSuggestions.results,
      });
    }

    if (method === 'DELETE' && reportMatch) {
      const admin = requireAdmin(session);
      const reportId = decodeURIComponent(reportMatch[1]);
      const target = await env.DB.prepare(`SELECT report_id,event_id,submission_channel,reporter_type,reporter_id,
        submitted_at,signal_code,event_type,village_code,current_priority,current_status,created_by
        FROM reports WHERE report_id=?`).bind(reportId).first<Record<string, unknown>>();
      if (!target) throw new HttpError('Laporan tidak ditemukan.', 404);
      const data = await body(request); const reason = multiline(data.reason, 500);
      if (!reason) throw new HttpError('Alasan penghapusan laporan wajib diisi.');
      const deletedAt = now();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO integration_report_tombstones(report_id,deleted_at,deleted_by,deletion_reason)
          VALUES(?,?,?,?) ON CONFLICT(report_id) DO UPDATE SET
          deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,deletion_reason=excluded.deletion_reason`)
          .bind(reportId, deletedAt, admin.email, reason),
        env.DB.prepare('DELETE FROM report_observations WHERE report_id=?').bind(reportId),
        env.DB.prepare('DELETE FROM report_contexts WHERE report_id=?').bind(reportId),
        env.DB.prepare('DELETE FROM verifications WHERE report_id=?').bind(reportId),
        env.DB.prepare('DELETE FROM responses WHERE report_id=?').bind(reportId),
        env.DB.prepare("DELETE FROM status_history WHERE entity_type IN ('REPORT','EBS_REPORT') AND entity_id=?").bind(reportId),
        env.DB.prepare('DELETE FROM reports WHERE report_id=?').bind(reportId),
        auditStatement(env, admin.email, 'DELETE_REPORT', 'REPORT', reportId, target, {}, reason),
      ]);
      return json({ ok: true });
    }

    const statusMatch = path.match(/^\/api\/reports\/([^/]+)\/status$/);
    if (method === 'POST' && statusMatch) {
      const staff = requireStaff(session, 'REPORT_VERIFY');
      const report = await getReport(env, decodeURIComponent(statusMatch[1]));
      if (!canAccessReport(staff, report)) throw new HttpError('Anda tidak berwenang mengubah laporan ini.', 403);
      const data = await body(request);
      const next = clean(data.status, 40);
      const notes = multiline(data.notes, 500);
      if(report.reporter_id&&next==='SEDANG_DIVERIFIKASI')await requireValidReport(env,String(report.report_id));
      if (!REPORT_TRANSITIONS[String(report.current_status)]?.includes(next))
        throw new HttpError(`Perubahan status ${report.current_status} ke ${next} tidak diizinkan.`);
      const timestamp = now();
      await env.DB.batch([
        env.DB.prepare('UPDATE reports SET current_status=?,updated_at=?,updated_by=? WHERE report_id=? AND current_status=?').bind(
          next,
          timestamp,
          staff.email,
          report.report_id,
          report.current_status
        ),
        historyStatement(env, 'REPORT', String(report.report_id), String(report.current_status), next, staff.email, notes),
        auditStatement(env, staff.email, 'UPDATE_STATUS', 'REPORT', String(report.report_id), {
          current_status: report.current_status,
        }, { current_status: next }, notes),
      ]);
      return json({ ok: true });
    }

    const verifyMatch = path.match(/^\/api\/reports\/([^/]+)\/verify$/);
    if (method === 'POST' && verifyMatch) {
      const staff = requireStaff(session, 'REPORT_VERIFY');
      const report = await getReport(env, decodeURIComponent(verifyMatch[1]));
      if (!canAccessReport(staff, report)) throw new HttpError('Anda tidak berwenang memverifikasi laporan ini.', 403);
      if(report.reporter_id)await requireValidReport(env,String(report.report_id));
      if (report.current_status !== 'SEDANG_DIVERIFIKASI')
        throw new HttpError('Mulai proses verifikasi terlebih dahulu sebelum menyimpan hasilnya.');
      const data = await body(request);
      const actualCases = integer(data.actual_cases, 'Jumlah kasus aktual');
      const actualDeaths = integer(data.actual_deaths, 'Jumlah meninggal aktual');
      const actualSevereCases = integer(data.actual_severe_cases, 'Jumlah kasus berat aktual');
      const verificationResult = clean(data.verification_result, 30) || 'CONFIRMED';
      if (!['CONFIRMED','NOT_CONFIRMED'].includes(verificationResult)) throw new HttpError('Hasil verifikasi tidak valid.');
      const verifiedEbsId = verificationResult === 'NOT_CONFIRMED' ? null : clean(data.verified_ebs_id, 20);
      if (verificationResult === 'CONFIRMED' && (!verifiedEbsId || !(await validMaster(env, 'ebs_disease_master', 'ebs_id', verifiedEbsId))))
        throw new HttpError('Pilih klasifikasi EBS SKDR yang valid.');
      if (actualDeaths > actualCases || actualSevereCases > actualCases)
        throw new HttpError('Jumlah meninggal atau kasus berat aktual tidak boleh melebihi jumlah kasus aktual.');
      const timestamp = now();
      const item = {
        verification_id: id('VER'),
        report_id: report.report_id,
        event_id: report.event_id,
        verified_at: timestamp,
        verified_by: staff.email,
        verification_method: clean(data.verification_method, 100),
        contact_result: clean(data.contact_result, 100),
        actual_cases: actualCases,
        actual_deaths: actualDeaths,
        actual_severe_cases: actualSevereCases,
        epidemiological_link: clean(data.epidemiological_link, 500),
        affected_population: clean(data.affected_population, 300),
        verification_result: verificationResult,
        recommended_action: multiline(data.recommended_action, 1000),
        notes: multiline(data.notes, 2000),
        verified_ebs_id: verifiedEbsId,
        created_at: timestamp,
      };
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO verifications (${Object.keys(item).join(',')}) VALUES(${placeholders(Object.keys(item).length)})`).bind(
          ...Object.values(item)
        ),
        env.DB.prepare(
          'UPDATE reports SET current_status=?,verified_ebs_id=?,classified_by=?,classified_at=?,updated_at=?,updated_by=? WHERE report_id=?'
        ).bind(
          'TERVERIFIKASI', verifiedEbsId, staff.email, timestamp, timestamp, staff.email, report.report_id
        ),
        historyStatement(env, 'REPORT', String(report.report_id), 'SEDANG_DIVERIFIKASI', 'TERVERIFIKASI', staff.email, item.notes),
        auditStatement(env, staff.email, 'VERIFY_REPORT', 'REPORT', String(report.report_id), {}, {
          verification_id: item.verification_id,
          verified_ebs_id: verifiedEbsId,
          current_status: 'TERVERIFIKASI',
        }, 'Verifikasi dicatat dan laporan ditandai terverifikasi.'),
      ]);
      return json(item, 201);
    }

    const assignMatch = path.match(/^\/api\/reports\/([^/]+)\/assign$/);
    if (method === 'POST' && assignMatch) {
      const staff = requireStaff(session, 'EVENT_WRITE');
      const data = await body(request);
      const assignee = clean(data.assigned_to, 254).toLowerCase();
      const target = await env.DB.prepare('SELECT role FROM users WHERE email=? AND active=1').bind(assignee).first<{ role: Role }>();
      if (!target) throw new HttpError('Petugas tujuan tidak aktif.');
      if (target.role !== 'VERIFIKATOR') throw new HttpError('Laporan hanya dapat ditugaskan kepada verifikator aktif.');
      const report = await getReport(env, decodeURIComponent(assignMatch[1]));
      await env.DB.batch([
        env.DB.prepare('UPDATE reports SET assigned_to=?,updated_at=?,updated_by=? WHERE report_id=?').bind(
          assignee,
          now(),
          staff.email,
          report.report_id
        ),
        auditStatement(env, staff.email, 'ASSIGN_REPORT', 'REPORT', String(report.report_id), {
          assigned_to: report.assigned_to,
        }, { assigned_to: assignee }),
      ]);
      return json({ ok: true });
    }

    if (method === 'GET' && path === '/api/events') {
      const staff = requireStaff(session, 'DASHBOARD_READ');
      const sql =
        staff.role === 'PETUGAS_PROGRAM'
          ? 'SELECT e.*,(SELECT decision FROM sbm_event_assessments s WHERE s.event_id=e.event_id) followup_decision,(SELECT source_revision FROM sbm_event_assessments s WHERE s.event_id=e.event_id) assessed_source_revision FROM events e WHERE program_owner=? ORDER BY created_at DESC LIMIT 250'
          : 'SELECT e.*,(SELECT decision FROM sbm_event_assessments s WHERE s.event_id=e.event_id) followup_decision,(SELECT source_revision FROM sbm_event_assessments s WHERE s.event_id=e.event_id) assessed_source_revision FROM events e ORDER BY created_at DESC LIMIT 250';
      const rows = await env.DB.prepare(sql)
        .bind(...(staff.role === 'PETUGAS_PROGRAM' ? [staff.program || ''] : []))
        .all();
      return json(rows.results);
    }

    if (method === 'POST' && path === '/api/events') {
      const staff = requireStaff(session, 'EVENT_WRITE');
      const data = await body(request);
      const signal = clean(data.verified_signal_code, 50);
      const village = clean(data.village_code, 50);
      const programOwner = clean(data.program_owner, 150);
      if (!clean(data.event_title, 200) || !(await validMaster(env, 'signal_master', 'signal_code', signal)))
        throw new HttpError('Judul atau sinyal event tidak valid.');
      if (village && !(await validMaster(env, 'villages', 'village_code', village)))
        throw new HttpError('Desa event tidak valid.');
      if (!programOwner) throw new HttpError('Program pemilik event wajib diisi.');
      const verifiedCases = integer(data.verified_cases, 'Jumlah kasus');
      const verifiedDeaths = integer(data.verified_deaths, 'Jumlah kematian');
      const verifiedSevereCases = integer(data.verified_severe_cases, 'Jumlah kasus berat');
      if (verifiedDeaths > verifiedCases || verifiedSevereCases > verifiedCases)
        throw new HttpError('Jumlah kematian atau kasus berat tidak boleh melebihi jumlah kasus.');
      const event = {
        event_id: id('EVT'),
        event_title: clean(data.event_title, 200),
        verified_signal_code: signal,
        event_start_date: date(data.event_start_date),
        village_code: village || null,
        location_summary: clean(data.location_summary, 500),
        verified_cases: verifiedCases,
        verified_deaths: verifiedDeaths,
        verified_severe_cases: verifiedSevereCases,
        affected_population: clean(data.affected_population, 300),
        epidemiological_summary: multiline(data.epidemiological_summary, 3000),
        risk_level: ['RENDAH', 'SEDANG', 'TINGGI', 'SANGAT_TINGGI'].includes(clean(data.risk_level, 20))
          ? clean(data.risk_level, 20)
          : 'SEDANG',
        risk_notes: multiline(data.risk_notes, 2000),
        current_status: 'DRAFT',
        lead_investigator: clean(data.lead_investigator, 150) || staff.email,
        program_owner: programOwner,
        created_at: now(),
        created_by: staff.email,
        updated_at: now(),
        updated_by: staff.email,
        closed_at: null,
      };
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO events (${Object.keys(event).join(',')}) VALUES(${placeholders(21)})`).bind(
          ...Object.values(event)
        ),
        historyStatement(env, 'EVENT', event.event_id, null, 'DRAFT', staff.email, 'Event dibuat.'),
        auditStatement(env, staff.email, 'CREATE_EVENT', 'EVENT', event.event_id, {}, {
          event_id: event.event_id,
          current_status: 'DRAFT',
        }),
      ]);
      return json(event, 201);
    }

    const eventDetailMatch = path.match(/^\/api\/events\/([^/]+)$/);
    if (method === 'GET' && eventDetailMatch) {
      const staff = requireStaff(session, 'DASHBOARD_READ');
      const event = await env.DB.prepare('SELECT * FROM events WHERE event_id=?')
        .bind(decodeURIComponent(eventDetailMatch[1]))
        .first<Report>();
      if (!event) throw new HttpError('Event tidak ditemukan.', 404);
      if (staff.role === 'PETUGAS_PROGRAM' && event.program_owner !== (staff.program || ''))
        throw new HttpError('Anda tidak berwenang membuka event ini.', 403);
      const [reports, history] = await env.DB.batch([
        env.DB.prepare(
          'SELECT report_id,signal_code,village_code,location_text,current_priority,current_status,submitted_at FROM reports WHERE event_id=? ORDER BY submitted_at DESC'
        ).bind(event.event_id),
        env.DB.prepare('SELECT * FROM status_history WHERE entity_type=? AND entity_id=? ORDER BY changed_at DESC').bind(
          'EVENT',
          event.event_id
        ),
      ]);
      return json({
        event,
        reports: reports.results,
        history: staff.role === 'VIEWER' ? [] : history.results,
        transitions: event.origin==='SIGNAL' ? [] : EVENT_TRANSITIONS[String(event.current_status)] ?? [],
      });
    }

    if (method === 'DELETE' && eventDetailMatch) {
      const admin = requireAdmin(session);
      const eventId = decodeURIComponent(eventDetailMatch[1]);
      const event = await env.DB.prepare(`SELECT event_id,event_title,verified_signal_code,village_code,current_status,
        program_owner,created_at,created_by FROM events WHERE event_id=?`).bind(eventId).first<Record<string, unknown>>();
      if (!event) throw new HttpError('Event tidak ditemukan.', 404);
      const data = await body(request); const reason = multiline(data.reason, 500);
      if (!reason) throw new HttpError('Alasan penghapusan event wajib diisi.');
      const linked = await env.DB.prepare('SELECT report_id,current_status FROM reports WHERE event_id=?').bind(eventId).all<Record<string, unknown>>();
      const timestamp = now();
      const statements: D1PreparedStatement[] = [
        env.DB.prepare("UPDATE reports SET event_id=NULL,current_status=CASE WHEN current_status='TERKAIT_EVENT' THEN 'TERVERIFIKASI' ELSE current_status END,updated_at=?,updated_by=? WHERE event_id=?")
          .bind(timestamp, admin.email, eventId),
        env.DB.prepare('UPDATE verifications SET event_id=NULL WHERE event_id=?').bind(eventId),
        env.DB.prepare('DELETE FROM responses WHERE event_id=?').bind(eventId),
        env.DB.prepare("DELETE FROM status_history WHERE entity_type='EVENT' AND entity_id=?").bind(eventId),
        env.DB.prepare('DELETE FROM events WHERE event_id=?').bind(eventId),
        auditStatement(env, admin.email, 'DELETE_EVENT', 'EVENT', eventId,
          { ...event, unlinked_reports: linked.results.length }, {}, reason),
      ];
      linked.results.filter(item => item.current_status === 'TERKAIT_EVENT').forEach(item => statements.push(
        historyStatement(env, 'REPORT', String(item.report_id), 'TERKAIT_EVENT', 'TERVERIFIKASI', admin.email,
          `Event ${eventId} dihapus: ${reason}`)
      ));
      await env.DB.batch(statements);
      return json({ ok: true, unlinked_reports: linked.results.length });
    }

    const eventStatusMatch = path.match(/^\/api\/events\/([^/]+)\/status$/);
    if (method === 'POST' && eventStatusMatch) {
      const staff = requireStaff(session, 'EVENT_WRITE');
      const event = await env.DB.prepare('SELECT * FROM events WHERE event_id=?')
        .bind(decodeURIComponent(eventStatusMatch[1]))
        .first<Report>();
      if (!event) throw new HttpError('Event tidak ditemukan.', 404);
      const data = await body(request);
      const next = clean(data.status, 40);
      if(event.origin==='SIGNAL') throw new HttpError('Gunakan penilaian kejadian untuk menentukan tindak lanjut dan penyelesaian.',409);
      const notes = multiline(data.notes, 500);
      if (!EVENT_TRANSITIONS[String(event.current_status)]?.includes(next))
        throw new HttpError(`Perubahan status ${event.current_status} ke ${next} tidak diizinkan.`);
      const timestamp = now();
      await env.DB.batch([
        env.DB.prepare('UPDATE events SET current_status=?,closed_at=?,updated_at=?,updated_by=? WHERE event_id=? AND current_status=?').bind(
          next,
          EVENT_CLOSED_STATUSES.includes(next) ? timestamp : null,
          timestamp,
          staff.email,
          event.event_id,
          event.current_status
        ),
        historyStatement(env, 'EVENT', String(event.event_id), String(event.current_status), next, staff.email, notes),
        auditStatement(env, staff.email, 'UPDATE_STATUS', 'EVENT', String(event.event_id), {
          current_status: event.current_status,
        }, { current_status: next }, notes),
      ]);
      return json({ ok: true });
    }

    const linkMatch = path.match(/^\/api\/reports\/([^/]+)\/event$/);
    if (method === 'POST' && linkMatch) {
      const staff = requireStaff(session, 'EVENT_WRITE');
      const report = await getReport(env, decodeURIComponent(linkMatch[1]));
      const data = await body(request);
      const eventId = clean(data.event_id, 40);
      const decision = await env.DB.prepare('SELECT outcome FROM report_decisions WHERE report_id=?').bind(report.report_id).first<{outcome:string}>();
      const completedConfirmed = report.current_status==='SELESAI' && decision?.outcome==='CONFIRMED';
      if (!report.verified_ebs_id || (!completedConfirmed && !REPORT_TRANSITIONS[String(report.current_status)]?.includes('TERKAIT_EVENT')))
        throw new HttpError('Hanya laporan terkonfirmasi yang dapat dihubungkan ke kejadian.');
      if (report.event_id === eventId) return json({ok:true});
      if (report.event_id) throw new HttpError('Laporan sudah terhubung ke kejadian lain.',409);
      const event = await env.DB.prepare('SELECT * FROM events WHERE event_id=?').bind(eventId).first<Report>();
      if (!event) throw new HttpError('Event tidak ditemukan.', 404);
      if (EVENT_CLOSED_STATUSES.includes(String(event.current_status)))
        throw new HttpError('Event sudah ditutup; laporan tidak dapat ditautkan.');
      const timestamp=now(), next=completedConfirmed?'SELESAI':'TERKAIT_EVENT';
      const linked=await env.DB.batch([
        env.DB.prepare(`UPDATE reports SET event_id=?,current_status=?,updated_at=?,updated_by=? WHERE report_id=? AND current_status=? AND event_id IS NULL
          AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND current_status NOT IN ('SELESAI','DIBATALKAN'))`)
          .bind(eventId,next,timestamp,staff.email,report.report_id,report.current_status,eventId),
        env.DB.prepare(`INSERT INTO status_history(history_id,entity_type,entity_id,old_status,new_status,changed_at,changed_by,notes)
          SELECT ?,'REPORT',?,?,?,?,?,? WHERE changes()>0`)
          .bind(id('HIS'),report.report_id,report.current_status,next,timestamp,staff.email,clean(data.notes,500)),
        env.DB.prepare(`INSERT INTO audit_log(audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes)
          SELECT ?,?,?,'LINK_REPORT_EVENT','REPORT',?,?,?,'Pengaitan laporan tidak membuka kembali keputusan akhir.' WHERE changes()>0`)
          .bind(id('AUD'),timestamp,staff.email,report.report_id,JSON.stringify({event_id:report.event_id}),JSON.stringify({event_id:eventId})),
      ]);
      if (!linked[0].meta.changes) throw new HttpError('Laporan atau kejadian sudah berubah. Muat ulang sebelum menghubungkan.',409);
      return json({ ok: true });
    }

    return fail('Endpoint tidak ditemukan.', 404);
  } catch (error) {
    if (error instanceof HttpError) return fail(error.message, error.status);
    const errorId = crypto.randomUUID();
    console.error('Unhandled API error', { errorId, method, path, error });
    return json({ error: 'Terjadi kesalahan pada server.', error_id: errorId }, 500);
  }
}
