import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function reviewSessionUi({ chromium, webkit, origin, cwd, axePath, staffCookie }) {
  for (const [engine, type, options] of [['edge', chromium, { channel: 'msedge' }], ['webkit', webkit, {}]]) {
    const browser = await type.launch({ headless: true, ...options });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', bypassCSP: Boolean(axePath) });
      const page = await context.newPage();
      if (engine === 'webkit' && origin.startsWith('http:')) {
        await page.route('**/api/auth/cadre-login', async route => {
          const response = await route.fetch();
          assert.equal(response.status(), 200, 'WebKit reauthentication response failed');
          const headers = response.headers();
          const [name, ...value] = headers['set-cookie'].split(';')[0].split('=');
          delete headers['set-cookie'];
          await context.clearCookies();
          await context.addCookies([{ name, value: value.join('='), url: origin }]);
          await route.fulfill({ response, headers });
        });
      }
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const audit = async label => {
        await page.waitForTimeout(200);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${engine}: ${label} overflows`);
        if (axePath) {
          await page.addScriptTag({ path: axePath });
          const violations = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })));
          assert.deepEqual(violations, [], `${engine}: ${label} accessibility: ${JSON.stringify(violations)}`);
        }
      };
      const fixtureLogin = async (path, data) => {
        const response = await context.request.post(`${origin}${path}`, { data });
        assert.equal(response.status(), 200);
        // Match the existing regression fixtures: local HTTP cannot exercise
        // WebKit's production HTTPS Secure cookie transport.
        const [name, ...value] = response.headers()['set-cookie'].split(';')[0].split('=');
        await context.clearCookies();
        await context.addCookies([{ name, value: value.join('='), url: origin }]);
      };
      const cadreLogin = () => fixtureLogin('/api/auth/cadre-login', { cadre_code: 'TEST-CADRE-EDIT', pin: '654321' });
      const facilityLogin = () => fixtureLogin('/api/auth/ibs-login', { source_code: 'TEST-FASKES-EDIT', pin: '654321' });
      const sessionResponse = () => page.evaluate(async () => { const response = await fetch('/api/me'); return { status: response.status, data: await response.json() }; });
      const currentKind = async () => (await sessionResponse()).data.kind;
      for (const [role, login, portal, card, otherCard] of [
        ['cadre', cadreLogin, '#cadre-home', 'cadre', 'facility'],
        ['routine', facilityLogin, '#ibs-home', 'facility', 'cadre'],
      ]) {
        await login();
        await page.goto(`${origin}/${portal}`);
        await page.locator('#mobileNavigation').waitFor();
        assert.equal(await page.locator('.session-portal-link').isVisible(), false, 'Portal duplicates the primary navigation in its top bar');
        assert.equal(await page.locator('.brand').getAttribute('href'), '#home');
        await page.locator('.brand').click();
        await page.locator(`#homeSession a[href="${portal}"]`).waitFor();
        assert.equal(await currentKind(), role, 'Homepage ended the active session');
        assert.equal(await page.locator('#homePublicServices').isVisible(), false, 'Public chooser still dominates the signed-in homepage');
        assert.equal(await page.locator('#homeSignedInServices').isVisible(), true);
        assert.equal(await page.locator('#app a.button:visible').count(), 1, 'Homepage duplicates the main portal action');
        assert.equal(await page.locator('#homeSession h1').innerText(), 'Selamat datang kembali.');
        assert.equal(await page.locator('.home-account-name').innerText(), await page.locator('.session-name').innerText(), 'Homepage workspace identity differs from the active account');
        const signedInName = await page.locator('.session-name').innerText();
        await page.locator('.home-disease-link').click();
        await page.locator('#diseaseSituationTitle').waitFor();
        assert.equal(await currentKind(), role, 'Disease page ended the active session');
        assert.equal(await page.locator('.session-name').innerText(), signedInName);
        assert.equal(await page.locator('.session-portal-link').getAttribute('href'), portal);
        assert.equal(await page.locator('.session-portal-link').isVisible(), true);
        await page.waitForLoadState('networkidle');
        await page.reload();
        await page.locator('#diseaseSituationTitle').waitFor();
        assert.equal(await currentKind(), role, 'Reloading the disease page ended the active session');
        await audit(`${role} disease page with retained session`);
        await page.locator('#publicNavigation a[href="#home"]').click();
        await page.locator(`#homeSession a[href="${portal}"]`).waitFor();
        // Let the new document's session and teaser requests settle before
        // deliberately testing reload. WebKit reports cancelled fetches as
        // access-control page errors if two navigations are raced.
        await page.waitForLoadState('networkidle');
        await page.reload();
        await page.locator(`#homeSession a[href="${portal}"]`).waitFor();
        await audit(`${role} homepage`);
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
        await page.screenshot({ path: join(cwd, `.credentials/cadre-replacement-20261001/design-refined/session-${role}-${engine}.png`), fullPage: true });
        await page.setViewportSize({ width: 320, height: 844 });
        assert.equal(await page.locator('.session-chevron').isVisible(), true, 'Mobile account opening cue is hidden');
        await page.locator('.session-account > summary').focus();
        await page.keyboard.press('Enter');
        const bounds = await page.locator('.session-account-panel').evaluate(e => ({ left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right }));
        assert.ok(bounds.left >= 0 && bounds.right <= 320, 'Account menu is clipped');
        await audit(`${role} mobile account menu`);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.session-account').getAttribute('open'), null);
        await page.locator('.session-account > summary').click();
        await page.locator('.home-account-options summary').click();
        await page.locator(`[data-home-switch="${otherCard}"]`).click();
        await page.locator('#confirmAccountSwitch').waitFor();
        assert.equal(await currentKind(), role, 'Opening another login silently replaced the session');
        assert.equal(await page.locator('#cadreLogin, #ibsLogin').count(), 0);
        await audit(`${role} switch confirmation`);
        await page.locator('.account-entry-guard a[href="#home"]').click();
        await page.locator('#homeSession').waitFor();
        // A failed logout must leave identity and session access intact.
        await page.route('**/api/auth/logout', route => route.fulfill({ status: 503, json: { error: 'Simulated logout failure' } }));
        await page.locator('.session-account > summary').click();
        await page.locator('#sessionLogout').click();
        await page.getByText(/Keluar belum berhasil dikonfirmasi/).waitFor();
        assert.equal(await currentKind(), role);
        assert.equal(await page.locator('.session-portal-link').isVisible(), true);
        await page.unroute('**/api/auth/logout');
        await page.locator('#sessionLogout').click();
        await page.waitForFunction(() => !document.querySelector('.session-portal-link'));
        await page.waitForFunction(() => document.querySelector('#homeSession')?.hidden);
        assert.equal((await sessionResponse()).status, 401);
        assert.equal(await page.locator(`[data-home-account="${card}"]`).getAttribute('href'), role === 'cadre' ? '#cadre' : '#ibs-login-w2');
        await login();
        await page.reload();
        await page.locator('.session-portal-link').waitFor();
        await context.clearCookies();
        await page.reload();
        await page.getByText('Sesi Anda telah berakhir', { exact: true }).waitFor();
        assert.equal(await page.locator('.session-portal-link').count(), 0);
        assert.equal(await page.locator('#homeSession a').getAttribute('href'), role === 'cadre' ? '#cadre' : '#ibs-login-w2');
        await audit(`${role} expired session`);
        if (role === 'cadre') {
          await page.locator('#homeSession a').click();
          await page.locator('#cadreLogin').waitFor();
          await page.waitForLoadState('networkidle');
          await page.locator('#cadreLoginCode').fill('TEST-CADRE-EDIT');
          await page.locator('#cadreLoginPin').fill('654321');
          assert.equal(await page.locator('#cadreLoginCode').inputValue(), 'TEST-CADRE-EDIT', `${engine}: login form was replaced while filling`);
          assert.equal(await page.locator('#cadreLoginPin').inputValue(), '654321');
          assert.equal(await page.locator('#cadreLogin').evaluate(form => form.checkValidity()), true, `${engine}: fixture login is invalid`);
          const loginResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/cadre-login'));
          await page.locator('#cadreLogin button[type="submit"]').click();
          assert.equal((await loginResponse).status(), 200, `${engine}: reauthentication failed`);
          assert.equal(await currentKind(), 'cadre', `${engine}: reauthentication cookie was not available to the browser`);
          await page.locator('.cadre-hero').waitFor();
          assert.equal(new URL(page.url()).hash, '#cadre-home?view=report');
          await page.locator('.brand').click();
          await page.locator('.session-account > summary').click();
          await page.locator('.home-account-options summary').click();
          await page.locator('[data-home-switch="facility"]').click();
          await page.locator('#confirmAccountSwitch').click();
          await page.locator('#ibsLogin').waitFor();
          assert.equal((await sessionResponse()).status, 401, 'Confirmed switch did not end the old session');
        }
      }
      const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', bypassCSP: Boolean(axePath) });
      const [name, ...value] = staffCookie.split('=');
      await staffContext.addCookies([{ name, value: value.join('='), url: origin }]);
      const staffPage = await staffContext.newPage();
      await staffPage.goto(`${origin}/#home`);
      const staffSession = await staffPage.evaluate(async () => { const response = await fetch('/api/me'); return { status: response.status, data: await response.json() }; });
      assert.equal(staffSession.status, 200, `Staff fixture session unavailable: ${staffSession.data.error}`);
      await staffPage.locator('.session-portal-link[href="#staff-home"]').waitFor();
      assert.equal(await staffPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${engine}: staff homepage overflows`);
      if (axePath) {
        await staffPage.addScriptTag({ path: axePath });
        const violations = await staffPage.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => v.id));
        assert.deepEqual(violations, [], `${engine}: staff homepage accessibility`);
      }
      assert.deepEqual(errors, [], `${engine}: session UI runtime errors`);
    } finally { await browser.close(); }
  }
  console.log('Session UI QA OK: Edge/WebKit account identity, homepage/reload, menus, guarded switching, failed logout, expiry and return after login.');
}
