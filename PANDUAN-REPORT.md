# Report (Q1–Q4 + Tahunan) dengan Instagram API

## 1. Deploy
Folder `netlify/functions` hanya aktif kalau situs di-deploy lewat **Git (GitHub/GitLab) atau Netlify CLI**.
Drag-and-drop folder statis tidak memasang fungsi, jadi tombol "Tarik data Instagram" akan menampilkan pesan error.

## 2. Environment variable (Netlify > Site configuration > Environment variables)
| Nama | Isi |
|---|---|
| `FIREBASE_PROJECT_ID` | `supervisi-medsos` (sama dengan projectId di `js/config.js`) |
| `IG_ACCOUNTS` | JSON per brand, kunci = id brand di OS |

Contoh `IG_ACCOUNTS`:
```json
{"soora-sushi-club":{"igUserId":"17841400000000000","token":"EAAG..."},
 "bulan-purnama":{"igUserId":"17841400000000001","token":"EAAG..."}}
```
- Akun Instagram harus Business/Creator dan punya izin `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`.
- Default memakai `graph.facebook.com` (Instagram API with Facebook Login, token Page yang dibuat dari long-lived user token tidak kedaluwarsa).
  Kalau memakai Instagram Login, tambahkan `"host":"graph.instagram.com"`; token jenis ini berlaku 60 hari dan harus diperbarui.
- Token hanya ada di server Netlify, tidak pernah sampai ke browser atau Firestore.

## 3. Cara pakai
Operation > **Report** > pilih tahun dan periode (Q1/Q2/Q3/Q4/Tahunan) > **Tarik data Instagram**.
- Hasil tarikan disimpan per kuartal di `brands/{id}/ig_reports`, jadi laporan lama tetap bisa dibuka.
- **Tahunan** = gabungan snapshot Q1–Q4. Tarik tiap kuartal sekali; tombol di tab Tahunan menarik semua kuartal yang sudah berjalan.
- Pertumbuhan followers dihitung dari riwayat tarikan (`ig_followers`): Instagram tidak menyediakan riwayat followers lama, jadi mulai terisi dari tarikan pertama.
- Kuartal dihitung kalender (Q1 = Jan–Mar). Ubah di konstanta `PERIODS` di `js/views/report.js` bila kuartal fiskal berbeda.

## 4. Firestore rules
Pakai aturan yang sudah ada untuk `brands/{brandId}/{sub}`; `ig_reports` dan `ig_followers` mengikuti aturan yang sama dengan `content_plan`.
