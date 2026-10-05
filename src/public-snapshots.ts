import { timingSafeEqual } from './crypto';
import { auditStatement, now } from './db';
import { HttpError, json } from './http';
import type { Env } from './types';

const ENDPOINT = '/api/integrations/skdklb/public-snapshots';
const MAX_PAYLOAD_CHARS = 1024 * 1024;
const SCHEMA_VERSION = 1;
const SMALL_CELL_THRESHOLD = 5;
const ACTOR = 'integration:skdklb-publication';
const PUBLIC_CACHE = 'public, max-age=300, stale-while-revalidate=86400';

type JsonObject = Record<string, unknown>;
type Period = { epi_year: number; epi_week: number; start: string; end: string };

function requirePublicationToken(request: Request, env: Env): void {
  const expected = String(env.SKDKLB_PUBLICATION_TOKEN || '');
  if (!expected) throw new HttpError('Penerima snapshot publik belum dikonfigurasi.', 503);
  const authorization = request.headers.get('authorization') || '';
  const received = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!received || !timingSafeEqual(received, expected)) throw new HttpError('Token publikasi tidak valid.', 401);
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(`${label} tidak valid.`);
  return value as JsonObject;
}

function exactKeys(value: JsonObject, allowed: string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).filter(key => !allowedSet.has(key));
  const missing = allowed.filter(key => !(key in value));
  if (unexpected.length || missing.length) throw new HttpError(`${label} tidak sesuai kontrak.`);
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new HttpError(`${label} tidak valid.`);
  return parsed;
}

function text(value: unknown, label: string, pattern: RegExp, maximum = 160): string {
  const parsed = String(value || '').trim();
  if (!parsed || parsed.length > maximum || !pattern.test(parsed)) throw new HttpError(`${label} tidak valid.`);
  return parsed;
}

function date(value: unknown, label: string): string {
  const parsed = text(value, label, /^\d{4}-\d{2}-\d{2}$/, 10);
  if (Number.isNaN(Date.parse(`${parsed}T00:00:00Z`))) throw new HttpError(`${label} tidak valid.`);
  return parsed;
}

function isoTimestamp(value: unknown, label: string): string {
  const parsed = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(parsed) || Number.isNaN(Date.parse(parsed)))
    throw new HttpError(`${label} tidak valid.`);
  return parsed;
}

function validatePeriod(value: unknown, label: string): Period {
  const row = object(value, label);
  exactKeys(row, ['epi_year', 'epi_week', 'start', 'end'], label);
  const period = {
    epi_year: integer(row.epi_year, `${label}.epi_year`, 2020, 2100),
    epi_week: integer(row.epi_week, `${label}.epi_week`, 1, 53),
    start: date(row.start, `${label}.start`),
    end: date(row.end, `${label}.end`),
  };
  const days = (Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${period.start}T00:00:00Z`)) / 86400000;
  if (days !== 6) throw new HttpError(`${label} harus mencakup tujuh hari.`);
  return period;
}

function validateCellCount(row: JsonObject, label: string): { case_count: number | null; count_band: string } {
  const band = String(row.count_band || '');
  if (!['ZERO', 'SUPPRESSED', 'COMPLEMENTARY_SUPPRESSED', 'EXACT'].includes(band)) throw new HttpError(`${label}.count_band tidak valid.`);
  if (band === 'ZERO' && Number(row.case_count) === 0) return { case_count: 0, count_band: band };
  if (band === 'SUPPRESSED' && row.case_count === null) return { case_count: null, count_band: band };
  if (band === 'COMPLEMENTARY_SUPPRESSED' && row.case_count === null) return { case_count: null, count_band: band };
  const count = Number(row.case_count);
  if (band === 'EXACT' && Number.isInteger(count) && count >= SMALL_CELL_THRESHOLD && count <= 1000000)
    return { case_count: count, count_band: band };
  throw new HttpError(`${label} tidak menerapkan perlindungan jumlah kecil.`);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readSnapshot(request: Request): Promise<JsonObject> {
  const raw = await request.text();
  if (raw.length > MAX_PAYLOAD_CHARS) throw new HttpError('Snapshot publik terlalu besar.', 413);
  try { return object(JSON.parse(raw), 'Snapshot'); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError('Snapshot publik bukan JSON yang valid.');
  }
}

async function validateSnapshot(env: Env, snapshot: JsonObject): Promise<{
  normalized: JsonObject;
  snapshotId: string;
  checksum: string;
  generatedAt: string;
  dataThrough: { epi_year: number; epi_week: number; period_end: string };
  windowStart: string;
  windowEnd: string;
  trendCount: number;
  distributionCount: number;
}> {
  exactKeys(snapshot, [
    'schema_version', 'snapshot_id', 'generated_at', 'content_checksum', 'data_through', 'window',
    'privacy', 'methodology', 'villages', 'diseases', 'trend', 'distribution',
  ], 'Snapshot');
  if (Number(snapshot.schema_version) !== SCHEMA_VERSION) throw new HttpError('Versi kontrak snapshot tidak didukung.', 409);
  const snapshotId = text(snapshot.snapshot_id, 'snapshot_id', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 36);
  const generatedAt = isoTimestamp(snapshot.generated_at, 'generated_at');
  const checksum = text(snapshot.content_checksum, 'content_checksum', /^[0-9a-f]{64}$/i, 64).toLowerCase();

  const dataThroughRaw = object(snapshot.data_through, 'data_through');
  exactKeys(dataThroughRaw, ['epi_year', 'epi_week', 'period_end'], 'data_through');
  const dataThrough = {
    epi_year: integer(dataThroughRaw.epi_year, 'data_through.epi_year', 2020, 2100),
    epi_week: integer(dataThroughRaw.epi_week, 'data_through.epi_week', 1, 53),
    period_end: date(dataThroughRaw.period_end, 'data_through.period_end'),
  };

  const windowRaw = object(snapshot.window, 'window');
  exactKeys(windowRaw, ['weeks', 'period_start', 'period_end', 'periods'], 'window');
  if (integer(windowRaw.weeks, 'window.weeks', 1, 52) !== 12) throw new HttpError('Snapshot harus memuat 12 minggu epidemiologi lengkap.');
  const periodsRaw = Array.isArray(windowRaw.periods) ? windowRaw.periods : [];
  if (periodsRaw.length !== 12) throw new HttpError('Daftar periode snapshot tidak lengkap.');
  const periods = periodsRaw.map((period, index) => validatePeriod(period, `window.periods[${index}]`));
  const windowStart = date(windowRaw.period_start, 'window.period_start');
  const windowEnd = date(windowRaw.period_end, 'window.period_end');
  if (periods[0].start !== windowStart || periods.at(-1)?.end !== windowEnd || windowEnd !== dataThrough.period_end)
    throw new HttpError('Batas periode snapshot tidak konsisten.');
  for (let index = 1; index < periods.length; index += 1) {
    const gap = (Date.parse(`${periods[index].start}T00:00:00Z`) - Date.parse(`${periods[index - 1].end}T00:00:00Z`)) / 86400000;
    if (gap !== 1) throw new HttpError('Periode snapshot tidak berurutan.');
  }
  const finalPeriod = periods.at(-1)!;
  if (finalPeriod.epi_year !== dataThrough.epi_year || finalPeriod.epi_week !== dataThrough.epi_week)
    throw new HttpError('Minggu data terakhir tidak konsisten.');

  const privacy = object(snapshot.privacy, 'privacy');
  exactKeys(privacy, ['aggregate_only', 'patient_details_included', 'exact_coordinates_included', 'small_cell_threshold', 'complementary_suppression'], 'privacy');
  if (privacy.aggregate_only !== true || privacy.patient_details_included !== false || privacy.exact_coordinates_included !== false
      || Number(privacy.small_cell_threshold) !== SMALL_CELL_THRESHOLD || privacy.complementary_suppression !== true)
    throw new HttpError('Deklarasi privasi snapshot tidak memenuhi kebijakan.');

  const methodology = object(snapshot.methodology, 'methodology');
  exactKeys(methodology, ['case_definition', 'date_basis', 'location_basis', 'service_area_only', 'current_epidemiological_week_included'], 'methodology');
  if (methodology.case_definition !== 'CONFIRMED_NEW_SKDR_CASE' || methodology.date_basis !== 'visit_date'
      || methodology.location_basis !== 'patient_village' || methodology.service_area_only !== true
      || methodology.current_epidemiological_week_included !== true)
    throw new HttpError('Metodologi snapshot tidak sesuai kontrak.');

  const activeDiseases = await env.DB.prepare(`SELECT disease_code,public_name FROM public_disease_catalog
    WHERE active=1 ORDER BY sort_order`).all<{ disease_code: string; public_name: string }>();
  const diseaseCatalog = new Map(activeDiseases.results.map(row => [row.disease_code, row.public_name]));
  const diseasesRaw = Array.isArray(snapshot.diseases) ? snapshot.diseases : [];
  if (diseasesRaw.length !== diseaseCatalog.size) throw new HttpError('Katalog penyakit snapshot tidak lengkap.', 409);
  const diseaseCodes = new Set<string>();
  const diseases = diseasesRaw.map((value, index) => {
    const row = object(value, `diseases[${index}]`);
    exactKeys(row, ['disease_code', 'disease_name'], `diseases[${index}]`);
    const code = text(row.disease_code, `diseases[${index}].disease_code`, /^[A-Z]{1,3}$/, 3);
    const name = String(row.disease_name || '').trim();
    if (diseaseCodes.has(code) || diseaseCatalog.get(code) !== name) throw new HttpError('Katalog penyakit snapshot tidak cocok.', 409);
    diseaseCodes.add(code);
    return { disease_code: code, disease_name: name };
  });

  const allowedVillagesResult = await env.DB.prepare('SELECT village_code FROM villages WHERE active=1 ORDER BY sort_order').all<{ village_code: string }>();
  const allowedVillages = new Set(allowedVillagesResult.results.map(row => row.village_code));
  const villagesRaw = Array.isArray(snapshot.villages) ? snapshot.villages : [];
  const villageCodes = new Set<string>();
  const villages = villagesRaw.map((value, index) => {
    const code = text(value, `villages[${index}]`, /^[A-Z0-9-]{2,40}$/, 40);
    if (!allowedVillages.has(code) || villageCodes.has(code)) throw new HttpError('Daftar desa snapshot tidak cocok.', 409);
    villageCodes.add(code);
    return code;
  });
  if (!villages.length) throw new HttpError('Snapshot tidak memuat desa.');

  const periodKeys = new Set(periods.map(period => `${period.epi_year}-${period.epi_week}`));
  const trendRaw = Array.isArray(snapshot.trend) ? snapshot.trend : [];
  const trendKeys = new Set<string>();
  const trend = trendRaw.map((value, index) => {
    const row = object(value, `trend[${index}]`);
    exactKeys(row, ['epi_year', 'epi_week', 'disease_code', 'case_count', 'count_band'], `trend[${index}]`);
    const epiYear = integer(row.epi_year, `trend[${index}].epi_year`, 2020, 2100);
    const epiWeek = integer(row.epi_week, `trend[${index}].epi_week`, 1, 53);
    const diseaseCode = text(row.disease_code, `trend[${index}].disease_code`, /^[A-Z]{1,3}$/, 3);
    const key = `${epiYear}-${epiWeek}|${diseaseCode}`;
    if (!periodKeys.has(`${epiYear}-${epiWeek}`) || !diseaseCodes.has(diseaseCode) || trendKeys.has(key))
      throw new HttpError('Sel tren snapshot tidak valid.');
    trendKeys.add(key);
    return { epi_year: epiYear, epi_week: epiWeek, disease_code: diseaseCode, ...validateCellCount(row, `trend[${index}]`) };
  });
  if (trend.length !== periods.length * diseases.length) throw new HttpError('Matriks tren snapshot tidak lengkap.');

  const distributionRaw = Array.isArray(snapshot.distribution) ? snapshot.distribution : [];
  if (distributionRaw.length > 10000) throw new HttpError('Matriks distribusi terlalu besar.', 413);
  const distributionKeys = new Set<string>();
  const distribution = distributionRaw.map((value, index) => {
    const row = object(value, `distribution[${index}]`);
    exactKeys(row, ['epi_year', 'epi_week', 'disease_code', 'village_code', 'case_count', 'count_band'], `distribution[${index}]`);
    const epiYear = integer(row.epi_year, `distribution[${index}].epi_year`, 2020, 2100);
    const epiWeek = integer(row.epi_week, `distribution[${index}].epi_week`, 1, 53);
    const diseaseCode = text(row.disease_code, `distribution[${index}].disease_code`, /^[A-Z]{1,3}$/, 3);
    const villageCode = text(row.village_code, `distribution[${index}].village_code`, /^[A-Z0-9-]{2,40}$/, 40);
    const key = `${epiYear}-${epiWeek}|${diseaseCode}|${villageCode}`;
    if (!periodKeys.has(`${epiYear}-${epiWeek}`) || !diseaseCodes.has(diseaseCode) || !villageCodes.has(villageCode) || distributionKeys.has(key))
      throw new HttpError('Sel distribusi snapshot tidak valid.');
    distributionKeys.add(key);
    return { epi_year: epiYear, epi_week: epiWeek, disease_code: diseaseCode, village_code: villageCode,
      ...validateCellCount(row, `distribution[${index}]`) };
  });
  if (distribution.length !== periods.length * diseases.length * villages.length)
    throw new HttpError('Matriks distribusi snapshot tidak lengkap.');
  const trendByKey = new Map(trend.map(row => [`${row.epi_year}-${row.epi_week}|${row.disease_code}`, row]));
  const distributionByKey = new Map<string, typeof distribution>();
  distribution.forEach(row => {
    const key = `${row.epi_year}-${row.epi_week}|${row.disease_code}`;
    if (!distributionByKey.has(key)) distributionByKey.set(key, []);
    distributionByKey.get(key)!.push(row);
  });
  distributionByKey.forEach((rows, key) => {
    const primary = rows.filter(row => row.count_band === 'SUPPRESSED').length;
    const complementary = rows.filter(row => row.count_band === 'COMPLEMENTARY_SUPPRESSED').length;
    const trendCell = trendByKey.get(key);
    if (complementary && !primary) throw new HttpError('Supresi pembanding tidak memiliki sel jumlah kecil pasangannya.');
    if (trendCell?.count_band === 'EXACT' && primary && primary + complementary < 2)
      throw new HttpError('Jumlah kecil dapat dihitung kembali dari total tren.', 409);
    if (!primary && !complementary && trendCell && ['ZERO', 'EXACT'].includes(trendCell.count_band)) {
      const distributionTotal = rows.reduce((sum, row) => sum + Number(row.case_count || 0), 0);
      if (distributionTotal !== Number(trendCell.case_count || 0)) throw new HttpError('Total tren dan distribusi tidak konsisten.', 409);
    }
  });

  const normalized = {
    schema_version: SCHEMA_VERSION,
    snapshot_id: snapshotId,
    generated_at: generatedAt,
    content_checksum: checksum,
    data_through: dataThrough,
    window: { weeks: 12, period_start: windowStart, period_end: windowEnd, periods },
    privacy,
    methodology,
    villages,
    diseases,
    trend,
    distribution,
  };
  const { snapshot_id: ignoredId, generated_at: ignoredGeneratedAt, content_checksum: ignoredChecksum, ...content } = normalized;
  void ignoredId; void ignoredGeneratedAt; void ignoredChecksum;
  if (await sha256Hex(JSON.stringify(content)) !== checksum) throw new HttpError('Checksum isi snapshot tidak cocok.', 409);
  return { normalized, snapshotId, checksum, generatedAt, dataThrough, windowStart, windowEnd,
    trendCount: trend.length, distributionCount: distribution.length };
}

async function receiveSnapshot(request: Request, env: Env): Promise<Response> {
  const validated = await validateSnapshot(env, await readSnapshot(request));
  const existing = await env.DB.prepare('SELECT snapshot_id,content_checksum,received_at,active FROM public_disease_snapshots WHERE snapshot_id=?')
    .bind(validated.snapshotId).first<{ snapshot_id: string; content_checksum: string; received_at: string; active: number }>();
  if (existing) {
    if (existing.content_checksum !== validated.checksum) throw new HttpError('Snapshot ID sudah digunakan untuk isi yang berbeda.', 409);
    return json({ ok: true, unchanged: true, snapshot_id: existing.snapshot_id, received_at: existing.received_at, active: Boolean(existing.active) });
  }
  const previous = await env.DB.prepare('SELECT snapshot_id FROM public_disease_snapshots WHERE active=1').first<{ snapshot_id: string }>();
  const receivedAt = now();
  await env.DB.batch([
    env.DB.prepare('UPDATE public_disease_snapshots SET active=0 WHERE active=1'),
    env.DB.prepare(`INSERT INTO public_disease_snapshots
      (snapshot_id,schema_version,content_checksum,generated_at,received_at,data_through_year,data_through_week,data_through_end,
       window_start,window_end,active,payload_json,trend_cell_count,distribution_cell_count,previous_snapshot_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).bind(
        validated.snapshotId, SCHEMA_VERSION, validated.checksum, validated.generatedAt, receivedAt,
        validated.dataThrough.epi_year, validated.dataThrough.epi_week, validated.dataThrough.period_end,
        validated.windowStart, validated.windowEnd, JSON.stringify(validated.normalized), validated.trendCount,
        validated.distributionCount, previous?.snapshot_id || null
      ),
    auditStatement(env, ACTOR, 'PUBLISH_PUBLIC_DISEASE_SNAPSHOT', 'PUBLIC_DISEASE_SNAPSHOT', validated.snapshotId,
      { active_snapshot_id: previous?.snapshot_id || null },
      { active_snapshot_id: validated.snapshotId, data_through: validated.dataThrough }),
  ]);
  return json({ ok: true, snapshot_id: validated.snapshotId, received_at: receivedAt,
    data_through: validated.dataThrough, previous_snapshot_id: previous?.snapshot_id || null }, 201);
}

async function status(env: Env): Promise<Response> {
  const active = await env.DB.prepare(`SELECT snapshot_id,content_checksum,generated_at,received_at,data_through_year,data_through_week,
    data_through_end,window_start,window_end,trend_cell_count,distribution_cell_count
    FROM public_disease_snapshots WHERE active=1`).first<Record<string, unknown>>();
  return json({ configured: true, active_snapshot: active || null });
}

export async function publicDiseaseSituation(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') throw new HttpError('Metode tidak didukung.', 405);
  const active = await env.DB.prepare(`SELECT content_checksum,received_at,payload_json
    FROM public_disease_snapshots WHERE active=1`).first<{
      content_checksum: string;
      received_at: string;
      payload_json: string;
    }>();
  if (!active) return json({ available: false }, 200, { 'cache-control': 'public, max-age=60' });

  const etag = `"${active.content_checksum}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': PUBLIC_CACHE } });
  }

  let snapshot: JsonObject;
  try { snapshot = object(JSON.parse(active.payload_json), 'Snapshot aktif'); }
  catch { throw new HttpError('Snapshot publik aktif tidak dapat dibaca.', 503); }

  return json({
    available: true,
    last_updated: active.received_at,
    data_through: snapshot.data_through,
    window: snapshot.window,
    diseases: snapshot.diseases,
    villages: snapshot.villages,
    trend: snapshot.trend,
    distribution: snapshot.distribution,
    privacy: snapshot.privacy,
  }, 200, { etag, 'cache-control': PUBLIC_CACHE });
}

export async function handlePublicSnapshotIntegration(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ENDPOINT && url.pathname !== `${ENDPOINT}/status`) return null;
  requirePublicationToken(request, env);
  if (request.method === 'POST' && url.pathname === ENDPOINT) return receiveSnapshot(request, env);
  if (request.method === 'GET' && url.pathname === `${ENDPOINT}/status`) return status(env);
  throw new HttpError('Metode endpoint publikasi tidak didukung.', 405);
}
