-- Keep draft completion separate from stored zero values. A zero can mean either
-- "reviewed and nihil" or "not reviewed yet", so the UI needs explicit progress.

ALTER TABLE w2_submissions ADD COLUMN reviewed_codes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE w2_submissions ADD COLUMN total_visits_reviewed INTEGER NOT NULL DEFAULT 0;

-- Submitted reports have necessarily completed the aggregate workflow. Their
-- indicator list is reconstructed from the active catalogue when read.
UPDATE w2_submissions
SET total_visits_reviewed=1
WHERE submission_status='SUBMITTED';
