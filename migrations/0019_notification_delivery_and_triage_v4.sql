-- Track notification intent separately from actual delivery. Historical
-- immediate reports cannot be assumed delivered, so mark them UNKNOWN.
ALTER TABLE reports ADD COLUMN notification_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED'
  CHECK(notification_status IN ('NOT_REQUIRED','PENDING','SENT','FAILED','UNCONFIGURED','UNKNOWN'));
ALTER TABLE reports ADD COLUMN notification_attempts INTEGER NOT NULL DEFAULT 0
  CHECK(notification_attempts >= 0);
ALTER TABLE reports ADD COLUMN last_notification_attempt_at TEXT;
ALTER TABLE reports ADD COLUMN notification_sent_at TEXT;
ALTER TABLE reports ADD COLUMN notification_error TEXT;

UPDATE reports SET notification_status='UNKNOWN'
WHERE immediate_notification=1;

CREATE INDEX reports_notification_queue_idx
  ON reports(immediate_notification,notification_status,submitted_at DESC);

-- Version 4 separates risk priority from notification urgency and reads
-- observation/context priority from master data. Recalculate the original
-- computed priority for comparable historical analytics. Preserve a current
-- priority that differs from the old original value, as that may reflect a
-- deliberate staff assessment.
CREATE TABLE report_triage_recalc_0019 AS
SELECT reports.report_id,
       reports.initial_priority AS old_initial_priority,
       CASE
         WHEN reports.reported_deaths>0
           OR reports.severe_cases>0
           OR reports.hospitalized_cases>0
           OR reports.reported_cases>=5
           OR EXISTS (
             SELECT 1 FROM event_type_master event
             WHERE event.event_type=reports.event_type AND event.default_priority='TINGGI'
           )
           OR EXISTS (
             SELECT 1 FROM report_observations selected
             JOIN observation_master master ON master.observation_code=selected.observation_code
             WHERE selected.report_id=reports.report_id AND master.default_priority='TINGGI'
           )
           OR EXISTS (
             SELECT 1 FROM report_contexts selected
             JOIN context_master master ON master.context_code=selected.context_code
             WHERE selected.report_id=reports.report_id AND master.default_priority='TINGGI'
           )
           OR (reports.reported_cases>=2 AND EXISTS (
             SELECT 1 FROM report_contexts selected
             WHERE selected.report_id=reports.report_id AND selected.context_code='SHARED_FOOD'
           ))
           THEN 'TINGGI'
         WHEN reports.reported_cases>=2
           OR EXISTS (
             SELECT 1 FROM event_type_master event
             WHERE event.event_type=reports.event_type AND event.default_priority='SEDANG'
           )
           OR EXISTS (
             SELECT 1 FROM report_observations selected
             JOIN observation_master master ON master.observation_code=selected.observation_code
             WHERE selected.report_id=reports.report_id AND master.default_priority='SEDANG'
           )
           OR EXISTS (
             SELECT 1 FROM report_contexts selected
             JOIN context_master master ON master.context_code=selected.context_code
             WHERE selected.report_id=reports.report_id AND master.default_priority='SEDANG'
           )
           THEN 'SEDANG'
         ELSE 'RENDAH'
       END AS recalculated_priority
FROM reports
WHERE event_type IS NOT NULL;

UPDATE reports
SET current_priority=CASE
      WHEN current_priority=(SELECT old_initial_priority FROM report_triage_recalc_0019 recalc WHERE recalc.report_id=reports.report_id)
      THEN (SELECT recalculated_priority FROM report_triage_recalc_0019 recalc WHERE recalc.report_id=reports.report_id)
      ELSE current_priority
    END,
    initial_priority=(SELECT recalculated_priority FROM report_triage_recalc_0019 recalc WHERE recalc.report_id=reports.report_id),
    triage_reason='Prioritas dihitung dari master taksonomi dan data terstruktur laporan.',
    triage_rule_version='4.0-master-priority'
WHERE report_id IN (SELECT report_id FROM report_triage_recalc_0019);

DROP TABLE report_triage_recalc_0019;
