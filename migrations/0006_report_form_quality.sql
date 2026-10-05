-- Align public and cadre signal wording with the information each form collects.
UPDATE event_type_master
SET public_label='Seseorang sakit dengan tanda tidak biasa',
    public_help='Tanda kesehatan yang berat, mendadak, atau tidak biasa pada satu orang.'
WHERE event_type='PERSON_ILLNESS';

UPDATE signal_master
SET signal_name_internal='Hewan atau unggas sakit/mati tidak biasa',
    community_label='Hewan atau unggas sakit atau mati mendadak',
    community_definition='Hewan atau unggas sakit atau mati secara mendadak dan tidak biasa',
    cadre_definition='Hewan atau unggas sakit/mati tidak biasa',
    sort_order=6
WHERE signal_code='ZOONOSIS';

INSERT INTO signal_master(
  signal_code,signal_name_internal,community_label,community_definition,cadre_definition,
  default_priority,immediate_notification,response_target_hours,active,sort_order
) VALUES (
  'ZOONOSIS_HUMAN','Manusia sakit setelah kontak dengan hewan',
  'Orang sakit setelah kontak dengan hewan sakit atau mati',
  'Keluhan pada manusia yang muncul setelah kontak dengan hewan atau unggas sakit/mati',
  'Orang sakit setelah kontak dengan hewan sakit/mati',
  'TINGGI',1,6,1,7
)
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

UPDATE signal_master
SET signal_name_internal='Gigitan atau kontak hewan',
    community_label='Gigitan, cakaran, liur hewan, atau gigitan ular',
    community_definition='Gigitan atau kontak berisiko dengan mamalia maupun ular',
    cadre_definition='Gigitan atau kontak hewan',
    sort_order=8
WHERE signal_code='RABIES';

UPDATE signal_master SET sort_order=9 WHERE signal_code='OTHER';

-- Rabies disease suggestions require neurological illness in addition to a
-- compatible animal exposure; GHPR remains the correct bite-only suggestion.
INSERT OR IGNORE INTO ebs_mapping_rules(ebs_id,trigger_type,trigger_code)
VALUES ('31','OBSERVATION','NEUROLOGIC');

-- Human avian-influenza suggestions require both poultry exposure and a
-- serious respiratory sign; an animal-only report should suggest EBS 291.
INSERT OR IGNORE INTO ebs_mapping_rules(ebs_id,trigger_type,trigger_code) VALUES
  ('32','OBSERVATION','BREATHING_DIFFICULTY'),
  ('226','OBSERVATION','BREATHING_DIFFICULTY');
