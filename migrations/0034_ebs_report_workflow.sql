-- Stage 1 report handling is independent of the existing verification/event status.
ALTER TABLE reports ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'SUBMITTED'
  CHECK(workflow_status IN ('SUBMITTED','UNDER_REVIEW','NEEDS_CLARIFICATION','CLOSED'));
ALTER TABLE reports ADD COLUMN workflow_actor TEXT;
ALTER TABLE reports ADD COLUMN workflow_changed_at TEXT;
ALTER TABLE sbm_clarifications ADD COLUMN requested_by TEXT;
ALTER TABLE sbm_clarifications ADD COLUMN answered_by TEXT;

UPDATE sbm_clarifications SET requested_by=(SELECT updated_by FROM sbm_screenings s WHERE s.report_id=sbm_clarifications.report_id);
UPDATE sbm_clarifications SET answered_by=reporter_id WHERE answered_at IS NOT NULL;
UPDATE reports SET workflow_status= CASE
  WHEN current_status IN ('SELESAI','DITOLAK','DUPLIKAT') THEN 'CLOSED'
  WHEN EXISTS(SELECT 1 FROM sbm_clarifications c WHERE c.report_id=reports.report_id AND c.answered_at IS NULL) THEN 'NEEDS_CLARIFICATION'
  WHEN current_status='MEMERLUKAN_INFORMASI' THEN 'NEEDS_CLARIFICATION'
  WHEN current_status='BARU' THEN 'SUBMITTED' ELSE 'UNDER_REVIEW' END ,
  workflow_actor=updated_by,workflow_changed_at=updated_at;

INSERT INTO status_history(history_id,entity_type,entity_id,old_status,new_status,changed_at,changed_by,notes)
SELECT 'EBS-MIG-'||report_id,'EBS_REPORT',report_id,NULL,workflow_status,COALESCE(updated_at,submitted_at),updated_by,
  'Status awal workflow EBS dari data existing; waktu pemeriksaan awal tidak diketahui.' FROM reports;

CREATE INDEX reports_workflow_inbox ON reports(workflow_status,submitted_at DESC);
CREATE INDEX clarifications_report_time ON sbm_clarifications(report_id,requested_at);

CREATE TRIGGER ebs_report_created AFTER INSERT ON reports BEGIN
  INSERT INTO status_history(history_id,entity_type,entity_id,old_status,new_status,changed_at,changed_by,notes)
  VALUES('EBS-'||lower(hex(randomblob(16))),'EBS_REPORT',NEW.report_id,NULL,'SUBMITTED',NEW.submitted_at,NEW.created_by,'Laporan dikirim.');
END;

CREATE TRIGGER ebs_workflow_history AFTER UPDATE OF workflow_status ON reports
WHEN OLD.workflow_status<>NEW.workflow_status BEGIN
  INSERT INTO status_history(history_id,entity_type,entity_id,old_status,new_status,changed_at,changed_by,notes)
  VALUES('EBS-'||lower(hex(randomblob(16))),'EBS_REPORT',NEW.report_id,OLD.workflow_status,NEW.workflow_status,
    NEW.workflow_changed_at,NEW.workflow_actor, 'Perubahan workflow laporan.' );
  INSERT INTO audit_log(audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes)
  VALUES('EBS-'||lower(hex(randomblob(16))),NEW.workflow_changed_at,NEW.workflow_actor,'EBS_STATUS','REPORT',NEW.report_id,
    json_object('workflow_status',OLD.workflow_status),json_object('workflow_status',NEW.workflow_status),'Workflow laporan Tahap 1');
END;

CREATE TRIGGER ebs_clarification_guard BEFORE INSERT ON sbm_clarifications BEGIN
  SELECT RAISE(ABORT,'EBS_CLARIFICATION_CLOSED_OR_OWNER') WHERE NOT EXISTS(SELECT 1 FROM reports r WHERE r.report_id=NEW.report_id AND r.reporter_id=NEW.reporter_id AND r.workflow_status<>'CLOSED');
END;

CREATE TRIGGER ebs_clarification_requested AFTER INSERT ON sbm_clarifications BEGIN
  UPDATE reports SET workflow_status='NEEDS_CLARIFICATION',workflow_actor=COALESCE(NEW.requested_by,'unknown'),workflow_changed_at=NEW.requested_at,
    updated_at=NEW.requested_at,updated_by=COALESCE(NEW.requested_by,'unknown') WHERE report_id=NEW.report_id;
  INSERT INTO audit_log(audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes)
  VALUES('EBS-'||lower(hex(randomblob(16))),NEW.requested_at,COALESCE(NEW.requested_by,'unknown'),'EBS_CLARIFICATION_REQUEST','REPORT',NEW.report_id,'{}',json_object('clarification_id',NEW.clarification_id),'Permintaan klarifikasi');
END;

CREATE TRIGGER ebs_answer_guard BEFORE UPDATE OF answer,answered_at ON sbm_clarifications
WHEN NEW.answered_at IS NOT NULL BEGIN
  SELECT RAISE(ABORT,'EBS_ANSWER_CLOSED_OR_ALREADY_ANSWERED') WHERE OLD.answered_at IS NOT NULL OR EXISTS(SELECT 1 FROM reports WHERE report_id=NEW.report_id AND workflow_status='CLOSED');
END;

CREATE TRIGGER ebs_clarification_answered AFTER UPDATE OF answered_at ON sbm_clarifications
WHEN OLD.answered_at IS NULL AND NEW.answered_at IS NOT NULL BEGIN
  UPDATE reports SET workflow_actor=COALESCE(NEW.answered_by,NEW.reporter_id),workflow_changed_at=NEW.answered_at,updated_at=NEW.answered_at,updated_by=COALESCE(NEW.answered_by,NEW.reporter_id) WHERE report_id=NEW.report_id;
  UPDATE reports SET workflow_status='UNDER_REVIEW' WHERE report_id=NEW.report_id AND NOT EXISTS(SELECT 1 FROM sbm_clarifications c WHERE c.report_id=NEW.report_id AND c.answered_at IS NULL);
  INSERT INTO audit_log(audit_id,timestamp,user_email,action,entity_type,entity_id,before_json,after_json,notes)
  VALUES('EBS-'||lower(hex(randomblob(16))),NEW.answered_at,COALESCE(NEW.answered_by,NEW.reporter_id),'EBS_CLARIFICATION_ANSWER','REPORT',NEW.report_id,'{}',json_object('clarification_id',NEW.clarification_id),'Jawaban klarifikasi');
END;

-- Existing verification users can still finish a report through the legacy workflow.
CREATE TRIGGER ebs_legacy_closed AFTER UPDATE OF current_status ON reports
WHEN NEW.current_status IN ('SELESAI','DITOLAK','DUPLIKAT') AND NEW.workflow_status<>'CLOSED' BEGIN
  UPDATE reports SET workflow_status='CLOSED',workflow_actor=NEW.updated_by,workflow_changed_at=NEW.updated_at WHERE report_id=NEW.report_id;
END;
