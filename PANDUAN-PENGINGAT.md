# Pengingat Job di HP (notifikasi + getar)

Member yang masih punya job belum dicentang diingatkan lewat notifikasi di HP-nya:

- **Otomatis** jam **09.15, 13.00, dan 16.00 WIB**. Hanya dikirim bila masih ada job belum selesai (hari ini atau tertunda dari hari lalu). Yang semua jobnya sudah tercentang tidak diganggu. Job yang dibatalkan dan job hari berikutnya tidak dihitung.
- **Manual**: tombol **Ingatkan tim** di *Bagikan Job* (semua member yang belum selesai, mengikuti filter brand) dan ikon lonceng di kartu tiap member. Bisa menambah pesan singkat.

Teknologi: Web Push lewat Firebase Cloud Messaging. Pesan dikirim oleh fungsi Netlify, jadi tetap sampai walaupun web ditutup.

## Pemasangan (sekali saja)

### 1. Kunci Web Push
Firebase Console > Project settings > **Cloud Messaging** > *Web Push certificates* > **Generate key pair**. Salin kuncinya ke `vapidKey` di `js/config.js`.

### 2. Service account untuk fungsi Netlify
Firebase Console > Project settings > **Service accounts** > *Generate new private key*. Di Netlify (Site configuration > Environment variables) isi salah satu:

- `FIREBASE_SERVICE_ACCOUNT` = seluruh isi file JSON dalam satu baris, **atau**
- `FCM_CLIENT_EMAIL` = isi `client_email`, dan `FCM_PRIVATE_KEY` = isi `private_key`.

Pakai cara kedua bila total environment variable mendekati batas 4 KB (mis. karena `IG_ACCOUNTS`). `FIREBASE_PROJECT_ID` sudah ada untuk Report; tetap dipakai di sini. Jangan commit file JSON ke Git.

### 3. Aturan Firestore
Tambahkan di `firestore.rules` (di dalam `match /databases/{database}/documents`). Token hanya bisa dibaca pemiliknya; server membacanya lewat service account.

```
match /push_devices/{id} {
  allow create, update: if request.auth != null && request.resource.data.uid == request.auth.uid;
  allow read, delete:   if request.auth != null && resource.data.uid == request.auth.uid;
}
```
Koleksi `reminder_log` hanya dipakai server, tidak perlu aturan.

### 4. Deploy
Fungsi tidak ikut bila folder di-drag ke Netlify Drop. Deploy lewat Git atau `netlify deploy --prod`. Jadwal otomatis (scheduled function) hanya berjalan di deploy **production**, bukan deploy preview.

## Dipakai member
1. Buka **Job Hari Ini** > **Aktifkan pengingat** > Izinkan notifikasi.
2. Tekan **Kirim tes** untuk memastikan HP bunyi dan bergetar.
3. **iPhone**: wajib iOS 16.4+, dan web harus dipasang dulu. Safari > Bagikan > *Tambah ke Layar Utama*, lalu buka dari ikon di layar utama dan aktifkan di sana.

Saat member keluar (logout), HP itu dilepas dari akunnya, jadi HP bersama tidak menerima pengingat orang lain.

## Yang perlu diketahui
- **Getar**: jalan di Android (Chrome). iPhone tidak mendukung pola getar dari web; notifikasi tetap muncul dengan bunyi sistem. Getar juga mengikuti pengaturan HP (mode senyap/jangan ganggu menahannya).
- **Ketepatan jam**: scheduler Netlify bisa terlambat beberapa menit. Jam dihitung WIB.
- **Mengubah jam**: edit `config.schedule` di `netlify/functions/remind-0915.mjs`, `remind-1300.mjs`, `remind-1600.mjs`. Cron memakai UTC (WIB dikurangi 7 jam): 09.15 WIB = `15 2 * * *`, 13.00 WIB = `0 6 * * *`, 16.00 WIB = `0 9 * * *`. Mengganti jadwal ke jam lain: ubah juga nama slot di `runScheduled("...")`.
- **Job tertunda** hanya dicari 45 hari ke belakang (`lookbackDays` di `lib/push.mjs`).
- **Member yang belum aktifkan** tidak menerima apa pun. Setelah Ingatkan tim, supervisor diberi daftar siapa saja yang belum aktif.
- Pesan jadwal otomatis berisi: jumlah job belum selesai, progres checklist, dan jumlah job tertunda.
