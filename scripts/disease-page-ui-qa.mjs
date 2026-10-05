import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyDistributionWidths } from './distribution-width-qa.mjs';

export async function reviewDiseasePage({ browser, origin, cookies, cwd, axePath }) {
  const folder = join(cwd, '.credentials/cadre-replacement-20261001/disease-page-v24');
  await mkdir(folder, { recursive: true });
  const results = [];
  for (const [role, cookie] of Object.entries(cookies)) {
    const context = await browser.newContext({ viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce', bypassCSP: Boolean(axePath) });
    if (cookie) { const [name, ...value] = cookie.split('='); await context.addCookies([{name, value: value.join('='), url: origin}]); }
    const page = await context.newPage();
    const errors = [], shapes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('service-area-shapes')) shapes.push(request.url()); });
    const audit = async name => {
      for (const [width, theme] of [[1440, 'light'], [390, 'light'], [320, 'dark']]) {
        await page.setViewportSize({width, height: width === 1440 ? 1000 : 844});
        await page.evaluate(theme => {document.documentElement.dataset.theme = theme; document.activeElement?.blur(); scrollTo({top: 0, behavior: 'instant'});}, theme);
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${role} ${name} overflows at ${width}px`);
        if (name === 'situation') {
          await verifyDistributionWidths(page);
          if (width === 1440) assert.equal(await page.locator('#diseaseSituationTitle').evaluate(heading => heading.getBoundingClientRect().height <= parseFloat(getComputedStyle(heading).lineHeight) + 1), true, 'Desktop disease heading wraps while metadata leaves unused space');
        }
        let violations = [];
        if (axePath) {
          await page.addScriptTag({path: axePath});
          violations = await page.evaluate(async () => (await axe.run(document, { runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']} })).violations.map(item => ({id: item.id, targets: item.nodes.map(node => node.target)})));
        }
        results.push({role, name, width, theme, violations});
        await writeFile(join(folder, 'accessibility-results.json'), JSON.stringify(results, null, 2));
        assert.deepEqual(violations, [], `${role} ${name} accessibility at ${width}px`);
        await page.screenshot({path: join(folder, `${role}-${name}-${width}.png`), fullPage: true});
      }
    };
    try {
      await page.goto(`${origin}/#home`);
      await page.waitForFunction(() => document.querySelector('#homeDiseaseUpdate') && !document.querySelector('#homeDiseaseUpdate').textContent.startsWith('Memuat'));
      assert.match(await page.locator('#homeDiseaseUpdate').innerText(), /^Diperbarui /);
      assert.equal(await page.locator('#diseaseSituationContent').count(), 0);
      assert.equal(shapes.length, 0, 'Homepage downloads the map geometry');
      await audit('home');
      const me = cookie ? await page.evaluate(async () => (await fetch('/api/me')).json()) : null;
      const portal = me ? me.kind === 'cadre' ? '#cadre-home' : me.kind === 'routine' ? '#ibs-home' : '#staff-home' : null;
      if (portal) await page.waitForFunction(portal=>document.querySelector('.session-portal-link')?.getAttribute('href')===portal && document.querySelector('.session-name')?.textContent!=='Memeriksa akun',portal);
      const name = me ? await page.locator('.session-name').innerText() : null;
      await page.locator('.home-disease-link').click();
      await page.locator('#diseaseGraphTab').waitFor();
      assert.equal(new URL(page.url()).hash, '#situation');
      assert.equal(await page.locator('#app h1').count(), 1);
      assert.equal(await page.locator('#publicNavigation a[aria-current="page"]').getAttribute('href'), '#situation');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      if (portal) {
        assert.equal(await page.locator('.session-name').innerText(), name);
        assert.equal(await page.locator('.session-portal-link').getAttribute('href'), portal);
        assert.equal(await page.locator('.session-portal-link').isVisible(), true);
      }
      await audit('situation');
      await page.reload();
      await page.locator('#diseaseGraphTab').waitFor();
      assert.equal(await page.locator('#publicNavigation a[aria-current="page"]').getAttribute('href'), '#situation');
      if (portal) {await page.waitForFunction(name=>document.querySelector('.session-name')?.textContent===name,name);assert.equal(await page.locator('.session-name').innerText(), name);}
      await page.locator('#publicNavigation a[href="#status"]').click();
      await page.locator('#statusForm').waitFor();
      await page.waitForTimeout(100);
      const selectedVisible = await page.locator('#publicNavigation a[aria-current="page"]').evaluate(link => {
        const box = link.getBoundingClientRect(), viewport = link.parentElement.getBoundingClientRect();
        return box.left >= viewport.left - 1 && box.right <= viewport.right + 1;
      });
      assert.equal(selectedVisible, true, 'Active mobile navigation item is clipped');
      await page.goBack();
      await page.locator('#diseaseGraphTab').waitFor();
      await page.goForward();
      await page.locator('#statusForm').waitFor();
      assert.deepEqual(errors, [], `${role}: page errors`);
      if (role === 'public') {
        let responseMode = 'empty';
        await page.route('**/api/public/disease-situation', route => responseMode === 'empty' ? route.fulfill({json: {available: false}}) : responseMode === 'error' ? route.fulfill({status: 503, json: {error: 'Fixture unavailable'}}) : route.continue());
        await page.goto(`${origin}/?qa=empty#home`);
        await page.getByText('Data akan tersedia setelah dipublikasikan oleh petugas.', {exact: true}).waitFor();
        await page.locator('.home-disease-link').click();
        await page.locator('#diseaseSituationMessage.is-empty').waitFor();
        assert.equal(await page.locator('#diseaseSituationContent').isVisible(), false);
        await audit('empty');
        responseMode = 'error';
        await page.goto(`${origin}/?qa=error#home`);
        await page.getByText(/Tanggal pembaruan belum dapat dimuat/).waitFor();
        await page.locator('.home-disease-link').click();
        await page.locator('#retryDiseaseSituation').waitFor();
        await audit('error');
        responseMode = 'normal';
        await page.locator('#retryDiseaseSituation').click();
        await page.locator('#diseaseGraphTab').waitFor();
        assert.equal(await page.locator('#diseaseSituationMessage.is-error').count(), 0);
      }
    } finally { await context.close(); }
  }
  console.log(`Disease page QA OK: ${results.length} role/page/size/theme audits; navigation, sessions, empty/error recovery, and charts.`);
}
