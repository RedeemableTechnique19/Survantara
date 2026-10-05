CREATE TABLE IF NOT EXISTS w2_deadline_policies (
  policy_id TEXT PRIMARY KEY,
  effective_epi_year INTEGER NOT NULL,
  effective_epi_week INTEGER NOT NULL CHECK(effective_epi_week BETWEEN 1 AND 53),
  deadline_hour INTEGER NOT NULL CHECK(deadline_hour BETWEEN 0 AND 23),
  deadline_minute INTEGER NOT NULL CHECK(deadline_minute BETWEEN 0 AND 59),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE(effective_epi_year, effective_epi_week)
);

INSERT OR IGNORE INTO w2_deadline_policies
  (policy_id,effective_epi_year,effective_epi_week,deadline_hour,deadline_minute,created_at,created_by)
VALUES('W2-DEADLINE-INITIAL',2020,1,9,0,'2020-01-01T00:00:00.000Z','SYSTEM');

CREATE INDEX IF NOT EXISTS w2_deadline_policies_effective_idx
  ON w2_deadline_policies(effective_epi_year,effective_epi_week);
