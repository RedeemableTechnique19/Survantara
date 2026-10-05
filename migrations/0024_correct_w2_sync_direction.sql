-- Correct W2 integration direction: Survantara is the aggregate source and SKD-KLB
-- is a read-only consumer. The temporary outbound-only source is disabled.

DELETE FROM integration_source_bindings WHERE integration_key='SKDKLB_W2';
CREATE TABLE IF NOT EXISTS integration_w2_tombstones (
  submission_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  epi_year INTEGER NOT NULL,
  epi_week INTEGER NOT NULL,
  deleted_at TEXT NOT NULL,
  deleted_by TEXT NOT NULL,
  deletion_reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS integration_w2_tombstones_cursor_idx
ON integration_w2_tombstones(deleted_at,submission_id);
