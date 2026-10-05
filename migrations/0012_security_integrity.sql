-- Revoke every existing cookie after a password/PIN reset or account status change.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1 CHECK(session_version >= 1);
ALTER TABLE reporters ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1 CHECK(session_version >= 1);
ALTER TABLE routine_sources ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1 CHECK(session_version >= 1);
