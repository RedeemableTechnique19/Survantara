-- One reusable enrollment baseline per school and academic year.
CREATE TABLE IF NOT EXISTS school_enrollment_profiles (
  source_id TEXT NOT NULL REFERENCES routine_sources(source_id),
  academic_year_start INTEGER NOT NULL CHECK(academic_year_start BETWEEN 2020 AND 2100),
  enrolled_count INTEGER NOT NULL CHECK(enrolled_count >= 0),
  confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY(source_id, academic_year_start)
);

CREATE INDEX IF NOT EXISTS school_enrollment_profiles_year_idx
  ON school_enrollment_profiles(academic_year_start, source_id);
