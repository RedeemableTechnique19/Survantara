-- Validity is an admin decision, independent of verification and score.
CREATE TABLE report_validations (
  report_id TEXT PRIMARY KEY REFERENCES reports(report_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('VALID','INVALID','NEEDS_CLARIFICATION')),
  notes TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Preserve explicitly confirmed historical reviews; do not presume other reports valid.
INSERT INTO report_validations(report_id,status,notes,updated_by,updated_at)
SELECT report_id,'VALID','Laporan telah dikonfirmasi melalui peninjauan sebelumnya.',decided_by,decided_at
FROM report_decisions WHERE outcome='CONFIRMED';
ALTER TABLE events ADD COLUMN verified_source_revision INTEGER;
ALTER TABLE sbm_event_followups ADD COLUMN source_revision INTEGER;
CREATE TABLE sbm_incident_verifications (
  event_id TEXT PRIMARY KEY REFERENCES events(event_id) ON DELETE CASCADE,
  source_revision INTEGER NOT NULL,
  verification_method TEXT NOT NULL,
  result TEXT NOT NULL,
  verified_ebs_id TEXT NOT NULL REFERENCES ebs_disease_master(ebs_id),
  verified_by TEXT NOT NULL,
  verified_at TEXT NOT NULL
);
-- Empty until the actual administrative area list is supplied. No invented areas.
CREATE TABLE report_locations (
  location_id TEXT PRIMARY KEY,
  village_code TEXT NOT NULL REFERENCES villages(village_code),
  parent_id TEXT REFERENCES report_locations(location_id),
  level TEXT NOT NULL CHECK(level IN ('DUKUH','RW','RT')),
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
ALTER TABLE reports ADD COLUMN dukuh_id TEXT REFERENCES report_locations(location_id);
ALTER TABLE reports ADD COLUMN rw_id TEXT REFERENCES report_locations(location_id);
ALTER TABLE reports ADD COLUMN rt_id TEXT REFERENCES report_locations(location_id);
ALTER TABLE reports ADD COLUMN severe_cases_known INTEGER NOT NULL DEFAULT 1 CHECK(severe_cases_known IN (0,1));
-- New questions/answers change the information used to verify an unconfirmed signal.
CREATE TRIGGER sbm_signal_question_added AFTER INSERT ON sbm_clarifications
BEGIN
  UPDATE events SET source_revision=source_revision+1 WHERE origin='SIGNAL'
    AND event_id=(SELECT event_id FROM reports WHERE report_id=NEW.report_id);
END;
CREATE TRIGGER sbm_signal_question_answered AFTER UPDATE OF answered_at ON sbm_clarifications
WHEN OLD.answered_at IS NOT NEW.answered_at
BEGIN
  UPDATE events SET source_revision=source_revision+1 WHERE origin='SIGNAL'
    AND event_id=(SELECT event_id FROM reports WHERE report_id=NEW.report_id);
END;
