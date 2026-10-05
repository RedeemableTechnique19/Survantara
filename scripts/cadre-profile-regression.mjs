import assert from 'node:assert/strict';

export async function checkCadreProfile({ api, admin, viewer, reportBody, runSql }) {
  const account = { cadre_code: 'PROFILE-CADRE', name: 'Nama Lengkap Kader', nickname: 'Panggilan', phone: '081234567890', village_code: 'DEMO-A', pin: '826491' };
  const create = body => api('/api/admin/cadres', { method: 'POST', cookie: admin, body });
  for (const nickname of [undefined, '', '   ', 'x'.repeat(51)])
    assert.equal((await create({ ...account, nickname })).status, 400, 'Admin creation accepted an empty/overlong nickname');
  const created = await create(account);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const reporterId = created.data.reporter_id;
  const other = await create({ ...account, cadre_code: 'PROFILE-OTHER', nickname: 'Tetangga' });
  assert.equal(other.status, 201);
  const login = async (code = account.cadre_code, pin = account.pin) => {
    const result = await api('/api/auth/cadre-login', { method: 'POST', body: { cadre_code: code, pin } });
    assert.equal(result.status, 200, JSON.stringify(result.data)); return result;
  };
  let session = await login();
  const secondSession = await login();
  const otherSession = await login('PROFILE-OTHER');
  const own = cookie => api('/api/cadre/profile', { cookie });
  const patch = (body, cookie = session.cookie) => api('/api/cadre/profile', { method: 'PATCH', cookie, body });
  const changePin = (body, cookie = session.cookie) => api('/api/cadre/change-pin', { method: 'POST', cookie, body });
  assert.equal((await own()).status, 401);
  assert.equal((await own(admin)).status, 401);
  assert.equal((await own(viewer)).status, 401);
  assert.equal((await patch(account, otherSession.cookie)).status, 400, 'A target identifier bypassed the own-profile allowlist');
  assert.equal((await changePin({ current_pin: account.pin, new_pin: '714628' }, admin)).status, 401);
  let profile = (await own(session.cookie)).data;
  assert.equal(profile.nickname, account.nickname);
  assert.equal(profile.profile_complete, true);
  assert.ok(!Object.keys(profile).some(key => /pin|salt|hash|session/i.test(key)), 'Profile leaked authentication secrets');
  for (const body of [
    { name: '', nickname: 'Nama' }, { name: 'Nama', nickname: '   ' }, { name: 'Nama', nickname: 'x'.repeat(51) },
    { name: 'x'.repeat(101), nickname: 'Nama' }, { name: 'Nama', nickname: 'Nama', phone: 'abc' },
    { name: 'Nama', nickname: 'Nama', phone: '123' }, { name: 'Nama', nickname: 'Nama', phone: '1'.repeat(16) },
  ]) assert.equal((await patch(body)).status, 400, 'Invalid identity was accepted');
  for (const [key, value] of Object.entries({ reporter_id: other.data.reporter_id, cadre_code: 'SPOOF', village_code: 'DEMO-E', posyandu_id: 'SPOOF', active: 0, session_version: 99, pin: '714628' }))
    assert.equal((await patch({ name: 'Nama', nickname: 'Nama', [key]: value })).status, 400, `Cadre changed protected field ${key}`);
  const report = await api('/api/cadre/reports', { method: 'POST', cookie: session.cookie, body: reportBody });
  assert.equal(report.status, 201, JSON.stringify(report.data));
  const updated = await patch({ name: '  Nama   Diperbarui ', nickname: '  Mbak   Ani ', phone: '+62 812-3456-7890' });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.name, 'Nama Diperbarui'); assert.equal(updated.data.nickname, 'Mbak Ani');
  assert.equal(updated.data.cadre_code, account.cadre_code); assert.equal(updated.data.village_code, account.village_code);
  assert.equal((await own(secondSession.cookie)).status, 200, 'Identity edit unnecessarily invalidated sessions');
  assert.equal((await own(otherSession.cookie)).data.nickname, 'Tetangga', 'Identity edit changed another cadre');
  assert.equal((await api('/api/me', { cookie: session.cookie })).data.nickname, 'Mbak Ani');
  const historical = (await api(`/api/reports/${report.data.report_id}`, { cookie: admin })).data.report;
  assert.equal(historical.reporter_name, account.name); assert.equal(historical.reporter_phone, account.phone);
  const newReport = await api('/api/cadre/reports', { method: 'POST', cookie: session.cookie, body: reportBody });
  assert.equal(newReport.status, 201);
  const newDetails = (await api(`/api/reports/${newReport.data.report_id}`, { cookie: admin })).data.report;
  assert.equal(newDetails.reporter_name, 'Nama Diperbarui'); assert.equal(newDetails.reporter_phone, '+62 812-3456-7890');

  // Simulate a roster migrated before the new nickname field existed.
  runSql(`UPDATE reporters SET nickname='' WHERE reporter_id='${reporterId}'`);
  assert.equal((await own(session.cookie)).data.profile_complete, false);
  assert.equal((await login()).data.reporter.profile_complete, false);
  assert.equal((await api('/api/cadre/reports', { method: 'POST', cookie: session.cookie, body: reportBody })).status, 400);
  assert.equal((await api('/api/cadre/reports', { cookie: session.cookie })).status, 200, 'Incomplete profile blocked reading report history');
  assert.equal((await patch({ name: 'Nama Diperbarui', nickname: 'Ani', phone: '' })).status, 200);
  assert.equal((await own(session.cookie)).data.phone, '');

  assert.equal((await changePin({ current_pin: '000000', new_pin: '714628' })).status, 400);
  assert.equal((await own(session.cookie)).status, 200, 'Incorrect current PIN ended the session');
  for (const new_pin of ['12345', '1234567', 'abcdef', account.pin])
    assert.equal((await changePin({ current_pin: account.pin, new_pin })).status, 400);
  const changedPin = await changePin({ current_pin: account.pin, new_pin: '714628' });
  assert.equal(changedPin.status, 200, JSON.stringify(changedPin.data));
  assert.match(changedPin.cookie, /^sbm_session=/);
  assert.equal((await own(session.cookie)).status, 401, 'Old signed session survived a PIN change');
  assert.equal((await own(secondSession.cookie)).status, 401, 'Other device session survived a PIN change');
  assert.equal((await own(changedPin.cookie)).status, 200, 'Current device was signed out after PIN change');
  assert.equal((await own(otherSession.cookie)).status, 200, 'PIN change revoked another cadre session');
  assert.equal((await api('/api/auth/cadre-login', { method: 'POST', body: { cadre_code: account.cadre_code, pin: account.pin } })).status, 401);
  session = await login(account.cadre_code, '714628');
  for (let i = 0; i < 5; i++) assert.equal((await changePin({ current_pin: '000000', new_pin: '613827' })).status, 400);
  assert.equal((await changePin({ current_pin: '000000', new_pin: '613827' })).status, 429, 'Current PIN guessing was not rate limited');
  const audits = runSql(`SELECT action,before_json,after_json,notes FROM audit_log WHERE entity_id='${reporterId}' AND action IN ('UPDATE_OWN_CADRE_PROFILE','CHANGE_OWN_CADRE_PIN')`);
  assert.equal(audits.filter(row => row.action === 'CHANGE_OWN_CADRE_PIN').length, 1);
  assert.ok(audits.some(row => row.action === 'UPDATE_OWN_CADRE_PROFILE' && row.after_json.includes('Mbak Ani')));
  assert.doesNotMatch(JSON.stringify(audits), /826491|714628|pin_hash|pin_salt|current_pin|new_pin/);
  for (const reportId of [report.data.report_id, newReport.data.report_id])
    assert.equal((await api(`/api/reports/${reportId}`, { method: 'DELETE', cookie: admin, body: { reason: 'Profile regression cleanup' } })).status, 200);
  for (const id of [reporterId, other.data.reporter_id])
    assert.equal((await api(`/api/admin/cadres/${id}`, { method: 'DELETE', cookie: admin, body: { reason: 'Profile regression cleanup' } })).status, 200);
  console.log('Cadre profile OK: required nickname, own-account permissions, historical identities, PIN verification/revocation/rate limits, and safe auditing.');
}
