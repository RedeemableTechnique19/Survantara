import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function reviewReportReview({chromium,webkit,origin,cwd,adminCookie,cadreCookie,leadershipCookie,reportBody}) {
  assert.match(origin,/^http:\/\/(127\.0\.0\.1|localhost):/,'Review QA only writes to the local regression worker');
  const output=join(cwd,'.credentials/cadre-replacement-20261001/design-refined');
  await mkdir(output,{recursive:true});
  const request=async(path,cookie,body)=>{
    const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();assert.ok(response.ok,`${path}: ${response.status} ${JSON.stringify(data)}`);return data;
  };
  const authenticate=async(context,cookie)=>{const [name,...value]=cookie.split('=');await context.addCookies([{name,value:value.join('='),url:origin}]);};
  for(const [engine,type,options] of [['edge',chromium,{channel:'msedge'}],['webkit',webkit,{}]]) {
    const browser=await type.launch({headless:true,...options});
    try {
      const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
      await authenticate(context,adminCookie);
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      let firstReportId;
      for(const outcome of ['UNVERIFIABLE','NOT_CONFIRMED','CONFIRMED']) {
        const created=await request('/api/cadre/reports',cadreCookie,{...reportBody,signal_code:'PERSON_ILLNESS',location_text:`Review QA ${engine} ${outcome}`});
        const reportId=created.report_id,path=`/api/ebs/reports/${reportId}`;
        firstReportId ||= reportId;
        if(outcome==='UNVERIFIABLE') {
          const readonly=await browser.newContext({viewport:{width:1365,height:900}});await authenticate(readonly,leadershipCookie);
          const readonlyPage=await readonly.newPage();await readonlyPage.goto(origin+'/#staff-report/'+reportId);
          await readonlyPage.locator('.report-work-heading .status-SUBMITTED').waitFor();
          assert.equal(await readonlyPage.locator('#ebsDecision').count(),0);
          assert.equal((await request(path,adminCookie)).report.workflow_status,'SUBMITTED','Read-only browser starts a review');
          await readonly.close();
        }
        await page.goto(origin+'/#staff-report/'+reportId);
        await page.locator('#ebsDecision').waitFor();
        assert.equal(await page.locator('.report-journey li').count(),3);
        assert.equal(await page.locator('.report-journey [aria-current="step"] strong').innerText(),'Ditinjau');
        const form=page.locator('#ebsDecision');
        await form.locator('[name="outcome"]').selectOption(outcome);
        const notes=`Hasil ${outcome}: sumber dan informasi sudah diperiksa.`;
        await form.locator('[name="verification_method"]').fill('Konfirmasi melalui telepon');
        await form.locator('[name="notes"]').fill(notes);
        if(outcome==='CONFIRMED') {
          const classification=await form.locator('[name="verified_ebs_id"] option').nth(1).getAttribute('value');
          await form.locator('[name="verified_ebs_id"]').selectOption(classification);
          for(const [key,value] of [['actual_cases','2'],['actual_deaths','0'],['actual_severe_cases','0']])await form.locator(`[name="${key}"]`).fill(value);
          await page.setViewportSize({width:1365,height:900});
          await page.screenshot({path:join(output,`simple-admin-review-desktop-${engine}.png`),fullPage:true});
          await page.setViewportSize({width:320,height:740});
        } else {
          assert.equal(await form.locator('[name="actual_cases"]').getAttribute('required'),null);
          assert.equal(await form.locator('[data-classification]').isVisible(),false);
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${engine}: review form overflows`);
        await page.screenshot({path:join(output,`simple-admin-review-${outcome.toLowerCase()}-${engine}.png`),fullPage:true});
        let failRefresh=false,writes=0;
        if(outcome==='UNVERIFIABLE') {
          await page.route(origin+path,route=>failRefresh?route.abort('failed'):route.continue());
          await page.route(origin+path+'/decision',async route=>{writes++;const response=await route.fetch();assert.equal(response.status(),200);failRefresh=true;await route.fulfill({response});});
        }
        await form.locator('button[type="submit"]').click();
        await page.locator('.report-work-heading .status-CLOSED').waitFor();
        if(outcome==='UNVERIFIABLE') {
          await page.locator('#ebsMessage .error').waitFor();
          assert.equal(await page.locator('#ebsDecision button[type="submit"]').count(),0,'Accepted decision can be resubmitted after refresh failure');
          assert.equal(await page.locator('.report-journey [aria-current="step"] strong').innerText(),'Selesai');
          assert.equal(writes,1);
          await page.getByText('Keputusan berhasil disimpan. Peninjauan laporan selesai.',{exact:true}).waitFor();
          failRefresh=false;await page.locator('#refreshReport').click();
        }
        await page.locator('#ebsDecisionSection').getByText(notes,{exact:true}).waitFor();
        assert.equal(await page.locator('#ebsDecision').count(),0);
        const saved=await request(path,adminCookie);
        assert.equal(saved.report.workflow_status,'CLOSED');assert.equal(saved.decision.outcome,outcome);
        assert.equal(saved.decision.actual_cases,outcome==='CONFIRMED'?2:null);
        assert.equal((await request('/api/ebs/reports?q='+reportId,adminCookie)).total,0);
        if(outcome==='CONFIRMED') {
          const signal=await page.locator('#ebsCreateEvent [name="verified_signal_code"] option').nth(1).getAttribute('value');
          const event=await request('/api/events',adminCookie,{event_title:`Review QA incident ${engine}`,verified_signal_code:signal,program_owner:'P2P',village_code:reportBody.village_code,verified_cases:2,verified_deaths:0,verified_severe_cases:0});
          await page.locator('#refreshReport').click();
          await page.locator(`#ebsLink option[value="${event.event_id}"]`).waitFor({state:'attached'});
          await page.locator('#ebsLink [name="event_id"]').selectOption(event.event_id);
          await page.locator('#ebsLink button[type="submit"]').click();
          await page.locator('.report-event-summary').waitFor();
          assert.equal((await request('/api/reports/'+reportId,adminCookie)).report.current_status,'SELESAI');
          assert.equal((await request('/api/ebs/reports?q='+reportId,adminCookie)).total,0);
          await page.goto(origin+'/#staff-reports');
          await page.getByRole('link',{name:'Penanganan kejadian',exact:true}).click();
          await page.locator(`a[href="#staff-event/${event.event_id}?from=events"]`).click();
          await page.locator('a.back-link[href="#staff-events"]').click();
          await page.getByRole('heading',{name:'Penanganan kejadian',exact:true}).waitFor();
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${engine}: incident list overflows`);
          await page.screenshot({path:join(output,`separate-incident-list-${engine}.png`),fullPage:true});
        }
        await page.setViewportSize({width:390,height:844});
      }
      const focused=await request('/api/cadre/reports?limit=1&focus_report='+firstReportId,cadreCookie);
      assert.equal(focused.rows[0].report_id,firstReportId,'Receipt cannot find a report beyond the first page');
      assert.ok(focused.offset>0,'Receipt fixture does not exercise another page');
      assert.deepEqual(errors,[],`${engine}: review frontend errors`);
    }finally{await browser.close();}
  }
  console.log('Report review UI QA OK: Edge/WebKit, three outcomes, read-only access, accepted decision after failed refresh, and independent incident handling.');
}
