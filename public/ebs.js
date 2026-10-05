import { branding } from './brand.js?v=20261005-branding-v1';
// Stage 1 views share the application's authentication, components and navigation.
export const EBS_LABELS = {SUBMITTED:'Masuk',UNDER_REVIEW:'Ditinjau',NEEDS_CLARIFICATION:'Ditinjau',CLOSED:'Selesai'};
export function createEbsViews({app,api,esc,empty,formatDate,getMasters,pageFailure,submitForm,alertBox,setBusy,setLeaveGuard,onReportUpdated,affectedGroupLabel,confirmAction,deleteWithReason}) {
  const badge = (value, label) => `<span class="status status-${esc(value)}">${esc(label || EBS_LABELS[value] || value)}</span>`;
  const cadrePending = row => row.workflow_status!=='CLOSED' && (row.pending_clarifications==null?row.workflow_status==='NEEDS_CLARIFICATION':Number(row.pending_clarifications)>0);
  const cadreStatusMeaning = (value,pending=false,outcome=null) => pending ? 'Petugas membutuhkan informasi tambahan. Jawab pertanyaan di laporan ini.' : value==='SUBMITTED'?'Laporan sudah diterima. Menunggu peninjauan petugas.':value==='CLOSED'?outcome==='UNVERIFIABLE'?'Peninjauan selesai. Informasi yang tersedia belum cukup untuk memastikan kejadian.':'Peninjauan selesai. Lihat hasil dan alasan dari petugas.':'Petugas sedang meninjau laporan Anda. Belum ada pertanyaan yang perlu dijawab.';
  let detailRevision = 0;
  const filters = {q:'',status:'',village_code:'',event_type:'',date_from:'',date_to:'',sort:'newest',offset:0};
  const age = timestamp => {
    const minutes = Math.max(0,Math.floor((Date.now()-Date.parse(timestamp))/60000));
    return minutes < 60 ? `${minutes} menit lalu` : minutes < 1440 ? `${Math.floor(minutes/60)} jam lalu` : `${Math.floor(minutes/1440)} hari lalu`;
  };
  const fact = (label,value) => `<div><dt>${esc(label)}</dt><dd class="preserve-lines">${esc(value ?? '—')}</dd></div>`;
  const validationLabels={VALID:'Valid untuk diverifikasi',INVALID:'Tidak valid',NEEDS_CLARIFICATION:'Perlu klarifikasi'};
  const qualityLabels={VALID:'Valid',REASONABLE:'Wajar',INCOMPLETE:'Informasi belum cukup',ABUSIVE:'Manipulatif'};
  const contributionText=c=>c?.stage==='INCIDENT'?`Laporan Anda menjadi salah satu sumber kejadian “${c.event_title}”.`:c?.stage==='SIGNAL'?(['SELESAI','DIBATALKAN'].includes(c.status)?'Sinyal yang memuat laporan Anda telah ditutup tanpa menjadi kejadian terverifikasi.':'Laporan Anda tergabung dalam sinyal yang sedang ditinjau atau diverifikasi. Sinyal ini belum menjadi kejadian terverifikasi.'):'Laporan Anda belum menjadi sumber kejadian. Hasil peninjauan dan perkembangannya akan tampil di sini.';
  const qualityResult=a=>{const q=a?.quality,s=a?.score;return !q?'<p>Belum ada penilaian kualitas laporan. Laporan yang belum dinilai tidak mendapat nilai nol.</p>':`<dl class="detail-grid">${fact('Kualitas informasi',qualityLabels[q.quality]||q.quality)}${fact('Kelengkapan',{COMPLETE:'Lengkap',PARTIAL:'Sebagian',UNKNOWN:'Belum dapat dinilai'}[q.completeness])}${fact('Ketepatan waktu',{TIMELY:'Tepat waktu',LATE:'Terlambat',UNKNOWN:'Belum dapat dinilai'}[q.timeliness])}${fact('Nilai laporan',s?.total==null?'Belum dapat dihitung':`${s.total} / 50`)}${fact('Alasan penilaian',q.notes)}</dl><p class="help">Kualitas informasi ${s?.information??'—'}/20 + kelengkapan ${s?.completeness??'—'}/15 + ketepatan waktu ${s?.timeliness??'—'}/15. Komponen yang belum dinilai tidak dihitung sebagai nol.</p>`;};
  const timeline = data => {
    const r=data.report, entries=[{time:r.submitted_at,text:`Laporan dikirim oleh ${r.reporter_name || 'pelapor'}`}];
    for(const h of data.history) if(h.old_status !== null) entries.push({time:h.changed_at,text:`${EBS_LABELS[h.new_status] || handlingLabels[h.new_status] || h.new_status} · ${h.actor}`});
    for(const c of data.clarifications) {
      entries.push({time:c.requested_at,text:`${c.requested_by_name} meminta klarifikasi`});
      if(c.answered_at) entries.push({time:c.answered_at,text:`${r.reporter_name || 'Kader'} memberikan jawaban`});
    }
    return `<ol class="ebs-timeline">${entries.sort((a,b)=>a.time.localeCompare(b.time)).map(e=>`<li><time>${formatDate(e.time)}</time><p>${esc(e.text)}</p></li>`).join('')}</ol>`;
  };
  const thread = (data,canAnswer=false) => data.clarifications.map(c=>`<article class="ebs-question"><p><strong>${esc(c.requested_by_name)}</strong> · ${formatDate(c.requested_at)}</p><p class="preserve-lines">${esc(c.question)}</p>${c.answered_at ? `<p><strong>${esc(data.report.reporter_name || 'Kader')}</strong> · ${formatDate(c.answered_at)}</p><p class="preserve-lines">${esc(c.answer)}</p>` : canAnswer && data.report.workflow_status !== 'CLOSED' ? `<form class="ebs-answer" data-id="${esc(c.clarification_id)}"><label>Jawaban<textarea name="answer" maxlength="1000" required></textarea></label><button type="submit">Kirim jawaban</button><div class="message" aria-live="polite"></div></form>` : '<p class="help">Menunggu jawaban kader.</p>'}</article>`).join('') || '<p>Belum ada permintaan klarifikasi.</p>';
  async function list(view='inbox') {
    try {
      const [me,masters]=await Promise.all([api('/api/me'),getMasters()]);
      if(me.kind !== 'staff') { location.hash='#staff'; return; }
      const params=new URLSearchParams(Object.entries(filters).filter(([,v])=>v!==''));params.set('view',view);params.set('limit','50');
      const page=await api(`/api/ebs/reports?${params}`);
      const selected=(key,value)=>filters[key]===value?' selected':'';
      const opts=(key,rows)=>rows.map(([value,label])=>`<option value="${esc(value)}"${selected(key,value)}>${esc(label)}</option>`).join('');
      const hasFilter=Object.entries(filters).some(([k,v])=>!['sort','offset'].includes(k)&&v);
      const readOnlyIdentity=['VIEWER','PIMPINAN'].includes(me.role);
      app.innerHTML=`<section class="card hero"><p class="eyebrow">Laporan Kader · Kejadian EBS</p><h1>${view==='all'?'Semua Laporan Kader':'Laporan Kader'}</h1><p>${view==='all'?'Seluruh laporan kader dan warga beserta status dan hasil peninjauannya.':'Laporan kader dan warga yang belum memiliki keputusan akhir.'}</p><nav class="actions" aria-label="Pengelolaan laporan kader"><a class="button ${view==='inbox'?'':'secondary'}" href="#staff-reports"${view==='inbox'?' aria-current="page"':''}>Perlu ditangani</a><a class="button ${view==='all'?'':'secondary'}" href="#staff-ebs-all"${view==='all'?' aria-current="page"':''}>Semua laporan</a><a class="button secondary" href="#staff-events">Penanganan kejadian</a></nav></section>
        <section class="card"><form id="filters" class="dashboard-filters" role="search"><div class="dashboard-filter-primary"><input name="q" maxlength="100" value="${esc(filters.q)}" placeholder="Cari ID, pelapor, lokasi…" aria-label="Cari laporan"><select name="status" aria-label="Status laporan"><option value="">Semua status</option>${opts('status',Object.entries(EBS_LABELS).filter(([value])=>value!=='NEEDS_CLARIFICATION'))}</select><button type="submit" class="secondary">Tampilkan</button></div><div class="form-grid"><label>Desa<select name="village_code"><option value="">Semua desa</option>${opts('village_code',masters.villages.map(v=>[v.village_code,v.village_name]))}</select></label><label>Jenis kejadian<select name="event_type"><option value="">Semua jenis</option>${opts('event_type',masters.event_types.map(t=>[t.event_type,t.public_label]))}</select></label><label>Dari tanggal<input name="date_from" type="date" value="${esc(filters.date_from)}"></label><label>Sampai tanggal<input name="date_to" type="date" value="${esc(filters.date_to)}"></label><label>Urutan<select name="sort">${opts('sort',[['newest','Terbaru'],['oldest','Terlama']])}</select></label></div>${hasFilter?'<button type="button" id="resetFilters" class="text-button">Hapus semua filter</button>':''}</form><p role="status">${page.total} laporan</p>
        ${page.rows.length?`<div class="table-wrap mobile-cards"><table><thead><tr><th>Laporan</th><th>Lokasi / terdampak</th><th>Pelapor</th><th>Peninjauan</th><th>Aksi</th></tr></thead><tbody>${page.rows.map(r=>{const j=journey(r,{},null,Number(r.pending_clarifications || 0)),old=r.workflow_status!=='CLOSED'&&Date.now()-Date.parse(r.submitted_at)>=8*3600000;return `<tr${old?' class="ebs-overdue"':''}><td data-label="Laporan"><strong>${esc(r.observation_labels || r.event_type_label || 'Kejadian kesehatan')}</strong><br><small>${esc(r.report_id)}</small><br><small>${formatDate(r.submitted_at)}</small></td><td data-label="Lokasi / terdampak"><strong>${esc(r.village_name || r.village_code)}</strong><br>${esc(r.location_text || 'Lokasi belum diisi')}<br><small>${r.reported_cases_known===0?'Jumlah terdampak belum diketahui':`${esc(r.reported_cases)} orang terdampak`}</small></td><td data-label="Pelapor">${esc(r.reporter_name || 'Identitas tersamarkan')}</td><td data-label="Peninjauan">${badge(r.workflow_status)}${!j.closed?'<small class="report-work-waiting">Menunggu: '+esc(Number(r.pending_clarifications || 0)>0?j.waiting:r.assigned_name || j.waiting)+'</small>':''}<small class="report-work-waiting">${esc(r.decision_result?decisionLabels[r.decision_result]:Number(r.pending_clarifications || 0)>0?r.pending_clarifications+' pertanyaan menunggu jawaban':j.closed?'Selesai melalui alur sebelumnya':'Belum ada keputusan akhir')}</small><span class="ebs-age">${age(r.submitted_at)}</span>${old?'<br><small>Sudah ≥ 8 jam · belum selesai</small>':''}</td><td class="action-cell">${r.can_open_detail?`<button class="secondary reportDetail" data-id="${esc(r.report_id)}">${j.closed?'Lihat hasil':['ADMIN','VERIFIKATOR'].includes(me.role)?'Tinjau laporan':'Lihat laporan'}</button>`:'Ringkasan saja'}</td></tr>`;}).join('')}</tbody></table></div>`:empty(hasFilter?'Tidak ada laporan yang cocok':view==='all'?'Belum ada laporan':'Tidak ada laporan EBS yang perlu ditindaklanjuti.',hasFilter?'Coba longgarkan filter pencarian.':'Laporan baru akan tampil di sini.')}
        ${page.total>50?`<div class="pager"><button id="pagePrev" class="secondary"${page.offset===0?' disabled':''}>← Sebelumnya</button><span>${page.offset+1}–${page.offset+page.rows.length} dari ${page.total}</span><button id="pageNext" class="secondary"${page.offset+page.rows.length>=page.total?' disabled':''}>Berikutnya →</button></div>`:''}</section>`;
      const search=app.querySelector('#filters [name="q"]');
      if(readOnlyIdentity){search.placeholder='Cari ID laporan…';search.setAttribute('aria-label','Cari ID laporan');}
      app.querySelector('#filters').addEventListener('submit',e=>{e.preventDefault();Object.assign(filters,Object.fromEntries(new FormData(e.currentTarget)),{offset:0});void list(view);});
      app.querySelector('#resetFilters')?.addEventListener('click',()=>{for(const k of Object.keys(filters))filters[k]=k==='sort'?'newest':k==='offset'?0:'';void list(view);});
      app.querySelector('#pagePrev')?.addEventListener('click',()=>{filters.offset=Math.max(0,filters.offset-50);void list(view);});
      app.querySelector('#pageNext')?.addEventListener('click',()=>{filters.offset+=50;void list(view);});
      app.querySelectorAll('.reportDetail').forEach(b=>b.addEventListener('click',()=>{location.hash=`#staff-report/${encodeURIComponent(b.dataset.id)}`;}));
    }catch(error){pageFailure(error,()=>list(view));}
  }
  const handlingLabels = {BARU:'Belum diverifikasi',DITERIMA:'Siap diverifikasi',MEMERLUKAN_INFORMASI:'Informasi perlu dilengkapi',SEDANG_DIVERIFIKASI:'Verifikasi berlangsung',TERVERIFIKASI:'Hasil verifikasi tercatat',TERKAIT_EVENT:'Terhubung ke kejadian',SELESAI:'Penanganan laporan selesai',DITOLAK:'Tidak dilanjutkan',DUPLIKAT:'Ditandai duplikat'};
  const eventLabels = {DRAFT:'Kejadian belum diaktifkan',AKTIF:'Kejadian sedang ditangani',SELESAI:'Penanganan kejadian selesai',DIBATALKAN:'Kejadian dibatalkan'};
  const decisionLabels = {CONFIRMED:'Terkonfirmasi',NOT_CONFIRMED:'Tidak terkonfirmasi',UNVERIFIABLE:'Informasi belum cukup untuk memastikan'};
  const cadreAction = row => cadrePending(row)?'Jawab pertanyaan':row.workflow_status==='CLOSED'?'Lihat hasil':'Lihat perkembangan';
  const reviewJourney = step => `<ol class="report-journey report-review-journey" aria-label="Tahapan laporan">${['Masuk','Ditinjau','Selesai'].map((label,index)=>`<li${index===step?' aria-current="step"':''} class="${index<step?'is-past':index===step?'is-current':'is-future'}"><span class="journey-number">${index+1}</span><div><strong>${label}</strong></div></li>`).join('')}</ol>`;
  function cadreRow(row) {
    const pending=cadrePending(row),closed=row.workflow_status==='CLOSED';
    const observations=String(row.observation_labels || '').split('|').filter(Boolean);
    const summary=observations.join(', ') || row.signal_label || 'Kejadian kesehatan';
    return `<tr class="cadre-report-row${pending?' needs-answer':''}" data-report-id="${esc(row.report_id)}">
      <td data-label="Laporan"><div class="report-list-copy"><strong>${esc(summary)}</strong><small>${esc(row.report_id)}</small><small>${formatDate(row.submitted_at)}</small></div></td>
      <td data-label="Lokasi / terdampak"><div class="report-list-copy"><strong>${esc(row.village_name || row.village_code || 'Desa belum diisi')}</strong><span>${esc(row.location_text || 'Lokasi belum diisi')}</span><small>${row.reported_cases_known===0?'Jumlah belum diketahui':`${esc(row.reported_cases ?? '—')} orang terdampak`}</small></div></td>
      <td data-label="Peninjauan"><div class="report-list-copy">${badge(row.workflow_status)}${row.validation_status?`<small>${esc(validationLabels[row.validation_status])}</small>`:''}${row.contribution_stage?`<strong class="cadre-decision-result">${row.contribution_stage==='INCIDENT'?'Menjadi sumber kejadian':'Dalam kelompok sinyal'}</strong>${row.incident_title?`<small>${esc(row.incident_title)}</small>`:''}`:''}${pending?`<strong class="cadre-pending-label">Perlu jawaban Anda</strong><small>${Number(row.pending_clarifications)>0?esc(row.pending_clarifications)+' pertanyaan menunggu jawaban':'Petugas meminta informasi tambahan'}</small>`:closed?`<span class="cadre-decision-result">${esc(decisionLabels[row.decision_result] || (row.validation_status==='INVALID'?'Laporan tidak valid':'Selesai melalui alur sebelumnya'))}</span>`:'<small>Peninjauan atau verifikasi petugas</small>'}<small>${age(row.submitted_at)}</small></div></td>
      <td data-label="Aksi" class="action-cell"><a class="button ${pending?'':'secondary'}" data-cadre-detail-action href="#cadre-report/${encodeURIComponent(row.report_id)}">${cadreAction(row)}</a></td></tr>`;
  }
  const cadreList = rows => `<div class="table-wrap mobile-cards cadre-history-table-wrap"><table class="cadre-history-table"><caption class="sr-only">Daftar laporan Anda beserta lokasi, status peninjauan, dan aksi</caption><thead><tr><th scope="col">Laporan</th><th scope="col">Lokasi / terdampak</th><th scope="col">Peninjauan</th><th scope="col">Aksi</th></tr></thead><tbody>${rows.map(cadreRow).join('')}</tbody></table></div>`;
  let eventsRevision=0;
  async function eventsList() {
    const revision=++eventsRevision;
    try {
      const me=await api('/api/me');
      if(me.kind!=='staff'){location.hash='#staff';return;}
      const all=new URLSearchParams(location.hash.split('?')[1] || '').get('view')==='all';
      const events=await api('/api/events');
      const rows=all?events:events.filter(e=>!['SELESAI','DIBATALKAN'].includes(e.current_status));
      if(revision!==eventsRevision || location.hash.split('?')[0]!=='#staff-events' || (new URLSearchParams(location.hash.split('?')[1] || '').get('view')==='all')!==all)return;
      app.innerHTML=`<section class="card hero"><a class="back-link" href="#staff-reports">← Laporan Kader</a><h1>Penanganan kejadian</h1><p>Peninjauan laporan dan penanganan kejadian berjalan terpisah. Laporan yang selesai tetap dapat menjadi sumber kejadian aktif.</p><nav class="actions" aria-label="Daftar kejadian"><a class="button ${all?'secondary':''}" href="#staff-events">Kejadian aktif</a><a class="button ${all?'':'secondary'}" href="#staff-events?view=all">Semua kejadian</a></nav></section><section class="card"><p role="status">${rows.length} kejadian</p>${rows.length?`<div class="table-wrap mobile-cards"><table><thead><tr><th>Kejadian</th><th>Desa</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${rows.map(e=>`<tr><td data-label="Kejadian"><strong>${esc(e.event_title)}</strong><br><small>${esc(e.event_id)}</small></td><td data-label="Desa">${esc(e.village_code || 'Lintas desa')}</td><td data-label="Status">${esc(e.origin === 'SIGNAL' && !['SELESAI','DIBATALKAN'].includes(e.current_status) ? (e.assessed_source_revision !== e.source_revision ? (e.followup_decision ? 'Sinyal · perlu penilaian ulang' : 'Sinyal · belum diverifikasi') : ({CLARIFY:'Perlu klarifikasi',REMOTE:'Konfirmasi kontak',FIELD:'Verifikasi lapangan'}[e.followup_decision] || 'Belum dinilai')) : (eventLabels[e.current_status] || e.current_status))}</td><td data-label="Aksi"><a class="button secondary" href="#staff-event/${encodeURIComponent(e.event_id)}?from=events">${e.origin==='SIGNAL'?'Buka sinyal':'Buka kejadian'}</a></td></tr>`).join('')}</tbody></table></div>`:empty('Tidak ada kejadian dalam daftar ini','Semua laporan tetap dapat dilihat melalui Laporan Kader.')}</section>`;
    }catch(error){pageFailure(error,eventsList,'#staff-reports');}
  }
  function journey(r, handling = {}, event = null, pending = 0) {
    const closed=r.workflow_status==='CLOSED';
    return {step:closed?2:r.workflow_status==='SUBMITTED'?0:1,
      title:closed?'Peninjauan laporan selesai':pending?`Menunggu ${pending} jawaban pelapor`:r.workflow_status==='SUBMITTED'?'Laporan masuk':'Laporan ditinjau',
      waiting:closed?'Tidak ada keputusan laporan yang ditunggu':pending?r.reporter_name || 'Pelapor':r.assigned_name || 'Petugas',
      next:closed?'Lihat keputusan':pending?'Lihat pertanyaan':'Catat hasil peninjauan',
      action:!closed&&pending?'ebsClarifications':'ebsDecisionSection',closed};
  }
  async function detail(reportId, notice = '') {
    const revision=++detailRevision, path=`/api/ebs/reports/${encodeURIComponent(reportId)}`;
    const current=()=>revision===detailRevision && location.hash.split('?')[0]===`#staff-report/${encodeURIComponent(reportId)}`;
    try {
      const me=await api('/api/me');
      if(!current())return;
      if(me.kind!=='staff'){location.hash=me.kind==='cadre'?'#cadre-home':'#staff';return;}
      let [data,masters]=await Promise.all([api(path),getMasters()]);
      if(!current())return;
      if(data.can_manage && data.report.workflow_status==='SUBMITTED') {
        await api(`${path}/review`,{method:'POST',body:'{}'});
        if(!current())return;
        data=await api(path);
      }
      const work=await api(`/api/reports/${encodeURIComponent(reportId)}`);
      const r=data.report,h=work.report,latest=work.verifications?.[0],decision=data.decision;
      const canManage=data.can_manage,canGroup=me.role==='ADMIN';
      const [eventData,events,verifiers]=await Promise.all([
        h.event_id?api(`/api/events/${encodeURIComponent(h.event_id)}`):Promise.resolve(null),
        canGroup?api('/api/events'):Promise.resolve([]),
        canGroup?api('/api/staff/verifiers'):Promise.resolve([]),
      ]);
      if(!current())return;
      const event=eventData?.event,pending=data.clarifications.filter(c=>!c.answered_at).length,j=journey(r,{},event,pending);
      const assigned=verifiers.find(v=>v.email===h.assigned_to)?.name || h.assigned_to || 'Admin / petugas berwenang';
      if(!j.closed&&!pending)j.waiting=assigned;
      const drafts=new Map(app.querySelector('.report-work-heading')?.dataset.workReport===reportId?
        [...app.querySelectorAll('[data-work-form]')].filter(f=>[...f.querySelectorAll('input:not([type="hidden"]),textarea,select')].some(el=>el.value!==(el.tagName==='SELECT'?[...el.options].find(o=>o.defaultSelected)?.value || el.options[0]?.value || '':el.defaultValue))).map(f=>[f.id,{values:Object.fromEntries(new FormData(f)),createdEventId:f.dataset.createdEventId}]):[]);
      const verifyOptions=(work.ebs_options || []).map(o=>`<option value="${esc(o.ebs_id)}"${h.verified_ebs_id===o.ebs_id?' selected':''}>${esc(o.disease_name)} · ${esc(o.ebs_id)}</option>`).join('');
      const suggestions=(work.ebs_suggestions || []).map(o=>esc(o.disease_name)).join(', ');
      const initialOutcome=latest?.verification_result || '';
      const countValue=key=>latest?.[key] == null ? '' : esc(latest[key]);
      const validation=data.assessment?.validation,valid=validation?.status==='VALID';
      const reviewOptions=(rows,selected)=>rows.map(([v,label])=>`<option value="${v}"${v===selected?' selected':''}>${label}</option>`).join('');
      const validationForm=me.role==='ADMIN'&&(!j.closed||(!validation&&event?.origin==='SIGNAL'))?`<form id="ebsValidation" data-work-form class="report-work-form"><input name="expected_updated_at" type="hidden" value="${esc(h.updated_at)}"><label>Penilaian admin<select name="status" required>${reviewOptions([['','Pilih penilaian…'],...Object.entries(validationLabels).filter(([status])=>!j.closed||status==='VALID')],validation?.status||'')}</select></label><label>Alasan penilaian<textarea name="notes" maxlength="2000" required>${esc(validation?.notes||'')}</textarea></label>${r.reporter_id?'<label data-validation-question hidden>Pertanyaan untuk kader<textarea name="question" maxlength="1000"></textarea></label>':''}<p class="help">Valid berarti informasi layak diverifikasi; belum berarti kejadian terbukti. Informasi yang belum cukup dapat dimintakan klarifikasi.</p><button type="submit">Simpan penilaian admin</button></form>`:'';
      const q=data.assessment?.quality;
      const qualityForm=me.role==='ADMIN'?`<details class="report-quality-panel"><summary>Penilaian kualitas laporan dan umpan balik</summary><p class="help">Terpisah dari validitas dan hasil verifikasi. Sinyal yang wajar tetap bernilai ketika hasil verifikasi negatif. Kader dapat melihat penilaian dan alasannya.</p><form id="ebsQuality" data-work-form class="report-work-form"><div class="grid"><label>Kualitas informasi<select name="quality" required>${reviewOptions([['','Pilih kualitas…'],...Object.entries(qualityLabels)],q?.quality||'')}</select></label><label>Kelengkapan<select name="completeness">${reviewOptions([['UNKNOWN','Belum dapat dinilai'],['COMPLETE','Lengkap'],['PARTIAL','Sebagian']],q?.completeness||'UNKNOWN')}</select></label><label>Ketepatan waktu aplikasi<select name="timeliness">${reviewOptions([['UNKNOWN','Belum dapat dinilai'],['TIMELY','Tepat waktu'],['LATE','Terlambat']],q?.timeliness||'UNKNOWN')}</select></label></div><label>Alasan dan umpan balik<textarea name="notes" maxlength="1000" required>${esc(q?.notes||'')}</textarea></label><button type="submit" class="secondary">Simpan kualitas laporan</button></form></details>`:'';
      const decisionForm=canManage&&!j.closed&&(!r.reporter_id||valid)?`<form id="ebsDecision" data-work-form class="report-work-form">
        <input name="expected_updated_at" type="hidden" value="${esc(h.updated_at)}">
        <label>Hasil peninjauan<select name="outcome" required><option value="">Pilih hasil…</option>${Object.entries(decisionLabels).map(([value,label])=>`<option value="${value}"${initialOutcome===value?' selected':''}>${label}</option>`).join('')}</select></label>
        ${h.event_id?'<p class="help">Laporan merupakan sumber kejadian. Hasil peninjauan informasi laporan ini dinilai secara tersendiri.</p>':''}
        <div data-classification hidden><label>Klasifikasi EBS<select name="verified_ebs_id"><option value="">Pilih klasifikasi berdasarkan hasil konfirmasi…</option>${verifyOptions}</select></label>${suggestions?`<p class="help">Saran dari laporan: ${suggestions}. Petugas menentukan klasifikasi berdasarkan hasil konfirmasi.</p>`:''}</div>
        <div class="form-grid"><label>Metode konfirmasi<input name="verification_method" maxlength="100" required placeholder="Telepon / konfirmasi sumber / kontak tidak tersedia" value="${esc(latest?.verification_method || '')}"></label><label>Hasil kontak (opsional)<input name="contact_result" maxlength="100" value="${esc(latest?.contact_result || '')}"></label></div>
        <fieldset data-actual-counts hidden><legend>Jumlah aktual</legend><p class="help" data-count-help>Isi hasil konfirmasi; kosong berarti belum diketahui.</p><div class="form-grid"><label>Kasus aktual<input name="actual_cases" type="number" min="0" value="${countValue('actual_cases')}"></label><label>Meninggal aktual<input name="actual_deaths" type="number" min="0" value="${countValue('actual_deaths')}"></label><label>Kasus berat aktual<input name="actual_severe_cases" type="number" min="0" value="${countValue('actual_severe_cases')}"></label></div></fieldset>
        <label>Alasan keputusan<textarea name="notes" maxlength="2000" required placeholder="Tuliskan apa yang dikonfirmasi dan alasan hasil peninjauan.">${esc(latest?.notes || '')}</textarea></label>
        <p class="help">Keputusan ini menyelesaikan peninjauan laporan. Penanganan kejadian terkait tetap berjalan terpisah.</p>
        <button type="submit"${pending?' disabled':''}>Simpan keputusan dan selesaikan laporan</button>${pending?'<p class="help">Masih ada pertanyaan yang menunggu jawaban. Lengkapi klarifikasi sebelum menyimpan keputusan.</p>':''}
      </form>`:'';
      const finalSummary=decision?`<dl class="detail-grid">${fact('Hasil peninjauan',decisionLabels[decision.outcome])}${fact('Alasan keputusan',decision.notes)}${fact('Metode konfirmasi',decision.verification_method)}${fact('Hasil kontak',decision.contact_result || 'Tidak dicatat')}${decision.verified_ebs_name?fact('Klasifikasi EBS',decision.verified_ebs_name):''}${fact('Kasus aktual',decision.actual_cases ?? 'Belum diketahui')}${fact('Meninggal aktual',decision.actual_deaths ?? 'Belum diketahui')}${fact('Kasus berat aktual',decision.actual_severe_cases ?? 'Belum diketahui')}${fact('Diputuskan oleh',decision.decided_by_name)}${fact('Waktu keputusan',formatDate(decision.decided_at))}</dl>`:
        j.closed?`<p>Keputusan dicatat melalui alur sebelumnya. Riwayat laporan tetap tersedia di bawah.</p>${latest?`<dl class="detail-grid">${fact('Hasil sebelumnya',decisionLabels[latest.verification_result] || latest.verification_result)}${fact('Catatan',latest.notes)}</dl>`:''}`:'';
      const canSignalGroup=canGroup&&me.can_manage_surveillance===true;
      if(canSignalGroup&&!event&&valid&&!j.closed){j.title='Laporan valid untuk diverifikasi';j.waiting='Pengelompokan dan verifikasi sinyal';j.next='Pilih / buat sinyal';j.action='ebsGrouping';}
      if(canSignalGroup&&event&&!j.closed){j.title=event.origin==='SIGNAL'?'Laporan tergabung dalam sinyal':'Laporan menjadi sumber kejadian';j.waiting='Penilaian dan tindak lanjut';j.next=event.origin==='SIGNAL'?'Buka sinyal terkait':'Buka kejadian terkait';j.action='ebsGrouping';}
      if(!j.closed&&!valid){j.title=pending?'Menunggu klarifikasi kader':'Nilai validitas laporan';j.waiting=pending?'Jawaban kader':'Penilaian admin';j.next=pending?'Lihat pertanyaan':'Nilai laporan';j.action=pending?'ebsClarifications':'ebsValidationSection';}
      const eligible=canGroup&&!h.event_id&&(canSignalGroup?valid:decision?.outcome==='CONFIRMED' || (!j.closed&&h.current_status==='TERVERIFIKASI'&&h.verified_ebs_id));
      const activeEvents=events.filter(e=>!['SELESAI','DIBATALKAN'].includes(e.current_status)&&(!canSignalGroup||(e.origin==='SIGNAL'&&(!e.village_code||e.village_code===r.village_code)))).sort((a,b)=>Number(b.village_code===r.village_code)-Number(a.village_code===r.village_code));
      const grouping=event?`<div class="report-event-summary"><strong>${esc(event.event_title)}</strong><p>${esc(event.event_id)} · ${esc(eventLabels[event.current_status] || event.current_status)}</p><a class="button secondary" href="#staff-event/${encodeURIComponent(event.event_id)}?report=${encodeURIComponent(reportId)}">${event.origin==='SIGNAL'?'Kelola sinyal':'Kelola kejadian'}</a></div><p>${eventData.reports.length} laporan terhubung. Jumlah kasus kejadian mengikuti orang yang dikonfirmasi, bukan penjumlahan laporan.</p><ul class="report-related-list">${eventData.reports.map(v=>`<li>${['ADMIN','PIMPINAN'].includes(me.role)?`<a href="#staff-report/${encodeURIComponent(v.report_id)}">${esc(v.report_id)}</a>`:esc(v.report_id)}${v.report_id===reportId?' · Laporan ini':''}<small>${esc(v.village_code)} · ${formatDate(v.submitted_at)}</small></li>`).join('')}</ul>`:
        eligible?`<p class="section-intro">Hubungkan laporan yang membahas kejadian yang sama. Laporan valid dikelompokkan sebagai sinyal sebelum verifikasi. Sinyal baru menjadi kejadian setelah hasil verifikasi dicatat.</p>
        <form id="ebsLink" data-work-form class="report-work-form"><label>${canSignalGroup?'Sinyal yang sudah ada':'Kejadian yang sudah ada'}<select name="event_id" required><option value="">Pilih kelompok yang sesuai…</option>${activeEvents.map(e=>`<option value="${esc(e.event_id)}">${esc(e.event_title)} · ${esc(e.village_code || 'Lintas desa')} · ${esc(e.event_id)}</option>`).join('')}</select></label><button type="submit" class="secondary">Hubungkan laporan</button></form>
        <details id="ebsCreateEventPanel"><summary>${canSignalGroup?'Belum ada sinyal yang sesuai? Kelompokkan sinyal baru':'Buat kejadian baru'}</summary><form id="ebsCreateEvent" data-work-form class="report-work-form"><label>${canSignalGroup?'Nama sinyal':'Nama kejadian'}<input name="event_title" maxlength="200" required value="${esc(r.observation_labels || r.event_type_label || 'Kejadian kesehatan')} · ${esc(r.village_name || r.village_code)}"></label><label>Program penanggung jawab<input name="program_owner" maxlength="150" required placeholder="Contoh: P2P"></label>${canSignalGroup?'<p class="help">Status awal: Sinyal menunggu verifikasi. Tambahkan laporan valid tentang hal yang sama; belum menjadi kejadian terverifikasi.</p>':`<label>Sinyal kejadian<select name="verified_signal_code" required><option value="">Pilih sinyal…</option>${masters.signals.map(v=>`<option value="${esc(v.signal_code)}"${v.signal_code===h.signal_code?' selected':''}>${esc(v.community_label)}</option>`).join('')}</select></label><label>Kasus terverifikasi dalam kejadian<input name="verified_cases" type="number" min="0" value="${esc(decision?.actual_cases ?? latest?.actual_cases ?? 0)}" required></label><label>Meninggal terverifikasi<input name="verified_deaths" type="number" min="0" value="${esc(decision?.actual_deaths ?? latest?.actual_deaths ?? 0)}" required></label><p class="help">Gunakan jumlah orang yang berbeda; jangan menjumlahkan laporan tentang orang yang sama.</p>`}<button type="submit">${canSignalGroup?'Buat sinyal dan hubungkan laporan':'Buat kejadian dan hubungkan laporan'}</button></form></details>`:
        `<p class="help">${decision&&decision.outcome!=='CONFIRMED'?'Tidak ada pengaitan kejadian untuk hasil peninjauan ini.':!j.closed?'Pengelompokan sinyal tersedia setelah admin menyatakan laporan valid.':'Belum terhubung ke kejadian. Admin dapat mengaitkan laporan dengan keputusan terkonfirmasi.'}</p>`;
      const correction=me.role==='ADMIN'?'<details class="report-correction"><summary>Koreksi entri yang salah</summary><p class="help">Untuk laporan uji atau entri yang memang harus dihapus. Alasan penghapusan dicatat dalam audit.</p><button type="button" id="deleteReport" class="danger-button">Hapus laporan permanen</button></details>':'';
      const cadreSelection=canSignalGroup?`<section class="card"><h2>Penilaian & tindak lanjut</h2>${event?`<p>Penilaian dan pemilihan kader mengikuti kejadian yang sama untuk seluruh laporan sumber.</p><a class="button secondary" href="#staff-event-work/${encodeURIComponent(event.event_id)}">Penilaian & tindak lanjut kejadian</a>`:'<p>Admin menilai validitas laporan, lalu laporan valid dikelompokkan sebagai sinyal untuk diverifikasi.</p><button type="button" class="secondary" data-open-work="ebsValidationSection">Nilai validitas laporan</button>'}</section>`:'';
      const notification=canManage&&Number(h.immediate_notification)&&h.notification_status!=='SENT'?'<section class="card"><h2>Notifikasi petugas</h2><p>Notifikasi segera belum terkirim.</p><button type="button" id="retryReportNotification" class="secondary">Coba kirim notifikasi</button></section>':'';
      app.innerHTML=`<section class="card hero report-work-heading" data-work-report="${esc(reportId)}"><a class="back-link" href="#staff-reports">← Laporan Kader</a><p class="eyebrow">Peninjauan laporan · ${r.reporter_id?'Kader':'Warga'}</p><h1>${esc(r.observation_labels || r.event_type_label || 'Kejadian kesehatan')}</h1><p>${esc(r.report_id)} · ${esc(r.village_name || r.village_code)} · Dikirim ${formatDate(r.submitted_at)}</p><div class="report-work-statuses"><span><small>Status laporan</small>${badge(r.workflow_status)}</span>${decision?`<span><small>Hasil peninjauan</small><strong>${esc(decisionLabels[decision.outcome])}</strong></span>`:''}</div></section>
        <div id="ebsMessage" class="message" aria-live="polite">${notice?alertBox('success',notice):''}</div>
        <section class="card report-next-step" aria-labelledby="reportNextTitle"><div><h2 id="reportNextTitle">${esc(j.title)}</h2><p>Menunggu: <strong>${esc(j.waiting)}</strong></p><p class="help">${j.closed?'Selesai berarti keputusan atas laporan sudah dicatat. Penanganan kejadian mempunyai status sendiri.':pending?'Status tetap Ditinjau selama menunggu informasi tambahan.':'Pastikan informasi cukup, lalu catat hasil dan alasan keputusan.'}</p></div><div class="report-next-actions"><button type="button" data-open-work="${j.action}">${esc(j.next)}</button><button class="secondary" type="button" id="refreshReport">Perbarui data</button></div></section>
        ${reviewJourney(j.step)}
        <nav class="report-section-nav" aria-label="Bagian laporan"><button type="button" class="text-button" data-open-work="ebsFacts">Isi laporan</button><button type="button" class="text-button" data-open-work="ebsClarifications">Pertanyaan dan jawaban${pending?` (${pending})`:''}</button><button type="button" class="text-button" data-open-work="ebsDecisionSection">Hasil peninjauan</button><button type="button" class="text-button" data-open-work="ebsGrouping">Kejadian terkait</button><button type="button" class="text-button" data-open-work="ebsHistory">Riwayat</button></nav>
        <div class="report-work-layout"><div class="report-work-main">
        <section id="ebsFacts" class="card"><h2>Isi laporan ${r.reporter_id?'kader':'warga'}</h2><dl class="detail-grid">${fact('Gejala / tanda',r.observation_labels)}${fact('Konteks / paparan',r.context_labels)}${fact('Tanggal mulai kejadian',r.event_start_date)}${fact('Kelompok terdampak',affectedGroupLabel(r.affected_group))}${fact('Terdampak',r.reported_cases_known===0?'Belum diketahui':r.reported_cases)}${fact('Meninggal',r.reported_deaths_known===0?'Belum diketahui':r.reported_deaths)}${fact('Kasus berat',r.severe_cases_known===0?'Tidak ditanyakan pada form kader':r.severe_cases)}${fact('Dirawat',r.hospitalized_cases_known===0?'Belum diketahui':r.hospitalized_cases)}${fact('Deskripsi',r.description)}${fact('Tindakan awal',r.initial_action)}</dl></section>
        <section id="ebsClarifications" class="card"><div class="section-heading"><div><h2>Pertanyaan dan jawaban</h2><p class="section-intro">${pending?`${pending} pertanyaan menunggu jawaban pelapor.`:'Minta informasi tambahan hanya bila diperlukan.'}</p></div>${canManage&&!j.closed&&r.reporter_id?'<button type="button" class="secondary" data-open-work="ebsAskPanel">Minta klarifikasi</button>':''}</div>${thread(data)}${canManage&&!j.closed&&r.reporter_id?'<details id="ebsAskPanel"><summary>Tulis pertanyaan</summary><form id="ebsAsk" data-work-form><label>Informasi yang perlu dilengkapi<textarea name="question" maxlength="1000" required></textarea></label><button type="submit">Kirim permintaan</button></form></details>':j.closed?'<p class="help">Peninjauan sudah selesai. Percakapan tetap tersimpan bersama laporan.</p>':'<p class="help">Gunakan kontak pelapor yang diizinkan bila perlu konfirmasi.</p>'}</section>
        <section id="ebsValidationSection" class="card"><h2>1. Validitas laporan</h2>${validation?`<p><strong>${esc(validationLabels[validation.status])}</strong></p><p>${esc(validation.notes)}</p>`:'<p>Belum dinilai oleh admin.</p>'}${validationForm}${qualityForm}</section>
        <section id="ebsDecisionSection" class="card"><h2>Hasil verifikasi laporan</h2>${finalSummary}${decisionForm}${r.reporter_id&&!valid&&!j.closed?'<p class="help">Admin perlu menyatakan laporan valid sebelum hasil verifikasi dapat disimpan.</p>':''}${!canManage&&!j.closed?'<p>Hanya petugas berwenang dapat menyimpan keputusan akhir.</p>':''}</section>
        <section id="ebsGrouping" class="card"><h2>Sinyal / kejadian terkait</h2>${grouping}</section>
        <section id="ebsHistory" class="card"><h2>Riwayat laporan</h2>${timeline(data)}${work.history?.length?`<details><summary>Riwayat administrasi sebelumnya</summary><div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Perubahan</th><th>Catatan</th></tr></thead><tbody>${work.history.map(v=>`<tr><td>${formatDate(v.changed_at)}</td><td>${esc(handlingLabels[v.new_status] || v.new_status)}</td><td class="preserve-lines">${esc(v.notes)}</td></tr>`).join('')}</tbody></table></div></details>`:''}${correction}</section>
        </div><aside class="report-work-aside"><section class="card"><h2>Pelapor dan lokasi</h2><dl class="detail-grid">${fact('Pelapor',r.reporter_name || 'Identitas tersamarkan')}${fact('Posyandu',r.posyandu_name)}${fact('Desa',r.village_name || r.village_code)}${fact('Alamat / dukuh / RT / RW',r.location_text)}${fact('Kontak',r.reporter_phone || 'Tidak tersedia / tidak diizinkan')}${fact('Koordinat',r.latitude!=null&&r.longitude!=null?`${r.latitude}, ${r.longitude}`:'Tidak tersedia')}</dl><p class="help">${r.attachment_key?'Referensi dokumentasi tersimpan; penampil lampiran belum tersedia.':'Tidak ada foto pada laporan ini.'}</p></section>
        ${notification}${cadreSelection}<section class="card"><h2>Penanggung jawab laporan</h2>${canGroup&&!j.closed?`<details><summary>Penanggung jawab: ${esc(assigned)}</summary><form id="ebsAssign" data-work-form class="report-work-form"><label>Verifikator<select name="assigned_to" required><option value="">Pilih verifikator…</option>${verifiers.map(v=>`<option value="${esc(v.email)}"${h.assigned_to===v.email?' selected':''}>${esc(v.name)}</option>`).join('')}</select></label><button type="submit" class="secondary">Simpan penugasan</button></form></details>`:`<p>${decision?`Keputusan oleh ${esc(decision.decided_by_name)}`:`Penanggung jawab: ${esc(assigned)}`}</p>`}</section></aside></div>`;
      const openSection=id=>{const target=app.querySelector(`#${id}`);if(!target)return;if(target.tagName==='DETAILS')target.open=true;const control=target.querySelector('textarea,input:not([type="hidden"]),select') || target.querySelector('h2');if(control){if(control.tagName==='H2')control.tabIndex=-1;control.focus({preventScroll:true});}target.scrollIntoView({block:'start',behavior:'smooth'});};
      app.querySelectorAll('[data-open-work]').forEach(b=>b.addEventListener('click',()=>openSection(b.dataset.openWork)));
      for(const [id,draft] of drafts){const form=app.querySelector(`#${id}`);if(form){if(draft.createdEventId)form.dataset.createdEventId=draft.createdEventId;for(const [name,value] of Object.entries(draft.values)){if(name==='expected_updated_at')continue;const field=form.elements.namedItem(name);if(field)field.value=value;}}}
      const syncOutcome=()=>{const form=app.querySelector('#ebsDecision');if(!form)return;const confirmed=form.elements.outcome.value==='CONFIRMED';form.querySelector('[data-classification]').hidden=!confirmed;form.elements.verified_ebs_id.required=confirmed;form.elements.verified_ebs_id.disabled=!confirmed;form.querySelector('[data-actual-counts]').hidden=!form.elements.outcome.value;for(const key of ['actual_cases','actual_deaths','actual_severe_cases'])form.elements[key].required=confirmed;form.querySelector('[data-count-help]').textContent=confirmed?'Isi jumlah aktual hasil konfirmasi, termasuk 0 bila tidak ada.':'Opsional. Kosongkan jumlah yang belum diketahui; kosong berbeda dari 0.';};
      app.querySelector('#ebsDecision [name="outcome"]')?.addEventListener('change',syncOutcome);syncOutcome();
      const dirty=()=>[...app.querySelectorAll('[data-work-form] input:not([type="hidden"]),[data-work-form] textarea,[data-work-form] select')].some(el=>el.value!==(el.tagName==='SELECT'?[...el.options].find(o=>o.defaultSelected)?.value || el.options[0]?.value || '':el.defaultValue));
      setLeaveGuard(dirty);
      const failure=error=>{if(!current())return;app.querySelector('#ebsMessage').innerHTML=alertBox('error',error.message);app.querySelector('#ebsMessage').scrollIntoView({block:'center'});};
      const post=(url,values)=>api(url,{method:'POST',body:JSON.stringify(values)});
      const bindForm=(id,action)=>app.querySelector(`#${id}`)?.addEventListener('submit',e=>{const form=e.currentTarget;void submitForm(e,async()=>{try{await action(form);if(!current())return;
        if(id==='ebsDecision'){
          const outcome=form.elements.outcome.value;
          form.removeAttribute('data-work-form');form.innerHTML=alertBox('success','Keputusan berhasil disimpan. Peninjauan laporan selesai.');
          app.querySelector('.report-work-statuses').innerHTML=`<span><small>Status laporan</small>${badge('CLOSED')}</span><span><small>Hasil peninjauan</small><strong>${esc(decisionLabels[outcome])}</strong></span>`;
          app.querySelector('#reportNextTitle').textContent='Peninjauan laporan selesai';
          app.querySelector('.report-next-step p strong').textContent='Tidak ada keputusan laporan yang ditunggu';
          app.querySelector('.report-next-step .help').textContent='Keputusan tersimpan. Penanganan kejadian mempunyai status sendiri.';
          app.querySelector('.report-next-actions [data-open-work]').textContent='Lihat keputusan';
          app.querySelectorAll('.report-journey li').forEach((li,index)=>{li.classList.toggle('is-current',index===2);li.classList.toggle('is-past',index<2);li.classList.remove('is-future');if(index===2)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
          app.querySelectorAll('#ebsAsk button,#ebsAssign button').forEach(b=>b.disabled=true);
        }
        else form.reset();
        await detail(reportId,id==='ebsDecision'?'Keputusan berhasil disimpan. Peninjauan laporan selesai.':'Perubahan berhasil disimpan.');
      }catch(error){failure(error);}},'Menyimpan…');});
      app.querySelector('#refreshReport').addEventListener('click',()=>{void detail(reportId);});
      app.querySelector('#deleteReport')?.addEventListener('click',async e=>{try{if(await deleteWithReason(e.currentTarget,`laporan ${reportId}`,`/api/reports/${encodeURIComponent(reportId)}`)){setLeaveGuard(()=>false);location.hash='#staff-reports';}}catch(error){failure(error);}});
      app.querySelector('#retryReportNotification')?.addEventListener('click',async e=>{const button=e.currentTarget;setBusy(button,true,'Mengirim…');try{const result=await post(`/api/reports/${encodeURIComponent(reportId)}/notification/retry`,{});if(result.status!=='SENT')throw new Error(result.error || 'Notifikasi belum terkirim.');await detail(reportId,'Notifikasi berhasil dikirim.');}catch(error){failure(error);}finally{setBusy(button,false);}});
      bindForm('ebsAsk',f=>post(`${path}/clarifications`,Object.fromEntries(new FormData(f))));
      bindForm('ebsValidation',f=>post(`${path}/validation`,Object.fromEntries(new FormData(f))));
      bindForm('ebsQuality',f=>post(`${path}/quality`,Object.fromEntries(new FormData(f))));
      const validationControl=app.querySelector('#ebsValidation [name="status"]');
      const syncValidation=()=>{const question=app.querySelector('[data-validation-question]');if(question){const needed=validationControl.value==='NEEDS_CLARIFICATION';question.hidden=!needed;question.querySelector('textarea').required=needed;}};
      validationControl?.addEventListener('change',syncValidation);if(validationControl)syncValidation();
      bindForm('ebsDecision',f=>{if(app.querySelector('#ebsAsk textarea')?.value.trim())throw new Error('Ada pertanyaan yang belum dikirim. Kirim atau hapus pertanyaan sebelum menyimpan keputusan.');return post(`${path}/decision`,Object.fromEntries(new FormData(f)));});
      bindForm('ebsAssign',f=>post(`/api/reports/${encodeURIComponent(reportId)}/assign`,Object.fromEntries(new FormData(f))));
      bindForm('ebsLink',f=>canSignalGroup?post(`/api/sbm/events/${encodeURIComponent(f.elements.event_id.value)}/reports`,{report_id:reportId}):post(`/api/reports/${encodeURIComponent(reportId)}/event`,{event_id:f.elements.event_id.value,notes:'Laporan dihubungkan ke kejadian tanpa mengubah keputusan akhir.'}));
      bindForm('ebsCreateEvent',async f=>{if(canSignalGroup){const created=await post('/api/sbm/events',{...Object.fromEntries(new FormData(f)),report_ids:[reportId]});f.dataset.createdEventId=created.event_id;return;}if(!f.dataset.createdEventId){const created=await post('/api/events',{...Object.fromEntries(new FormData(f)),village_code:r.village_code,event_start_date:r.event_start_date,verified_severe_cases:decision?.actual_severe_cases ?? latest?.actual_severe_cases ?? 0});f.dataset.createdEventId=created.event_id;}try{await post(`/api/reports/${encodeURIComponent(reportId)}/event`,{event_id:f.dataset.createdEventId,notes:'Kejadian dibuat dan laporan dihubungkan.'});}catch(error){throw new Error(`Kejadian ${f.dataset.createdEventId} sudah dibuat. Kirim kembali untuk mencoba pengaitan tanpa membuat kejadian baru. ${error.message}`);}});
      if(notice){const heading=app.querySelector('#reportNextTitle');heading.tabIndex=-1;heading.focus({preventScroll:true});app.querySelector('.report-next-step').scrollIntoView({block:'start',behavior:'auto'});}
    }catch(error){if(!current())return;const host=app.querySelector('.report-work-heading');if(host?.dataset.workReport===reportId)app.querySelector('#ebsMessage').innerHTML=alertBox('error',error.message);else pageFailure(error,()=>detail(reportId),'#staff-reports');}
  }

  let cadreDetailRevision=0,cadreOwner='';
  const cadreDrafts=new Map(),answerInFlight=new Set();
  const hasCadreDrafts=()=>[...cadreDrafts.values()].some(drafts=>[...drafts.values()].some(value=>value.trim()));
  function clearCadreDrafts(){cadreDrafts.clear();answerInFlight.clear();cadreOwner='';cadreDetailRevision++;}
  function syncCadreOwner(owner){if(cadreOwner!==owner){clearCadreDrafts();cadreOwner=owner;}}
  function cadreReturn() {
    const params=new URLSearchParams(location.hash.split('?')[1] || '');
    const filter=['all','pending','review','closed'].includes(params.get('filter'))?params.get('filter'):'all';
    const number=(key,max)=>{const value=Number(params.get(key));return Number.isSafeInteger(value)&&value>=0&&value<=max?value:0;};
    return '#cadre-home?'+new URLSearchParams({view:'history',filter,offset:number('offset',1000000),scroll:number('scroll',10000000)});
  }
  async function cadreDetail(reportId,notice='') {
    const revision=++cadreDetailRevision;
    const onRoute=()=>location.hash.split('?')[0]===`#cadre-report/${encodeURIComponent(reportId)}`;
    const current=()=>revision===cadreDetailRevision&&onRoute();
    const failure=error=>{
      if(!current())return;
      if(app.querySelector('.cadre-report-heading')?.dataset.workReport===reportId) {
        const message=app.querySelector('#cadreDetailMessage');
        message.innerHTML=`<div data-thread-error>${alertBox('error',error.message)}<button type="button" class="secondary">Coba lagi</button></div>`;
        message.querySelector('button').addEventListener('click',()=>cadreDetail(reportId));
      } else pageFailure(error,()=>cadreDetail(reportId),cadreReturn());
    };
    try {
      const me=await api('/api/me');if(!current())return;
      if(me.kind!=='cadre'){location.hash='#cadre';return;}
      if(cadreOwner!==me.cadre_code){syncCadreOwner(me.cadre_code);cadreDetailRevision=revision;}
      const data=await api(`/api/ebs/reports/${encodeURIComponent(reportId)}`);if(!current())return;
      const r=data.report,d=data.decision,closed=r.workflow_status==='CLOSED',pending=data.clarifications.filter(c=>!c.answered_at).length;
      let drafts=cadreDrafts.get(reportId);if(!drafts){drafts=new Map();cadreDrafts.set(reportId,drafts);}
      for(const id of drafts.keys())if(!data.clarifications.some(c=>c.clarification_id===id&&!c.answered_at))drafts.delete(id);
      const title=r.observation_labels || r.event_type_label || 'Kejadian kesehatan';
      const next=closed?'Lihat hasil':pending?'Jawab pertanyaan':'Lihat perkembangan';
      const nextSection=closed?'cadreDecision':pending?'cadreQuestions':'cadreTimeline';
      const result=d?`<dl class="detail-grid">${fact('Hasil peninjauan',decisionLabels[d.outcome])}${fact('Alasan dari petugas',d.notes)}${fact('Kasus hasil konfirmasi',d.actual_cases ?? 'Belum diketahui')}${fact('Meninggal hasil konfirmasi',d.actual_deaths ?? 'Belum diketahui')}${fact('Kasus berat hasil konfirmasi',d.actual_severe_cases ?? 'Belum diketahui')}${fact('Diputuskan oleh',d.decided_by_name)}${fact('Waktu keputusan',formatDate(d.decided_at))}</dl>`:`<p>${closed?'Laporan diselesaikan melalui alur sebelumnya. Riwayat perkembangan tetap tersedia.':'Belum ada keputusan akhir. Hasil dan alasan petugas akan tampil setelah peninjauan selesai.'}</p>`;
      app.innerHTML=`<section class="card hero report-work-heading cadre-report-heading" data-work-report="${esc(reportId)}"><a class="back-link" href="${esc(cadreReturn())}">← Riwayat laporan</a><p class="eyebrow">Rincian laporan · Kader</p><h1>${esc(title)}</h1><p>${esc(r.report_id)} · ${esc(r.village_name || r.village_code)} · Dikirim ${formatDate(r.submitted_at)}</p><div class="report-work-statuses"><span><small>Status laporan</small>${badge(r.workflow_status)}</span>${pending&&!closed?'<span class="cadre-answer-marker">Perlu jawaban Anda</span>':''}${d?`<span><small>Hasil peninjauan</small><strong>${esc(decisionLabels[d.outcome])}</strong></span>`:''}</div></section>
        <div id="cadreDetailMessage" class="message" aria-live="polite">${notice?alertBox('success',notice):''}</div>
        <section class="card report-next-step" aria-labelledby="cadreNextTitle"><div><h2 id="cadreNextTitle">${closed?'Peninjauan laporan selesai':pending?`${pending} pertanyaan perlu dijawab`:r.workflow_status==='SUBMITTED'?'Laporan masuk':'Laporan ditinjau'}</h2><p>Menunggu: <strong>${closed?'Tidak ada jawaban yang ditunggu':pending?'Jawaban Anda':'Peninjauan petugas'}</strong></p><p class="help">${esc(cadreStatusMeaning(r.workflow_status,pending>0,d?.outcome))}</p></div><div class="report-next-actions"><button type="button" data-open-cadre="${nextSection}">${next}</button><button type="button" class="secondary" id="refreshCadreReport">Perbarui data</button></div></section>
        ${reviewJourney(closed?2:r.workflow_status==='SUBMITTED'?0:1)}
        <nav class="report-section-nav" aria-label="Bagian laporan"><button type="button" class="text-button" data-open-cadre="cadreFacts">Isi laporan</button><button type="button" class="text-button" data-open-cadre="cadreQuestions">Pertanyaan dan jawaban${pending?` (${pending})`:''}</button><button type="button" class="text-button" data-open-cadre="cadreDecision">Hasil peninjauan</button><button type="button" class="text-button" data-open-cadre="cadreTimeline">Riwayat</button></nav>
        <div class="report-work-layout"><div class="report-work-main">
          <section class="card" id="cadreFacts"><h2>Isi laporan Anda</h2><dl class="detail-grid">${fact('Gejala / tanda',r.observation_labels)}${fact('Konteks / paparan',r.context_labels)}${fact('Tanggal mulai kejadian',formatDate(r.event_start_date))}${fact('Kelompok terdampak',affectedGroupLabel(r.affected_group))}${fact('Terdampak',r.reported_cases_known===0?'Belum diketahui':r.reported_cases)}${fact('Meninggal',r.reported_deaths_known===0?'Belum diketahui':r.reported_deaths)}${fact('Kasus berat',r.severe_cases_known===0?'Tidak ditanyakan pada form kader':r.severe_cases)}${fact('Dirawat',r.hospitalized_cases_known===0?'Belum diketahui':r.hospitalized_cases)}${fact('Deskripsi',r.description)}${fact('Tindakan awal',r.initial_action)}</dl></section>
          <section class="card" id="cadreQuestions"><h2>Pertanyaan dan jawaban</h2><p class="section-intro">${pending&&!closed?'Lengkapi informasi yang diminta petugas pada laporan ini.':'Percakapan dengan petugas tersimpan bersama laporan.'}</p>${thread(data,true)}</section>
          <section class="card" id="cadreDecision"><h2>Hasil peninjauan</h2>${result}</section>
          <section class="card" id="cadreContribution"><h2>Kontribusi pada kejadian</h2><p>${esc(contributionText(data.contribution))}</p>${data.contribution?.stage==='INCIDENT'?`<dl class="detail-grid">${fact('Nomor kejadian',data.contribution.event_id)}${fact('Penanganan',eventLabels[data.contribution.status]||data.contribution.status)}</dl>`:''}</section>
          <section class="card" id="cadreAssessment"><h2>Penilaian laporan Anda</h2>${data.assessment?.validation?`<p><strong>${esc(validationLabels[data.assessment.validation.status])}</strong></p><p>${esc(data.assessment.validation.notes)}</p>`:'<p>Validitas laporan belum dinilai admin.</p>'}${qualityResult(data.assessment)}</section>
          <section class="card" id="cadreTimeline"><h2>Riwayat laporan</h2>${timeline(data)}</section>
        </div><aside class="report-work-aside"><section class="card"><h2>Pelapor dan lokasi</h2><dl class="detail-grid">${fact('Pelapor',r.reporter_name || me.name)}${fact('Posyandu',r.posyandu_name || me.posyandu_name)}${fact('Desa',r.village_name || r.village_code)}${fact('Alamat / dukuh / RT / RW',r.location_text)}</dl></section></aside></div>`;
      document.title=`${title} · Laporan Anda · ${branding.displayName}`;
      const open=id=>{const target=app.querySelector('#'+id);if(!target)return;const control=target.querySelector('textarea') || target.querySelector('h2');if(control){if(control.tagName==='H2')control.tabIndex=-1;control.focus({preventScroll:true});}target.scrollIntoView({block:'start',behavior:'smooth'});};
      app.querySelectorAll('[data-open-cadre]').forEach(button=>button.addEventListener('click',()=>open(button.dataset.openCadre)));
      app.querySelector('#refreshCadreReport').addEventListener('click',()=>cadreDetail(reportId));
      setLeaveGuard(()=>[...drafts.values()].some(value=>value.trim()) || [...app.querySelectorAll('.ebs-answer textarea')].some(input=>input.value.trim()));
      app.querySelectorAll('.ebs-answer').forEach(form=>{
        const id=form.dataset.id;form.elements.answer.value=drafts.get(id) || '';
        form.elements.answer.addEventListener('input',()=>drafts.set(id,form.elements.answer.value));
        if(answerInFlight.has(id)){form.elements.answer.disabled=true;setBusy(form.querySelector('button'),true,'Mengirim…');}
        form.addEventListener('submit',event=>submitForm(event,async()=>{
          if(answerInFlight.has(id))return;
          const values=Object.fromEntries(new FormData(form));answerInFlight.add(id);form.elements.answer.disabled=true;
          try {
            await api(`/api/sbm/clarifications/${encodeURIComponent(id)}/answer`,{method:'POST',body:JSON.stringify(values)});
            drafts.delete(id);onReportUpdated();if(!onRoute()||cadreOwner!==me.cadre_code)return;
            const visible=app.querySelector(`.ebs-answer[data-id="${CSS.escape(id)}"]`);
            if(visible){const ack=document.createElement('div');ack.dataset.answerAccepted='';ack.setAttribute('role','status');ack.innerHTML=alertBox('success','Jawaban berhasil dikirim ke petugas.')+`<p class="preserve-lines">${esc(values.answer)}</p>`;visible.replaceWith(ack);}
            if(!app.querySelector('.ebs-answer')){
              app.querySelector('.cadre-report-heading .cadre-answer-marker')?.remove();
              app.querySelector('#cadreNextTitle').textContent='Jawaban telah diterima';
              app.querySelector('.report-next-step p strong').textContent='Peninjauan petugas';
              app.querySelector('.report-next-step .help').textContent='Perbarui data untuk melihat perkembangan terbaru.';
              const action=app.querySelector('.report-next-actions [data-open-cadre]');action.textContent='Lihat perkembangan';action.dataset.openCadre='cadreTimeline';
            }
            answerInFlight.delete(id);await cadreDetail(reportId,'Jawaban berhasil dikirim ke petugas.');
          }catch(error){if(onRoute()&&cadreOwner===me.cadre_code){const visible=app.querySelector(`.ebs-answer[data-id="${CSS.escape(id)}"]`);if(visible)visible.querySelector('.message').innerHTML=alertBox('error',error.message);}}
          finally{answerInFlight.delete(id);if(onRoute()){const visible=app.querySelector(`.ebs-answer[data-id="${CSS.escape(id)}"]`);if(visible){visible.elements.answer.disabled=false;setBusy(visible.querySelector('button'),false);}}}
        },'Mengirim…'));
      });
      if(notice){const heading=app.querySelector('#cadreNextTitle');heading.tabIndex=-1;heading.focus({preventScroll:true});}
    }catch(error){failure(error);}
  }
  return {list,detail,events:eventsList,cadreDetail,cadreReturn,clearCadreDrafts,syncCadreOwner,hasCadreDrafts,badge,cadreStatusMeaning,cadreList};
}
