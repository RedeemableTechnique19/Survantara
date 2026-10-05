-- Replace the abbreviated W2 help text with the complete operational
-- definitions supplied for the SKDR-2025 catalogue. Line breaks are kept so
-- long criteria remain scannable in both the desktop disclosure and mobile
-- disease card.

UPDATE w2_indicators SET definition = 'BAB yang frekuensinya 3 kali atau lebih dalam 24 jam dengan konsistensi tinja cair.', updated_at = datetime('now') WHERE indicator_code = 'A';

UPDATE w2_indicators SET definition = 'Penderita yang di dalam tubuhnya ditemukan Plasmodium atau parasit malaria yang dibuktikan dengan pemeriksaan mikroskopis positif dan/atau RDT (Rapid Diagnostic Test) positif.', updated_at = datetime('now') WHERE indicator_code = 'B';

UPDATE w2_indicators SET definition = 'Demam tinggi (≥39°C) mendadak tanpa sebab yang jelas selama 2–7 hari, mual, muntah, sakit kepala, nyeri di belakang bola mata (nyeri retro-orbital), nyeri sendi, dan adanya manifestasi perdarahan sekurang-kurangnya uji tourniquet (Rumple-Leede) positif.', updated_at = datetime('now') WHERE indicator_code = 'C';

UPDATE w2_indicators SET definition = 'Pada usia <5 tahun ditandai dengan batuk DAN/ATAU tanda kesulitan bernapas (ditandai dengan adanya napas cepat). Gejala <14 hari, kadang disertai tarikan dinding dada bagian bawah ke dalam (TDDK), atau pada pneumonia berat ditemukan saturasi oksigen <92%. Frekuensi napas cepat berdasarkan usia penderita:
• <2 bulan: RR ≥60/menit
• 2–12 bulan: RR ≥50/menit
• 1–5 tahun: RR >40/menit

Pada usia >5 tahun ditandai dengan demam ±38°C, batuk DAN/ATAU kesulitan bernapas, frekuensi napas ≥30 kali/menit dan nyeri dada saat menarik napas, atau gambaran radiologi foto toraks menunjukkan infiltrat paru akut.', updated_at = datetime('now') WHERE indicator_code = 'D';

UPDATE w2_indicators SET definition = 'Diare dengan darah dan lendir dalam tinja, dapat disertai dengan adanya tenesmus. Disentri berat adalah disentri yang disertai dengan komplikasi.', updated_at = datetime('now') WHERE indicator_code = 'E';

UPDATE w2_indicators SET definition = 'Penyakit infeksi saluran cerna yang disebabkan oleh kuman Salmonella typhi A, Salmonella paratyphi A, Salmonella paratyphi B, dan Salmonella paratyphi C, dengan gejala demam khas seperti anak tangga naik (step ladder fever); demam saat sore–malam lebih tinggi daripada demam pagi–siang, disertai gangguan pencernaan. Nelwan score dengan cut-off point 10 dapat digunakan untuk skrining tifoid.', updated_at = datetime('now') WHERE indicator_code = 'F';

UPDATE w2_indicators SET definition = 'Kumpulan gejala yang terdiri dari kulit dan sklera berwarna kuning serta urine berwarna gelap yang timbul secara mendadak.', updated_at = datetime('now') WHERE indicator_code = 'G';

UPDATE w2_indicators SET definition = 'Demam mendadak ≥38,5°C dan nyeri persendian hebat (severe arthralgia), dan/atau dapat disertai adanya ruam (rash).', updated_at = datetime('now') WHERE indicator_code = 'H';

UPDATE w2_indicators SET definition = 'a. Demam ≥38°C dan ILI, disertai satu atau lebih pajanan di bawah ini dalam 7 hari sebelum mulainya gejala:
• Kontak erat dengan pasien suspek, probable, atau kasus H5N1 yang sudah terkonfirmasi.
• Terpajan dengan ternak ayam, unggas liar, unggas air, bangkai unggas, atau lingkungan yang tercemar oleh kotoran unggas di wilayah terjangkit dalam satu bulan terakhir.
• Mengonsumsi produk unggas mentah atau yang tidak dimasak dengan sempurna, yang berasal dari wilayah yang dicurigai atau dipastikan terdapat hewan atau manusia terkonfirmasi H5N1 dalam satu bulan terakhir.
• Kontak erat dengan binatang lain yang telah terkonfirmasi terinfeksi H5N1.
• Memegang atau menangani sampel (hewan atau manusia) yang dicurigai mengandung virus H5N1 di laboratorium atau tempat lainnya.

b. Demam ≥38°C dan ILI, disertai leukopenia dan tampak gambaran pneumonia pada foto toraks.

c. Demam ≥38°C dan ILI, disertai ditemukannya titer antibodi terhadap H5 dengan pemeriksaan uji HI menggunakan eritrosit kuda atau uji ELISA untuk Influenza A tanpa subtipe.

d. Seseorang yang mempunyai gejala ILI secara klinis dan radiologis yang cepat mengalami perburukan meskipun riwayat kontak tidak jelas.', updated_at = datetime('now') WHERE indicator_code = 'J';

UPDATE w2_indicators SET definition = 'Setiap kasus dengan gejala minimal demam dan ruam makulopapular.', updated_at = datetime('now') WHERE indicator_code = 'K';

UPDATE w2_indicators SET definition = 'Seseorang dengan gejala adanya infeksi saluran pernapasan atas dan pseudomembran.', updated_at = datetime('now') WHERE indicator_code = 'L';

UPDATE w2_indicators SET definition = 'Batuk lebih dari 2 minggu disertai minimal satu gejala di bawah ini:
• Batuk rejan saat napas dalam (inspiratory whoop).
• Muntah setelah batuk.
• Muntah tanpa penyebab yang jelas.
• Untuk anak usia <1 tahun, henti napas dengan atau tanpa sianosis (bibir kebiruan).', updated_at = datetime('now') WHERE indicator_code = 'M';

UPDATE w2_indicators SET definition = 'Semua anak berusia kurang dari 15 tahun dengan kelumpuhan atau kelemahan yang sifatnya flaccid (layu), terjadi secara akut (mendadak), dan bukan disebabkan oleh rudapaksa.', updated_at = datetime('now') WHERE indicator_code = 'N';

UPDATE w2_indicators SET definition = 'Kasus gigitan hewan (anjing, kucing, monyet, atau hewan berdarah panas lainnya) yang dapat menularkan rabies pada manusia.', updated_at = datetime('now') WHERE indicator_code = 'P';

UPDATE w2_indicators SET definition = '(1) Antraks Kulit (Cutaneous Anthrax)
Papul pada tempat inokulasi, rasa gatal tanpa disertai rasa sakit; dalam 2–3 hari menjadi vesikel berisi cairan kemerahan dan hemoragik, kemudian menjadi jaringan nekrotik. Ulsera ditutupi kerak hitam dan kering atau eschar (patognomonik), disertai demam, sakit kepala, dan pembengkakan kelenjar limfe regional.

(2) Antraks Saluran Pencernaan (Gastrointestinal Anthrax)
Rasa sakit perut hebat, mual, muntah, tidak nafsu makan, demam, konstipasi, gastroenteritis akut yang kadang disertai darah, hematemesis, pembesaran kelenjar limfe daerah inguinal, perut membesar dan keras, asites, edema skrotum, dan melena.

(3) Antraks Paru-Paru (Pulmonary Anthrax)
Gejala klinis sesuai dengan tanda-tanda bronkitis. Dalam waktu 2–4 hari gejala semakin berkembang dengan gangguan respirasi berat, demam, sianosis, dispnea, stridor, keringat berlebihan, detak jantung meningkat, serta nadi lemah dan cepat. Kematian biasanya terjadi 2–3 hari setelah gejala klinis timbul.

(4) Antraks Meningitis
Komplikasi dari dua bentuk utama antraks (pencernaan dan paru), dengan gambaran klinis demam, nyeri kepala hebat, kejang, kaku kuduk, dan penurunan kesadaran. Mortalitas hampir 100%.', updated_at = datetime('now') WHERE indicator_code = 'Q';

UPDATE w2_indicators SET definition = 'Demam akut ≥38,5°C dan/atau nyeri kepala hebat, dengan nyeri otot, malaise, conjunctival suffusion (radang pada konjungtiva), nyeri betis, disertai adanya riwayat kontak dengan lingkungan yang terkontaminasi Leptospira (daerah banjir, persawahan, atau selokan).', updated_at = datetime('now') WHERE indicator_code = 'R';

UPDATE w2_indicators SET definition = 'Diare cair akut yang berlangsung <7 hari dengan tanda-tanda dehidrasi berat.', updated_at = datetime('now') WHERE indicator_code = 'S';

UPDATE w2_indicators SET definition = 'Panas >38°C secara mendadak, sakit kepala, kaku kuduk, kadang disertai penurunan kesadaran dan muntah. Pada anak <1 tahun, ubun-ubun besar cembung.', updated_at = datetime('now') WHERE indicator_code = 'U';

UPDATE w2_indicators SET definition = 'Setiap bayi lahir hidup umur 3–28 hari yang sulit menyusu atau menetek, mulut mencucu, dan disertai dengan kejang rangsangan.', updated_at = datetime('now') WHERE indicator_code = 'V';

UPDATE w2_indicators SET definition = 'Ditandai dengan kontraksi dan kekejangan otot mendadak, dan sebelumnya ada riwayat luka.', updated_at = datetime('now') WHERE indicator_code = 'W';

UPDATE w2_indicators SET definition = 'Penderita dengan demam ≥38°C (diukur pada saat di fasyankes) disertai batuk <10 hari.', updated_at = datetime('now') WHERE indicator_code = 'Y';

UPDATE w2_indicators SET definition = 'Demam akut (≥38,5°C) atau riwayat demam <5 hari dan ruam kulit yang khas (papulovesikular/bintil dan lenting disertai kemerahan) pada salah satu atau beberapa lokasi di telapak tangan, telapak kaki, kulit di atas bokong, lutut, atau siku, dengan atau tanpa disertai sariawan (stomatitis) di mulut. Biasanya terjadi pada anak di bawah 10 tahun.

ATAU

Demam akut (≥38,5°C) atau riwayat demam <5 hari yang disertai sariawan (stomatitis) atau ruam kulit yang khas seperti tersebut di atas DAN memiliki hubungan epidemiologis dengan kasus konfirmasi (merupakan kontak erat kasus konfirmasi).', updated_at = datetime('now') WHERE indicator_code = 'Z';

UPDATE w2_indicators SET definition = 'Gejala nonspesifik berupa demam akut, batuk, sakit tenggorokan, dan pilek.', updated_at = datetime('now') WHERE indicator_code = 'AA';

UPDATE w2_indicators SET definition = 'Seseorang yang dinyatakan positif terinfeksi virus COVID-19, yang dibuktikan dengan pemeriksaan laboratorium RT-PCR atau pemeriksaan RDT positif.', updated_at = datetime('now') WHERE indicator_code = 'AC';
