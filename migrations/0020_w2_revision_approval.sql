CREATE TABLE IF NOT EXISTS w2_revision_requests (
  request_id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES w2_submissions(submission_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES routine_sources(source_id),
  epi_year INTEGER NOT NULL,
  epi_week INTEGER NOT NULL CHECK(epi_week BETWEEN 1 AND 53),
  proposed_revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  requested_at TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  decision_notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS w2_revision_requests_one_pending_idx
  ON w2_revision_requests(submission_id) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS w2_revision_requests_status_idx
  ON w2_revision_requests(status, requested_at);
