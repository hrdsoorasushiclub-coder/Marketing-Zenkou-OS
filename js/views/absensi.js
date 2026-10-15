// Absensi karyawan: Datang, Pulang, Izin, Sakit, lengkap dengan lokasi otomatis, foto diri, dan bukti izin/sakit.
//  - Member: absen sendiri (akun yang sedang masuk), lihat status hari ini dan riwayat sendiri.
//  - Supervisor/Executive: papan kehadiran per hari, riwayat semua orang, rekap per periode (CSV + cetak).
// Data: brands/{brandId}/attendance (satu dokumen per orang per jenis per hari) lewat store.listSub/saveSub.
// Foto disimpan terpisah di brands/{brandId}/attendance_photos (id sama) supaya daftar absen tetap ringan;
// foto hanya dibaca saat dibuka (store.getSub). Aturan Firestore brands/{brandId}/{sub} yang sudah ada tetap berlaku.

import { h, icon, toast, dialog, ROLES, isLead } from "../ui.js";

const COL = "attendance";
const PHOTO_COL = "attendance_photos";

// Aturan kerja (ubah di sini).
export const WORK_START = "09:00";   // jam masuk
const LATE_TOLERANCE_MIN = 10;       // toleransi keterlambatan (menit)
const WORK_DAYS = [1, 2, 3, 4, 5];   // hari kerja: 0 = Minggu ... 6 = Sabtu (dipakai untuk menghitung Alpa)
const TYPES = ["Datang", "Pulang", "Izin", "Sakit"];
const RANGES = [["7", "7 hari terakhir"], ["30", "30 hari terakhir"], ["month", "Bulan ini"], ["lastmonth", "Bulan lalu"], ["quarter", "Kuartal ini"], ["custom", "Kustom"]];

const UI = { date: null, hist: { range: "30", from: "", to: "", uid: "", type: "" }, recap: { range: "month", from: "", to: "" } };

/* ---------- waktu ---------- */
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const parseYmd = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const longDay = (s) => parseYmd(s).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = (s) => (s ? parseYmd(s).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "—");
const hm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const isWorkday = (s) => WORK_DAYS.includes(parseYmd(s).getDay());
const nowIso = () => new Date().toISOString();

function rangeOf(key, from, to) {
  const t = todayStr(), d = new Date();
  if (key === "7") return [addDays(t, -6), t];
  if (key === "30") return [addDays(t, -29), t];
  if (key === "month") return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  if (key === "lastmonth") return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))];
  if (key === "quarter") { const q = Math.floor(d.getMonth() / 3); return [ymd(new Date(d.getFullYear(), q * 3, 1)), ymd(new Date(d.getFullYear(), q * 3 + 3, 0))]; }
  return [from || addDays(t, -29), to || t];
}

/* ---------- aturan absen ---------- */
const isLate = (r) => {
  if (r.type !== "Datang" || !r.at) return false;
  const [H, M] = WORK_START.split(":").map(Number);
  const d = new Date(r.at);
  return d.getHours() * 60 + d.getMinutes() > H * 60 + M + LATE_TOLERANCE_MIN;
};
const typeKind = (r) => (r.type === "Datang" ? (isLate(r) ? "warn" : "ok") : r.type === "Pulang" ? "brand" : "warn");
const typeLabel = (r) => (isLate(r) ? "Datang · Terlambat" : r.type);
const chip = (txt, kind = "") => h("span", { class: "chip" + (kind ? " " + kind : "") }, txt);
const recId = (date, uid, type) => `${date}-${uid}-${type}`;
const mapsHref = (r) => (r.lat != null && r.lng != null ? `https://www.google.com/maps?q=${r.lat},${r.lng}` : "");
const sel = (options, cur, attrs = {}) => h("select", { class: "select", ...attrs }, options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h("option", { value: v, selected: v === cur }, l); }));
const put = (box, ...nodes) => box.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
const pct = (v) => (v == null ? "—" : Math.round(v) + "%");
const stat = (label, value, sub) => h("div", { class: "kstat" }, h("div", { class: "kv" }, value), h("div", { class: "kl" }, label), sub && h("div", { class: "ks" }, sub));

function download(name, rows) {
  const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const a = h("a", { href: URL.createObjectURL(new Blob(["\ufeff" + rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" })), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

function rangeControls(state, onChange) {
  const from = h("input", { class: "input date-inp", type: "date", value: state.from || rangeOf(state.range)[0], "aria-label": "Dari tanggal", onchange: (e) => { state.from = e.target.value; onChange(); } });
  const to = h("input", { class: "input date-inp", type: "date", value: state.to || rangeOf(state.range)[1], "aria-label": "Sampai tanggal", onchange: (e) => { state.to = e.target.value; onChange(); } });
  const sync = () => { from.hidden = to.hidden = state.range !== "custom"; };
  const s = sel(RANGES, state.range, { "aria-label": "Periode", onchange: (e) => { state.range = e.target.value; if (state.range === "custom") { [state.from, state.to] = rangeOf("30"); from.value = state.from; to.value = state.to; } sync(); onChange(); } });
  sync();
  return [s, from, to];
}

/* ---------- data ---------- */
async function loadRecords(ctx, brandIds) {
  const errs = [];
  const lists = await Promise.all(brandIds.map(async (id) => {
    try { return (await ctx.store.listSub(id, COL)).map((r) => ({ ...r, brandId: id })); } catch (e) { errs.push(e); return []; }
  }));
  if (errs.length && errs.length === brandIds.length) throw errs[0];
  return lists.flat();
}
const myRecords = (list, uid, date) => list.filter((r) => r.uid === uid && r.date === date);

// Orang yang dihitung hadir/alpa: semua anggota aktif yang bisa mengakses brand, termasuk Supervisor dan Executive.
async function loadPeople(ctx, records) {
  const users = (await ctx.store.listUsers()).filter((u) => u.active !== false);
  const ids = ctx.allowedBrands.map((b) => b.id);
  const canSee = (u) => (u.brands || []).includes("*") || (u.brands || []).some((b) => ids.includes(b));
  return users.filter((u) => canSee(u)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/* ---------- foto & lokasi ---------- */
function compress(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Foto tidak bisa dibaca. Coba foto lain.")); };
    img.src = url;
  });
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Browser ini tidak mendukung lokasi."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy || 0) }),
      (e) => reject(new Error(e.code === 1 ? "Izin lokasi ditolak. Aktifkan izin lokasi di browser, lalu coba lagi." : "Lokasi belum bisa diambil. Pastikan GPS aktif, lalu coba lagi.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

// Kolom foto: tombol ambil/pilih, pratinjau, dan hapus. onFile dipanggil dengan data URL (atau null).
function photoPicker({ label, capture, maxSide, quality, onData }) {
  const prev = h("img", { class: "ab-prev", alt: "", hidden: true });
  const input = h("input", { type: "file", accept: "image/*", hidden: true, ...(capture ? { capture } : {}) });
  const btn = h("button", { class: "btn", type: "button", onclick: () => input.click() }, icon("camera", 16), label);
  const clear = h("button", { class: "btn sm ghost", type: "button", hidden: true, onclick: () => { input.value = ""; prev.hidden = true; clear.hidden = true; onData(null); } }, "Hapus");
  input.addEventListener("change", async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const data = await compress(f, maxSide, quality);
      prev.src = data; prev.hidden = false; clear.hidden = false; onData(data);
    } catch (e) { toast(e.message, "err"); input.value = ""; }
  });
  return h("div", { class: "ab-photo" }, h("div", { class: "row-tight" }, btn, clear, input), prev);
}

/* ====================================================================== */
/*  Formulir absen                                                         */
/* ====================================================================== */
function absenForm(ctx, onDone) {
  const { user, store, brand } = ctx;
  const S = { type: "Datang", reason: "", selfie: null, proof: null, loc: null, locErr: "" };
  const box = h("div", { class: "ab-form" });
  const locBox = h("div", { class: "ab-loc" });
  const extra = h("div");
  const submit = h("button", { class: "btn primary", type: "button" }, icon("check", 16), "Kirim absen");
  let locBusy = false;

  const paintLoc = () => {
    if (locBusy) return put(locBox, h("span", { class: "muted" }, "Mengambil lokasi…"));
    if (S.loc) return put(locBox, icon("pin", 16), h("span", {}, `${S.loc.lat}, ${S.loc.lng}`, h("span", { class: "muted" }, ` (akurasi ±${S.loc.acc} m) `), h("a", { href: mapsHref(S.loc), target: "_blank", rel: "noopener" }, "Lihat di peta")),
      h("button", { class: "btn sm ghost", type: "button", onclick: fetchLoc }, "Perbarui"));
    put(locBox, icon("pin", 16), h("span", { class: "muted" }, S.locErr || "Lokasi belum diambil."), h("button", { class: "btn sm", type: "button", onclick: fetchLoc }, "Ambil lokasi"));
  };
  async function fetchLoc() {
    locBusy = true; S.locErr = ""; paintLoc();
    try { S.loc = await getLocation(); } catch (e) { S.loc = null; S.locErr = e.message; }
    locBusy = false; paintLoc();
  }

  const paintExtra = () => {
    const off = S.type === "Izin" || S.type === "Sakit";
    put(extra,
      off && h("div", { class: "field" }, h("label", { for: "ab-reason" }, "Alasan (opsional)"),
        h("textarea", { class: "textarea", id: "ab-reason", rows: 3, value: S.reason, placeholder: S.type === "Sakit" ? "Mis. demam, diperiksa dokter" : "Mis. keperluan keluarga", oninput: (e) => { S.reason = e.target.value; } })),
      off && h("div", { class: "field" }, h("span", { class: "lbl" }, "Bukti: foto surat atau dokumen (opsional)"),
        photoPicker({ label: "Pilih foto bukti", maxSide: 1100, quality: 0.7, onData: (d) => { S.proof = d; } })),
      h("div", { class: "field" }, h("span", { class: "lbl" }, off ? "Foto diri (opsional)" : "Foto diri saat absen"),
        photoPicker({ label: "Ambil foto", capture: "user", maxSide: 640, quality: 0.65, onData: (d) => { S.selfie = d; } })));
  };

  const types = h("div", { class: "ab-types", role: "group", "aria-label": "Jenis absen" }, TYPES.map((t) =>
    h("button", { type: "button", class: "ab-type", "aria-pressed": String(t === S.type), onclick: () => {
      S.type = t; types.querySelectorAll(".ab-type").forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === t)));
      S.proof = null; S.selfie = null; paintExtra();
    } }, t)));

  submit.onclick = async () => {
    const off = S.type === "Izin" || S.type === "Sakit";
    if (!off && !S.selfie) return toast("Foto diri wajib untuk absen Datang dan Pulang.", "err");
    submit.disabled = true;
    try {
      const date = todayStr();
      const all = await loadRecords(ctx, ctx.allowedBrands.map((b) => b.id));
      const mine = myRecords(all, user.uid, date);
      if (mine.some((r) => r.type === S.type)) throw new Error(`Kamu sudah absen ${S.type} hari ini.`);
      if (off && mine.some((r) => r.type === "Datang")) throw new Error("Kamu sudah absen Datang hari ini, jadi tidak bisa mengajukan izin atau sakit.");
      if (S.type === "Datang" && mine.some((r) => r.type === "Izin" || r.type === "Sakit")) throw new Error("Hari ini kamu sudah tercatat izin atau sakit.");
      const id = recId(date, user.uid, S.type);
      const rec = {
        id, uid: user.uid, name: user.name, role: user.role, type: S.type, date, at: nowIso(),
        reason: S.reason.trim(), lat: S.loc?.lat ?? null, lng: S.loc?.lng ?? null, acc: S.loc?.acc ?? null,
        hasSelfie: !!S.selfie, hasProof: !!S.proof,
      };
      // Foto lebih dulu: bila gagal, catatan absen tidak tersimpan setengah jalan.
      if (S.selfie || S.proof) await store.saveSub(brand.id, PHOTO_COL, { id, selfie: S.selfie || null, proof: S.proof || null });
      await store.saveSub(brand.id, COL, rec);
      toast(isLate(rec) ? "Absen tersimpan. Kamu tercatat terlambat." : "Absen berhasil dikirim.");
      onDone?.(rec);
    } catch (e) { toast(e.message || String(e), "err"); } finally { submit.disabled = false; }
  };

  box.append(
    h("div", { class: "field" }, h("span", { class: "lbl" }, "Nama"), h("div", { class: "ab-name" }, h("b", {}, user.name), h("span", { class: "muted" }, ROLES[user.role] || user.role))),
    h("div", { class: "field" }, h("span", { class: "lbl" }, "Jenis absen"), types),
    extra,
    h("div", { class: "field" }, h("span", { class: "lbl" }, "Lokasi (otomatis)"), locBox),
    h("div", { class: "hint muted", style: "margin-bottom:14px" }, `Waktu dicatat dari jam perangkat saat dikirim. Jam masuk ${WORK_START}, toleransi ${LATE_TOLERANCE_MIN} menit.`),
    submit);
  paintExtra(); paintLoc(); fetchLoc();
  return box;
}

/* ====================================================================== */
/*  Tampilan umum                                                          */
/* ====================================================================== */
async function openPhotos(ctx, r) {
  const body = h("div", { class: "ab-photos" }, h("p", { class: "muted" }, "Memuat foto…"));
  dialog({ title: `${r.name} · ${r.type} ${shortDay(r.date)}, ${hm(r.at)}`, body, actions: [{ label: "Tutup" }] });
  try {
    const p = await ctx.store.getSub(r.brandId, PHOTO_COL, r.id);
    const figs = [["Foto diri", p?.selfie], ["Bukti", p?.proof]].filter((x) => x[1]).map(([t, src]) => h("figure", {}, h("img", { src, alt: t }), h("figcaption", {}, t)));
    put(body, figs.length ? figs : h("p", { class: "muted" }, "Tidak ada foto pada catatan ini."),
      r.reason && h("p", {}, h("b", {}, "Alasan: "), r.reason),
      mapsHref(r) && h("p", {}, h("a", { href: mapsHref(r), target: "_blank", rel: "noopener" }, "Buka lokasi di peta"), h("span", { class: "muted" }, ` (${r.lat}, ${r.lng}, ±${r.acc ?? "?"} m)`)));
  } catch (e) { put(body, h("div", { class: "notice warn" }, e.message || "Foto gagal dimuat.")); }
}

const photoBtn = (ctx, r) => (r.hasSelfie || r.hasProof || r.reason || mapsHref(r))
  ? h("button", { class: "btn sm", type: "button", onclick: () => openPhotos(ctx, r) }, icon("camera", 14), "Detail") : "—";

function noBrand(lead) {
  return { crumbs: [{ label: "Kerja Harian" }, { label: "Absensi" }], node: h("div", { class: "empty" }, h("h3", {}, "Belum ada brand"), h("p", {}, lead ? "Tambahkan brand lebih dulu di Pengaturan > Brand." : "Minta supervisor memberi akses brand ke akunmu.")) };
}

/* ====================================================================== */
/*  Router                                                                 */
/* ====================================================================== */
export async function render(ctx, p = {}) {
  const lead = isLead(ctx.user);
  if (!ctx.allowedBrands.length) return noBrand(lead);
  const tab = p.tab || "today";
  if (tab === "history") return history(ctx, p.query, lead);
  if (tab === "recap" && lead) return recap(ctx);
  return lead ? board(ctx) : memberToday(ctx);
}

// Kartu kecil untuk Beranda.
export async function homeCard(ctx) {
  try {
    if (!ctx.allowedBrands.length) return null;
    const lead = isLead(ctx.user), t = todayStr();
    const recs = (await loadRecords(ctx, ctx.allowedBrands.map((b) => b.id))).filter((r) => r.date === t);
    let meta;
    if (lead) {
      const people = await loadPeople(ctx, recs);
      const here = new Set(recs.filter((r) => r.type === "Datang").map((r) => r.uid));
      const off = new Set(recs.filter((r) => r.type === "Izin" || r.type === "Sakit").map((r) => r.uid));
      meta = `${here.size} dari ${people.length} sudah datang${off.size ? ` · ${off.size} izin/sakit` : ""}`;
    } else {
      const mine = myRecords(recs, ctx.user.uid, t);
      const d = mine.find((r) => r.type === "Datang"), pl = mine.find((r) => r.type === "Pulang"), o = mine.find((r) => r.type === "Izin" || r.type === "Sakit");
      meta = o ? `Hari ini: ${o.type}` : pl ? `Pulang ${hm(pl.at)}` : d ? `Datang ${hm(d.at)}${isLate(d) ? " (terlambat)" : ""} · belum pulang` : "Belum absen hari ini";
    }
    return h("a", { class: "card link pillar", href: "#/absensi" }, h("span", { class: "ic" }, icon("clock", 22)),
      h("h3", {}, lead ? "Absensi Tim" : "Absensi"), h("p", {}, lead ? "Pantau kehadiran hari ini, lihat foto dan lokasi, serta rekap per periode." : "Absen datang, pulang, izin, atau sakit dengan foto dan lokasi."), h("span", { class: "meta" }, meta));
  } catch { return null; }
}

/* ====================================================================== */
/*  MEMBER: absen hari ini                                                 */
/* ====================================================================== */
async function memberToday(ctx) {
  const { user } = ctx;
  const t = todayStr();
  const status = h("div");
  const formHost = h("div");

  const paint = async () => {
    const all = await loadRecords(ctx, ctx.allowedBrands.map((b) => b.id));
    const mine = myRecords(all, user.uid, t).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    put(status, mine.length
      ? h("div", { class: "card ab-today" }, h("h3", {}, "Absen hari ini"),
        h("ul", { class: "ab-list" }, mine.map((r) => h("li", {}, chip(typeLabel(r), typeKind(r)), h("b", {}, hm(r.at)), r.reason && h("span", { class: "muted" }, r.reason), h("span", { style: "flex:1" }), photoBtn(ctx, r)))))
      : h("div", { class: "notice" }, h("b", {}, "Belum ada absen hari ini. "), "Pilih jenis absen di bawah, lalu kirim."));
  };
  await paint();
  const drawForm = () => put(formHost, h("div", { class: "card ab-card" }, absenForm(ctx, async () => { await paint(); drawForm(); })));
  drawForm();

  return {
    crumbs: [{ label: "Kerja Harian" }, { label: "Absensi" }],
    node: h("div", { style: "max-width:640px" },
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", {}, "Absensi"), h("p", { class: "lead" }, longDay(t)))),
      status, h("div", { style: "height:14px" }), formHost),
  };
}

/* ====================================================================== */
/*  LEAD: papan kehadiran per hari                                         */
/* ====================================================================== */
async function board(ctx) {
  const out = h("div");
  const all = await loadRecords(ctx, ctx.allowedBrands.map((b) => b.id));
  if (!UI.date) UI.date = todayStr();

  const paint = async () => {
    const date = UI.date;
    const recs = all.filter((r) => r.date === date);
    const people = await loadPeople(ctx, recs);
    const rows = people.map((u) => {
      const mine = myRecords(recs, u.uid, date);
      const get = (ty) => mine.find((r) => r.type === ty);
      const d = get("Datang"), pl = get("Pulang"), o = get("Izin") || get("Sakit");
      const state = d ? (isLate(d) ? ["Terlambat", "warn"] : ["Hadir", "ok"]) : o ? [o.type, "warn"] : date < todayStr() && isWorkday(date) ? ["Alpa", "warn"] : ["Belum absen", ""];
      return { u, d, pl, o, state };
    });
    const hadir = rows.filter((r) => r.d).length, izin = rows.filter((r) => !r.d && r.o).length, belum = rows.filter((r) => !r.d && !r.o).length;
    put(out,
      h("div", { class: "kstats" },
        stat("Hadir", `${hadir}/${rows.length}`, `${rows.filter((r) => r.d && isLate(r.d)).length} terlambat`),
        stat("Izin / sakit", String(izin)),
        stat(date < todayStr() ? "Tanpa keterangan" : "Belum absen", String(belum))),
      rows.length ? h("div", { class: "tablewrap plain" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Nama", "Status", "Datang", "Pulang", "Keterangan", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, rows.map(({ u, d, pl, o, state }) => h("tr", {},
          h("td", {}, h("b", {}, u.name), h("div", { class: "muted" }, ROLES[u.role] || u.role)),
          h("td", {}, chip(state[0], state[1])),
          h("td", {}, d ? hm(d.at) : "—"), h("td", {}, pl ? hm(pl.at) : "—"),
          h("td", {}, o?.reason || (o ? o.type : "") || ""),
          h("td", { class: "act" }, ...[d, pl, o].filter(Boolean).map((r) => photoBtn(ctx, r))))))))
        : h("div", { class: "empty" }, h("h3", {}, "Belum ada anggota tim"), h("p", {}, "Tambahkan anggota di Pengaturan > Tim.")));
  };

  const dateInp = h("input", { class: "input date-inp", type: "date", value: UI.date, max: todayStr(), "aria-label": "Tanggal", onchange: (e) => { UI.date = e.target.value || todayStr(); paint(); } });
  const tools = h("div", { class: "toolbar" },
    h("button", { class: "btn", type: "button", onclick: () => { UI.date = addDays(UI.date, -1); dateInp.value = UI.date; paint(); } }, icon("left", 16)),
    dateInp,
    h("button", { class: "btn", type: "button", onclick: () => { if (UI.date < todayStr()) { UI.date = addDays(UI.date, 1); dateInp.value = UI.date; paint(); } } }, icon("arrow", 16)),
    h("button", { class: "btn", type: "button", onclick: () => { UI.date = todayStr(); dateInp.value = UI.date; paint(); } }, "Hari ini"),
    h("span", { style: "flex:1" }),
    h("button", { class: "btn primary", type: "button", onclick: () => {
      const close = dialog({ title: "Absen saya", body: absenForm(ctx, async () => { close(); const fresh = await loadRecords(ctx, ctx.allowedBrands.map((b) => b.id)); all.splice(0, all.length, ...fresh); paint(); }), actions: [{ label: "Tutup" }] });
    } }, icon("clock", 16), "Absen saya"));
  await paint();

  return {
    crumbs: [{ label: "Kerja Harian" }, { label: "Absensi Hari Ini" }],
    node: h("div", {},
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", {}, "Absensi Tim"), h("p", { class: "lead" }, `${longDay(UI.date)}. Siapa sudah datang, terlambat, izin, atau sakit, lengkap dengan foto dan lokasi.`))),
      tools, out),
  };
}

/* ====================================================================== */
/*  Riwayat                                                                */
/* ====================================================================== */
async function history(ctx, query, lead) {
  const F = UI.hist;
  if (query?.get("uid")) F.uid = query.get("uid");
  const all = await loadRecords(ctx, ctx.allowedBrands.map((b) => b.id));
  const base = lead ? all : all.filter((r) => r.uid === ctx.user.uid);
  const people = new Map(base.map((r) => [r.uid, r.name]));
  const tbl = h("div"), cnt = h("div", { class: "muted", style: "margin:4px 0 10px" });

  const filtered = () => {
    const [from, to] = rangeOf(F.range, F.from, F.to);
    return base.filter((r) => r.date >= from && r.date <= to && (!F.uid || r.uid === F.uid) && (!F.type || r.type === F.type))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  };
  const paint = () => {
    const list = filtered();
    cnt.textContent = `${list.length} catatan`;
    put(tbl, list.length ? h("div", { class: "tablewrap plain" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Tanggal", lead && "Nama", "Jenis", "Jam", "Keterangan", ""].filter(Boolean).map((x) => h("th", {}, x)))),
      h("tbody", {}, list.map((r) => h("tr", {},
        h("td", {}, shortDay(r.date)),
        lead && h("td", {}, h("b", {}, r.name), h("div", { class: "muted" }, ROLES[r.role] || r.role)),
        h("td", {}, chip(typeLabel(r), typeKind(r))), h("td", {}, hm(r.at)),
        h("td", {}, r.reason || ""), h("td", { class: "act" }, photoBtn(ctx, r))))))) : h("div", { class: "empty" }, h("h3", {}, "Tidak ada catatan pada filter ini")));
  };
  const exportCsv = () => {
    const rows = [["Tanggal", "Jam", "Nama", "Section", "Jenis", "Terlambat", "Alasan", "Latitude", "Longitude", "Akurasi (m)", "Foto diri", "Bukti"]];
    filtered().slice().reverse().forEach((r) => rows.push([r.date, hm(r.at), r.name, ROLES[r.role] || r.role, r.type, isLate(r) ? "Ya" : "", r.reason || "", r.lat ?? "", r.lng ?? "", r.acc ?? "", r.hasSelfie ? "Ada" : "", r.hasProof ? "Ada" : ""]));
    download(`riwayat-absensi-${todayStr()}.csv`, rows);
  };
  const tools = h("div", { class: "toolbar" },
    ...rangeControls(F, paint),
    lead && sel([["", "Semua orang"], ...[...people].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([id, n]) => [id, n])], F.uid, { "aria-label": "Nama", onchange: (e) => { F.uid = e.target.value; paint(); } }),
    sel([["", "Semua jenis"], ...TYPES], F.type, { "aria-label": "Jenis", onchange: (e) => { F.type = e.target.value; paint(); } }),
    h("span", { style: "flex:1" }),
    h("button", { class: "btn", type: "button", onclick: exportCsv }, "Unduh CSV"));
  paint();

  return {
    crumbs: [{ label: "Kerja Harian" }, { label: "Riwayat Absensi" }],
    node: h("div", {},
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", {}, "Riwayat Absensi"), h("p", { class: "lead" }, lead ? "Semua catatan absen tim. Klik Detail untuk melihat foto, alasan, dan lokasi." : "Semua absenmu pada periode terpilih."))),
      tools, cnt, tbl),
  };
}

/* ====================================================================== */
/*  Rekap per periode (lead)                                               */
/* ====================================================================== */
async function recap(ctx) {
  const F = UI.recap;
  const all = await loadRecords(ctx, ctx.allowedBrands.map((b) => b.id));
  const out = h("div");
  let exportRows = [];

  const paint = async () => {
    const [from, to] = rangeOf(F.range, F.from, F.to);
    const t = todayStr();
    const recs = all.filter((r) => r.date >= from && r.date <= to);
    const people = await loadPeople(ctx, recs);
    // Hari yang dihitung: hari kerja sampai kemarin (hari ini baru dihitung bila sudah ada catatan), ditambah hari libur yang ada catatannya.
    const days = [];
    for (let d = from; d <= to && d <= t; d = addDays(d, 1)) {
      const any = recs.some((r) => r.date === d);
      if ((isWorkday(d) && d < t) || any) days.push(d);
    }
    const rows = people.map((u) => {
      const mine = recs.filter((r) => r.uid === u.uid);
      let hadir = 0, telat = 0, izin = 0, sakit = 0, alpa = 0;
      days.forEach((d) => {
        const m = myRecords(mine, u.uid, d);
        const dt = m.find((r) => r.type === "Datang");
        if (dt) { hadir++; if (isLate(dt)) telat++; }
        else if (m.some((r) => r.type === "Izin")) izin++;
        else if (m.some((r) => r.type === "Sakit")) sakit++;
        else if (isWorkday(d)) alpa++;
      });
      const base = hadir + izin + sakit + alpa;
      return { u, hadir, telat, izin, sakit, alpa, rate: base ? (hadir / base) * 100 : null };
    });
    exportRows = rows;
    const tot = rows.reduce((s, r) => ({ hadir: s.hadir + r.hadir, telat: s.telat + r.telat, izin: s.izin + r.izin, sakit: s.sakit + r.sakit, alpa: s.alpa + r.alpa }), { hadir: 0, telat: 0, izin: 0, sakit: 0, alpa: 0 });
    const denom = tot.hadir + tot.izin + tot.sakit + tot.alpa;
    put(out,
      h("div", { class: "kstats" },
        stat("Tingkat kehadiran", pct(denom ? (tot.hadir / denom) * 100 : null), `${shortDay(from)} – ${shortDay(to)}`),
        stat("Hadir", String(tot.hadir), `${tot.telat} terlambat`),
        stat("Izin / sakit", `${tot.izin} / ${tot.sakit}`),
        stat("Alpa", String(tot.alpa), "hari kerja tanpa catatan")),
      rows.length ? h("div", { class: "tablewrap plain" }, h("table", {},
        h("thead", {}, h("tr", {}, [["Nama"], ["Hadir", 1], ["Terlambat", 1], ["Izin", 1], ["Sakit", 1], ["Alpa", 1], ["Kehadiran", 1]].map(([x, n]) => h("th", { class: n ? "num" : "" }, x)))),
        h("tbody", {}, rows.map(({ u, hadir, telat, izin, sakit, alpa, rate }) => h("tr", {},
          h("td", {}, h("a", { class: "linklike", href: `#/absensi/history?uid=${encodeURIComponent(u.uid)}` }, u.name), h("div", { class: "muted" }, ROLES[u.role] || u.role)),
          h("td", { class: "num" }, hadir), h("td", { class: "num" }, telat), h("td", { class: "num" }, izin), h("td", { class: "num" }, sakit),
          h("td", { class: "num" }, alpa), h("td", { class: "num" }, pct(rate)))))))
        : h("div", { class: "empty" }, h("h3", {}, "Belum ada data pada periode ini")),
      h("div", { class: "notice", style: "margin-top:20px" }, h("b", {}, "Cara menghitung. "),
        `Hari yang dihitung: hari kerja (Senin sampai Jumat) sampai kemarin, serta hari lain yang ada catatan absennya. Hadir = ada absen Datang; Terlambat = Datang setelah ${WORK_START} + ${LATE_TOLERANCE_MIN} menit (sudah termasuk dalam Hadir). Izin/Sakit = tanpa Datang tetapi ada absen Izin/Sakit. Alpa = hari kerja tanpa catatan apa pun. Kehadiran = Hadir ÷ (Hadir + Izin + Sakit + Alpa). Supervisor dan Executive ikut dihitung seperti anggota lain. Jam masuk, toleransi, dan hari kerja bisa diubah di bagian atas js/views/absensi.js.`));
  };

  const exportCsv = () => {
    const [from, to] = rangeOf(F.range, F.from, F.to);
    const r = [["Nama", "Section", "Hadir", "Terlambat", "Izin", "Sakit", "Alpa", "Kehadiran %"]];
    exportRows.forEach((x) => r.push([x.u.name, ROLES[x.u.role] || x.u.role, x.hadir, x.telat, x.izin, x.sakit, x.alpa, x.rate == null ? "" : Math.round(x.rate)]));
    download(`rekap-absensi-${from}_${to}.csv`, r);
  };
  const tools = h("div", { class: "toolbar" },
    ...rangeControls(F, paint), h("span", { style: "flex:1" }),
    h("button", { class: "btn", type: "button", onclick: exportCsv }, "Unduh CSV"),
    h("button", { class: "btn", type: "button", onclick: () => window.print() }, "Cetak"));
  await paint();

  return {
    crumbs: [{ label: "Kerja Harian" }, { label: "Rekap Absensi" }],
    node: h("div", {},
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", {}, "Rekap Absensi"), h("p", { class: "lead" }, "Kehadiran, keterlambatan, izin, sakit, dan alpa tiap orang pada periode terpilih."))),
      tools, out),
  };
}
