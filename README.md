# ONESPORT · Multi-Sport Match & Tournament Engine Online

Aplikasi web manajemen pertandingan mabar, rotasi pemain, live score, dan klasemen otomatis untuk **Badminton** dan **Mini Soccer** yang siap dijalankan secara **Online** dengan **Realtime Cloud Sync** dan **PWA (Progressive Web App)**.

---

## Fitur Online & Unggulan Terbaru

1. **Mode Online & Realtime Sync (WebSockets Zero-Config)**:
   - **Host / Admin**: Buat kode room unik (contoh: `BADM-782`), atur PIN wasit, dan kelola pertandingan.
   - **Penonton / Pemain (Live Score)**: Buka tautan atau masukkan kode room dari HP masing-masing di lapangan. Skor dan status lapangan terupdate secara live dalam hitungan milidetik tanpa reload!
   - **Mode Kolaborasi Wasit**: Wasit di Lapangan 1 & Lapangan 2 bisa menginput skor dari HP masing-masing secara bersamaan.
   - **Scan QR Code**: Cukup tampilkan QR Code di HP/Tablet, pemain lain tinggal scan kamera HP untuk langsung masuk ke sesi live.
2. **PWA (Progressive Web App)**:
   - Bisa di-install langsung di HP Android & iPhone seperti aplikasi native (*Add to Home Screen*).
   - Dilengkapi Service Worker (`sw.js`) untuk caching offline & loading secepat kilat.
3. **Penyimpanan Otomatis (LocalStorage)**:
   - Data pemain, jadwal rotasi, dan riwayat skor tidak akan hilang meskipun halaman di-refresh atau browser ditutup.
4. **Cadangkan & Pulihkan (Backup & Restore)**:
   - Ekspor dan impor seluruh data sesi turnamen ke file `.json`.
   - Ekspor rekap klasemen & statistik ke format `.csv`.

---

## 🚀 Panduan Publikasi ke GitHub Pages (Online Gratis)

Untuk membuat website ini online dan dapat diakses publik oleh siapa saja lewat internet menggunakan **GitHub Pages**:

### Langkah 1: Buat Repositori di GitHub
1. Buka [github.com/new](https://github.com/new) di browser Anda.
2. Masukkan nama repositori, misalnya: `onesport` atau `onesport-mabar`.
3. Pilih **Public**.
4. Klik tombol **Create repository** (jangan centang README/license karena file sudah ada di folder ini).

### Langkah 2: Hubungkan & Push Kode dari Komputer Anda
Buka Terminal / PowerShell di folder ini, lalu jalankan perintah berikut (ganti `<username>` dan `<repo-name>` dengan milik akun GitHub Anda):

```bash
git branch -M main
git remote add origin https://github.com/<username>/<repo-name>.git
git push -u origin main
```

*(Jika diminta login, masukkan akun GitHub Anda / Personal Access Token).*

### Langkah 3: Aktifkan GitHub Pages
1. Di halaman repositori GitHub Anda, buka menu **Settings** (di tab bagian atas).
2. Di sidebar kiri, klik menu **Pages** (di bawah *Code and automation*).
3. Di bagian **Build and deployment**:
   - **Source**: Pilih `Deploy from a branch`
   - **Branch**: Pilih `main` dan folder `/ (root)`
   - Klik **Save**.
4. Tunggu sekitar 1 - 2 menit, GitHub akan menampilkan pesan:
   > **Your site is live at `https://<username>.github.io/<repo-name>/`**

🎉 **Selesai!** Website ONESPORT Anda sekarang sudah resmi online dan bisa dibuka oleh siapa saja dari seluruh dunia!

---

## 📲 Cara Install Aplikasi di Smartphone (PWA)

- **Android (Google Chrome)**:
  Buka link website online Anda → Tekan tombol titik tiga (⋮) di pojok kanan atas → Pilih **"Install App"** atau **"Tambahkan ke Layar Utama"**.
- **iPhone / iPad (Safari)**:
  Buka link website online Anda di Safari → Tekan tombol **Share** (ikon kotak panah ke atas di bagian bawah) → Pilih **"Add to Home Screen"** (*Tambahkan ke Layar Utama*).

---

## 🛠️ Alternatif Hosting Instan Lainnya (100% Gratis)

- **Netlify Drop (Paling Instan tanpa Git)**:
  Buka [app.netlify.com/drop](https://app.netlify.com/drop), lalu tarik (*drag & drop*) folder ini ke browser. Dalam 30 detik website Anda langsung online dengan domain publik HTTPS gratis!
- **Vercel**:
  Buka [vercel.com](https://vercel.com) → Import repositori GitHub Anda → Deploy langsung 1-klik.
