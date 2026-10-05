import { CURRENT_PASSWORD_ITERATIONS, passwordHash, randomSalt, timingSafeEqual } from './crypto';
import { auditStatement, clearLimits, id, limited, now } from './db';
import { body, HttpError, json } from './http';
import { cookie, requireCadre, sign } from './session';
import type { Env, Session } from './types';
import { clean } from './validation';

export function cadreIdentity(data: Record<string, unknown>): { name: string; nickname: string; phone: string } {
  const name = clean(data.name, 101);
  const nickname = clean(data.nickname, 51);
  const phone = clean(data.phone, 31);
  if (!name || name.length > 100) throw new HttpError('Nama lengkap wajib diisi, maksimal 100 karakter.');
  if (!nickname || nickname.length > 50) throw new HttpError('Nama panggilan wajib diisi, maksimal 50 karakter.');
  const digits = phone.replace(/\D/g, '');
  if (phone && (phone.length > 30 || !/^\+?[0-9][0-9\s().-]*$/.test(phone) || digits.length < 8 || digits.length > 15))
    throw new HttpError('Isi nomor WhatsApp yang valid (8–15 digit), atau kosongkan bila belum tersedia.');
  return { name, nickname, phone };
}

export async function cadreProfile(env: Env, reporterId: string) {
  const profile = await env.DB.prepare(`SELECT r.cadre_code,r.name,r.nickname,r.phone,r.village_code,
    v.village_name,p.name posyandu_name FROM reporters r
    LEFT JOIN villages v ON v.village_code=r.village_code
    LEFT JOIN posyandu p ON p.posyandu_id=r.posyandu_id
    WHERE r.reporter_id=? AND r.active=1`).bind(reporterId)
    .first<{ cadre_code: string; name: string; nickname: string; phone: string | null;
      village_code: string; village_name: string | null; posyandu_name: string | null }>();
  if (!profile) throw new HttpError('Akun kader tidak aktif.', 403);
  return { kind: 'cadre', ...profile, profile_complete: Boolean(profile.nickname.trim()) };
}

export async function handleCadreProfile(request: Request, env: Env, session: Session | null): Promise<Response> {
  const cadre = requireCadre(session);
  const path = new URL(request.url).pathname;
  if (path === '/api/cadre/profile' && request.method === 'GET')
    return json(await cadreProfile(env, cadre.reporterId));

  if (path === '/api/cadre/profile' && request.method === 'PATCH') {
    const data = await body(request);
    if (Object.keys(data).some(key => !['name', 'nickname', 'phone'].includes(key)))
      throw new HttpError('Anda hanya dapat mengubah nama lengkap, nama panggilan, dan nomor WhatsApp.');
    const identity = cadreIdentity(data);
    const before = await cadreProfile(env, cadre.reporterId);
    await env.DB.batch([
      env.DB.prepare('UPDATE reporters SET name=?,nickname=?,phone=?,updated_at=? WHERE reporter_id=? AND active=1')
        .bind(identity.name, identity.nickname, identity.phone, now(), cadre.reporterId),
      auditStatement(env, `CADRE:${cadre.cadreCode}`, 'UPDATE_OWN_CADRE_PROFILE', 'REPORTER', cadre.reporterId,
        { name: before.name, nickname: before.nickname, phone: before.phone }, identity),
    ]);
    return json(await cadreProfile(env, cadre.reporterId));
  }

  if (path === '/api/cadre/change-pin' && request.method === 'POST') {
    const data = await body(request);
    const oldPin = String(data.current_pin || '');
    const newPin = String(data.new_pin || '');
    if (!/^\d{6}$/.test(newPin)) throw new HttpError('PIN baru harus tepat 6 digit.');
    if (oldPin === newPin) throw new HttpError('PIN baru harus berbeda dari PIN lama.');
    await limited(request, env, 'cadre-change-pin', 5, 900, cadre.cadreCode, 5);
    const target = await env.DB.prepare('SELECT pin_salt,pin_hash,pin_iterations,session_version FROM reporters WHERE reporter_id=? AND active=1')
      .bind(cadre.reporterId).first<{ pin_salt: string; pin_hash: string; pin_iterations: number; session_version: number }>();
    if (!target) throw new HttpError('Akun kader tidak aktif.', 403);
    const candidate = await passwordHash(oldPin, target.pin_salt, target.pin_iterations || 100000);
    if (!/^\d{6}(?:\d{2})?$/.test(oldPin) || !timingSafeEqual(candidate, target.pin_hash))
      throw new HttpError('PIN lama tidak sesuai.');
    const salt = randomSalt();
    const hash = await passwordHash(newPin, salt);
    const timestamp = now();
    const nextVersion = cadre.sessionVersion + 1;
    // A concurrent admin reset/change must not be overwritten. Subsequent
    // statements are gated on this change and run in the same D1 transaction.
    const changed = 'SELECT 1 FROM reporters WHERE reporter_id=? AND pin_hash=? AND session_version=?';
    const [update] = await env.DB.batch([
      env.DB.prepare(`UPDATE reporters SET pin_salt=?,pin_hash=?,pin_iterations=?,session_version=?,updated_at=?
        WHERE reporter_id=? AND active=1 AND pin_hash=? AND session_version=?`)
        .bind(salt, hash, CURRENT_PASSWORD_ITERATIONS, nextVersion, timestamp, cadre.reporterId, target.pin_hash, cadre.sessionVersion),
      env.DB.prepare(`UPDATE auth_sessions SET revoked_at=? WHERE account_kind='cadre' AND account_id=?
        AND session_id<>? AND revoked_at IS NULL AND EXISTS (${changed})`)
        .bind(timestamp, cadre.reporterId, cadre.sessionId, cadre.reporterId, hash, nextVersion),
      env.DB.prepare(`INSERT INTO audit_log (audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes)
        SELECT ?,?,?,?,'REPORTER',?,'{}','{}',? WHERE EXISTS (${changed})`)
        .bind(id('AUD'), timestamp, `CADRE:${cadre.cadreCode}`, 'CHANGE_OWN_CADRE_PIN', cadre.reporterId,
          'PIN diubah oleh pemilik akun; sesi lainnya dicabut.', cadre.reporterId, hash, nextVersion),
    ]);
    if (!update.meta.changes) throw new HttpError('Akses akun berubah. Silakan masuk kembali sebelum mengganti PIN.', 409);
    await clearLimits(request, env, 'cadre-change-pin', cadre.cadreCode);
    // Renew the signed version of the current registered session, preserving
    // its original expiry. PINs, salts and hashes never enter the audit log.
    const token = await sign({ ...cadre, sessionVersion: nextVersion }, env.JWT_SECRET);
    return json({ ok: true }, 200, { 'set-cookie': cookie(token) });
  }
  throw new HttpError('Layanan tidak ditemukan.', 404);
}
