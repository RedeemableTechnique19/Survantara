CREATE TABLE posyandu (
  posyandu_id TEXT PRIMARY KEY,
  village_code TEXT NOT NULL REFERENCES villages(village_code),
  name TEXT NOT NULL,
  UNIQUE(village_code,name)
);
ALTER TABLE reporters ADD COLUMN posyandu_id TEXT REFERENCES posyandu(posyandu_id);

CREATE TABLE sbm_screenings (
  report_id TEXT PRIMARY KEY REFERENCES reports(report_id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK(decision IN ('FOLLOW_UP','CLARIFY','NOT_RELEVANT')),
  quality TEXT NOT NULL CHECK(quality IN ('VALID','REASONABLE','INCOMPLETE','ABUSIVE')),
  priority TEXT NOT NULL CHECK(priority IN ('RENDAH','SEDANG','TINGGI')),
  timeliness TEXT NOT NULL CHECK(timeliness IN ('TIMELY','LATE','UNKNOWN')),
  completeness TEXT NOT NULL CHECK(completeness IN ('COMPLETE','PARTIAL','UNKNOWN')),
  cadre_needed INTEGER NOT NULL CHECK(cadre_needed IN (0,1)),
  notes TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE sbm_clarifications (
  clarification_id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES reporters(reporter_id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT,
  requested_at TEXT NOT NULL,
  answered_at TEXT
);
CREATE TABLE sbm_activities (
  activity_id TEXT PRIMARY KEY,
  activity_date TEXT NOT NULL,
  village_code TEXT NOT NULL REFERENCES villages(village_code),
  location TEXT NOT NULL,
  officer_email TEXT NOT NULL,
  reporter_id TEXT REFERENCES reporters(reporter_id) ON DELETE SET NULL,
  cadre_name TEXT NOT NULL,
  selection_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','DONE','CANCELLED')),
  result TEXT NOT NULL DEFAULT '',
  officer_attended INTEGER NOT NULL DEFAULT 0 CHECK(officer_attended IN (0,1)),
  cadre_attended INTEGER NOT NULL DEFAULT 0 CHECK(cadre_attended IN (0,1)),
  officer_oh INTEGER NOT NULL DEFAULT 0 CHECK(officer_oh >= 0),
  cadre_oh INTEGER NOT NULL DEFAULT 0 CHECK(cadre_oh >= 0),
  payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(payment_status IN ('PENDING','APPROVED','PAID')),
  payment_reference TEXT NOT NULL DEFAULT '',
  pe_required INTEGER NOT NULL DEFAULT 0 CHECK(pe_required IN (0,1)),
  pe_reference TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  CHECK(status='DONE' OR (officer_oh=0 AND cadre_oh=0 AND payment_status='PENDING')),
  CHECK(officer_oh=0 OR officer_attended=1),
  CHECK(cadre_oh=0 OR cadre_attended=1),
  CHECK(payment_status='PENDING' OR (officer_oh+cadre_oh)>0)
);
CREATE UNIQUE INDEX sbm_officer_day ON sbm_activities(officer_email,activity_date) WHERE status<>'CANCELLED';
CREATE UNIQUE INDEX sbm_cadre_day ON sbm_activities(reporter_id,activity_date) WHERE status<>'CANCELLED';
CREATE TABLE sbm_activity_reports (
  activity_id TEXT NOT NULL REFERENCES sbm_activities(activity_id) ON DELETE CASCADE,
  report_id TEXT NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  PRIMARY KEY(activity_id,report_id)
);
