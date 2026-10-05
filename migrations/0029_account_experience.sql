ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN deactivation_reason TEXT;
ALTER TABLE reporters ADD COLUMN last_login_at TEXT;
ALTER TABLE reporters ADD COLUMN deactivation_reason TEXT;
ALTER TABLE routine_sources ADD COLUMN last_login_at TEXT;
ALTER TABLE routine_sources ADD COLUMN deactivation_reason TEXT;
