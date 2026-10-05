CREATE TABLE IF NOT EXISTS public_disease_catalog (
  disease_code TEXT PRIMARY KEY,
  public_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL
);

INSERT INTO public_disease_catalog(disease_code,public_name,active,sort_order) VALUES
  ('A','Diare Akut',1,1),
  ('B','Malaria Konfirmasi',1,2),
  ('C','Suspek Dengue',1,3),
  ('D','Pneumonia',1,4),
  ('E','Diare Berdarah / Disentri',1,5),
  ('F','Suspek Demam Tifoid',1,6),
  ('G','Sindrom Jaundice Akut',1,7),
  ('H','Suspek Chikungunya',1,8),
  ('I','Suspek Flu Burung Pada Manusia',1,9),
  ('J','Suspek Campak',1,10),
  ('K','Kasus Observasi Difteri',1,11),
  ('L','Suspek Pertusis',1,12),
  ('M','Acute Flaccid Paralysis (AFP)',1,13),
  ('N','Gigitan Hewan Penular Rabies',1,14),
  ('O','Suspek Antrax',1,15),
  ('P','Suspek Leptospirosis',1,16),
  ('Q','Suspek Kolera',1,17),
  ('R','Suspek Meningitis/Encephalitis',1,18),
  ('S','Suspek Tetanus Neonatorum',1,19),
  ('T','Suspek Tetanus',1,20),
  ('U','ILI (Penyakit Serupa Influenza)',1,21),
  ('V','Suspek HFMD',1,22),
  ('W','ISPA',1,23),
  ('X','Covid-19 Konfirmasi',1,24)
ON CONFLICT(disease_code) DO UPDATE SET
  public_name=excluded.public_name,
  active=excluded.active,
  sort_order=excluded.sort_order;

CREATE TABLE IF NOT EXISTS public_disease_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  content_checksum TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  data_through_year INTEGER NOT NULL,
  data_through_week INTEGER NOT NULL,
  data_through_end TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  trend_cell_count INTEGER NOT NULL,
  distribution_cell_count INTEGER NOT NULL,
  previous_snapshot_id TEXT REFERENCES public_disease_snapshots(snapshot_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS public_disease_snapshots_one_active_idx
ON public_disease_snapshots(active) WHERE active=1;
CREATE INDEX IF NOT EXISTS public_disease_snapshots_received_idx
ON public_disease_snapshots(received_at DESC);
CREATE INDEX IF NOT EXISTS public_disease_snapshots_checksum_idx
ON public_disease_snapshots(content_checksum);
