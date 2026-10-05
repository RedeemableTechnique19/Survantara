-- One final report decision; incident handling continues independently.
CREATE TABLE report_decisions (
  decision_id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL UNIQUE REFERENCES reports(report_id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK(outcome IN ('CONFIRMED','NOT_CONFIRMED','UNVERIFIABLE')),
  notes TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  contact_result TEXT NOT NULL DEFAULT '',
  verified_ebs_id TEXT REFERENCES ebs_disease_master(ebs_id),
  actual_cases INTEGER CHECK(actual_cases IS NULL OR actual_cases>=0),
  actual_deaths INTEGER CHECK(actual_deaths IS NULL OR (actual_cases IS NOT NULL AND actual_deaths BETWEEN 0 AND actual_cases)),
  actual_severe_cases INTEGER CHECK(actual_severe_cases IS NULL OR (actual_cases IS NOT NULL AND actual_severe_cases BETWEEN 0 AND actual_cases)),
  decided_at TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  CHECK(outcome<>'CONFIRMED' OR (verified_ebs_id IS NOT NULL AND actual_cases IS NOT NULL AND actual_deaths IS NOT NULL AND actual_severe_cases IS NOT NULL))
);

-- Old information-only closures with unfinished report handling need a final
-- decision in the new flow. Keep their earlier closure/history intact.
UPDATE reports SET workflow_status='UNDER_REVIEW',
  workflow_actor='SYSTEM:REPORT_REVIEW',workflow_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  updated_by='SYSTEM:REPORT_REVIEW',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE workflow_status='CLOSED' AND current_status NOT IN ('SELESAI','DITOLAK','DUPLIKAT');
