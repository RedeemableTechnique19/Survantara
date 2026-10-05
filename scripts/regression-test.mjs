import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { checkCadreProfile } from './cadre-profile-regression.mjs';

const cwd = resolve(import.meta.dirname, '..');
const wrangler = join(cwd, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const port = 8800 + (process.pid % 500);
const origin = `http://127.0.0.1:${port}`;
const persistence = await mkdtemp(join(tmpdir(), 'sbm-regression-'));
let worker;
let workerLog = '';

function stopWorker() {
  if (!worker) return;
  const running = worker;
  worker = undefined;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(running.pid), '/T', '/F'], { stdio: 'ignore' });
  else running.kill('SIGTERM');
  running.stdout?.destroy();
  running.stderr?.destroy();
  running.removeAllListeners();
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { cwd, encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw new Error(`Wrangler failed: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

async function waitForWorker() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/public/masters`);
      if (response.ok) return;
    } catch { /* worker is still starting */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 200));
  }
  throw new Error(`Worker did not start.\n${workerLog}`);
}

async function api(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return {
    status: response.status,
    data,
    cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
    setCookie: response.headers.get('set-cookie') || '',
  };
}

function totp(secret, timestamp = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let buffer = 0; const bytes = [];
  for (const character of secret) {
    buffer = (buffer << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) { bytes.push((buffer >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Math.floor(timestamp / 30000);
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

async function login(email, password) {
  const response = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(response.status, 200, `Login failed for ${email}: ${JSON.stringify(response.data)}`);
  assert.match(response.cookie, /^sbm_session=/);
  return response.cookie;
}

async function routineLogin(sourceCode, pin) {
  const response = await api('/api/auth/ibs-login', { method: 'POST', body: { source_code: sourceCode, pin } });
  assert.equal(response.status, 200, `Routine login failed for ${sourceCode}: ${JSON.stringify(response.data)}`);
  return response.cookie;
}

function epiWeekStart(year, week) {
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const sunday = new Date(januaryFourth);
  sunday.setUTCDate(januaryFourth.getUTCDate() - januaryFourth.getUTCDay() + (week - 1) * 7);
  return sunday.toISOString().slice(0, 10);
}

function publicDiseaseSnapshot() {
  const diseases = [
    ['A','Diare Akut'], ['B','Malaria Konfirmasi'], ['C','Suspek Dengue'], ['D','Pneumonia'],
    ['E','Diare Berdarah / Disentri'], ['F','Suspek Demam Tifoid'], ['G','Sindrom Jaundice Akut'],
    ['H','Suspek Chikungunya'], ['I','Suspek Flu Burung Pada Manusia'], ['J','Suspek Campak'],
    ['K','Kasus Observasi Difteri'], ['L','Suspek Pertusis'], ['M','Acute Flaccid Paralysis (AFP)'],
    ['N','Gigitan Hewan Penular Rabies'], ['O','Suspek Antrax'], ['P','Suspek Leptospirosis'],
    ['Q','Suspek Kolera'], ['R','Suspek Meningitis/Encephalitis'], ['S','Suspek Tetanus Neonatorum'],
    ['T','Suspek Tetanus'], ['U','ILI (Penyakit Serupa Influenza)'], ['V','Suspek HFMD'],
    ['W','ISPA'], ['X','Covid-19 Konfirmasi'],
  ].map(([disease_code, disease_name]) => ({ disease_code, disease_name }));
  const villages = ['DEMO-A','DEMO-B','DEMO-C','DEMO-D','DEMO-E','DEMO-F','DEMO-G'];
  const periods = Array.from({ length: 12 }, (_, index) => {
    const epi_week = 26 + index;
    const start = epiWeekStart(2026, epi_week);
    const endDate = new Date(`${start}T00:00:00Z`); endDate.setUTCDate(endDate.getUTCDate() + 6);
    return { epi_year: 2026, epi_week, start, end: endDate.toISOString().slice(0, 10) };
  });
  const cell = count => count === 0 ? { case_count: 0, count_band: 'ZERO' }
    : count < 5 ? { case_count: null, count_band: 'SUPPRESSED' } : { case_count: count, count_band: 'EXACT' };
  const trend = periods.flatMap(period => diseases.map(disease => ({
    epi_year: period.epi_year, epi_week: period.epi_week, disease_code: disease.disease_code,
    ...cell(period.epi_week === 37 && disease.disease_code === 'A' ? 5 : period.epi_week === 37 && disease.disease_code === 'B' ? 2 : 0),
  })));
  const distribution = periods.flatMap(period => diseases.flatMap(disease => villages.map(village_code => ({
    epi_year: period.epi_year, epi_week: period.epi_week, disease_code: disease.disease_code, village_code,
    ...cell(period.epi_week === 37 && disease.disease_code === 'A' && village_code === 'DEMO-B' ? 5
      : period.epi_week === 37 && disease.disease_code === 'B' && village_code === 'DEMO-D' ? 2 : 0),
  }))));
  const content = {
    schema_version: 1,
    data_through: { epi_year: 2026, epi_week: 37, period_end: periods.at(-1).end },
    window: { weeks: 12, period_start: periods[0].start, period_end: periods.at(-1).end, periods },
    privacy: { aggregate_only: true, patient_details_included: false, exact_coordinates_included: false,
      small_cell_threshold: 5, complementary_suppression: true },
    methodology: { case_definition: 'CONFIRMED_NEW_SKDR_CASE', date_basis: 'visit_date', location_basis: 'patient_village',
      service_area_only: true, current_epidemiological_week_included: true },
    villages, diseases, trend, distribution,
  };
  return {
    schema_version: 1,
    snapshot_id: randomUUID(),
    generated_at: '2026-09-19T12:00:00.000Z',
    content_checksum: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
    ...Object.fromEntries(Object.entries(content).filter(([key]) => key !== 'schema_version')),
  };
}

assert.equal(epiWeekStart(2020, 1), '2019-12-29');
assert.equal(epiWeekStart(2020, 2), '2020-01-05');
assert.equal(epiWeekStart(2020, 53), '2020-12-27');
assert.equal(epiWeekStart(2021, 1), '2021-01-03');

try {
  runWrangler(['d1', 'migrations', 'apply', 'sbm-db', '--local', '--persist-to', persistence]);
  const fresh = JSON.parse(runWrangler(['d1','execute','sbm-db','--local','--persist-to',persistence,'--json','--command',
    'SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM reporters) reporters,(SELECT COUNT(*) FROM routine_sources) routine_sources,(SELECT COUNT(*) FROM villages) villages,(SELECT COUNT(*) FROM posyandu) posyandu,(SELECT COUNT(*) FROM reports) reports']))[0].results[0];
  assert.deepEqual(fresh, {users:0,reporters:0,routine_sources:0,villages:0,posyandu:0,reports:0}, 'Fresh public migrations contain institution or account data');
  runWrangler(['d1','execute','sbm-db','--local','--persist-to',persistence,'--file',join(cwd,'tests/fixtures/villages.sql')]);
  worker = spawn(process.execPath, [
    wrangler, 'dev', '--port', String(port), '--persist-to', persistence,
    '--var', 'SURVEILLANCE_MANAGER_EMAIL:manager@example.test',
    '--var', 'SBM_ALLOWANCE_AMOUNT:125000',
    '--var', 'JWT_SECRET:regression-jwt-secret',
    '--var', 'BOOTSTRAP_TOKEN:regression-bootstrap-token',
    '--var', 'PATIENT_DATA_KEY:regression-patient-key',
    '--var', 'SKDKLB_INTEGRATION_TOKEN:regression-skdklb-integration-token',
    '--var', 'SKDKLB_PUBLICATION_TOKEN:regression-skdklb-publication-token-1234567890',
    '--var', 'TELEGRAM_BOT_TOKEN:', '--var', 'TELEGRAM_CHAT_ID:',
  ], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', chunk => { workerLog = (workerLog + chunk).slice(-20000); });
  worker.stderr.on('data', chunk => { workerLog = (workerLog + chunk).slice(-20000); });
  await waitForWorker();

  const appAsset = await fetch(`${origin}/app.js`).then(response => response.text());
  const cssAsset = await fetch(`${origin}/styles.css`).then(response => response.text());
  const brandingCssAsset = await fetch(`${origin}/branding.css`).then(response => response.text());
  const indexAsset = await fetch(`${origin}/`).then(response => response.text());
  const themeAsset = await fetch(`${origin}/theme.js`).then(response => response.text());
  assert.match(appAsset, /role="tab"[^>]+data-admin-jump="admin-patient-policies"/,
    'IBS admin task navigation is not rendered as in-page tabs');
  assert.doesNotMatch(appAsset, /href="#admin-patient-policies"/,
    'IBS admin task navigation still conflicts with hash-based page routing');
  assert.match(appAsset, /type="button"[^>]+data-user-admin-jump="admin-users-staff"/,
    'User administration is missing account action controls');
  assert.match(appAsset, /id="resetUser"[^>]*>[\s\S]*?<option value="">Pilih petugas…<\/option>/,
    'Password reset still defaults to an administrator account');
  assert.match(appAsset, /id="w2DiseaseSearch"/,
    'W2 entry is missing the shared disease search control');
  assert.doesNotMatch(appAsset, /id="adminW2DiseaseSearch"/,
    'W2 entry still renders the legacy administrator-only disease search control');
  assert.match(appAsset, /class="indicatorLabTracking"/,
    'IBS administration is missing the per-disease laboratory tracking switch');
  assert.match(appAsset, /id="disableAllLabTracking"/,
    'IBS administration is missing the bulk laboratory tracking control');
  assert.match(cssAsset, /\.admin-switch input:checked \+ \.admin-switch-track/,
    'Laboratory tracking switches are missing their selected-state styling');
  assert.match(appAsset, /id="diseaseSituationContent"/,
    'Public disease page is missing its content region');
  assert.match(appAsset, /class="disease-situation landing-disease-situation"/,
    'Disease page no longer uses the established situation styling');
  assert.match(appAsset, /id="diseaseSituationMessage"/,
    'Disease page is missing the validated disease status');
  assert.doesNotMatch(appAsset, /id="diseaseSituationDetails"|id="diseaseSituationSelect"/,
    'Aggregate disease trend and map still require a disclosure or disease selection');
  assert.match(appAsset, /aggregatePublicCells\(data\.trend\.filter/,
    'Landing trend does not combine public disease categories');
  assert.match(appAsset, /aggregatePublicCells\(data\.distribution\.filter/,
    'Landing map does not combine public disease categories');
  const aggregateSource = appAsset.match(/function aggregatePublicCells\(cells\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(aggregateSource, 'Public aggregate calculator is missing');
  const aggregate = runInNewContext(`${aggregateSource}\naggregatePublicCells`);
  assert.equal(aggregate([{ count_band: 'EXACT', case_count: 5 }, { count_band: 'ZERO', case_count: 0 }]).case_count, 5);
  assert.equal(JSON.stringify(aggregate([{ count_band: 'EXACT', case_count: 5 }, { count_band: 'SUPPRESSED', case_count: null }])),
    JSON.stringify({ count_band: 'RANGE', case_count: null, minimum: 6, maximum: 9 }),
    'A hidden small count must produce a bounded range');
  assert.equal(aggregate([{ count_band: 'EXACT', case_count: 5 }, { count_band: 'COMPLEMENTARY_SUPPRESSED', case_count: null }]).count_band,
    'COMPLEMENTARY_SUPPRESSED', 'A protected comparison value must remain hidden in the aggregate');
  assert.match(cssAsset, /var\(--institution-hero-image, none\)/,
    'Landing hero does not consume its deployment branding');
  assert.match(brandingCssAsset, /--institution-hero-image: none/,
    'General branding unexpectedly includes an institutional background');
  assert.match(cssAsset, /:root\[data-theme="light"\] \.landing-actions/,
    'Landing hero is missing its dedicated light-theme treatment');
  assert.match(appAsset, /class="landing-actions"/,
    'Landing page is missing the compact reporting action header');
  assert.match(appAsset, /class="landing-service-card landing-primary-action" href="#public"/,
    'Primary public reporting action is not visible at the top of the landing page');
  assert.match(appAsset, /href="#ibs-login-w2" data-home-account="facility"/,
    'Landing page is missing the direct W2 reporting action');
  assert.doesNotMatch(appAsset, /class="landing-service-card" href="#ibs-login-school"/,
    'School absence reporting action is still visible on the landing page');
  assert.match(appAsset, /href="#status"[^>]*>\$\{uiIcon\('status'\)\} Cek status laporan/,
    'Landing page no longer provides an accessible resident status lookup');
  assert.doesNotMatch(appAsset, /landing-service-arrow/,
    'Landing service cards still include redundant circular arrow controls');
  assert.doesNotMatch(appAsset, /class="landing-service-card" href="#ibs"/,
    'Landing page still routes routine reporters through the retired IBS chooser');
  assert.doesNotMatch(appAsset, /function ibsEntry\(/,
    'Retired IBS chooser page is still included in the client bundle');
  assert.match(appAsset, /\['#ibs', '#reporter'\]\.includes\(requestedPage\) \? '#home' : requestedPage/,
    'Legacy IBS chooser routes no longer redirect to the landing page');
  assert.doesNotMatch(appAsset, /<p class="eyebrow">Situasi penyakit terkini<\/p>/,
    'Disease situation title is duplicated as an eyebrow and heading');
  assert.doesNotMatch(indexAsset, /class="header-staff"/,
    'Staff access still competes with public controls in the top header');
  assert.match(indexAsset, /class="footer-staff" href="#staff"/,
    'Staff access is missing from the footer');
  assert.match(indexAsset, /id="headerCalendarButton"[^>]*aria-haspopup="dialog"/,
    'Header date and epidemiological week are not exposed as a calendar control');
  assert.match(indexAsset, /id="headerCalendarPopover"[^>]*role="dialog"/,
    'Header calendar popover is missing accessible dialog semantics');
  assert.match(appAsset, /function setupHeaderCalendar\(\)/,
    'Header epidemiological calendar interaction is not initialized');
  assert.match(appAsset, /calendar-week-number/,
    'Header calendar does not display epidemiological week numbers');
  assert.doesNotMatch(indexAsset, /class="brand-mark"/,
    'Header still shows an image that is not the app logo');
  assert.doesNotMatch(appAsset, /initLandingArea|id="landingArea"/,
    'Landing page still includes the redundant decorative service-area hero map');
  assert.match(appAsset, /<strong>Periode data:<\/strong> Minggu/,
    'Aggregate trend and map do not identify their latest completed week');
  assert.doesNotMatch(appAsset, /Pembaruan dipublikasikan setelah divalidasi oleh petugas surveilans\./,
    'Disease situation still includes the redundant publication explanation');
  assert.match(appAsset, /cell\.count_band === 'COMPLEMENTARY_SUPPRESSED'[\s\S]*?return \{ count_band: 'COMPLEMENTARY_SUPPRESSED'/,
    'Aggregate values no longer preserve complementary suppression');
  assert.match(indexAsset, /<script src="\/theme\.js\?v=[^"]+"><\/script>/,
    'Theme preference bootstrap is not loaded from a CSP-compatible external script');
  assert.match(indexAsset, /<title>Survantara<\/title>/,
    'Browser title does not use the full Survantara product name');
  assert.match(indexAsset, /class="brand"[^>]*aria-label="Survantara, halaman beranda"/,
    'Header brand does not expose its full product name and homepage destination');
  assert.match(indexAsset, /class="brand-copy">Survantara<\/span>/,
    'Header wordmark is missing the generic product name');
  assert.match(appAsset, /document\.title[^\n]+branding\.displayName/,
    'Route titles do not use the configured product name');
  assert.doesNotMatch(indexAsset, /localStorage\.getItem\('sbm\.theme'\)/,
    'Theme preference bootstrap is still an inline script blocked by the content security policy');
  assert.match(themeAsset, /localStorage\.getItem\('sbm\.theme'\)/,
    'External theme bootstrap does not restore the saved theme preference');
  assert.match(appAsset, /Saat ini · ME \$\{period\.week\}/,
    'Header does not distinguish the current epidemiological week from validated data');
  assert.match(appAsset, /class="landing-trust"[\s\S]*Bisa anonim · Nama pasien tidak diperlukan/,
    'Reporting privacy reassurance is not placed with the reporting actions');
  assert.match(appAsset, /arsiran pada peta melindungi privasi[\s\S]*Angka desa tidak selalu dapat dijumlahkan/,
    'Public disease section does not explain suppression and non-additive village values');
  assert.match(appAsset, /bukan diagnosis atau pengganti nasihat medis/,
    'Public disease section is missing its medical-context guidance');
  assert.match(appAsset, /target\.removeAttribute\('aria-live'\)/,
    'Loaded disease content still announces the whole visualization as a live region');
  assert.match(appAsset, /class="disease-trend-bars" style="--week-count:/,
    'Public trend does not size its columns to completed weeks');
  assert.doesNotMatch(cssAsset, /\.disease-trend-svg[^}]*min-width:\s*660px/,
    'Public trend still forces a clipped horizontal chart');
  assert.doesNotMatch(appAsset, /disease-map-area[^`\n]*tabindex=/,
    'Decorative disease map paths still create silent keyboard stops');
  assert.match(appAsset, /new AbortController\(\)[\s\S]*setTimeout\(\(\) => controller\.abort\(\), 12000\)/,
    'Public disease loading does not time out on a stalled connection');
  assert.match(cssAsset, /\.disease-map-area\.band-suppressed/,
    'Public distribution map is missing small-count suppression styling');
  assert.match(appAsset, /const hasLabTracking = diseases\.some\(item => Number\(item\.lab_tracking\)\)/,
    'W2 entry does not compute whether the laboratory column is needed');
  assert.match(appAsset, /w2-count-list-no-lab/,
    'W2 entry is missing its no-laboratory-column layout');
  assert.doesNotMatch(appAsset, /w2-no-lab/,
    'Disabled laboratory indicators still render replacement content in the W2 entry');
  assert.doesNotMatch(appAsset, /id="startW2Entry"/,
    'W2 period card still renders the redundant Mulai isi action');
  assert.doesNotMatch(appAsset, /class="w2-period-chooser"/,
    'W2 period card still renders the redundant manual period chooser');
  assert.match(appAsset, /Lihat status dan lanjutkan laporan per minggu/,
    'W2 reporting history does not explain that it is the period picker');
  assert.match(appAsset, /w2-definition-preview/,
    'W2 definitions are missing their collapsed preview');
  assert.match(appAsset, /Lihat selengkapnya/,
    'W2 definitions are missing the expand control');
  assert.match(appAsset, /w2-definition-less/,
    'W2 definitions are missing the collapse control');
  assert.match(appAsset, /const definitionPreviewLimit = 100/,
    'W2 definition previews should be capped at 100 characters');
  assert.match(appAsset, /definitionPreviewLimit - 1[^\n]+trimEnd\(\)[^\n]+…/,
    'W2 definition previews should reserve the final character for an ellipsis');
  assert.doesNotMatch(cssAsset, /\.w2-definition-preview[^}]*-webkit-line-clamp/,
    'W2 definition previews still depend on viewport-specific line clamping');
  assert.match(appAsset, /id="w2LoginAcknowledgement"[^>]+role="status"[^>]+aria-live="polite"/,
    'W2 login success feedback is missing its accessible status announcement');
  assert.equal((appAsset.match(/w2LoginAcknowledgementPending = true/g) || []).length, 1,
    'The single routine login path should trigger the W2 login acknowledgement');
  assert.doesNotMatch(appAsset, /\/api\/auth\/reporter-login/,
    'Retired unified reporter login remains in the browser bundle');
  assert.doesNotMatch(appAsset, /name="remember_identifier" checked/,
    'Remember-account controls should not default on for shared devices');
  assert.doesNotMatch(appAsset, /staffSecurity|staff-security|auth\/mfa/,
    'MFA should not be part of the current account UI');
  assert.match(appAsset, /auth-recovery/,
    'Login recovery guidance is missing');
  assert.match(appAsset, /password-guidance/,
    'Password guidance is missing from account administration');
  assert.match(appAsset, /logoutForget/,
    'Logout does not offer the forget-account option');
  assert.match(appAsset, /revokeUserSessions|revokeCadreSessions|revokeSourceSessions/,
    'Account administration is missing revoke-session controls');
  assert.match(appAsset, /ibsW2\(period, adminSourceId, true\)/,
    'W2 period navigation does not request visible change feedback');
  assert.match(cssAsset, /\.interaction-toast\.is-leaving/,
    'W2 login success feedback is missing its timed dismissal state');
  assert.match(cssAsset, /\.interaction-toast \{[^}]*left: 50%[^}]*transform: translateX\(-50%\)/,
    'W2 login success feedback should be centered on the page');
  assert.match(cssAsset, /\.w2-period-card\.is-updated/,
    'W2 period changes are missing visual feedback');
  assert.doesNotMatch(appAsset, /Boleh dilewati\.\s*<\/strong> Untuk sindrom umum bervolume tinggi/,
    'Optional patient details still include an admin-independent justification');
  assert.match(cssAsset, /\.w2-detail-footer \{ display: grid;/,
    'Mobile patient-detail actions are not placed in the bottom footer');
  assert.match(appAsset, /syncMirroredInputs\(\);\s*showMobileEntry\(mobileEntryIndex, false\)/,
    'Desktop and mobile W2 inputs are not synchronized after rerendering');
  assert.match(appAsset, /Wajib untuk tindak lanjut/,
    'Patient-detail policy wording does not explain its follow-up purpose');
  assert.match(appAsset, /name="report_ids"/,
    'Event creation does not expose verified source-report selection');
  assert.match(appAsset, /adminEntry\(\(\) => ibsW2/,
    'Administrative W2 routes are not preflighted through the admin guard');
  assert.match(appAsset, /Ruang kerja administrator/,
    'Administrator landing page does not identify its role-specific workspace');
  assert.match(appAsset, /class="grid metrics admin-overview-metrics"/,
    'Administrator landing page is missing its combined priority overview');
  assert.match(appAsset, /data-home-tab="home-reports-panel"/,
    'Staff landing worklists are not separated into report and event tabs');
  assert.match(appAsset, /class="dashboard-advanced-filters"/,
    'Secondary report filters are not progressively disclosed');

  const bootstrap = await api('/api/bootstrap', {
    method: 'POST',
    headers: { 'x-bootstrap-token': 'regression-bootstrap-token' },
    body: { name: 'Regression Admin', email: 'admin@test.local', password: 'S3hat-Uji!Akses-2026' },
  });
  assert.equal(bootstrap.status, 201);
  const admin = await login('admin@test.local', 'S3hat-Uji!Akses-2026');
  const cookieProbe = await api('/api/auth/login', { method: 'POST', body: { email: 'admin@test.local', password: 'S3hat-Uji!Akses-2026' } });
  assert.match(cookieProbe.setCookie, /HttpOnly/);
  assert.match(cookieProbe.setCookie, /Secure/);
  assert.match(cookieProbe.setCookie, /SameSite=Strict/);
  assert.equal((await api('/api/auth/logout', { method: 'POST', cookie: cookieProbe.cookie })).status, 200);
  assert.equal((await api('/api/me', { cookie: cookieProbe.cookie })).status, 401, 'Logged-out cookie could still be replayed');

  const mfaBefore = await api('/api/auth/mfa', { cookie: admin });
  assert.equal(mfaBefore.status, 200);
  assert.equal(mfaBefore.data.enabled, false);
  const mfaSetup = await api('/api/auth/mfa/setup', { method: 'POST', cookie: admin });
  assert.equal(mfaSetup.status, 200, JSON.stringify(mfaSetup.data));
  assert.match(mfaSetup.data.secret, /^[A-Z2-7]+$/);
  assert.match(mfaSetup.data.otpauth_uri, /issuer=Survantara/,
    'Authenticator setup does not use the Survantara issuer name');
  const mfaConfirm = await api('/api/auth/mfa/confirm', { method: 'POST', cookie: admin, body: { code: totp(mfaSetup.data.secret) } });
  assert.equal(mfaConfirm.status, 200, JSON.stringify(mfaConfirm.data));
  const missingMfaLogin = await api('/api/auth/login', { method: 'POST', body: { email: 'admin@test.local', password: 'S3hat-Uji!Akses-2026' } });
  assert.equal(missingMfaLogin.status, 401);
  assert.equal(missingMfaLogin.data.code, 'MFA_REQUIRED');
  const mfaLogin = await api('/api/auth/login', { method: 'POST', body: { email: 'admin@test.local', password: 'S3hat-Uji!Akses-2026', mfa_code: totp(mfaSetup.data.secret) } });
  assert.equal(mfaLogin.status, 200, JSON.stringify(mfaLogin.data));
  assert.equal((await api('/api/auth/mfa/disable', { method: 'POST', cookie: admin, body: { code: totp(mfaSetup.data.secret) } })).status, 200);

  const users = [
    ['viewer@test.local', 'VIEWER'],
    ['verifier@test.local', 'VERIFIKATOR'],
  ];
  const userIds = new Map();
  for (const [email, role] of users) {
    const created = await api('/api/admin/users', {
      method: 'POST', cookie: admin,
      body: { email, name: role, role, password: 'Survantara-Uji!Akses-2026' },
    });
    assert.equal(created.status, 201);
    userIds.set(email, created.data.user_id);
  }
  const retiredRole = await api('/api/admin/users', {
    method: 'POST', cookie: admin,
    body: { email: 'retired-role@test.local', name: 'Retired role', role: 'EPIDEMIOLOG', password: 'Survantara-Uji!Akses-2026' },
  });
  assert.equal(retiredRole.status, 400);
  const missingProgram = await api('/api/admin/users', {
    method: 'POST', cookie: admin,
    body: { email: 'missing-program@test.local', name: 'Missing program', role: 'PETUGAS_PROGRAM', program: '', password: 'Survantara-Uji!Akses-2026' },
  });
  assert.equal(missingProgram.status, 400);
  assert.match(missingProgram.data.error, /Program wajib diisi/);

  const viewerBeforeReset = await login('viewer@test.local', 'Survantara-Uji!Akses-2026');
  const editedViewer = await api(`/api/admin/users/${userIds.get('viewer@test.local')}`, {
    method: 'PATCH', cookie: admin,
    body: { email: 'viewer@test.local', name: 'Viewer Updated', role: 'VIEWER', program: '' },
  });
  assert.equal(editedViewer.status, 200);
  assert.equal(editedViewer.data.name, 'Viewer Updated');
  assert.equal((await api('/api/me', { cookie: viewerBeforeReset })).status, 200, 'Name-only edit unnecessarily revoked staff session');
  const resetViewer = await api(`/api/admin/users/${userIds.get('viewer@test.local')}/reset-password`, {
    method: 'POST', cookie: admin, body: { password: 'Rotasi-Uji!Akses-456' },
  });
  assert.equal(resetViewer.status, 200);
  assert.equal((await api('/api/me', { cookie: viewerBeforeReset })).status, 401, 'Old staff cookie survived password reset');
  const viewer = await login('viewer@test.local', 'Rotasi-Uji!Akses-456');

  const duplicate = await api('/api/admin/users', {
    method: 'POST', cookie: admin,
    body: { email: 'viewer@test.local', name: 'Duplicate', role: 'VIEWER', password: 'Survantara-Uji!Akses-2026' },
  });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.data.error, /Email petugas sudah digunakan/);
  const statusWithoutReason = await api(`/api/admin/users/${userIds.get('verifier@test.local')}/status`, {
    method: 'POST', cookie: admin, body: { active: 0 },
  });
  assert.equal(statusWithoutReason.status, 400);
  assert.equal((await api(`/api/admin/users/${userIds.get('verifier@test.local')}/status`, {
    method: 'POST', cookie: admin, body: { active: 0, reason: 'Rotasi akses untuk pengujian' },
  })).status, 200);
  assert.equal((await api(`/api/admin/users/${userIds.get('verifier@test.local')}/status`, {
    method: 'POST', cookie: admin, body: { active: 1 },
  })).status, 200);

  const invalidReport = {
    event_type: 'OTHER', observation_codes: [], context_codes: [], village_code: 'DEMO-A',
    event_description: 'Regression audit report', estimated_cases: 1, estimated_deaths: 0,
    severe_cases: 0, hospitalized_cases: 0, affected_group: 'UNKNOWN',
    event_start_date: '2026-02-30', anonymous: true, allow_contact: false, location_text: 'Audit location',
    form_elapsed_ms: 5000, privacy_consent: true,
  };
  const invalidDate = await api('/api/public/reports', { method: 'POST', body: invalidReport });
  assert.equal(invalidDate.status, 400);
  assert.match(invalidDate.data.error, /Tanggal tidak valid/);
  const validReport = await api('/api/public/reports', {
    method: 'POST', body: { ...invalidReport, event_start_date: '2026-07-15' },
  });
  assert.equal(validReport.status, 201);

  const publicTaxonomyBase = {
    observation_codes: ['FEVER'], context_codes: [], village_code: 'DEMO-A',
    event_description: 'Taxonomy contract report', estimated_cases: 1, estimated_deaths: 0,
    severe_cases: 0, hospitalized_cases: 0, affected_group: 'ADULT', event_start_date: '2026-07-15',
    anonymous: true, allow_contact: false, location_text: 'Taxonomy test location',
    form_elapsed_ms: 5000, privacy_consent: true,
  };
  const undersizedCluster = await api('/api/public/reports', {
    method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.10' },
    body: { ...publicTaxonomyBase, event_type: 'CLUSTER' },
  });
  assert.equal(undersizedCluster.status, 400, 'Public API accepted a one-person cluster');
  assert.match(undersizedCluster.data.error, /sedikitnya 2/);
  const publicCluster = await api('/api/public/reports', {
    method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.11' },
    body: { ...publicTaxonomyBase, event_type: 'CLUSTER', estimated_cases: 2 },
  });
  assert.equal(publicCluster.status, 201, JSON.stringify(publicCluster.data));
  assert.equal(publicCluster.data.priority, 'SEDANG', 'Immediate notification incorrectly inflated cluster risk');
  const personIllness = await api('/api/public/reports', {
    method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.12' },
    body: { ...publicTaxonomyBase, event_type: 'PERSON_ILLNESS' },
  });
  assert.equal(personIllness.status, 201, JSON.stringify(personIllness.data));
  const bloodyDiarrhea = await api('/api/public/reports', {
    method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.14' },
    body: { ...publicTaxonomyBase, event_type: 'PERSON_ILLNESS', observation_codes: ['BLOODY_DIARRHEA'] },
  });
  assert.equal(bloodyDiarrhea.status, 201, JSON.stringify(bloodyDiarrhea.data));
  assert.equal(bloodyDiarrhea.data.priority, 'SEDANG', 'Observation master priority was not applied');
  const severeRoutineEvent = await api('/api/public/reports', {
    method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.15' },
    body: { ...publicTaxonomyBase, event_type: 'OTHER', observation_codes: [], has_severe_case: true },
  });
  assert.equal(severeRoutineEvent.status, 201, JSON.stringify(severeRoutineEvent.data));
  assert.equal(severeRoutineEvent.data.priority, 'TINGGI');
  const animalExposure = await api('/api/public/reports', {
    method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.13' },
    body: {
      ...publicTaxonomyBase, event_type: 'ANIMAL_EXPOSURE', observation_codes: [],
      context_codes: ['SICK_DEAD_ANIMAL_CONTACT'],
    },
  });
  assert.equal(animalExposure.status, 201, JSON.stringify(animalExposure.data));
  assert.equal(animalExposure.data.priority, 'TINGGI');
  const unknownCounts = await api('/api/public/reports', {
    method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.16' },
    body: { ...publicTaxonomyBase, event_type: 'PERSON_ILLNESS',
      estimated_cases: '', estimated_deaths: '', hospitalized_cases: '',
      estimated_cases_unknown: true, estimated_deaths_unknown: true, hospitalized_cases_unknown: true },
  });
  assert.equal(unknownCounts.status, 201, JSON.stringify(unknownCounts.data));
  const unauthenticatedIntegration = await api('/api/integrations/skdklb/reports');
  assert.equal(unauthenticatedIntegration.status, 401);
  const emptyPublicSituation = await api('/api/public/disease-situation');
  assert.equal(emptyPublicSituation.status, 200, JSON.stringify(emptyPublicSituation.data));
  assert.equal(emptyPublicSituation.data.available, false);
  const publicationPath = '/api/integrations/skdklb/public-snapshots';
  const snapshot = publicDiseaseSnapshot();
  assert.equal((await api(publicationPath, { method: 'POST', body: snapshot })).status, 401);
  const publicationHeaders = { authorization: 'Bearer regression-skdklb-publication-token-1234567890' };
  const receivedSnapshot = await api(publicationPath, { method: 'POST', headers: publicationHeaders, body: snapshot });
  assert.equal(receivedSnapshot.status, 201, JSON.stringify(receivedSnapshot.data));
  assert.equal(receivedSnapshot.data.snapshot_id, snapshot.snapshot_id);
  assert.equal(receivedSnapshot.data.data_through.epi_week, 37);
  const publicSituationResponse = await fetch(`${origin}/api/public/disease-situation`);
  const publicSituation = await publicSituationResponse.json();
  assert.equal(publicSituationResponse.status, 200, JSON.stringify(publicSituation));
  assert.equal(publicSituation.available, true);
  assert.equal(publicSituation.data_through.epi_week, 37);
  assert.equal(publicSituation.diseases.length, 24);
  assert.equal(publicSituation.trend.length, 12 * 24);
  assert.equal(publicSituation.distribution.length, 12 * 24 * 7);
  assert.ok(publicSituation.last_updated);
  assert.ok(!('snapshot_id' in publicSituation), 'Public disease endpoint exposed its internal snapshot ID');
  assert.ok(!('content_checksum' in publicSituation), 'Public disease endpoint exposed its internal checksum');
  assert.ok(!('methodology' in publicSituation), 'Public disease endpoint exposed non-display metadata');
  assert.match(publicSituationResponse.headers.get('cache-control') || '', /max-age=300/);
  const publicEtag = publicSituationResponse.headers.get('etag');
  assert.ok(publicEtag, 'Public disease endpoint did not return an ETag');
  const unchangedPublicSituation = await fetch(`${origin}/api/public/disease-situation`, { headers: { 'if-none-match': publicEtag } });
  assert.equal(unchangedPublicSituation.status, 304);
  assert.equal((await api('/api/public/disease-situation', { method: 'POST', body: {} })).status, 405);
  const repeatedSnapshot = await api(publicationPath, { method: 'POST', headers: publicationHeaders, body: snapshot });
  assert.equal(repeatedSnapshot.status, 200, JSON.stringify(repeatedSnapshot.data));
  assert.equal(repeatedSnapshot.data.unchanged, true);
  const snapshotStatus = await api(`${publicationPath}/status`, { headers: publicationHeaders });
  assert.equal(snapshotStatus.status, 200, JSON.stringify(snapshotStatus.data));
  assert.equal(snapshotStatus.data.active_snapshot.snapshot_id, snapshot.snapshot_id);
  const unsafeSnapshot = { ...publicDiseaseSnapshot(), patient_name: 'forbidden' };
  assert.equal((await api(publicationPath, { method: 'POST', headers: publicationHeaders, body: unsafeSnapshot })).status, 400);
  const reconstructableSnapshot = publicDiseaseSnapshot();
  Object.assign(reconstructableSnapshot.distribution.find(row => row.epi_year === 2026 && row.epi_week === 37
    && row.disease_code === 'A' && row.village_code === 'DEMO-D'), { case_count: null, count_band: 'SUPPRESSED' });
  assert.equal((await api(publicationPath, {
    method: 'POST', headers: publicationHeaders, body: reconstructableSnapshot,
  })).status, 409, 'Receiver accepted a small village cell reconstructable from the exact trend total');
  const integrationHeaders = { authorization: 'Bearer regression-skdklb-integration-token' };
  const w2Feed = await api('/api/integrations/skdklb/w2/submissions', { headers: integrationHeaders });
  assert.equal(w2Feed.status, 200, JSON.stringify(w2Feed.data));
  assert.equal(w2Feed.data.schema_version, 1);
  assert.equal(w2Feed.data.privacy.aggregate_only, true);
  assert.equal(w2Feed.data.privacy.patient_details_included, false);
  assert.ok(Array.isArray(w2Feed.data.submissions));
  const outboundW2Disabled = await api('/api/integrations/skdklb/w2', {
    method: 'POST', headers: integrationHeaders, body: { confirmed: true },
  });
  assert.equal(outboundW2Disabled.status, 404, 'Survantara still accepted outbound W2 from SKD-KLB');
  const w2DeletionFeed = await api('/api/integrations/skdklb/w2/deletions', { headers: integrationHeaders });
  assert.equal(w2DeletionFeed.status, 200, JSON.stringify(w2DeletionFeed.data));
  const integrationPage = await api('/api/integrations/skdklb/reports?limit=2', { headers: integrationHeaders });
  assert.equal(integrationPage.status, 200, JSON.stringify(integrationPage.data));
  assert.equal(integrationPage.data.schema_version, 1);
  assert.equal(integrationPage.data.reports.length, 2);
  assert.equal(integrationPage.data.has_more, true);
  assert.ok(integrationPage.data.next_cursor);
  assert.ok(!('reporter_phone' in integrationPage.data.reports[0]), 'Integration API leaked reporter phone');
  assert.ok(!('public_pin_hash' in integrationPage.data.reports[0]), 'Integration API leaked public PIN hash');
  const integrationPageTwo = await api(`/api/integrations/skdklb/reports?limit=2&cursor=${encodeURIComponent(integrationPage.data.next_cursor)}`, { headers: integrationHeaders });
  assert.equal(integrationPageTwo.status, 200);
  assert.ok(!integrationPageTwo.data.reports.some(row => integrationPage.data.reports.some(first => first.report_id === row.report_id)), 'Integration cursor returned duplicates');
  const acknowledgedViaIntegration = await api(`/api/integrations/skdklb/reports/${personIllness.data.report_id}/actions`, {
    method: 'POST', headers: integrationHeaders, body: { action: 'ACKNOWLEDGE' },
  });
  assert.equal(acknowledgedViaIntegration.status, 200, JSON.stringify(acknowledgedViaIntegration.data));
  assert.equal(acknowledgedViaIntegration.data.current_status, 'DITERIMA');
  const startedViaIntegration = await api(`/api/integrations/skdklb/reports/${personIllness.data.report_id}/actions`, {
    method: 'POST', headers: integrationHeaders, body: { action: 'START_VERIFICATION' },
  });
  assert.equal(startedViaIntegration.status, 200, JSON.stringify(startedViaIntegration.data));
  assert.equal(startedViaIntegration.data.current_status, 'SEDANG_DIVERIFIKASI');
  const personDetail = await api(`/api/reports/${personIllness.data.report_id}`, { cookie: admin });
  assert.equal(personDetail.status, 200);
  assert.equal(personDetail.data.report.signal_code, 'PERSON_ILLNESS');
  assert.equal(personDetail.data.ebs_options[0].catalog_version, 'SKDR-EBS-2025');
  assert.match(personDetail.data.ebs_options[0].source_authority, /Kementerian Kesehatan/);
  assert.equal(personDetail.data.ebs_options[0].source_artifact_sha256, 'FE99CD13984899B48E49F95F6488B422390AF573189F8E06E1F98C6B84977B97');
  assert.equal(Number(personDetail.data.ebs_options[0].source_artifact_bytes), 20743697);
  assert.equal(personDetail.data.ebs_options.find(option => option.ebs_id === '30')?.disease_name, 'Pneumonia');
  assert.equal(personDetail.data.ebs_options.find(option => option.ebs_id === '228')?.disease_name, 'Suspek Meningitis');
  assert.equal(Number(personDetail.data.report.immediate_notification), 0, 'Routine person illness was marked for immediate notification');
  const clusterDetail = await api(`/api/reports/${publicCluster.data.report_id}`, { cookie: admin });
  assert.equal(Number(clusterDetail.data.report.immediate_notification), 1, 'Immediate cluster notification flag was not persisted');
  assert.equal(clusterDetail.data.report.triage_rule_version, '4.0-master-priority', 'Structured triage version was not advanced');
  const bloodyDetail = await api(`/api/reports/${bloodyDiarrhea.data.report_id}`, { cookie: admin });
  assert.equal(Number(bloodyDetail.data.report.immediate_notification), 1, 'Observation master notification flag was ignored');
  const severeDetail = await api(`/api/reports/${severeRoutineEvent.data.report_id}`, { cookie: admin });
  assert.equal(Number(severeDetail.data.report.immediate_notification), 1, 'Severity-based high risk did not trigger immediate notification');
  const animalDetail = await api(`/api/reports/${animalExposure.data.report_id}`, { cookie: admin });
  assert.equal(animalDetail.data.report.signal_code, 'ANIMAL_EXPOSURE');
  const unknownDetail = await api(`/api/reports/${unknownCounts.data.report_id}`, { cookie: admin });
  assert.equal(Number(unknownDetail.data.report.reported_cases_known), 0);
  assert.equal(Number(unknownDetail.data.report.reported_deaths_known), 0);
  assert.equal(Number(unknownDetail.data.report.hospitalized_cases_known), 0);
  assert.equal(Number(unknownDetail.data.report.reported_cases), 1, 'Triage lower bound must be retained without claiming a known count');
  const analyticsTaxonomy = await api('/api/analytics', { cookie: admin });
  assert.equal(analyticsTaxonomy.status, 200);
  assert.ok(analyticsTaxonomy.data.daily.some(row => row.taxonomy_code === 'PERSON_ILLNESS' && row.reporting_code === 'PERSON_ILLNESS'), 'Person illness was collapsed into OTHER analytics');
  assert.ok(analyticsTaxonomy.data.daily.every(row => Object.hasOwn(row, 'signal_code') && Object.hasOwn(row, 'event_type')), 'Analytics dropped one of the taxonomy dimensions');
  const publicMasters = await api('/api/public/masters');
  assert.equal(Number(publicMasters.data.event_types.find(item => item.event_type === 'CLUSTER')?.immediate_notification), 1, 'Event notification flag was not exposed to the UI');
  assert.equal(Number(publicMasters.data.observations.find(item => item.observation_code === 'RASH_LESION')?.immediate_notification), 1, 'Observation notification flag was not exposed to the UI');
  assert.equal(Number(publicMasters.data.contexts.find(item => item.context_code === 'SHARED_WATER')?.immediate_notification), 1, 'Context notification flag was not exposed to the UI');
  assert.ok(publicMasters.data.signals.some(signal => signal.signal_code === 'PERSON_ILLNESS'));
  assert.ok(publicMasters.data.signals.some(signal => signal.signal_code === 'ANIMAL_EXPOSURE'));
  assert.ok(!publicMasters.data.signals.some(signal => signal.signal_code === 'RABIES'));
  assert.deepEqual(publicMasters.data.signals.map(signal => signal.signal_code), [
    'PERSON_ILLNESS', 'FOOD', 'CLUSTER', 'DEATH', 'SCHOOL', 'ENV', 'ZOONOSIS', 'ZOONOSIS_HUMAN', 'ANIMAL_EXPOSURE', 'OTHER',
  ]);
  assert.equal((await api(`/api/reports/${validReport.data.report_id}/status`, {
    method: 'POST', cookie: admin, body: { status: 'DITERIMA', notes: 'Diterima untuk pengujian metrik' },
  })).status, 200);
  assert.equal((await api(`/api/reports/${validReport.data.report_id}/status`, {
    method: 'POST', cookie: admin, body: { status: 'MEMERLUKAN_INFORMASI', notes: 'Menunggu informasi tambahan' },
  })).status, 200);
  const reportDashboard = await api('/api/dashboard', { cookie: admin });
  assert.equal(reportDashboard.status, 200);
  assert.equal(reportDashboard.data.pending_reports, 7, 'Pending workload excluded reports in an actionable status');
  assert.ok(reportDashboard.data.notification_attention_reports >= 4, 'Immediate reports needing delivery attention were absent from the dashboard');
  const notificationQueue = await api('/api/reports?notification=ATTENTION', { cookie: admin });
  assert.equal(notificationQueue.status, 200);
  assert.ok(notificationQueue.data.rows.some(row => row.report_id === publicCluster.data.report_id), 'Immediate cluster was absent from the notification queue');
  assert.ok(notificationQueue.data.rows.every(row => Number(row.immediate_notification) === 1 && row.notification_status !== 'SENT'));
  const forbiddenRetry = await api(`/api/reports/${publicCluster.data.report_id}/notification/retry`, { method: 'POST', cookie: viewer });
  assert.equal(forbiddenRetry.status, 403, 'Read-only viewer could retry operational notifications');
  const retryNotification = await api(`/api/reports/${publicCluster.data.report_id}/notification/retry`, { method: 'POST', cookie: admin });
  assert.equal(retryNotification.status, 200);
  assert.equal(retryNotification.data.status, 'UNCONFIGURED', 'Missing Telegram configuration was not persisted as an operational state');
  const retriedCluster = await api(`/api/reports/${publicCluster.data.report_id}`, { cookie: admin });
  assert.equal(retriedCluster.data.report.notification_status, 'UNCONFIGURED');
  assert.ok(Number(retriedCluster.data.report.notification_attempts) >= 1);
  const viewerList = await api('/api/reports', { cookie: viewer });
  assert.equal(viewerList.status, 200);
  const viewerRow = viewerList.data.rows.find(row => row.report_id === validReport.data.report_id);
  assert.ok(viewerRow);
  assert.equal(viewerRow.can_open_detail, false);

  const cadre = await api('/api/admin/cadres', {
    method: 'POST', cookie: admin,
    body: { cadre_code: 'TEST-CADRE', name: 'Test Cadre', nickname: 'Kader', village_code: 'DEMO-A', pin: '123456' },
  });
  assert.equal(cadre.status, 201);
  const cadreLogin = await api('/api/auth/cadre-login', { method: 'POST', body: { cadre_code: 'TEST-CADRE', pin: '123456' } });
  assert.equal(cadreLogin.status, 200);
  const cadreTaxonomyBase = {
    observation_codes: ['FEVER'], context_codes: [], village_code: 'DEMO-A',
    description: 'Cadre taxonomy contract report', reported_cases: 2, reported_deaths: 0,
    severe_cases: 0, hospitalized_cases: 0, affected_group: 'ADULT', event_start_date: '2026-07-15',
    location_text: 'Cadre taxonomy test location',
  };
  await checkCadreProfile({ api, admin, viewer, reportBody: { ...cadreTaxonomyBase, signal_code: 'PERSON_ILLNESS' },
    runSql: command => JSON.parse(runWrangler(['d1', 'execute', 'sbm-db', '--local', '--persist-to', persistence, '--json', '--command', command]))[0].results });
  const cadreCluster = await api('/api/cadre/reports', {
    method: 'POST', cookie: cadreLogin.cookie, body: { ...cadreTaxonomyBase, signal_code: 'CLUSTER' },
  });
  assert.equal(cadreCluster.status, 201, JSON.stringify(cadreCluster.data));
  assert.equal(cadreCluster.data.priority, publicCluster.data.priority, 'Equivalent public and cadre clusters received different priorities');
  const cadrePersonIllness = await api('/api/cadre/reports', {
    method: 'POST', cookie: cadreLogin.cookie,
    body: { ...cadreTaxonomyBase, signal_code: 'PERSON_ILLNESS', reported_cases: 1 },
  });
  assert.equal(cadrePersonIllness.status, 201, JSON.stringify(cadrePersonIllness.data));
  const cadreFood = await api('/api/cadre/reports', {
    method: 'POST', cookie: cadreLogin.cookie,
    body: { ...cadreTaxonomyBase, signal_code: 'FOOD', observation_codes: ['VOMITING'] },
  });
  assert.equal(cadreFood.status, 201, JSON.stringify(cadreFood.data));
  const cadreZoonoticHuman = await api('/api/cadre/reports', {
    method: 'POST', cookie: cadreLogin.cookie,
    body: { ...cadreTaxonomyBase, signal_code: 'ZOONOSIS_HUMAN', reported_cases: 1 },
  });
  assert.equal(cadreZoonoticHuman.status, 201, JSON.stringify(cadreZoonoticHuman.data));
  assert.equal(cadreZoonoticHuman.data.priority, 'TINGGI', 'Zoonotic human signal lost its implied high-risk exposure');
  const zoonoticDetail = await api(`/api/reports/${cadreZoonoticHuman.data.report_id}`, { cookie: admin });
  assert.ok(zoonoticDetail.data.contexts.some(context => context.context_code === 'SICK_DEAD_ANIMAL_CONTACT'));
  const legacyAnimalExposure = await api('/api/cadre/reports', {
    method: 'POST', cookie: cadreLogin.cookie,
    body: { ...cadreTaxonomyBase, signal_code: 'RABIES', context_codes: ['ANIMAL_BITE'] },
  });
  assert.equal(legacyAnimalExposure.status, 201, 'Cached legacy cadre client could not submit RABIES alias');
  const legacyExposureDetail = await api(`/api/reports/${legacyAnimalExposure.data.report_id}`, { cookie: admin });
  assert.equal(legacyExposureDetail.data.report.signal_code, 'ANIMAL_EXPOSURE');
  const cadreAnalytics = await api('/api/analytics', { cookie: admin });
  assert.ok(cadreAnalytics.data.daily.some(row => row.signal_code === 'FOOD' && row.event_type === 'CLUSTER' && row.reporting_code === 'FOOD'), 'Cadre food signal was collapsed into the generic cluster row');
  assert.equal((await api('/api/auth/reporter-login', { method: 'POST', body: { identifier: 'TEST-CADRE', pin: '123456' } })).status, 404,
    'Retired unified reporter login endpoint is still exposed');
  const editedCadre = await api(`/api/admin/cadres/${cadre.data.reporter_id}`, {
    method: 'PATCH', cookie: admin,
    body: { cadre_code: 'TEST-CADRE-EDIT', name: 'Test Cadre Updated', nickname: 'Kader', phone: '081234567890', village_code: 'DEMO-A' },
  });
  assert.equal(editedCadre.status, 200);
  assert.equal(editedCadre.data.cadre_code, 'TEST-CADRE-EDIT');
  assert.equal((await api('/api/me', { cookie: cadreLogin.cookie })).status, 401, 'Old cadre cookie survived profile edit');
  const editedCadreLogin = await api('/api/auth/cadre-login', { method: 'POST', body: { cadre_code: 'TEST-CADRE-EDIT', pin: '123456' } });
  assert.equal(editedCadreLogin.status, 200);
  assert.equal((await api(`/api/admin/cadres/${cadre.data.reporter_id}/reset-pin`, {
    method: 'POST', cookie: admin, body: { pin: '654321' },
  })).status, 200);
  assert.equal((await api('/api/me', { cookie: editedCadreLogin.cookie })).status, 401, 'Old cadre cookie survived PIN reset');

  const faskes = await api('/api/admin/ibs/sources', {
    method: 'POST', cookie: admin,
    body: { source_code: 'TEST-FASKES', source_name: 'Test Faskes', source_type: 'FASKES', network_type: 'JEJARING', village_code: 'DEMO-A', pin: '123456' },
  });
  assert.equal(faskes.status, 201);
  const school = await api('/api/admin/ibs/sources', {
    method: 'POST', cookie: admin,
    body: { source_code: 'TEST-SCHOOL', source_name: 'Test School', source_type: 'SEKOLAH', village_code: 'DEMO-A', pin: '123456' },
  });
  assert.equal(school.status, 201, JSON.stringify(school.data));
  const reporterAccounts = await api('/api/public/reporter-accounts');
  assert.equal(reporterAccounts.status, 200);
  assert.ok(reporterAccounts.data.institutions.some(item => item.source_code === 'TEST-FASKES'));
  assert.ok(!JSON.stringify(reporterAccounts.data).includes('pin_hash'));
  assert.equal((await api('/api/auth/ibs-login', { method: 'POST', body: { source_code: 'TEST-FASKES', pin: '12345678' } })).status, 401,
    'Routine login still accepts a non-six-digit PIN');
  const missingFaskes = await api('/api/admin/ibs/sources', {
    method: 'POST', cookie: admin,
    body: { source_code: 'TEST-MISSING', source_name: 'Faskes Belum Lapor', source_type: 'FASKES', network_type: 'JEJARING', village_code: 'DEMO-A', pin: '123456' },
  });
  assert.equal(missingFaskes.status, 201);

  const schoolCookie = await routineLogin('TEST-SCHOOL', '123456');
  const badWeek = await api('/api/ibs/school', {
    method: 'POST', cookie: schoolCookie,
    body: { epi_year: 2026, epi_week: 53, enrolled_count: 100, sick_absent_count: 1, notes: '' },
  });
  assert.equal(badWeek.status, 400);
  assert.match(badWeek.data.error, /Periode epidemiologi tidak valid/);
  const futureSchool = await api('/api/ibs/school', {
    method: 'POST', cookie: schoolCookie,
    body: { epi_year: 2100, epi_week: 1, enrolled_count: 100, sick_absent_count: 0, notes: '', expected_revision: 0, confirmed: true },
  });
  assert.equal(futureSchool.status, 409);
  assert.match(futureSchool.data.error, /belum dimulai/);
  const impossibleSchool = await api('/api/ibs/school', {
    method: 'POST', cookie: schoolCookie,
    body: { epi_year: 2026, epi_week: 28, enrolled_count: 100, sick_absent_count: 101, notes: '', expected_revision: 0, confirmed: true },
  });
  assert.equal(impossibleSchool.status, 400);
  assert.match(impossibleSchool.data.error, /tidak boleh melebihi/);
  const unconfirmedEnrollment = await api('/api/ibs/school', {
    method: 'POST', cookie: schoolCookie,
    body: { epi_year: 2026, epi_week: 28, enrolled_count: 100, sick_absent_count: 7, notes: '', expected_revision: 0, confirmed: true },
  });
  assert.equal(unconfirmedEnrollment.status, 409);
  assert.match(unconfirmedEnrollment.data.error, /tahun ajaran 2026\/2027/);
  const schoolSubmission = await api('/api/ibs/school', {
    method: 'POST', cookie: schoolCookie,
    body: { epi_year: 2026, epi_week: 28, enrolled_count: 100, sick_absent_count: 7, notes: 'Batuk pilek kelas 4', expected_revision: 0, confirmed: true, enrollment_confirmed: true },
  });
  assert.equal(schoolSubmission.status, 201, JSON.stringify(schoolSubmission.data));
  assert.equal(schoolSubmission.data.revision, 1);
  assert.equal(schoolSubmission.data.enrollment_default_updated, true);
  const unchangedSchool = await api('/api/ibs/school', {
    method: 'POST', cookie: schoolCookie,
    body: { epi_year: 2026, epi_week: 28, enrolled_count: 100, sick_absent_count: 7, notes: 'Batuk pilek kelas 4', expected_revision: 1, confirmed: true },
  });
  assert.equal(unchangedSchool.status, 200);
  assert.equal(unchangedSchool.data.unchanged, true);
  assert.equal(unchangedSchool.data.revision, 1);
  const revisedSchool = await api('/api/ibs/school', {
    method: 'POST', cookie: schoolCookie,
    body: { epi_year: 2026, epi_week: 28, enrolled_count: 100, sick_absent_count: 8, notes: 'Batuk pilek kelas 4', expected_revision: 1, confirmed: true },
  });
  assert.equal(revisedSchool.status, 200);
  assert.equal(revisedSchool.data.revision, 2);
  const staleSchool = await api('/api/ibs/school', {
    method: 'POST', cookie: schoolCookie,
    body: { epi_year: 2026, epi_week: 28, enrolled_count: 100, sick_absent_count: 9, notes: '', expected_revision: 1, confirmed: true },
  });
  assert.equal(staleSchool.status, 409);
  assert.match(staleSchool.data.error, /telah berubah/);
  const schoolForm = await api('/api/ibs/school?epi_year=2026&epi_week=28', { cookie: schoolCookie });
  assert.equal(schoolForm.status, 200);
  assert.equal(schoolForm.data.source.source_name, 'Test School');
  assert.equal(schoolForm.data.submission.revision, 2);
  assert.equal(schoolForm.data.enrollment.academic_year_label, '2026/2027');
  assert.equal(schoolForm.data.enrollment.default_count, 100);
  assert.equal(schoolForm.data.enrollment.review_required, false);
  assert.ok(schoolForm.data.calendar.weeks.some(item => Number(item.week) === 28 && item.status === 'LATE'));
  const nextSchoolForm = await api('/api/ibs/school?epi_year=2026&epi_week=30', { cookie: schoolCookie });
  assert.equal(nextSchoolForm.status, 200);
  assert.equal(nextSchoolForm.data.submission, null);
  assert.equal(nextSchoolForm.data.enrollment.default_count, 100);
  assert.equal(nextSchoolForm.data.enrollment.review_required, false);

  const originalFaskesCookie = await routineLogin('TEST-FASKES', '123456');
  const editedFaskes = await api(`/api/admin/ibs/sources/${faskes.data.source_id}`, {
    method: 'PATCH', cookie: admin,
    body: {
      source_code: 'TEST-FASKES-EDIT', source_name: 'Test Faskes Diperbarui', network_type: 'JEJARING',
      program_area: 'Surveilans', village_code: 'DEMO-A', subvillage_name: 'Dusun Uji',
    },
  });
  assert.equal(editedFaskes.status, 200, JSON.stringify(editedFaskes.data));
  assert.equal(editedFaskes.data.source_name, 'Test Faskes Diperbarui');
  assert.equal(editedFaskes.data.program_area, 'Surveilans');
  assert.equal((await api('/api/ibs/me', { cookie: originalFaskesCookie })).status, 401, 'Old routine cookie survived source edit');
  const faskesCookie = await routineLogin('TEST-FASKES-EDIT', '123456');
  const initialDeadline = await api('/api/admin/ibs/deadline', { cookie: admin });
  assert.equal(initialDeadline.status, 200);
  assert.equal(Number(initialDeadline.data.active.deadline_hour), 9);
  const changedDeadline = await api('/api/admin/ibs/deadline', {
    method: 'POST', cookie: admin, body: { deadline_hour: 10, deadline_minute: 15 },
  });
  assert.equal(changedDeadline.status, 200, JSON.stringify(changedDeadline.data));
  const currentDeadlineForm = await api(`/api/ibs/w2?epi_year=${changedDeadline.data.effective_period.year}&epi_week=${changedDeadline.data.effective_period.week}`, { cookie: faskesCookie });
  assert.equal(Number(currentDeadlineForm.data.deadline_policy.deadline_hour), 10);
  assert.equal(Number(currentDeadlineForm.data.deadline_policy.deadline_minute), 15);
  const w2Form = await api('/api/ibs/w2?epi_year=2026&epi_week=28', { cookie: faskesCookie });
  assert.equal(w2Form.status, 200);
  assert.equal(Number(w2Form.data.deadline_policy.deadline_hour), 9, 'Historical W2 deadline changed retroactively');
  assert.equal(Number(w2Form.data.deadline_policy.deadline_minute), 0, 'Historical W2 deadline minute changed retroactively');
  const definitionMarkers = {
    A: 'konsistensi tinja cair', B: 'Rapid Diagnostic Test', C: 'Rumple-Leede', D: 'RR ≥60/menit',
    E: 'Disentri berat', F: 'Nelwan score', G: 'urine berwarna gelap', H: '>38,5°C',
    J: 'uji ELISA untuk Influenza A', K: 'ruam makulopapular', L: 'pseudomembran', M: 'inspiratory whoop',
    N: 'kurang dari 15 tahun', P: 'menularkan rabies', Q: 'Antraks Meningitis', R: 'conjunctival suffusion',
    S: 'dehidrasi berat', U: 'ubun-ubun besar cembung', V: 'kejang rangsangan', W: 'riwayat luka',
    Y: 'batuk <10 hari', Z: 'hubungan epidemiologis', AA: 'sakit tenggorokan', AC: 'RT-PCR',
  };
  const diseaseDefinitions = Object.fromEntries(w2Form.data.indicators.filter(item => !item.is_total).map(item => [item.indicator_code, item.definition]));
  assert.equal(Object.keys(diseaseDefinitions).length, 24, 'W2 disease catalogue no longer contains 24 definitions');
  for (const [code, marker] of Object.entries(definitionMarkers)) {
    assert.match(diseaseDefinitions[code] || '', new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `Operational definition ${code} is missing or incomplete`);
  }
  const diseaseCodes = w2Form.data.indicators.filter(item => !item.is_total).map(item => item.indicator_code);
  const values = Object.fromEntries(w2Form.data.indicators.map(item => [item.indicator_code, {
    cases: item.indicator_code === 'B' || item.indicator_code === 'X' ? 1 : 0,
    lab: 0,
  }]));
  const caseDetail = {
    indicator_code: 'B', patient_name: 'Regression Patient', age_value: 30, age_unit: 'YEAR', sex: 'L',
    village_code: 'NOT-A-VILLAGE', address: 'Regression address', phone: '081234567890',
    onset_date: epiWeekStart(2026, 28), visit_date: epiWeekStart(2026, 28), lab_status: 'PENDING',
  };
  const w2Body = {
    source_id: faskes.data.source_id, epi_year: 2026, epi_week: 28, values, case_details: [caseDetail], notes: '', action: 'SUBMITTED',
    reviewed_codes: diseaseCodes, total_visits_reviewed: true,
  };
  const badVillage = await api('/api/ibs/w2', { method: 'POST', cookie: faskesCookie, body: w2Body });
  assert.equal(badVillage.status, 400);
  assert.match(badVillage.data.error, /Desa pada rincian kasus tidak valid/);
  const zeroVisitValues = Object.fromEntries(w2Form.data.indicators.map(item => [item.indicator_code, { cases: 0, lab: 0 }]));
  const zeroW2Body = {
    source_id: faskes.data.source_id, epi_year: 2026, epi_week: 27, values: zeroVisitValues, case_details: [], notes: '', action: 'SUBMITTED',
    reviewed_codes: diseaseCodes, total_visits_reviewed: true,
  };
  const unconfirmedZeroVisits = await api('/api/ibs/w2', { method: 'POST', cookie: admin, body: zeroW2Body });
  assert.equal(unconfirmedZeroVisits.status, 409);
  assert.match(unconfirmedZeroVisits.data.error, /tidak ada kunjungan/);
  const confirmedZeroVisits = await api('/api/ibs/w2', {
    method: 'POST', cookie: admin, body: { ...zeroW2Body, zero_visits_confirmed: true },
  });
  assert.equal(confirmedZeroVisits.status, 201, JSON.stringify(confirmedZeroVisits.data));
  const lateW2 = await api('/api/ibs/w2', {
    method: 'POST', cookie: faskesCookie,
    body: { ...w2Body, case_details: [{ ...caseDetail, village_code: 'DEMO-A' }] },
  });
  assert.equal(lateW2.status, 409, JSON.stringify(lateW2.data));
  assert.match(lateW2.data.error, /Senin pukul 09\.00 WIB/);
  const w2 = await api('/api/ibs/w2', {
    method: 'POST', cookie: admin,
    body: { ...w2Body, case_details: [{ ...caseDetail, village_code: 'LUAR_WILAYAH' }] },
  });
  assert.equal(w2.status, 201, JSON.stringify(w2.data));

  const verifier = await login('verifier@test.local', 'Survantara-Uji!Akses-2026');
  const verifierDetail = await api(`/api/ibs/w2-submissions/${w2.data.submission_id}`, { cookie: verifier });
  assert.equal(verifierDetail.status, 200);
  assert.equal(verifierDetail.data.can_view_local_details, false);
  assert.deepEqual(verifierDetail.data.case_details, []);
  assert.doesNotMatch(JSON.stringify(verifierDetail.data), /Regression Patient/);

  const adminDetail = await api(`/api/ibs/w2-submissions/${w2.data.submission_id}`, { cookie: admin });
  assert.equal(adminDetail.status, 200);
  assert.equal(adminDetail.data.can_view_local_details, true);
  assert.equal(adminDetail.data.case_details[0].patient_name, 'Regression Patient');
  assert.equal(adminDetail.data.case_details[0].village_code, 'LUAR_WILAYAH');

  const revisedValues = structuredClone(values);
  revisedValues.B.cases = 2;
  revisedValues.X.cases = 2;
  const revisionRequest = await api('/api/ibs/w2', {
    method: 'POST', cookie: faskesCookie,
    body: { ...w2Body, values: revisedValues, case_details: [{ ...caseDetail, village_code: 'DEMO-A' }] },
  });
  assert.equal(revisionRequest.status, 202, JSON.stringify(revisionRequest.data));
  assert.equal(revisionRequest.data.approval_status, 'PENDING');
  const pendingRevisions = await api('/api/admin/ibs/revision-requests', { cookie: admin });
  assert.equal(pendingRevisions.status, 200);
  assert.ok(pendingRevisions.data.some(item => item.request_id === revisionRequest.data.request_id));
  const approvedRevision = await api(`/api/admin/ibs/revision-requests/${revisionRequest.data.request_id}/decision`, {
    method: 'POST', cookie: admin, body: { decision: 'APPROVED', notes: 'Regression approval' },
  });
  assert.equal(approvedRevision.status, 200, JSON.stringify(approvedRevision.data));
  assert.equal(approvedRevision.data.revision, 2);

  const dashboard = await api('/api/ibs/dashboard?epi_year=2026&epi_week=28', { cookie: viewer });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.data.completeness.w2.expected, dashboard.data.w2_completeness.length);
  assert.ok(dashboard.data.completeness.w2.expected >= 2);
  assert.equal(dashboard.data.completeness.w2.submitted, 1);
  const submittedSource = dashboard.data.w2_completeness.find(row => row.source_id === faskes.data.source_id);
  const missingSource = dashboard.data.w2_completeness.find(row => row.source_id === missingFaskes.data.source_id);
  assert.equal(submittedSource.source_code, 'TEST-FASKES-EDIT');
  assert.equal(submittedSource.source_name, 'Test Faskes Diperbarui');
  assert.equal(submittedSource.submission_id, w2.data.submission_id);
  assert.equal(missingSource.source_name, 'Faskes Belum Lapor');
  assert.equal(missingSource.submission_id, null);
  assert.equal(dashboard.data.completeness.schools.expected, dashboard.data.school_completeness.length);
  const submittedSchool = dashboard.data.school_completeness.find(row => row.source_id === school.data.source_id);
  assert.equal(submittedSchool.source_name, 'Test School');
  assert.equal(submittedSchool.sick_absent_count, 8);
  assert.equal(submittedSchool.revision, 2);
  assert.equal(Number(dashboard.data.school_summary.sick), 8);
  const schoolDetail = await api(`/api/ibs/school-submissions/${schoolSubmission.data.submission_id}`, { cookie: viewer });
  assert.equal(schoolDetail.status, 200);
  assert.equal(schoolDetail.data.submission.source_name, 'Test School');
  assert.deepEqual(schoolDetail.data.revisions.map(row => Number(row.revision)), [2, 1]);
  const schoolExport = await api('/api/ibs/school-export?epi_year=2026&epi_week=28', { cookie: viewer });
  assert.equal(schoolExport.status, 200);
  assert.match(schoolExport.data, /TEST-SCHOOL/);
  assert.match(schoolExport.data, /Batuk pilek kelas 4/);
  const changedEnrollment = await api('/api/ibs/school', {
    method: 'POST', cookie: schoolCookie,
    body: { epi_year: 2026, epi_week: 30, enrolled_count: 105, sick_absent_count: 0, notes: '', expected_revision: 0, confirmed: true },
  });
  assert.equal(changedEnrollment.status, 201);
  assert.equal(changedEnrollment.data.enrollment_default_updated, true);
  const changedEnrollmentForm = await api('/api/ibs/school?epi_year=2026&epi_week=30', { cookie: schoolCookie });
  assert.equal(changedEnrollmentForm.data.enrollment.default_count, 105);
  assert.equal(changedEnrollmentForm.data.enrollment.review_required, false);
  assert.ok(dashboard.data.markers.length > 0);
  assert.equal(dashboard.data.pending_marker_count, dashboard.data.markers.filter(row => !row.reviewed_at).length);
  const markerId = dashboard.data.markers[0].marker_id;
  assert.equal((await api(`/api/ibs/markers/${markerId}/review`, {
    method: 'POST', cookie: viewer, body: { notes: 'Viewer must not mutate' },
  })).status, 403);
  assert.equal((await api(`/api/ibs/markers/${markerId}/review`, {
    method: 'POST', cookie: admin, body: { notes: 'Reviewed in regression test' },
  })).status, 200);
  const reviewedDashboard = await api('/api/ibs/dashboard?epi_year=2026&epi_week=28', { cookie: admin });
  assert.equal(reviewedDashboard.data.pending_marker_count, dashboard.data.pending_marker_count - 1);

  const resetSource = await api(`/api/admin/ibs/sources/${faskes.data.source_id}/reset-pin`, {
    method: 'POST', cookie: admin, body: { pin: '654321' },
  });
  assert.equal(resetSource.status, 200);
  assert.equal((await api('/api/ibs/me', { cookie: faskesCookie })).status, 401, 'Old routine cookie survived PIN reset');

  const indicator = await api('/api/admin/ibs/indicators', {
    method: 'POST', cookie: admin,
    body: { indicator_code: 'TEST_ONLY', indicator_name: 'Regression indicator', sort_order: 999, identity_policy: 'OPTIONAL' },
  });
  assert.equal(indicator.status, 201);
  const indicatorPolicies = await api('/api/admin/ibs/indicators', { cookie: admin });
  assert.equal(indicatorPolicies.status, 200);
  assert.equal(indicatorPolicies.data.find(item => item.indicator_code === 'TEST_ONLY').identity_policy, 'OPTIONAL');
  assert.equal(Number(indicatorPolicies.data.find(item => item.indicator_code === 'TEST_ONLY').lab_tracking), 1);
  assert.equal((await api('/api/admin/ibs/indicators/TEST_ONLY/identity-policy', {
    method: 'POST', cookie: viewer, body: { identity_policy: 'REQUIRED' },
  })).status, 403);
  assert.equal((await api('/api/admin/ibs/indicators/TEST_ONLY/identity-policy', {
    method: 'POST', cookie: admin, body: { identity_policy: 'NONE' },
  })).status, 400);
  assert.equal((await api('/api/admin/ibs/indicators/X/identity-policy', {
    method: 'POST', cookie: admin, body: { identity_policy: 'REQUIRED' },
  })).status, 409);
  const changedIdentityPolicy = await api('/api/admin/ibs/indicators/TEST_ONLY/identity-policy', {
    method: 'POST', cookie: admin, body: { identity_policy: 'REQUIRED' },
  });
  assert.equal(changedIdentityPolicy.status, 200, JSON.stringify(changedIdentityPolicy.data));
  assert.equal(changedIdentityPolicy.data.identity_policy, 'REQUIRED');
  const policyW2Form = await api(`/api/ibs/w2?source_id=${encodeURIComponent(faskes.data.source_id)}&epi_year=2026&epi_week=30`, { cookie: admin });
  assert.equal(policyW2Form.status, 200);
  assert.equal(policyW2Form.data.indicators.find(item => item.indicator_code === 'TEST_ONLY').identity_policy, 'REQUIRED');
  assert.equal((await api('/api/admin/ibs/indicators/TEST_ONLY/lab-tracking', {
    method: 'POST', cookie: viewer, body: { lab_tracking: 0 },
  })).status, 403);
  assert.equal((await api('/api/admin/ibs/indicators/TEST_ONLY/lab-tracking', {
    method: 'POST', cookie: admin, body: { lab_tracking: 2 },
  })).status, 400);
  assert.equal((await api('/api/admin/ibs/indicators/X/lab-tracking', {
    method: 'POST', cookie: admin, body: { lab_tracking: 1 },
  })).status, 409);
  const disabledLabTracking = await api('/api/admin/ibs/indicators/TEST_ONLY/lab-tracking', {
    method: 'POST', cookie: admin, body: { lab_tracking: 0 },
  });
  assert.equal(disabledLabTracking.status, 200, JSON.stringify(disabledLabTracking.data));
  assert.equal(Number(disabledLabTracking.data.lab_tracking), 0);
  const disabledLabForm = await api(`/api/ibs/w2?source_id=${encodeURIComponent(faskes.data.source_id)}&epi_year=2026&epi_week=31`, { cookie: admin });
  assert.equal(disabledLabForm.status, 200);
  assert.equal(Number(disabledLabForm.data.indicators.find(item => item.indicator_code === 'TEST_ONLY').lab_tracking), 0);
  const disabledLabValues = Object.fromEntries(disabledLabForm.data.indicators.map(item => [item.indicator_code, {
    cases: item.indicator_code === 'TEST_ONLY' ? 1 : 0,
    lab: item.indicator_code === 'TEST_ONLY' ? 1 : 0,
  }]));
  const disabledLabDraft = await api('/api/ibs/w2', {
    method: 'POST', cookie: admin,
    body: { source_id: faskes.data.source_id, epi_year: 2026, epi_week: 31, values: disabledLabValues, case_details: [], notes: '', action: 'DRAFT' },
  });
  assert.equal(disabledLabDraft.status, 201, JSON.stringify(disabledLabDraft.data));
  const storedDisabledLabForm = await api(`/api/ibs/w2?source_id=${encodeURIComponent(faskes.data.source_id)}&epi_year=2026&epi_week=31`, { cookie: admin });
  assert.equal(Number(storedDisabledLabForm.data.indicators.find(item => item.indicator_code === 'TEST_ONLY').lab_examined_count), 0,
    'A disabled laboratory field accepted a non-zero value');
  assert.equal((await api(`/api/admin/ibs/w2-submissions/${disabledLabDraft.data.submission_id}`, {
    method: 'DELETE', cookie: admin, body: { reason: 'Laboratory tracking regression cleanup' },
  })).status, 200);
  assert.equal((await api('/api/admin/ibs/indicators/lab-tracking', {
    method: 'POST', cookie: viewer, body: { lab_tracking: 0 },
  })).status, 403);
  const disableAllLabTracking = await api('/api/admin/ibs/indicators/lab-tracking', {
    method: 'POST', cookie: admin, body: { lab_tracking: 0 },
  });
  assert.equal(disableAllLabTracking.status, 200, JSON.stringify(disableAllLabTracking.data));
  const allLabDisabled = await api('/api/admin/ibs/indicators', { cookie: admin });
  assert.ok(allLabDisabled.data.filter(item => Number(item.active) && !Number(item.is_total)).every(item => Number(item.lab_tracking) === 0));
  assert.equal(Number(allLabDisabled.data.find(item => item.indicator_code === 'X').lab_tracking), 0,
    'Bulk laboratory setting altered Total Kunjungan');
  const allLabDisabledW2Form = await api(`/api/ibs/w2?source_id=${encodeURIComponent(faskes.data.source_id)}&epi_year=2026&epi_week=32`, { cookie: admin });
  assert.equal(allLabDisabledW2Form.status, 200);
  assert.ok(allLabDisabledW2Form.data.indicators.filter(item => !Number(item.is_total)).every(item => Number(item.lab_tracking) === 0));
  const enableAllLabTracking = await api('/api/admin/ibs/indicators/lab-tracking', {
    method: 'POST', cookie: admin, body: { lab_tracking: 1 },
  });
  assert.equal(enableAllLabTracking.status, 200, JSON.stringify(enableAllLabTracking.data));
  const allLabEnabled = await api('/api/admin/ibs/indicators', { cookie: admin });
  assert.ok(allLabEnabled.data.filter(item => Number(item.active) && !Number(item.is_total)).every(item => Number(item.lab_tracking) === 1));
  const invalidThreshold = await api('/api/admin/ibs/thresholds', {
    method: 'POST', cookie: admin, body: { target_type: 'W2', target_code: 'ISPA', minimum_value: 3 },
  });
  assert.equal(invalidThreshold.status, 400);
  assert.equal((await api('/api/admin/ibs/thresholds', {
    method: 'POST', cookie: admin, body: { target_type: 'W2', target_code: 'TEST_ONLY', minimum_value: 3 },
  })).status, 200);
  assert.equal((await api('/api/admin/ibs/indicators/TEST_ONLY/status', {
    method: 'POST', cookie: admin, body: { active: 0, reason: 'Indikator hanya digunakan untuk pengujian' },
  })).status, 200);
  assert.equal((await api('/api/admin/ibs/locks', {
    method: 'POST', cookie: admin, body: { epi_year: 2024, epi_week: 1 },
  })).status, 200);
  const locks = await api('/api/admin/ibs/locks', { cookie: admin });
  assert.equal(locks.status, 200);
  assert.ok(locks.data.some(lock => Number(lock.epi_year) === 2024 && Number(lock.epi_week) === 1));
  assert.equal((await api('/api/admin/ibs/locks', {
    method: 'DELETE', cookie: admin, body: { epi_year: 2024, epi_week: 1, reason: '' },
  })).status, 400);
  assert.equal((await api('/api/admin/ibs/locks', {
    method: 'DELETE', cookie: admin, body: { epi_year: 2024, epi_week: 1, reason: 'Periode dikunci hanya untuk pengujian' },
  })).status, 200);
  const locksAfterUnlock = await api('/api/admin/ibs/locks', { cookie: admin });
  assert.ok(!locksAfterUnlock.data.some(lock => Number(lock.epi_year) === 2024 && Number(lock.epi_week) === 1));

  // Admin can enter routine reports on behalf of an institution, while other
  // staff roles remain unable to impersonate reporting sources.
  assert.equal((await api(`/api/ibs/w2?epi_year=2026&epi_week=30&source_id=${encodeURIComponent(faskes.data.source_id)}`, { cookie: viewer })).status, 403);
  const adminW2Form = await api(`/api/ibs/w2?epi_year=2026&epi_week=30&source_id=${encodeURIComponent(faskes.data.source_id)}`, { cookie: admin });
  assert.equal(adminW2Form.status, 200);
  assert.equal(adminW2Form.data.administrative_entry, true);
  const zeroValues = Object.fromEntries(adminW2Form.data.indicators.map(item => [item.indicator_code, { cases: 0, lab: 0 }]));
  const adminW2Draft = await api('/api/ibs/w2', {
    method: 'POST', cookie: admin,
    body: { source_id: faskes.data.source_id, epi_year: 2026, epi_week: 30, values: zeroValues, case_details: [], notes: 'Admin entry', action: 'DRAFT' },
  });
  assert.equal(adminW2Draft.status, 201, JSON.stringify(adminW2Draft.data));
  assert.equal((await api(`/api/admin/ibs/w2-submissions/${adminW2Draft.data.submission_id}`, {
    method: 'DELETE', cookie: viewer, body: { reason: 'Must be forbidden' },
  })).status, 403);
  assert.equal((await api(`/api/admin/ibs/w2-submissions/${adminW2Draft.data.submission_id}`, {
    method: 'DELETE', cookie: admin, body: { reason: 'Administrative W2 deletion test' },
  })).status, 200);

  assert.equal((await api(`/api/ibs/school?epi_year=2026&epi_week=30&source_id=${encodeURIComponent(school.data.source_id)}`, { cookie: viewer })).status, 403);
  const adminSchoolForm = await api(`/api/ibs/school?epi_year=2026&epi_week=30&source_id=${encodeURIComponent(school.data.source_id)}`, { cookie: admin });
  assert.equal(adminSchoolForm.status, 200);
  assert.equal(adminSchoolForm.data.administrative_entry, true);
  const adminSchoolEdit = await api('/api/ibs/school', {
    method: 'POST', cookie: admin,
    body: { source_id: school.data.source_id, epi_year: 2026, epi_week: 30, enrolled_count: 106, sick_absent_count: 0, notes: 'Admin correction', expected_revision: 1, confirmed: true },
  });
  assert.equal(adminSchoolEdit.status, 200, JSON.stringify(adminSchoolEdit.data));
  assert.equal((await api(`/api/admin/ibs/school-submissions/${changedEnrollment.data.submission_id}`, {
    method: 'DELETE', cookie: admin, body: { reason: 'Administrative school deletion test' },
  })).status, 200);

  const thresholds = await api('/api/admin/ibs/thresholds', { cookie: admin });
  const testThreshold = thresholds.data.find(item => item.target_type === 'W2' && item.target_code === 'TEST_ONLY');
  assert.ok(testThreshold);
  assert.equal((await api(`/api/admin/ibs/thresholds/${testThreshold.threshold_id}`, {
    method: 'DELETE', cookie: admin, body: { reason: 'Threshold deletion test' },
  })).status, 200);

  // SBM: owner-only decisions, private cadre workspace, negative results, and atomic daily limits.
  assert.equal((await api('/api/sbm/workspace', { cookie: admin })).status, 403);
  assert.equal((await api('/api/sbm/workspace')).status, 401);
  const ownerCreated = await api('/api/admin/users', {method:'POST',cookie:admin,body:{email:'manager@example.test',name:'Surveillance Owner',role:'ADMIN',password:'Survantara-Uji!Akses-2026'}});
  assert.equal(ownerCreated.status,201,JSON.stringify(ownerCreated.data));
  const sbmOwner = await login('manager@example.test','Survantara-Uji!Akses-2026');
  assert.equal((await api('/api/me',{cookie:sbmOwner})).data.can_manage_surveillance,true);
  assert.equal((await api('/api/me',{cookie:admin})).data.can_manage_surveillance,false);
  const sbmCadreLogin = await api('/api/auth/cadre-login',{method:'POST',body:{cadre_code:'TEST-CADRE-EDIT',pin:'654321'}});
  assert.equal(sbmCadreLogin.status,200);
  const sbmReportId=cadrePersonIllness.data.report_id;
  const sbmScreen={decision:'FOLLOW_UP',quality:'REASONABLE',priority:'SEDANG',timeliness:'UNKNOWN',completeness:'PARTIAL',cadre_needed:true,notes:'Reasonable early signal; not a diagnosis.'};
  assert.equal((await api(`/api/sbm/reports/${sbmReportId}/screening`,{method:'POST',cookie:admin,body:sbmScreen})).status,403);
  assert.equal((await api(`/api/sbm/reports/${sbmReportId}/screening`,{method:'POST',cookie:sbmOwner,body:{...sbmScreen,decision:'CLARIFY',question:'When did symptoms start?'}})).status,200);
  const ownClarifications=await api('/api/sbm/mine',{cookie:sbmCadreLogin.cookie});
  assert.equal(ownClarifications.data.clarifications.length,1);
  assert.ok(!('candidates' in ownClarifications.data));
  const clarificationId=ownClarifications.data.clarifications[0].clarification_id;
  const otherCadre=await api('/api/admin/cadres',{method:'POST',cookie:admin,body:{cadre_code:'SBM-OTHER-CADRE',name:'Other Cadre',nickname:'Other',pin:'918273',village_code:'DEMO-A'}});
  assert.equal(otherCadre.status,201);
  const otherCadreLogin=await api('/api/auth/cadre-login',{method:'POST',body:{cadre_code:'SBM-OTHER-CADRE',pin:'918273'}});
  assert.deepEqual((await api('/api/cadre/reports',{cookie:otherCadreLogin.cookie})).data.summary,{total:0,pending:0,review:0,closed:0});
  assert.equal((await api('/api/sbm/mine',{cookie:otherCadreLogin.cookie})).data.clarifications.length,0);
  assert.equal((await api(`/api/sbm/clarifications/${clarificationId}/answer`,{method:'POST',cookie:otherCadreLogin.cookie,body:{answer:'Not my report'}})).status,409);
  assert.equal((await api(`/api/sbm/clarifications/${clarificationId}/answer`,{method:'POST',cookie:sbmCadreLogin.cookie,body:{answer:'Yesterday'}})).status,200);
  assert.equal((await api(`/api/sbm/clarifications/${clarificationId}/answer`,{method:'POST',cookie:sbmCadreLogin.cookie,body:{answer:'Overwrite'}})).status,409);

  // Stage 1: report inbox, independent status workflow, scoped clarification and audit.
  const ebsCreated = await api('/api/cadre/reports',{method:'POST',cookie:sbmCadreLogin.cookie,
    body:{...cadreTaxonomyBase,signal_code:'PERSON_ILLNESS',location_text:'EBS Stage One landmark',affected_group:'SCHOOL_AGE',severe_cases:1,hospitalized_cases:1,context_codes:['ANIMAL_BITE'],initial_action:'Contacted village midwife'}});
  assert.equal(ebsCreated.status,201,JSON.stringify(ebsCreated.data));
  const ebsId=ebsCreated.data.report_id, ebsPath=`/api/ebs/reports/${ebsId}`;
  const ebsGet=()=>api(ebsPath,{cookie:admin});
  const ebsStatus=status=>api(ebsPath+'/status',{method:'POST',cookie:admin,body:{status}});
  const saveDecision=async(reportId,changes={},cookie=admin)=>{
    const current=(await api('/api/reports/'+reportId,{cookie:admin})).data.report;
    return api('/api/ebs/reports/'+reportId+'/decision',{method:'POST',cookie,body:{expected_updated_at:current.updated_at,outcome:'NOT_CONFIRMED',verification_method:'Telepon',notes:'Sumber dikonfirmasi; sinyal tidak terkonfirmasi.',...changes}});
  };
  const validateReport=async(reportId,status='VALID',changes={},cookie=admin)=>{
    const current=(await api('/api/reports/'+reportId,{cookie:admin})).data.report;
    return api(`/api/ebs/reports/${reportId}/validation`,{method:'POST',cookie,body:{status,notes:'Admin reviewed the information; sufficiently clear for verification.',expected_updated_at:current.updated_at,...changes}});
  };
  assert.equal((await api('/api/ebs/reports')).status,401);
  const fullEbsDetail=(await ebsGet()).data.report;
  assert.equal(fullEbsDetail.workflow_status,'SUBMITTED');
  assert.equal(fullEbsDetail.affected_group,'SCHOOL_AGE');
  assert.equal(fullEbsDetail.severe_cases,1);
  assert.equal(fullEbsDetail.hospitalized_cases,1);
  assert.equal(fullEbsDetail.initial_action,'Contacted village midwife');
  assert.ok(fullEbsDetail.context_labels);
  assert.equal((await api('/api/dashboard',{cookie:admin})).data.pending_reports,(await api('/api/ebs/reports',{cookie:admin})).data.total);
  assert.ok((await api('/api/ebs/reports?q=EBS%20Stage%20One',{cookie:admin})).data.rows.some(r=>r.report_id===ebsId));
  assert.equal((await api('/api/ebs/reports?status=INVALID',{cookie:admin})).status,400);
  assert.equal((await api('/api/ebs/reports?offset=-1',{cookie:admin})).status,400);
  assert.equal((await api('/api/ebs/reports?date_from=2026-10-03&date_to=2026-01-01',{cookie:admin})).status,400);
  assert.equal((await api(ebsPath,{cookie:otherCadreLogin.cookie})).status,404);
  assert.equal((await api(ebsPath,{cookie:viewer})).status,403);
  assert.equal((await api(ebsPath,{cookie:verifier})).status,403);
  assert.equal((await api(`/api/reports/${ebsId}/assign`,{method:'POST',cookie:admin,body:{assigned_to:'verifier@test.local'}})).status,200);
  assert.equal((await api(ebsPath,{cookie:verifier})).status,200);
  const verifierInbox=(await api('/api/ebs/reports',{cookie:verifier})).data.rows;
  assert.ok(verifierInbox.some(r=>r.report_id===ebsId));
  assert.ok(!verifierInbox.some(r=>r.report_id===sbmReportId));
  assert.equal((await api(`${ebsPath}/status`,{method:'POST',cookie:sbmCadreLogin.cookie,body:{status:'CLOSED'}})).status,403);
  assert.equal((await api(`${ebsPath}/clarifications`,{method:'POST',cookie:sbmCadreLogin.cookie,body:{question:'Unauthorized'}})).status,403);
  const readonlyUser=await api('/api/admin/users',{method:'POST',cookie:admin,body:{email:'leadership@test.local',name:'Leadership Test',role:'PIMPINAN',password:'Survantara-Uji!Akses-2026',program:''}});
  assert.equal(readonlyUser.status,201,JSON.stringify(readonlyUser.data));
  const leadership=await login('leadership@test.local','Survantara-Uji!Akses-2026');
  assert.equal((await api(ebsPath,{cookie:leadership})).data.report.workflow_status,'SUBMITTED','Read-only GET starts a review');
  assert.equal((await api(ebsPath+'/review',{method:'POST',cookie:leadership,body:{}})).status,403);
  const starts=await Promise.all([1,2].map(()=>api(ebsPath+'/review',{method:'POST',cookie:admin,body:{}})));
  assert.deepEqual(starts.map(r=>r.status),[200,200]);
  assert.equal((await ebsGet()).data.history.filter(h=>h.old_status==='SUBMITTED'&&h.new_status==='UNDER_REVIEW').length,1);
  assert.equal((await ebsGet()).data.report.workflow_status,'UNDER_REVIEW');
  const legacyBefore=(await api(`/api/reports/${ebsId}`,{cookie:admin})).data.report.current_status;
  for(const [question,cookie] of [['When did it start?',admin],['Do they live nearby?',verifier]]) assert.equal((await api(`${ebsPath}/clarifications`,{method:'POST',cookie,body:{question}})).status,201);
  assert.equal((await ebsGet()).data.report.workflow_status,'NEEDS_CLARIFICATION');
  assert.equal((await ebsStatus('CLOSED')).status,409);
  const ownEbs=(await api(ebsPath,{cookie:sbmCadreLogin.cookie})).data;
  assert.equal(ownEbs.clarifications.length,2);
  assert.ok(!('public_pin_hash' in ownEbs.report));
  for(const key of ['public_pin_salt','triage_reason','triage_rule_version','verified_ebs_id','current_priority']) assert.ok(!(key in ownEbs.report));
  assert.equal((await api(`/api/sbm/clarifications/${ownEbs.clarifications[0].clarification_id}/answer`,{method:'POST',cookie:otherCadreLogin.cookie,body:{answer:'Wrong owner'}})).status,409);
  for(let index=0;index<2;index++) {
    const cid=ownEbs.clarifications[index].clarification_id;
    assert.equal((await api(`/api/sbm/clarifications/${cid}/answer`,{method:'POST',cookie:sbmCadreLogin.cookie,body:{answer:`Answer ${index}`}})).status,200);
    assert.equal((await ebsGet()).data.report.workflow_status,index===0?'NEEDS_CLARIFICATION':'UNDER_REVIEW');
  }
  const answeredEbs=(await ebsGet()).data;
  assert.equal(answeredEbs.clarifications.filter(c=>c.answered_at).length,2);
  assert.ok(answeredEbs.history.some(h=>h.old_status==='SUBMITTED'&&h.new_status==='UNDER_REVIEW'));
  assert.ok(answeredEbs.history.some(h=>h.old_status==='NEEDS_CLARIFICATION'&&h.new_status==='UNDER_REVIEW'));
  assert.equal((await api(`/api/reports/${ebsId}`,{cookie:admin})).data.report.current_status,legacyBefore,'Stage 1 must not promote reports into verification/events');
  assert.equal((await api(`${ebsPath}/status`,{method:'POST',cookie:admin,body:{status:'TERVERIFIKASI'}})).status,409);
  const pendingBeforeClose=(await api('/api/dashboard',{cookie:admin})).data.pending_reports;
  assert.equal((await saveDecision(ebsId)).status,409,'Unvalidated cadre report allowed verification');
  assert.equal((await validateReport(ebsId)).status,200);
  assert.equal((await saveDecision(ebsId)).status,200);
  assert.equal((await api('/api/dashboard',{cookie:admin})).data.pending_reports,pendingBeforeClose-1);
  assert.equal((await api('/api/dashboard',{cookie:verifier})).data.pending_reports,(await api('/api/ebs/reports',{cookie:verifier})).data.total);
  assert.equal((await api(`/api/ebs/reports?q=${ebsId}`,{cookie:admin})).data.total,0);
  assert.equal((await api(`/api/ebs/reports?view=all&q=${ebsId}&status=CLOSED`,{cookie:admin})).data.total,1);
  assert.equal((await api(`${ebsPath}/clarifications`,{method:'POST',cookie:admin,body:{question:'After closure'}})).status,409);
  assert.equal((await ebsStatus('UNDER_REVIEW')).status,409);
  const oldest=(await api('/api/ebs/reports?view=all&sort=oldest',{cookie:admin})).data.rows;
  assert.deepEqual(oldest.map(r=>r.submitted_at),oldest.map(r=>r.submitted_at).sort());
  assert.equal((await api('/api/ebs/reports?village_code=NO_SUCH_VILLAGE',{cookie:admin})).data.total,0);
  assert.ok((await api('/api/ebs/reports?view=all&event_type=PERSON_ILLNESS',{cookie:admin})).data.rows.every(r=>r.event_type==='PERSON_ILLNESS'));
  const ebsAudit=JSON.parse(runWrangler(['d1','execute','sbm-db','--local','--persist-to',persistence,'--json',
    '--command',`SELECT action,user_email FROM audit_log WHERE entity_id='${ebsId}' AND action LIKE 'EBS_%'`]))[0].results;
  for(const action of ['EBS_OPEN','EBS_STATUS','EBS_CLARIFICATION_REQUEST','EBS_CLARIFICATION_ANSWER','EBS_DECISION']) assert.ok(ebsAudit.some(r=>r.action===action),`Missing ${action}`);
  assert.ok(ebsAudit.filter(r=>r.action==='EBS_CLARIFICATION_ANSWER').every(r=>r.user_email===cadre.data.reporter_id));
  // Unified workspace: safe start, one history entry, and ongoing work after review closure.
  const journeyCreated=await api('/api/cadre/reports',{method:'POST',cookie:sbmCadreLogin.cookie,body:{...cadreTaxonomyBase,signal_code:'PERSON_ILLNESS'}});
  assert.equal(journeyCreated.status,201);
  const journeyId=journeyCreated.data.report_id,journeyPath=`/api/ebs/reports/${journeyId}`;
  assert.equal((await api(`${journeyPath}/start-verification`,{method:'POST',cookie:viewer,body:{}})).status,403);
  assert.equal((await api(`${journeyPath}/start-verification`,{method:'POST',cookie:verifier,body:{}})).status,403);
  assert.equal((await api(`${journeyPath}/start-verification`,{method:'POST',cookie:sbmCadreLogin.cookie,body:{}})).status,403);
  assert.equal((await api(`${journeyPath}/clarifications`,{method:'POST',cookie:admin,body:{question:'Confirm timing before verification'}})).status,201);
  assert.equal((await api(`${journeyPath}/start-verification`,{method:'POST',cookie:admin,body:{}})).status,409);
  const journeyQuestion=(await api(journeyPath,{cookie:admin})).data.clarifications[0].clarification_id;
  assert.equal((await api(`/api/sbm/clarifications/${journeyQuestion}/answer`,{method:'POST',cookie:sbmCadreLogin.cookie,body:{answer:'Yesterday'}})).status,200);
  assert.equal((await api(`${journeyPath}/start-verification`,{method:'POST',cookie:admin,body:{}})).status,409,'Verification started before admin validity decision');
  assert.equal((await validateReport(journeyId)).status,200);
  const journeyStarts=await Promise.all([1,2].map(()=>api(`${journeyPath}/start-verification`,{method:'POST',cookie:admin,body:{}})));
  assert.deepEqual(journeyStarts.map(r=>r.status).sort(),[200,409]);
  const journeyDetail=(await api(`/api/reports/${journeyId}`,{cookie:admin})).data;
  assert.equal(journeyDetail.report.current_status,'SEDANG_DIVERIFIKASI');
  assert.equal(journeyDetail.history.filter(h=>h.new_status==='SEDANG_DIVERIFIKASI').length,1);
  assert.equal((await api(journeyPath+'/status',{method:'POST',cookie:admin,body:{status:'CLOSED',notes:'Information only'}})).status,409,'Partial closure remains available');
  assert.equal((await saveDecision(journeyId,{notes:''})).status,400);
  assert.equal((await saveDecision(journeyId,{outcome:'UNVERIFIABLE'},viewer)).status,403);
  assert.equal((await api(journeyPath+'/decision',{method:'POST',cookie:verifier,body:{}})).status,403);
  assert.equal((await api(journeyPath+'/decision',{method:'POST',cookie:sbmCadreLogin.cookie,body:{}})).status,403);
  const staleVersion=(await api('/api/reports/'+journeyId,{cookie:admin})).data.report.updated_at;
  assert.equal((await api(journeyPath+'/clarifications',{method:'POST',cookie:admin,body:{question:'One more clarification'}})).status,201);
  assert.equal((await saveDecision(journeyId)).status,409,'Pending questions do not block final decision');
  assert.equal((await api('/api/ebs/reports?status=UNDER_REVIEW&q='+journeyId,{cookie:admin})).data.total,1,'Reviewed filter excludes reports awaiting answers');
  const pendingQuestion=(await api(journeyPath,{cookie:admin})).data.clarifications.find(c=>!c.answered_at).clarification_id;
  assert.equal((await api('/api/sbm/clarifications/'+pendingQuestion+'/answer',{method:'POST',cookie:sbmCadreLogin.cookie,body:{answer:'More information'}})).status,200);
  assert.equal((await api(journeyPath+'/decision',{method:'POST',cookie:admin,body:{expected_updated_at:staleVersion,outcome:'UNVERIFIABLE',verification_method:'Telepon',notes:'Information insufficient'}})).status,409,'A stale draft overwrites newer clarification');
  const version=(await api('/api/reports/'+journeyId,{cookie:admin})).data.report.updated_at;
  const finalPayload={expected_updated_at:version,outcome:'UNVERIFIABLE',verification_method:'Telepon',notes:'Kontak sudah dicoba; informasi belum cukup untuk memastikan.'};
  const competing=await Promise.all(['First decision','Second decision'].map(notes=>api(journeyPath+'/decision',{method:'POST',cookie:admin,body:{...finalPayload,notes}})));
  assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
  const cadreJourney=(await api(journeyPath,{cookie:sbmCadreLogin.cookie})).data;
  assert.equal(cadreJourney.handling.status,'SELESAI');
  assert.equal(cadreJourney.report.workflow_status,'CLOSED');
  assert.equal(cadreJourney.decision.outcome,'UNVERIFIABLE');
  assert.equal(cadreJourney.decision.actual_cases,null,'Unknown count becomes zero');
  assert.ok(!('decided_by' in cadreJourney.decision));
  const repeat=await api(journeyPath+'/decision',{method:'POST',cookie:admin,body:{...finalPayload,notes:cadreJourney.decision.notes}});
  assert.equal(repeat.status,200);assert.equal(repeat.data.already_saved,true);
  const savedRows=JSON.parse(runWrangler(['d1','execute','sbm-db','--local','--persist-to',persistence,'--json','--command',"SELECT (SELECT COUNT(*) FROM report_decisions WHERE report_id='"+journeyId+"') decisions,(SELECT COUNT(*) FROM audit_log WHERE entity_id='"+journeyId+"' AND action='EBS_DECISION') audits"]))[0].results[0];
  assert.equal(savedRows.decisions,1);assert.equal(savedRows.audits,1,'Retry duplicates final-decision audit');
  assert.equal((await api('/api/ebs/reports?q='+journeyId,{cookie:admin})).data.total,0);
  assert.equal((await api('/api/dashboard',{cookie:admin})).data.pending_reports,(await api('/api/ebs/reports',{cookie:admin})).data.total);
  // Migration reopens unfinished information-only closures and retains history.
  const oldReport=await api('/api/cadre/reports',{method:'POST',cookie:sbmCadreLogin.cookie,body:{...cadreTaxonomyBase,signal_code:'PERSON_ILLNESS'}});
  const oldId=oldReport.data.report_id;
  runWrangler(['d1','execute','sbm-db','--local','--persist-to',persistence,'--json','--command',"UPDATE reports SET workflow_status='CLOSED',workflow_actor='LEGACY_FIXTURE',workflow_changed_at=submitted_at WHERE report_id='"+oldId+"'"]);
  const migration=await readFile(join(cwd,'migrations/0035_report_review_decisions.sql'),'utf8');
  runWrangler(['d1','execute','sbm-db','--local','--persist-to',persistence,'--json','--command',migration.slice(migration.indexOf('UPDATE reports SET workflow_status='))]);
  const recovered=(await api('/api/ebs/reports/'+oldId,{cookie:admin})).data;
  assert.equal(recovered.report.workflow_status,'UNDER_REVIEW');
  assert.ok(recovered.history.some(h=>h.new_status==='CLOSED'));
  assert.ok(recovered.history.some(h=>h.old_status==='CLOSED'&&h.new_status==='UNDER_REVIEW'));
  // Personal history prioritizes answers across pagination and exposes safe outcomes.
  const otherHistoryBefore=(await api('/api/cadre/reports',{cookie:otherCadreLogin.cookie})).data.summary;
  assert.equal((await api('/api/cadre/reports?view=invalid',{cookie:sbmCadreLogin.cookie})).status,400);
  assert.equal((await api('/api/cadre/reports?offset=-1',{cookie:sbmCadreLogin.cookie})).status,400);
  assert.equal((await api('/api/ebs/reports/'+oldId+'/clarifications',{method:'POST',cookie:admin,body:{question:'Older report needs an answer'}})).status,201);
  const historyFixtureIds=[];
  for(let i=0;i<9;i++) {
    const result=await api('/api/cadre/reports',{method:'POST',cookie:sbmCadreLogin.cookie,body:{...cadreTaxonomyBase,signal_code:'PERSON_ILLNESS',location_text:'History priority fixture '+i}});
    assert.equal(result.status,201);historyFixtureIds.push(result.data.report_id);
  }
  const priorityHistory=(await api('/api/cadre/reports?limit=2',{cookie:sbmCadreLogin.cookie})).data;
  assert.equal(priorityHistory.rows[0].report_id,oldId,'Older pending report is buried behind the newest reports');
  assert.equal(priorityHistory.rows[0].pending_clarifications,1);
  const pendingHistory=(await api('/api/cadre/reports?view=pending',{cookie:sbmCadreLogin.cookie})).data;
  assert.equal(pendingHistory.total,1);assert.equal(pendingHistory.summary.pending,1);
  const closedHistory=(await api('/api/cadre/reports?view=closed',{cookie:sbmCadreLogin.cookie})).data;
  assert.equal(closedHistory.summary.total,priorityHistory.summary.total);
  assert.equal(closedHistory.total,closedHistory.summary.closed);
  const closedJourney=closedHistory.rows.find(r=>r.report_id===journeyId);
  assert.equal(closedJourney.decision_result,'UNVERIFIABLE');
  assert.ok(!('decided_by' in closedJourney)&&!('verification_method' in closedJourney));
  const reviewingHistory=(await api('/api/cadre/reports?view=review&limit=50',{cookie:sbmCadreLogin.cookie})).data;
  assert.ok(reviewingHistory.rows.every(r=>r.workflow_status!=='CLOSED'));
  assert.equal(reviewingHistory.rows.find(r=>r.report_id===historyFixtureIds[0]).reported_cases_known,1);
  assert.deepEqual((await api('/api/cadre/reports',{cookie:otherCadreLogin.cookie})).data.summary,otherHistoryBefore,'History totals include another cadre');
  const oldQuestion=(await api('/api/ebs/reports/'+oldId,{cookie:sbmCadreLogin.cookie})).data.clarifications.find(c=>!c.answered_at);
  assert.equal((await api('/api/sbm/clarifications/'+oldQuestion.clarification_id+'/answer',{method:'POST',cookie:sbmCadreLogin.cookie,body:{answer:'History priority checked'}})).status,200);
  for(const rid of [sbmReportId,cadreFood.data.report_id]) assert.equal((await api(`/api/sbm/reports/${rid}/screening`,{method:'POST',cookie:sbmOwner,body:sbmScreen})).status,200);
  for(const rid of [sbmReportId,cadreFood.data.report_id])assert.equal((await validateReport(rid)).status,200);
  for(const next of ['DITERIMA','SEDANG_DIVERIFIKASI']) assert.equal((await api(`/api/reports/${sbmReportId}/status`,{method:'POST',cookie:sbmOwner,body:{status:next,notes:'Verification test'}})).status,200);
  assert.equal((await api(`/api/reports/${sbmReportId}/verify`,{method:'POST',cookie:sbmOwner,body:{verification_result:'NOT_CONFIRMED',actual_cases:0,actual_deaths:0,actual_severe_cases:0,notes:'Reasonable signal, investigation negative'}})).status,201);
  const negativeWorkspace=await api(`/api/sbm/workspace?report_id=${sbmReportId}`,{cookie:sbmOwner});
  assert.equal(negativeWorkspace.data.screening.quality,'REASONABLE');
  const negativeDetail=await api(`/api/reports/${sbmReportId}`,{cookie:sbmOwner});
  assert.equal(negativeDetail.data.report.verified_ebs_id,null);
  assert.equal(negativeDetail.data.verifications[0].verification_result,'NOT_CONFIRMED');
  // Event-specific comparisons preserve UNKNOWN and never use OH/report volume as points.
  const candidateUrl=`/api/sbm/reports/${sbmReportId}/candidates/${cadre.data.reporter_id}`;
  const candidateRating={understanding:25,support:25,available:'YES'};
  assert.equal((await api(candidateUrl,{method:'PUT',cookie:admin,body:candidateRating})).status,403);
  assert.equal((await api(candidateUrl,{method:'PUT',cookie:sbmCadreLogin.cookie,body:candidateRating})).status,401);
  assert.equal((await api(candidateUrl,{method:'PUT',cookie:sbmOwner,body:{...candidateRating,support:100}})).status,400);
  assert.equal((await api(candidateUrl,{method:'PUT',cookie:sbmOwner,body:{...candidateRating,support:''}})).status,400);
  const unknownScore=await api(candidateUrl,{method:'PUT',cookie:sbmOwner,body:candidateRating});
  assert.equal(unknownScore.status,200);
  assert.equal(unknownScore.data.performance_score,null);
  assert.equal(unknownScore.data.total_score,null);
  assert.equal(unknownScore.data.relevance_score,50);
  assert.equal(unknownScore.data.eligible,true,'Suitable new/unassessed cadre cannot be selected');
  const unassessedSummary=(await api('/api/sbm/my-score',{cookie:sbmCadreLogin.cookie})).data;
  assert.equal(unassessedSummary.performance_score,null);
  assert.deepEqual(unassessedSummary.components,{information:null,completeness:null,timeliness:null},'Unassessed components became zero');
  const fullScreen={...sbmScreen,timeliness:'TIMELY',completeness:'COMPLETE'};
  for(const rid of [sbmReportId,cadreFood.data.report_id]) assert.equal((await api(`/api/sbm/reports/${rid}/screening`,{method:'POST',cookie:sbmOwner,body:fullScreen})).status,200);
  let scoredCandidate=(await api(`/api/sbm/workspace?report_id=${sbmReportId}`,{cookie:sbmOwner})).data.candidates.find(c=>c.reporter_id===cadre.data.reporter_id);
  assert.equal(scoredCandidate.assessed_count,2);
  assert.equal(scoredCandidate.performance_score,50,'Reasonable negative verification was penalized');
  assert.equal(scoredCandidate.total_score,100);
  assert.equal((await api(`/api/sbm/reports/${cadreFood.data.report_id}/screening`,{method:'POST',cookie:sbmOwner,body:{...fullScreen,quality:'INCOMPLETE',completeness:'PARTIAL',timeliness:'LATE'}})).status,200);
  scoredCandidate=(await api(`/api/sbm/workspace?report_id=${sbmReportId}`,{cookie:sbmOwner})).data.candidates.find(c=>c.reporter_id===cadre.data.reporter_id);
  assert.equal(scoredCandidate.performance_score,33.75);
  assert.equal(scoredCandidate.total_score,83.75);
  const mixedQualitySummary=(await api('/api/sbm/my-score',{cookie:sbmCadreLogin.cookie})).data;
  assert.deepEqual((await api('/api/sbm/my-statistics',{cookie:sbmCadreLogin.cookie})).data.quality,mixedQualitySummary,'Story quality differs from the portal average');
  assert.equal(mixedQualitySummary.assessed_count,2);
  assert.equal(mixedQualitySummary.performance_score,33.75);
  assert.deepEqual(mixedQualitySummary.components,{information:15,completeness:11.25,timeliness:7.5},'Component averages used unassessed reports or a different sample');
  const scoredPlan={activity_date:'2026-07-14',village_code:'DEMO-A',location:'Scored selection fixture',reporter_id:cadre.data.reporter_id,selection_reason:'Suitable and available; officer confirms the selection',report_ids:[sbmReportId],selection_report_id:sbmReportId};
  await api(candidateUrl,{method:'PUT',cookie:sbmOwner,body:{...candidateRating,available:'NO'}});
  assert.equal((await api('/api/sbm/activities',{method:'POST',cookie:sbmOwner,body:scoredPlan})).status,400);
  await api(candidateUrl,{method:'PUT',cookie:sbmOwner,body:{...candidateRating,support:0}});
  assert.equal((await api('/api/sbm/activities',{method:'POST',cookie:sbmOwner,body:scoredPlan})).status,400);
  await api(candidateUrl,{method:'PUT',cookie:sbmOwner,body:candidateRating});
  assert.equal((await api('/api/sbm/activities',{method:'POST',cookie:sbmOwner,body:{...scoredPlan,selection_report_id:cadreFood.data.report_id}})).status,400);
  const scoredActivity=await api('/api/sbm/activities',{method:'POST',cookie:sbmOwner,body:scoredPlan});
  assert.equal(scoredActivity.status,201);
  for(const rid of [sbmReportId,cadreFood.data.report_id]) await api(`/api/sbm/reports/${rid}/screening`,{method:'POST',cookie:sbmOwner,body:sbmScreen});
  const scoreWorkspace=(await api(`/api/sbm/workspace?report_id=${sbmReportId}`,{cookie:sbmOwner})).data;
  assert.equal(scoreWorkspace.candidates.find(c=>c.reporter_id===cadre.data.reporter_id).total_score,null);
  const savedSnapshot=JSON.parse(scoreWorkspace.activities.find(a=>a.activity_id===scoredActivity.data.activity_id).selection_snapshot);
  assert.equal(savedSnapshot.total_score,83.75,'Activity score changed after later report assessment');
  assert.equal(savedSnapshot.history.assessed_count,2);
  assert.equal((await api(`/api/sbm/workspace?report_id=${cadreFood.data.report_id}`,{cookie:sbmOwner})).data.candidates.find(c=>c.reporter_id===cadre.data.reporter_id).assessment,null,'Relevance leaked into another signal');
  assert.ok(!(await api('/api/sbm/mine',{cookie:sbmCadreLogin.cookie})).data.activities.some(a=>'selection_snapshot' in a),'Private comparison leaked to cadre');
  const plan={activity_date:'2026-07-15',village_code:'DEMO-A',location:'Shared visit',reporter_id:cadre.data.reporter_id,selection_reason:'Local knowledge and availability confirmed',report_ids:[sbmReportId,cadreFood.data.report_id]};
  const concurrentPlans=await Promise.all([1,2].map(()=>api('/api/sbm/activities',{method:'POST',cookie:sbmOwner,body:plan})));
  assert.deepEqual(concurrentPlans.map(r=>r.status).sort(),[201,409]);
  const activityId=concurrentPlans.find(r=>r.status===201).data.activity_id;
  assert.equal((await api(`/api/sbm/activities/${activityId}/payment`,{method:'POST',cookie:sbmOwner,body:{payment_status:'APPROVED'}})).status,409);
  assert.equal((await api(`/api/sbm/activities/${activityId}`,{method:'PATCH',cookie:sbmOwner,body:{status:'DONE',result:'Visit completed; cadre absent',officer_attended:true,cadre_attended:false,pe_required:true,pe_reference:'Local investigation reference'}})).status,200);
  assert.equal((await api(`/api/sbm/activities/${activityId}/payment`,{method:'POST',cookie:sbmOwner,body:{payment_status:'PAID',payment_reference:'Must approve first'}})).status,409);
  assert.equal((await api(`/api/sbm/activities/${activityId}/payment`,{method:'POST',cookie:sbmOwner,body:{payment_status:'APPROVED',cadre_oh:100000}})).status,200);
  assert.equal((await api(`/api/sbm/activities/${activityId}/payment`,{method:'POST',cookie:sbmOwner,body:{payment_status:'PAID',payment_reference:'Transfer test'}})).status,200);
  const paidActivity=(await api('/api/sbm/workspace',{cookie:sbmOwner})).data.activities.find(a=>a.activity_id===activityId);
  assert.equal(paidActivity.officer_oh,125000);
  assert.equal(paidActivity.cadre_oh,0,'Absent cadre received OH');
  assert.equal(paidActivity.report_ids.split(',').length,2,'Shared reports generated separate activities');
  const ownActivities=(await api('/api/sbm/mine',{cookie:sbmCadreLogin.cookie})).data.activities;
  assert.equal(ownActivities[0].cadre_oh,0);
  assert.ok(!('selection_reason' in ownActivities[0]));
  assert.ok(!('officer_oh' in ownActivities[0]));
  const secondPlan=await api('/api/sbm/activities',{method:'POST',cookie:sbmOwner,body:{...plan,activity_date:'2026-07-16'}});
  assert.equal(secondPlan.status,201);
  assert.equal((await api(`/api/sbm/activities/${secondPlan.data.activity_id}`,{method:'PATCH',cookie:sbmOwner,body:{status:'CANCELLED',result:'Visit not needed'}})).status,200);
  const replacementPlan=await api('/api/sbm/activities',{method:'POST',cookie:sbmOwner,body:{...plan,activity_date:'2026-07-16'}});
  assert.equal(replacementPlan.status,201,'Cancelled schedule still blocked date');
  assert.equal((await api(`/api/sbm/activities/${replacementPlan.data.activity_id}`,{method:'PATCH',cookie:sbmOwner,body:{status:'DONE',result:'Both participants attended',officer_attended:true,cadre_attended:true}})).status,200);
  for(const payment_status of ['APPROVED','PAID']) assert.equal((await api(`/api/sbm/activities/${replacementPlan.data.activity_id}/payment`,{method:'POST',cookie:sbmOwner,body:{payment_status,payment_reference:'Transfer for both participants'}})).status,200);
  const bothPaid=(await api('/api/sbm/workspace',{cookie:sbmOwner})).data.activities.find(a=>a.activity_id===replacementPlan.data.activity_id);
  assert.equal(bothPaid.officer_oh+bothPaid.cadre_oh,250000);
  assert.equal((await api('/api/sbm/workspace',{cookie:sbmOwner})).data.candidates.find(c=>c.reporter_id===cadre.data.reporter_id).paid_oh_count,1);
  assert.equal((await api('/api/sbm/mine',{cookie:otherCadreLogin.cookie})).data.activities.length,0);
  const futurePlan=await api('/api/sbm/activities',{method:'POST',cookie:sbmOwner,body:{...plan,activity_date:'2099-01-01'}});
  assert.equal(futurePlan.status,201);
  assert.equal((await api(`/api/sbm/activities/${futurePlan.data.activity_id}`,{method:'PATCH',cookie:sbmOwner,body:{status:'DONE',result:'Impossible visit',officer_attended:true,cadre_attended:true}})).status,400);
  assert.equal((await api(`/api/sbm/activities/${activityId}/pe`,{method:'POST',cookie:sbmOwner,body:{pe_reference:'Updated local PE'}})).status,200);
  // Four cadre observations become one unassessed event, then one event-level plan.
  const eventCadres=[{id:cadre.data.reporter_id,cookie:sbmCadreLogin.cookie},{id:otherCadre.data.reporter_id,cookie:otherCadreLogin.cookie}];
  for(let i=0;i<2;i++) {
    const created=await api('/api/admin/cadres',{method:'POST',cookie:admin,body:{cadre_code:`EVENT-CADRE-${i}`,name:`Event Cadre ${i}`,nickname:`Event ${i}`,pin:'573918',village_code:'DEMO-A'}});
    assert.equal(created.status,201);
    const logged=await api('/api/auth/cadre-login',{method:'POST',body:{cadre_code:`EVENT-CADRE-${i}`,pin:'573918'}});
    eventCadres.push({id:created.data.reporter_id,cookie:logged.cookie});
  }
  const emptyStatistics=(await api('/api/sbm/my-statistics',{cookie:eventCadres[3].cookie})).data;
  assert.deepEqual(emptyStatistics.counts,{total:0,reviewed:0,incident_source_reports:0,incidents:0});
  assert.deepEqual(emptyStatistics.quality,{performance_score:null,assessed_count:0,report_count:0,period_months:6,max_score:50,components:{information:null,completeness:null,timeliness:null}});
  assert.equal(emptyStatistics.period.months,6);
  assert.equal((await api('/api/sbm/my-statistics')).status,401);
  assert.equal((await api('/api/sbm/my-statistics',{cookie:admin})).status,401);
  const eventReportIds=[];
  for(const c of eventCadres) {
    const reported=await api('/api/cadre/reports',{method:'POST',cookie:c.cookie,body:{...cadreTaxonomyBase,signal_code:'PERSON_ILLNESS',reported_cases:5,location_text:'Four witnesses, one village event'}});
    assert.equal(reported.status,201);eventReportIds.push(reported.data.report_id);
  }
  const newEventBody={event_title:'Four reports, one unassessed event',program_owner:'P2P',report_ids:[eventReportIds[0]]};
  assert.equal((await api('/api/sbm/events',{method:'POST',cookie:admin,body:newEventBody})).status,403);
  assert.equal((await api('/api/sbm/events',{method:'POST',cookie:eventCadres[0].cookie,body:newEventBody})).status,401);
  const eventCountBefore=(await api('/api/events',{cookie:admin})).data.length;
  assert.equal((await api('/api/sbm/events',{method:'POST',cookie:sbmOwner,body:newEventBody})).status,409,'Unreviewed reports became a signal');
  for(const rid of eventReportIds)assert.equal((await validateReport(rid)).status,200);
  const duplicateCreate=await Promise.all([1,2].map(()=>api('/api/sbm/events',{method:'POST',cookie:sbmOwner,body:newEventBody})));
  assert.deepEqual(duplicateCreate.map(r=>r.status).sort(),[201,409]);
  assert.equal((await api('/api/events',{cookie:admin})).data.length,eventCountBefore+1,'Concurrent grouping left an orphan event');
  const signalEventId=duplicateCreate.find(r=>r.status===201).data.event_id;
  const eventWorkspaceUrl=`/api/sbm/events/${signalEventId}/workspace`;
  let eventWork=(await api(eventWorkspaceUrl,{cookie:sbmOwner})).data;
  assert.equal(eventWork.event.origin,'SIGNAL');assert.equal(eventWork.event.current_status,'DRAFT');
  assert.equal(eventWork.assessment,null);assert.equal(eventWork.needs_reassessment,true);
  const assessEvent=(changes={})=>api(`/api/sbm/events/${signalEventId}/assessment`,{method:'PUT',cookie:sbmOwner,body:{decision:'FIELD',priority:'SEDANG',notes:'Combined sources warrant one field visit',source_revision:eventWork.event.source_revision,...changes}});
  assert.equal((await assessEvent()).status,200);
  for(const report_id of eventReportIds.slice(1))assert.equal((await api(`/api/sbm/events/${signalEventId}/reports`,{method:'POST',cookie:sbmOwner,body:{report_id}})).status,200);
  eventWork=(await api(eventWorkspaceUrl,{cookie:sbmOwner})).data;
  assert.equal(eventWork.reports.length,4);assert.equal(eventWork.event.source_revision,4);
  const gradeUrl=`/api/sbm/events/${signalEventId}/report-quality/${eventReportIds[2]}`;
  const sourceGrade={quality:'REASONABLE',timeliness:'TIMELY',completeness:'COMPLETE',notes:'Reasonable source independently assessed'};
  assert.equal((await api(gradeUrl,{method:'PUT',cookie:sbmOwner,body:sourceGrade})).status,200);
  let gradedWork=(await api(eventWorkspaceUrl,{cookie:sbmOwner})).data;
  assert.equal(gradedWork.candidates.find(c=>c.reporter_id===eventCadres[2].id).performance_score,50);
  assert.equal(gradedWork.reports.find(r=>r.report_id===eventReportIds[2]).quality,'REASONABLE');
  assert.equal((await api(gradeUrl,{method:'PUT',cookie:sbmOwner,body:{...sourceGrade,timeliness:'UNKNOWN'}})).status,200);
  gradedWork=(await api(eventWorkspaceUrl,{cookie:sbmOwner})).data;
  assert.equal(gradedWork.candidates.find(c=>c.reporter_id===eventCadres[2].id).performance_score,null,'Unknown source timing counted as zero');
  assert.equal((await api('/api/sbm/activities',{method:'POST',cookie:sbmOwner,body:{activity_date:'2026-06-24',village_code:'DEMO-A',location:'Legacy bypass',reporter_id:eventCadres[0].id,selection_reason:'Attempt report-level activity after grouping',report_ids:[eventReportIds[0]]}})).status,409);
  assert.equal(eventWork.needs_reassessment,true);
  assert.equal(eventWork.event.verified_cases,0,'Witness reports were added up as confirmed cases');
  for(const rid of eventReportIds){const source=(await api('/api/reports/'+rid,{cookie:sbmOwner})).data.report;assert.equal(source.verified_ebs_id,null);assert.equal(source.reported_cases,5);assert.equal(source.workflow_status,'UNDER_REVIEW');}
  const eventRatingUrl=`/api/sbm/events/${signalEventId}/candidates/${eventCadres[3].id}`;
  assert.equal((await api(eventRatingUrl,{method:'PUT',cookie:sbmOwner,body:{understanding:25,support:12.5,available:'YES'}})).status,200);
  const eventPlan={event_id:signalEventId,activity_date:'2026-06-25',reporter_id:eventCadres[3].id,location:'One visit for all four sources',selection_reason:'Knows the event and is ready with officer support'};
  assert.equal((await api('/api/sbm/activities',{method:'POST',cookie:sbmOwner,body:eventPlan})).status,409,'Stale event assessment allowed planning');
  assert.equal((await assessEvent({source_revision:1})).status,409);
  assert.equal((await assessEvent({decision:'REMOTE'})).status,200);
  eventWork=(await api(eventWorkspaceUrl,{cookie:sbmOwner})).data;
  assert.equal((await api(`/api/sbm/events/${signalEventId}/followups`,{method:'POST',cookie:sbmOwner,body:{method:'Telepon',result:'Sources contacted; further field confirmation needed'}})).status,201);
  assert.equal((await api('/api/sbm/activities',{method:'POST',cookie:sbmOwner,body:eventPlan})).status,409,'Remote confirmation created a field activity');
  assert.equal((await assessEvent()).status,200);
  const eventPlans=await Promise.all([25,26].map(day=>api('/api/sbm/activities',{method:'POST',cookie:sbmOwner,body:{...eventPlan,activity_date:`2026-06-${day}`}})));
  assert.deepEqual(eventPlans.map(r=>r.status).sort(),[201,409],'Same event scheduled twice on different dates');
  const eventActivityId=eventPlans.find(r=>r.status===201).data.activity_id;
  eventWork=(await api(eventWorkspaceUrl,{cookie:sbmOwner})).data;
  const eventActivity=eventWork.activities.find(a=>a.activity_id===eventActivityId);
  assert.equal(eventActivity.report_ids.split(',').length,4);
  const eventSnapshot=JSON.parse(eventActivity.selection_snapshot);
  assert.equal(eventSnapshot.event_id,signalEventId);assert.equal(eventSnapshot.total_score,null);
  assert.ok(!('report_id' in eventSnapshot),'Selection is still keyed by one source report');
  assert.equal(eventWork.followups.length,1);
  assert.equal((await assessEvent({decision:'CLOSE'})).status,409,'Event closed while its field visit was still planned');
  assert.equal((await api('/api/events/'+signalEventId+'/status',{method:'POST',cookie:sbmOwner,body:{status:'SELESAI',notes:'Bypass event assessment'}})).status,409);
  // A negative individual report review does not ungroup its event or force a diagnosis.
  assert.equal((await api('/api/ebs/reports/'+eventReportIds[1]+'/review',{method:'POST',cookie:sbmOwner,body:{}})).status,200);
  assert.equal((await saveDecision(eventReportIds[1],{},sbmOwner)).status,200);
  assert.equal((await api('/api/reports/'+eventReportIds[1],{cookie:sbmOwner})).data.report.event_id,signalEventId);
  assert.equal((await api(`/api/sbm/activities/${eventActivityId}`,{method:'PATCH',cookie:sbmOwner,body:{status:'CANCELLED',result:'Sources confirmed through contacts; visit no longer needed'}})).status,200);
  eventWork=(await api(eventWorkspaceUrl,{cookie:sbmOwner})).data;
  assert.equal((await assessEvent({decision:'CLOSE',notes:'Contact follow-up completed; event resolved'})).status,200);
  assert.equal((await api(eventWorkspaceUrl,{cookie:sbmOwner})).data.event.current_status,'SELESAI');
  assert.equal((await api(eventRatingUrl,{method:'PUT',cookie:sbmOwner,body:candidateRating})).status,409);
  assert.equal((await api(eventWorkspaceUrl,{cookie:eventCadres[3].cookie})).status,401);
  // Structured location placeholders, validity, own score, and signal-to-incident promotion.
  const placeholderBody={...cadreTaxonomyBase,severe_cases:undefined,hospitalized_cases:undefined,signal_code:'PERSON_ILLNESS',description:'Demam sejak kemarin',dukuh_id:'',rw_id:'',rt_id:'',estimated_cases_unknown:true,estimated_deaths_unknown:true};
  const placeholder=await api('/api/cadre/reports',{method:'POST',cookie:eventCadres[3].cookie,body:placeholderBody});
  assert.equal(placeholder.status,201,'Short but meaningful narrative should not be blocked');
  const placeholderId=placeholder.data.report_id,placeholderPath=`/api/ebs/reports/${placeholderId}`;
  assert.equal((await api('/api/cadre/reports',{method:'POST',cookie:eventCadres[3].cookie,body:{...placeholderBody,dukuh_id:'FAKE-DUKUH'}})).status,400,'Unlisted geographic selection accepted');
  const ownPlaceholder=(await api(placeholderPath,{cookie:eventCadres[3].cookie})).data;
  assert.equal(ownPlaceholder.report.reported_cases_known,0);
  assert.equal(ownPlaceholder.report.reported_deaths_known,0,'Unknown deaths from a cadre were counted as a confirmed zero');
  assert.equal(ownPlaceholder.report.severe_cases_known,0);
  assert.equal(ownPlaceholder.report.hospitalized_cases_known,0);
  assert.equal(ownPlaceholder.contribution.stage,'NONE');assert.equal(ownPlaceholder.assessment.score.total,null);
  assert.equal((await api(placeholderPath,{cookie:eventCadres[2].cookie})).status,404);
  assert.equal((await validateReport(placeholderId,'VALID',{},eventCadres[3].cookie)).status,403);
  assert.equal((await validateReport(placeholderId,'VALID',{},verifier)).status,403);
  assert.equal((await validateReport(placeholderId,'NEEDS_CLARIFICATION',{question:'How many people have symptoms?'})).status,200);
  assert.equal((await validateReport(placeholderId)).status,409,'Open clarification did not block validity approval');
  const placeholderQuestion=(await api(placeholderPath,{cookie:eventCadres[3].cookie})).data.clarifications[0].clarification_id;
  assert.equal((await api(`/api/sbm/clarifications/${placeholderQuestion}/answer`,{method:'POST',cookie:eventCadres[3].cookie,body:{answer:'Five residents have fever since yesterday.'}})).status,200);
  assert.equal((await validateReport(placeholderId)).status,200);
  const scoreGrade={quality:'REASONABLE',completeness:'COMPLETE',timeliness:'TIMELY',notes:'Clear facts and timing; feedback visible to the cadre.'};
  assert.equal((await api(placeholderPath+'/quality',{method:'POST',cookie:admin,body:scoreGrade})).status,200);
  assert.equal((await api(placeholderPath,{cookie:eventCadres[3].cookie})).data.assessment.score.total,50);
  const ownScore=(await api('/api/sbm/my-score',{cookie:eventCadres[3].cookie})).data;
  assert.equal(ownScore.performance_score,50);assert.equal(ownScore.assessed_count,1);
  assert.deepEqual(ownScore.components,{information:20,completeness:15,timeliness:15});
  assert.equal((await api('/api/sbm/my-score',{cookie:admin})).status,401);
  const additionalSource=await api('/api/cadre/reports',{method:'POST',cookie:eventCadres[3].cookie,body:placeholderBody});
  assert.equal(additionalSource.status,201);
  assert.equal((await validateReport(additionalSource.data.report_id)).status,200);
  const promotion=await api('/api/sbm/events',{method:'POST',cookie:sbmOwner,body:{event_title:'Verified fever signal',program_owner:'P2P',report_ids:[placeholderId,additionalSource.data.report_id]}});
  assert.equal(promotion.status,201);
  const promotionId=promotion.data.event_id,promotionBase=`/api/sbm/events/${promotionId}`;
  let promotionWork=(await api(promotionBase+'/workspace',{cookie:sbmOwner})).data;
  assert.equal((await api(placeholderPath,{cookie:eventCadres[3].cookie})).data.contribution.stage,'SIGNAL');
  const signalStatistics=(await api('/api/sbm/my-statistics',{cookie:eventCadres[3].cookie})).data;
  assert.deepEqual(signalStatistics.counts,{total:3,reviewed:0,incident_source_reports:0,incidents:0},'An unverified signal was counted as an incident');
  const ebsIdForPromotion=promotionWork.ebs_options[0].ebs_id;
  const verificationBody={source_revision:promotionWork.event.source_revision,verification_method:'Telepon kepada sumber',result:'Five distinct residents confirmed by the source, no severe cases or deaths.',verified_ebs_id:ebsIdForPromotion,verified_cases:5,verified_deaths:0,verified_severe_cases:0};
  assert.equal((await api(promotionBase+'/verification',{method:'POST',cookie:sbmOwner,body:verificationBody})).status,409);
  assert.equal((await api(promotionBase+'/assessment',{method:'PUT',cookie:sbmOwner,body:{source_revision:promotionWork.event.source_revision,decision:'REMOTE',priority:'SEDANG',notes:'Verify the valid signal by contacting the source.'}})).status,200);
  assert.equal((await api(promotionBase+'/verification',{method:'POST',cookie:sbmOwner,body:verificationBody})).status,409,'Incident created without verification evidence');
  assert.equal((await api(promotionBase+'/followups',{method:'POST',cookie:sbmOwner,body:{method:'Telepon',result:'Contact successful; five different residents affected.'}})).status,201);
  assert.equal((await api(promotionBase+'/verification',{method:'POST',cookie:sbmOwner,body:{...verificationBody,verified_cases:''}})).status,400);
  const promotions=await Promise.all([1,2].map(()=>api(promotionBase+'/verification',{method:'POST',cookie:sbmOwner,body:verificationBody})));
  assert.deepEqual(promotions.map(r=>r.status).sort(),[200,409]);
  promotionWork=(await api(promotionBase+'/workspace',{cookie:sbmOwner})).data;
  assert.equal(promotionWork.event.origin,'CONFIRMED');assert.equal(promotionWork.event.verified_cases,5);
  assert.equal(promotionWork.verification.source_revision,promotionWork.event.source_revision);
  const contribution=(await api(placeholderPath,{cookie:eventCadres[3].cookie})).data.contribution;
  assert.equal(contribution.stage,'INCIDENT');assert.equal(contribution.event_id,promotionId);
  const ownContribution=(await api('/api/cadre/reports',{cookie:eventCadres[3].cookie})).data.rows.find(r=>r.report_id===placeholderId);
  assert.equal(ownContribution.contribution_stage,'INCIDENT');assert.equal(ownContribution.incident_title,'Verified fever signal');
  const incidentStatistics=(await api('/api/sbm/my-statistics',{cookie:eventCadres[3].cookie})).data;
  assert.deepEqual(incidentStatistics.counts,{total:3,reviewed:0,incident_source_reports:2,incidents:1},'Multiple source reports inflated the number of incidents');
  assert.deepEqual((await api('/api/sbm/my-statistics?reporter_id='+eventCadres[0].id,{cookie:eventCadres[3].cookie})).data.counts,incidentStatistics.counts,'Caller could select another cadre statistics');
  assert.deepEqual(Object.keys(incidentStatistics).sort(),['counts','generated_at','period','quality']);
  assert.deepEqual(incidentStatistics.quality,(await api('/api/sbm/my-score',{cookie:eventCadres[3].cookie})).data,'Story leaked or substituted another cadre quality');
  const periodFixtures=[];
  for(let i=0;i<3;i++){
    const created=await api('/api/cadre/reports',{method:'POST',cookie:eventCadres[3].cookie,body:placeholderBody});assert.equal(created.status,201);periodFixtures.push(created.data.report_id);
  }
  runWrangler(['d1','execute','sbm-db','--local','--persist-to',persistence,'--json','--command',`UPDATE reports SET submitted_at='2019-01-01T00:00:00Z' WHERE report_id='${periodFixtures[0]}'; UPDATE reports SET submitted_at='2099-01-01T00:00:00Z' WHERE report_id='${periodFixtures[1]}'`]);
  assert.equal((await validateReport(periodFixtures[2],'INVALID',{notes:'Review completed; report was not substantiated.'})).status,200);
  assert.deepEqual((await api('/api/sbm/my-statistics',{cookie:eventCadres[3].cookie})).data.counts,{total:4,reviewed:1,incident_source_reports:2,incidents:1},'The period or completed review counting is incorrect');
  const invalidCreated=await api('/api/cadre/reports',{method:'POST',cookie:eventCadres[2].cookie,body:placeholderBody});
  assert.equal((await validateReport(invalidCreated.data.report_id,'INVALID',{notes:'The submitted information is demonstrably fabricated.'})).status,200);
  assert.equal((await api('/api/sbm/events',{method:'POST',cookie:sbmOwner,body:{event_title:'Invalid signal',program_owner:'P2P',report_ids:[invalidCreated.data.report_id]}})).status,409);
  assert.equal((await api(`/api/ebs/reports/${invalidCreated.data.report_id}`,{cookie:eventCadres[2].cookie})).data.assessment.validation.status,'INVALID');
  if(process.env.SBM_UI_QA) {
    await mkdir(join(cwd,'.credentials/cadre-replacement-20261001/design-refined'),{recursive:true});
    for(const [rid,question] of [[sbmReportId,'What is the location landmark?'],[cadreFood.data.report_id,'Which day was the shared meal?']]) {
      assert.equal((await api(`/api/sbm/reports/${rid}/screening`,{method:'POST',cookie:sbmOwner,body:{...sbmScreen,decision:'CLARIFY',question}})).status,200);
      assert.equal((await api(`/api/sbm/reports/${rid}/screening`,{method:'POST',cookie:sbmOwner,body:sbmScreen})).status,200);
    }
    const {chromium,webkit}=await import(process.env.SBM_UI_QA);
    const browser=await chromium.launch({headless:true,channel:'msedge'});
    try {
      const context=await browser.newContext({viewport:{width:1365,height:900}});
      const [cookieName,...cookieValue]=sbmOwner.split('=');
      await context.addCookies([{name:cookieName,value:cookieValue.join('='),url:origin}]);
      const page=await context.newPage();
      const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
      await page.goto(origin+'/#staff-sbm/'+sbmReportId);
      await page.locator('#filters').waitFor();
      assert.equal(new URL(page.url()).hash,'#staff-reports','Old fieldwork route is still accessible');
      assert.equal(await page.locator('#workspaceNavigation a[href="#staff-sbm"]').count(),0);
      await page.goto(origin+'/#staff-sbm');
      await page.locator('#filters').waitFor();
      assert.equal(new URL(page.url()).hash,'#staff-reports');
      await page.goto(origin+'/#staff-legacy-report/'+sbmReportId);
      await page.locator('.report-work-heading').waitFor();
      assert.equal(new URL(page.url()).hash,'#staff-report/'+sbmReportId);
      assert.equal(await page.getByText('Administrasi lanjutan',{exact:true}).count(),0);
      assert.equal(await page.locator('#app a[href^="#staff-sbm"]').count(),0,'Legacy report still exposes fieldwork');
      const cadreContext=await browser.newContext({viewport:{width:390,height:844}});
      const [cadreCookieName,...cadreCookieValue]=sbmCadreLogin.cookie.split('=');
      await cadreContext.addCookies([{name:cadreCookieName,value:cadreCookieValue.join('='),url:origin}]);
      const cadrePage=await cadreContext.newPage();
      let activityRequests=0;
      cadrePage.on('request',r=>{if(r.url().includes('/api/sbm/mine'))activityRequests++;});
      cadrePage.on('pageerror',e=>pageErrors.push(e.message));
      // Review the complete EBS workflow using both authenticated browser sessions.
      const uiEbsCreated=await api('/api/cadre/reports',{method:'POST',cookie:sbmCadreLogin.cookie,
        body:{...cadreTaxonomyBase,signal_code:'PERSON_ILLNESS',location_text:'Browser EBS workflow location'}});
      assert.equal(uiEbsCreated.status,201);
      const uiEbsId=uiEbsCreated.data.report_id;
      await page.setViewportSize({width:1365,height:900});
      await page.goto(`${origin}/#staff-report/${uiEbsId}`);
      assert.equal(await page.getByRole('button',{name:'Mulai pemeriksaan',exact:true}).count(),0);
      await page.locator('.status-UNDER_REVIEW').first().waitFor();
      await cadrePage.goto(`${origin}/#cadre-home?view=history`);
      await cadrePage.locator(`[data-report-id="${uiEbsId}"]`).waitFor();
      await page.getByRole('button',{name:'Minta klarifikasi',exact:true}).click();
      await page.locator('#ebsAsk textarea').fill('When did symptoms start in this browser test?');
      await page.locator('#ebsAsk button[type="submit"]').click();
      await page.locator('.status-NEEDS_CLARIFICATION').first().waitFor();
      await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
      await page.screenshot({path:join(cwd,'.credentials/cadre-replacement-20261001/design-refined/ebs-detail-desktop.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'EBS detail overflows mobile viewport');
      await page.screenshot({path:join(cwd,'.credentials/cadre-replacement-20261001/design-refined/ebs-detail-mobile.png'),fullPage:true});
      await page.setViewportSize({width:320,height:740});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'EBS detail overflows at 320px');
      await page.setViewportSize({width:390,height:844});
      await cadrePage.locator('#mobileNavigation a[href="#cadre-home?view=report"]').click();
      await cadrePage.locator('#mobileNavigation a[href="#cadre-home?view=history"]').click();
      await cadrePage.locator('[data-report-id="'+uiEbsId+'"] [data-cadre-detail-action]').click();
      const uiEbsRow=cadrePage.locator('#app');
      await cadrePage.locator('.cadre-report-heading').waitFor();
      await uiEbsRow.locator('.ebs-answer textarea').fill('History draft survives tab refresh');
      await cadrePage.locator('.cadre-report-heading .back-link').click();
      await cadrePage.locator('[data-report-id="'+uiEbsId+'"] [data-cadre-detail-action]').click();
      await cadrePage.waitForFunction(()=>document.querySelector('.ebs-answer textarea')?.value==='History draft survives tab refresh');
      await uiEbsRow.locator('.ebs-answer textarea').fill('Started yesterday morning.');
      await uiEbsRow.locator('.ebs-answer button[type="submit"]').click();
      await uiEbsRow.locator('.status-UNDER_REVIEW').waitFor();
      await uiEbsRow.getByText('Started yesterday morning.',{exact:true}).waitFor();
      assert.equal((await api('/api/ebs/reports/'+uiEbsId+'/clarifications',{method:'POST',cookie:admin,body:{question:'Answer synchronizes history status?'}})).status,201);
      await cadrePage.locator('#refreshCadreReport').click();
      const syncQuestion=uiEbsRow.locator('.ebs-question').filter({hasText:'Answer synchronizes history status?'});
      await syncQuestion.locator('textarea').fill('Status updated from report details.');
      await uiEbsRow.locator('.status-NEEDS_CLARIFICATION').waitFor();
      await syncQuestion.getByRole('button',{name:'Kirim jawaban'}).click();
      await uiEbsRow.getByText('Status updated from report details.',{exact:true}).waitFor();
      await uiEbsRow.locator('.status-UNDER_REVIEW').waitFor();
      await page.reload();
      await page.getByText('Started yesterday morning.',{exact:true}).waitFor();
      // Confirm and group reports without leaving the report workspace.
      await page.locator('#ebsDecision').waitFor();
      assert.equal(new URL(page.url()).hash,'#staff-report/'+uiEbsId);
      assert.equal(await page.locator('.report-journey li').count(),3);
      assert.equal(await page.locator('.report-journey [aria-current="step"] strong').innerText(),'Ditinjau');
      assert.equal(await page.locator('#ebsClose, #ebsFinish, #ebsVerify').count(),0);
      await page.locator('#ebsDecision [name="outcome"]').selectOption('CONFIRMED');
      const uiClassification=await page.locator('#ebsDecision [name="verified_ebs_id"] option').nth(1).getAttribute('value');
      await page.locator('#ebsDecision [name="verified_ebs_id"]').selectOption(uiClassification);
      await page.locator('#ebsDecision [name="verification_method"]').fill('Telepon');
      await page.locator('#ebsDecision [name="contact_result"]').fill('Kader berhasil dihubungi');
      await page.locator('#ebsDecision [name="actual_cases"]').fill('2');
      await page.locator('#ebsDecision [name="actual_deaths"]').fill('0');
      await page.locator('#ebsDecision [name="actual_severe_cases"]').fill('0');
      await page.locator('#ebsDecision [name="notes"]').fill('Dua orang yang sama dikonfirmasi, bukan kasus tambahan.');
      await page.locator('#ebsDecision button[type="submit"]').click();
      await page.locator('.status-CLOSED').first().waitFor();
      assert.equal((await api('/api/ebs/reports?q='+uiEbsId,{cookie:admin})).data.total,0);
      await page.locator('#ebsLink').waitFor();
      await page.locator('#ebsCreateEventPanel summary').click();
      await page.locator('#ebsCreateEvent [name="event_title"]').fill('Shared browser incident');
      await page.locator('#ebsCreateEvent [name="program_owner"]').fill('P2P');
      const uiSignal=await page.locator('#ebsCreateEvent [name="verified_signal_code"] option').nth(1).getAttribute('value');
      await page.locator('#ebsCreateEvent [name="verified_signal_code"]').selectOption(uiSignal);
      await page.locator('#ebsCreateEvent button[type="submit"]').click();
      await page.locator('.report-event-summary').waitFor();
      const sharedEventId=(await api(`/api/reports/${uiEbsId}`,{cookie:admin})).data.report.event_id;
      assert.ok(sharedEventId);
      const secondUiReport=await api('/api/cadre/reports',{method:'POST',cookie:otherCadreLogin.cookie,body:{...cadreTaxonomyBase,signal_code:'PERSON_ILLNESS'}});
      assert.equal(secondUiReport.status,201,JSON.stringify(secondUiReport.data));
      const secondUiId=secondUiReport.data.report_id;
      assert.equal((await saveDecision(secondUiId,{outcome:'CONFIRMED',verified_ebs_id:uiClassification,actual_cases:2,actual_deaths:0,actual_severe_cases:0,notes:'Same two people, another cadre report'})).status,200);
      await page.goto(`${origin}/#staff-report/${secondUiId}`);
      await page.locator('#ebsLink [name="event_id"]').selectOption(sharedEventId);
      await page.locator('#ebsLink button[type="submit"]').click();
      await page.locator('.report-related-list li').nth(1).waitFor();
      assert.equal((await api(`/api/events/${sharedEventId}`,{cookie:admin})).data.event.verified_cases,2,'Grouping reports double-counted cases');
      await page.goto(`${origin}/#staff-report/${uiEbsId}`);
      await page.locator('.report-related-list li').nth(1).waitFor();
      await page.locator('.status-CLOSED').first().waitFor();
      assert.equal((await api('/api/reports/'+uiEbsId,{cookie:admin})).data.report.current_status,'SELESAI','Grouping reopens a report');
      assert.equal((await api('/api/ebs/reports?q='+uiEbsId,{cookie:admin})).data.total,0,'Active event returns a completed review to inbox');
      assert.equal((await api('/api/dashboard',{cookie:admin})).data.pending_reports,(await api('/api/ebs/reports',{cookie:admin})).data.total);
      await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
      await page.screenshot({path:join(cwd,'.credentials/cadre-replacement-20261001/design-refined/report-workspace-grouped.png'),fullPage:true});
      for(const next of ['AKTIF','SELESAI']) assert.equal((await api('/api/events/'+sharedEventId+'/status',{method:'POST',cookie:admin,body:{status:next,notes:'Browser event handling complete'}})).status,200);
      await page.locator('#refreshReport').click();
      await page.locator('.report-event-summary').getByText(/Penanganan kejadian selesai/).waitFor();
      assert.equal(await page.locator('#ebsDecision').count(),0,'Completed decision offers another final closure');
      await cadrePage.locator('#mobileNavigation a[href="#cadre-home?view=report"]').click();
      await cadrePage.locator('#mobileNavigation a[href="#cadre-home?view=history"]').click();
      await uiEbsRow.locator('.status-CLOSED').waitFor();
      await page.goto(`${origin}/#staff-ebs-all`);
      await page.locator('#filters input[name="q"]').fill(uiEbsId);
      await page.locator('#filters button[type="submit"]').click();
      await page.locator(`.reportDetail[data-id="${uiEbsId}"]`).waitFor();
      await page.goto(`${origin}/#staff-reports`);
      await page.getByText('Tidak ada laporan yang cocok',{exact:true}).waitFor();
      await page.locator('#resetFilters').click();
      await page.locator('.reportDetail').first().waitFor();
      await cadrePage.goto(origin+'/#cadre-home');
      await cadrePage.locator('#cadreReportPanel').waitFor();
      assert.equal(await cadrePage.locator('#cadreTaskSummary, #cadreFollowupTab, #cadreUpcoming').count(),0);
      assert.equal(await cadrePage.locator('#mobileNavigation a[href="#cadre-home?view=followup"]').count(),0);
      await cadrePage.locator('#mobileNavigation a[href="#cadre-home?view=history"]').focus();
      await cadrePage.keyboard.press('Enter');
      assert.equal(await cadrePage.locator('#cadreHistoryPanel').isVisible(),true);
      await cadrePage.goto(origin+'/#cadre-home?view=followup');
      await cadrePage.locator('#cadreHistoryPanel').waitFor();
      assert.equal(new URLSearchParams(new URL(cadrePage.url()).hash.split('?')[1]).get('view'),'history','Old followup route does not lead to report history');
      assert.equal(activityRequests,0,'Reporting portal loads activity and payment data');
      assert.equal(await cadrePage.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,'Cadre mobile page overflows horizontally');
      assert.ok(await cadrePage.locator('#mobileNavigation a[href="#cadre-home?view=history"]').evaluate(e=>e.getBoundingClientRect().height)>=44);
      await cadrePage.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
      await cadrePage.screenshot({path:join(cwd,'.credentials/cadre-replacement-20261001/cadre-reporting-history.png'),fullPage:true});
      await cadrePage.setViewportSize({width:320,height:740});
      await cadrePage.locator('#themeToggle').click();
      assert.equal(await cadrePage.locator('html').getAttribute('data-theme'),'dark');
      await cadrePage.waitForTimeout(250);
      const darkControlContrast=await cadrePage.locator('#logout').evaluate(button=>{
        const c=getComputedStyle(button),linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
        const lum=text=>{const rgb=text.match(/[\d.]+/g).slice(0,3).map(v=>linear(Number(v)/255));return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
        const a=lum(c.color),b=lum(c.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      });
      assert.ok(darkControlContrast>=4.5,'Cadre dark logout text has insufficient contrast');
      assert.equal(await cadrePage.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,'Cadre narrow page overflows horizontally');
      await cadrePage.screenshot({path:join(cwd,'.credentials/cadre-replacement-20261001/ui-sbm-cadre-dark.png'),fullPage:true});
      await page.route('**/api/admin/cadres', async route => {
        const response = await route.fetch();
        const rows = await response.json();
        await route.fulfill({ json: [...rows, ...Array.from({ length: 25 }, (_, index) => ({ ...rows[0], reporter_id: `UI-DIRECTORY-${index}`, cadre_code: `UI-CADRE-${index}`, name: `Kader uji direktori ${index}`, active: 1 }))] });
      });
      await page.goto(`${origin}/#admin-users`);
      await page.locator('#accountAdminSearch').waitFor();
      assert.equal(await page.locator('#admin-users-directory').isVisible(), true, 'Account administration starts with an add form');
      const directory = page.locator('.admin-subsection').filter({ has: page.locator('.editCadre') });
      assert.equal(await directory.locator('[data-account-row]:visible').count(), 12, 'Directory does not limit its initial rows');
      await directory.locator('[data-page-next]').click();
      assert.ok((await directory.locator('.directory-pager > span').innerText()).startsWith('13–'), 'Directory next page is unreachable');
      await page.locator('#accountAdminSearch').fill('Kader uji direktori 24');
      assert.equal(await directory.locator('[data-account-row]:visible').count(), 1, 'Search misses records outside the current page');
      await page.locator('#accountAdminSearch').fill('');
      const cadreActions = page.locator('#admin-users-directory .row-actions').filter({ has: page.locator('.editCadre') }).first();
      await cadreActions.locator('summary').click();
      await cadreActions.locator('.editCadre').click();
      const originalName = await page.locator('#newCadreName').inputValue();
      await page.locator('.brand').click();
      await page.locator('.landing-page').waitFor();
      assert.equal(await page.locator('dialog[open]').count(), 0, 'Opening an editor is mistaken for an unsaved edit');
      await page.goto(`${origin}/#admin-users`);
      await page.locator('[data-user-admin-jump="admin-users-directory"]').click();
      const editActions = page.locator('#admin-users-directory .row-actions').filter({ has: page.locator('.editCadre') }).first();
      await editActions.locator('summary').click();
      await editActions.locator('.editCadre').click();
      await page.locator('#newCadreName').fill(originalName + ' unsaved');
      await page.locator('.brand').click();
      await page.locator('#actionDialogCancel').click();
      assert.equal(await page.locator('#newCadreName').inputValue(), originalName + ' unsaved', 'Canceling navigation loses an admin edit');
      await page.locator('#cancelCadreEdit').click();
      await page.locator('[data-user-admin-jump="admin-users-directory"]').click();
      await page.locator('[data-user-admin-jump="admin-users-directory"]').click();
      await page.locator('#accountAdminSearch').waitFor();
      await page.locator('#accountAdminSearch').fill('no-account-matches-this');
      assert.ok((await page.locator('#accountAdminSearchFeedback').innerText()).includes('Tidak ada akun'));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,'Admin users narrow page overflows horizontally');
      // Review the shared visual system on the other authenticated workspaces.
      for (const [name,route] of [['overview','#staff-home'],['reports','#staff-reports'],['w2','#staff-w2-management'],['school','#staff-school-management'],['ibs','#staff-ibs'],['analytics','#staff-analytics'],['settings','#admin-ibs'],['users','#admin-users']]) {
        await page.goto(`${origin}/${route}`);
        await page.locator('#app h1').first().waitFor();
        await page.waitForLoadState('networkidle');
        for(let i=0;i<3 && await page.locator('html').getAttribute('data-theme')!=='light';i++) {
          await page.locator('#themeToggle').click(); await page.waitForTimeout(250);
        }
        await page.setViewportSize({width:1365,height:900});
        await page.waitForTimeout(250);
        await page.screenshot({path:join(cwd,`.credentials/cadre-replacement-20261001/design-refined/${name}-desktop.png`),fullPage:true});
        assert.equal(await page.locator('#workspaceNavigation nav a[aria-current]').count(),1,`${name}: active navigation missing or ambiguous`);
        assert.equal(await page.locator('#workspaceMenuToggle').isVisible(),false,`${name}: desktop should show the persistent sidebar`);
        if(name==='overview') assert.equal(await page.locator('#filters').count(),0,'Overview still contains a report worklist');
        if(name==='reports') {
          assert.equal(await page.locator('#filters').isVisible(),true,'Report workspace lacks its filters');
          await page.locator('#filters input[name="q"]').fill('no-report-matches-this');
          await page.locator('#filters button[type="submit"]').click();
          await page.getByText('Tidak ada laporan yang cocok',{exact:true}).waitFor();
          assert.equal(await page.locator('#workspaceNavigation nav a[aria-current]').getAttribute('href'),'#staff-reports','Filtering loses navigation context');
          await page.locator('#resetFilters').click();
          await page.locator('.reportDetail').first().waitFor();
          const selectedReportId = await page.locator('.reportDetail').first().getAttribute('data-id');
          await page.locator('#filters input[name="q"]').fill(selectedReportId);
          await page.locator('#filters button[type="submit"]').click();
          await page.locator(`.reportDetail[data-id="${selectedReportId}"]`).waitFor();
          await page.locator('.reportDetail').first().click();
          await page.locator('#workspaceNavigation nav a[aria-current][href="#staff-reports"]').waitFor();
          assert.equal(await page.locator('#workspaceNavigation').isVisible(),true,'Report detail loses global navigation');
          await page.locator('.back-link[href="#staff-reports"]').first().click();
          await page.locator('#filters').waitFor();
          assert.equal(await page.locator('#filters input[name="q"]').inputValue(), selectedReportId, 'Returning from review loses the administrator search context');
          await page.locator(`.reportDetail[data-id="${selectedReportId}"]`).waitFor();
          await page.locator('#resetFilters').click();
          await page.locator('.reportDetail').first().waitFor();
        }
        if(['w2','school','ibs'].includes(name)) {
          const isW2=name!=='school';
          const expectedRoute=isW2?'#staff-w2-management':'#staff-school-management';
          assert.equal(await page.locator('#app h1').first().innerText(),isW2?'Laporan W2 Faskes':'Laporan Sekolah');
          assert.equal(await page.locator('#workspaceNavigation nav a[aria-current]').getAttribute('href'),expectedRoute);
          assert.equal(await page.locator(isW2?'#ibs-panel-school':'#ibs-panel-faskes').count(),0,'Another institution type leaked into the management workspace');
          const year=await page.locator('#dashYear').inputValue(),week=await page.locator('#dashWeek').inputValue();
          const dashboardData=(await api(`/api/ibs/dashboard?epi_year=${year}&epi_week=${week}`,{cookie:admin})).data;
          const allowedMarkers=new Set(dashboardData.markers.filter(m=>m.target_type===(isW2?'W2':'SEKOLAH')).map(m=>m.marker_id));
          for(const markerId of await page.locator('.reviewMarker').evaluateAll(nodes=>nodes.map(n=>n.dataset.id))) assert.ok(allowedMarkers.has(markerId),'Unrelated review task in workspace');
          const refreshed=page.waitForResponse(r=>r.url().includes('/api/ibs/dashboard'));
          await page.locator('#loadDash').click();
          await refreshed;
          await page.waitForLoadState('networkidle');
          assert.equal(await page.locator(isW2?'#ibs-panel-faskes':'#ibs-panel-school').isVisible(),true,'Reloading the period loses the management context');
          assert.equal(await page.locator(isW2?'#ibs-tab-school':'#ibs-tab-faskes').count(),0);
        }
        await page.setViewportSize({width:390,height:844});
        if(name==='reports') {
          // Let the responsive layout and sticky position settle before sampling.
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          await page.evaluate(()=>{window.scrollTo({top:600,behavior:'instant'});return new Promise(resolve=>requestAnimationFrame(resolve));});
          const bottom=await page.locator('#mobileNavigation').evaluate(e=>e.getBoundingClientRect().bottom);
          assert.ok(Math.abs(bottom-844)<2,`Mobile navigation is not anchored to the bottom (${bottom}px)`);
          await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
        }
        if(['w2','school','ibs'].includes(name)) {
          assert.equal(await page.locator('.ibs-workspace-tab:visible').count(),name==='school'?2:3,'Mobile weekly-reporting tabs hide destinations');
          const outside=await page.locator('.ibs-workspace-tab').evaluateAll(tabs=>tabs.some(e=>e.getBoundingClientRect().right>innerWidth));
          assert.equal(outside,false,'Weekly-reporting tabs require hidden horizontal navigation');
        }
        await page.locator('#workspaceMenuToggle').click();
        assert.equal(await page.locator('#workspaceMenuToggle').getAttribute('aria-expanded'),'true');
        assert.equal(await page.locator('#mobileMorePanel').isVisible(),true,'Additional mobile destinations do not open');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#workspaceMenuToggle').getAttribute('aria-expanded'),'false');
        assert.equal(await page.locator('#mobileMorePanel').isVisible(),false,'Additional mobile destinations do not close with Escape');
        await page.locator('#workspaceMenuToggle').click();
        await page.locator('#closeMobileMore').click();
        assert.equal(await page.locator('#workspaceMenuToggle').getAttribute('aria-expanded'),'false','Closing more destinations leaves the menu open');
        await page.screenshot({path:join(cwd,`.credentials/cadre-replacement-20261001/design-refined/${name}-mobile.png`),fullPage:true});
        await page.setViewportSize({width:320,height:844});
        const overflowing=await page.evaluate(()=>[...document.querySelectorAll('#app *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1 && getComputedStyle(e).position!=='absolute' && !e.closest('.table-wrap,.ibs-workspace-tabs')).map(e=>`${e.tagName}.${e.className}`).slice(0,8));
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,`${name}: 320px horizontal overflow (${overflowing.join(', ')})`);
        for(let i=0;i<3 && await page.locator('html').getAttribute('data-theme')!=='dark';i++) {
          await page.locator('#themeToggle').click(); await page.waitForTimeout(250);
        }
        await page.waitForTimeout(250);
        await page.screenshot({path:join(cwd,`.credentials/cadre-replacement-20261001/design-refined/${name}-dark-narrow.png`),fullPage:true});
      }
      const viewerContext=await browser.newContext({viewport:{width:1365,height:900}});
      const [viewerCookieName,...viewerCookieValue]=viewer.split('=');
      await viewerContext.addCookies([{name:viewerCookieName,value:viewerCookieValue.join('='),url:origin}]);
      const viewerPage=await viewerContext.newPage();
      viewerPage.on('pageerror',e=>pageErrors.push(e.message));
      await viewerPage.goto(`${origin}/#staff-reports`);
      await viewerPage.locator('#workspaceNavigation nav').waitFor();
      assert.equal(await viewerPage.locator('#workspaceNavigation a[href^="#admin-"]').count(),0,'Viewer sees administration destinations');
      assert.equal(await viewerPage.locator('#workspaceNavigation a[href="#staff-sbm"]').count(),0,'Viewer sees owner-only fieldwork destination');
      const publicContext=await browser.newContext({viewport:{width:390,height:844}});
      const publicPage=await publicContext.newPage();
      publicPage.on('pageerror',e=>pageErrors.push(e.message));
      await publicPage.goto(`${origin}/#home`);
      await publicPage.locator('.landing-service-grid').waitFor();
      assert.deepEqual(await publicPage.locator('.landing-service-grid a').evaluateAll(links=>links.map(a=>a.getAttribute('href'))),['#public','#status'],'Public entry does not prioritize reporting and status lookup');
      assert.equal(await publicPage.locator('#workspaceNavigation').isVisible(),false);
      await publicPage.locator('[data-home-account="cadre"]').click();
      await publicPage.locator('#cadreLogin').waitFor();
      await publicPage.locator('.back-link[href="#home"]').click();
      await publicPage.locator('[data-home-account="facility"]').click();
      await publicPage.locator('#ibsLogin').waitFor();
      assert.equal(await publicPage.locator('#workspaceNavigation').isVisible(),false);
      await publicPage.setViewportSize({width:320,height:844});
      assert.equal(await publicPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Facility sign-in overflows at 320px');
      const facilityCookie=await routineLogin('TEST-FASKES-EDIT','654321');
      const facilityContext=await browser.newContext({viewport:{width:1365,height:900}});
      const [facilityCookieName,...facilityCookieValue]=facilityCookie.split('=');
      await facilityContext.addCookies([{name:facilityCookieName,value:facilityCookieValue.join('='),url:origin}]);
      const facilityPage=await facilityContext.newPage();
      facilityPage.on('pageerror',e=>pageErrors.push(e.message));
      await facilityPage.goto(`${origin}/#ibs-home`);
      await facilityPage.locator('#openW2Task').click();
      await facilityPage.locator('.w2-workspace').waitFor();
      await facilityPage.waitForLoadState('networkidle');
      const reportingLayout = await facilityPage.evaluate(() => ({ navigation: document.querySelector('#workspaceNavigation').getBoundingClientRect().right, entry: document.querySelector('.w2-workspace').getBoundingClientRect().left }));
      assert.ok(reportingLayout.entry > reportingLayout.navigation, 'Desktop facility entry does not have a separate navigation column');
      assert.equal(await facilityPage.locator('#workspaceNavigation').isVisible(),true,'Institution lacks its desktop sidebar');
      assert.equal(await facilityPage.locator('#workspaceNavigation a[href^="#staff-"]').count(),0,'Institution sees staff destinations');
      assert.equal(await facilityPage.locator('.brand').getAttribute('href'),'#home','Institution brand should open the shared homepage');
      assert.equal(await facilityPage.locator('.session-portal-link').getAttribute('href'),'#ibs-home');
      await facilityPage.screenshot({path:join(cwd,'.credentials/cadre-replacement-20261001/design-refined/facility-desktop.png'),fullPage:true});
      await facilityPage.setViewportSize({width:390,height:844});
      await facilityPage.screenshot({path:join(cwd,'.credentials/cadre-replacement-20261001/design-refined/facility-mobile.png'),fullPage:true});
      await facilityPage.locator('#mobileNavigation a[href="#ibs-home?view=history"]').click();
      assert.ok(await facilityPage.locator('.w2-calendar-grid button').count()>=52,'Facility report history is not reachable');
      assert.ok(await facilityPage.locator('.w2-history-row').count()<=6,'Facility history does not paginate');
      await facilityPage.locator('.w2-year-grid > summary').click();
      const selectedPeriod=await facilityPage.locator('.w2-calendar-week[aria-current="date"]').getAttribute('data-calendar-week');
      const selectedWeek=Number(await facilityPage.locator('.w2-calendar-week[aria-current="date"]').getAttribute('data-calendar-week'));
      if (selectedWeek > 1) await facilityPage.locator(`.w2-calendar-week[data-calendar-week="${selectedWeek-1}"]`).click();
      else { await facilityPage.locator('#mobileNavigation a[href="#ibs-home?view=report"]').click(); await facilityPage.locator('#previousW2').click(); }
      await facilityPage.waitForFunction(previous=>document.querySelector('.w2-calendar-week[aria-current="date"]')?.dataset.calendarWeek!==previous,selectedPeriod);
      const previousWeek=await facilityPage.locator('.w2-calendar-week[aria-current="date"]').getAttribute('data-calendar-week');
      assert.equal(new URLSearchParams(new URL(facilityPage.url()).hash.split('?')[1]).get('epi_week'),previousWeek,'Historical period is absent from its URL');
      await facilityPage.reload();
      await facilityPage.locator('.w2-workspace').waitFor();
      assert.equal(await facilityPage.locator('.w2-calendar-week[aria-current="date"]').getAttribute('data-calendar-week'),previousWeek,'Reload loses the historical report period');
      await facilityPage.locator('#currentW2').click();
      await facilityPage.waitForFunction(previous=>document.querySelector('.w2-calendar-week[aria-current="date"]')?.dataset.calendarWeek===previous,selectedPeriod);
      await facilityPage.setViewportSize({width:320,height:844});
      const facilityOverflow=await facilityPage.evaluate(()=>[...document.querySelectorAll('#app *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>`${e.tagName}.${e.className}`).slice(0,12));
      await facilityPage.screenshot({path:join(cwd,'.credentials/cadre-replacement-20261001/design-refined/facility-narrow.png'),fullPage:true});
      assert.equal(await facilityPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Institution portal overflows at 320px (${facilityOverflow.join(', ')})`);
      await facilityPage.locator('.w2-help-term').focus();
      assert.equal(await facilityPage.locator('.w2-help-content').isVisible(),true,'Facility case definition is not available on mobile');
      assert.equal(await facilityPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Facility case definition overflows on mobile');
      await facilityPage.locator('.w2-help-term').evaluate(element=>element.blur());
      await facilityPage.locator('#themeToggle').click();await facilityPage.waitForTimeout(250);
      await facilityPage.screenshot({path:join(cwd,'.credentials/cadre-replacement-20261001/design-refined/facility-dark-narrow.png'),fullPage:true});
      assert.deepEqual(pageErrors,[],'Frontend runtime errors');
      const { reviewLayouts } = await import('./layout-ui-qa.mjs');
      await reviewLayouts({ browser, origin, adminCookie: sbmOwner, viewerCookie: viewer, reportId: sbmReportId });
      const { reviewDiseasePage } = await import('./disease-page-ui-qa.mjs');
      await reviewDiseasePage({ browser, origin, cwd, cookies: {public: '', cadre: sbmCadreLogin.cookie, facility: facilityCookie, admin: sbmOwner}, axePath: process.env.SBM_AXE_QA });
      const { reviewReportReview } = await import('./report-review-ui-qa.mjs');
      await reviewReportReview({chromium,webkit,origin,cwd,adminCookie:sbmOwner,cadreCookie:sbmCadreLogin.cookie,leadershipCookie:leadership,reportBody:cadreTaxonomyBase});
      const {reviewHistoryInterface}=await import('./history-interface-ui-qa.mjs');
      await reviewHistoryInterface({chromium,webkit,origin,cwd,cadreCookie:sbmCadreLogin.cookie});
      console.log('SBM browser QA OK: owner desktop/mobile and private cadre workspace.');
    } finally {await browser.close();}
    if (process.env.SBM_WORKFLOW_QA) {
      const { reviewWorkflows } = await import('./workflow-ui-qa.mjs');
      await reviewWorkflows({ chromium, webkit, origin, cadreCookie: sbmCadreLogin.cookie,
        facilityCookie: await routineLogin('TEST-FASKES-EDIT','654321'), cwd, axePath: process.env.SBM_AXE_QA });
    }
    if (process.env.SBM_WORKFLOW_QA || process.env.SBM_SESSION_QA) {
      const { reviewSessionUi } = await import('./session-ui-qa.mjs');
      await reviewSessionUi({ chromium, webkit, origin, cwd, axePath: process.env.SBM_AXE_QA, staffCookie: viewer });
    }
  }

  const disposableEvent = await api('/api/events', {
    method: 'POST', cookie: admin,
    body: { event_title: 'Disposable regression event', verified_signal_code: 'OTHER', village_code: 'DEMO-A', program_owner: 'SURVEILANS', verified_cases: 0, verified_deaths: 0, verified_severe_cases: 0 },
  });
  assert.equal(disposableEvent.status, 201, JSON.stringify(disposableEvent.data));
  assert.equal((await api(`/api/events/${disposableEvent.data.event_id}`, {
    method: 'DELETE', cookie: viewer, body: { reason: 'Must be forbidden' },
  })).status, 403);
  assert.equal((await api(`/api/events/${disposableEvent.data.event_id}`, {
    method: 'DELETE', cookie: admin, body: { reason: 'Event deletion test' },
  })).status, 200);

  assert.equal((await api(`/api/reports/${validReport.data.report_id}`, {
    method: 'DELETE', cookie: viewer, body: { reason: 'Must be forbidden' },
  })).status, 403);
  assert.equal((await api(`/api/reports/${validReport.data.report_id}`, {
    method: 'DELETE', cookie: admin, body: { reason: 'Report deletion test' },
  })).status, 200);
  assert.equal((await api(`/api/reports/${validReport.data.report_id}`, { cookie: admin })).status, 404);
  const deletionFeed = await api('/api/integrations/skdklb/deletions', { headers: integrationHeaders });
  assert.equal(deletionFeed.status, 200, JSON.stringify(deletionFeed.data));
  const deletedReportTombstone = deletionFeed.data.deletions.find(row => row.report_id === validReport.data.report_id);
  assert.ok(deletedReportTombstone, 'Deleted report was absent from the SKD-KLB tombstone feed');
  assert.ok(deletedReportTombstone.deleted_at);
  assert.ok(!('deleted_by' in deletedReportTombstone), 'Deletion feed leaked administrator identity');
  assert.ok(!('deletion_reason' in deletedReportTombstone), 'Deletion feed leaked administrative notes');

  assert.equal((await api(`/api/admin/ibs/sources/${school.data.source_id}`, {
    method: 'DELETE', cookie: viewer, body: { reason: 'Must be forbidden' },
  })).status, 403);
  assert.equal((await api(`/api/admin/cadres/${cadre.data.reporter_id}`, {
    method: 'DELETE', cookie: admin, body: { reason: 'Cadre deletion test' },
  })).status, 200);
  assert.equal((await api(`/api/admin/users/${userIds.get('viewer@test.local')}`, {
    method: 'DELETE', cookie: admin, body: { reason: 'User deletion test' },
  })).status, 200);
  assert.equal((await api(`/api/admin/users/${userIds.get('verifier@test.local')}`, {
    method: 'DELETE', cookie: admin, body: { reason: 'User deletion test' },
  })).status, 200);
  const usersBeforeSelfDelete = await api('/api/admin/users', { cookie: admin });
  const currentAdmin = usersBeforeSelfDelete.data.find(item => item.email === 'admin@test.local');
  assert.ok(currentAdmin);
  assert.equal((await api(`/api/admin/users/${currentAdmin.user_id}`, {
    method: 'DELETE', cookie: admin, body: { reason: 'Self deletion must fail' },
  })).status, 400);

  assert.equal((await api(`/api/admin/ibs/sources/${school.data.source_id}`, {
    method: 'DELETE', cookie: admin, body: { reason: 'Source cascade deletion test' },
  })).status, 200);
  assert.equal((await api(`/api/ibs/school-submissions/${schoolSubmission.data.submission_id}`, { cookie: admin })).status, 404);
  assert.equal((await api(`/api/admin/ibs/sources/${faskes.data.source_id}`, {
    method: 'DELETE', cookie: admin, body: { reason: 'Source cascade deletion test' },
  })).status, 200);
  assert.equal((await api(`/api/ibs/w2-submissions/${w2.data.submission_id}`, { cookie: admin })).status, 404);

  if (worker) {
    stopWorker();
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }

  const auditOutput = runWrangler([
    'd1', 'execute', 'sbm-db', '--local', '--persist-to', persistence, '--json',
    '--command', "SELECT action FROM audit_log WHERE action IN ('LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT','MFA_ENABLED','MFA_DISABLED','UPDATE_USER','UPDATE_CADRE','UPDATE_USER_STATUS','CREATE_IBS_SOURCE','UPDATE_IBS_SOURCE','RESET_IBS_SOURCE_PIN','CREATE_W2_INDICATOR','UPDATE_W2_INDICATOR_STATUS','CREATE_IBS_THRESHOLD','CREATE_IBS_WEEK_LOCK','UNLOCK_IBS_WEEK','REVIEW_IBS_MARKER','DELETE_W2_SUBMISSION','DELETE_SCHOOL_SUBMISSION','DELETE_IBS_THRESHOLD','DELETE_REPORT','DELETE_EVENT','DELETE_CADRE','DELETE_USER','DELETE_IBS_SOURCE')",
  ]);
  const auditRows = JSON.parse(auditOutput)[0].results;
  const actions = new Set(auditRows.map(row => row.action));
  for (const action of ['LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT','MFA_ENABLED','MFA_DISABLED','UPDATE_USER','UPDATE_CADRE','UPDATE_USER_STATUS','CREATE_IBS_SOURCE','UPDATE_IBS_SOURCE','RESET_IBS_SOURCE_PIN','CREATE_W2_INDICATOR','UPDATE_W2_INDICATOR_STATUS','CREATE_IBS_THRESHOLD','CREATE_IBS_WEEK_LOCK','UNLOCK_IBS_WEEK','REVIEW_IBS_MARKER','DELETE_W2_SUBMISSION','DELETE_SCHOOL_SUBMISSION','DELETE_IBS_THRESHOLD','DELETE_REPORT','DELETE_EVENT','DELETE_CADRE','DELETE_USER','DELETE_IBS_SOURCE'])
    assert.ok(actions.has(action), `Missing IBS audit action ${action}`);

  const schemaOutput = runWrangler([
    'd1', 'execute', 'sbm-db', '--local', '--persist-to', persistence, '--json',
    '--command', "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'",
  ]);
  const userSchema = JSON.parse(schemaOutput)[0].results[0].sql;
  assert.doesNotMatch(userSchema, /EPIDEMIOLOG/);

  console.log('Regression suite OK: admin create/delete, least privilege, cascading cleanup, workload metrics, reversible locks, validated thresholds, privacy, session revocation, completeness, and auditing.');
} finally {
  stopWorker();
  await new Promise(resolveWait => setTimeout(resolveWait, 250));
  // Miniflare/D1 can retain a Windows file handle after its process tree has
  // stopped. Avoid turning a successful suite into a multi-minute false
  // timeout; the OS will clean this uniquely named system-temp directory.
  if (process.platform !== 'win32') await rm(persistence, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}

// A killed Wrangler process can leave an inert Windows pipe handle registered
// in Node even after both streams are destroyed. This line is reached only on
// success; thrown assertions still propagate with a non-zero exit status.
if (process.platform === 'win32') process.exit(0);
