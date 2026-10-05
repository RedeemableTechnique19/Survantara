-- Formalize the mixed SKDR EBS list so UI grouping and automatic suggestions
-- are governed by master data instead of hard-coded application ID lists.
ALTER TABLE ebs_disease_master ADD COLUMN taxonomy_domain TEXT NOT NULL DEFAULT 'HUMAN'
  CHECK(taxonomy_domain IN ('HUMAN','EXPOSURE','ANIMAL','EVENT','OTHER'));
ALTER TABLE ebs_disease_master ADD COLUMN classification_level TEXT NOT NULL DEFAULT 'DISEASE'
  CHECK(classification_level IN ('DISEASE','SYNDROME','SUSPECT','OBSERVATION','PROBABLE','LAB_CONFIRMED','EXPOSURE','ANIMAL_SIGNAL','EVENT','OTHER'));
ALTER TABLE ebs_disease_master ADD COLUMN taxonomy_group TEXT NOT NULL DEFAULT 'UNUSUAL_OTHER'
  CHECK(taxonomy_group IN ('NEUROLOGIC','RESPIRATORY','ENTERIC','RASH_SKIN','JAUNDICE_RENAL','HEMORRHAGIC','VECTOR_ZOONOSIS','EXPOSURE_ANIMAL','UNUSUAL_OTHER'));
ALTER TABLE ebs_disease_master ADD COLUMN auto_suggestible INTEGER NOT NULL DEFAULT 0
  CHECK(auto_suggestible IN (0,1));
ALTER TABLE ebs_disease_master ADD COLUMN suggestion_min_matches INTEGER NOT NULL DEFAULT 1
  CHECK(suggestion_min_matches >= 1);

-- Domain separates human classifications from exposures, animal signals,
-- unusual events, and the catch-all entry.
UPDATE ebs_disease_master SET taxonomy_domain='EXPOSURE' WHERE ebs_id IN ('18','396');
UPDATE ebs_disease_master SET taxonomy_domain='ANIMAL' WHERE ebs_id IN ('290','291');
UPDATE ebs_disease_master SET taxonomy_domain='EVENT' WHERE ebs_id IN ('22','23');
UPDATE ebs_disease_master SET taxonomy_domain='OTHER' WHERE ebs_id='38';

-- Classification level reflects the wording/status of each official SKDR
-- option. A disease entry is not treated as laboratory confirmed unless the
-- official label explicitly says so.
UPDATE ebs_disease_master SET classification_level='SYNDROME'
WHERE ebs_id IN ('11','16','202','179','168','30','33','160');
UPDATE ebs_disease_master SET classification_level='SUSPECT'
WHERE ebs_id IN ('220','221','226','232','227','233','231','222','228','224','230','243','196','225','244','229');
UPDATE ebs_disease_master SET classification_level='OBSERVATION' WHERE ebs_id='133';
UPDATE ebs_disease_master SET classification_level='PROBABLE' WHERE ebs_id='126';
UPDATE ebs_disease_master SET classification_level='LAB_CONFIRMED' WHERE ebs_id IN ('127','249');
UPDATE ebs_disease_master SET classification_level='EXPOSURE' WHERE ebs_id IN ('18','396');
UPDATE ebs_disease_master SET classification_level='ANIMAL_SIGNAL' WHERE ebs_id IN ('290','291');
UPDATE ebs_disease_master SET classification_level='EVENT' WHERE ebs_id IN ('22','23');
UPDATE ebs_disease_master SET classification_level='OTHER' WHERE ebs_id='38';

-- Operational presentation groups cover every official classification once.
UPDATE ebs_disease_master SET taxonomy_group='NEUROLOGIC'
WHERE ebs_id IN ('11','205','26','33','293','227','228','196','34','35');
UPDATE ebs_disease_master SET taxonomy_group='RESPIRATORY'
WHERE ebs_id IN ('166','17','127','133','126','32','168','21','249','198','27','28','30','221','226','231','224','225');
UPDATE ebs_disease_master SET taxonomy_group='ENTERIC'
WHERE ebs_id IN ('16','202','22','216','36','233');
UPDATE ebs_disease_master SET taxonomy_group='RASH_SKIN'
WHERE ebs_id IN ('13','14','238','20','175','393','220','230','243','244','229','37');
UPDATE ebs_disease_master SET taxonomy_group='JAUNDICE_RENAL'
WHERE ebs_id IN ('193','179','19','160');
UPDATE ebs_disease_master SET taxonomy_group='HEMORRHAGIC'
WHERE ebs_id IN ('194','15','195','292');
UPDATE ebs_disease_master SET taxonomy_group='VECTOR_ZOONOSIS'
WHERE ebs_id IN ('294','197','24','25','29','31','232','222');
UPDATE ebs_disease_master SET taxonomy_group='EXPOSURE_ANIMAL'
WHERE ebs_id IN ('18','396','290','291');
UPDATE ebs_disease_master SET taxonomy_group='UNUSUAL_OTHER'
WHERE ebs_id IN ('23','38');

-- Only syndromic, suspect, exposure, animal, and highly specific clinical
-- signals may be suggested from unverified reports. All 68 entries remain
-- available for staff to select after verification.
UPDATE ebs_disease_master SET auto_suggestible=1
WHERE ebs_id IN (
  '11','238','16','202','179','18','396','168','22','23','30','38',
  '220','226','232','233','222','228','224','230','196','244',
  '160','34','35','290','291'
);

UPDATE ebs_disease_master SET suggestion_min_matches=2
WHERE ebs_id IN ('18','396','290','291','220','226','232','233','222','224','230','196','244');

-- Strengthen broad suspect mappings so a single common sign does not anchor
-- staff on a named disease.
INSERT OR IGNORE INTO ebs_mapping_rules(ebs_id,trigger_type,trigger_code) VALUES
  ('220','OBSERVATION','FEVER'),
  ('222','OBSERVATION','FEVER'),
  ('230','OBSERVATION','FEVER'),
  ('244','OBSERVATION','FEVER'),
  ('233','OBSERVATION','VOMITING');

CREATE INDEX IF NOT EXISTS ebs_disease_suggestion_idx
ON ebs_disease_master(auto_suggestible,classification_level,sort_order);
