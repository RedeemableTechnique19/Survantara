-- Notification urgency and assessed risk are separate dimensions. Persist the
-- former so alert decisions remain auditable after submission.
ALTER TABLE reports ADD COLUMN immediate_notification INTEGER NOT NULL DEFAULT 0
  CHECK(immediate_notification IN (0,1));

UPDATE reports SET immediate_notification=1
WHERE EXISTS (
  SELECT 1 FROM event_type_master event
  WHERE event.event_type=reports.event_type AND event.active=1 AND event.immediate_notification=1
)
OR EXISTS (
  SELECT 1 FROM report_observations selected
  JOIN observation_master master ON master.observation_code=selected.observation_code
  WHERE selected.report_id=reports.report_id AND master.active=1 AND master.immediate_notification=1
)
OR EXISTS (
  SELECT 1 FROM report_contexts selected
  JOIN context_master master ON master.context_code=selected.context_code
  WHERE selected.report_id=reports.report_id AND master.active=1 AND master.immediate_notification=1
)
OR reported_deaths>0
OR severe_cases>0
OR hospitalized_cases>0
OR reported_cases>=5;

-- Ensure active cadre choices have a stable, unique presentation order.
UPDATE signal_master SET sort_order=CASE signal_code
  WHEN 'PERSON_ILLNESS' THEN 1
  WHEN 'FOOD' THEN 2
  WHEN 'CLUSTER' THEN 3
  WHEN 'DEATH' THEN 4
  WHEN 'SCHOOL' THEN 5
  WHEN 'ENV' THEN 6
  WHEN 'ZOONOSIS' THEN 7
  WHEN 'ZOONOSIS_HUMAN' THEN 8
  WHEN 'ANIMAL_EXPOSURE' THEN 9
  WHEN 'OTHER' THEN 10
  ELSE sort_order
END;

-- Pin the exact Kemenkes-linked source artifact used to capture the catalogue.
ALTER TABLE ebs_disease_master ADD COLUMN source_artifact_sha256 TEXT NOT NULL
  DEFAULT 'FE99CD13984899B48E49F95F6488B422390AF573189F8E06E1F98C6B84977B97';
ALTER TABLE ebs_disease_master ADD COLUMN source_artifact_bytes INTEGER NOT NULL DEFAULT 20743697;
