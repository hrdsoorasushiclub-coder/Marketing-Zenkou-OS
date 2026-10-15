import { h, icon, toast, dialog, confirmDialog } from "../ui.js";
import { safeUrl } from "./content.js";

/* Media & KOL (per brand). Tersimpan di tiga koleksi:
   kol_campaigns : satu dokumen per KOL (paid / barter), termasuk hasil posting untuk reporting
   kol_visits    : jadwal dan absensi kunjungan KOL (centang + foto akun)
   kol_templates : template pesan approach
   Foto absensi dikompres lalu disimpan langsung di dokumen (batas dokumen Firestore 1 MB). */

const TYPE_LABEL = { paid: "Paid", barter: "Barter" };
const STATUS = {
  paid: ["Kandidat", "Negosiasi", "Deal", "Sudah datang", "Sudah posting", "Selesai", "Batal"],
  barter: ["Kandidat", "Menunggu persetujuan", "Disetujui", "Ditolak", "Sudah datang", "Sudah posting", "Selesai", "Batal"],
};
const PRE_VISIT = ["Kandidat", "Negosiasi", "Deal", "Menunggu persetujuan", "Disetujui"];
const PRE_POST = [...PRE_VISIT, "Sudah datang"];
const PLATFORMS = ["Instagram", "TikTok", "YouTube", "Lainnya"];
const RANKS = [["Nano", "di bawah 10 rb"], ["Micro", "10 rb - 100 rb"], ["Macro", "100 rb - 1 jt"], ["Mega", "di atas 1 jt"]];
const TOLERANSI = 15; // menit; lewat dari ini dianggap terlambat
const TPL_FOR = [["umum", "Semua jenis"], ["paid", "Paid"], ["barter", "Barter"]];
const TPL_CHANNEL = ["WhatsApp", "DM Instagram", "Email", "Lainnya"];
const PLACEHOLDERS = "{nama} {akun} {brand} {penawaran} {harga} {tanggal} {jam}";
const DEFAULT_TPLS = [
  { title: "Approach KOL paid", for: "paid", channel: "WhatsApp", body: "Halo kak {nama}, perkenalkan saya dari tim marketing {brand}. Kami tertarik berkolaborasi dengan kakak untuk {penawaran}. Boleh minta rate card terbaru dan jadwal kakak yang masih kosong? Terima kasih ya kak." },
  { title: "Approach KOL barter", for: "barter", channel: "WhatsApp", body: "Halo kak {nama}, kami dari {brand}. Kami ingin mengundang kakak menikmati menu kami ({penawaran}) dan berharap kakak berkenan membagikan pengalamannya lewat konten. Apakah kakak berminat? Kalau iya, kami atur jadwal kunjungannya." },
  { title: "Konfirmasi jadwal kedatangan", for: "umum", channel: "WhatsApp", body: "Halo kak {nama}, kami konfirmasi jadwal kunjungan ke {brand} pada {tanggal} pukul {jam}. Mohon kabari kami kalau ada perubahan ya kak. Sampai bertemu!" },
  { title: "Minta link posting", for: "umum", channel: "WhatsApp", body: "Halo kak {nama}, terima kasih sudah berkunjung ke {brand}. Kalau kontennya sudah tayang, boleh kirimkan link postingannya ya kak supaya kami catat. Terima kasih banyak!" },
];

/* ---------- fungsi bantu ---------- */
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const fmtDay = (s) => (s ? parseYmd(s).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "");
const fmtShort = (s) => (s ? parseYmd(s).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "");
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const mins = (t) => { const [a, b] = String(t || "0:0").split(":").map(Number); return a * 60 + (b || 0); };
const newId = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const int = (v) => { const d = String(v ?? "").replace(/\D/g, ""); return d ? parseInt(d, 10) : null; };
const dec = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : null; };
const nf = new Intl.NumberFormat("id-ID");
const fmtNum = (n) => (n == null || n === "" ? "—" : nf.format(n));
const fmtRp = (n) => (n == null || n === "" ? "—" : "Rp " + nf.format(n));
const fmtPct = (n) => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("id-ID", { maximumFractionDigits: 2 }) + "%");
const rankFor = (f) => (f == null ? "" : f < 1e4 ? "Nano" : f < 1e5 ? "Micro" : f < 1e6 ? "Macro" : "Mega");
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const chip = (t, kind = "") => h("span", { class: "chip" + (kind ? " " + kind : "") }, t);
const field = (label, node, hint, id) => h("div", { class: "field" }, h("label", { for: id }, label), node, hint && h("span", { class: "hint" }, hint));
const opts = (list, cur) => list.map((t) => (Array.isArray(t) ? h("option", { value: t[0], selected: t[0] === cur }, t[1] ?? t[0]) : h("option", { value: t, selected: t === cur }, t)));
const statusKind = (s) => (["Disetujui", "Deal", "Sudah datang", "Sudah posting", "Selesai"].includes(s) ? "ok" : ["Ditolak", "Batal"].includes(s) ? "warn" : "");
const interactions = (k) => (k.likes || 0) + (k.comments || 0) + (k.shares || 0) + (k.saves || 0);
const erActual = (k) => (k.views ? (interactions(k) / k.views) * 100 : null);
const hasReport = (k) => k.status === "Sudah posting" || k.status === "Selesai" || !!k.postLink || k.views != null;

function compress(img, maxW, quality) {
  const scale = Math.min(1, maxW / img.width);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
const readPhoto = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onerror = () => reject(new Error("Foto tidak bisa dibaca."));
  r.onload = (e) => {
    const img = new Image();
    img.onerror = () => reject(new Error("File bukan gambar yang valid."));
    img.onload = () => { let out = compress(img, 720, 0.65); if (out.length > 300000) out = compress(img, 520, 0.5); resolve(out); };
    img.src = e.target.result;
  };
  r.readAsDataURL(file);
});
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* lanjut ke cara lama */ }
  const ta = h("textarea", { style: "position:fixed;opacity:0" }); ta.value = text; document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch { ok = false; } ta.remove(); return ok;
}

/* ====================================================================== */
export async function render(ctx) {
  const { store, brand } = ctx;
  const crumbs = [{ label: "Operation", href: "#/ops" }, { label: brand.name }, { label: "Media & KOL" }];
  if (!brand.id || brand.id === "-") {
    return { crumbs, node: h("div", { class: "empty" }, h("h3", {}, "Belum ada brand"), h("p", {}, "Tambahkan brand lebih dulu di Pengaturan > Brand.")) };
  }

  let kols = [], visits = [], tpls = [];
  const reload = async () => {
    [kols, visits, tpls] = await Promise.all(["kol_campaigns", "kol_visits", "kol_templates"].map((n) => store.listSub(brand.id, n)));
  };
  await reload();

  const today = () => ymd(new Date());
  const S = { tab: "campaign", f: { q: "", type: "", status: "", campaign: "" }, date: today(), rsort: "terbaru", rcamp: "" };
  const panels = { campaign: h("div"), visit: h("div"), tpl: h("div"), report: h("div") };
  const tabsEl = h("div", { class: "tabs", role: "tablist" });
  const guard = async (fn) => { try { await fn(); } catch (e) { toast(e.message || String(e), "err"); } };
  const redraw = () => { drawCampaign(); drawVisit(); drawTpl(); drawReport(); };
  const save = async (name, item) => { await store.saveSub(brand.id, name, item); await reload(); redraw(); };
  const remove = async (name, id) => { await store.deleteSub(brand.id, name, id); await reload(); redraw(); };
  const saveKol = (k) => guard(() => save("kol_campaigns", k));
  const campaignNames = () => [...new Set(kols.map((k) => k.campaign).filter(Boolean))].sort();
  const kolById = (id) => kols.find((k) => k.id === id);

  const editDialog = ({ title, body, existing, label, onSave, onDelete, saveLabel }) => {
    const actions = [{ label: "Batal" }];
    if (existing && onDelete) {
      actions.unshift({ label: "Hapus", kind: "danger", onClick: async () => {
        if (!(await confirmDialog(`Hapus ${label}? Ini tidak bisa dibatalkan.`, "Ya, hapus"))) return false;
        await onDelete(); toast("Dihapus.");
      } });
    }
    actions.push({ label: saveLabel || (existing ? "Simpan" : "Tambahkan"), kind: "primary", onClick: async () => { await onSave(); toast("Tersimpan."); } });
    dialog({ title, body, actions });
  };

  /* ---------------- editor KOL ---------------- */
  function openKol(type, existing) {
    const k = existing || { id: newId("k"), type, platform: "Instagram", status: "Kandidat" };
    const t = k.type;
    const name = h("input", { class: "input", id: "kl-name", value: k.name || "", placeholder: "@namaakun", autocapitalize: "none", autocomplete: "off" });
    const platform = h("select", { class: "select", id: "kl-plat" }, opts(PLATFORMS, k.platform));
    const followers = h("input", { class: "input", id: "kl-fol", inputmode: "numeric", value: k.followers ?? "", placeholder: "Contoh: 45000" });
    const er = h("input", { class: "input", id: "kl-er", inputmode: "decimal", value: k.er ?? "", placeholder: "Contoh: 3,5" });
    const rank = h("select", { class: "select", id: "kl-rank" }, h("option", { value: "" }, "Belum ditentukan"), RANKS.map(([r, d]) => h("option", { value: r, selected: r === k.rank }, `${r} (${d})`)));
    let touched = !!k.rank;
    rank.addEventListener("change", () => { touched = true; });
    followers.addEventListener("input", () => { if (!touched) rank.value = rankFor(int(followers.value)); });
    const camp = h("input", { class: "input", id: "kl-camp", list: "kl-camps", value: k.campaign || "", placeholder: "Contoh: Opening Surabaya" });
    const camps = h("datalist", { id: "kl-camps" }, campaignNames().map((c) => h("option", { value: c })));
    const contact = h("input", { class: "input", id: "kl-contact", value: k.contact || "", placeholder: "No. WhatsApp atau email" });
    const price = t === "paid" && h("input", { class: "input", id: "kl-price", inputmode: "numeric", value: k.price ?? "", placeholder: "Contoh: 1500000" });
    const deliver = h("input", { class: "input", id: "kl-del", value: k.deliverable || "", placeholder: t === "paid" ? "Contoh: 1 Reels + 3 Story" : "Contoh: Dine-in untuk 2 orang + 1 Reels" });
    const status = h("select", { class: "select", id: "kl-status" }, opts(STATUS[t], k.status));
    const notes = h("textarea", { class: "textarea", id: "kl-notes", rows: 3, placeholder: "Catatan negosiasi, syarat khusus, dll." });
    notes.value = k.notes || "";

    editDialog({
      title: existing ? `Ubah KOL ${TYPE_LABEL[t]}` : `KOL ${TYPE_LABEL[t]} baru`, existing, label: `KOL "${k.name}"`,
      body: h("div", {},
        field("Nama KOL (akun medsos)", name, null, "kl-name"),
        h("div", { class: "row" }, field("Platform utama", platform, null, "kl-plat"), field("Followers", followers, null, "kl-fol")),
        h("div", { class: "row" }, field("ER (%)", er, "Engagement rate akun, dalam persen.", "kl-er"), field("Rank", rank, "Terisi otomatis dari followers, bisa diubah.", "kl-rank")),
        t === "paid" && field("Pricelist (Rp)", price, "Harga sesuai paket di bawah.", "kl-price"),
        field(t === "paid" ? "Paket konten" : "Penawaran barter", deliver, null, "kl-del"),
        field("Nama campaign", camp, "Dipakai untuk mengelompokkan KOL, misalnya per opening atau periode promo.", "kl-camp"), camps,
        h("div", { class: "row" }, field(t === "paid" ? "Status" : "Status persetujuan", status, null, "kl-status"), field("Kontak", contact, null, "kl-contact")),
        field("Catatan", notes, null, "kl-notes")),
      onSave: async () => {
        if (!name.value.trim()) throw new Error("Nama KOL wajib diisi.");
        await save("kol_campaigns", {
          ...k, name: name.value.trim(), platform: platform.value, followers: int(followers.value), er: dec(er.value), rank: rank.value,
          price: price ? int(price.value) : null, deliverable: deliver.value.trim(), campaign: camp.value.trim(), contact: contact.value.trim(),
          status: status.value, notes: notes.value.trim(),
        });
      },
      onDelete: () => remove("kol_campaigns", k.id),
    });
  }

  /* ---------------- pesan approach ---------------- */
  const fillTpl = (body, k, extra = {}) => {
    const v = {
      nama: (k.name || "").replace(/^@/, ""), akun: k.name || "", brand: brand.name, penawaran: k.deliverable || "[penawaran]",
      harga: k.price ? fmtRp(k.price) : "[harga]", tanggal: extra.tanggal || "[tanggal]", jam: extra.jam || "[jam]",
    };
    return String(body || "").replace(/\{(\w+)\}/g, (m, key) => (key in v ? v[key] : m));
  };
  function openApproach(k) {
    const pool = tpls.filter((x) => x.for === "umum" || x.for === k.type || !x.for);
    if (!pool.length) { toast("Belum ada template. Buat dulu di tab Template Approach.", "err"); return; }
    const next = visits.filter((v) => v.campaignId === k.id && !v.hadir).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
    const extra = next ? { tanggal: fmtDay(next.date), jam: next.time } : {};
    const sel = h("select", { class: "select", id: "ap-tpl" }, pool.map((x) => h("option", { value: x.id }, `${x.title} (${x.channel || "-"})`)));
    const text = h("textarea", { class: "textarea", id: "ap-text", rows: 8 });
    const render = () => { const x = pool.find((p) => p.id === sel.value); text.value = fillTpl(x?.body, k, extra); };
    sel.addEventListener("change", render); render();
    dialog({
      title: `Pesan untuk ${k.name}`,
      body: h("div", {}, field("Template", sel, null, "ap-tpl"), field("Isi pesan", text, "Bisa diedit sebelum disalin. Bagian [dalam kurung siku] belum terisi dari data KOL.", "ap-text")),
      actions: [{ label: "Tutup" }, { label: "Salin pesan", kind: "primary", onClick: async () => { toast((await copyText(text.value)) ? "Pesan disalin." : "Gagal menyalin. Blok teksnya lalu salin manual.", "ok"); return false; } }],
    });
  }

  /* ---------------- Tab 1: Database campaign ---------------- */
  function drawCampaign() {
    const F = S.f;
    const live = kols.filter((k) => !["Selesai", "Batal", "Ditolak"].includes(k.status));
    const stat = (label, value, sub) => h("div", { class: "kstat" }, h("div", { class: "kv" }, value), h("div", { class: "kl" }, label), sub && h("div", { class: "ks" }, sub));
    const stats = h("div", { class: "kstats" },
      stat("KOL berjalan", live.length, `${kols.length} total`),
      stat("Paid", kols.filter((k) => k.type === "paid" && !["Batal"].includes(k.status)).length, fmtRp(kols.filter((k) => k.type === "paid" && ["Deal", "Sudah datang", "Sudah posting", "Selesai"].includes(k.status)).reduce((s, k) => s + (k.price || 0), 0)) + " disepakati"),
      stat("Barter", kols.filter((k) => k.type === "barter" && k.status !== "Batal").length, `${kols.filter((k) => k.status === "Menunggu persetujuan").length} menunggu persetujuan`),
      stat("Sudah posting", kols.filter((k) => ["Sudah posting", "Selesai"].includes(k.status)).length, `${kols.filter((k) => ["Deal", "Disetujui", "Sudah datang"].includes(k.status)).length} belum posting`));

    const allStatus = [...new Set([...STATUS.paid, ...STATUS.barter])];
    const sel = (key, label, list) => h("select", { class: "select", "aria-label": label, onchange: (e) => { F[key] = e.target.value; drawTable(); } },
      h("option", { value: "" }, label), list.map((o) => (Array.isArray(o) ? h("option", { value: o[0], selected: F[key] === o[0] }, o[1]) : h("option", { value: o, selected: F[key] === o }, o))));
    const q = h("input", { class: "input", type: "search", placeholder: "Cari nama KOL", value: F.q, "aria-label": "Cari KOL", oninput: (e) => { F.q = e.target.value; drawTable(); } });
    const box = h("div");

    function drawTable() {
      const needle = F.q.trim().toLowerCase();
      const rows = kols
        .filter((k) => (!F.type || k.type === F.type) && (!F.status || k.status === F.status) && (!F.campaign || k.campaign === F.campaign) && (!needle || (k.name || "").toLowerCase().includes(needle)))
        .sort((a, b) => (a.campaign || "~").localeCompare(b.campaign || "~") || (a.name || "").localeCompare(b.name || ""));
      if (!kols.length) {
        box.replaceChildren(h("div", { class: "empty" }, h("h3", {}, "Belum ada KOL"), h("p", {}, `Mulai catat KOL untuk ${brand.name}, baik yang paid maupun barter.`),
          h("div", { class: "row", style: "justify-content:center;margin-top:12px" },
            h("button", { class: "btn primary", type: "button", onclick: () => openKol("paid") }, icon("plus", 16), "KOL Paid"),
            h("button", { class: "btn", type: "button", onclick: () => openKol("barter") }, icon("plus", 16), "KOL Barter"))));
        return;
      }
      if (!rows.length) { box.replaceChildren(h("div", { class: "empty" }, h("h3", {}, "Tidak ada KOL yang cocok"), h("p", {}, "Ubah atau kosongkan filter di atas."))); return; }
      const statusSel = (k) => h("select", { class: "select inline", "aria-label": `Status ${k.name}`, onchange: (e) => saveKol({ ...k, status: e.target.value }) }, opts(STATUS[k.type] || STATUS.paid, k.status));
      const tr = (k) => h("tr", {},
        h("td", {}, h("button", { class: "linklike", type: "button", onclick: () => openKol(k.type, k) }, k.name || "(tanpa nama)"),
          h("div", { class: "chips", style: "margin-top:6px" }, chip(TYPE_LABEL[k.type] || k.type, k.type === "paid" ? "brand" : ""), chip(k.platform || "-"), k.rank && chip(k.rank), k.campaign && chip(k.campaign))),
        h("td", { style: "white-space:nowrap" }, h("div", {}, fmtNum(k.followers)), h("div", { class: "muted", style: "font-size:12.5px" }, `ER ${k.er != null ? fmtPct(k.er) : "—"}`)),
        h("td", { style: "min-width:200px" }, k.type === "paid" ? h("b", {}, fmtRp(k.price)) : h("b", {}, "Barter"), h("div", { class: "muted", style: "font-size:13px" }, k.deliverable || "—")),
        h("td", {}, statusSel(k), h("div", { style: "margin-top:6px" }, chip(k.status, statusKind(k.status)))),
        h("td", { class: "act" },
          h("button", { class: "btn sm ghost", type: "button", title: "Buat pesan approach", "aria-label": `Pesan approach ${k.name}`, onclick: () => openApproach(k) }, icon("copy", 16)),
          h("button", { class: "btn sm ghost", type: "button", "aria-label": `Ubah ${k.name}`, onclick: () => openKol(k.type, k) }, icon("edit", 16))));
      box.replaceChildren(h("div", { class: "tablewrap plain" }, h("table", {},
        h("thead", {}, h("tr", {}, ["KOL", "Followers & ER", "Pricelist / penawaran", "Status", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, rows.map(tr)))),
      h("p", { class: "muted", style: "margin-top:8px;font-size:13px" }, `${rows.length} dari ${kols.length} KOL`));
    }

    panels.campaign.replaceChildren(stats,
      h("div", { class: "toolbar" }, h("div", { class: "search" }, icon("search", 16), q),
        sel("type", "Semua tipe", [["paid", "Paid"], ["barter", "Barter"]]), sel("status", "Semua status", allStatus), sel("campaign", "Semua campaign", campaignNames())),
      box);
    drawTable();
  }

  /* ---------------- Tab 2: Absensi kunjungan ---------------- */
  const photoInput = h("input", { type: "file", accept: "image/*", style: "display:none" });
  let pendingVisit = null;
  photoInput.addEventListener("change", () => guard(async () => {
    const file = photoInput.files[0]; const v = visits.find((x) => x.id === pendingVisit);
    if (!file || !v) return;
    const foto = await readPhoto(file);
    const jamDatang = nowTime();
    await store.saveSub(brand.id, "kol_visits", { ...v, hadir: true, hadirAt: new Date().toISOString(), jamDatang, foto });
    const k = v.campaignId && kolById(v.campaignId);
    if (k && PRE_VISIT.includes(k.status)) await store.saveSub(brand.id, "kol_campaigns", { ...k, status: "Sudah datang" });
    pendingVisit = null; photoInput.value = "";
    await reload(); redraw(); toast(`Tercatat: ${v.name} datang ${jamDatang} WIB`);
  }));

  function openVisit(existing, defaults = {}) {
    const v = existing || { id: newId("v"), hadir: false, date: S.date, ...defaults };
    const eligible = kols.filter((k) => !["Batal", "Ditolak"].includes(k.status));
    const pick = h("select", { class: "select", id: "vs-kol" }, h("option", { value: "" }, "Tulis nama sendiri"),
      eligible.map((k) => h("option", { value: k.id, selected: k.id === v.campaignId }, `${k.name} (${TYPE_LABEL[k.type]} · ${k.status})`)));
    const name = h("input", { class: "input", id: "vs-name", value: v.name || "", placeholder: "@namaakun", autocapitalize: "none" });
    pick.addEventListener("change", () => { const k = kolById(pick.value); if (k) name.value = k.name; });
    const date = h("input", { class: "input", id: "vs-date", type: "date", value: v.date || "" });
    const time = h("input", { class: "input", id: "vs-time", type: "time", value: v.time || "" });
    editDialog({
      title: existing ? "Ubah jadwal kunjungan" : "Jadwal kunjungan KOL", existing, label: `jadwal ${v.name}`,
      body: h("div", {}, field("Pilih dari daftar KOL", pick, "Atau biarkan kosong dan tulis nama di bawah.", "vs-kol"), field("Nama akun", name, null, "vs-name"),
        h("div", { class: "row" }, field("Tanggal kedatangan", date, null, "vs-date"), field("Jam kedatangan", time, null, "vs-time"))),
      onSave: async () => {
        if (!name.value.trim() || !date.value || !time.value) throw new Error("Nama akun, tanggal, dan jam wajib diisi.");
        S.date = date.value;
        await save("kol_visits", { ...v, campaignId: pick.value || null, name: name.value.trim(), date: date.value, time: time.value });
      },
      onDelete: () => remove("kol_visits", v.id),
    });
  }

  const showPhoto = (src, title) => dialog({ title, body: h("img", { src, alt: title, style: "max-width:100%;border-radius:10px;display:block;margin:0 auto" }), actions: [{ label: "Tutup" }] });

  function drawVisit() {
    const day = S.date;
    const list = visits.filter((v) => v.date === day).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    const done = list.filter((v) => v.hadir).length;
    const late = (v) => v.hadir && v.jamDatang && mins(v.jamDatang) - mins(v.time) > TOLERANSI;
    const nLate = list.filter(late).length;
    const upcoming = [...new Set(visits.filter((v) => v.date >= today()).map((v) => v.date))].sort().slice(0, 8);

    const dateInp = h("input", { class: "input date-inp", type: "date", value: day, "aria-label": "Tanggal", onchange: (e) => { if (e.target.value) { S.date = e.target.value; drawVisit(); } } });
    const bar = h("div", { class: "toolbar" }, dateInp,
      h("button", { class: "btn", type: "button", onclick: () => { S.date = today(); drawVisit(); } }, "Hari ini"),
      h("span", { class: "spacer", style: "flex:1" }),
      h("button", { class: "btn primary", type: "button", onclick: () => openVisit(null) }, icon("plus", 16), "Jadwalkan kunjungan"));
    const strip = upcoming.length > 0 && h("div", { class: "chips", style: "margin-bottom:14px" }, h("span", { class: "muted", style: "font-size:13px;align-self:center" }, "Jadwal terdekat:"),
      upcoming.map((d) => h("button", { class: "chip-btn" + (d === day ? " on" : ""), type: "button", onclick: () => { S.date = d; drawVisit(); } }, `${fmtShort(d)} · ${visits.filter((v) => v.date === d).length}`)));

    const rows = list.map((v) => {
      const diff = v.hadir ? mins(v.jamDatang) - mins(v.time) : 0;
      const sub = v.hadir
        ? h("div", { class: "ck-sub" }, `Rencana ${v.time} WIB · Datang ${v.jamDatang} WIB`, h("br"), diff > TOLERANSI ? h("span", { class: "late" }, `Terlambat ${diff} menit`) : h("span", { class: "ontime" }, "Tepat waktu"))
        : h("div", { class: "ck-sub" }, `Rencana ${v.time} WIB`, h("br"), h("span", { class: "hint-accent" + (day === today() && mins(nowTime()) - mins(v.time) > TOLERANSI ? " over" : "") }, (day === today() && mins(nowTime()) - mins(v.time) > TOLERANSI ? "Sudah lewat jadwal · " : "") + "Tap kotak untuk centang dan foto akun"));
      return h("div", { class: "ck-row" + (v.hadir ? " done" : "") },
        h("button", { class: "ck-box" + (v.hadir ? " checked" : ""), type: "button", "aria-label": v.hadir ? `${v.name} sudah datang` : `Centang ${v.name}`, disabled: v.hadir, onclick: () => { pendingVisit = v.id; photoInput.value = ""; photoInput.click(); } }, icon("check", 22)),
        h("div", { class: "ck-body" }, h("div", { class: "ck-name" }, v.name), sub,
          h("div", { class: "ck-acts" },
            v.hadir && h("button", { class: "ck-undo", type: "button", onclick: () => guard(async () => {
              if (!(await confirmDialog(`Batalkan centang ${v.name}? Foto akun juga akan dihapus.`, "Ya, batalkan"))) return;
              await store.saveSub(brand.id, "kol_visits", { ...v, hadir: false, hadirAt: null, jamDatang: null, foto: null });
              const k = v.campaignId && kolById(v.campaignId);
              if (k && k.status === "Sudah datang") await store.saveSub(brand.id, "kol_campaigns", { ...k, status: k.type === "paid" ? "Deal" : "Disetujui" });
              await reload(); redraw();
            }) }, "Batalkan centang"),
            h("button", { class: "ck-undo", type: "button", onclick: () => openVisit(v) }, "Ubah jadwal"))),
        v.hadir && v.foto && h("img", { class: "ck-thumb", src: v.foto, alt: `Foto akun ${v.name}`, onclick: () => showPhoto(v.foto, v.name) }));
    });

    panels.visit.replaceChildren(bar, strip || "", photoInput,
      h("div", { class: "date-title" }, fmtDay(day) + (day === today() ? " (hari ini)" : "")),
      h("div", { class: "summary" }, list.length ? h("span", {}, h("b", {}, done), ` dari ${list.length} KOL sudah datang`, nLate ? ` · ${nLate} terlambat` : "") : ""),
      ...(list.length ? rows : [h("div", { class: "empty" }, h("h3", {}, "Belum ada jadwal di tanggal ini"), h("p", {}, "Jadwalkan kunjungan KOL yang sudah deal atau disetujui, lalu centang saat mereka tiba."))]));
  }

  /* ---------------- Tab 3: Template approach ---------------- */
  function openTpl(existing) {
    const t = existing || { id: newId("t"), for: "umum", channel: "WhatsApp" };
    const title = h("input", { class: "input", id: "tp-title", value: t.title || "", placeholder: "Contoh: Approach KOL paid" });
    const forSel = h("select", { class: "select", id: "tp-for" }, opts(TPL_FOR, t.for));
    const ch = h("select", { class: "select", id: "tp-ch" }, opts(TPL_CHANNEL, t.channel));
    const body = h("textarea", { class: "textarea", id: "tp-body", rows: 9, placeholder: "Halo kak {nama}, ..." });
    body.value = t.body || "";
    editDialog({
      title: existing ? "Ubah template" : "Template baru", existing, label: `template "${t.title}"`,
      body: h("div", {}, field("Judul template", title, null, "tp-title"), h("div", { class: "row" }, field("Dipakai untuk", forSel, null, "tp-for"), field("Kanal", ch, null, "tp-ch")),
        field("Isi pesan", body, `Isian otomatis: ${PLACEHOLDERS}`, "tp-body")),
      onSave: async () => {
        if (!title.value.trim() || !body.value.trim()) throw new Error("Judul dan isi pesan wajib diisi.");
        await save("kol_templates", { ...t, title: title.value.trim(), for: forSel.value, channel: ch.value, body: body.value });
      },
      onDelete: () => remove("kol_templates", t.id),
    });
  }

  function drawTpl() {
    const head = h("div", { class: "sec-head" },
      h("div", { class: "grow" }, h("h3", {}, "Template approach"), h("p", { class: "muted" }, `Pesan siap pakai untuk menghubungi KOL. Isian otomatis: ${PLACEHOLDERS}`)),
      h("button", { class: "btn primary sm", type: "button", onclick: () => openTpl(null) }, icon("plus", 15), "Template baru"));
    const body = !tpls.length
      ? h("div", { class: "empty" }, h("h3", {}, "Belum ada template"), h("p", {}, "Mulai dari contoh bawaan (approach paid, approach barter, konfirmasi jadwal, minta link posting) lalu sesuaikan dengan gaya brand."),
        h("button", { class: "btn primary", type: "button", onclick: () => guard(async () => { await Promise.all(DEFAULT_TPLS.map((t) => store.saveSub(brand.id, "kol_templates", { ...t, id: newId("t") }))); await reload(); redraw(); toast("Template bawaan ditambahkan."); }) }, "Muat template bawaan"))
      : h("div", { class: "grid two" }, tpls.slice().sort((a, b) => (a.title || "").localeCompare(b.title || "")).map((t) =>
        h("div", { class: "card tplcard" },
          h("div", { class: "chips", style: "margin-bottom:8px" }, chip(t.channel || "-"), chip((TPL_FOR.find((x) => x[0] === t.for) || [0, "Semua jenis"])[1], t.for === "paid" ? "brand" : "")),
          h("h3", { style: "font-size:16px;margin-bottom:8px" }, t.title),
          h("div", { class: "tplbody" }, t.body),
          h("div", { class: "row", style: "margin-top:12px;gap:8px" },
            h("button", { class: "btn sm", type: "button", onclick: async () => toast((await copyText(fillTpl(t.body, { name: "@namakol", type: t.for }))) ? "Template disalin." : "Gagal menyalin.") }, icon("copy", 14), "Salin"),
            h("button", { class: "btn sm ghost", type: "button", onclick: () => openTpl(t) }, icon("edit", 14), "Ubah")))));
    panels.tpl.replaceChildren(head, body);
  }

  /* ---------------- Tab 4: Reporting ---------------- */
  function openMetrics(k) {
    const link = h("input", { class: "input", id: "mt-link", type: "url", value: k.postLink || "", placeholder: "https://..." });
    const date = h("input", { class: "input", id: "mt-date", type: "date", value: k.postedAt || "" });
    const m = (id, key, label) => ({ el: h("input", { class: "input", id, inputmode: "numeric", value: k[key] ?? "", placeholder: "0" }), key, label, id });
    const ms = [m("mt-views", "views", "Views / reach"), m("mt-likes", "likes", "Likes"), m("mt-comments", "comments", "Komentar"), m("mt-shares", "shares", "Share"), m("mt-saves", "saves", "Save")];
    editDialog({
      title: `Hasil posting ${k.name}`, existing: null, saveLabel: "Simpan",
      body: h("div", {}, field("Link postingan", link, "Tempel link konten KOL setelah tayang.", "mt-link"), field("Tanggal tayang", date, null, "mt-date"),
        h("div", { class: "row" }, ms.slice(0, 2).map((x) => field(x.label, x.el, null, x.id))),
        h("div", { class: "row" }, ms.slice(2).map((x) => field(x.label, x.el, null, x.id))),
        h("p", { class: "muted", style: "font-size:13px" }, "ER dihitung otomatis: (likes + komentar + share + save) dibagi views. Biaya per view dihitung dari pricelist untuk KOL paid.")),
      onSave: async () => {
        if (link.value.trim() && !safeUrl(link.value)) throw new Error("Link belum benar. Awali dengan https://");
        const patch = { postLink: link.value.trim(), postedAt: date.value };
        for (const x of ms) patch[x.key] = int(x.el.value);
        const advance = (patch.postLink || patch.views != null) && PRE_POST.includes(k.status);
        await save("kol_campaigns", { ...k, ...patch, status: advance ? "Sudah posting" : k.status });
      },
    });
  }

  function drawReport() {
    let rows = kols.filter(hasReport).filter((k) => !S.rcamp || k.campaign === S.rcamp);
    const sorters = { terbaru: (a, b) => (b.postedAt || "").localeCompare(a.postedAt || ""), views: (a, b) => (b.views || 0) - (a.views || 0), er: (a, b) => (erActual(b) ?? -1) - (erActual(a) ?? -1) };
    rows = rows.slice().sort(sorters[S.rsort]);
    const withViews = rows.filter((k) => k.views);
    const totalViews = rows.reduce((s, k) => s + (k.views || 0), 0);
    const viewsForEr = withViews.reduce((s, k) => s + k.views, 0);
    const totalInter = withViews.reduce((s, k) => s + interactions(k), 0);
    const paid = rows.filter((k) => k.type === "paid");
    const spend = paid.reduce((s, k) => s + (k.price || 0), 0);
    const paidViews = paid.reduce((s, k) => s + (k.views || 0), 0);
    const stat = (label, value, sub) => h("div", { class: "kstat" }, h("div", { class: "kv" }, value), h("div", { class: "kl" }, label), sub && h("div", { class: "ks" }, sub));
    const stats = h("div", { class: "kstats" },
      stat("KOL tayang", rows.length, `${rows.filter((k) => k.views == null).length} belum diisi hasilnya`),
      stat("Total views", fmtNum(totalViews || null)), stat("ER rata-rata", fmtPct(viewsForEr ? (totalInter / viewsForEr) * 100 : null), "total interaksi dibagi total views"),
      stat("Biaya paid", fmtRp(spend || null), paidViews && spend ? `${fmtRp(Math.round(spend / paidViews))} per view` : "barter tidak dihitung"));

    const csv = () => {
      const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      const head = ["KOL", "Tipe", "Campaign", "Platform", "Tanggal tayang", "Link", "Views", "Likes", "Komentar", "Share", "Save", "ER (%)", "Biaya (Rp)", "Biaya per view (Rp)"];
      const lines = [head.map(q).join(",")];
      rows.forEach((k) => lines.push([k.name, TYPE_LABEL[k.type], k.campaign, k.platform, k.postedAt, k.postLink, k.views, k.likes, k.comments, k.shares, k.saves, erActual(k)?.toFixed(2), k.type === "paid" ? k.price : "", k.type === "paid" && k.views && k.price ? (k.price / k.views).toFixed(0) : ""].map(q).join(",")));
      const a = h("a", { href: URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" })), download: `reporting-kol-${brand.id}.csv` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 500);
    };

    const toolbar = h("div", { class: "toolbar" },
      h("select", { class: "select", "aria-label": "Campaign", onchange: (e) => { S.rcamp = e.target.value; drawReport(); } }, h("option", { value: "" }, "Semua campaign"), campaignNames().map((c) => h("option", { value: c, selected: S.rcamp === c }, c))),
      h("select", { class: "select", "aria-label": "Urutkan", onchange: (e) => { S.rsort = e.target.value; drawReport(); } }, opts([["terbaru", "Terbaru"], ["views", "Views tertinggi"], ["er", "ER tertinggi"]], S.rsort)),
      h("span", { style: "flex:1" }), h("button", { class: "btn", type: "button", disabled: !rows.length, onclick: csv }, "Unduh CSV"));

    const tr = (k) => {
      const pl = safeUrl(k.postLink);
      const er = erActual(k);
      return h("tr", {},
        h("td", {}, h("b", {}, k.name), h("div", { class: "chips", style: "margin-top:6px" }, chip(TYPE_LABEL[k.type], k.type === "paid" ? "brand" : ""), k.campaign && chip(k.campaign))),
        h("td", { class: "refcell" }, pl ? h("a", { href: pl, target: "_blank", rel: "noopener noreferrer", title: pl }, h("span", {}, hostOf(pl)), icon("arrow", 13)) : h("span", { class: "muted" }, "—"), k.postedAt && h("div", { class: "muted", style: "font-size:12.5px" }, fmtShort(k.postedAt))),
        h("td", { class: "num" }, fmtNum(k.views)), h("td", { class: "num" }, fmtNum(k.likes)), h("td", { class: "num" }, fmtNum(k.comments)), h("td", { class: "num" }, fmtNum(k.shares)), h("td", { class: "num" }, fmtNum(k.saves)),
        h("td", { class: "num" }, er != null ? h("b", {}, fmtPct(er)) : "—"),
        h("td", { class: "num" }, k.type === "paid" ? fmtRp(k.price) : "Barter", k.type === "paid" && k.views && k.price ? h("div", { class: "muted", style: "font-size:12.5px" }, `${fmtRp(Math.round(k.price / k.views))}/view`) : null),
        h("td", { class: "act" }, h("button", { class: "btn sm" + (k.views == null ? " primary" : " ghost"), type: "button", onclick: () => openMetrics(k) }, k.views == null ? "Isi hasil" : icon("edit", 16))));
    };

    const pending = kols.filter((k) => ["Deal", "Disetujui", "Sudah datang"].includes(k.status));
    panels.report.replaceChildren(stats, toolbar,
      rows.length
        ? h("div", { class: "tablewrap plain" }, h("table", {}, h("thead", {}, h("tr", {}, ["KOL", "Postingan", "Views", "Likes", "Komentar", "Share", "Save", "ER", "Biaya", ""].map((t, i) => h("th", { class: i >= 2 && i <= 8 ? "num" : "" }, t)))), h("tbody", {}, rows.map(tr))))
        : h("div", { class: "empty" }, h("h3", {}, "Belum ada postingan KOL"), h("p", {}, "KOL yang berstatus Sudah posting atau punya link postingan akan muncul di sini. Isi hasilnya setelah konten tayang beberapa hari.")),
      pending.length > 0 && h("p", { class: "muted", style: "margin-top:12px;font-size:13px" }, `${pending.length} KOL sudah deal atau datang tapi belum posting: `, pending.slice(0, 6).map((k, i) => [i ? ", " : "", h("button", { class: "linklike small", type: "button", onclick: () => openMetrics(k) }, k.name)]), pending.length > 6 ? ` dan ${pending.length - 6} lainnya` : ""));
  }

  /* ---------------- rangka halaman ---------------- */
  const TAB_DEFS = [["campaign", "Database Campaign"], ["visit", "Absensi Kunjungan"], ["tpl", "Template Approach"], ["report", "Reporting"]];
  function drawTabs() {
    tabsEl.replaceChildren(...TAB_DEFS.map(([k, label]) => h("button", { type: "button", role: "tab", "aria-selected": String(S.tab === k), onclick: () => { S.tab = k; drawTabs(); } }, label)));
    for (const [k, el] of Object.entries(panels)) el.hidden = k !== S.tab;
  }

  redraw();
  drawTabs();

  return {
    crumbs,
    node: h("div", {},
      h("div", { class: "page-head" },
        h("div", { class: "grow" }, h("h1", {}, "Media & KOL"),
          h("p", { class: "lead" }, `Campaign KOL ${brand.name}: database paid dan barter, absensi kunjungan, template approach, dan reporting performa.`)),
        h("div", { class: "actions" },
          h("button", { class: "btn primary", type: "button", onclick: () => { S.tab = "campaign"; drawTabs(); openKol("paid"); } }, icon("plus", 16), "KOL Paid"),
          h("button", { class: "btn", type: "button", onclick: () => { S.tab = "campaign"; drawTabs(); openKol("barter"); } }, icon("plus", 16), "KOL Barter"))),
      tabsEl, panels.campaign, panels.visit, panels.tpl, panels.report),
  };
}
