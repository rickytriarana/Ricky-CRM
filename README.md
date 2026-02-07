# Arana CRM (Offline) — PWA (Gratis, tanpa Play Store)

Ini aplikasi CRM offline yang jalan di browser dan bisa di-install jadi "app" di Android (PWA).
Tidak perlu Google Play Developer fee, tidak perlu backend, tidak ada biaya hosting jika pakai GitHub Pages.

## Cara "Live" Gratis (paling mudah): GitHub Pages
1) Buat akun GitHub (gratis).
2) Buat repository baru, mis: arana-crm
3) Upload semua file dari folder ini ke repo (index.html, app.js, style.css, sw.js, manifest, icons).
4) Aktifkan GitHub Pages:
   - Settings → Pages → Source: Deploy from a branch → Branch: main → /(root)
5) Setelah live, akan dapat URL https://<username>.github.io/<repo>/
6) Buka URL itu di Chrome Android → menu (⋮) → Install app / Add to Home screen.

Catatan: Mode offline (service worker) butuh HTTPS (GitHub Pages sudah HTTPS).

## Data
Semua data tersimpan lokal di device (IndexedDB).
Ada fitur export backup JSON + restore.

## Import CSV
Header disarankan: name, phone, email, company, notes
Jika CSV tanpa header, urutan kolom dianggap: name, phone, email, company, notes

## Import VCF (vCard)
Di Android Contacts biasanya export ke .vcf. File .vcf bisa langsung di-import lewat menu Settings di aplikasi.
