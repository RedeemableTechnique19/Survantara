import { getReport, id, now, auditStatement, validMaster } from './db';
import { body, HttpError, json } from './http';
import { canAccessReport, requireCadre, requireStaff, safeReport } from './session';
import { clean, date, integer, likePattern, multiline } from './validation';
import type { Env, Report, Session } from './types';
import { requireValidReport, reportAssessment } from './report-assessment';

const STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_CLARIFICATION', 'CLOSED'];
const FIELDS = ['report_id','reporter_id','submission_channel','reporter_name','reporter_phone','allow_contact',
  'village_code','location_text','event_start_date','reported_cases','reported_cases_known','reported_deaths',
  'reported_deaths_known','description','latitude','longitude','attachment_key','event_type','event_type_label',
  'workflow_status','submitted_at','village_name','posyandu_name','reporter_village','observation_labels'];
const DETAIL_FIELDS = ['affected_group','severe_cases','severe_cases_known','hospitalized_cases','hospitalized_cases_known','initial_action','context_labels'];
// The report inbox tracks reviews; incident workload has its own dashboard count.
export const activeEbsWork = (alias = 'r'): string => `${alias}.workflow_status<>'CLOSED'`;
function publicFields(report: Report, detail = false): Report {
  return Object.fromEntries([...FIELDS,...(detail ? DETAIL_FIELDS : [])].map(key => [key, report[key] ?? null]));
}
export async function handleEbs(request: Request, env: Env, session: Session | null): Promise<Response> {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (path === '/api/ebs/reports' && method === 'GET') {
    const staff = requireStaff(session, 'REPORT_READ');
    const clauses: string[] = [], values: unknown[] = [];
    if (staff.role === 'VERIFIKATOR') { clauses.push('r.assigned_to=?'); values.push(staff.email); }
    if (staff.role === 'PETUGAS_PROGRAM') { clauses.push('r.event_id IN (SELECT event_id FROM events WHERE program_owner=?)'); values.push(staff.program || ''); }
    const status = clean(url.searchParams.get('status'), 30);
    if (status && !STATUSES.includes(status)) throw new HttpError('Status laporan tidak valid.');
    if (url.searchParams.get('view') !== 'all') clauses.push(activeEbsWork());
    if (status === 'UNDER_REVIEW') clauses.push("r.workflow_status IN ('UNDER_REVIEW','NEEDS_CLARIFICATION')");
    else if (status) { clauses.push('r.workflow_status=?'); values.push(status); }
    for (const key of ['village_code','event_type']) {
      const value = clean(url.searchParams.get(key), 60);
      if (value) { clauses.push(`r.${key}=?`); values.push(value); }
    }
    const from = date(url.searchParams.get('date_from')), to = date(url.searchParams.get('date_to'));
    if (from && to && from > to) throw new HttpError('Rentang tanggal tidak valid.');
    // Date filters use the service's Asia/Jakarta calendar day.
    if (from) { clauses.push('r.submitted_at>=?'); values.push(new Date(`${from}T00:00:00+07:00`).toISOString()); }
    if (to) { clauses.push('r.submitted_at<?'); values.push(new Date(Date.parse(`${to}T00:00:00+07:00`) + 86400000).toISOString()); }
    const query = clean(url.searchParams.get('q'), 100);
    if (query) {
      // Preserve existing identity masking for leadership/viewer roles.
      const sensitive = !['VIEWER','PIMPINAN'].includes(staff.role);
      clauses.push(sensitive ? "(r.report_id LIKE ? ESCAPE '\\' OR r.reporter_name LIKE ? ESCAPE '\\' OR r.location_text LIKE ? ESCAPE '\\')" : "r.report_id LIKE ? ESCAPE '\\'");
      values.push(...Array(sensitive ? 3 : 1).fill(likePattern(query)));
    }
    const offset = Number(url.searchParams.get('offset') || 0), requestedLimit = Number(url.searchParams.get('limit') || 50);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(requestedLimit) || requestedLimit < 1) throw new HttpError('Parameter halaman tidak valid.');
    const limit = Math.min(requestedLimit, 100);
    const sort = url.searchParams.get('sort') || 'newest';
    if (!['newest','oldest'].includes(sort)) throw new HttpError('Urutan tidak valid.');
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [rows, count] = await env.DB.batch([
      env.DB.prepare(`SELECT r.*,v.village_name,t.public_label event_type_label,
        r.current_status handling_status,u.name assigned_name,e.current_status event_status,d.outcome decision_result,
        (SELECT COUNT(*) FROM sbm_clarifications c WHERE c.report_id=r.report_id AND c.answered_at IS NULL) pending_clarifications,
        (SELECT program_owner FROM events e WHERE e.event_id=r.event_id) program_owner,
        (SELECT group_concat(m.public_label,', ') FROM report_observations o JOIN observation_master m ON m.observation_code=o.observation_code WHERE o.report_id=r.report_id) observation_labels
        FROM reports r LEFT JOIN villages v ON v.village_code=r.village_code LEFT JOIN event_type_master t ON t.event_type=r.event_type
        LEFT JOIN users u ON u.email=r.assigned_to LEFT JOIN events e ON e.event_id=r.event_id
        LEFT JOIN report_decisions d ON d.report_id=r.report_id
        ${where} ORDER BY r.submitted_at ${sort === 'oldest' ? 'ASC' : 'DESC'},r.report_id ${sort === 'oldest' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`).bind(...values, limit, offset),
      env.DB.prepare(`SELECT COUNT(*) count FROM reports r ${where}`).bind(...values),
    ]);
    return json({rows: (rows.results as Report[]).map(r => ({...publicFields(safeReport(r, staff.role)),
      handling_status:r.handling_status,event_status:r.event_status,assigned_name:r.assigned_name,
      event_id:r.event_id,verified_ebs_id:r.verified_ebs_id,pending_clarifications:r.pending_clarifications,decision_result:r.decision_result,
      can_open_detail:canAccessReport(staff,r)})),
      total:Number((count.results[0] as {count:number} | undefined)?.count || 0),offset,limit});
  }
  const match = path.match(/^\/api\/ebs\/reports\/([^/]+)(?:\/(status|clarifications|start-verification|review|decision|validation|quality))?$/);
  if (!match) throw new HttpError('Endpoint EBS tidak ditemukan.', 404);
  if (session?.kind !== 'cadre') requireStaff(session, method === 'GET' ? 'REPORT_READ' : 'REPORT_VERIFY');
  const reportId = decodeURIComponent(match[1]), action = match[2];
  const report = await getReport(env, reportId);
  const cadre = session?.kind === 'cadre';
  if (cadre) {
    if (report.reporter_id !== requireCadre(session).reporterId) throw new HttpError('Laporan tidak ditemukan.',404);
    if (method !== 'GET' || action) throw new HttpError('Kader tidak dapat mengubah workflow laporan.',403);
  } else {
    const staff = requireStaff(session, method === 'GET' ? 'REPORT_READ' : 'REPORT_VERIFY');
    if (!canAccessReport(staff,report)) throw new HttpError('Anda tidak berwenang mengakses laporan ini.',403);
  }
  if (method === 'GET' && !action) {
    const [history, clarifications, context, decision] = await env.DB.batch([
      env.DB.prepare(`SELECT h.old_status,h.new_status,h.changed_at,h.notes,COALESCE(u.name,c.name,h.changed_by) actor
        FROM status_history h LEFT JOIN users u ON u.email=h.changed_by LEFT JOIN reporters c ON c.reporter_id=h.changed_by OR 'CADRE:'||c.cadre_code=h.changed_by
        WHERE h.entity_type='EBS_REPORT' AND h.entity_id=? ORDER BY h.changed_at,h.history_id`).bind(reportId),
      env.DB.prepare(`SELECT c.clarification_id,c.question,c.answer,c.requested_at,c.answered_at,
        COALESCE(u.name,'Petugas') requested_by_name FROM sbm_clarifications c LEFT JOIN users u ON u.email=c.requested_by WHERE c.report_id=? ORDER BY c.requested_at,c.clarification_id`).bind(reportId),
      env.DB.prepare(`SELECT v.village_name,p.name posyandu_name,c.village_code reporter_village,e.current_status event_status,e.origin event_origin,e.event_title,e.event_id,
        (SELECT group_concat(m.public_label,', ') FROM report_observations o JOIN observation_master m ON m.observation_code=o.observation_code WHERE o.report_id=r.report_id) observation_labels,
        (SELECT group_concat(m.public_label,', ') FROM report_contexts c JOIN context_master m ON m.context_code=c.context_code WHERE c.report_id=r.report_id) context_labels
        FROM reports r LEFT JOIN villages v ON v.village_code=r.village_code LEFT JOIN reporters c ON c.reporter_id=r.reporter_id
        LEFT JOIN posyandu p ON p.posyandu_id=c.posyandu_id LEFT JOIN events e ON e.event_id=r.event_id WHERE r.report_id=?`).bind(reportId),
      env.DB.prepare(`SELECT d.outcome,d.notes,d.verification_method,d.contact_result,d.verified_ebs_id,
        m.disease_name verified_ebs_name,d.actual_cases,d.actual_deaths,d.actual_severe_cases,d.decided_at,
        COALESCE(u.name,'Petugas') decided_by_name FROM report_decisions d
        LEFT JOIN users u ON u.email=d.decided_by LEFT JOIN ebs_disease_master m ON m.ebs_id=d.verified_ebs_id
        WHERE d.report_id=?`).bind(reportId),
    ]);
    const result = {...report,...context.results[0] as Report};
    const safe = cadre ? result : safeReport(result, session?.kind === 'staff' ? session.role : 'VIEWER');
    if (!report.allow_contact) safe.reporter_phone = null;
    if (session?.kind === 'staff') await auditStatement(env,session.email,'EBS_OPEN','REPORT',reportId,{},{}).run();
    const finalDecision=decision.results[0] as Record<string,unknown> | undefined;
    const visibleDecision=finalDecision&&cadre?Object.fromEntries(['outcome','notes','actual_cases','actual_deaths','actual_severe_cases','decided_at','decided_by_name'].map(key=>[key,finalDecision[key]])):finalDecision || null;
    const assessment=await reportAssessment(env,reportId);
    return json({report:publicFields(safe,true),history:history.results,clarifications:clarifications.results,decision:visibleDecision,assessment,
      contribution:{stage:result.event_id?(result.event_origin==='SIGNAL'?'SIGNAL':'INCIDENT'):'NONE',event_id:result.event_origin==='SIGNAL'?null:result.event_id||null,event_title:result.event_origin==='SIGNAL'?null:result.event_title||null,status:result.event_status||null},
      handling:{status:report.current_status,event_status:result.event_status || null},
      can_manage:session?.kind === 'staff' && ['ADMIN','VERIFIKATOR'].includes(session.role)});
  }
  if(method==='POST'&&action==='validation') {
    const staff=requireStaff(session,'REPORT_VERIFY');
    if(staff.role!=='ADMIN')throw new HttpError('Validitas laporan ditentukan oleh admin.',403);
    const data=await body(request),status=clean(data.status,30),notes=multiline(data.notes,2000),timestamp=now();
    if(!['VALID','INVALID','NEEDS_CLARIFICATION'].includes(status)||!notes)throw new HttpError('Pilih validitas dan isi alasan penilaian.');
    const legacyClosed=report.workflow_status==='CLOSED'&&status==='VALID'&&report.event_id&&
      !await env.DB.prepare('SELECT 1 FROM report_validations WHERE report_id=?').bind(reportId).first()&&
      await env.DB.prepare("SELECT 1 FROM events WHERE event_id=? AND origin='SIGNAL'").bind(report.event_id).first();
    if(report.workflow_status==='CLOSED'&&!legacyClosed)throw new HttpError('Peninjauan laporan telah selesai.',409);
    if(status==='VALID'&&await env.DB.prepare('SELECT 1 FROM sbm_clarifications WHERE report_id=? AND answered_at IS NULL').bind(reportId).first())throw new HttpError('Selesaikan klarifikasi sebelum menyatakan laporan valid.',409);
    if(report.event_id&&status!=='VALID')throw new HttpError('Laporan sudah menjadi sumber sinyal. Selesaikan tinjauan sinyal sebelum mengubah validitas.',409);
    const question=status==='NEEDS_CLARIFICATION'?multiline(data.question,1000):'';
    if(status==='NEEDS_CLARIFICATION'&&(!report.reporter_id||!question))throw new HttpError('Isi pertanyaan klarifikasi untuk kader.');
    const saved=await env.DB.batch([
      env.DB.prepare(`UPDATE reports SET workflow_status=?,workflow_actor=?,workflow_changed_at=?,current_status=?,updated_at=?,updated_by=? WHERE report_id=? AND updated_at=? AND (workflow_status<>'CLOSED' OR ?=1)`)
        .bind(status==='INVALID'||legacyClosed?'CLOSED':'UNDER_REVIEW',staff.email,timestamp,status==='INVALID'?'DITOLAK':report.current_status,timestamp,staff.email,reportId,clean(data.expected_updated_at,40),legacyClosed?1:0),
      env.DB.prepare(`INSERT INTO report_validations(report_id,status,notes,updated_by,updated_at) SELECT ?,?,?,?,? WHERE changes()>0
        ON CONFLICT(report_id) DO UPDATE SET status=excluded.status,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(reportId,status,notes,staff.email,timestamp),
      env.DB.prepare(`INSERT INTO audit_log(audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes)
        SELECT ?,?,?,'VALIDATE_REPORT','REPORT',?,'{}',?,? WHERE changes()>0`).bind(id('AUD'),timestamp,staff.email,reportId,JSON.stringify({status}),notes),
      ...(question?[env.DB.prepare(`INSERT INTO sbm_clarifications(clarification_id,report_id,reporter_id,question,requested_at,requested_by)
        SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM report_validations WHERE report_id=? AND updated_at=? AND updated_by=?)`).bind(id('CLR'),reportId,report.reporter_id,question,timestamp,staff.email,reportId,timestamp,staff.email)]:[]),
    ]);
    if(!saved[0].meta.changes)throw new HttpError('Laporan berubah. Muat ulang sebelum menyimpan penilaian.',409);
    return json({ok:true});
  }
  if(method==='POST'&&action==='quality') {
    const staff=requireStaff(session,'REPORT_VERIFY');
    if(staff.role!=='ADMIN')throw new HttpError('Penilaian kualitas laporan ditentukan oleh admin.',403);
    const data=await body(request),quality=clean(data.quality,30),timeliness=clean(data.timeliness,30),completeness=clean(data.completeness,30),notes=multiline(data.notes,1000);
    if(!['VALID','REASONABLE','INCOMPLETE','ABUSIVE'].includes(quality)||!['TIMELY','LATE','UNKNOWN'].includes(timeliness)||!['COMPLETE','PARTIAL','UNKNOWN'].includes(completeness)||!notes)throw new HttpError('Lengkapi penilaian dan alasan kualitas laporan.');
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO sbm_report_quality(report_id,quality,timeliness,completeness,notes,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(report_id) DO UPDATE SET quality=excluded.quality,timeliness=excluded.timeliness,completeness=excluded.completeness,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(reportId,quality,timeliness,completeness,notes,staff.email,now()),
      auditStatement(env,staff.email,'ASSESS_REPORT_QUALITY','REPORT',reportId,{}, {quality,timeliness,completeness,notes}),
    ]);
    return json({ok:true});
  }
  if (method === 'POST' && action === 'review') {
    const staff = requireStaff(session,'REPORT_VERIFY'), timestamp=now();
    // Opening is idempotent. Read-only GETs, pending questions and closed reports
    // never acquire a new state through this endpoint.
    await env.DB.prepare(`UPDATE reports SET workflow_status='UNDER_REVIEW',workflow_actor=?,workflow_changed_at=?,updated_at=?,updated_by=?
      WHERE report_id=? AND workflow_status='SUBMITTED' AND (?='' OR assigned_to=?)`)
      .bind(staff.email,timestamp,timestamp,staff.email,reportId,staff.role==='VERIFIKATOR'?staff.email:'',staff.email).run();
    return json({ok:true});
  }
  if (method === 'POST' && action === 'decision') {
    const staff=requireStaff(session,'REPORT_VERIFY'), data=await body(request);
    const outcome=clean(data.outcome,30), notes=multiline(data.notes,2000), verificationMethod=clean(data.verification_method,100), contactResult=clean(data.contact_result,100);
    if (!['CONFIRMED','NOT_CONFIRMED','UNVERIFIABLE'].includes(outcome)) throw new HttpError('Pilih hasil peninjauan yang valid.');
    if (!notes || !verificationMethod) throw new HttpError('Metode konfirmasi dan alasan keputusan wajib diisi.');
    const verifiedEbsId=outcome==='CONFIRMED'?clean(data.verified_ebs_id,20):null;
    if (outcome==='CONFIRMED' && (!verifiedEbsId || !await validMaster(env,'ebs_disease_master','ebs_id',verifiedEbsId))) throw new HttpError('Pilih klasifikasi EBS yang valid.');
    // Membership groups observations; each source can still have a negative or
    // unverifiable review outcome independently of the event's other reports.
    const count=(value:unknown,label:string):number|null=>value==null || String(value).trim()===''?null:integer(value,label);
    const cases=count(data.actual_cases,'Kasus aktual'), deaths=count(data.actual_deaths,'Meninggal aktual'), severe=count(data.actual_severe_cases,'Kasus berat aktual');
    if (outcome==='CONFIRMED' && [cases,deaths,severe].some(v=>v===null)) throw new HttpError('Isi jumlah aktual untuk laporan terkonfirmasi.');
    if ((deaths!==null || severe!==null) && cases===null) throw new HttpError('Isi jumlah kasus aktual sebelum jumlah meninggal atau kasus berat.');
    if (cases!==null && ((deaths!==null && deaths>cases) || (severe!==null && severe>cases))) throw new HttpError('Jumlah meninggal atau kasus berat tidak boleh melebihi kasus aktual.');
    const result={outcome,notes,verification_method:verificationMethod,contact_result:contactResult,verified_ebs_id:verifiedEbsId,actual_cases:cases,actual_deaths:deaths,actual_severe_cases:severe};
    const existing=await env.DB.prepare('SELECT * FROM report_decisions WHERE report_id=?').bind(reportId).first<Record<string,unknown>>();
    const same=(row:Record<string,unknown>)=>Object.entries(result).every(([key,value])=>row[key]===value);
    if (existing) {
      if (same(existing)) return json({ok:true,already_saved:true});
      throw new HttpError('Keputusan akhir sudah tersimpan. Muat ulang laporan untuk melihat hasilnya.',409);
    }
    if(report.reporter_id)await requireValidReport(env,reportId);
    const expected=clean(data.expected_updated_at,40);
    if (!expected || expected!==report.updated_at || report.workflow_status==='CLOSED') throw new HttpError('Laporan sudah berubah. Muat ulang dan periksa sebelum menyimpan keputusan.',409);
    const timestamp=now(),decisionId=id('DEC');
    const owns=`EXISTS(SELECT 1 FROM report_decisions WHERE decision_id=?)`;
    const statements=[
      env.DB.prepare(`UPDATE reports SET workflow_status='CLOSED',workflow_actor=?,workflow_changed_at=?,current_status='SELESAI',
        verified_ebs_id=?,classified_by=CASE WHEN ?='CONFIRMED' THEN ? ELSE NULL END,
        classified_at=CASE WHEN ?='CONFIRMED' THEN ? ELSE NULL END,updated_at=?,updated_by=?
        WHERE report_id=? AND updated_at=? AND workflow_status<>'CLOSED' AND (?='' OR assigned_to=?)
        AND NOT EXISTS(SELECT 1 FROM sbm_clarifications WHERE report_id=? AND answered_at IS NULL)`)
        .bind(staff.email,timestamp,verifiedEbsId,outcome,staff.email,outcome,timestamp,timestamp,staff.email,reportId,expected,staff.role==='VERIFIKATOR'?staff.email:'',staff.email,reportId),
      env.DB.prepare(`INSERT INTO report_decisions(decision_id,report_id,outcome,notes,verification_method,contact_result,verified_ebs_id,actual_cases,actual_deaths,actual_severe_cases,decided_at,decided_by)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()>0`).bind(decisionId,reportId,outcome,notes,verificationMethod,contactResult,verifiedEbsId,cases,deaths,severe,timestamp,staff.email),
    ];
    if (outcome==='CONFIRMED') statements.push(env.DB.prepare(`INSERT INTO verifications(verification_id,report_id,event_id,verified_at,verified_by,verification_method,contact_result,actual_cases,actual_deaths,actual_severe_cases,verification_result,notes,verified_ebs_id,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,'CONFIRMED',?,?,? WHERE changes()>0 AND ${owns}`)
      .bind(id('VER'),reportId,report.event_id,timestamp,staff.email,verificationMethod,contactResult,cases,deaths,severe,notes,verifiedEbsId,timestamp,decisionId));
    statements.push(
      env.DB.prepare(`INSERT INTO status_history(history_id,entity_type,entity_id,old_status,new_status,changed_at,changed_by,notes)
        SELECT ?,'REPORT',?,?,'SELESAI',?,?,? WHERE changes()>0 AND ${owns}`)
        .bind(id('HIS'),reportId,report.current_status,timestamp,staff.email,notes,decisionId),
      env.DB.prepare(`INSERT INTO audit_log(audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes)
        SELECT ?,?,?,'EBS_DECISION','REPORT',?,?,?,? WHERE changes()>0 AND ${owns}`)
        .bind(id('AUD'),timestamp,staff.email,reportId,JSON.stringify({workflow_status:report.workflow_status,current_status:report.current_status}),JSON.stringify(result),notes,decisionId),
      env.DB.prepare(`UPDATE status_history SET notes=? WHERE entity_type='EBS_REPORT' AND entity_id=? AND changed_at=? AND changed_by=? AND new_status='CLOSED' AND ${owns}`)
        .bind(notes,reportId,timestamp,staff.email,decisionId),
    );
    const saved=await env.DB.batch(statements);
    if (!saved[0].meta.changes) {
      const committed=await env.DB.prepare('SELECT * FROM report_decisions WHERE report_id=?').bind(reportId).first<Record<string,unknown>>();
      if (committed && same(committed)) return json({ok:true,already_saved:true});
      throw new HttpError('Laporan berubah atau masih menunggu jawaban klarifikasi. Muat ulang sebelum menyimpan keputusan.',409);
    }
    return json({ok:true});
  }
  if (method === 'POST' && action === 'status') {
    const staff = requireStaff(session,'REPORT_VERIFY'), data = await body(request);
    const next = clean(data.status,30);
    if (next==='CLOSED' && !['SELESAI','DITOLAK','DUPLIKAT'].includes(String(report.current_status))) throw new HttpError('Gunakan keputusan akhir untuk menyelesaikan laporan.',409);
    const allowed = report.workflow_status === 'SUBMITTED' ? ['UNDER_REVIEW','CLOSED'] : report.workflow_status === 'UNDER_REVIEW' || report.workflow_status === 'NEEDS_CLARIFICATION' ? ['CLOSED'] : [];
    if (!allowed.includes(next)) throw new HttpError('Perubahan status tidak diizinkan.',409);
    const timestamp = now();
    const notes = multiline(data.notes,1000);
    const results = await env.DB.batch([env.DB.prepare(`UPDATE reports SET workflow_status=?,workflow_actor=?,workflow_changed_at=?,updated_at=?,updated_by=?
      WHERE report_id=? AND workflow_status=? AND (?<>'CLOSED' OR NOT EXISTS(SELECT 1 FROM sbm_clarifications WHERE report_id=? AND answered_at IS NULL))`)
      .bind(next,staff.email,timestamp,timestamp,staff.email,reportId,report.workflow_status,next,reportId),
      env.DB.prepare(`UPDATE status_history SET notes=? WHERE entity_type='EBS_REPORT' AND entity_id=?
        AND changed_at=? AND changed_by=? AND new_status=? AND ?<>'' AND changes()>0`).bind(notes,reportId,timestamp,staff.email,next,notes),
    ]);
    if (!results[0].meta.changes) throw new HttpError('Laporan berubah atau masih memiliki pertanyaan yang belum dijawab. Muat ulang laporan.',409);
    return json({ok:true});
  }
  if (method === 'POST' && action === 'start-verification') {
    const staff = requireStaff(session,'REPORT_VERIFY');
    if(report.reporter_id)await requireValidReport(env,reportId);
    if (!['BARU','DITERIMA','MEMERLUKAN_INFORMASI'].includes(String(report.current_status)))
      throw new HttpError('Verifikasi sudah dimulai atau laporan tidak dapat diverifikasi.',409);
    const timestamp = now();
    const ownsUpdate = `EXISTS(SELECT 1 FROM reports WHERE report_id=? AND current_status='SEDANG_DIVERIFIKASI' AND updated_at=? AND updated_by=?)`;
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE reports SET current_status='SEDANG_DIVERIFIKASI',updated_at=?,updated_by=?
        WHERE report_id=? AND current_status=? AND NOT EXISTS(SELECT 1 FROM sbm_clarifications WHERE report_id=? AND answered_at IS NULL)`)
        .bind(timestamp,staff.email,reportId,report.current_status,reportId),
      env.DB.prepare(`INSERT INTO status_history(history_id,entity_type,entity_id,old_status,new_status,changed_at,changed_by,notes)
        SELECT ?,'REPORT',?,?,'SEDANG_DIVERIFIKASI',?,?,'Verifikasi dimulai dari halaman kerja laporan.' WHERE changes()>0 AND ${ownsUpdate}`)
        .bind(id('HIS'),reportId,report.current_status,timestamp,staff.email,reportId,timestamp,staff.email),
      env.DB.prepare(`INSERT INTO audit_log(audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes)
        SELECT ?,?,?,'START_VERIFICATION','REPORT',?,?,'{"current_status":"SEDANG_DIVERIFIKASI"}','Verifikasi dimulai.' WHERE changes()>0 AND ${ownsUpdate}`)
        .bind(id('AUD'),timestamp,staff.email,reportId,JSON.stringify({current_status:report.current_status}),reportId,timestamp,staff.email),
      env.DB.prepare(`UPDATE reports SET workflow_status='UNDER_REVIEW',workflow_actor=?,workflow_changed_at=?
        WHERE changes()>0 AND report_id=? AND workflow_status='SUBMITTED' AND updated_at=? AND updated_by=?`)
        .bind(staff.email,timestamp,reportId,timestamp,staff.email),
    ]);
    if (!results[0].meta.changes) throw new HttpError('Jawab seluruh klarifikasi terlebih dahulu atau muat ulang laporan yang sudah berubah.',409);
    return json({ok:true});
  }
  if (method === 'POST' && action === 'clarifications') {
    const staff = requireStaff(session,'REPORT_VERIFY'), data = await body(request);
    const question = multiline(data.question,1000);
    if (!question) throw new HttpError('Pertanyaan klarifikasi wajib diisi.');
    if (!report.reporter_id) throw new HttpError('Klarifikasi melalui portal hanya tersedia untuk laporan kader.');
    if (report.workflow_status === 'CLOSED') throw new HttpError('Laporan sudah selesai.',409);
    try {
      await env.DB.prepare('INSERT INTO sbm_clarifications(clarification_id,report_id,reporter_id,question,requested_at,requested_by) VALUES(?,?,?,?,?,?)')
        .bind(id('CLR'),reportId,report.reporter_id,question,now(),staff.email).run();
    } catch(error) {
      if (String(error).includes('EBS_CLARIFICATION_CLOSED_OR_OWNER')) throw new HttpError('Laporan berubah atau sudah selesai. Muat ulang laporan.',409);
      throw error;
    }
    return json({ok:true},201);
  }
  throw new HttpError('Endpoint EBS tidak ditemukan.',404);
}
