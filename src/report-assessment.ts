import type { Env } from './types';
import { HttpError } from './http';

export async function requireValidReport(env:Env,reportId:string) {
  const review=await env.DB.prepare('SELECT status FROM report_validations WHERE report_id=?').bind(reportId).first<{status:string}>();
  if(review?.status!=='VALID')throw new HttpError('Admin harus menyatakan laporan valid sebelum verifikasi atau pengelompokan sinyal.',409);
  if(await env.DB.prepare('SELECT 1 FROM sbm_clarifications WHERE report_id=? AND answered_at IS NULL').bind(reportId).first())throw new HttpError('Selesaikan klarifikasi sebelum verifikasi atau pengelompokan sinyal.',409);
}
export async function reportAssessment(env:Env,reportId:string) {
  const [validation,quality]=await env.DB.batch<Record<string,unknown>>([
    env.DB.prepare('SELECT status,notes,updated_at FROM report_validations WHERE report_id=?').bind(reportId),
    env.DB.prepare(`SELECT COALESCE(q.quality,s.quality) quality,COALESCE(q.completeness,s.completeness) completeness,
      COALESCE(q.timeliness,s.timeliness) timeliness,COALESCE(q.notes,s.notes) notes
      FROM reports r LEFT JOIN sbm_report_quality q ON q.report_id=r.report_id LEFT JOIN sbm_screenings s ON s.report_id=r.report_id WHERE r.report_id=?`).bind(reportId),
  ]);
  const grade=quality.results[0];
  const information=({VALID:20,REASONABLE:20,INCOMPLETE:10,ABUSIVE:0} as Record<string,number>)[String(grade?.quality)]??null;
  const completeness=({COMPLETE:15,PARTIAL:7.5} as Record<string,number>)[String(grade?.completeness)]??null;
  const timeliness=({TIMELY:15,LATE:0} as Record<string,number>)[String(grade?.timeliness)]??null;
  return {validation:validation.results[0]||null,quality:grade?.quality?grade:null,
    score:{information,completeness,timeliness,total:[information,completeness,timeliness].some(v=>v===null)?null:information!+completeness!+timeliness!}};
}
