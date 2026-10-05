CREATE TABLE IF NOT EXISTS integration_report_tombstones (
  report_id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL,
  deleted_by TEXT NOT NULL,
  deletion_reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS integration_report_tombstones_cursor_idx
  ON integration_report_tombstones(deleted_at, report_id);
