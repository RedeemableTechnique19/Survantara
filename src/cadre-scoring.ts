import type { Env } from './types';

export const CADRE_SCORE_VERSION = 'draft-event-2026-10-04';

// Quality is assessed independently of the eventual verification outcome.
// Only fully assessed reports enter the average; UNKNOWN is never a zero.
export async function cadrePerformance(env: Env, reporterId = '') {
  const result = await env.DB.prepare(`WITH assessed AS (
    SELECT COALESCE(q.report_id,s.report_id) report_id,COALESCE(q.quality,s.quality) quality,
      COALESCE(q.timeliness,s.timeliness) timeliness,COALESCE(q.completeness,s.completeness) completeness
      FROM reports t LEFT JOIN sbm_report_quality q ON q.report_id=t.report_id LEFT JOIN sbm_screenings s ON s.report_id=t.report_id
    ) SELECT r.reporter_id,
    COUNT(t.report_id) report_count, COUNT(s.report_id) screened_count,
    SUM(CASE WHEN s.quality IN ('VALID','REASONABLE') THEN 1 ELSE 0 END) reasonable_reports,
    SUM(CASE WHEN s.report_id IS NOT NULL AND s.timeliness<>'UNKNOWN' AND s.completeness<>'UNKNOWN' THEN 1 ELSE 0 END) assessed_count,
    AVG(CASE WHEN s.timeliness<>'UNKNOWN' AND s.completeness<>'UNKNOWN' THEN
      (CASE s.quality WHEN 'VALID' THEN 20 WHEN 'REASONABLE' THEN 20 WHEN 'INCOMPLETE' THEN 10 WHEN 'ABUSIVE' THEN 0 END)
      + (CASE s.completeness WHEN 'COMPLETE' THEN 15 WHEN 'PARTIAL' THEN 7.5 END)
      + (CASE s.timeliness WHEN 'TIMELY' THEN 15 WHEN 'LATE' THEN 0 END) END) performance_score,
    AVG(CASE WHEN s.timeliness<>'UNKNOWN' AND s.completeness<>'UNKNOWN' THEN
      CASE s.quality WHEN 'VALID' THEN 20 WHEN 'REASONABLE' THEN 20 WHEN 'INCOMPLETE' THEN 10 WHEN 'ABUSIVE' THEN 0 END END) information_score,
    AVG(CASE WHEN s.timeliness<>'UNKNOWN' AND s.completeness<>'UNKNOWN' THEN
      CASE s.completeness WHEN 'COMPLETE' THEN 15 WHEN 'PARTIAL' THEN 7.5 END END) completeness_score,
    AVG(CASE WHEN s.timeliness<>'UNKNOWN' AND s.completeness<>'UNKNOWN' THEN
      CASE s.timeliness WHEN 'TIMELY' THEN 15 WHEN 'LATE' THEN 0 END END) timeliness_score
    FROM reporters r LEFT JOIN reports t ON t.reporter_id=r.reporter_id
      AND julianday(t.submitted_at)>=julianday('now','-6 months') AND julianday(t.submitted_at)<=julianday('now')
    LEFT JOIN assessed s ON s.report_id=t.report_id
    WHERE r.active=1 AND (?='' OR r.reporter_id=?) GROUP BY r.reporter_id`).bind(reporterId,reporterId).all<{
      reporter_id:string;report_count:number;screened_count:number;reasonable_reports:number;assessed_count:number;performance_score:number|null;
      information_score:number|null;completeness_score:number|null;timeliness_score:number|null;
    }>();
  const rounded=(value:number|null)=>value===null?null:Math.round(value*100)/100;
  return result.results.map(row=>({...row,performance_score:rounded(row.performance_score),information_score:rounded(row.information_score),completeness_score:rounded(row.completeness_score),timeliness_score:rounded(row.timeliness_score)}));
}

// One payload for the portal disclosure and the cadre's downloadable Story.
export async function cadreQuality(env: Env, reporterId: string) {
  const performance=(await cadrePerformance(env,reporterId))[0];
  return {performance_score:performance?.performance_score??null,assessed_count:performance?.assessed_count??0,report_count:performance?.report_count??0,period_months:6,max_score:50,
    components:{information:performance?.information_score??null,completeness:performance?.completeness_score??null,timeliness:performance?.timeliness_score??null}};
}

export function selectionScore(performance: number|null, assessment: {understanding:number|null;support:number|null;available:string}|null) {
  const relevance = assessment?.understanding != null && assessment.support != null ? assessment.understanding+assessment.support : null;
  const eligible = assessment?.available==='YES' && assessment.understanding != null && assessment.understanding>0 && assessment.support != null && assessment.support>0;
  return {relevance_score:relevance, eligible, total_score:eligible && relevance!==null && performance!==null ? Math.round((relevance+performance)*100)/100 : null};
}
