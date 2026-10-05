-- W2 SKDR 2025 catalogue and the local-only line list used by Puskesmas
-- instalasi lokal. Aggregate rows remain structurally separate from identifiable
-- patient information so upward reporting cannot accidentally include PII.

ALTER TABLE w2_indicators ADD COLUMN definition TEXT NOT NULL DEFAULT '';
ALTER TABLE w2_indicators ADD COLUMN identity_policy TEXT NOT NULL DEFAULT 'CONDITIONAL'
  CHECK(identity_policy IN ('REQUIRED','CONDITIONAL','OPTIONAL','NONE'));
ALTER TABLE w2_indicators ADD COLUMN is_total INTEGER NOT NULL DEFAULT 0 CHECK(is_total IN (0,1));
ALTER TABLE w2_indicators ADD COLUMN lab_tracking INTEGER NOT NULL DEFAULT 1 CHECK(lab_tracking IN (0,1));
ALTER TABLE w2_indicators ADD COLUMN alert_minimum INTEGER CHECK(alert_minimum IS NULL OR alert_minimum >= 1);
ALTER TABLE w2_indicators ADD COLUMN alert_rule_text TEXT NOT NULL DEFAULT '';
ALTER TABLE w2_indicators ADD COLUMN catalog_version TEXT NOT NULL DEFAULT 'SKDR-2025';

ALTER TABLE w2_values ADD COLUMN lab_examined_count INTEGER NOT NULL DEFAULT 0
  CHECK(lab_examined_count >= 0 AND lab_examined_count <= case_count);

ALTER TABLE w2_submissions ADD COLUMN submission_status TEXT NOT NULL DEFAULT 'SUBMITTED'
  CHECK(submission_status IN ('DRAFT','SUBMITTED'));
ALTER TABLE w2_submissions ADD COLUMN local_detail_status TEXT NOT NULL DEFAULT 'COMPLETE'
  CHECK(local_detail_status IN ('COMPLETE','NEEDS_DETAILS'));
ALTER TABLE w2_submissions ADD COLUMN detail_required_count INTEGER NOT NULL DEFAULT 0 CHECK(detail_required_count >= 0);
ALTER TABLE w2_submissions ADD COLUMN detail_provided_count INTEGER NOT NULL DEFAULT 0 CHECK(detail_provided_count >= 0);
ALTER TABLE w2_submissions ADD COLUMN catalog_version TEXT NOT NULL DEFAULT 'SKDR-2025';
ALTER TABLE w2_submissions ADD COLUMN updated_at TEXT;

CREATE TABLE IF NOT EXISTS w2_case_details (
  case_detail_id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES w2_submissions(submission_id) ON DELETE CASCADE,
  indicator_code TEXT NOT NULL REFERENCES w2_indicators(indicator_code),
  patient_name_encrypted TEXT NOT NULL DEFAULT '',
  age_value INTEGER CHECK(age_value IS NULL OR age_value >= 0),
  age_unit TEXT CHECK(age_unit IS NULL OR age_unit IN ('DAY','MONTH','YEAR')),
  sex TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(sex IN ('L','P','UNKNOWN')),
  village_code TEXT,
  address_encrypted TEXT NOT NULL DEFAULT '',
  phone_encrypted TEXT NOT NULL DEFAULT '',
  onset_date TEXT,
  visit_date TEXT,
  lab_status TEXT NOT NULL DEFAULT 'NOT_TESTED'
    CHECK(lab_status IN ('NOT_TESTED','PENDING','POSITIVE','NEGATIVE','INCONCLUSIVE','UNKNOWN')),
  patient_fingerprint TEXT,
  is_complete INTEGER NOT NULL DEFAULT 0 CHECK(is_complete IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS w2_case_details_submission_idx
ON w2_case_details(submission_id,indicator_code);
CREATE INDEX IF NOT EXISTS w2_case_details_fingerprint_idx
ON w2_case_details(patient_fingerprint);

-- Retire ad-hoc W2 indicators from the active form and install the versioned
-- working-tool catalogue supplied by Kemenkes/PAEI (2025).
UPDATE w2_indicators SET active=0,updated_at=datetime('now');

INSERT INTO w2_indicators(
  indicator_code,indicator_name,active,sort_order,created_at,updated_at,
  definition,identity_policy,is_total,lab_tracking,alert_minimum,alert_rule_text,catalog_version
) VALUES
  ('A','Diare Akut',1,1,datetime('now'),datetime('now'),'BAB cair tiga kali atau lebih dalam 24 jam.','OPTIONAL',0,1,NULL,'Peningkatan 1,5 kali dari minggu sebelumnya','SKDR-2025'),
  ('B','Malaria Konfirmasi',1,2,datetime('now'),datetime('now'),'Plasmodium ditemukan melalui pemeriksaan mikroskopis atau RDT positif.','REQUIRED',0,1,1,'Satu kasus pada minggu berjalan','SKDR-2025'),
  ('C','Suspek Dengue',1,3,datetime('now'),datetime('now'),'Demam tinggi mendadak 2-7 hari dengan tanda klinis yang sesuai dengue.','REQUIRED',0,1,2,'Dua suspek pada minggu berjalan','SKDR-2025'),
  ('D','Pneumonia',1,4,datetime('now'),datetime('now'),'Batuk dan/atau kesulitan bernapas dengan napas cepat sesuai kelompok usia.','OPTIONAL',0,1,NULL,'Peningkatan 1,5 kali dari minggu sebelumnya','SKDR-2025'),
  ('E','Diare Berdarah/Disentri',1,5,datetime('now'),datetime('now'),'Diare dengan darah dan lendir, dapat disertai tenesmus.','REQUIRED',0,1,1,'Satu kasus pada minggu berjalan','SKDR-2025'),
  ('F','Suspek Demam Tifoid',1,6,datetime('now'),datetime('now'),'Demam khas disertai gangguan pencernaan yang sesuai suspek demam tifoid.','CONDITIONAL',0,1,NULL,'Peningkatan 1,5 kali dari minggu sebelumnya','SKDR-2025'),
  ('G','Sindrom Jaundice Akut',1,7,datetime('now'),datetime('now'),'Kulit dan sklera kuning serta urine gelap yang timbul mendadak.','REQUIRED',0,1,1,'Satu kasus pada minggu berjalan','SKDR-2025'),
  ('H','Suspek Chikungunya',1,8,datetime('now'),datetime('now'),'Demam mendadak di atas 38,5 C dengan nyeri persendian hebat.','CONDITIONAL',0,1,NULL,'Peningkatan 1,5 kali dari minggu sebelumnya','SKDR-2025'),
  ('J','Suspek Flu Burung pada Manusia',1,9,datetime('now'),datetime('now'),'ILI dengan pajanan unggas/hewan atau temuan klinis yang sesuai flu burung.','REQUIRED',0,1,1,'Satu suspek pada minggu berjalan','SKDR-2025'),
  ('K','Suspek Campak',1,10,datetime('now'),datetime('now'),'Demam dan ruam makulopapular.','REQUIRED',0,1,1,'Satu suspek pada minggu berjalan','SKDR-2025'),
  ('L','Kasus Observasi Difteri',1,11,datetime('now'),datetime('now'),'Infeksi saluran napas atas disertai pseudomembran.','REQUIRED',0,1,1,'Satu suspek pada minggu berjalan','SKDR-2025'),
  ('M','Suspek Pertusis',1,12,datetime('now'),datetime('now'),'Batuk lebih dari dua minggu dengan whoop, muntah setelah batuk, atau apnea pada bayi.','REQUIRED',0,1,1,'Satu suspek pada minggu berjalan','SKDR-2025'),
  ('N','AFP (Lumpuh Layu Mendadak)',1,13,datetime('now'),datetime('now'),'Kelumpuhan flaccid akut pada anak berusia kurang dari 15 tahun, bukan karena trauma.','REQUIRED',0,1,1,'Satu kasus AFP','SKDR-2025'),
  ('P','Kasus GHPR',1,14,datetime('now'),datetime('now'),'Gigitan hewan berdarah panas yang dapat menularkan rabies.','REQUIRED',0,1,1,'Satu kasus pada minggu berjalan','SKDR-2025'),
  ('Q','Suspek Antraks',1,15,datetime('now'),datetime('now'),'Gambaran klinis antraks kulit, pencernaan, paru, atau meningitis.','REQUIRED',0,1,1,'Satu suspek pada minggu berjalan','SKDR-2025'),
  ('R','Suspek Leptospirosis',1,16,datetime('now'),datetime('now'),'Demam akut dengan tanda klinis dan riwayat pajanan lingkungan terkontaminasi.','REQUIRED',0,1,1,'Satu suspek pada minggu berjalan','SKDR-2025'),
  ('S','Suspek Kolera',1,17,datetime('now'),datetime('now'),'Diare cair akut kurang dari tujuh hari dengan dehidrasi berat.','REQUIRED',0,1,1,'Satu suspek pada minggu berjalan','SKDR-2025'),
  ('U','Suspek Meningitis/Ensefalitis',1,18,datetime('now'),datetime('now'),'Demam mendadak, sakit kepala, kaku kuduk, dan dapat disertai penurunan kesadaran.','REQUIRED',0,1,3,'Tiga suspek pada minggu berjalan','SKDR-2025'),
  ('V','Suspek Tetanus Neonatorum',1,19,datetime('now'),datetime('now'),'Bayi usia 3-28 hari sulit menyusu, mulut mencucu, dan kejang rangsangan.','REQUIRED',0,1,1,'Satu kasus tersangka TN','SKDR-2025'),
  ('W','Suspek Tetanus',1,20,datetime('now'),datetime('now'),'Kontraksi dan kekejangan otot mendadak dengan riwayat luka.','REQUIRED',0,1,1,'Satu suspek pada minggu berjalan','SKDR-2025'),
  ('Y','ILI (Influenza Like Illness)',1,21,datetime('now'),datetime('now'),'Demam 38 C atau lebih disertai batuk kurang dari 10 hari.','OPTIONAL',0,1,NULL,'Pantau kecenderungan mingguan','SKDR-2025'),
  ('Z','Suspek HFMD',1,22,datetime('now'),datetime('now'),'Demam akut dengan ruam khas tangan, kaki, mulut, atau hubungan epidemiologis.','REQUIRED',0,1,1,'Satu suspek pada minggu berjalan','SKDR-2025'),
  ('AA','ISPA',1,23,datetime('now'),datetime('now'),'Demam akut, batuk, sakit tenggorokan, atau pilek.','OPTIONAL',0,1,NULL,'Peningkatan 1,5 kali dari minggu sebelumnya','SKDR-2025'),
  ('AC','COVID-19 Konfirmasi',1,24,datetime('now'),datetime('now'),'COVID-19 yang dibuktikan dengan pemeriksaan laboratorium positif.','REQUIRED',0,1,1,'Satu kasus konfirmasi','SKDR-2025'),
  ('X','Total Kunjungan',1,25,datetime('now'),datetime('now'),'Seluruh kunjungan pasien yang terdaftar di fasilitas kesehatan pada minggu laporan.','NONE',1,0,NULL,'','SKDR-2025')
ON CONFLICT(indicator_code) DO UPDATE SET
  indicator_name=excluded.indicator_name,
  active=excluded.active,
  sort_order=excluded.sort_order,
  updated_at=excluded.updated_at,
  definition=excluded.definition,
  identity_policy=excluded.identity_policy,
  is_total=excluded.is_total,
  lab_tracking=excluded.lab_tracking,
  alert_minimum=excluded.alert_minimum,
  alert_rule_text=excluded.alert_rule_text,
  catalog_version=excluded.catalog_version;

INSERT INTO ibs_thresholds(
  threshold_id,target_type,target_code,minimum_value,active,created_at,updated_at
) VALUES
  ('THR-W2-B','W2','B',1,1,datetime('now'),datetime('now')),
  ('THR-W2-C','W2','C',2,1,datetime('now'),datetime('now')),
  ('THR-W2-E','W2','E',1,1,datetime('now'),datetime('now')),
  ('THR-W2-G','W2','G',1,1,datetime('now'),datetime('now')),
  ('THR-W2-J','W2','J',1,1,datetime('now'),datetime('now')),
  ('THR-W2-K','W2','K',1,1,datetime('now'),datetime('now')),
  ('THR-W2-L','W2','L',1,1,datetime('now'),datetime('now')),
  ('THR-W2-M','W2','M',1,1,datetime('now'),datetime('now')),
  ('THR-W2-N','W2','N',1,1,datetime('now'),datetime('now')),
  ('THR-W2-P','W2','P',1,1,datetime('now'),datetime('now')),
  ('THR-W2-Q','W2','Q',1,1,datetime('now'),datetime('now')),
  ('THR-W2-R','W2','R',1,1,datetime('now'),datetime('now')),
  ('THR-W2-S','W2','S',1,1,datetime('now'),datetime('now')),
  ('THR-W2-U','W2','U',3,1,datetime('now'),datetime('now')),
  ('THR-W2-V','W2','V',1,1,datetime('now'),datetime('now')),
  ('THR-W2-W','W2','W',1,1,datetime('now'),datetime('now')),
  ('THR-W2-Z','W2','Z',1,1,datetime('now'),datetime('now')),
  ('THR-W2-AC','W2','AC',1,1,datetime('now'),datetime('now'))
ON CONFLICT(target_type,target_code) DO UPDATE SET
  minimum_value=excluded.minimum_value,
  active=1,
  updated_at=excluded.updated_at;
