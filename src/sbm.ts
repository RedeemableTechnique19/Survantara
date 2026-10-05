import { auditStatement, getReport, id, now } from './db';
import { body, HttpError, json } from './http';
import { bool, clean, multiline } from './validation';
import type { Env, Session, StaffSession } from './types';
import { CADRE_SCORE_VERSION, cadrePerformance, cadreQuality, selectionScore } from './cadre-scoring';
import { eventActivitySource, handleEventWorkflow } from './event-workflow';
import { requireValidReport } from './report-assessment';

import { canManageSurveillance, allowanceAmount } from './deployment';
function owner(env: Env, session: Session | null): StaffSession {
  if (session?.kind !== 'staff') throw new HttpError('Masuk sebagai pengelola surveilans.', 401);
  if (!canManageSurveillance(env, session)) throw new HttpError('Hanya pengelola surveilans yang dapat mengakses kegiatan ini.', 403);
  return session;
}
function choice(value: unknown, allowed: string[]): string {
  const result = clean(value, 30);
  if (!allowed.includes(result)) throw new HttpError('Pilihan tidak valid.');
  return result;
}
function required(value: unknown, label: string, max = 1000): string {
  const result = multiline(value, max);
  if (!result) throw new HttpError(`${label} wajib diisi.`);
  return result;
}
function activityDate(value: unknown): string {
  const result = clean(value, 10);
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new HttpError('Tanggal kegiatan tidak valid.');
  return result;
}
export async function handleSbm(request: Request, env: Env, session: Session | null): Promise<Response> {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if(path==='/api/sbm/my-statistics'&&method==='GET') {
    if(session?.kind!=='cadre')throw new HttpError('Masuk sebagai kader.',401);
    const timestamp=now();
    // Count source reports separately from distinct confirmed incidents. Four
    // reports of one incident must not become four incidents on a shared card.
    const [stats,quality]=await Promise.all([env.DB.prepare(`WITH period AS (SELECT datetime(?,'-6 months') start,? end)
      SELECT period.start period_start,period.end period_end,COUNT(r.report_id) total,
        COALESCE(SUM(CASE WHEN r.workflow_status='CLOSED' THEN 1 ELSE 0 END),0) reviewed,
        COALESCE(SUM(CASE WHEN e.origin='CONFIRMED' THEN 1 ELSE 0 END),0) incident_source_reports,
        COUNT(DISTINCT CASE WHEN e.origin='CONFIRMED' THEN e.event_id END) incidents
      FROM period LEFT JOIN reports r ON r.reporter_id=?
        AND julianday(r.submitted_at)>=julianday(period.start) AND julianday(r.submitted_at)<=julianday(period.end)
      LEFT JOIN events e ON e.event_id=r.event_id`)
      .bind(timestamp,timestamp,session.reporterId).first<{period_start:string;period_end:string;total:number;reviewed:number;incident_source_reports:number;incidents:number}>(),cadreQuality(env,session.reporterId)]);
    if(!stats)throw new HttpError('Statistik belum dapat dimuat.',503);
    return json({period:{start:stats.period_start.replace(' ','T')+'Z',end:stats.period_end,months:6},
      counts:{total:stats.total,reviewed:stats.reviewed,incident_source_reports:stats.incident_source_reports,incidents:stats.incidents},quality,generated_at:timestamp});
  }
  if(path==='/api/sbm/my-score'&&method==='GET') {
    if(session?.kind!=='cadre')throw new HttpError('Masuk sebagai kader.',401);
    return json(await cadreQuality(env,session.reporterId));
  }
  if (path === '/api/sbm/mine' && method === 'GET') {
    if (session?.kind !== 'cadre') throw new HttpError('Masuk sebagai kader.', 401);
    const [activities, clarifications] = await env.DB.batch([
      env.DB.prepare(`SELECT activity_id,activity_date,village_code,location,status,result,cadre_attended,cadre_oh,payment_status
        FROM sbm_activities WHERE reporter_id=? ORDER BY activity_date DESC LIMIT 200`).bind(session.reporterId),
      env.DB.prepare(`SELECT c.clarification_id,c.report_id,c.question,c.answer,c.requested_at,c.answered_at,r.workflow_status
        FROM sbm_clarifications c JOIN reports r ON r.report_id=c.report_id
        WHERE c.reporter_id=? AND r.reporter_id=? ORDER BY c.requested_at DESC LIMIT 200`).bind(session.reporterId,session.reporterId),
    ]);
    return json({activities: activities.results, clarifications: clarifications.results});
  }
  const answerMatch = path.match(/^\/api\/sbm\/clarifications\/([^/]+)\/answer$/);
  if (answerMatch && method === 'POST') {
    if (session?.kind !== 'cadre') throw new HttpError('Masuk sebagai kader.', 401);
    const data = await body(request), answer = required(data.answer, 'Jawaban');
    const result = await env.DB.prepare(`UPDATE sbm_clarifications SET answer=?,answered_at=?,answered_by=?
      WHERE clarification_id=? AND reporter_id=? AND answered_at IS NULL
      AND EXISTS(SELECT 1 FROM reports r WHERE r.report_id=sbm_clarifications.report_id AND r.reporter_id=? AND r.workflow_status<>'CLOSED')`)
      .bind(answer, now(), session.reporterId, decodeURIComponent(answerMatch[1]), session.reporterId, session.reporterId).run();
    if (!result.meta.changes) throw new HttpError('Permintaan tidak ditemukan atau sudah dijawab.', 409);
    return json({ok:true});
  }
  const staff = owner(env, session);
  const eventResponse=await handleEventWorkflow(request,env,staff);
  if(eventResponse)return eventResponse;
  if (path === '/api/sbm/workspace' && method === 'GET') {
    const reportId = clean(url.searchParams.get('report_id'), 50);
    if(reportId) await getReport(env,reportId);
    const [screening, activities, candidates, clarifications, eligible, booked, assessments] = await env.DB.batch<Record<string,unknown>>([
      env.DB.prepare('SELECT * FROM sbm_screenings WHERE report_id=?').bind(reportId),
      env.DB.prepare(`SELECT a.*,(SELECT group_concat(report_id) FROM sbm_activity_reports WHERE activity_id=a.activity_id) report_ids
        FROM sbm_activities a WHERE (?='' OR EXISTS(SELECT 1 FROM sbm_activity_reports l WHERE l.activity_id=a.activity_id AND l.report_id=?)) ORDER BY activity_date DESC LIMIT 200`).bind(reportId,reportId),
      env.DB.prepare(`SELECT r.reporter_id,r.cadre_code,r.name,r.village_code,p.name posyandu,
        (SELECT COUNT(*) FROM reports t WHERE t.reporter_id=r.reporter_id AND t.submitted_at>=datetime('now','-6 months')) report_count,
        (SELECT COUNT(*) FROM reports t JOIN sbm_screenings s ON s.report_id=t.report_id WHERE t.reporter_id=r.reporter_id AND t.submitted_at>=datetime('now','-6 months') AND s.quality IN ('VALID','REASONABLE')) reasonable_reports,
        (SELECT COUNT(*) FROM sbm_activities a WHERE a.reporter_id=r.reporter_id AND a.cadre_oh>0 AND a.payment_status='PAID') paid_oh_count,
        (SELECT MAX(activity_date) FROM sbm_activities a WHERE a.reporter_id=r.reporter_id AND a.cadre_oh>0 AND a.payment_status='PAID') last_oh,
        (SELECT COUNT(*) FROM sbm_activities a WHERE a.reporter_id=r.reporter_id AND a.status='PLANNED') planned_count
        FROM reporters r LEFT JOIN posyandu p ON p.posyandu_id=r.posyandu_id WHERE r.active=1 ORDER BY r.village_code,p.name,r.name`),
      env.DB.prepare('SELECT * FROM sbm_clarifications WHERE report_id=? ORDER BY requested_at DESC').bind(reportId),
      env.DB.prepare(`SELECT r.report_id,r.description,r.village_code FROM reports r JOIN sbm_screenings s ON s.report_id=r.report_id WHERE s.decision='FOLLOW_UP' AND s.cadre_needed=1 AND r.current_status NOT IN ('SELESAI','DITOLAK','DUPLIKAT') ORDER BY r.submitted_at DESC LIMIT 200`),
      env.DB.prepare("SELECT activity_id,activity_date FROM sbm_activities WHERE officer_email=? AND status<>'CANCELLED'").bind(staff.email),
      env.DB.prepare('SELECT * FROM sbm_candidate_assessments WHERE report_id=?').bind(reportId),
    ]);
    const performance = new Map((await cadrePerformance(env)).map(row=>[row.reporter_id,row]));
    const ratings = new Map(assessments.results.map(row=>[row.reporter_id,row]));
    const scoredCandidates = candidates.results.map(row=>{
      const history = performance.get(String(row.reporter_id))!;
      const rating = ratings.get(row.reporter_id) as {understanding:number|null;support:number|null;available:string}|undefined;
      return {...row,...history,assessment:rating || null,...selectionScore(history.performance_score,rating || null)};
    });
    return json({score_version:CADRE_SCORE_VERSION,screening:screening.results[0] || null,activities:activities.results,candidates:scoredCandidates,clarifications:clarifications.results,eligible_reports:eligible.results,booked_dates:booked.results});
  }
  const assessmentMatch = path.match(/^\/api\/sbm\/reports\/([^/]+)\/candidates\/([^/]+)$/);
  if (assessmentMatch && method === 'PUT') {
    const report = await getReport(env,decodeURIComponent(assessmentMatch[1]));
    const reporterId=decodeURIComponent(assessmentMatch[2]), data=await body(request);
    const cadre=await env.DB.prepare('SELECT reporter_id FROM reporters WHERE reporter_id=? AND active=1').bind(reporterId).first();
    if (!cadre) throw new HttpError('Pilih kader aktif.');
    const points=(value:unknown):number|null=>{
      if (value===null) return null;
      if (typeof value!=='number' || ![0,12.5,25].includes(value)) throw new HttpError('Nilai kesesuaian harus 0, 12.5, 25, atau belum dinilai.');
      return value;
    };
    const assessment={understanding:points(data.understanding),support:points(data.support),available:choice(data.available,['UNKNOWN','YES','NO'])};
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO sbm_candidate_assessments(report_id,reporter_id,understanding,support,available,updated_by,updated_at)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(report_id,reporter_id) DO UPDATE SET understanding=excluded.understanding,support=excluded.support,available=excluded.available,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
        .bind(report.report_id,reporterId,assessment.understanding,assessment.support,assessment.available,staff.email,now()),
      auditStatement(env,staff.email,'SBM_CANDIDATE_ASSESSMENT','REPORT',String(report.report_id),{}, {reporter_id:reporterId,...assessment,score_version:CADRE_SCORE_VERSION}),
    ]);
    const history=(await cadrePerformance(env,reporterId))[0];
    return json({assessment,...history,...selectionScore(history.performance_score,assessment)});
  }
  const screeningMatch = path.match(/^\/api\/sbm\/reports\/([^/]+)\/screening$/);
  if (screeningMatch && method === 'POST') {
    const report = await getReport(env, decodeURIComponent(screeningMatch[1])), data = await body(request);
    const decision = choice(data.decision, ['FOLLOW_UP','CLARIFY','NOT_RELEVANT']);
    const quality = choice(data.quality, ['VALID','REASONABLE','INCOMPLETE','ABUSIVE']);
    const priority = choice(data.priority, ['RENDAH','SEDANG','TINGGI']);
    const timeliness = choice(data.timeliness,['TIMELY','LATE','UNKNOWN']), completeness = choice(data.completeness,['COMPLETE','PARTIAL','UNKNOWN']);
    const cadreNeeded = decision==='FOLLOW_UP' && bool(data.cadre_needed) ? 1 : 0;
    const notes = required(data.notes,'Alasan screening');
    const statements = [env.DB.prepare(`INSERT INTO sbm_screenings(report_id,decision,quality,priority,timeliness,completeness,cadre_needed,notes,updated_by,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(report_id) DO UPDATE SET decision=excluded.decision,quality=excluded.quality,priority=excluded.priority,timeliness=excluded.timeliness,completeness=excluded.completeness,cadre_needed=excluded.cadre_needed,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(report.report_id,decision,quality,priority,timeliness,completeness,cadreNeeded,notes,staff.email,now()),
      env.DB.prepare('UPDATE reports SET current_priority=?,updated_by=?,updated_at=? WHERE report_id=?').bind(priority,staff.email,now(),report.report_id),
      auditStatement(env,staff.email,'SBM_SCREENING','REPORT',String(report.report_id),{}, {decision,quality,priority,timeliness,completeness,cadre_needed:cadreNeeded,notes})];
    if (decision==='CLARIFY' && report.reporter_id) {
      if (report.workflow_status === 'CLOSED') throw new HttpError('Laporan sudah selesai.',409);
      statements.push(env.DB.prepare('INSERT INTO sbm_clarifications(clarification_id,report_id,reporter_id,question,requested_at,requested_by) VALUES(?,?,?,?,?,?)').bind(id('CLR'),report.report_id,report.reporter_id,required(data.question,'Pertanyaan klarifikasi'),now(),staff.email));
    }
    await env.DB.batch(statements);
    return json({ok:true});
  }
  if (path === '/api/sbm/activities' && method === 'POST') {
    const data=await body(request), day=activityDate(data.activity_date);
    if(data.event_id!==undefined) {
      const eventId=clean(data.event_id,50),reporterId=clean(data.reporter_id,60);
      const cadre=await env.DB.prepare('SELECT name FROM reporters WHERE reporter_id=? AND active=1').bind(reporterId).first<{name:string}>();
      if(!cadre)throw new HttpError('Pilih kader aktif.');
      const {event,reportIds,snapshot}=await eventActivitySource(env,eventId,reporterId);
      if(data.report_ids!==undefined||data.selection_report_id!==undefined)throw new HttpError('Laporan sumber mengikuti kejadian, tanpa laporan acuan terpisah.');
      const location=required(data.location,'Lokasi',300),reason=required(data.selection_reason,'Alasan pemilihan dan ketersediaan kader'),activityId=id('ACT'),timestamp=now();
      try {
        const saved=await env.DB.batch([
          env.DB.prepare(`INSERT INTO sbm_activities(activity_id,activity_date,village_code,location,officer_email,reporter_id,cadre_name,selection_reason,updated_at,selection_snapshot,event_id)
            SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events e JOIN sbm_event_assessments s ON s.event_id=e.event_id WHERE e.event_id=? AND e.source_revision=? AND s.source_revision=e.source_revision AND s.decision='FIELD' AND e.current_status NOT IN ('SELESAI','DIBATALKAN'))
            AND EXISTS(SELECT 1 FROM sbm_event_candidates c JOIN reporters r ON r.reporter_id=c.reporter_id WHERE c.event_id=? AND c.reporter_id=? AND c.available='YES' AND c.understanding>0 AND c.support>0 AND c.updated_at=? AND r.active=1)`).bind(activityId,day,event.village_code,location,staff.email,reporterId,cadre.name,reason,timestamp,JSON.stringify(snapshot),eventId,eventId,event.source_revision,eventId,reporterId,snapshot.assessment?.updated_at??null),
          ...reportIds.map(reportId=>env.DB.prepare('INSERT INTO sbm_activity_reports(activity_id,report_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM sbm_activities WHERE activity_id=?)').bind(activityId,reportId,activityId)),
          env.DB.prepare(`INSERT INTO audit_log(audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes)
            SELECT ?,?,?,'PLAN_EVENT_ACTIVITY','ACTIVITY',?,'{}',?,? WHERE EXISTS(SELECT 1 FROM sbm_activities WHERE activity_id=?)`).bind(id('AUD'),timestamp,staff.email,activityId,JSON.stringify({event_id:eventId,report_ids:reportIds,selection_snapshot:snapshot}),reason,activityId),
        ]);
        if(!saved[0].meta.changes)throw new HttpError('Kejadian berubah. Muat ulang dan nilai kembali informasi gabungan.',409);
      }catch(error){if(String(error).includes('UNIQUE constraint'))throw new HttpError('Kejadian sudah dijadwalkan, atau petugas/kader sudah mempunyai kegiatan pada tanggal itu.',409);throw error;}
      return json({activity_id:activityId,event_id:eventId},201);
    }
    const reportIds=Array.isArray(data.report_ids) ? [...new Set(data.report_ids.map(v=>clean(v,50)))] : [];
    if (!reportIds.length || reportIds.length>30) throw new HttpError('Pilih 1–30 laporan untuk kegiatan.');
    const village=clean(data.village_code,50), reporterId=clean(data.reporter_id,60);
    const cadre=await env.DB.prepare('SELECT name,village_code FROM reporters WHERE reporter_id=? AND active=1').bind(reporterId).first<{name:string;village_code:string}>();
    if (!cadre) throw new HttpError('Pilih kader aktif.');
    const reports=await env.DB.prepare(`SELECT r.report_id,r.event_id,r.village_code,s.decision,s.cadre_needed FROM reports r LEFT JOIN sbm_screenings s ON s.report_id=r.report_id WHERE r.report_id IN (${reportIds.map(()=>'?').join(',')})`).bind(...reportIds).all<{report_id:string;event_id:string|null;village_code:string;decision:string;cadre_needed:number}>();
    if(reports.results.some(r=>r.event_id))throw new HttpError('Laporan sudah dikelompokkan. Rencanakan kegiatan melalui penilaian kejadian.',409);
    for(const reportId of reportIds)await requireValidReport(env,reportId);
    if(reports.results.length!==reportIds.length || reports.results.some(r=>r.decision!=='FOLLOW_UP'||!r.cadre_needed||r.village_code!==village)) throw new HttpError('Semua laporan harus lolos screening, memerlukan kader, dan berada di desa kegiatan.');
    const activityId=id('ACT');
    const item={activity_date:day,reporter_id:reporterId,village_code:village,location:required(data.location,'Lokasi',300),selection_reason:required(data.selection_reason,'Alasan pemilihan dan ketersediaan kader')};
    let snapshot:Record<string,unknown>|null=null;
    if(data.selection_report_id!==undefined) {
      const source=clean(data.selection_report_id,50);
      if(!reportIds.includes(source)) throw new HttpError('Laporan penilaian harus termasuk laporan kegiatan.');
      const rating=await env.DB.prepare('SELECT understanding,support,available,updated_at,updated_by FROM sbm_candidate_assessments WHERE report_id=? AND reporter_id=?').bind(source,reporterId).first<{understanding:number|null;support:number|null;available:string;updated_at:string;updated_by:string}>();
      const history=(await cadrePerformance(env,reporterId))[0];
      const score=selectionScore(history.performance_score,rating);
      if(!score.eligible) throw new HttpError('Konfirmasi kesediaan dan kesesuaian kader sebelum menyimpan kegiatan.');
      snapshot={score_version:CADRE_SCORE_VERSION,report_id:source,assessment:rating,history,...score};
    }
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO sbm_activities(activity_id,activity_date,village_code,location,officer_email,reporter_id,cadre_name,selection_reason,updated_at,selection_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(activityId,day,village,item.location,staff.email,reporterId,cadre.name,item.selection_reason,now(),snapshot?JSON.stringify(snapshot):''),
        ...reportIds.map(reportId=>env.DB.prepare('INSERT INTO sbm_activity_reports(activity_id,report_id) VALUES(?,?)').bind(activityId,reportId)),
        auditStatement(env,staff.email,'SBM_PLAN','ACTIVITY',activityId,{}, {...item,report_ids:reportIds,selection_snapshot:snapshot}),
      ]);
    } catch(error) {
      if(String(error).includes('UNIQUE constraint')) throw new HttpError('Petugas atau kader sudah memiliki kegiatan Survantara pada tanggal tersebut.',409);
      throw error;
    }
    return json({activity_id:activityId},201);
  }
  const activityMatch=path.match(/^\/api\/sbm\/activities\/([^/]+)$/);
  if(activityMatch && method==='PATCH') {
    const activityId=decodeURIComponent(activityMatch[1]);
    const before=await env.DB.prepare('SELECT * FROM sbm_activities WHERE activity_id=?').bind(activityId).first<Record<string,unknown>>();
    if(!before) throw new HttpError('Kegiatan tidak ditemukan.',404);
    const data=await body(request), status=choice(data.status,['DONE','CANCELLED']);
    if(before.status!=='PLANNED') throw new HttpError('Kegiatan sudah selesai atau dibatalkan.',409);
    if(status==='DONE' && String(before.activity_date)>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'})) throw new HttpError('Kegiatan yang belum berlangsung tidak dapat diselesaikan.');
    const result=required(data.result,status==='DONE'?'Hasil kegiatan':'Alasan pembatalan');
    const officerAttended=status==='DONE'&&bool(data.officer_attended)?1:0,cadreAttended=status==='DONE'&&bool(data.cadre_attended)?1:0;
    const peRequired=status==='DONE'&&bool(data.pe_required)?1:0,peReference=clean(data.pe_reference,200);
    const updated=await env.DB.prepare("UPDATE sbm_activities SET status=?,result=?,officer_attended=?,cadre_attended=?,pe_required=?,pe_reference=?,updated_at=? WHERE activity_id=? AND status='PLANNED'").bind(status,result,officerAttended,cadreAttended,peRequired,peReference,now(),activityId).run();
    if(!updated.meta.changes) throw new HttpError('Kegiatan telah diperbarui. Muat ulang.',409);
    await auditStatement(env,staff.email,'SBM_COMPLETE','ACTIVITY',activityId,before,{status,result,officerAttended,cadreAttended,peRequired,peReference}).run();
    return json({ok:true});
  }
  const paymentMatch=path.match(/^\/api\/sbm\/activities\/([^/]+)\/payment$/);
  if(paymentMatch && method==='POST') {
    const activityId=decodeURIComponent(paymentMatch[1]),data=await body(request);
    const payment=choice(data.payment_status,['APPROVED','PAID']);
    const reference=payment==='PAID'?required(data.payment_reference,'Referensi pembayaran',200):'';
    const expected=payment==='APPROVED'?'PENDING':'APPROVED';
    const update=await env.DB.prepare(`UPDATE sbm_activities SET officer_oh=CASE WHEN payment_status='PENDING' THEN officer_attended*? ELSE officer_oh END,cadre_oh=CASE WHEN payment_status='PENDING' THEN cadre_attended*? ELSE cadre_oh END,payment_status=?,payment_reference=?,updated_at=? WHERE activity_id=? AND status='DONE' AND payment_status=? AND (officer_attended+cadre_attended)>0`).bind(allowanceAmount(env),allowanceAmount(env),payment,reference,now(),activityId,expected).run();
    if(!update.meta.changes) throw new HttpError('OH memerlukan kegiatan selesai, peserta hadir, serta persetujuan sebelum pembayaran.',409);
    await auditStatement(env,staff.email,'SBM_OH','ACTIVITY',activityId,{payment_status:expected},{payment_status:payment,payment_reference:reference}).run();
    return json({ok:true});
  }
  const peMatch=path.match(/^\/api\/sbm\/activities\/([^/]+)\/pe$/);
  if(peMatch && method==='POST') {
    const activityId=decodeURIComponent(peMatch[1]),data=await body(request);
    const reference=required(data.pe_reference,'Referensi PE',200);
    const updated=await env.DB.prepare("UPDATE sbm_activities SET pe_reference=?,updated_at=? WHERE activity_id=? AND status='DONE' AND pe_required=1").bind(reference,now(),activityId).run();
    if(!updated.meta.changes) throw new HttpError('Kegiatan tidak memerlukan PE atau belum selesai.',409);
    await auditStatement(env,staff.email,'SBM_PE_REFERENCE','ACTIVITY',activityId,{}, {pe_reference:reference}).run();
    return json({ok:true});
  }
  throw new HttpError('Endpoint SBM tidak ditemukan.',404);
}
