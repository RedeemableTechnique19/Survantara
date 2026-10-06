import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { buildBranding, validateBranding } from './build-branding.mjs';

const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'survantara-branding-'));
const output = join(root, 'output', 'branding-review');
let server;
let browser;
const activeBrandingBefore = await readFile(join(root, 'public', 'branding.js'), 'utf8');
try {
  const profiles = {};
  for (const name of ['example', 'umum']) {
    const directory = join(temporary, name);
    const profile = await buildBranding(name, directory);
    profiles[name] = { directory, profile };
    const html = await readFile(join(directory, 'index.html'), 'utf8');
    const css = await readFile(join(directory, 'branding.css'), 'utf8');
    assert.ok(html.includes(`<title>${profile.displayName}</title>`));
    assert.match(html, /Pemilik Survantara: Naufal Hilmy Amanur Qolby/);
    assert.match(html, /href="#about"/);
    assert.doesNotMatch(html, /\{\{\w+\}\}/, 'Unresolved shell placeholders');
    if (name === 'umum') {
      assert.doesNotMatch(html + css + await readFile(join(directory, 'branding.js'), 'utf8'), /Kesugihan|SURV360/i);
      assert.doesNotMatch(html, /href="(?:null|undefined|)"|src="(?:null|undefined|)"/);
      assert.match(html, /layanan darurat setempat/);
    } else {
      assert.match(html, /href="https:\/\/example.invalid\/emergency"/);
      assert.match(html, /Institusi Contoh/);
      assert.match(css, /--institution-hero-image: none/);
    }
  }
  const bad = structuredClone(profiles.example.profile);
  bad.contacts.emergency.href = 'javascript:alert(1)';
  assert.throws(() => validateBranding(bad), /tidak aman/);
  bad.contacts.emergency.href = 'https://example.invalid/emergency';
  bad.assets.heroImage = '/assets/../../private.jpg';
  assert.throws(() => validateBranding(bad), /path lokal/);
  await assert.rejects(buildBranding('../example', temporary), /Nama profil/);
  for (const file of ['app.js', 'ebs.js', 'cadre-statistics.js', 'brand.js', 'styles.css']) {
    const source = await readFile(join(root, 'public', file), 'utf8');
    assert.doesNotMatch(source, /SURV360|Puskesmas Kesugihan/,
      `${file}: institution branding remains in shared frontend code`);
  }
  // Generating a separate preview must not switch the active deployment.
  assert.equal(await readFile(join(root, 'public', 'branding.js'), 'utf8'), activeBrandingBefore);

  if (process.env.SBM_UI_QA) {
    const { chromium } = await import(pathToFileURL(process.env.SBM_UI_QA).href);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    let active = profiles.example.directory;
    const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
    const headersText = await readFile(join(root, 'public', '_headers'), 'utf8');
    const csp = headersText.match(/Content-Security-Policy: (.+)/)[1];
    server = createServer(async (request, response) => {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const relative = path === '/' ? 'index.html' : path.slice(1);
      const base = ['index.html', 'branding.js', 'branding.css'].includes(relative) ? active : join(root, 'public');
      const file = resolve(base, relative);
      if (!file.startsWith(resolve(base) + sep)) { response.writeHead(403).end(); return; }
      try {
        const body = await readFile(file);
        response.writeHead(200, { 'content-type': contentTypes[extname(file)] || 'application/octet-stream', 'content-security-policy': csp, 'cache-control': 'no-store' }).end(body);
      } catch { response.writeHead(404).end(); }
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await mkdir(output, { recursive: true });
    const results = [];
    for (const [name, { directory, profile }] of Object.entries(profiles)) {
      active = directory;
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        const body = path === '/api/me' ? { error: 'Belum masuk.' }
          : path === '/api/public/disease-situation' ? { available: false }
          : path === '/api/public/reporter-accounts' ? { institutions: [], cadres: [] }
          : { villages: [], signals: [], event_types: [], observations: [], contexts: [], locations: [] };
        return route.fulfill({ status: path === '/api/me' ? 401 : 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(origin);
        await page.locator('.landing-actions').waitFor();
        assert.equal(await page.locator('.brand').getAttribute('aria-label'), `${profile.displayName}, halaman beranda`);
        assert.equal(await page.locator('.footer-title').textContent(), profile.displayName);
        // The current shared layout deliberately overrides the old hero
        // background with transparency. Check the configured image independently
        // without restoring that retired visual treatment.
        const image = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--institution-hero-image'));
        assert.match(image, /none/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} overflows at ${width}px`);
        await page.screenshot({ path: join(output, `${name}-${width}.png`), fullPage: true });
      }
      for (const hash of ['#faq', '#status', '#staff', '#cadre', '#ibs-login-w2', '#situation', '#about']) {
        await page.goto(origin + '/' + hash);
        await page.waitForFunction(() => !document.querySelector('#app')?.textContent.includes('Memuat halaman'));
        await page.locator('#app h1').first().waitFor();
        const appText = await page.locator('#app').textContent();
        if (name === 'umum') assert.doesNotMatch(appText, /Kesugihan|SURV360/);
        if (hash === '#faq') assert.ok(appText.includes(profile.displayName));
        if (hash === '#about') { assert.ok(appText.includes('Naufal Hilmy Amanur Qolby')); assert.ok(appText.includes('Survantara')); }
        if (hash === '#situation') await page.getByText('Belum ada snapshot tervalidasi.', { exact: true }).waitFor();
      }
      assert.deepEqual(errors, [], `${name}: browser script errors`);
      await context.close();
      const noJs = await browser.newContext({ javaScriptEnabled: false });
      const noJsPage = await noJs.newPage();
      await noJsPage.goto(origin);
      assert.ok((await noJsPage.locator('noscript').textContent()).includes('Aktifkan JavaScript'));
      assert.equal(await noJsPage.locator('noscript a').count(), name === 'example' ? 2 : 0);
      await noJs.close();
      results.push({ profile: name, homeWidths: [320, 390, 1280], routes: 7, scriptErrors: errors, noJavaScript: 'passed' });
    }
    await writeFile(join(output, 'checks.json'), JSON.stringify(results, null, 2));
    console.log('Branding browser checks OK: both profiles, mobile/desktop, routes, CSP, and no-JavaScript contacts.');
  }
  console.log('Branding checks OK: generic separation, configured contacts/assets, URL validation, and unchanged active profile.');
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(done => server.close(done));
  // Only the uniquely created test directory is removed.
  if (resolve(temporary).startsWith(resolve(tmpdir()) + sep)) await rm(temporary, { recursive: true, force: true });
}
