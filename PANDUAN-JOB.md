# Job Harian, Riwayat, dan KPI

Menu baru **Kerja Harian** di sidebar.

## Supervisor / Executive
- **Bagikan Job**: pilih tanggal, lalu *Bagikan job*. Isi judul, brief, checklist (satu baris = satu item), batas jam, prioritas, lalu centang penerima. Penerima dikelompokkan per section (peran), bisa dicentang per orang atau seluruh section. Satu job menjadi satu dokumen per penerima, jadi progres tiap orang terpisah.
- Papan harian menampilkan tiap section, tiap member, progres checklist, dan status job. Klik judul job untuk melihat detail, riwayat aktivitas, memberi **review** (nilai 1-5 + catatan), **minta revisi** (menambah item revisi dan membuka job lagi), mengubah, menghapus (hanya bila belum dikerjakan), atau membatalkan (bila sudah dikerjakan; riwayat tetap ada dan tidak dihitung KPI).
- **Salin dari tanggal lain**: menyalin job rutin ke tanggal terpilih dengan checklist baru.
- **Riwayat Job**: semua job dengan filter periode, member, brand, status (termasuk *Menunggu review*), plus unduh CSV.
- **KPI Tim**: tabel per member dan per section, plus unduh CSV dan cetak.

## Member
- **Job Hari Ini**: job hari ini, job tertunda dari hari sebelumnya, dan job 7 hari ke depan. Centang tiap item checklist, isi *Catatan & hasil* (catatan + link).
- **Riwayat & KPI Saya**: semua job milik sendiri beserta ringkasan KPI.

## Rumus KPI
- Selesai = job tuntas / (job tuntas + job tertunda). Job hari ini yang masih berjalan tidak mengurangi nilai.
- Tepat waktu = job yang pertama kali tuntas pada atau sebelum tanggalnya (dan jam batas bila diisi) / job tuntas. Revisi tidak mengubah ini.
- Review = rata-rata nilai 1-5.
- Skor KPI = rata-rata berbobot 50% selesai, 30% tepat waktu, 20% review (skala 100). Komponen yang belum ada datanya dilewati. Ubah bobot di `KPI_WEIGHTS` pada `js/views/jobs.js`.

## Data dan aturan Firestore
Disimpan di `brands/{brandId}/job_assignments`, mengikuti aturan yang sama dengan `content_plan`. Tidak ada perubahan di `store.js`. Setiap perubahan dicatat di field `log` pada dokumen job (siapa, kapan, apa), itulah sumber riwayat.

Catatan: pemisahan "member hanya melihat job miliknya" saat ini dilakukan di aplikasi. Member bisa menulis ke koleksi ini bila aturan brand mengizinkan, karena aplikasi membaca seluruh koleksi lalu menyaring. Bila ingin dikunci di sisi server, aturan dan query perlu diubah bersama (query dengan `where assigneeUid == uid`).
