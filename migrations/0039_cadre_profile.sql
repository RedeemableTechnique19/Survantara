-- Existing cadres choose their own nickname on their next portal visit.
-- Do not invent a nickname from a legal name or change historical reports.
ALTER TABLE reporters ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
