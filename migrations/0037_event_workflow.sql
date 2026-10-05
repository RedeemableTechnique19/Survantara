ALTER TABLE events ADD COLUMN origin TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(origin IN ('CONFIRMED','SIGNAL'));
ALTER TABLE events ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE sbm_event_assessments (
  event_id TEXT PRIMARY KEY REFERENCES events(event_id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK(decision IN ('CLARIFY','REMOTE','FIELD','CLOSE')),
  priority TEXT NOT NULL CHECK(priority IN ('RENDAH','SEDANG','TINGGI')),
  notes TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE sbm_event_candidates (
  event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES reporters(reporter_id) ON DELETE CASCADE,
  understanding REAL CHECK(understanding IN (0,12.5,25)),
  support REAL CHECK(support IN (0,12.5,25)),
  available TEXT NOT NULL CHECK(available IN ('UNKNOWN','YES','NO')),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(event_id,reporter_id)
);
ALTER TABLE sbm_activities ADD COLUMN event_id TEXT REFERENCES events(event_id) ON DELETE SET NULL;
CREATE UNIQUE INDEX sbm_one_planned_event ON sbm_activities(event_id) WHERE status='PLANNED' AND event_id IS NOT NULL;
CREATE INDEX sbm_event_activities ON sbm_activities(event_id,activity_date);
CREATE TABLE sbm_event_followups (
  followup_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  result TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE sbm_report_quality (
  report_id TEXT PRIMARY KEY REFERENCES reports(report_id) ON DELETE CASCADE,
  quality TEXT NOT NULL CHECK(quality IN ('VALID','REASONABLE','INCOMPLETE','ABUSIVE')),
  timeliness TEXT NOT NULL CHECK(timeliness IN ('TIMELY','LATE','UNKNOWN')),
  completeness TEXT NOT NULL CHECK(completeness IN ('COMPLETE','PARTIAL','UNKNOWN')),
  notes TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Report membership changes invalidate the event assessment. Individual report
-- review/confirmation and original submitted information remain independent.
CREATE TRIGGER sbm_event_source_changed AFTER UPDATE OF event_id ON reports
WHEN OLD.event_id IS NOT NEW.event_id
BEGIN
  UPDATE events SET source_revision=source_revision+1 WHERE event_id IN (OLD.event_id,NEW.event_id);
END;
CREATE TRIGGER sbm_event_source_deleted AFTER DELETE ON reports WHEN OLD.event_id IS NOT NULL
BEGIN
  UPDATE events SET source_revision=source_revision+1 WHERE event_id=OLD.event_id;
END;
