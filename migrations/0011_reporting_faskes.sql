ALTER TABLE routine_sources ADD COLUMN village_code TEXT REFERENCES villages(village_code);
ALTER TABLE routine_sources ADD COLUMN subvillage_name TEXT;

CREATE INDEX IF NOT EXISTS routine_sources_village_idx
  ON routine_sources(village_code, active);

-- Provision institutional accounts through the authenticated administrator interface.
