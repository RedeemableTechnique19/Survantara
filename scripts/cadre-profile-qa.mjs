import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { reviewCadreProfile } from './cadre-profile-ui-qa.mjs';

const cwd = resolve(import.meta.dirname, '..');
const persistence = await mkdtemp(join(tmpdir(), 'sbm-profile-qa-'));
assert.equal(dirname(persistence), resolve(tmpdir()));
assert.ok(basename(persistence).startsWith('sbm-profile-qa-'));
const wrangler = join(cwd, 'node_modules/wrangler/bin/wrangler.js');
const port = 9350 + process.pid % 200;
const origin = `http://127.0.0.1:${port}`;
const run = args => {
  const result = spawnSync(process.execPath, [wrangler, ...args], { cwd, encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw Error(result.stderr || result.stdout);
  return result.stdout;
};
let worker, log = '';
try {
  run(['d1', 'migrations', 'apply', 'sbm-db', '--local', '--persist-to', persistence]);
  run(['d1','execute','sbm-db','--local','--persist-to',persistence,'--file',join(cwd,'tests/fixtures/villages.sql')]);
  worker = spawn(process.execPath, [wrangler, 'dev', '--port', String(port), '--persist-to', persistence,
    '--var', 'JWT_SECRET:profile-qa-jwt', '--var', 'BOOTSTRAP_TOKEN:profile-qa-bootstrap'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', data => { log = (log + data).slice(-10000); });
  worker.stderr.on('data', data => { log = (log + data).slice(-10000); });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${origin}/api/public/masters`)).ok) break; } catch {}
    if (i === 149) throw Error(`Worker startup failed: ${log}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 200));
  }
  const request = (path, body, headers = {}) => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const identity = { email: 'profile-qa@example.com', name: 'Profile QA', password: 'Cloudy!Rivers#4719-Safe' };
  const bootstrap = await request('/api/bootstrap', identity, { 'x-bootstrap-token': 'profile-qa-bootstrap' });
  assert.equal(bootstrap.status, 201, await bootstrap.text());
  const auth = await request('/api/auth/login', identity);
  assert.equal(auth.status, 200, await auth.text());
  const adminCookie = auth.headers.get('set-cookie').split(';')[0];
  if (!process.env.SBM_UI_QA) throw Error('Set SBM_UI_QA to the local Playwright index.mjs path.');
  const { chromium, webkit } = await import(pathToFileURL(process.env.SBM_UI_QA).href);
  await reviewCadreProfile({ chromium, webkit, origin, cwd, adminCookie, engineFilter: process.env.SBM_PROFILE_ENGINE || '',
    runSql: command => JSON.parse(run(['d1', 'execute', 'sbm-db', '--local', '--persist-to', persistence, '--json', '--command', command]))[0].results });
} finally {
  if (worker) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(worker.pid), '/T', '/F'], { stdio: 'ignore' });
    else worker.kill('SIGTERM');
    worker.stdout?.destroy(); worker.stderr?.destroy(); worker.removeAllListeners();
  }
  await rm(persistence, { recursive: true, force: true, maxRetries: 2 }).catch(() => {});
}
