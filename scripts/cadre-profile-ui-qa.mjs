import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pbkdf2Sync } from 'node:crypto';

export async function reviewCadreProfile({ chromium, webkit, origin, cwd, adminCookie, runSql, engineFilter = '' }) {
  assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):/, 'Profile QA must use a local worker');
  const output = join(cwd, 'output/cadre-profile-qa');
  await mkdir(output, { recursive: true });
  for (const [engine, type, launch] of [['edge', chromium, { channel: 'msedge' }], ['webkit', webkit, {}]]) {
    if (engineFilter && engineFilter !== engine) continue;
    const browser = await type.launch({ headless: true, ...launch });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const code = `PROFILE-UI-${engine.toUpperCase()}`;
      const create = await context.request.post(`${origin}/api/admin/cadres`, { headers: { cookie: adminCookie }, data: { cadre_code: code, name: 'Nama Lengkap Kader Uji', nickname: 'Awal', village_code: 'DEMO-A', pin: '823716' } });
      assert.equal(create.status(), 201);
      const reporterId = (await create.json()).reporter_id;
      const legacyPin = '82371645';
      const credential = runSql(`SELECT pin_salt,pin_iterations FROM reporters WHERE reporter_id='${reporterId}'`)[0];
      const legacyHash = pbkdf2Sync(legacyPin, Buffer.from(credential.pin_salt, 'base64url'), credential.pin_iterations, 32, 'sha256').toString('base64url');
      runSql(`UPDATE reporters SET nickname='',pin_hash='${legacyHash}' WHERE reporter_id='${reporterId}'`);
      const installCookie = async response => {
        const [name, ...parts] = response.headers()['set-cookie'].split(';')[0].split('=');
        await context.addCookies([{ name, value: parts.join('='), url: origin }]);
      };
      if (engine === 'webkit') {
        // Local HTTP cannot test production Secure-cookie transport in WebKit.
        for (const path of ['/api/auth/cadre-login', '/api/cadre/change-pin'])
          await page.route(`**${path}`, async route => {
            const response = await route.fetch(); const headers = response.headers();
            if (response.ok() && headers['set-cookie']) { await installCookie(response); delete headers['set-cookie']; }
            await route.fulfill({ response, headers });
          });
      }
      await page.goto(`${origin}/#cadre`);
      await page.locator('#cadreLogin [name="cadre_code"]').fill(code);
      await page.locator('#cadreLoginPin').fill(legacyPin);
      await page.locator('#cadreLogin button[type="submit"]').click();
      await page.locator('#cadreProfileForm').waitFor();
      assert.equal(new URL(page.url()).hash, '#cadre-profile', 'Incomplete roster did not open profile after login');
      await page.locator('#mobileNavigation a[href="#cadre-profile"]').waitFor();
      assert.equal(await page.locator('#cadreProfileReminder').innerText(), 'Lengkapi nama panggilan sebelum mengirim laporan baru.');
      let saves = 0;
      page.on('request', request => { if (request.url().endsWith('/api/cadre/profile') && request.method() === 'PATCH') saves++; });
      await page.locator('#cadreProfileForm button[type="submit"]').click();
      assert.equal(saves, 0, 'Empty required nickname was submitted');
      assert.equal(await page.locator('#cadreProfileNickname').evaluate(input => input.validity.valueMissing), true);
      await page.locator('#cadreProfileNickname').fill('   ');
      await page.locator('#cadreProfileForm button[type="submit"]').click();
      await page.locator('#cadreProfileMessage .error').waitFor();
      await page.locator('#cadreProfileName').fill('Nama Lengkap Baru');
      await page.locator('#cadreProfileNickname').fill('Ani');
      await page.locator('#cadreProfilePhone').fill('081234567890');
      await page.locator('#cadreProfileForm button[type="submit"]').click();
      await page.locator('#cadreProfileMessage .success').waitFor();
      assert.equal(await page.locator('.session-name').innerText(), 'Ani');
      assert.equal(await page.locator('#cadreProfileReminder').innerText(), '');
      assert.equal(await page.locator('#cadreProfileForm [name="village_code"]').count(), 0);
      await page.locator('#cadreProfileNickname').fill('Belum disimpan');
      await page.locator('#mobileNavigation a[href="#cadre-home?view=summary"]').click();
      await page.locator('#actionDialogCancel').click();
      await page.waitForURL('**/#cadre-profile');
      assert.equal(new URL(page.url()).hash, '#cadre-profile');
      assert.equal(await page.locator('#cadreProfileNickname').inputValue(), 'Belum disimpan');
      await page.locator('#cadreProfileNickname').fill('Ani');
      await page.locator('#cadreCurrentPin').fill('000000');
      await page.locator('#cadreNewPin').fill('916283');
      await page.locator('#cadreConfirmPin').fill('916284');
      await page.locator('#cadrePinForm button[type="submit"]').click();
      assert.equal(await page.locator('#cadreConfirmPin').evaluate(input => input.validity.customError), true);
      await page.locator('#cadreConfirmPin').fill('916283');
      await page.locator('#cadrePinForm button[type="submit"]').click();
      await page.locator('#cadrePinMessage .error').waitFor();
      assert.equal(await page.locator('#cadreCurrentPin').inputValue(), '000000');
      await page.locator('#cadreCurrentPin').fill(legacyPin);
      await page.locator('[data-toggle-pin="cadreCurrentPin"]').click();
      assert.equal(await page.locator('#cadreCurrentPin').getAttribute('type'), 'text');
      await page.locator('#cadrePinForm button[type="submit"]').click();
      await page.locator('#cadrePinMessage .success').waitFor();
      for (const id of ['cadreCurrentPin', 'cadreNewPin', 'cadreConfirmPin']) {
        assert.equal(await page.locator(`#${id}`).inputValue(), '');
        assert.equal(await page.locator(`#${id}`).getAttribute('type'), 'password');
      }
      const me = await page.evaluate(async () => (await fetch('/api/me')).json());
      assert.equal(me.nickname, 'Ani', 'Current browser lost its session after changing PIN');
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator('#cadreProfileForm').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${engine} profile overflows at ${width}px`);
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
        await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
        await page.screenshot({ path: join(output, `${engine}-${width}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#mobileNavigation a[href="#cadre-home?view=summary"]').click();
      await page.locator('#cadreWelcomeTitle').waitFor();
      assert.equal(await page.locator('#cadreWelcomeTitle').innerText(), 'Halo, Ani');
      // Keep a report draft while changing the nickname, then return to the
      // same draft. Greeting and optional Story identity must refresh too.
      await page.locator('#mobileNavigation a[href="#cadre-home?view=report"]').click();
      const signal = page.locator('#cadreSignals input[type="radio"]').first();
      await page.locator('#cadreSignals label').first().click();
      const signalCode = await signal.inputValue();
      await page.locator('#mobileNavigation a[href="#cadre-profile"]').click();
      await page.locator('#cadreProfileForm').waitFor();
      assert.equal(await page.locator('#cadreProfileNickname').inputValue(), 'Ani');
      await page.locator('#cadreProfileNickname').fill('Bu Ani');
      await page.locator('#cadreProfileForm button[type="submit"]').click();
      await page.locator('#cadreProfileMessage .success').waitFor();
      await page.locator('#mobileNavigation a[href="#cadre-home?view=summary"]').click();
      await page.locator('#cadreWelcomeTitle').waitFor();
      await page.waitForFunction(() => document.querySelector('#cadreWelcomeTitle')?.textContent === 'Halo, Bu Ani');
      assert.equal(await page.locator('#cadreWelcomeTitle').innerText(), 'Halo, Bu Ani', 'Returning to a draft retained an obsolete greeting');
      await page.locator('[data-statistics-content]').waitFor({ state: 'visible' });
      await page.locator('[data-statistics-name]').check();
      await page.waitForFunction(() => document.querySelector('[data-statistics-image]')?.alt.includes('Bu Ani'));
      await page.locator('#mobileNavigation a[href="#cadre-home?view=report"]').click();
      assert.equal(await page.locator('#cadreSignals input:checked').inputValue(), signalCode, 'Profile editing discarded the report draft');
      const persisted = await page.evaluate(() => ({ local: Object.values(localStorage), session: Object.values(sessionStorage) }));
      assert.doesNotMatch(JSON.stringify(persisted), /82371645|916283|000000/, 'PIN was persisted in browser storage');
      assert.deepEqual(errors, [], `${engine} profile script errors`);
      console.log(`Cadre profile UI OK: ${engine}, 1440/390/320px, required nickname, save, guard, PIN confirmation/change and retained session.`);
    } finally { await browser.close(); }
  }
}
