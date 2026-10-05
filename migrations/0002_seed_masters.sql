INSERT OR IGNORE INTO signal_master(signal_code,signal_name_internal,community_label,community_definition,cadre_definition,default_priority,immediate_notification,response_target_hours,active,sort_order) VALUES
  ('FOOD','Dugaan keracunan pangan','Beberapa orang muntah atau diare setelah makan dari sumber yang sama','Keluhan pencernaan berkelompok setelah konsumsi bersama','Keluhan serupa setelah konsumsi makanan bersama','TINGGI',1,6,1,1),
  ('CLUSTER','Keluhan serupa berkelompok','Beberapa orang mengalami keluhan serupa dalam waktu dan tempat berdekatan','Keluhan kesehatan berkelompok','Keluhan yang sama dalam kelompok','SEDANG',0,24,1,2),
  ('DEATH','Kematian tidak biasa','Terdapat kematian mendadak atau tidak biasa','Kematian yang perlu dilaporkan','Kematian tidak biasa','TINGGI',1,2,1,3),
  ('SCHOOL','Absensi sekolah karena sakit','Banyak anak sekolah tidak masuk karena sakit dengan keluhan serupa','Peningkatan absensi sakit','Absensi sakit berkelompok','SEDANG',0,24,1,4),
  ('ENV','Paparan lingkungan','Gangguan air, makanan, udara, limbah, atau bahan kimia','Paparan lingkungan berisiko','Paparan lingkungan berisiko','TINGGI',1,6,1,5),
  ('ZOONOSIS','Hewan sakit atau mati tidak biasa','Hewan mati tidak biasa dan ada manusia sakit','Sinyal zoonosis','Sinyal hewan dan manusia','TINGGI',1,6,1,6),
  ('RABIES','Gigitan hewan berisiko rabies','Gigitan hewan yang diduga rabies','Pajanan rabies','Pajanan rabies','TINGGI',1,2,1,7),
  ('OTHER','Kejadian kesehatan lain','Kejadian kesehatan lain yang mengkhawatirkan','Sinyal lain','Sinyal lain','RENDAH',0,24,1,8);
