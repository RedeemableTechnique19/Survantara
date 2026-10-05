-- Dedicated aggregate-only W2 channel for the local SKD-KLB installation.
-- Integration bindings are configured per installation; no accounts are provisioned here.

ALTER TABLE routine_sources ADD COLUMN integration_only INTEGER NOT NULL DEFAULT 0
  CHECK(integration_only IN (0,1));

CREATE TABLE IF NOT EXISTS integration_source_bindings (
  integration_key TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES routine_sources(source_id),
  created_at TEXT NOT NULL
);

ALTER TABLE w2_submissions ADD COLUMN data_origin TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE w2_submissions ADD COLUMN details_retained_locally INTEGER NOT NULL DEFAULT 0
  CHECK(details_retained_locally IN (0,1));

CREATE TABLE IF NOT EXISTS skdklb_w2_receipts (
  receipt_id TEXT PRIMARY KEY,
  epi_year INTEGER NOT NULL,
  epi_week INTEGER NOT NULL CHECK(epi_week BETWEEN 1 AND 53),
  source_fingerprint TEXT NOT NULL,
  submission_id TEXT NOT NULL REFERENCES w2_submissions(submission_id),
  revision INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE(epi_year,epi_week,source_fingerprint)
);

CREATE INDEX IF NOT EXISTS skdklb_w2_receipts_submission_idx
ON skdklb_w2_receipts(submission_id,revision);
