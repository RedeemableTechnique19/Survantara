-- Make public and cadre reporting use the same event taxonomy and preserve
-- provenance for the SKDR EBS catalogue used during staff verification.

INSERT INTO signal_master(
  signal_code,signal_name_internal,community_label,community_definition,cadre_definition,
  default_priority,immediate_notification,response_target_hours,active,sort_order
) VALUES
  ('PERSON_ILLNESS','Seseorang sakit dengan tanda tidak biasa',
   'Seseorang sakit dengan tanda tidak biasa',
   'Tanda kesehatan yang berat, mendadak, atau tidak biasa pada satu orang',
   'Seseorang sakit dengan tanda tidak biasa','RENDAH',0,24,1,1),
  ('ANIMAL_EXPOSURE','Gigitan atau pajanan hewan',
   'Gigitan, cakaran, liur, atau pajanan hewan',
   'Gigitan atau kontak berisiko antara manusia dengan mamalia, ular, atau hewan sakit/mati',
   'Gigitan atau pajanan hewan','TINGGI',1,2,1,8)
ON CONFLICT(signal_code) DO UPDATE SET
  signal_name_internal=excluded.signal_name_internal,
  community_label=excluded.community_label,
  community_definition=excluded.community_definition,
  cadre_definition=excluded.cadre_definition,
  default_priority=excluded.default_priority,
  immediate_notification=excluded.immediate_notification,
  response_target_hours=excluded.response_target_hours,
  active=excluded.active,
  sort_order=excluded.sort_order;

-- A direct human exposure is distinct from merely observing sick/dead animals.
INSERT INTO context_master(
  context_code,public_label,public_help,default_priority,immediate_notification,active,sort_order
) VALUES (
  'SICK_DEAD_ANIMAL_CONTACT','Kontak dengan hewan/unggas sakit atau mati',
  'Seseorang menyentuh, menangani, menyembelih, atau terkena cairan tubuh hewan yang sakit atau mati.',
  'TINGGI',1,1,8
)
ON CONFLICT(context_code) DO UPDATE SET
  public_label=excluded.public_label,
  public_help=excluded.public_help,
  default_priority=excluded.default_priority,
  immediate_notification=excluded.immediate_notification,
  active=excluded.active,
  sort_order=excluded.sort_order;

-- Keep display ordering deterministic after inserting the direct-contact context.
UPDATE context_master SET sort_order=9 WHERE context_code='RODENT_CONTACT';
UPDATE context_master SET sort_order=10 WHERE context_code='TRAVEL_CONTACT';
UPDATE context_master SET sort_order=11 WHERE context_code='SCHOOL_WORKPLACE_CLUSTER';
UPDATE context_master SET sort_order=12 WHERE context_code='CHEMICAL_EXPOSURE';
UPDATE context_master SET sort_order=13 WHERE context_code='UNKNOWN_CONTEXT';

-- Direct contact with a sick/dead animal is relevant to these zoonotic filters.
INSERT OR IGNORE INTO ebs_mapping_rules(ebs_id,trigger_type,trigger_code) VALUES
  ('294','CONTEXT','SICK_DEAD_ANIMAL_CONTACT'),
  ('196','CONTEXT','SICK_DEAD_ANIMAL_CONTACT');

-- Retire the misleading compatibility name. Existing records are converted to
-- the neutral category; verified EBS classifications remain unchanged.
UPDATE reports SET signal_code='ANIMAL_EXPOSURE' WHERE signal_code='RABIES';
UPDATE events SET verified_signal_code='ANIMAL_EXPOSURE' WHERE verified_signal_code='RABIES';
UPDATE signal_master SET active=0 WHERE signal_code='RABIES';

-- Align legacy signal settings with the event-type master used for triage.
UPDATE signal_master SET immediate_notification=1 WHERE signal_code IN ('CLUSTER','SCHOOL');

-- Backfill canonical event types for older cadre reports as well as public data.
UPDATE reports SET event_type=CASE signal_code
  WHEN 'PERSON_ILLNESS' THEN 'PERSON_ILLNESS'
  WHEN 'FOOD' THEN 'CLUSTER'
  WHEN 'CLUSTER' THEN 'CLUSTER'
  WHEN 'DEATH' THEN 'UNUSUAL_DEATH'
  WHEN 'SCHOOL' THEN 'SCHOOL_WORKPLACE'
  WHEN 'ENV' THEN 'ENVIRONMENTAL'
  WHEN 'ZOONOSIS' THEN 'ANIMAL_EVENT'
  WHEN 'ZOONOSIS_HUMAN' THEN 'PERSON_ILLNESS'
  WHEN 'ANIMAL_EXPOSURE' THEN 'ANIMAL_EXPOSURE'
  ELSE 'OTHER'
END
WHERE event_type IS NULL OR event_type='';

ALTER TABLE ebs_disease_master ADD COLUMN catalog_version TEXT NOT NULL DEFAULT 'SKDR-EBS-2025';
ALTER TABLE ebs_disease_master ADD COLUMN source_authority TEXT NOT NULL DEFAULT 'Kementerian Kesehatan Republik Indonesia';
ALTER TABLE ebs_disease_master ADD COLUMN source_url TEXT NOT NULL DEFAULT 'https://surveilans.kemkes.go.id/berita/skdr-event-based-surveillance-ebs';
ALTER TABLE ebs_disease_master ADD COLUMN source_published_at TEXT NOT NULL DEFAULT '2025-05-05';
