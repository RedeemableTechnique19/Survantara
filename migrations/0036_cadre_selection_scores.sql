CREATE TABLE sbm_candidate_assessments (
  report_id TEXT NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES reporters(reporter_id) ON DELETE CASCADE,
  understanding REAL CHECK(understanding IN (0,12.5,25)),
  support REAL CHECK(support IN (0,12.5,25)),
  available TEXT NOT NULL CHECK(available IN ('UNKNOWN','YES','NO')),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(report_id,reporter_id)
);
ALTER TABLE sbm_activities ADD COLUMN selection_snapshot TEXT NOT NULL DEFAULT '';
