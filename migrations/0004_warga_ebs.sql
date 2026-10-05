CREATE TABLE IF NOT EXISTS event_type_master (
  event_type TEXT PRIMARY KEY,
  public_label TEXT NOT NULL,
  public_help TEXT NOT NULL,
  icon_key TEXT NOT NULL,
  default_priority TEXT NOT NULL CHECK(default_priority IN ('RENDAH','SEDANG','TINGGI')),
  immediate_notification INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS observation_master (
  observation_code TEXT PRIMARY KEY,
  public_label TEXT NOT NULL,
  public_help TEXT NOT NULL,
  default_priority TEXT NOT NULL CHECK(default_priority IN ('RENDAH','SEDANG','TINGGI')),
  immediate_notification INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS context_master (
  context_code TEXT PRIMARY KEY,
  public_label TEXT NOT NULL,
  public_help TEXT NOT NULL,
  default_priority TEXT NOT NULL CHECK(default_priority IN ('RENDAH','SEDANG','TINGGI')),
  immediate_notification INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ebs_disease_master (
  ebs_id TEXT PRIMARY KEY,
  disease_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ebs_mapping_rules (
  ebs_id TEXT NOT NULL REFERENCES ebs_disease_master(ebs_id),
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('EVENT','OBSERVATION','CONTEXT')),
  trigger_code TEXT NOT NULL,
  PRIMARY KEY(ebs_id, trigger_type, trigger_code)
);

INSERT OR REPLACE INTO event_type_master(event_type,public_label,public_help,icon_key,default_priority,immediate_notification,active,sort_order) VALUES
  ('PERSON_ILLNESS','Seseorang sakit','Keluhan kesehatan tidak biasa pada satu orang.','person','RENDAH',0,1,1),
  ('CLUSTER','Beberapa orang sakit serupa','Keluhan serupa pada beberapa orang dalam waktu dan tempat berdekatan.','cluster','SEDANG',1,1,2),
  ('UNUSUAL_DEATH','Kematian tidak biasa','Kematian mendadak atau tidak biasa yang perlu diketahui petugas.','death','TINGGI',1,1,3),
  ('ANIMAL_EXPOSURE','Gigitan atau kontak hewan','Gigitan, cakaran, atau kontak liur hewan pada manusia.','animal-exposure','TINGGI',1,1,4),
  ('ANIMAL_EVENT','Hewan atau unggas sakit/mati','Hewan atau unggas sakit atau mati mendadak dan tidak biasa.','animal-event','TINGGI',1,1,5),
  ('ENVIRONMENTAL','Gangguan lingkungan','Gangguan air, udara, limbah, pangan, atau bahan kimia.','environment','TINGGI',1,1,6),
  ('SCHOOL_WORKPLACE','Banyak yang absen karena sakit','Peningkatan ketidakhadiran karena sakit di sekolah atau tempat kerja.','school','SEDANG',1,1,7),
  ('OTHER','Kejadian kesehatan lainnya','Kejadian mengkhawatirkan yang tidak sesuai dengan pilihan lain.','other','RENDAH',0,1,8);

INSERT OR REPLACE INTO observation_master(observation_code,public_label,public_help,default_priority,immediate_notification,active,sort_order) VALUES
  ('FEVER','Demam','Demam atau badan terasa sangat panas.','RENDAH',0,1,1),
  ('DIARRHEA','Diare','Buang air besar cair lebih sering dari biasanya.','RENDAH',0,1,2),
  ('BLOODY_DIARRHEA','Diare berdarah atau berlendir','Tinja mengandung darah atau lendir.','SEDANG',1,1,3),
  ('VOMITING','Muntah','Muntah berulang atau disertai keluhan lain.','RENDAH',0,1,4),
  ('COUGH_COLD','Batuk, pilek, atau sakit tenggorokan','Keluhan saluran pernapasan tanpa tanda sesak berat.','RENDAH',0,1,5),
  ('BREATHING_DIFFICULTY','Sulit bernapas','Sesak, napas cepat, napas berbunyi, atau bibir kebiruan.','TINGGI',1,1,6),
  ('RASH_LESION','Ruam, lepuh, atau pembengkakan','Bercak kemerahan, lepuh, luka kulit, atau bengkak tidak biasa.','SEDANG',1,1,7),
  ('JAUNDICE','Mata/kulit kuning atau urine gelap','Warna kuning yang muncul mendadak pada mata atau kulit.','TINGGI',1,1,8),
  ('RENAL_PROBLEM','Kencing sangat sedikit atau tidak kencing','Dapat disertai bengkak atau kondisi memburuk.','TINGGI',1,1,9),
  ('NEUROLOGIC','Kaku leher, kejang, bingung, atau tidak sadar','Perubahan kesadaran atau gangguan saraf yang muncul mendadak.','TINGGI',1,1,10),
  ('SUDDEN_PARALYSIS','Lumpuh atau lemas mendadak','Kelemahan anggota gerak yang bukan akibat cedera.','TINGGI',1,1,11),
  ('BLEEDING','Perdarahan atau bintik merah','Mimisan, gusi berdarah, atau bintik perdarahan pada kulit.','TINGGI',1,1,12),
  ('RED_EYES','Mata merah','Mata merah atau peradangan mata yang tidak biasa.','SEDANG',0,1,13),
  ('MUSCLE_STIFFNESS','Kaku atau kejang setelah luka','Kekakuan atau kejang otot setelah mengalami luka.','TINGGI',1,1,14),
  ('NEWBORN_NEURO','Bayi sulit menyusu disertai kaku/kejang','Terjadi pada bayi baru lahir usia 3-28 hari.','TINGGI',1,1,15),
  ('HEADACHE_MYALGIA','Sakit kepala atau nyeri otot berat','Keluhan berat yang muncul bersama demam atau paparan tertentu.','RENDAH',0,1,16),
  ('OTHER_OBSERVATION','Gejala atau tanda lainnya','Jelaskan tanda lain pada kolom cerita kejadian.','RENDAH',0,1,17);

INSERT OR REPLACE INTO context_master(context_code,public_label,public_help,default_priority,immediate_notification,active,sort_order) VALUES
  ('SHARED_FOOD','Makan dari sumber yang sama','Beberapa orang mengonsumsi makanan yang sama.','SEDANG',1,1,1),
  ('SHARED_WATER','Menggunakan sumber air yang sama','Air minum atau air rumah tangga berasal dari sumber yang sama.','SEDANG',1,1,2),
  ('FLOOD_SEWER','Kontak banjir, sawah, selokan, atau limbah','Ada kontak dengan air atau lingkungan yang mungkin tercemar.','SEDANG',1,1,3),
  ('ANIMAL_BITE','Gigitan, cakaran, atau liur hewan','Termasuk anjing, kucing, kera, dan mamalia lain.','TINGGI',1,1,4),
  ('SNAKE_BITE','Gigitan ular','Seseorang mengalami gigitan ular.','TINGGI',1,1,5),
  ('SICK_DEAD_POULTRY','Unggas sakit atau mati mendadak','Ayam, bebek, atau unggas lain sakit atau mati tidak biasa.','TINGGI',1,1,6),
  ('SICK_DEAD_ANIMALS','Ternak atau satwa sakit/mati mendadak','Ternak atau satwa lain sakit atau mati tidak biasa.','TINGGI',1,1,7),
  ('RODENT_CONTACT','Kontak dengan tikus atau kotorannya','Termasuk rumah, gudang, sawah, atau tempat lain dengan banyak tikus.','SEDANG',1,1,8),
  ('TRAVEL_CONTACT','Perjalanan atau kontak dengan pendatang','Ada perjalanan atau kontak dengan orang yang baru datang dari wilayah lain.','SEDANG',1,1,9),
  ('SCHOOL_WORKPLACE_CLUSTER','Terjadi di sekolah atau tempat kerja','Beberapa orang pada lokasi yang sama mengalami keluhan.','SEDANG',1,1,10),
  ('CHEMICAL_EXPOSURE','Paparan asap, pestisida, atau bahan kimia','Keluhan muncul setelah paparan bahan berbahaya.','TINGGI',1,1,11),
  ('UNKNOWN_CONTEXT','Tidak diketahui','Tidak ada konteks yang diketahui saat laporan dibuat.','RENDAH',0,1,12);

INSERT OR REPLACE INTO ebs_disease_master(ebs_id,disease_name,active,sort_order) VALUES
  ('11','Acute Flaccid Paralysis (AFP)',1,1),('294','Anthraks',1,2),('13','Campak',1,3),
  ('14','Chikungunya',1,4),('238','Conjunctivitis',1,5),('166','COVID-19',1,6),
  ('193','Demam Kuning (Yellow Fever)',1,7),('194','Demam Lassa',1,8),('15','Dengue',1,9),
  ('16','Diare Akut',1,10),('202','Diare Berdarah/ Disentri',1,11),('17','Difteri',1,12),
  ('127','Difteri Konfirm Laboratorium',1,13),('133','Difteri Observasi',1,14),('126','Difteri Probable',1,15),
  ('32','Flu Burung Pada Manusia',1,16),('179','Gangguan Ginjal Akut Misterius',1,17),
  ('18','Gigitan Hewan Penyebab Rabies (GHPR)',1,18),('396','Gigitan Ular',1,19),('197','Hantavirus',1,20),
  ('19','Hepatitis',1,21),('290','Hewan Ternak Sakit/Mati Mendadak',1,22),('20','HFMD',1,23),
  ('168','ILI (Penyakit Serupa Influenza)',1,24),('21','Influenza',1,25),
  ('249','ISPA/Pneumoni (dengan hasil lab)',1,26),('205','Japanese encephalitis',1,27),
  ('22','Keracunan Pangan',1,28),('23','Kluster penyakit yang tidak lazim',1,29),('216','Kolera',1,30),
  ('198','Legionellosis',1,31),('24','Leptospirosis',1,32),('25','Malaria',1,33),
  ('26','Meningitis Streptococcus Suis',1,34),('33','Meningitis/Encephalitis',1,35),
  ('27','MERS-CoV',1,36),('175','Mpox',1,37),('38','Penyakit lain-lain',1,38),
  ('195','Penyakit Virus Ebola (PVE/EVD)',1,39),('28','Pertusis',1,40),('29','PES (Sampar)',1,41),
  ('30','Pnemonia',1,42),('293','Polio',1,43),('31','Rabies',1,44),('393','Rubella',1,45),
  ('220','Suspek Campak',1,46),('221','Suspek Difteri',1,47),('226','Suspek Flu Burung',1,48),
  ('232','Suspek Hanta',1,49),('227','Suspek Japanese encephalitis',1,50),('233','Suspek Kolera',1,51),
  ('231','Suspek Legionellosis',1,52),('222','Suspek Leptospirosis',1,53),
  ('228','Suspek Meninghitis',1,54),('224','Suspek MERS-CoV',1,55),('230','Suspek MPox',1,56),
  ('243','Suspek Mumps',1,57),('196','Suspek Penyakit Virus Nipah',1,58),('225','Suspek Pertusis',1,59),
  ('244','Suspek Varicella',1,60),('229','Suspek Zika',1,61),('160','Syndrome Jaundice Acute',1,62),
  ('34','Tetanus',1,63),('35','Tetanus Neonatorum',1,64),('36','Tifoid',1,65),
  ('291','Unggas Sakit/Mati Mendadak',1,66),('292','Virus Marburg',1,67),('37','Zika',1,68);

INSERT OR REPLACE INTO ebs_mapping_rules(ebs_id,trigger_type,trigger_code) VALUES
  ('11','OBSERVATION','SUDDEN_PARALYSIS'),('293','OBSERVATION','SUDDEN_PARALYSIS'),
  ('294','CONTEXT','SICK_DEAD_ANIMALS'),('294','OBSERVATION','RASH_LESION'),
  ('13','OBSERVATION','RASH_LESION'),('220','OBSERVATION','RASH_LESION'),('393','OBSERVATION','RASH_LESION'),
  ('14','OBSERVATION','RASH_LESION'),('20','OBSERVATION','RASH_LESION'),('175','OBSERVATION','RASH_LESION'),
  ('230','OBSERVATION','RASH_LESION'),('243','OBSERVATION','RASH_LESION'),('244','OBSERVATION','RASH_LESION'),
  ('229','OBSERVATION','RASH_LESION'),('37','OBSERVATION','RASH_LESION'),
  ('238','OBSERVATION','RED_EYES'),
  ('166','OBSERVATION','COUGH_COLD'),('166','OBSERVATION','BREATHING_DIFFICULTY'),
  ('168','OBSERVATION','COUGH_COLD'),('21','OBSERVATION','COUGH_COLD'),
  ('249','OBSERVATION','BREATHING_DIFFICULTY'),('30','OBSERVATION','BREATHING_DIFFICULTY'),
  ('17','OBSERVATION','COUGH_COLD'),('127','OBSERVATION','COUGH_COLD'),('133','OBSERVATION','COUGH_COLD'),
  ('126','OBSERVATION','COUGH_COLD'),('221','OBSERVATION','COUGH_COLD'),
  ('28','OBSERVATION','COUGH_COLD'),('225','OBSERVATION','COUGH_COLD'),
  ('32','CONTEXT','SICK_DEAD_POULTRY'),('226','CONTEXT','SICK_DEAD_POULTRY'),
  ('27','OBSERVATION','BREATHING_DIFFICULTY'),('27','CONTEXT','TRAVEL_CONTACT'),
  ('224','OBSERVATION','BREATHING_DIFFICULTY'),('224','CONTEXT','TRAVEL_CONTACT'),
  ('198','OBSERVATION','BREATHING_DIFFICULTY'),('231','OBSERVATION','BREATHING_DIFFICULTY'),
  ('16','OBSERVATION','DIARRHEA'),('202','OBSERVATION','BLOODY_DIARRHEA'),
  ('216','OBSERVATION','DIARRHEA'),('233','OBSERVATION','DIARRHEA'),
  ('22','CONTEXT','SHARED_FOOD'),('36','OBSERVATION','FEVER'),('36','OBSERVATION','DIARRHEA'),
  ('193','OBSERVATION','JAUNDICE'),('194','OBSERVATION','FEVER'),('15','OBSERVATION','FEVER'),
  ('15','OBSERVATION','BLEEDING'),('195','OBSERVATION','BLEEDING'),('195','CONTEXT','TRAVEL_CONTACT'),
  ('292','OBSERVATION','BLEEDING'),('292','CONTEXT','TRAVEL_CONTACT'),
  ('25','OBSERVATION','FEVER'),('29','OBSERVATION','FEVER'),('29','CONTEXT','RODENT_CONTACT'),
  ('197','CONTEXT','RODENT_CONTACT'),('197','OBSERVATION','RENAL_PROBLEM'),
  ('232','CONTEXT','RODENT_CONTACT'),('232','OBSERVATION','RENAL_PROBLEM'),
  ('24','CONTEXT','FLOOD_SEWER'),('222','CONTEXT','FLOOD_SEWER'),
  ('19','OBSERVATION','JAUNDICE'),('160','OBSERVATION','JAUNDICE'),('179','OBSERVATION','RENAL_PROBLEM'),
  ('205','OBSERVATION','NEUROLOGIC'),('227','OBSERVATION','NEUROLOGIC'),
  ('26','OBSERVATION','NEUROLOGIC'),('33','OBSERVATION','NEUROLOGIC'),('228','OBSERVATION','NEUROLOGIC'),
  ('196','OBSERVATION','NEUROLOGIC'),('196','CONTEXT','SICK_DEAD_ANIMALS'),
  ('34','OBSERVATION','MUSCLE_STIFFNESS'),('35','OBSERVATION','NEWBORN_NEURO'),
  ('18','CONTEXT','ANIMAL_BITE'),('31','CONTEXT','ANIMAL_BITE'),('396','CONTEXT','SNAKE_BITE'),
  ('290','CONTEXT','SICK_DEAD_ANIMALS'),('291','CONTEXT','SICK_DEAD_POULTRY'),
  ('23','EVENT','CLUSTER'),('38','EVENT','OTHER'),
  ('18','EVENT','ANIMAL_EXPOSURE'),('31','EVENT','ANIMAL_EXPOSURE'),('396','EVENT','ANIMAL_EXPOSURE'),
  ('290','EVENT','ANIMAL_EVENT'),('291','EVENT','ANIMAL_EVENT'),('294','EVENT','ANIMAL_EVENT'),
  ('38','EVENT','ENVIRONMENTAL'),('23','EVENT','SCHOOL_WORKPLACE'),('38','EVENT','UNUSUAL_DEATH');

ALTER TABLE reports ADD COLUMN event_type TEXT REFERENCES event_type_master(event_type);
ALTER TABLE reports ADD COLUMN verified_ebs_id TEXT REFERENCES ebs_disease_master(ebs_id);
ALTER TABLE reports ADD COLUMN classified_by TEXT;
ALTER TABLE reports ADD COLUMN classified_at TEXT;
ALTER TABLE verifications ADD COLUMN verified_ebs_id TEXT REFERENCES ebs_disease_master(ebs_id);

CREATE TABLE IF NOT EXISTS report_observations (
  report_id TEXT NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  observation_code TEXT NOT NULL REFERENCES observation_master(observation_code),
  PRIMARY KEY(report_id, observation_code)
);

CREATE TABLE IF NOT EXISTS report_contexts (
  report_id TEXT NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  context_code TEXT NOT NULL REFERENCES context_master(context_code),
  PRIMARY KEY(report_id, context_code)
);

UPDATE reports SET event_type = CASE signal_code
  WHEN 'FOOD' THEN 'CLUSTER'
  WHEN 'CLUSTER' THEN 'CLUSTER'
  WHEN 'DEATH' THEN 'UNUSUAL_DEATH'
  WHEN 'SCHOOL' THEN 'SCHOOL_WORKPLACE'
  WHEN 'ENV' THEN 'ENVIRONMENTAL'
  WHEN 'ZOONOSIS' THEN 'ANIMAL_EVENT'
  WHEN 'RABIES' THEN 'ANIMAL_EXPOSURE'
  ELSE 'OTHER'
END
WHERE submission_channel='PUBLIC' AND event_type IS NULL;

CREATE INDEX IF NOT EXISTS report_observations_code_idx ON report_observations(observation_code, report_id);
CREATE INDEX IF NOT EXISTS report_contexts_code_idx ON report_contexts(context_code, report_id);
CREATE INDEX IF NOT EXISTS reports_event_type_idx ON reports(event_type, submitted_at DESC);
CREATE INDEX IF NOT EXISTS reports_verified_ebs_idx ON reports(verified_ebs_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS ebs_mapping_trigger_idx ON ebs_mapping_rules(trigger_type, trigger_code, ebs_id);
