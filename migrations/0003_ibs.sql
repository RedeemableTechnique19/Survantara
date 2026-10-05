CREATE TABLE IF NOT EXISTS routine_sources (
  source_id TEXT PRIMARY KEY,
  source_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  source_type TEXT NOT NULL CHECK(source_type IN ('FASKES','SEKOLAH')),
  network_type TEXT CHECK(network_type IN ('JEJARING','JARINGAN')),
  source_name TEXT NOT NULL,
  program_area TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((source_type='FASKES' AND network_type IS NOT NULL) OR (source_type='SEKOLAH' AND network_type IS NULL))
);
CREATE TABLE IF NOT EXISTS w2_indicators (
  indicator_code TEXT PRIMARY KEY,
  indicator_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS routine_week_locks (
  epi_year INTEGER NOT NULL,
  epi_week INTEGER NOT NULL CHECK(epi_week BETWEEN 1 AND 53),
  locked_at TEXT NOT NULL,
  locked_by TEXT NOT NULL,
  PRIMARY KEY(epi_year, epi_week)
);
CREATE TABLE IF NOT EXISTS w2_submissions (
  submission_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES routine_sources(source_id),
  epi_year INTEGER NOT NULL,
  epi_week INTEGER NOT NULL CHECK(epi_week BETWEEN 1 AND 53),
  submitted_at TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  UNIQUE(source_id, epi_year, epi_week)
);
CREATE TABLE IF NOT EXISTS w2_values (
  submission_id TEXT NOT NULL REFERENCES w2_submissions(submission_id),
  indicator_code TEXT NOT NULL REFERENCES w2_indicators(indicator_code),
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY(submission_id, indicator_code)
);
CREATE TABLE IF NOT EXISTS school_submissions (
  submission_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES routine_sources(source_id),
  epi_year INTEGER NOT NULL,
  epi_week INTEGER NOT NULL CHECK(epi_week BETWEEN 1 AND 53),
  enrolled_count INTEGER NOT NULL CHECK(enrolled_count >= 0),
  sick_absent_count INTEGER NOT NULL CHECK(sick_absent_count >= 0 AND sick_absent_count <= enrolled_count),
  sick_percentage REAL NOT NULL CHECK(sick_percentage >= 0),
  notes TEXT,
  submitted_at TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(source_id, epi_year, epi_week)
);
CREATE TABLE IF NOT EXISTS ibs_thresholds (
  threshold_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK(target_type IN ('W2','SEKOLAH')),
  target_code TEXT NOT NULL,
  minimum_value REAL NOT NULL CHECK(minimum_value >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(target_type, target_code)
);
CREATE TABLE IF NOT EXISTS ibs_review_markers (
  marker_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES routine_sources(source_id),
  epi_year INTEGER NOT NULL,
  epi_week INTEGER NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('W2','SEKOLAH')),
  target_code TEXT NOT NULL,
  observed_value REAL NOT NULL,
  threshold_value REAL NOT NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  notes TEXT,
  UNIQUE(source_id, epi_year, epi_week, target_type, target_code)
);
CREATE TABLE IF NOT EXISTS routine_revision_log (
  revision_id TEXT PRIMARY KEY,
  submission_type TEXT NOT NULL CHECK(submission_type IN ('W2','SEKOLAH')),
  submission_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES routine_sources(source_id),
  epi_year INTEGER NOT NULL,
  epi_week INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS routine_sources_type_idx ON routine_sources(source_type, network_type, active);
CREATE INDEX IF NOT EXISTS w2_submissions_period_idx ON w2_submissions(epi_year, epi_week, source_id);
CREATE INDEX IF NOT EXISTS school_submissions_period_idx ON school_submissions(epi_year, epi_week, source_id);
CREATE INDEX IF NOT EXISTS ibs_markers_period_idx ON ibs_review_markers(epi_year, epi_week, reviewed_at);
