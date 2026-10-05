PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','EPIDEMIOLOG','VERIFIKATOR','PETUGAS_PROGRAM','PIMPINAN','VIEWER')),
  program TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reporters (
  reporter_id TEXT PRIMARY KEY,
  cadre_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT,
  village_code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS villages (
  village_code TEXT PRIMARY KEY,
  village_name TEXT NOT NULL,
  subdistrict TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS signal_master (
  signal_code TEXT PRIMARY KEY,
  signal_name_internal TEXT NOT NULL,
  community_label TEXT NOT NULL,
  community_definition TEXT NOT NULL,
  cadre_definition TEXT NOT NULL,
  default_priority TEXT NOT NULL CHECK(default_priority IN ('RENDAH','SEDANG','TINGGI')),
  immediate_notification INTEGER NOT NULL DEFAULT 0,
  response_target_hours INTEGER NOT NULL DEFAULT 24,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reports (
  report_id TEXT PRIMARY KEY,
  event_id TEXT,
  submission_channel TEXT NOT NULL CHECK(submission_channel IN ('PUBLIC','CADRE')),
  reporter_type TEXT NOT NULL,
  reporter_id TEXT,
  reporter_name TEXT,
  reporter_phone TEXT,
  reporter_verified INTEGER NOT NULL DEFAULT 0,
  anonymous INTEGER NOT NULL DEFAULT 0,
  allow_contact INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL,
  signal_code TEXT NOT NULL REFERENCES signal_master(signal_code),
  village_code TEXT NOT NULL REFERENCES villages(village_code),
  location_text TEXT,
  event_start_date TEXT,
  reported_cases INTEGER NOT NULL CHECK(reported_cases >= 0),
  reported_deaths INTEGER NOT NULL CHECK(reported_deaths >= 0),
  severe_cases INTEGER NOT NULL DEFAULT 0 CHECK(severe_cases >= 0),
  hospitalized_cases INTEGER NOT NULL DEFAULT 0 CHECK(hospitalized_cases >= 0),
  affected_group TEXT,
  epidemiological_link TEXT,
  description TEXT NOT NULL,
  initial_action TEXT,
  contact_person TEXT,
  latitude REAL,
  longitude REAL,
  attachment_key TEXT,
  initial_priority TEXT NOT NULL CHECK(initial_priority IN ('RENDAH','SEDANG','TINGGI')),
  current_priority TEXT NOT NULL CHECK(current_priority IN ('RENDAH','SEDANG','TINGGI')),
  triage_reason TEXT NOT NULL,
  triage_rule_version TEXT NOT NULL,
  current_status TEXT NOT NULL,
  assigned_to TEXT,
  public_pin_salt TEXT NOT NULL,
  public_pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_dashboard_idx ON reports(current_status, current_priority, submitted_at DESC);
CREATE INDEX IF NOT EXISTS reports_assignment_idx ON reports(assigned_to, current_status);
CREATE INDEX IF NOT EXISTS reports_event_idx ON reports(event_id);
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  event_title TEXT NOT NULL,
  verified_signal_code TEXT NOT NULL REFERENCES signal_master(signal_code),
  event_start_date TEXT,
  village_code TEXT REFERENCES villages(village_code),
  location_summary TEXT,
  verified_cases INTEGER NOT NULL DEFAULT 0,
  verified_deaths INTEGER NOT NULL DEFAULT 0,
  verified_severe_cases INTEGER NOT NULL DEFAULT 0,
  affected_population TEXT,
  epidemiological_summary TEXT,
  risk_level TEXT NOT NULL DEFAULT 'SEDANG',
  risk_notes TEXT,
  current_status TEXT NOT NULL DEFAULT 'DRAFT',
  lead_investigator TEXT NOT NULL,
  program_owner TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS verifications (
  verification_id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(report_id),
  event_id TEXT,
  verified_at TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  verification_method TEXT,
  contact_result TEXT,
  actual_cases INTEGER NOT NULL DEFAULT 0,
  actual_deaths INTEGER NOT NULL DEFAULT 0,
  actual_severe_cases INTEGER NOT NULL DEFAULT 0,
  epidemiological_link TEXT,
  affected_population TEXT,
  verification_result TEXT,
  recommended_action TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS responses (
  response_id TEXT PRIMARY KEY,
  event_id TEXT,
  report_id TEXT,
  response_date TEXT NOT NULL,
  response_type TEXT NOT NULL,
  responsible_officer TEXT NOT NULL,
  description TEXT NOT NULL,
  result TEXT,
  follow_up_required INTEGER NOT NULL DEFAULT 0,
  follow_up_date TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS status_history (
  history_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS history_entity_idx ON status_history(entity_type, entity_id, changed_at);
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
