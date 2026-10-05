ALTER TABLE reports ADD COLUMN reported_cases_known INTEGER NOT NULL DEFAULT 1 CHECK(reported_cases_known IN (0,1));
ALTER TABLE reports ADD COLUMN reported_deaths_known INTEGER NOT NULL DEFAULT 1 CHECK(reported_deaths_known IN (0,1));
ALTER TABLE reports ADD COLUMN hospitalized_cases_known INTEGER NOT NULL DEFAULT 1 CHECK(hospitalized_cases_known IN (0,1));
