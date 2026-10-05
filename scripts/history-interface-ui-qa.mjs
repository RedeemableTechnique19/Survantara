import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

export async function reviewHistoryInterface({chromium,webkit,origin,cwd,cadreCookie}) {
  assert.match(origin,/^http:\/\/(localhost|127\.0\.0\.1):/);
  const output=join(cwd,'.credentials/cadre-replacement-20261001/design-refined');
  await mkdir(output,{recursive:true});
  const tableOutput=join(cwd,'output/cadre-history-table');
  await mkdir(tableOutput,{recursive:true});
  for(const [engine,type,options] of [['edge',chromium,{channel:'msedge'}],['webkit',webkit,{}]]) {
    const browser=await type.launch({headless:true,...options});
    try {
      const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
      const [name,...value]=cadreCookie.split('=');await context.addCookies([{name,value:value.join('='),url:origin}]);
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      const outcomes=['CONFIRMED','NOT_CONFIRMED','UNVERIFIABLE'];
      const rows=Array.from({length:20},(_,i)=>({report_id:'HISTORY-QA-'+i,signal_label:'Orang sakit',signal_code:'PERSON_ILLNESS',village_name:'Desa Uji A',village_code:'DEMO-A',location_text:'RT 01 RW 02, Dusun Tengah',submitted_at:`2026-09-${String(20-i).padStart(2,'0')}T03:00:00Z`,updated_at:'2026-10-02T04:00:00Z',event_start_date:'2026-10-01',affected_group:'ADULT',observation_labels:'Demam|Batuk',description:'Isi laporan kader untuk pengujian riwayat.',reported_cases:i===19?0:2,reported_cases_known:i===19?0:1,reported_deaths:0,reported_deaths_known:1,severe_cases:0,hospitalized_cases:0,hospitalized_cases_known:1,workflow_status:i===19?'NEEDS_CLARIFICATION':i<3?'CLOSED':'SUBMITTED',pending_clarifications:i===19?1:0,decision_result:i<3?outcomes[i]:null}));
      const question={clarification_id:'HISTORY-QUESTION',question:'Kapan gejala pertama terlihat?',requested_at:'2026-10-02T03:00:00Z',requested_by_name:'Petugas',answered_at:null};
      let failList=false,answerWrites=0;
      await page.route('**/api/cadre/reports?*',route=>{
        if(failList)return route.abort('failed');
        const params=new URL(route.request().url()).searchParams,view=params.get('view') || 'all';
        const filtered=rows.filter(r=>view==='pending'?r.pending_clarifications>0:view==='review'?r.workflow_status!=='CLOSED':view==='closed'?r.workflow_status==='CLOSED':true).sort((a,b)=>b.pending_clarifications-a.pending_clarifications||b.submitted_at.localeCompare(a.submitted_at));
        const offset=Number(params.get('offset')),limit=Number(params.get('limit'));
        return route.fulfill({json:{rows:filtered.slice(offset,offset+limit),total:filtered.length,summary:{total:rows.length,pending:rows.filter(r=>r.pending_clarifications>0).length,review:rows.filter(r=>r.workflow_status!=='CLOSED').length,closed:rows.filter(r=>r.workflow_status==='CLOSED').length}}});
      });
      await page.route('**/api/ebs/reports/HISTORY-QA-*',route=>{
        const id=new URL(route.request().url()).pathname.split('/').pop(),row=rows.find(r=>r.report_id===id);
        return route.fulfill({json:{report:{...row,reporter_name:'Kader Uji'},clarifications:id==='HISTORY-QA-19'?[question]:[],history:[],handling:{status:row.workflow_status==='CLOSED'?'SELESAI':'BARU'},decision:row.decision_result?{outcome:row.decision_result,notes:'Alasan keputusan '+row.decision_result,decided_by_name:'Petugas Uji',decided_at:'2026-10-02T04:00:00Z'}:null}});
      });
      await page.route('**/api/sbm/clarifications/HISTORY-QUESTION/answer',route=>{
        answerWrites++;question.answer=route.request().postDataJSON().answer;question.answered_at='2026-10-02T04:00:00Z';rows[19].pending_clarifications=0;rows[19].workflow_status='UNDER_REVIEW';return route.fulfill({json:{ok:true}});
      });
      await page.goto(origin+'/#cadre-home?view=history');
      const pending=page.locator('[data-report-id="HISTORY-QA-19"]');
      await pending.waitFor();
      assert.equal(await page.locator('.cadre-report-row').first().getAttribute('data-report-id'),'HISTORY-QA-19');
      assert.equal(await pending.locator('.status-NEEDS_CLARIFICATION').innerText(),'Ditinjau');
      await pending.getByText('Perlu jawaban Anda',{exact:true}).waitFor();
      await pending.locator('[data-label="Lokasi / terdampak"]').getByText('Jumlah belum diketahui',{exact:true}).waitFor();
      assert.equal(await page.locator('#mine details').count(),0,'History still contains collapsible report details');
      assert.deepEqual(await page.locator('.cadre-history-table th').allTextContents(),['Laporan','Lokasi / terdampak','Peninjauan','Aksi']);
      for(const width of [1365,1000,900,760,390,320]) {
        await page.setViewportSize({width,height:1000});
        for(const theme of ['light','dark']) {
          await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${engine}: list overflows at ${width} ${theme}`);
          assert.equal(await page.locator('.cadre-history-table-wrap').evaluate(el=>el.scrollWidth>el.clientWidth),false,`${engine}: list needs horizontal scrolling at ${width} ${theme}`);
          if([1365,390].includes(width)) {
            await page.evaluate(()=>{document.activeElement?.blur();scrollTo({top:0,behavior:'instant'});});
            await page.screenshot({path:join(tableOutput,`${engine}-${width}-${theme}.png`),fullPage:false});
          }
        }
      }
      await page.setViewportSize({width:390,height:844});
      await page.evaluate(()=>document.documentElement.dataset.theme='light');
      await pending.locator('[data-cadre-detail-action]').click();
      await page.locator('.cadre-report-heading').waitFor();
      assert.equal(await page.locator('.report-journey li').count(),3);
      assert.equal(await page.locator('#ebsDecision,#ebsAssign,#deleteReport').count(),0,'Cadre detail exposes admin controls');
      await page.locator('.ebs-answer textarea').fill('Draf jawaban tetap tersimpan saat mengganti filter.');
      await page.locator('.cadre-report-heading .back-link').click();
      await pending.waitFor();
      await page.locator('[data-history-view="closed"]').click();
      await page.waitForFunction(()=>document.querySelectorAll('.cadre-report-row').length===3);
      assert.equal(await page.locator('.cadre-report-row').count(),3);
      for(const [i,label] of ['Terkonfirmasi','Tidak terkonfirmasi','Informasi belum cukup untuk memastikan'].entries()) {
        const row=page.locator(`[data-report-id="HISTORY-QA-${i}"]`);
        assert.equal(await row.locator('.cadre-decision-result').innerText(),label);
        assert.equal(await row.locator('[data-cadre-detail-action]').innerText(),'Lihat hasil');
      }
      const done=page.locator('[data-report-id="HISTORY-QA-2"]');
      await done.locator('[data-cadre-detail-action]').click();
      await page.locator('#cadreDecision').getByText('Alasan keputusan UNVERIFIABLE',{exact:true}).waitFor();
      assert.equal(await page.locator('.report-journey [aria-current="step"] strong').innerText(),'Selesai');
      assert.equal(await page.getByText('Draf jawaban tetap tersimpan saat mengganti filter.',{exact:true}).count(),0,'Draft leaked to another report');
      await page.locator('.cadre-report-heading .back-link').click();
      await page.locator('[data-history-view="pending"]').click();await pending.waitFor();
      await pending.locator('[data-cadre-detail-action]').click();
      await page.locator('.ebs-answer textarea').waitFor();
      assert.equal(await page.locator('.ebs-answer textarea').inputValue(),'Draf jawaban tetap tersimpan saat mengganti filter.');
      await page.locator('.cadre-report-heading .back-link').click();
      await page.locator('[data-history-view="closed"]').click();await done.waitFor();
      await done.locator('[data-cadre-detail-action]').click();
      await page.locator('#cadreDecision').getByText('Alasan keputusan UNVERIFIABLE',{exact:true}).waitFor();
      for(const width of [1365,390,320]) {
        await page.setViewportSize({width,height:900});
        for(const theme of ['light','dark']) {
          await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${engine}: history overflows at ${width} ${theme}`);
        }
      }
      await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.activeElement?.blur();scrollTo({top:0,behavior:'instant'});});
      await page.screenshot({path:join(output,`cadre-history-results-${engine}.png`),fullPage:true});
      await page.reload();await page.locator('#cadreDecision').getByText('Alasan keputusan UNVERIFIABLE',{exact:true}).waitFor();
      await page.locator('.cadre-report-heading .back-link').click();
      await page.waitForFunction(()=>document.querySelectorAll('.cadre-report-row').length===3);
      assert.equal(await page.locator('[data-history-view="closed"]').getAttribute('aria-pressed'),'true');
      await page.locator('[data-history-view="pending"]').click();
      await pending.waitFor();
      assert.equal(await page.locator('.cadre-report-row').count(),1);
      failList=true;await page.locator('[data-history-view="closed"]').click();
      await page.locator('#retryCadreHistory').waitFor();
      assert.equal(await page.locator('[data-history-view="pending"]').getAttribute('aria-pressed'),'true','Failed filter labels old data as the new filter');
      failList=false;await page.locator('#retryCadreHistory').click();
      await page.locator('#retryCadreHistory').waitFor({state:'detached'});
      await pending.locator('[data-cadre-detail-action]').click();
      await page.locator('.ebs-answer textarea').waitFor();
      // Reloading the completed report intentionally clears in-memory drafts.
      await page.locator('.ebs-answer textarea').fill('Jawaban dari halaman rincian laporan.');
      await page.locator('.ebs-answer button[type="submit"]').click();
      await page.locator('.cadre-report-heading .status-UNDER_REVIEW').waitFor();
      await page.locator('.cadre-report-heading .back-link').click();
      await page.getByText('Tidak ada laporan pada filter ini',{exact:true}).waitFor();
      assert.equal(answerWrites,1);
      assert.equal(await page.locator('[data-history-count="pending"]').innerText(),'0');
      await page.locator('[data-history-view="all"]').click();
      await page.locator('[data-report-id="HISTORY-QA-0"]').waitFor();
      assert.equal(await page.locator('.cadre-report-row').count(),8);
      await page.locator('[data-cadre-page="next"]').click();await page.locator('[data-report-id="HISTORY-QA-8"]').waitFor();
      assert.equal(await page.locator('[data-report-id="HISTORY-QA-0"]').count(),0);
      const last=page.locator('.cadre-report-row').last();
      await last.locator('[data-cadre-detail-action]').click();
      await page.locator('.cadre-report-heading').waitFor();
      const contextParams=new URL(page.url()).hash.split('?')[1],savedScroll=Number(new URLSearchParams(contextParams).get('scroll'));
      assert.ok(savedScroll>0,'Scroll restoration fixture did not scroll');
      await page.locator('.cadre-report-heading .back-link').click();
      await page.locator('[data-report-id="HISTORY-QA-8"]').waitFor();
      assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('offset'),'8');
      await page.waitForFunction(scroll=>Math.abs(scrollY-scroll)<3,savedScroll);
      rows.splice(8);await page.locator('#refreshCadreHistory').click();
      await page.locator('[data-report-id="HISTORY-QA-0"]').waitFor();
      assert.equal(await page.locator('.cadre-report-row').count(),8,'Shrinking history leaves the user on an empty page');
      assert.deepEqual(errors,[],`${engine}: history runtime errors`);
    } finally {await browser.close();}
  }
  console.log('History interface QA OK: Edge/WebKit, pending priority, three results, filters/pagination, draft retention, failed-filter recovery, and mobile/dark layouts.');
}
