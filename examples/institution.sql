-- CONTOH FIKTIF. Salin ke institution.local.sql dan sesuaikan sebelum digunakan.
-- Tidak dijalankan secara otomatis oleh migrasi atau aplikasi.
INSERT INTO villages(village_code,village_name,subdistrict,active,sort_order)
VALUES ('CONTOH-01','Desa Contoh','Kecamatan Contoh',1,1);
INSERT INTO posyandu(posyandu_id,village_code,name)
VALUES ('POS-CONTOH-01','CONTOH-01','Posyandu Contoh');
