-- Version credential work factors so legacy hashes can be upgraded on login.
ALTER TABLE users ADD COLUMN password_iterations INTEGER NOT NULL DEFAULT 100000 CHECK(password_iterations >= 100000);
ALTER TABLE reporters ADD COLUMN pin_iterations INTEGER NOT NULL DEFAULT 100000 CHECK(pin_iterations >= 100000);
ALTER TABLE routine_sources ADD COLUMN pin_iterations INTEGER NOT NULL DEFAULT 100000 CHECK(pin_iterations >= 100000);
ALTER TABLE reports ADD COLUMN public_pin_iterations INTEGER NOT NULL DEFAULT 100000 CHECK(public_pin_iterations >= 100000);

-- Optional TOTP MFA for staff accounts. Secrets are encrypted before storage.
ALTER TABLE users ADD COLUMN mfa_secret_encrypted TEXT;
ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0 CHECK(mfa_enabled IN (0,1));

-- Server-side session registry makes individual logout and revocation possible.
CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY,
  account_kind TEXT NOT NULL CHECK(account_kind IN ('staff','cadre','routine')),
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS auth_sessions_account_idx ON auth_sessions(account_kind,account_id,revoked_at);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);
