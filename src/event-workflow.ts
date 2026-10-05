import { auditStatement, getReport, id, now } from './db';
import { body, HttpError, json } from './http';
import { clean, multiline, integer } from './validation';
import { validMaster } from './db';
import { requireValidReport } from './report-assessment';
import { CADRE_SCORE_VERSION, cadrePerformance, selectionScore } from './cadre-scoring';
import type { Env, StaffSession } from './types';

function required(value:unknown,label:string,max=1000) {
  const result=multiline(value,max);if(!result) throw new HttpError(`${label} wajib diisi.`);return result;
}
function choice(value:unknown,allowed:string[]) {
  const result=clean(value,30);if(!allowed.includes(result))throw new HttpError('Pilihan tidak valid.');return result;
}
async function eventRecord(env:Env,eventId:string,open=false) {
  const event=await env.DB.prepare('SELECT * FROM events WHERE event_id=?').bind(eventId).first<Record<string,unknown>>();
  if(!event)throw new HttpError('Kejadian tidak ditemukan.',404);
  if(open&&['SELESAI','DIBATALKAN'].includes(String(event.current_status)))throw new HttpError('Kejadian sudah ditutup.',409);
  return event;
}
export async function handleEventWorkflow(request:Request,env:Env,staff:StaffSession):Promise<Response|null> {
  const path=new URL(request.url).pathname,method=request.method;
  if(path==='/api/sbm/events'&&method==='POST') {
    const data=await body(request);
    const reportIds=Array.isArray(data.report_ids)?[...new Set(data.report_ids.map(v=>clean(v,50)))]:[];
    if(!reportIds.length||reportIds.length>30)throw new HttpError('Pilih 1–30 laporan sumber kejadian.');
    const sources=await env.DB.prepare(`SELECT * FROM reports WHERE report_id IN (${reportIds.map(()=>'?').join(',')})`).bind(...reportIds).all<Record<string,unknown>>();
    if(sources.results.length!==reportIds.length)throw new HttpError('Laporan sumber tidak ditemukan.');
    if(sources.results.some(r=>r.event_id))throw new HttpError('Laporan sudah terhubung ke kejadian. Buka kejadian tersebut.',409);
    for(const reportId of reportIds)await requireValidReport(env,reportId);
    const first=sources.results[0],village=String(first.village_code);
    if(sources.results.some(r=>r.village_code!==village))throw new HttpError('Kelompokkan laporan dari desa yang sama.');
    const eventId=id('EVT'),timestamp=now(),event={event_id:eventId,event_title:required(data.event_title,'Nama kejadian',200),
      verified_signal_code:first.signal_code,event_start_date:first.event_start_date,village_code:village,
      location_summary:clean(first.location_text,500),program_owner:required(data.program_owner,'Program penanggung jawab',150),
      lead_investigator:staff.email,current_status:'DRAFT',origin:'SIGNAL',created_at:timestamp,created_by:staff.email,updated_at:timestamp,updated_by:staff.email};
    const values=Object.values(event);
    const result=await env.DB.batch([
      env.DB.prepare(`INSERT INTO events(${Object.keys(event).join(',')}) SELECT ${values.map(()=>'?').join(',')}
        WHERE (SELECT COUNT(*) FROM reports WHERE report_id IN (${reportIds.map(()=>'?').join(',')}) AND event_id IS NULL AND village_code=? AND EXISTS(SELECT 1 FROM report_validations v WHERE v.report_id=reports.report_id AND v.status='VALID'))=?`).bind(...values,...reportIds,village,reportIds.length),
      env.DB.prepare(`UPDATE reports SET event_id=?,updated_by=?,updated_at=? WHERE report_id IN (${reportIds.map(()=>'?').join(',')}) AND event_id IS NULL AND EXISTS(SELECT 1 FROM events WHERE event_id=?)`).bind(eventId,staff.email,timestamp,...reportIds,eventId),
      env.DB.prepare(`INSERT INTO status_history(history_id,entity_type,entity_id,new_status,changed_at,changed_by,notes)
        SELECT ?,'EVENT',?,'DRAFT',?,?,'Sinyal dikelompokkan dari laporan valid; belum menjadi kejadian terverifikasi.' WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)`).bind(id('HIS'),eventId,timestamp,staff.email,eventId),
      env.DB.prepare(`INSERT INTO audit_log(audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes)
        SELECT ?,?,?,'CREATE_SIGNAL_EVENT','EVENT',?,'{}',?,'Pengaitan tidak menetapkan diagnosis atau jumlah terverifikasi.' WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)`).bind(id('AUD'),timestamp,staff.email,eventId,JSON.stringify({report_ids:reportIds}),eventId),
    ]);
    if(!result[0].meta.changes)throw new HttpError('Laporan sudah berubah. Muat ulang sebelum membuat kejadian.',409);
    return json(await eventRecord(env,eventId),201);
  }
  const match=path.match(/^\/api\/sbm\/events\/([^/]+)\/(workspace|reports|assessment|followups|verification|candidates\/([^/]+)|report-quality\/([^/]+))$/);
  if(!match)return null;
  const eventId=decodeURIComponent(match[1]),action=match[2],event=await eventRecord(env,eventId,method!=='GET'&&!action.startsWith('report-quality/'));
  if(action==='reports'&&method==='POST') {
    const data=await body(request),report=await getReport(env,clean(data.report_id,50));
    if(report.event_id===eventId)return json({ok:true,already_linked:true});
    if(event.verified_source_revision!=null)throw new HttpError('Kejadian telah terverifikasi. Kelompokkan laporan tambahan sebagai sinyal baru untuk ditinjau.',409);
    await requireValidReport(env,String(report.report_id));
    if(report.event_id)throw new HttpError('Laporan sudah terhubung ke kejadian lain.',409);
    if(event.village_code&&report.village_code!==event.village_code)throw new HttpError('Desa laporan tidak sesuai dengan kejadian.');
    const timestamp=now();
    const linked=await env.DB.batch([
      env.DB.prepare(`UPDATE reports SET event_id=?,updated_by=?,updated_at=? WHERE report_id=? AND event_id IS NULL
        AND EXISTS(SELECT 1 FROM report_validations v WHERE v.report_id=reports.report_id AND v.status='VALID')
        AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND verified_source_revision IS NULL AND current_status NOT IN ('SELESAI','DIBATALKAN'))`).bind(eventId,staff.email,timestamp,report.report_id,eventId),
      env.DB.prepare(`INSERT INTO audit_log(audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes)
        SELECT ?,?,?,'LINK_SIGNAL_EVENT','REPORT',?,'{}',?,'Informasi asli dan keputusan laporan tetap disimpan.' WHERE changes()>0`).bind(id('AUD'),timestamp,staff.email,report.report_id,JSON.stringify({event_id:eventId})),
    ]);
    if(!linked[0].meta.changes)throw new HttpError('Laporan atau kejadian sudah berubah. Muat ulang.',409);
    return json({ok:true});
  }
  if(action==='workspace'&&method==='GET') {
    const [reports,assessment,candidates,ratings,activities,followups,verification,ebsOptions]=await env.DB.batch<Record<string,unknown>>([
      env.DB.prepare(`SELECT r.report_id,r.reporter_id,COALESCE(c.name,r.reporter_name) reporter_name,r.submitted_at,r.description,r.location_text,r.village_code,
        r.reported_cases,r.reported_cases_known,r.reported_deaths,r.reported_deaths_known,r.workflow_status,r.event_start_date,v.status validation_status,
        COALESCE(q.quality,s.quality) quality,COALESCE(q.timeliness,s.timeliness) timeliness,COALESCE(q.completeness,s.completeness) completeness,COALESCE(q.notes,s.notes) quality_notes,
        (SELECT COUNT(*) FROM sbm_clarifications q WHERE q.report_id=r.report_id AND q.answered_at IS NULL) pending_clarifications
        FROM reports r LEFT JOIN reporters c ON c.reporter_id=r.reporter_id LEFT JOIN report_validations v ON v.report_id=r.report_id LEFT JOIN sbm_report_quality q ON q.report_id=r.report_id LEFT JOIN sbm_screenings s ON s.report_id=r.report_id WHERE r.event_id=? ORDER BY r.submitted_at`).bind(eventId),
      env.DB.prepare('SELECT * FROM sbm_event_assessments WHERE event_id=?').bind(eventId),
      env.DB.prepare(`SELECT r.reporter_id,r.name,r.village_code,p.name posyandu FROM reporters r LEFT JOIN posyandu p ON p.posyandu_id=r.posyandu_id WHERE r.active=1 ORDER BY r.village_code,p.name,r.name`),
      env.DB.prepare('SELECT * FROM sbm_event_candidates WHERE event_id=?').bind(eventId),
      env.DB.prepare(`SELECT a.*,(SELECT group_concat(report_id) FROM sbm_activity_reports l WHERE l.activity_id=a.activity_id) report_ids FROM sbm_activities a WHERE a.event_id=? OR
        (a.event_id IS NULL AND EXISTS(SELECT 1 FROM sbm_activity_reports l JOIN reports r ON r.report_id=l.report_id WHERE l.activity_id=a.activity_id AND r.event_id=?)) ORDER BY activity_date DESC`).bind(eventId,eventId),
      env.DB.prepare('SELECT * FROM sbm_event_followups WHERE event_id=? ORDER BY created_at DESC').bind(eventId),
      env.DB.prepare('SELECT * FROM sbm_incident_verifications WHERE event_id=?').bind(eventId),
      env.DB.prepare('SELECT ebs_id,disease_name FROM ebs_disease_master WHERE active=1 ORDER BY sort_order'),
    ]);
    const history=new Map((await cadrePerformance(env)).map(row=>[row.reporter_id,row]));
    const ratingMap=new Map(ratings.results.map(row=>[row.reporter_id,row]));
    const assessed=assessment.results[0]||null;
    return json({event,assessment:assessed,needs_reassessment:!assessed||assessed.source_revision!==event.source_revision,
      reports:reports.results,activities:activities.results,followups:followups.results,verification:verification.results[0]||null,ebs_options:ebsOptions.results,score_version:CADRE_SCORE_VERSION,
      candidates:candidates.results.map(c=>{const performance=history.get(String(c.reporter_id))!;
        const rating=ratingMap.get(c.reporter_id) as {understanding:number|null;support:number|null;available:string}|undefined;
        return {...c,...performance,assessment:rating||null,...selectionScore(performance.performance_score,rating||null)};})});
  }
  if(action==='verification'&&method==='POST') {
    if(event.origin!=='SIGNAL')throw new HttpError('Kejadian sudah terverifikasi.',409);
    const data=await body(request),revision=data.source_revision;
    if(typeof revision!=='number'||revision!==event.source_revision)throw new HttpError('Sumber sinyal berubah. Tinjau kembali sebelum verifikasi.',409);
    const assessment=await env.DB.prepare('SELECT * FROM sbm_event_assessments WHERE event_id=?').bind(eventId).first<Record<string,unknown>>();
    if(!assessment||assessment.source_revision!==revision||!['FIELD','REMOTE'].includes(String(assessment.decision)))throw new HttpError('Tetapkan metode verifikasi sinyal terlebih dahulu.',409);
    const eligible=await env.DB.prepare(`SELECT COUNT(*) count FROM reports r WHERE event_id=? AND
      (NOT EXISTS(SELECT 1 FROM report_validations v WHERE v.report_id=r.report_id AND v.status='VALID') OR EXISTS(SELECT 1 FROM sbm_clarifications c WHERE c.report_id=r.report_id AND answered_at IS NULL))`).bind(eventId).first<{count:number}>();
    if(eligible?.count)throw new HttpError('Semua sumber harus valid dan klarifikasi harus selesai.',409);
    const planned=await env.DB.prepare(`SELECT 1 FROM sbm_activities a WHERE status='PLANNED' AND (event_id=? OR
      (event_id IS NULL AND EXISTS(SELECT 1 FROM sbm_activity_reports l JOIN reports r ON r.report_id=l.report_id WHERE l.activity_id=a.activity_id AND r.event_id=?)))`).bind(eventId,eventId).first();
    if(planned)throw new HttpError('Catat pelaksanaan atau batalkan rencana kegiatan terlebih dahulu.',409);
    const evidence=assessment.decision==='FIELD'
      ?await env.DB.prepare(`SELECT 1 FROM sbm_activities WHERE event_id=? AND status='DONE' AND officer_attended=1 AND json_extract(selection_snapshot,'$.event_assessment.source_revision')=?`).bind(eventId,revision).first()
      :await env.DB.prepare('SELECT 1 FROM sbm_event_followups WHERE event_id=? AND source_revision=?').bind(eventId,revision).first();
    if(!evidence)throw new HttpError('Catat hasil konfirmasi kontak atau pelaksanaan lapangan untuk sumber sinyal saat ini.',409);
    const methodLabel=required(data.verification_method,'Metode verifikasi',100),result=required(data.result,'Hasil dan dasar verifikasi',2000),ebsId=clean(data.verified_ebs_id,20);
    if(!await validMaster(env,'ebs_disease_master','ebs_id',ebsId))throw new HttpError('Pilih klasifikasi EBS terverifikasi.');
    for(const key of ['verified_cases','verified_deaths','verified_severe_cases'])if(data[key]==null||String(data[key]).trim()==='')throw new HttpError('Isi jumlah aktual, termasuk 0 bila tidak ada.');
    const cases=integer(data.verified_cases,'Jumlah aktual'),deaths=integer(data.verified_deaths,'Meninggal aktual'),severe=integer(data.verified_severe_cases,'Kasus berat aktual');
    if(deaths>cases||severe>cases)throw new HttpError('Jumlah meninggal atau kasus berat tidak boleh melebihi jumlah aktual.');
    const timestamp=now();
    const saved=await env.DB.batch([
      env.DB.prepare(`UPDATE events SET origin='CONFIRMED',verified_source_revision=?,verified_cases=?,verified_deaths=?,verified_severe_cases=?,epidemiological_summary=?,current_status='AKTIF',updated_at=?,updated_by=?
        WHERE event_id=? AND origin='SIGNAL' AND source_revision=? AND current_status NOT IN ('SELESAI','DIBATALKAN')
        AND EXISTS(SELECT 1 FROM sbm_event_assessments s WHERE s.event_id=events.event_id AND s.source_revision=events.source_revision AND s.decision=? AND s.updated_at=?)
        AND NOT EXISTS(SELECT 1 FROM reports r LEFT JOIN report_validations v ON v.report_id=r.report_id WHERE r.event_id=events.event_id AND (v.status IS NULL OR v.status<>'VALID'))
        AND NOT EXISTS(SELECT 1 FROM sbm_clarifications c JOIN reports r ON r.report_id=c.report_id WHERE r.event_id=events.event_id AND c.answered_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM sbm_activities a WHERE a.event_id=events.event_id AND a.status='PLANNED')`).bind(revision,cases,deaths,severe,result,timestamp,staff.email,eventId,revision,assessment.decision,assessment.updated_at),
      env.DB.prepare(`INSERT INTO sbm_incident_verifications(event_id,source_revision,verification_method,result,verified_ebs_id,verified_by,verified_at)
        SELECT ?,?,?,?,?,?,? WHERE changes()>0`).bind(eventId,revision,methodLabel,result,ebsId,staff.email,timestamp),
      env.DB.prepare(`INSERT INTO audit_log(audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes)
        SELECT ?,?,?,'CONFIRM_SIGNAL_AS_INCIDENT','EVENT',?,'{"origin":"SIGNAL"}',?,? WHERE changes()>0`).bind(id('AUD'),timestamp,staff.email,eventId,JSON.stringify({source_revision:revision,verified_cases:cases,verified_ebs_id:ebsId}),result),
      env.DB.prepare(`INSERT INTO status_history(history_id,entity_type,entity_id,old_status,new_status,changed_at,changed_by,notes)
        SELECT ?,'EVENT',?,'SIGNAL','CONFIRMED',?,?,? WHERE EXISTS(SELECT 1 FROM sbm_incident_verifications WHERE event_id=? AND verified_at=?)`).bind(id('HIS'),eventId,timestamp,staff.email,result,eventId,timestamp),
    ]);
    if(!saved[0].meta.changes)throw new HttpError('Sinyal sudah berubah atau terverifikasi. Muat ulang.',409);
    return json({ok:true,event_id:eventId});
  }
  if(action.startsWith('report-quality/')&&method==='PUT') {
    const report=await getReport(env,decodeURIComponent(match[4])),data=await body(request);
    if(report.event_id!==eventId)throw new HttpError('Laporan bukan sumber kejadian ini.');
    const grade={quality:choice(data.quality,['VALID','REASONABLE','INCOMPLETE','ABUSIVE']),timeliness:choice(data.timeliness,['TIMELY','LATE','UNKNOWN']),completeness:choice(data.completeness,['COMPLETE','PARTIAL','UNKNOWN']),notes:required(data.notes,'Alasan penilaian laporan')};
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO sbm_report_quality(report_id,quality,timeliness,completeness,notes,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(report_id) DO UPDATE SET quality=excluded.quality,timeliness=excluded.timeliness,completeness=excluded.completeness,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(report.report_id,grade.quality,grade.timeliness,grade.completeness,grade.notes,staff.email,now()),
      auditStatement(env,staff.email,'ASSESS_SOURCE_CONTRIBUTION','REPORT',String(report.report_id),{},grade),
    ]);return json({ok:true});
  }
  if(action==='followups'&&method==='POST') {
    const data=await body(request),methodLabel=required(data.method,'Metode tindak lanjut',100),result=required(data.result,'Hasil tindak lanjut',2000);
    const assessment=await env.DB.prepare('SELECT * FROM sbm_event_assessments WHERE event_id=?').bind(eventId).first<Record<string,unknown>>();
    if(!assessment||assessment.source_revision!==event.source_revision)throw new HttpError('Nilai informasi gabungan kejadian sebelum mencatat tindak lanjut.',409);
    const followupId=id('FUP');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO sbm_event_followups(followup_id,event_id,method,result,created_by,created_at,source_revision) VALUES(?,?,?,?,?,?,?)').bind(followupId,eventId,methodLabel,result,staff.email,now(),event.source_revision),
      auditStatement(env,staff.email,'EVENT_FOLLOWUP','EVENT',eventId,{}, {followup_id:followupId,method:methodLabel,result}),
    ]);
    return json({followup_id:followupId},201);
  }
  if(action==='assessment'&&method==='PUT') {
    const data=await body(request),decision=choice(data.decision,['CLARIFY','REMOTE','FIELD','CLOSE']),priority=choice(data.priority,['RENDAH','SEDANG','TINGGI']),notes=required(data.notes,'Alasan penilaian',2000);
    const revision=data.source_revision;
    if(['FIELD','REMOTE'].includes(decision)) {
      const sources=await env.DB.prepare('SELECT report_id FROM reports WHERE event_id=?').bind(eventId).all<{report_id:string}>();
      for(const r of sources.results)await requireValidReport(env,r.report_id);
      if(await env.DB.prepare('SELECT 1 FROM sbm_clarifications c JOIN reports r ON r.report_id=c.report_id WHERE r.event_id=? AND c.answered_at IS NULL').bind(eventId).first())throw new HttpError('Selesaikan klarifikasi sebelum verifikasi.',409);
    }
    if(typeof revision!=='number'||revision!==event.source_revision)throw new HttpError('Laporan sumber berubah. Muat ulang dan tinjau informasi gabungan.',409);
    if(decision==='FIELD'&&!event.village_code)throw new HttpError('Tetapkan kejadian dengan desa kegiatan yang jelas sebelum verifikasi lapangan.');
    const planned=await env.DB.prepare(`SELECT 1 FROM sbm_activities a WHERE status='PLANNED' AND (event_id=? OR (event_id IS NULL AND EXISTS(SELECT 1 FROM sbm_activity_reports l JOIN reports r ON r.report_id=l.report_id WHERE l.activity_id=a.activity_id AND r.event_id=?)))`).bind(eventId,eventId).first();
    if(planned&&decision!=='FIELD')throw new HttpError('Batalkan rencana lapangan terlebih dahulu sebelum mengubah tindak lanjut.',409);
    const timestamp=now();
    const saved=await env.DB.batch([
      env.DB.prepare(`INSERT INTO sbm_event_assessments(event_id,decision,priority,notes,source_revision,updated_by,updated_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND source_revision=? AND current_status NOT IN ('SELESAI','DIBATALKAN'))
        ON CONFLICT(event_id) DO UPDATE SET decision=excluded.decision,priority=excluded.priority,notes=excluded.notes,source_revision=excluded.source_revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(eventId,decision,priority,notes,revision,staff.email,timestamp,eventId,revision),
      env.DB.prepare(`UPDATE events SET risk_level=?,risk_notes=?,current_status=?,closed_at=?,updated_by=?,updated_at=?
        WHERE event_id=? AND EXISTS(SELECT 1 FROM sbm_event_assessments WHERE event_id=? AND updated_at=? AND source_revision=events.source_revision)`).bind(priority,notes,decision==='CLOSE'?'SELESAI':'AKTIF',decision==='CLOSE'?timestamp:null,staff.email,timestamp,eventId,eventId,timestamp),
      env.DB.prepare(`INSERT INTO status_history(history_id,entity_type,entity_id,old_status,new_status,changed_at,changed_by,notes)
        SELECT ?,'EVENT',?,?,?,?,?,? WHERE changes()>0`).bind(id('HIS'),eventId,event.current_status,decision==='CLOSE'?'SELESAI':'AKTIF',timestamp,staff.email,notes),
      env.DB.prepare(`INSERT INTO audit_log(audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes)
        SELECT ?,?,?,'ASSESS_EVENT','EVENT',?,'{}',?,? WHERE changes()>0`).bind(id('AUD'),timestamp,staff.email,eventId,JSON.stringify({decision,priority,source_revision:revision}),notes),
    ]);
    if(!saved[0].meta.changes)throw new HttpError('Kejadian telah berubah. Muat ulang.',409);
    return json({ok:true});
  }
  if(action.startsWith('candidates/')&&method==='PUT') {
    const reporterId=decodeURIComponent(match[3]),data=await body(request);
    if(!await env.DB.prepare('SELECT 1 FROM reporters WHERE reporter_id=? AND active=1').bind(reporterId).first())throw new HttpError('Pilih kader aktif.');
    const points=(v:unknown)=>{if(v===null)return null;if(typeof v!=='number'||![0,12.5,25].includes(v))throw new HttpError('Nilai kesesuaian tidak valid.');return v;};
    const rating={understanding:points(data.understanding),support:points(data.support),available:choice(data.available,['UNKNOWN','YES','NO'])};
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO sbm_event_candidates(event_id,reporter_id,understanding,support,available,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(event_id,reporter_id) DO UPDATE SET understanding=excluded.understanding,support=excluded.support,available=excluded.available,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(eventId,reporterId,rating.understanding,rating.support,rating.available,staff.email,now()),
      auditStatement(env,staff.email,'ASSESS_EVENT_CANDIDATE','EVENT',eventId,{}, {reporter_id:reporterId,...rating}),
    ]);
    const history=(await cadrePerformance(env,reporterId))[0];return json({...history,assessment:rating,...selectionScore(history.performance_score,rating)});
  }
  throw new HttpError('Endpoint kejadian tidak ditemukan.',404);
}

export async function eventActivitySource(env:Env,eventId:string,reporterId:string) {
  const event=await eventRecord(env,eventId,true);
  const assessment=await env.DB.prepare('SELECT * FROM sbm_event_assessments WHERE event_id=?').bind(eventId).first<Record<string,unknown>>();
  if(!assessment||assessment.decision!=='FIELD'||assessment.source_revision!==event.source_revision)throw new HttpError('Nilai informasi gabungan kejadian dan pilih verifikasi lapangan terlebih dahulu.',409);
  const reports=await env.DB.prepare('SELECT report_id FROM reports WHERE event_id=? ORDER BY report_id').bind(eventId).all<{report_id:string}>();
  if(!reports.results.length)throw new HttpError('Kejadian belum memiliki laporan sumber.');
  for(const source of reports.results)await requireValidReport(env,source.report_id);
  if(await env.DB.prepare('SELECT 1 FROM sbm_clarifications c JOIN reports r ON r.report_id=c.report_id WHERE r.event_id=? AND c.answered_at IS NULL').bind(eventId).first())throw new HttpError('Selesaikan klarifikasi sebelum merencanakan verifikasi.',409);
  const rating=await env.DB.prepare('SELECT * FROM sbm_event_candidates WHERE event_id=? AND reporter_id=?').bind(eventId,reporterId).first<{understanding:number|null;support:number|null;available:string;updated_at:string}>();
  const history=(await cadrePerformance(env,reporterId))[0],score=selectionScore(history.performance_score,rating);
  if(!score.eligible)throw new HttpError('Konfirmasi kesesuaian dan kesediaan kader untuk kejadian ini.');
  const existing=await env.DB.prepare(`SELECT 1 FROM sbm_activities a WHERE status='PLANNED' AND (event_id=? OR
    (event_id IS NULL AND EXISTS(SELECT 1 FROM sbm_activity_reports l JOIN reports r ON r.report_id=l.report_id WHERE l.activity_id=a.activity_id AND r.event_id=?)))`).bind(eventId,eventId).first();
  if(existing)throw new HttpError('Kejadian ini sudah mempunyai rencana verifikasi. Buka kegiatan tersebut.',409);
  return {event,reportIds:reports.results.map(r=>r.report_id),snapshot:{score_version:CADRE_SCORE_VERSION,event_id:eventId,event_assessment:assessment,assessment:rating,history,...score}};
}
