import { digest } from './crypto';
import { HttpError } from './http';
import { clean } from './validation';
import type { Env, Report } from './types';

export const now = (): string => new Date().toISOString();

export const id = (prefix: string): string =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto
    .randomUUID()
    .replaceAll('-', '')
    .slice(0, 12)
    .toUpperCase()}`;

export async function activeMasters(env: Env): Promise<{
  signals: unknown[];
  villages: unknown[];
  event_types: unknown[];
  observations: unknown[];
  contexts: unknown[];
  locations: unknown[];
}> {
  const [signals, villages, eventTypes, observations, contexts, locations] = await env.DB.batch([
    env.DB.prepare(
      'SELECT signal_code,community_label,community_definition,cadre_definition,immediate_notification FROM signal_master WHERE active=1 ORDER BY sort_order'
    ),
    env.DB.prepare('SELECT village_code,village_name,subdistrict FROM villages WHERE active=1 ORDER BY sort_order'),
    env.DB.prepare(
      'SELECT event_type,public_label,public_help,icon_key,immediate_notification FROM event_type_master WHERE active=1 ORDER BY sort_order'
    ),
    env.DB.prepare(
      'SELECT observation_code,public_label,public_help,immediate_notification FROM observation_master WHERE active=1 ORDER BY sort_order'
    ),
    env.DB.prepare('SELECT context_code,public_label,public_help,immediate_notification FROM context_master WHERE active=1 ORDER BY sort_order'),
    env.DB.prepare('SELECT location_id,village_code,parent_id,level,label FROM report_locations WHERE active=1 ORDER BY label'),
  ]);
  return {
    signals: signals.results,
    villages: villages.results,
    event_types: eventTypes.results,
    observations: observations.results,
    contexts: contexts.results,
    locations: locations.results,
  };
}

export async function validMaster(
  env: Env,
  table: 'signal_master' | 'villages' | 'event_type_master' | 'observation_master' | 'context_master' | 'ebs_disease_master',
  key: string,
  value: string
): Promise<boolean> {
  return Boolean(await env.DB.prepare(`SELECT 1 FROM ${table} WHERE ${key}=? AND active=1`).bind(value).first());
}

export async function validMasterCodes(
  env: Env,
  table: 'observation_master' | 'context_master',
  key: 'observation_code' | 'context_code',
  values: string[]
): Promise<boolean> {
  if (!values.length) return true;
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ${table} WHERE ${key} IN (${values.map(() => '?').join(',')}) AND active=1`
  )
    .bind(...values)
    .first<{ count: number }>();
  return Number(result?.count || 0) === values.length;
}

export async function getReport(env: Env, reportId: string): Promise<Report> {
  const report = await env.DB.prepare(
    `SELECT reports.*,events.program_owner,
      (SELECT public_label FROM event_type_master WHERE event_type=reports.event_type) AS event_type_label,
      (SELECT disease_name FROM ebs_disease_master WHERE ebs_id=reports.verified_ebs_id) AS verified_ebs_name
     FROM reports LEFT JOIN events ON events.event_id=reports.event_id WHERE reports.report_id=?`
  ).bind(reportId).first<Report>();
  if (!report) throw new HttpError('Laporan tidak ditemukan.', 404);
  return report;
}

export function auditStatement(
  env: Env,
  actor: string,
  action: string,
  entity: string,
  entityId: string,
  before: unknown,
  after: unknown,
  notes = ''
): D1PreparedStatement {
  return env.DB.prepare(
    'INSERT INTO audit_log (audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes) VALUES(?,?,?,?,?,?,?,?,?)'
  ).bind(id('AUD'), now(), actor, action, entity, entityId, JSON.stringify(before ?? {}), JSON.stringify(after ?? {}), clean(notes, 500));
}

export function historyStatement(
  env: Env,
  entity: string,
  entityId: string,
  oldStatus: string | null,
  newStatus: string,
  actor: string,
  notes = ''
): D1PreparedStatement {
  return env.DB.prepare(
    'INSERT INTO status_history (history_id,entity_type,entity_id,old_status,new_status,changed_at,changed_by,notes) VALUES(?,?,?,?,?,?,?,?)'
  ).bind(id('HIS'), entity, entityId, oldStatus, newStatus, now(), actor, clean(notes, 500));
}

async function consumeLimit(env: Env, key: string, max: number, windowStart: number): Promise<void> {
  const result = await env.DB.prepare(
    `INSERT INTO rate_limits(rate_key,window_start,count) VALUES(?,?,1)
     ON CONFLICT(rate_key) DO UPDATE SET
       window_start=excluded.window_start,
       count=CASE WHEN rate_limits.window_start=excluded.window_start THEN rate_limits.count+1 ELSE 1 END
     RETURNING count`
  ).bind(key, windowStart).first<{ count: number }>();
  if (Number(result?.count || 1) > max) throw new HttpError('Terlalu banyak percobaan. Silakan tunggu beberapa menit.', 429);
}

/** Atomic layered limiter: one budget per caller IP and an optional account-wide budget. */
export async function limited(
  request: Request,
  env: Env,
  action: string,
  max: number,
  seconds: number,
  identifier = '',
  accountMax = max * 2
): Promise<void> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const timestamp = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(timestamp / seconds) * seconds;
  const ipKey = `${action}:ip:${(await digest(`${ip}:${env.JWT_SECRET}`)).slice(0, 24)}`;
  try {
    await consumeLimit(env, ipKey, max, windowStart);
    if (identifier) {
      const accountKey = `${action}:account:${(await digest(`${identifier.toUpperCase()}:${env.JWT_SECRET}`)).slice(0, 24)}`;
      await consumeLimit(env, accountKey, accountMax, windowStart);
    }
  } catch (error) {
    if (identifier && error instanceof HttpError && error.status === 429) {
      const kind = action === 'staff-login' ? 'staff' : action.startsWith('cadre-') ? 'cadre' : 'routine';
      await recordAuthEvent(request, env, 'RATE_LIMITED', kind, identifier, `Batas ${action} tercapai.`);
    }
    throw error;
  }
}

export async function clearLimits(request: Request, env: Env, action: string, identifier = ''): Promise<void> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const keys = [`${action}:ip:${(await digest(`${ip}:${env.JWT_SECRET}`)).slice(0, 24)}`];
  if (identifier) keys.push(`${action}:account:${(await digest(`${identifier.toUpperCase()}:${env.JWT_SECRET}`)).slice(0, 24)}`);
  await env.DB.prepare(`DELETE FROM rate_limits WHERE rate_key IN (${keys.map(() => '?').join(',')})`).bind(...keys).run();
}

export async function recordAuthEvent(
  request: Request,
  env: Env,
  action: 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'RATE_LIMITED' | 'LOGOUT' | 'MFA_ENABLED' | 'MFA_DISABLED',
  kind: 'staff' | 'cadre' | 'routine',
  identifier: string,
  notes = ''
): Promise<void> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const identityHash = (await digest(`${identifier.toUpperCase()}:${env.JWT_SECRET}`)).slice(0, 24);
  const ipHash = (await digest(`${ip}:${env.JWT_SECRET}`)).slice(0, 24);
  await auditStatement(env, 'AUTH', action, 'AUTH_SESSION', identityHash, {}, { kind, ip_hash: ipHash }, notes).run();
}

/** Best-effort pruning of expired rate-limit rows so the table cannot grow unbounded. */
export function pruneRateLimits(env: Env): Promise<unknown> {
  const cutoff = Math.floor(Date.now() / 1000) - 3600;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)').bind(nowSeconds, new Date(Date.now() - 86400000).toISOString()),
  ]);
}
