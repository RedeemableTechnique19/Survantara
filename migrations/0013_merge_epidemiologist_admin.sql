-- ADMIN now includes the former epidemiologist duties. Promote any existing
-- epidemiologist accounts, revoke their old sessions, and remove the retired
-- role from the database constraint.
INSERT INTO audit_log(
  audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes
)
SELECT
  'AUD-MIG-0013-' || substr(hex(randomblob(8)),1,16),
  datetime('now'),
  'SYSTEM',
  'MERGE_EPIDEMIOLOGIST_INTO_ADMIN',
  'USER',
  user_id,
  '{"role":"EPIDEMIOLOG"}',
  '{"role":"ADMIN"}',
  'Peran epidemiolog digabungkan ke administrator.'
FROM users
WHERE role='EPIDEMIOLOG';

CREATE TABLE users_merged (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','VERIFIKATOR','PETUGAS_PROGRAM','PIMPINAN','VIEWER')),
  program TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 1 CHECK(session_version >= 1)
);

INSERT INTO users_merged(
  user_id,email,name,role,program,active,password_salt,password_hash,
  created_at,updated_at,session_version
)
SELECT
  user_id,email,name,
  CASE WHEN role='EPIDEMIOLOG' THEN 'ADMIN' ELSE role END,
  program,active,password_salt,password_hash,created_at,datetime('now'),
  session_version + CASE WHEN role='EPIDEMIOLOG' THEN 1 ELSE 0 END
FROM users;

DROP TABLE users;
ALTER TABLE users_merged RENAME TO users;
