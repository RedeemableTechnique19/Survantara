# Survantara

Sistem surveilans, kewaspadaan dini, dan respons kesehatan masyarakat.
Dikembangkan pertama kali oleh **Naufal Hilmy Amanur Qolby** melalui proyek
**Survantara**.

Edisi umum ini menyediakan pelaporan kejadian oleh masyarakat dan kader,
screening dan verifikasi EBS, tindak lanjut kejadian, kegiatan lapangan,
laporan W2 faskes, laporan ketidakhadiran siswa, dan publikasi situasi penyakit
berdasarkan snapshot agregat tervalidasi. Backend memakai Cloudflare Workers
dan D1; antarmuka memakai JavaScript tanpa framework.

Repositori ini untuk instalasi baru. Tidak menyertakan data pasien, akun
operasional, hash PIN jejaring, branding institusi, atau riwayat Git aplikasi
operasional asal. Migrasi telah dibersihkan untuk database baru: **jangan
gunakan rangkaian migrasi ini untuk mengganti migrasi database operasional
yang sudah ada**.

## Menjalankan secara lokal

Gunakan Node.js 22.15 atau lebih baru dan npm. Jalankan dari direktori proyek:

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
# Edit .dev.vars: gunakan nilai acak yang berbeda untuk setiap secret.
npm run branding
npm run db:migrate:local
npm run dev
```

Alamat lokal ditampilkan oleh Wrangler. Desa, posyandu, pengguna, kader, dan
akun jejaring mulai kosong. Katalog sinyal dan penyakit tetap tersedia.

Buat administrator pertama melalui `POST /api/bootstrap` dengan header
`x-bootstrap-token` sesuai `BOOTSTRAP_TOKEN` pada `.dev.vars`. Contoh isi JSON:

```json
{
  "name": "Administrator Instalasi",
  "email": "admin@example.invalid",
  "password": "GANTI-dengan-kata-sandi-acak-yang-panjang"
}
```

Ganti alamat email dan kata sandi contoh. Kata sandi minimal 15 karakter dan
tidak boleh memuat nama, email, atau frasa umum. Endpoint bootstrap hanya
berfungsi selama tabel pengguna kosong. Masuk melalui **Akses petugas**;
buat pengguna tambahan, akun kader, dan institusi jejaring dari administrasi.
PIN akun baru dihasilkan aplikasi; tidak ada PIN operasional bawaan.

Sebelum membuat kader atau mengirim laporan, isi master wilayah. Salin
`examples/institution.sql` ke `institution.local.sql`, ganti seluruh data
fiktif dengan kode/nama wilayah dan posyandu instalasi, lalu jalankan:

```powershell
npx wrangler d1 execute sbm-db --local --file institution.local.sql
```

`tests/fixtures/villages.sql` hanya untuk pengujian dan tidak dijalankan saat
instalasi. File konfigurasi lokal dan secret diabaikan oleh Git.

## Branding dan adaptasi institusi

Profil bawaan `branding/profiles/umum.json` menampilkan Survantara tanpa logo,
maskot, kontak, foto, atau batas wilayah institusi. Profil `example.json`
berisi identitas fiktif untuk contoh dan pengujian; domain `.invalid` bukan
kontak layanan yang aktif.

Untuk adaptasi, salin profil umum menjadi `branding/profiles/instansi.json`,
ubah `displayName`, `institution`, wordmark, kontak, dan pusat peta, lalu:

```powershell
npm run branding -- --profile instansi
```

Simpan logo, foto, atau maskot institusi di `public/assets/`; gunakan path
`/assets/...` pada profil. Peta distribusi wilayah menerima JSON berisi
`viewBox` dan array `shapes` melalui `assets.serviceAreaShapes`; formatnya
dicontohkan di `examples/service-area-shapes.json`. Setiap shape berisi
`name` (kode desa huruf besar yang sesuai database), `d` (path SVG), dan
`label` (koordinat teks dalam viewBox). Tanpa data bentuk wilayah,
aplikasi tetap menampilkan informasi tanpa peta wilayah. `links.w2Guide`
dapat diisi URL HTTPS panduan milik instalasi; tautan disembunyikan jika null.

Nama karya asli `projectName` tetap Survantara. Identitas pengembang asli
di `public/project.js`, footer, dan halaman **Tentang · Kredit pengembang**
dipertahankan pada adaptasi. `npm run branding` juga menyalin `LICENSE`
menjadi `public/LICENSE.txt`; edit sumber profil dan LICENSE, bukan file
hasil build. URL GitHub belum ditentukan dan tidak diberi tautan contoh.

Adaptasi institusi dapat memakai repositori atau fork tersendiri untuk logo,
maskot, kontak, dan konfigurasi institusi. Gunakan database dan deployment
terpisah; pembaruan kode umum dapat ditarik setelah diuji pada adaptasi.

## Konfigurasi akses dan integrasi

`SURVEILLANCE_MANAGER_EMAIL` menentukan satu administrator yang dapat
mengelola screening, kegiatan lapangan, dan alur tindak lanjut kejadian.
Alamat harus cocok dengan pengguna berperan ADMIN. Tanpa konfigurasi ini,
akses fitur tersebut ditolak. Kredit pengembang tidak memberikan hak akses.

`AUTH_ISSUER` menentukan nama di aplikasi authenticator; default Survantara.
`SBM_ALLOWANCE_AMOUNT` menentukan nominal OH per peserta hadir, default
100000 rupiah. Nominal harus bilangan bulat positif. Nominal yang disetujui
dipertahankan ketika pembayaran dikonfirmasi.

`PATIENT_DATA_KEY` adalah kunci terpisah untuk enkripsi identitas pasien.
`JWT_SECRET` dan `BOOTSTRAP_TOKEN` wajib berbeda dan acak. Integrasi
SKD-KLB bersifat opsional: `SKDKLB_INTEGRATION_TOKEN` untuk sinkronisasi
yang dibatasi route, `SKDKLB_PUBLICATION_TOKEN` untuk snapshot agregat.
Notifikasi Telegram memakai `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID`.
Tanpa konfigurasi Telegram, aplikasi menyimpan status notifikasi sebagai
belum dikonfigurasi. Situasi penyakit menampilkan keadaan kosong sampai
snapshot tervalidasi tersedia.

## Deployment Cloudflare

```powershell
npx wrangler login
npx wrangler d1 create sbm-db
```

Masukkan ID database hasil perintah ke `wrangler.toml`. ID nol pada template
hanya placeholder. Atur secret instalasi:

```powershell
npx wrangler secret put JWT_SECRET
npx wrangler secret put PATIENT_DATA_KEY
npx wrangler secret put BOOTSTRAP_TOKEN
npx wrangler secret put SURVEILLANCE_MANAGER_EMAIL
npm run db:migrate:remote
npm run branding
npm run deploy
```

Isi master wilayah pada database remote dengan file lokal yang sudah
disesuaikan (`d1 execute ... --remote --file institution.local.sql`). Buat
admin pertama pada URL deployment melalui bootstrap seperti langkah lokal.
Konfigurasi lokal `.dev.vars` tidak ikut menjadi secret deployment.

## Pemeriksaan sebelum commit

```powershell
npm run check
npm run test:deployment
npm run test:branding
npm test
git add --all
npm run check:public
git diff --cached --check
```

Suite regresi menggunakan database sementara, data wilayah fiktif, dan
akun uji. Sebelum memasukkan fixture, suite memastikan database baru tidak
memuat pengguna, kader, akun jejaring, desa, posyandu, atau laporan.
`check:public` membaca isi yang sudah di-staging di Git, menolak perubahan
yang belum di-staging, dan memeriksa pola berkas, identitas, serta token.
Pemeriksaan berbasis pola ini tidak menggantikan penilaian keamanan aplikasi.
Untuk pemeriksaan browser opsional, pasang Playwright pada lingkungan QA
dan arahkan `SBM_UI_QA` ke path absolut modul Playwright `index.mjs`.
`test:branding` menggunakan Microsoft Edge headless dan memeriksa lebar
320/390/1280, halaman publik, kredit pada kedua profil, CSP, serta tanpa
JavaScript. Screenshot QA berada di `output/` dan tidak ikut commit.

## Lisensi dan sumber pihak ketiga

Kode asli memakai [lisensi khusus dengan kewajiban atribusi](LICENSE),
termasuk atribusi yang terlihat pada aplikasi adaptasi. Ini publikasi kode
yang dapat dipelajari dan diadaptasi (*source available*); lisensi ini belum
ditinjau penasihat hukum dan tidak diklaim sebagai lisensi yang disetujui
[Open Source Initiative](https://opensource.org/licenses).

Komponen dan sumber pihak ketiga dijelaskan dalam [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Katalog surveilans tidak menyatakan dukungan atau pengesahan aplikasi oleh
Kementerian Kesehatan.
