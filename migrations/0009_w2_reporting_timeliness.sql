-- Preserve the first time a W2 report was actually submitted. Later drafts or
-- revisions continue to update submitted_at, but must not change timeliness.

ALTER TABLE w2_submissions ADD COLUMN first_submitted_at TEXT;

-- Older W2 rows predate explicit draft status. Their earliest revision is the
-- best available evidence of the original submission time. Newer rows use the
-- first revision whose snapshot is explicitly SUBMITTED.
UPDATE w2_submissions
SET first_submitted_at = COALESCE(
  (
    SELECT MIN(log.changed_at)
    FROM routine_revision_log log
    WHERE log.submission_type='W2'
      AND log.submission_id=w2_submissions.submission_id
      AND (
        json_extract(log.snapshot_json,'$.submission_status')='SUBMITTED'
        OR json_type(log.snapshot_json,'$.submission_status') IS NULL
      )
  ),
  submitted_at
)
WHERE submission_status='SUBMITTED' AND first_submitted_at IS NULL;

CREATE INDEX IF NOT EXISTS w2_submissions_source_year_status_idx
ON w2_submissions(source_id,epi_year,submission_status,epi_week);
