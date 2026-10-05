import { fromBase64url, base64url, timingSafeEqual } from './crypto';
import { auditStatement, historyStatement, now } from './db';
import { body, json, HttpError } from './http';
import type { Env, Report } from './types';
import { handlePublicSnapshotIntegration } from './public-snapshots';

const MAX_PAGE_SIZE = 200;
const ACTOR = 'integration:skdklb';

type Cursor = { updated_at: string; report_id: string };

function requireIntegrationToken(request: Request, env: Env): void {
  const expected = String(env.SKDKLB_INTEGRATION_TOKEN || '');
  if (!expected) throw new HttpError('Integrasi SKD-KLB belum dikonfigurasi.', 503);
  const authorization = request.headers.get('authorization') || '';
  const received = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!received || !timingSafeEqual(received, expected)) throw new HttpError('Token integrasi tidak valid.', 401);
}

function encodeCursor(cursor: Cursor): string {
  return base64url(new TextEncoder().encode(JSON.stringify(cursor)));
}

function decodeCursor(value: string | null): Cursor {
  if (!value) return { updated_at: '', report_id: '' };
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64url(value))) as Partial<Cursor>;
    if (typeof parsed.updated_at !== 'string' || typeof parsed.report_id !== 'string') throw new Error('bad cursor');
    return { updated_at: parsed.updated_at, report_id: parsed.report_id };
  } catch {
    throw new HttpError('Cursor sinkronisasi tidak valid.');
  }
}

function pageLimit(request: Request): number {
  const requested = Number(new URL(request.url).searchParams.get('limit') || 100);
  return Number.isInteger(requested) ? Math.min(MAX_PAGE_SIZE, Math.max(1, requested)) : 100;
}

function list(value: unknown): string[] {
  return String(value || '').split('\u001f').filter(Boolean);
}

async function exportReports(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const limit = pageLimit(request);
  const result = await env.DB.prepare(
    `SELECT reports.report_id,reports.submission_channel,reports.reporter_type,
       reports.submitted_at,reports.signal_code,reports.event_type,reports.village_code,
       villages.village_name,reports.location_text,reports.event_start_date,
       reports.reported_cases,reports.reported_cases_known,reports.reported_deaths,reports.reported_deaths_known,reports.severe_cases,reports.severe_cases_known,reports.hospitalized_cases,reports.hospitalized_cases_known,
       reports.affected_group,reports.epidemiological_link,reports.description,reports.initial_action,
       reports.latitude,reports.longitude,reports.current_priority,reports.current_status,
       reports.verified_ebs_id,reports.updated_at,
       (SELECT disease_name FROM ebs_disease_master WHERE ebs_id=reports.verified_ebs_id) AS verified_ebs_name,
       (SELECT GROUP_CONCAT(observation_code, char(31)) FROM report_observations WHERE report_id=reports.report_id) AS observation_codes,
       (SELECT GROUP_CONCAT(context_code, char(31)) FROM report_contexts WHERE report_id=reports.report_id) AS context_codes
     FROM reports LEFT JOIN villages ON villages.village_code=reports.village_code
     WHERE reports.updated_at>? OR (reports.updated_at=? AND reports.report_id>?)
     ORDER BY reports.updated_at,reports.report_id LIMIT ?`
  ).bind(cursor.updated_at, cursor.updated_at, cursor.report_id, limit + 1).all<Record<string, unknown>>();
  const hasMore = result.results.length > limit;
  const rows: Array<Record<string,unknown>&{observation_codes:string[];context_codes:string[]}> = result.results.slice(0, limit).map(row => ({
    ...row, observation_codes: list(row.observation_codes), context_codes: list(row.context_codes),
  }));
  const last = rows.at(-1);
  return json({ schema_version: 1, reports: rows,
    next_cursor: last ? encodeCursor({ updated_at: String(last.updated_at), report_id: String(last.report_id) }) : null,
    has_more: hasMore });
}

async function exportDeletions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const limit = pageLimit(request);
  const result = await env.DB.prepare(`SELECT report_id,deleted_at FROM integration_report_tombstones
    WHERE deleted_at>? OR (deleted_at=? AND report_id>?) ORDER BY deleted_at,report_id LIMIT ?`)
    .bind(cursor.updated_at,cursor.updated_at,cursor.report_id,limit+1).all<Record<string,unknown>>();
  const hasMore = result.results.length > limit;
  const deletions = result.results.slice(0,limit);
  const last = deletions.at(-1);
  return json({ schema_version:1,deletions,
    next_cursor:last?encodeCursor({updated_at:String(last.deleted_at),report_id:String(last.report_id)}):null,
    has_more:hasMore });
}

async function exportW2Submissions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const limit = pageLimit(request);
  const result = await env.DB.prepare(`SELECT submission.submission_id,submission.epi_year,submission.epi_week,
      submission.first_submitted_at,submission.submitted_at,submission.revision,submission.catalog_version,
      COALESCE(submission.updated_at,submission.submitted_at) updated_at,
      source.source_id,source.source_code,source.source_name,source.network_type,source.village_code
    FROM w2_submissions submission JOIN routine_sources source ON source.source_id=submission.source_id
    WHERE submission.submission_status='SUBMITTED'
      AND (COALESCE(submission.updated_at,submission.submitted_at)>?
        OR (COALESCE(submission.updated_at,submission.submitted_at)=? AND submission.submission_id>?))
    ORDER BY COALESCE(submission.updated_at,submission.submitted_at),submission.submission_id LIMIT ?`)
    .bind(cursor.updated_at,cursor.updated_at,cursor.report_id,limit+1).all<Record<string,unknown>>();
  const hasMore = result.results.length > limit;
  const selected = result.results.slice(0,limit);
  const submissions: Array<Record<string,unknown>&{values:Record<string,unknown>[]}> = await Promise.all(selected.map(async submission => {
    const values = await env.DB.prepare(`SELECT indicator_code,case_count,lab_examined_count FROM w2_values
      WHERE submission_id=? ORDER BY indicator_code`).bind(submission.submission_id).all();
    return { ...submission, values: values.results as Record<string,unknown>[] };
  }));
  const last = submissions.at(-1);
  return json({ schema_version:1,submissions,
    privacy:{aggregate_only:true,patient_details_included:false},
    next_cursor:last?encodeCursor({updated_at:String(last.updated_at),report_id:String(last.submission_id)}):null,
    has_more:hasMore });
}

async function exportW2Metadata(env: Env): Promise<Response> {
  const [sources, policies] = await env.DB.batch([
    env.DB.prepare(`SELECT source_id,source_code,source_name,network_type,village_code,active,created_at,updated_at
      FROM routine_sources WHERE source_type='FASKES' AND network_type='JEJARING'
      ORDER BY source_name,source_code`),
    env.DB.prepare(`SELECT policy_id,effective_epi_year,effective_epi_week,deadline_hour,deadline_minute,created_at
      FROM w2_deadline_policies ORDER BY effective_epi_year,effective_epi_week`),
  ]);
  return json({
    schema_version: 1,
    sources: sources.results,
    deadline_policies: policies.results,
    privacy: { aggregate_only: true, patient_details_included: false },
  });
}

async function exportW2Deletions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const limit = pageLimit(request);
  const result = await env.DB.prepare(`SELECT submission_id,source_id,epi_year,epi_week,deleted_at
    FROM integration_w2_tombstones WHERE deleted_at>? OR (deleted_at=? AND submission_id>?)
    ORDER BY deleted_at,submission_id LIMIT ?`).bind(cursor.updated_at,cursor.updated_at,cursor.report_id,limit+1)
    .all<Record<string,unknown>>();
  const hasMore=result.results.length>limit;
  const deletions=result.results.slice(0,limit);
  const last=deletions.at(-1);
  return json({schema_version:1,deletions,
    next_cursor:last?encodeCursor({updated_at:String(last.deleted_at),report_id:String(last.submission_id)}):null,
    has_more:hasMore});
}

async function exportSchoolSubmissions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const limit = pageLimit(request);
  const result = await env.DB.prepare(`SELECT submission.submission_id,submission.epi_year,submission.epi_week,
      submission.enrolled_count,submission.sick_absent_count,submission.sick_percentage,
      submission.first_submitted_at,submission.submitted_at,submission.revision,
      submission.submitted_at updated_at,source.source_id,source.source_code,source.source_name,source.village_code
    FROM school_submissions submission JOIN routine_sources source ON source.source_id=submission.source_id
    WHERE submission.submitted_at>? OR (submission.submitted_at=? AND submission.submission_id>?)
    ORDER BY submission.submitted_at,submission.submission_id LIMIT ?`)
    .bind(cursor.updated_at,cursor.updated_at,cursor.report_id,limit+1).all<Record<string,unknown>>();
  const hasMore=result.results.length>limit;
  const submissions=result.results.slice(0,limit);
  const last=submissions.at(-1);
  return json({schema_version:1,submissions,
    privacy:{aggregate_only:true,patient_details_included:false,free_text_included:false},
    next_cursor:last?encodeCursor({updated_at:String(last.updated_at),report_id:String(last.submission_id)}):null,
    has_more:hasMore});
}

async function exportSchoolDeletions(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const limit = pageLimit(request);
  const result = await env.DB.prepare(`SELECT submission_id,source_id,epi_year,epi_week,deleted_at
    FROM integration_school_tombstones WHERE deleted_at>? OR (deleted_at=? AND submission_id>?)
    ORDER BY deleted_at,submission_id LIMIT ?`).bind(cursor.updated_at,cursor.updated_at,cursor.report_id,limit+1)
    .all<Record<string,unknown>>();
  const hasMore=result.results.length>limit;
  const deletions=result.results.slice(0,limit);
  const last=deletions.at(-1);
  return json({schema_version:1,deletions,
    next_cursor:last?encodeCursor({updated_at:String(last.deleted_at),report_id:String(last.submission_id)}):null,
    has_more:hasMore});
}

async function exportSchoolMetadata(env: Env): Promise<Response> {
  const [sources,threshold] = await env.DB.batch([
    env.DB.prepare(`SELECT source_id,source_code,source_name,village_code,active,created_at,updated_at
      FROM routine_sources WHERE source_type='SEKOLAH' ORDER BY source_name,source_code`),
    env.DB.prepare(`SELECT threshold_id,minimum_value,active,created_at,updated_at FROM ibs_thresholds
      WHERE target_type='SEKOLAH' AND target_code='SICK_PERCENT' ORDER BY updated_at DESC LIMIT 1`),
  ]);
  return json({schema_version:1,sources:sources.results,
    deadline:{weekday:'MONDAY',hour:12,minute:0,timezone:'Asia/Jakarta'},
    alert_threshold:threshold.results[0] || null,
    privacy:{aggregate_only:true,patient_details_included:false,free_text_included:false}});
}

async function applyAction(request: Request, env: Env, reportId: string): Promise<Response> {
  const data=await body(request);
  const action=String(data.action||'').trim().toUpperCase();
  const transitions:Record<string,{from:string;to:string;note:string}>={
    ACKNOWLEDGE:{from:'BARU',to:'DITERIMA',note:'Laporan diterima melalui ruang kerja SKD-KLB.'},
    START_VERIFICATION:{from:'DITERIMA',to:'SEDANG_DIVERIFIKASI',note:'Verifikasi dimulai melalui ruang kerja SKD-KLB.'},
  };
  const transition=transitions[action];
  if(!transition) throw new HttpError('Aksi integrasi tidak didukung.');
  const report=await env.DB.prepare('SELECT * FROM reports WHERE report_id=?').bind(reportId).first<Report>();
  if(!report) throw new HttpError('Laporan tidak ditemukan.',404);
  if(action==='START_VERIFICATION'&&report.reporter_id) {
    const review=await env.DB.prepare("SELECT 1 FROM report_validations WHERE report_id=? AND status='VALID'").bind(reportId).first();
    if(!review)throw new HttpError('Admin harus menyatakan laporan valid sebelum verifikasi.',409);
  }
  const current=String(report.current_status);
  if(current===transition.to) return json({ok:true,unchanged:true,current_status:current});
  if(current!==transition.from) throw new HttpError(`Aksi ${action} tidak dapat dilakukan dari status ${current}.`,409);
  const timestamp=now();
  await env.DB.batch([
    env.DB.prepare('UPDATE reports SET current_status=?,updated_at=?,updated_by=? WHERE report_id=? AND current_status=?')
      .bind(transition.to,timestamp,ACTOR,reportId,transition.from),
    historyStatement(env,'REPORT',reportId,transition.from,transition.to,ACTOR,transition.note),
    auditStatement(env,ACTOR,`INTEGRATION_${action}`,'REPORT',reportId,{current_status:transition.from},{current_status:transition.to},transition.note),
  ]);
  return json({ok:true,current_status:transition.to,updated_at:timestamp});
}

export async function handleSkdklbIntegration(request: Request, env: Env): Promise<Response|null> {
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/integrations/skdklb/')) return null;
  const publicSnapshotResponse=await handlePublicSnapshotIntegration(request,env);
  if(publicSnapshotResponse) return publicSnapshotResponse;
  requireIntegrationToken(request,env);
  if(request.method==='GET'&&url.pathname==='/api/integrations/skdklb/reports') return exportReports(request,env);
  if(request.method==='GET'&&url.pathname==='/api/integrations/skdklb/deletions') return exportDeletions(request,env);
  if(request.method==='GET'&&url.pathname==='/api/integrations/skdklb/w2/submissions') return exportW2Submissions(request,env);
  if(request.method==='GET'&&url.pathname==='/api/integrations/skdklb/w2/deletions') return exportW2Deletions(request,env);
  if(request.method==='GET'&&url.pathname==='/api/integrations/skdklb/w2/metadata') return exportW2Metadata(env);
  if(request.method==='GET'&&url.pathname==='/api/integrations/skdklb/schools/submissions') return exportSchoolSubmissions(request,env);
  if(request.method==='GET'&&url.pathname==='/api/integrations/skdklb/schools/deletions') return exportSchoolDeletions(request,env);
  if(request.method==='GET'&&url.pathname==='/api/integrations/skdklb/schools/metadata') return exportSchoolMetadata(env);
  const match=url.pathname.match(/^\/api\/integrations\/skdklb\/reports\/([^/]+)\/actions$/);
  if(request.method==='POST'&&match) return applyAction(request,env,decodeURIComponent(match[1]));
  throw new HttpError('Endpoint integrasi tidak ditemukan.',404);
}
