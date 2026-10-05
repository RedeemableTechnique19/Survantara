import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Browser-only receipt fixtures: API persistence/authorization is tested by the
// regression suite. These checks never submit a health report to production.
export async function reviewWorkflows({ chromium, webkit, origin, cadreCookie, facilityCookie, cwd, axePath }) {
  const output = join(cwd, '.credentials/cadre-replacement-20261001/design-refined');
  await mkdir(output, { recursive: true });
  const results = [];
  for (const [engine, browserType, launchOptions] of [['edge', chromium, { channel: 'msedge' }], ['webkit', webkit, {}]]) {
    const browser = await browserType.launch({ headless: true, ...launchOptions });
    const errors = [];
    try {
      // Only the audit context bypasses CSP to inject axe; app security headers stay intact.
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', bypassCSP: Boolean(axePath) });
      await context.addInitScript(() => localStorage.setItem('sbm.theme', 'light'));
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const capture = async name => {
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(output, `${name}-${engine}.png`), fullPage: true });
      };
      const audit = async label => {
        // Focus handoff is asserted separately. Normalize the viewport for the
        // layout audit so resizing does not leave a control sliced by the sticky header.
        await page.evaluate(() => { if (!document.querySelector('dialog[open]')) window.scrollTo({ top: 0, behavior: 'instant' }); });
        await page.waitForTimeout(250);
        if (axePath) {
          await page.addScriptTag({ path: axePath });
          for (const theme of ['light', 'dark']) {
            await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
            await page.waitForTimeout(250);
            const result = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => ({ target: node.target, failure: node.failureSummary })) })));
            results.push({ engine, page: label, theme, violations: result });
          }
          await page.evaluate(() => document.documentElement.dataset.theme = 'light');
          await writeFile(join(output, 'accessibility-results.json'), JSON.stringify(results, null, 2));
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${engine}: overflow on ${label}`);
      };
      await page.goto(`${origin}/#home`);
      await page.locator('.landing-service-grid').waitFor();
      await page.waitForFunction(() => !document.querySelector('#homeDiseaseUpdate')?.textContent.startsWith('Memuat'));
      assert.equal(await page.locator('#diseaseSituationContent').count(), 0, 'Homepage still renders the complete dashboard');
      assert.equal(await page.locator('#publicNavigation a[aria-current="page"]').getAttribute('href'), '#home');
      await audit('public home');
      await page.locator('.home-disease-link').click();
      await page.locator('#diseaseGraphTab').waitFor();
      assert.equal(await page.locator('#publicNavigation a[aria-current="page"]').getAttribute('href'), '#situation');
      await audit('dedicated public disease situation');
      await capture('disease-page-mobile');
      if (await page.locator('.data-explanation').count()) {
        await page.locator('.data-explanation summary').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('.data-explanation').getAttribute('open'), '');
      }
      await page.goto(`${origin}/#public`);
      await page.locator('#publicNavigation a[aria-current="page"][href="#public"]').waitFor();
      await page.locator('label:has(input[value="OTHER"])').click();
      await audit('resident form');
      await page.locator('[data-step-next="2"]').click();
      await page.locator('[data-step-next="3"]').click();
      await page.locator('#village').selectOption('DEMO-A');
      await page.locator('#eventDate').fill('2026-10-01');
      if (await page.locator('#affectedGroup').isVisible()) await page.locator('#affectedGroup').selectOption('UNKNOWN');
      for (const id of ['estimatedCases', 'estimatedDeaths', 'hospitalizedCases']) {
        if (await page.locator(`#${id}`).isVisible()) await page.locator(`#${id}`).fill(id === 'estimatedCases' ? '1' : '0');
      }
      await page.locator('#location').fill('Lokasi uji antarmuka');
      await page.locator('#description').fill('Kejadian uji untuk memeriksa bukti dan tindak lanjut laporan.');
      await page.locator('[data-step-next="4"]').click();
      await page.locator('#anonymous').check();
      await page.locator('[name="privacy_consent"]').check();
      let writeAttempts = 0;
      await page.route('**/api/public/reports', async route => {
        writeAttempts += 1;
        if (writeAttempts === 1) return route.abort('failed');
        await route.fulfill({ json: { report_id: 'UI-RECEIPT-001', pin: '12345678' } });
      });
      await page.locator('#publicForm button[type="submit"]').click();
      await page.getByText(/Koneksi terputus/).waitFor();
      assert.equal(await page.locator('#description').inputValue(), 'Kejadian uji untuk memeriksa bukti dan tindak lanjut laporan.');
      assert.equal(writeAttempts, 1, 'Failed POST must not be automatically repeated');
      await page.locator('#publicForm button[type="submit"]').click();
      await page.locator('#saveReportReceipt').waitFor();
      assert.equal(await page.locator('#publicForm').isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'message');
      await audit('resident receipt');
      await capture('resident-receipt');
      if (engine === 'edge') {
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#saveReportReceipt').click();
        const download = await downloadPromise;
        assert.equal(download.suggestedFilename(), 'bukti-laporan-UI-RECEIPT-001.txt');
        assert.equal(await download.failure(), null);
      }
      await page.locator('#checkSubmittedReport').click();
      await page.locator('#statusId').waitFor();
      assert.equal(await page.locator('#publicNavigation a[aria-current="page"]').getAttribute('href'), '#status');
      assert.equal(await page.locator('#statusId').inputValue(), 'UI-RECEIPT-001');
      assert.equal(await page.locator('#statusPin').inputValue(), '12345678');
      await audit('resident status lookup');
      let statusAttempts = 0;
      await page.route('**/api/public/status', async route => {
        statusAttempts += 1;
        const credentials = route.request().postDataJSON();
        if (credentials.pin !== '12345678') return route.fulfill({ status: 404, json: { error: 'ID laporan atau PIN tidak sesuai.' } });
        return route.fulfill({ json: { report_id: credentials.report_id, current_status: 'SEDANG_DIVERIFIKASI', updated_at: '2026-10-02T03:00:00Z', allow_contact: false } });
      });
      await page.locator('#statusPin').fill('00000000');
      await page.locator('#statusForm button[type="submit"]').click();
      await page.locator('#statusError').getByText('ID laporan atau PIN tidak sesuai.').waitFor();
      assert.equal(await page.locator('#statusId').inputValue(), 'UI-RECEIPT-001');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'statusError');
      await page.locator('#statusPin').fill('12345678');
      await page.locator('#statusForm button[type="submit"]').click();
      await page.locator('#statusResult .status-SEDANG_DIVERIFIKASI').waitFor();
      assert.equal(statusAttempts, 2);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'statusResult');
      await audit('resident tracked report after correcting PIN');
      await capture('resident-tracked-report');

      const addCookie = async cookie => {
        await context.clearCookies();
        const [name, ...value] = cookie.split('=');
        await context.addCookies([{ name, value: value.join('='), url: origin }]);
      };
      await addCookie(cadreCookie);
      await page.route('**/api/cadre/reports?*', async route => {
        if (route.request().method() === 'GET') { await new Promise(resolve => setTimeout(resolve, 700)); return route.abort('failed'); }
        await route.continue();
      });
      await page.goto(`${origin}/#cadre-home`);
      await page.locator('#cadreReportPanel').waitFor();
      assert.equal(await page.locator('#cadreReportPanel').isVisible(),true);
      assert.equal(await page.locator('#cadreTaskSummary, #cadreFollowupPanel, #cadreOverviewPanel').count(),0);
      const cadreIdentity = await page.evaluate(async () => (await fetch('/api/me')).json());
      await page.setViewportSize({ width: 1365, height: 900 });
      await page.locator('#workspaceNavigation .workspace-nav-identity').waitFor();
      assert.equal(await page.locator('.workspace-nav-identity strong').innerText(),cadreIdentity.name);
      assert.equal(await page.locator('#workspaceNavigation a[href="#cadre-home?view=report"]').innerText(),'Buat laporan');
      assert.equal(await page.locator('#workspaceNavigation a[href="#cadre-home?view=history"]').innerText(),'Riwayat laporan');
      assert.equal(await page.locator('#workspaceNavigation a[href^="#staff-"]').count(),0);
      assert.equal(await page.locator('#workspaceNavigation a[href="#cadre-home?view=followup"]').count(),0);
      await capture('cadre-sidebar-desktop');
      await page.setViewportSize({ width: 390, height: 844 });
      await audit('cadre reporting portal');
      await capture('cadre-reporting');
      await page.locator('label:has(input[value="OTHER"])').click();
      assert.equal(await page.locator('#cadreDraftState').innerText(),'Isian belum dikirim');
      assert.equal(await page.locator('.cadre-form-heading h2').innerText(),'Informasi kejadian');
      await page.locator('#mobileNavigation a[href="#cadre-home?view=history"]').click();
      await page.locator('#cadreHistoryPanel [data-cadre-open="report"]').click();
      assert.equal(await page.locator('#cadreForm input[value="OTHER"]').isChecked(),true,'Changing panels discards a report draft');
      assert.equal(await page.locator('.cadre-report-context').isVisible(),true);
      assert.equal(await page.locator('#mobileNavigation a[aria-current="page"]').getAttribute('href'),'#cadre-home?view=report');
      await page.locator('#mobileNavigation a[href="#cadre-home?view=history"]').click();
      assert.equal(await page.locator('#publicNavigation').isVisible(),false);
      assert.equal(await page.evaluate(() => document.activeElement.textContent),'Daftar laporan');
      for(const width of [390,320]) {
        await page.setViewportSize({width,height:844});
        await audit('cadre report history at '+width);
      }
      await page.setViewportSize({width:390,height:844});
      await page.locator('#mobileNavigation a[href="#cadre-home?view=report"]').click();
      await page.locator('[data-cadre-next="2"]').click();
      await page.locator('[data-cadre-next="3"]').click();
      if(await page.locator('#cadreAffectedGroup').isVisible()) await page.locator('#cadreAffectedGroup').selectOption('UNKNOWN');
      await page.locator('#cadreLocation').fill('Lokasi uji kader');
      await page.locator('[data-cadre-next="4"]').click();
      await page.locator('#cadreDescription').fill('Laporan uji tampilan setelah pengiriman.');
      await page.route('**/api/cadre/reports',route=>route.fulfill({json:{report_id:'UI-CADRE-001'}}));
      await page.locator('#cadreForm button[type="submit"]').click();
      await page.locator('#cadreReceiptReport').waitFor();
      await page.getByText(/Laporan berhasil dikirim, tetapi riwayat/).waitFor();
      assert.ok((await page.locator('#message').innerText()).includes('Menunggu ditinjau petugas'));
      assert.equal(await page.locator('#retryCadreHistory').isVisible(),true);
      assert.equal(await page.locator('#cadreReportCount').innerText(),'—');
      await audit('cadre receipt with failed history refresh');
      await capture('cadre-receipt');
      await page.locator('#cadreReceiptNew').click();
      assert.equal(await page.locator('#cadreDescription').inputValue(),'');

      // Answers live in report details. Accepted answers stay acknowledged offline.
      const clarifications=[
        {clarification_id:'UI-QUESTION-1',question:'Di mana lokasi kejadian?',requested_at:'2026-10-02T03:00:00Z',requested_by_name:'Petugas',answered_at:null},
        {clarification_id:'UI-QUESTION-2',question:'Kapan kejadian diketahui?',requested_at:'2026-10-02T03:00:00Z',requested_by_name:'Petugas',answered_at:null},
      ];
      const reportRow={report_id:'UI-CADRE-001',signal_label:'Kejadian kesehatan',signal_code:'OTHER',village_name:'Desa Uji A',village_code:'DEMO-A',submitted_at:'2026-10-02T03:00:00Z',event_start_date:'2026-10-01',affected_group:'UNKNOWN',reported_cases:1,reported_deaths:0,severe_cases:0,hospitalized_cases:0,workflow_status:'NEEDS_CLARIFICATION',current_status:'BARU',description:'Uraian laporan uji'};
      let detailOffline=false,answerWrites=0;
      await page.route('**/api/cadre/reports?*',route=>route.fulfill({json:{rows:[reportRow],total:1}}));
      await page.route('**/api/ebs/reports/UI-CADRE-001',route=>detailOffline?route.abort('failed'):route.fulfill({json:{report:{...reportRow,reporter_name:cadreIdentity.name},handling:{status:'BARU'},clarifications,history:[]}}));
      await page.route('**/api/sbm/clarifications/*/answer',route=>{
        answerWrites++;
        clarifications[0].answer=route.request().postDataJSON().answer;
        clarifications[0].answered_at='2026-10-02T04:00:00Z';
        detailOffline=true;
        return route.fulfill({json:{ok:true}});
      });
      await page.goto(origin+'/#cadre-home?view=followup');
      await page.locator('#cadreHistoryPanel').waitFor();
      assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('view'),'history');
      await page.locator('[data-report-id="UI-CADRE-001"] [data-cadre-detail-action]').click();
      const report=page.locator('#app');
      await page.locator('.cadre-report-heading').waitFor();
      await report.locator('.ebs-answer[data-id="UI-QUESTION-2"] textarea').fill('Jawaban kedua masih berupa draf.');
      const firstAnswer=report.locator('.ebs-answer[data-id="UI-QUESTION-1"]');
      await firstAnswer.locator('textarea').fill('Balai desa Desa Uji A.');
      await firstAnswer.getByRole('button',{name:'Kirim jawaban'}).click();
      await report.getByText('Jawaban berhasil dikirim ke petugas.',{exact:true}).waitFor();
      await report.locator('[data-thread-error]').waitFor();
      assert.equal(answerWrites,1);
      assert.equal(await firstAnswer.count(),0,'Accepted answer still offers resubmission');
      assert.equal(await report.locator('.ebs-answer textarea').inputValue(),'Jawaban kedua masih berupa draf.');
      await audit('cadre accepted answer with failed detail refresh');
      await capture('cadre-answer-refresh-failed');
      detailOffline=false;
      await report.locator('[data-thread-error] button').click();
      await report.getByText('Balai desa Desa Uji A.',{exact:true}).waitFor();
      assert.equal(await report.locator('.ebs-answer textarea').inputValue(),'Jawaban kedua masih berupa draf.');
      assert.equal(answerWrites,1,'Refreshing detail resubmits the answer');
      await audit('cadre report detail recovery retains another answer draft');
      await report.locator('.ebs-answer textarea').fill('');
      await page.route('**/api/cadre/reports?*',route=>{
        const params=new URL(route.request().url()).searchParams;
        const offset=Number(params.get('offset')),limit=Number(params.get('limit'));
        const rows=Array.from({length:18},(_,i)=>({...reportRow,report_id:'UI-HISTORY-'+i,signal_label:'Kejadian '+(i+1),workflow_status:'SUBMITTED'}));
        return route.fulfill({json:{rows:rows.slice(offset,offset+limit),total:rows.length}});
      });
      await page.goto(origin+'/?qa=cadre-history#cadre-home?view=history');
      await page.locator('[data-report-id="UI-HISTORY-0"]').waitFor();
      assert.equal(await page.locator('.cadre-report-row').count(),8);
      await page.locator('[data-cadre-page="next"]').click();
      await page.locator('[data-report-id="UI-HISTORY-8"]').waitFor();
      assert.equal(await page.locator('[data-report-id="UI-HISTORY-0"]').count(),0);
      await audit('cadre readable paginated history');
      await capture('cadre-history-narrow');
      await page.goto(`${origin}/#home`);

      await addCookie(facilityCookie);
      let facilityDraft = null;
      let draftOffline = true;
      let manualDraftWrites = 0;
      await page.route('**/api/ibs/w2?*', async route => {
        const response = await route.fetch();
        const payload = await response.json();
        payload.locked = false;
        payload.submission = facilityDraft?.submission || null;
        payload.case_details = [];
        payload.indicators.forEach(item => { item.value = facilityDraft?.values[item.indicator_code]?.cases || 0; item.lab_examined_count = 0; });
        payload.reporting_calendar.weeks.forEach(item => {
          if (item.week >= payload.period.week - 10 && item.week <= payload.period.week && !['ON_TIME', 'LATE'].includes(item.status)) {
            item.expected = true;
            item.status = item.week === payload.period.week ? facilityDraft ? 'DRAFT' : 'OPEN' : 'MISSING';
          }
        });
        await route.fulfill({ response, json: payload });
      });
      await page.route('**/api/ibs/w2', route => {
        if (route.request().method() !== 'POST') return route.continue();
        const body = route.request().postDataJSON();
        if (!body.checkpoint) manualDraftWrites += 1;
        if (draftOffline) return route.abort('failed');
        const submission = { submission_id: 'UI-DRAFT-001', submission_status: 'DRAFT', revision: 1, notes: body.notes, reviewed_codes: body.reviewed_codes, total_visits_reviewed: body.total_visits_reviewed };
        facilityDraft = { submission, values: body.values };
        return route.fulfill({ json: submission });
      });
      await page.setViewportSize({ width: 1365, height: 900 });
      await page.goto(`${origin}/#ibs-home`);
      await page.locator('#openW2Task').waitFor();
      const facilityIdentity = await page.evaluate(async () => (await fetch('/api/me')).json());
      assert.equal(await page.locator('.workspace-nav-identity strong').innerText(), facilityIdentity.source_name, 'Sidebar does not identify the active institution');
      assert.equal(await page.locator('#workspaceNavigation a[href="#ibs-home?view=report"]').innerText(), 'Laporan W2');
      assert.equal(await page.locator('#workspaceNavigation a[href="#ibs-home?view=history"]').innerText(), 'Riwayat pengiriman');
      await capture('facility-sidebar-desktop');
      await page.locator('#openW2Task').click();
      await page.waitForFunction(() => document.activeElement.matches('.w2-heading h2'));
      assert.equal(await page.evaluate(() => document.activeElement.matches('.w2-heading h2')), true);
      await audit('facility entry');
      await page.locator('#case-desktop-X').fill('3');
      await page.locator('#saveDraft').click();
      await page.getByText(/Koneksi terputus/).waitFor();
      assert.equal(await page.locator('.w2-save-state').innerText(), 'Draf belum tersimpan');
      assert.equal(await page.locator('.w2-save-state').getAttribute('data-state'), 'error', 'Failed draft must show an error state');
      await page.locator('#nextDetails').click();
      assert.match(await page.locator('.w2-save-state').innerText(), /belum tersimpan|Menyimpan/, 'Changing steps falsely claims the offline draft is saved');
      await audit('facility unsaved draft after changing step');
      draftOffline = false;
      await page.locator('#saveDraft').click();
      await page.waitForFunction(() => document.querySelector('.w2-save-state')?.textContent.startsWith('Draf tersimpan'));
      assert.equal(manualDraftWrites, 2, 'Manual draft retry sent unexpected duplicate writes');
      await page.reload();
      await page.locator('#case-desktop-X').waitFor();
      assert.equal(await page.locator('#case-desktop-X').inputValue(), '3', 'Reload loses the saved draft value');
      assert.equal(await page.locator('#w2TaskTitle').innerText(), 'Draf belum dikirim');
      await page.locator('#workspaceNavigation a[href="#ibs-home?view=history"]').click();
      assert.equal(await page.locator('.w2-hero h1').innerText(), 'Riwayat pengiriman');
      assert.equal(await page.locator('.w2-calendar-card').getAttribute('open'), '');
      assert.ok(await page.locator('.w2-history-row').count() <= 6, 'History shows more than six rows');
      assert.equal(await page.locator('.w2-year-grid').getAttribute('open'), null, 'Full year calendar should be secondary');
      await page.locator('#reportingHistoryFilter').selectOption('SUBMITTED');
      assert.equal(await page.locator('.w2-history-row .history-status:not(.on-time):not(.late)').count(), 0, 'Submitted filter includes unsent weeks');
      await page.locator('#reportingHistoryFilter').selectOption('ALL');
      {
        const firstWeek = await page.locator('[data-reporting-week]').first().getAttribute('data-reporting-week');
        await page.locator('[data-history-page="next"]').click();
        assert.notEqual(await page.locator('[data-reporting-week]').first().getAttribute('data-reporting-week'), firstWeek, 'History pagination does not advance');
        await page.locator('[data-history-page="previous"]').click();
        assert.equal(await page.locator('[data-reporting-week]').first().getAttribute('data-reporting-week'), firstWeek);
      }
      const currentWeek = await page.locator('.w2-calendar-week[aria-current="date"]').getAttribute('data-calendar-week');
      const olderWeek = await page.locator('[data-reporting-week]').nth(1).getAttribute('data-reporting-week');
      await page.locator('[data-reporting-week]').nth(1).click();
      await page.waitForFunction(week => document.querySelector('.w2-calendar-week[aria-current="date"]')?.dataset.calendarWeek === week, olderWeek);
      assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('epi_week'), olderWeek, 'Readable history row loses its selected period');
      await page.locator('#currentW2').click();
      await page.waitForFunction(week => document.querySelector('.w2-calendar-week[aria-current="date"]')?.dataset.calendarWeek === week, currentWeek);
      await page.locator('#workspaceNavigation a[href="#ibs-home?view=history"]').click();
      await capture('facility-history-desktop');
      await page.setViewportSize({ width: 320, height: 844 });
      await audit('facility readable history at narrow width');
      await capture('facility-history-narrow');
      await page.locator('.w2-year-grid > summary').click();
      await page.locator('.w2-calendar-week[aria-current="date"]').waitFor();
      await page.locator('.w2-calendar-card > summary').click();
      await audit('facility resumed draft and discoverable reporting history');
      await page.setViewportSize({ width: 1365, height: 900 });
      await page.locator('#workspaceNavigation a[href="#ibs-home?view=report"]').click();
      await page.locator('#zeroW2').click();
      await page.locator('#case-desktop-X').fill('1');
      await page.locator('#nextDetails').click();
      await page.locator('#nextReview').click();
      await audit('facility review');
      let revisionPending = false;
      await page.route('**/api/ibs/w2', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const action = route.request().postDataJSON().action;
        await route.fulfill({ json: { submission_id: 'UI-W2-001', revision: 1, submission_status: action === 'DRAFT' ? 'DRAFT' : 'SUBMITTED', local_detail_status: 'COMPLETE', detail_required_count: 0, detail_provided_count: 0, ...(revisionPending && action === 'SUBMIT' ? { approval_status: 'PENDING', proposed_revision: 2 } : {}) } });
      });
      await page.locator('#submitW2').click();
      await audit('facility confirmation dialog');
      await page.locator('#actionDialogConfirm').click();
      await page.locator('#w2Receipt').waitFor();
      assert.equal(await page.locator('.w2-heading h2').innerText(), 'Bukti pelaporan');
      assert.equal(await page.locator('.w2-progress').count(), 0, 'Completed submission still shows an unfinished step');
      assert.equal(await page.locator('.w2-workspace .data-explanation summary').isVisible(), true);
      assert.equal(await page.locator('#w2TaskTitle').innerText(), 'Laporan sudah terkirim');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'w2Receipt');
      await page.setViewportSize({ width: 320, height: 844 });
      await audit('facility receipt');
      await page.locator('.w2-workspace .data-explanation summary').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.w2-workspace .table-wrap').isVisible(), true);
      await audit('facility receipt details');
      await page.locator('.w2-workspace .data-explanation summary').click();
      await capture('facility-receipt');
      await page.locator('#receiptW2Overview').click();
      assert.equal(await page.locator('.w2-hero h1').innerText(), 'Ringkasan pelaporan');
      assert.equal(await page.locator('.w2-content-stack').isVisible(), false);
      await page.locator('#openW2Task').click();
      await page.locator('#w2Receipt').waitFor();
      // Reopen the fixture as a submitted report and simulate an approval-gated revision.
      await page.route('**/api/ibs/w2?*', async route => {
        const response = await route.fetch();
        const data = await response.json();
        data.submission = { ...(data.submission || {}), submission_status: 'SUBMITTED', revision: 1 };
        data.revision_requires_approval = true;
        data.locked = false;
        await route.fulfill({ response, json: data });
      });
      await page.locator('#editRevision').click();
      await page.setViewportSize({ width: 1365, height: 900 });
      await page.locator('#nextDetails').click();
      await page.locator('#nextReview').click();
      revisionPending = true;
      await page.locator('#submitW2').click();
      await page.locator('#actionDialogConfirm').click();
      await page.getByRole('heading', { name: 'Revisi berhasil diajukan' }).waitFor();
      assert.equal(await page.locator('#w2TaskTitle').innerText(), 'Revisi menunggu persetujuan');
      assert.ok((await page.locator('#w2Receipt').innerText()).includes('Laporan aktif belum berubah'));
      await audit('pending facility revision');
      let missingDetailsRevisionPending = false;
      await page.route('**/api/ibs/w2?*', async route => {
        const response = await route.fetch();
        const payload = await response.json();
        payload.locked = false; payload.pending_revision = missingDetailsRevisionPending ? {proposed_revision: 2} : null; payload.revision_requires_approval = false;
        payload.submission = {submission_status: 'SUBMITTED', revision: 1, local_detail_status: 'NEEDS_DETAILS', detail_required_count: 1, detail_provided_count: 0, first_submitted_at: '2026-10-02T03:00:00Z'};
        payload.case_details = [];
        const requiredIndicator = payload.indicators.find(item => item.identity_policy === 'REQUIRED');
        payload.indicators.forEach(item => { item.value = item === requiredIndicator ? 1 : item.indicator_code === 'X' ? 20 : 0; item.lab_examined_count = 0; });
        await route.fulfill({response, json: payload});
      });
      await page.goto(`${origin}/?qa=missing-details#ibs-home`);
      await page.locator('#openW2Task[data-needs-details]').waitFor();
      assert.equal(await page.locator('#openW2Task').innerText(), 'Lengkapi rincian');
      await capture('facility-overview-details');
      await audit('facility missing details overview');
      await page.locator('#openW2Task').click();
      assert.equal(await page.locator('.w2-heading h2').innerText(), 'Lengkapi rincian lokal');
      assert.equal(await page.locator('.w2-progress [aria-current="step"] span').innerText(), '2');
      assert.ok(await page.locator('.w2-person-card').count() > 0, 'Missing details action does not open required patient fields');
      await audit('facility direct missing details action');
      missingDetailsRevisionPending = true;
      await page.goto(`${origin}/?qa=pending-active-details#ibs-home`);
      await page.getByRole('heading', {name: 'Revisi menunggu persetujuan', exact: true}).waitFor();
      assert.equal(await page.locator('.workspace-task-facts > div:last-child dt').innerText(), 'Rincian laporan aktif');
      assert.equal(await page.locator('.workspace-task-facts > div:last-child dd').innerText(), '1 belum lengkap', 'Pending revision falsely marks the active report complete');
      assert.equal(await page.locator('#openW2Task[data-needs-details]').count(), 0);
      await audit('pending revision retains active report completeness');
      assert.deepEqual(errors, [], `${engine}: frontend errors`);
    } finally { await browser.close(); }
  }
  const findings = results.filter(item => item.violations.length);
  assert.deepEqual(findings, [], `Accessibility findings: ${JSON.stringify(findings)}`);
  console.log('Workflow QA OK: Edge/WebKit mobile, receipts, failed connections, keyboard focus and accessibility.');
}
