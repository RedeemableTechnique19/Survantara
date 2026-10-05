CREATE TABLE IF NOT EXISTS integration_school_tombstones (
  submission_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  epi_year INTEGER NOT NULL,
  epi_week INTEGER NOT NULL,
  deleted_at TEXT NOT NULL,
  deleted_by TEXT NOT NULL,
  deletion_reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS integration_school_tombstones_cursor_idx
ON integration_school_tombstones(deleted_at,submission_id);
