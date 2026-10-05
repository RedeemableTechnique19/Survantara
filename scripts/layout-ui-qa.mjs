import assert from 'node:assert/strict';
import { verifyDistributionWidths } from './distribution-width-qa.mjs';

// Runs against the regression suite's disposable database and synthetic users.
export async function reviewLayouts({ browser, origin, adminCookie, viewerCookie, reportId }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.route('**/*', async route => {
    if (!route.request().isNavigationRequest()) return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' https://unpkg.com; img-src 'self' data: https://unpkg.com https://tile.openstreetmap.org; object-src 'none'" } });
  });
  const errors = [];
  let navigation = 0;
  page.on('pageerror', error => errors.push(error.message));
  const navigate = async route => {
    // A new document also refreshes identity after changing synthetic cookies.
    await page.goto(`${origin}/?layout-qa=${++navigation}${route}`);
    await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') !== 'true');
    await page.waitForLoadState('networkidle');
  };
  const setCookie = async cookie => {
    await context.clearCookies();
    const [name, ...value] = cookie.split('=');
    await context.addCookies([{ name, value: value.join('='), url: origin }]);
  };
  try {
    await navigate('#home');
    await page.locator('.home-disease-link').waitFor();
    assert.equal(await page.locator('#diseaseSituationContent').count(), 0, 'Homepage still contains the full disease dashboard');
    await page.locator('.home-disease-link').click();
    await page.locator('#diseaseGraphTab').waitFor();
    assert.equal(new URL(page.url()).hash, '#situation', 'Disease teaser does not open its own page');
    assert.equal(await page.locator('#publicNavigation a[aria-current="page"]').getAttribute('href'), '#situation');
    assert.equal(await page.locator('#diseaseSituationTitle').evaluate(node => node.tagName), 'H1');
    await page.reload();
    await page.locator('#diseaseGraphTab').waitFor();
    await verifyDistributionWidths(page);
    assert.equal(await page.locator('#diseaseVillageBars').isVisible(), true, 'Village distribution does not default to bars');
    assert.equal(await page.locator('#diseaseVillageMap').isVisible(), false);
    const bars = await page.locator('.disease-distribution-bars li').evaluateAll(rows => rows.map(row => row.textContent));
    await page.locator('#diseaseGraphTab').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#diseaseMapTab').getAttribute('aria-selected'), 'true', 'Keyboard cannot select the map');
    assert.equal(await page.locator('#diseaseVillageMap').isVisible(), true);
    const map = await page.locator('.disease-village-list li').evaluateAll(rows => rows.map(row => row.textContent));
    assert.deepEqual(bars, map, 'Map and bars show different published counts');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#diseaseVillageBars').isVisible(), true);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await page.locator('#publicNavigation a[href="#home"]').click();
    await page.locator('.landing-primary-action').click();
    await page.locator('#publicForm').waitFor();
    assert.equal(new URL(page.url()).hash, '#public', 'Reporting shortcut does not open its own page');

    await setCookie(adminCookie);
    await navigate('#admin-ibs');
    assert.equal(await page.locator('.indicator-policy-row:visible').count(), 6, 'Settings expose too many initial editors');
    const lastName = await page.locator('.indicator-policy-row .admin-disease-name strong').last().textContent();
    await page.locator('#indicatorPolicySearch').fill(lastName);
    assert.equal(await page.locator('.indicator-policy-row:visible').count(), 1, 'Search does not find a policy beyond the initial page');
    await page.locator('#indicatorPolicySearch').fill('');
    const row = page.locator('.indicator-policy-row').filter({ has: page.locator('.indicatorIdentityPolicy') }).first();
    await row.locator('summary').click();
    const select = row.locator('.indicatorIdentityPolicy');
    const original = await select.inputValue();
    const code = await select.getAttribute('data-id');
    const changed = original === 'OPTIONAL' ? 'CONDITIONAL' : 'OPTIONAL';
    await select.selectOption(changed);
    assert.equal(await row.locator('.policy-row-state').innerText(), 'Belum disimpan');
    const response = page.waitForResponse(response => response.url().endsWith(`/indicators/${code}/identity-policy`) && response.request().method() === 'POST');
    await row.locator('.saveIndicatorIdentityPolicy').click();
    assert.equal((await response).status(), 200, 'Compact policy save failed');
    await page.getByText('Kebijakan rincian pasien diperbarui.', { exact: true }).waitFor();
    assert.equal(await page.locator(`.indicatorIdentityPolicy[data-id="${code}"]`).inputValue(), changed, 'Policy was not persisted');
    const savedRow = page.locator('.indicator-policy-row').filter({ has: page.locator(`.indicatorIdentityPolicy[data-id="${code}"]`) });
    await savedRow.locator('summary').click();
    await savedRow.locator('select').selectOption(original);
    const restored = page.waitForResponse(response => response.url().endsWith(`/indicators/${code}/identity-policy`) && response.request().method() === 'POST');
    await savedRow.locator('.saveIndicatorIdentityPolicy').click();
    assert.equal((await restored).status(), 200);
    await page.waitForFunction(({ code, original }) => document.querySelector(`.indicatorIdentityPolicy[data-id="${code}"]`)?.dataset.original === original, { code, original });
    const labRow = page.locator('.indicator-policy-row').filter({ has: page.locator(`.indicatorLabTracking[data-id="${code}"]`) });
    await labRow.locator('summary').click();
    const originalLab = await labRow.locator('.indicatorLabTracking').isChecked();
    for (const checked of [!originalLab, originalLab]) {
      await labRow.locator('.admin-switch').click();
      assert.equal(await labRow.locator('.indicatorLabTracking').isChecked(), checked, 'Lab switch label does not toggle its control');
      const labSaved = page.waitForResponse(response => response.url().endsWith(`/indicators/${code}/lab-tracking`) && response.request().method() === 'POST');
      await labRow.locator('.saveIndicatorLabTracking').click();
      assert.equal((await labSaved).status(), 200, 'Compact lab switch save failed');
      await page.waitForFunction(({ code, checked }) => document.querySelector(`.indicatorLabTracking[data-id="${code}"]`)?.dataset.original === String(Number(checked)), { code, checked });
      assert.equal(await labRow.locator('.indicatorLabTracking').isChecked(), checked, 'Lab switch did not persist');
      if (checked !== originalLab) await labRow.locator('summary').click();
    }
    for (const panel of ['admin-institutions', 'admin-advanced']) {
      await page.locator(`[data-admin-jump="${panel}"]`).click();
      if (panel === 'admin-advanced') {
        assert.ok(await page.locator('[data-advanced-row]:visible').count() <= 12, 'Advanced settings show every row at once');
        await page.locator('#advancedDataSearch').fill('no-matching-rule');
        assert.equal(await page.locator('[data-advanced-row]:visible').count(), 0);
        await page.locator('#advancedDataSearch').fill('');
      }
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const overflowingTables = await page.locator(`#${panel} .table-wrap`).evaluateAll(wrappers => wrappers.filter(wrapper => wrapper.checkVisibility() && wrapper.querySelector('tr:last-child')?.getBoundingClientRect().bottom > wrapper.getBoundingClientRect().bottom + 2).length);
        assert.equal(overflowingTables, 0, `${panel}: mobile cards overlap the section below`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${panel}: narrow layout overflows`);
      }
    }

    // Old bookmarks resolve to the single report review workspace.
    await navigate(`#staff-legacy-report/${reportId}`);
    assert.equal(new URL(page.url()).hash,`#staff-report/${reportId}`);
    assert.ok(!(await page.locator('#app h1').innerText()).includes(reportId));
    assert.equal(await page.locator('#app a[href^="#staff-legacy"]').count(),0);
    assert.equal(await page.getByText('Administrasi lanjutan',{exact:true}).count(),0);
    assert.equal(await page.locator('#ebsDecision [name="outcome"]').inputValue(),'NOT_CONFIRMED');
    assert.equal(await page.locator('#ebsDecision [data-classification]').isVisible(),false);
    let mutations=0;
    page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/reports/'+reportId))mutations++;});
    await page.locator('.report-next-actions [data-open-work]').click();
    assert.equal(await page.locator('#ebsDecision').isVisible(),true);
    assert.equal(await page.locator('#ebsDecision [name="notes"]').getAttribute('required'),'');
    assert.equal(mutations,0,'Opening a section changes a report');
    await navigate('#staff-legacy-reports');
    assert.equal(new URL(page.url()).hash,'#staff-ebs-all');
    await setCookie(viewerCookie);
    await navigate(`#staff-legacy-report/${reportId}`);
    assert.equal(await page.locator('#ebsDecision,#ebsAssign,#deleteReport,#retryReportNotification').count(),0,'Read-only detail exposes privileged actions');
    assert.deepEqual(errors, [], 'Layout changes cause browser runtime errors');
    console.log('Approved layouts QA OK: chart/map parity, routes, compact policy persistence, mobile containment, report action and read-only access.');
  } finally { await context.close(); }
}
