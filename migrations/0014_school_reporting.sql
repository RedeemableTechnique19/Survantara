-- School reporting timeliness, roster, and first-submission history.
ALTER TABLE school_submissions ADD COLUMN first_submitted_at TEXT;

UPDATE school_submissions
SET first_submitted_at=submitted_at
WHERE first_submitted_at IS NULL;

CREATE INDEX IF NOT EXISTS school_submissions_source_year_idx
  ON school_submissions(source_id,epi_year,epi_week);

-- Provision institutional accounts through the authenticated administrator interface.
