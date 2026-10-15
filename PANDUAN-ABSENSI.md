# Absensi

Menu baru di grup **Kerja Harian**: Absensi, Riwayat Absensi, dan (khusus Supervisor/Executive) Rekap Absensi. Kartu Absensi juga muncul di Beranda.

## Member
- **Absensi**: pilih jenis (Datang, Pulang, Izin, Sakit). Nama diambil dari akun yang sedang masuk, jadi tidak perlu memilih nama.
- **Foto diri** wajib untuk Datang dan Pulang (di HP langsung membuka kamera depan), opsional untuk Izin/Sakit.
- **Izin/Sakit**: alasan dan foto bukti surat/dokumen bersifat opsional.
- **Lokasi** diambil otomatis dari GPS browser (izin lokasi harus diizinkan). Absen tetap bisa dikirim bila lokasi gagal; kolom lokasi akan kosong.
- Satu jenis absen hanya bisa dikirim sekali per hari. Izin/Sakit tidak bisa dikirim bila sudah absen Datang, dan sebaliknya.
- **Riwayat Absensi**: semua absen sendiri per periode, bisa diunduh CSV.

## Supervisor / Executive
- **Absensi Hari Ini**: papan per tanggal (Hadir, Terlambat, Izin, Sakit, Belum absen/Alpa). Tombol *Detail* membuka foto diri, bukti, alasan, dan tautan lokasi di peta. Tombol *Absen saya* untuk absen sendiri.
- **Riwayat Absensi**: semua catatan, filter periode, orang, dan jenis, plus CSV.
- **Rekap Absensi**: Hadir, Terlambat, Izin, Sakit, Alpa, dan persentase kehadiran per orang. Unduh CSV atau cetak.
- Supervisor dan Executive juga absen: lewat tombol *Absen saya*, dan ikut dihitung di papan dan rekap seperti anggota lain.

## Aturan yang bisa diubah
Di bagian atas `js/views/absensi.js`:
- `WORK_START` (jam masuk, default 09:00) dan `LATE_TOLERANCE_MIN` (toleransi, default 10 menit)
- `WORK_DAYS` (hari kerja untuk menghitung Alpa, default Senin sampai Jumat)

## Data
- `brands/{brandId}/attendance`: satu dokumen per orang per jenis per hari (id `tanggal-uid-jenis`).
- `brands/{brandId}/attendance_photos`: foto (dikompres di browser) dengan id yang sama, dibaca hanya saat *Detail* dibuka.
- Memakai aturan Firestore `brands/{brandId}/{sub}` yang sama dengan `content_plan` dan `job_assignments`. Tidak ada perubahan aturan, tetapi ada satu fungsi baru `getSub` di `js/store.js`.
- Jam dicatat dari jam perangkat saat absen dikirim.
- Data dari aplikasi absensi lama (prismatic-flan-f9ac86.netlify.app) tidak ikut terbawa.
