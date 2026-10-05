import { base64url, fromBase64url, hmac, timingSafeEqual } from './crypto';
import { HttpError } from './http';
import { PERMISSIONS, roleHasPermission } from './types';
import type { CadreSession, Env, Report, Role, RoutineSession, Session, StaffSession } from './types';

const encoder = new TextEncoder();

export async function sign(session: Session, secret: string): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify(session)));
  const signature = await hmac(payload, secret);
  return `${payload}.${signature}`;
}

/**
 * Decodes and verifies the session cookie, then confirms the underlying account
 * is still active so a deactivated user/cadre is locked out before the 8-hour
 * token would otherwise expire.
 */
export async function sessionFrom(request: Request, env: Env): Promise<Session | null> {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)sbm_session=([^;]+)/)?.[1];
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!timingSafeEqual(signature, await hmac(payload, env.JWT_SECRET))) return null;
  let session: Session;
  try {
    session = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as Session;
  } catch {
    return null;
  }
  if (!(session.exp > Date.now() / 1000)) return null;
  if (!session.sessionId) return null;
  const registered = await env.DB.prepare(
    'SELECT 1 FROM auth_sessions WHERE session_id=? AND revoked_at IS NULL AND expires_at>?'
  ).bind(session.sessionId, Math.floor(Date.now() / 1000)).first();
  if (!registered) return null;
  if (session.kind === 'staff') {
    const user = await env.DB.prepare('SELECT active,session_version FROM users WHERE user_id=?').bind(session.userId).first<{ active: number; session_version: number }>();
    if (!user || user.active !== 1 || user.session_version !== session.sessionVersion) return null;
  } else if (session.kind === 'cadre') {
    const reporter = await env.DB.prepare('SELECT active,session_version FROM reporters WHERE reporter_id=?')
      .bind(session.reporterId)
      .first<{ active: number; session_version: number }>();
    if (!reporter || reporter.active !== 1 || reporter.session_version !== session.sessionVersion) return null;
  } else {
    const source = await env.DB.prepare('SELECT active,session_version FROM routine_sources WHERE source_id=?')
      .bind(session.sourceId)
      .first<{ active: number; session_version: number }>();
    if (!source || source.active !== 1 || source.session_version !== session.sessionVersion) return null;
  }
  return session;
}

export async function registerSession(env: Env, session: Session): Promise<string> {
  const accountId = session.kind === 'staff' ? session.userId : session.kind === 'cadre' ? session.reporterId : session.sourceId;
  await env.DB.prepare(
    'INSERT INTO auth_sessions(session_id,account_kind,account_id,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,NULL)'
  ).bind(session.sessionId, session.kind, accountId, new Date().toISOString(), session.exp).run();
  return sign(session, env.JWT_SECRET);
}

export async function revokeSession(env: Env, session: Session | null): Promise<void> {
  if (!session?.sessionId) return;
  await env.DB.prepare('UPDATE auth_sessions SET revoked_at=? WHERE session_id=? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), session.sessionId).run();
}

export function cookie(token: string): string {
  return `sbm_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`;
}

export const clearCookie = 'sbm_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';

export function requireStaff(session: Session | null, permission: string): StaffSession {
  if (!session || session.kind !== 'staff') throw new HttpError('Masuk sebagai petugas terlebih dahulu.', 401);
  if (!roleHasPermission(session.role, permission))
    throw new HttpError('Anda tidak memiliki wewenang untuk tindakan ini.', 403);
  return session;
}

export function requireCadre(session: Session | null): CadreSession {
  if (!session || session.kind !== 'cadre') throw new HttpError('Masuk sebagai kader terlebih dahulu.', 401);
  return session;
}

export function requireRoutine(session: Session | null): RoutineSession {
  if (!session || session.kind !== 'routine') throw new HttpError('Masuk sebagai institusi terlebih dahulu.', 401);
  return session;
}

export function requireAdmin(session: Session | null): StaffSession {
  const staff = requireStaff(session, 'DASHBOARD_READ');
  if (staff.role !== 'ADMIN') throw new HttpError('Hanya administrator yang dapat melakukan tindakan ini.', 403);
  return staff;
}

export function canAccessReport(session: StaffSession, report: Report): boolean {
  if (['ADMIN', 'PIMPINAN'].includes(session.role)) return true;
  if (session.role === 'VERIFIKATOR') return report.assigned_to === session.email;
  if (session.role === 'PETUGAS_PROGRAM') return Boolean(report.event_id) && report.program_owner === session.program;
  return false;
}

const MINIMAL_KEYS = [
  'report_id',
  'signal_code',
  'event_type',
  'village_code',
  'event_start_date',
  'immediate_notification',
  'initial_priority',
  'current_priority',
  'current_status',
  'allow_contact',
  'submitted_at',
  'updated_at',
];

export function minimalReport(row: Report): Report {
  return Object.fromEntries(MINIMAL_KEYS.map((key) => [key, row[key] ?? null]));
}

/** Masks reporter identity and sensitive detail according to the viewer's role. */
export function safeReport(row: Report, role: Role): Report {
  const result = { ...row };
  if (role === 'PIMPINAN' || role === 'VIEWER') {
    result.reporter_name = null;
    result.reporter_phone = row.reporter_phone
      ? `${String(row.reporter_phone).slice(0, 3)}***${String(row.reporter_phone).slice(-2)}`
      : null;
    result.contact_person = null;
  }
  if (role === 'VIEWER') {
    result.description = 'Data tersamarkan';
    result.location_text = 'Wilayah tersamarkan';
    result.latitude = null;
    result.longitude = null;
    result.attachment_key = null;
  }
  return result;
}

export { PERMISSIONS };
