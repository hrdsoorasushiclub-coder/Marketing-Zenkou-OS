import { h, icon, toast, dialog, confirmDialog } from "../ui.js";
import { safeUrl, coverSrc } from "./content.js";

/* Penyimpanan (per brand): setup/guideline (satu dokumen), brand_assets, templates, opening_kit.
   Gambar tidak diunggah ke Firebase; yang disimpan adalah link (Google Drive, Canva, dll). */

const ASSET_CATS = ["Logo", "Foto", "Desain", "Video", "Font", "Dokumen", "Lainnya"];
const TEMPLATE_KINDS = ["Canva", "Figma", "Google Docs", "Google Sheets", "Google Slides", "Lainnya"];
const KIT_STATUS = ["Belum mulai", "Dikerjakan", "Menunggu approval", "Selesai"];
const KIT_GROUPS = ["Bridging & content plan", "Hiring", "Properti meja & kasir", "Form out", "T-banner & signage", "Pendukung (Spotify, Google Maps, sign)", "Persetujuan & pengecekan"];
// Diambil dari checklist kesiapan opening di SOP, supaya tim tidak mulai dari kosong.
const KIT_DEFAULTS = [
  ["Bridging & content plan", "Content plan dan moodboard"],
  ["Bridging & content plan", "Materi pre-opening dan opening announcement"],
  ["Hiring", "Kebutuhan hiring sesuai kebutuhan outlet"],
  ["Properti meja & kasir", "QR menu, nomor meja, tent card, dan standing menu"],
  ["Form out", "Form feedback dan waiting list"],
  ["T-banner & signage", "T-banner, signage, dan informasi operasional"],
  ["Pendukung (Spotify, Google Maps, sign)", "Google Maps terverifikasi"],
  ["Pendukung (Spotify, Google Maps, sign)", "Spotify dan penanda area (sign)"],
  ["Persetujuan & pengecekan", "Seluruh materi sudah mendapat approval"],
  ["Persetujuan & pengecekan", "Pengecekan semua kebutuhan di lokasi sebelum opening"],
];

const newId = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fmtShort = (s) => { if (!s) return ""; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("id-ID", { day: "numeric", month: "short" }); };
const normHex = (v) => { const m = String(v || "").trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i); if (!m) return ""; const x = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]; return "#" + x.toLowerCase(); };
const cssUrl = (s) => `url("${s.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;
const looksImage = (u) => /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(u) || /drive\.google\.com/.test(u);
const chip = (t, kind = "") => h("span", { class: "chip" + (kind ? " " + kind : "") }, t);
const field = (label, node, hint, id) => h("div", { class: "field" }, h("label", { for: id }, label), node, hint && h("span", { class: "hint" }, hint));
const opts = (list, cur) => list.map((t) => h("option", { value: t, selected: t === cur }, t));
const linkBtn = (url, label) => { const u = safeUrl(url); return u ? h("a", { class: "btn sm", href: u, target: "_blank", rel: "noopener noreferrer" }, label, icon("arrow", 14)) : null; };

export async function render(ctx) {
  const { store, brand } = ctx;
  const crumbs = [{ label: "Operation", href: "#/ops" }, { label: brand.name }, { label: "Brand Set Up" }];
  if (!brand.id || brand.id === "-") {
    return { crumbs, node: h("div", { class: "empty" }, h("h3", {}, "Belum ada brand"), h("p", {}, "Tambahkan brand lebih dulu di Pengaturan > Brand.")) };
  }

  let guide, assets, templates, kit;
  const reload = async () => {
    const [g, a, t, k] = await Promise.all(["setup", "brand_assets", "templates", "opening_kit"].map((n) => store.listSub(brand.id, n)));
    guide = { id: "guideline", logos: [], palette: [], typography: {}, character: {}, driveUrl: "", ...(g.find((x) => x.id === "guideline") || {}) };
    assets = a; templates = t; kit = k;
  };
  await reload();

  const S = { tab: "guideline" };
  const panels = { guideline: h("div"), assets: h("div"), templates: h("div"), kit: h("div") };
  const tabsEl = h("div", { class: "tabs", role: "tablist" });
  const redraw = () => { drawGuide(); drawAssets(); drawTemplates(); drawKit(); };
  const guard = async (fn) => { try { await fn(); } catch (e) { toast(e.message || String(e), "err"); } };
  const saveGuide = async (patch) => { await store.saveSub(brand.id, "setup", { ...guide, ...patch }); await reload(); redraw(); };
  const saveList = async (name, item) => { await store.saveSub(brand.id, name, item); await reload(); redraw(); };
  const delList = async (name, id) => { await store.deleteSub(brand.id, name, id); await reload(); redraw(); };
  const section = (title, hint, actionNode, ...body) => h("section", { class: "card setup-sec" },
    h("div", { class: "sec-head" }, h("div", { class: "grow" }, h("h3", {}, title), hint && h("p", { class: "muted" }, hint)), actionNode), ...body);
  const addBtn = (label, onclick) => h("button", { class: "btn sm", type: "button", onclick }, icon("plus", 15), label);
  const emptyNote = (text) => h("div", { class: "empty slim" }, h("p", {}, text));

  // dialog generik dengan tombol Hapus bila data sudah ada
  const editDialog = ({ title, body, existing, label, onSave, onDelete }) => {
    const actions = [{ label: "Batal" }];
    if (existing && onDelete) {
      actions.unshift({ label: "Hapus", kind: "danger", onClick: async () => {
        if (!(await confirmDialog(`Hapus ${label}? Ini tidak bisa dibatalkan.`, "Ya, hapus"))) return false;
        await onDelete(); toast("Dihapus.");
      } });
    }
    actions.push({ label: existing ? "Simpan" : "Tambahkan", kind: "primary", onClick: async () => { await onSave(); toast("Tersimpan."); } });
    dialog({ title, body, actions });
  };

  /* ---------------- Tab 1: Brand Guideline ---------------- */
  function logoDialog(existing) {
    const l = existing || { id: newId("l") };
    const name = h("input", { class: "input", id: "lg-name", value: l.name || "", placeholder: "Contoh: Logo utama, Logo horizontal, Ikon, Versi putih" });
    const url = h("input", { class: "input", id: "lg-url", type: "url", value: l.url || "", placeholder: "https://..." });
    const note = h("input", { class: "input", id: "lg-note", value: l.note || "", placeholder: "Kapan versi ini dipakai" });
    editDialog({
      title: existing ? "Ubah versi logo" : "Versi logo baru", existing, label: `"${l.name}"`,
      body: h("div", {}, field("Nama versi", name, null, "lg-name"), field("Link gambar", url, "Link Google Drive (dibagikan publik) atau gambar langsung. Dipakai untuk pratinjau.", "lg-url"), field("Catatan pemakaian", note, null, "lg-note")),
      onSave: async () => {
        if (!name.value.trim()) throw new Error("Nama versi logo wajib diisi.");
        const item = { ...l, name: name.value.trim(), url: url.value.trim(), note: note.value.trim() };
        const list = guide.logos.some((x) => x.id === l.id) ? guide.logos.map((x) => (x.id === l.id ? item : x)) : [...guide.logos, item];
        await saveGuide({ logos: list });
      },
      onDelete: () => saveGuide({ logos: guide.logos.filter((x) => x.id !== l.id) }),
    });
  }

  function colorDialog(existing) {
    const c = existing || { id: newId("k"), hex: brand.color || "#2f7d5b" };
    const name = h("input", { class: "input", id: "cl-name", value: c.name || "", placeholder: "Contoh: Merah Soora" });
    const picker = h("input", { type: "color", class: "colorpick", "aria-label": "Pilih warna", value: normHex(c.hex) || "#2f7d5b" });
    const hex = h("input", { class: "input", id: "cl-hex", value: c.hex || "", placeholder: "#C8423B", style: "max-width:160px" });
    const role = h("input", { class: "input", id: "cl-role", value: c.role || "", placeholder: "Utama, sekunder, aksen, latar, teks" });
    picker.addEventListener("input", () => { hex.value = picker.value.toUpperCase(); });
    hex.addEventListener("input", () => { const n = normHex(hex.value); if (n) picker.value = n; });
    editDialog({
      title: existing ? "Ubah warna" : "Warna baru", existing, label: `warna "${c.name || c.hex}"`,
      body: h("div", {}, field("Nama warna", name, null, "cl-name"), h("div", { class: "field" }, h("label", { for: "cl-hex" }, "Kode warna (HEX)"), h("div", { class: "row", style: "align-items:center;flex-wrap:nowrap" }, picker, hex)), field("Peran", role, null, "cl-role")),
      onSave: async () => {
        const n = normHex(hex.value);
        if (!n) throw new Error("Kode warna belum benar. Contoh: #C8423B");
        const item = { ...c, name: name.value.trim() || n.toUpperCase(), hex: n, role: role.value.trim() };
        await saveGuide({ palette: guide.palette.some((x) => x.id === c.id) ? guide.palette.map((x) => (x.id === c.id ? item : x)) : [...guide.palette, item] });
      },
      onDelete: () => saveGuide({ palette: guide.palette.filter((x) => x.id !== c.id) }),
    });
  }

  function typoDialog() {
    const t = guide.typography || {};
    const heading = h("input", { class: "input", id: "ty-h", value: t.heading || "", placeholder: "Contoh: Plus Jakarta Sans Bold" });
    const body = h("input", { class: "input", id: "ty-b", value: t.body || "", placeholder: "Contoh: Plus Jakarta Sans Regular" });
    const notes = h("textarea", { class: "textarea", id: "ty-n", rows: 4, placeholder: "Ukuran, jarak baris, aturan huruf besar, font pengganti" });
    notes.value = t.notes || "";
    editDialog({
      title: "Tipografi", existing: false,
      body: h("div", {}, field("Font judul (headline)", heading, null, "ty-h"), field("Font isi (body)", body, null, "ty-b"), field("Catatan penggunaan", notes, null, "ty-n")),
      onSave: () => saveGuide({ typography: { heading: heading.value.trim(), body: body.value.trim(), notes: notes.value.trim() } }),
    });
  }

  function characterDialog() {
    const c = guide.character || {};
    const mk = (id, v, ph, rows = 3) => { const el = h("textarea", { class: "textarea", id, rows, placeholder: ph }); el.value = v || ""; return el; };
    const tag = h("input", { class: "input", id: "ch-tag", value: c.tagline || "", placeholder: "Pesan inti atau tagline brand" });
    const pers = mk("ch-p", c.personality, "Kalau brand ini seorang manusia, orang seperti apa dia?");
    const tone = mk("ch-t", c.tone, "Gaya bicara: santai atau formal, hangat atau tegas, kata yang sering dipakai");
    const dos = mk("ch-d", c.dos, "Satu hal per baris");
    const donts = mk("ch-x", c.donts, "Satu hal per baris");
    editDialog({
      title: "Brand character", existing: false,
      body: h("div", {}, field("Tagline / pesan inti", tag, null, "ch-tag"), field("Kepribadian brand", pers, null, "ch-p"), field("Tone of voice", tone, null, "ch-t"), field("Yang dilakukan (Do)", dos, null, "ch-d"), field("Yang dihindari (Don't)", donts, null, "ch-x")),
      onSave: () => saveGuide({ character: { tagline: tag.value.trim(), personality: pers.value.trim(), tone: tone.value.trim(), dos: dos.value.trim(), donts: donts.value.trim() } }),
    });
  }

  function drawGuide() {
    const logoCard = (l) => {
      const src = coverSrc(l.url);
      return h("button", { class: "logo-card", type: "button", onclick: () => logoDialog(l), title: "Klik untuk mengubah" },
        h("span", { class: "logo-view", style: src ? `background-image:${cssUrl(src)}` : null }, !src && icon("palette", 26)),
        h("b", {}, l.name), l.note && h("span", { class: "muted" }, l.note));
    };
    const swatch = (c) => h("button", { class: "swatch", type: "button", onclick: () => colorDialog(c), title: "Klik untuk mengubah" },
      h("span", { class: "sw-color", style: `background:${c.hex}` }), h("b", {}, c.name), h("span", { class: "mono" }, String(c.hex).toUpperCase()), c.role && h("span", { class: "muted" }, c.role));
    const copyAll = () => navigator.clipboard?.writeText(guide.palette.map((c) => `${c.name}: ${String(c.hex).toUpperCase()}`).join("\n")).then(() => toast("Daftar warna disalin."), () => toast("Tidak bisa menyalin.", "err"));
    const t = guide.typography || {};
    const ch = guide.character || {};
    const lines = (v) => String(v || "").split("\n").map((x) => x.trim()).filter(Boolean);

    panels.guideline.replaceChildren(
      h("div", { class: "stack" },
        section("Logo dan versinya", "Semua versi logo yang boleh dipakai tim.", addBtn("Tambah versi", () => logoDialog(null)),
          guide.logos.length ? h("div", { class: "sgrid" }, guide.logos.map(logoCard)) : emptyNote("Belum ada logo. Tambahkan versi utama dulu.")),
        section("Color palette", "Klik warna untuk mengubah.", h("div", { class: "row-tight" },
          guide.palette.length > 0 && h("button", { class: "btn sm ghost", type: "button", onclick: copyAll }, icon("copy", 15), "Salin kode"), addBtn("Tambah warna", () => colorDialog(null))),
        guide.palette.length ? h("div", { class: "sgrid sw" }, guide.palette.map(swatch)) : emptyNote("Belum ada warna. Tambahkan warna utama brand.")),
        section("Tipografi", null, h("button", { class: "btn sm", type: "button", onclick: typoDialog }, icon("edit", 15), "Ubah"),
          (t.heading || t.body || t.notes)
            ? h("dl", { class: "kv" }, h("dt", {}, "Font judul"), h("dd", {}, t.heading || "—"), h("dt", {}, "Font isi"), h("dd", {}, t.body || "—"), t.notes && h("dt", {}, "Catatan"), t.notes && h("dd", { style: "font-weight:500;white-space:pre-wrap" }, t.notes))
            : emptyNote("Belum diisi.")),
        section("Brand character", null, h("button", { class: "btn sm", type: "button", onclick: characterDialog }, icon("edit", 15), "Ubah"),
          (ch.tagline || ch.personality || ch.tone || ch.dos || ch.donts)
            ? h("div", { class: "char" },
              ch.tagline && h("p", { class: "tagline" }, ch.tagline),
              ch.personality && h("div", {}, h("h4", {}, "Kepribadian"), h("p", {}, ch.personality)),
              ch.tone && h("div", {}, h("h4", {}, "Tone of voice"), h("p", {}, ch.tone)),
              lines(ch.dos).length > 0 && h("div", {}, h("h4", {}, "Do"), h("ul", {}, lines(ch.dos).map((x) => h("li", {}, x)))),
              lines(ch.donts).length > 0 && h("div", {}, h("h4", {}, "Don't"), h("ul", {}, lines(ch.donts).map((x) => h("li", {}, x)))))
            : emptyNote("Belum diisi."))));
  }

  /* ---------------- Tab 2: Aset brand ---------------- */
  function assetDialog(existing) {
    const a = existing || { id: newId("a"), category: "Logo" };
    const name = h("input", { class: "input", id: "as-name", value: a.name || "", placeholder: "Contoh: Foto menu salmon 2026" });
    const cat = h("select", { class: "select", id: "as-cat" }, opts(ASSET_CATS, a.category));
    const url = h("input", { class: "input", id: "as-url", type: "url", value: a.url || "", placeholder: "https://..." });
    const note = h("input", { class: "input", id: "as-note", value: a.note || "", placeholder: "Opsional" });
    editDialog({
      title: existing ? "Ubah aset" : "Aset baru", existing, label: `aset "${a.name}"`,
      body: h("div", {}, field("Nama aset", name, null, "as-name"), field("Kategori", cat, null, "as-cat"), field("Link file", url, "Link Google Drive, Canva, atau lainnya.", "as-url"), field("Catatan", note, null, "as-note")),
      onSave: async () => {
        if (!name.value.trim()) throw new Error("Nama aset wajib diisi.");
        if (!safeUrl(url.value)) throw new Error("Link harus diawali http:// atau https://");
        await saveList("brand_assets", { ...a, name: name.value.trim(), category: cat.value, url: url.value.trim(), note: note.value.trim() });
      },
      onDelete: () => delList("brand_assets", a.id),
    });
  }

  function folderDialog() {
    const url = h("input", { class: "input", id: "fd-url", type: "url", value: guide.driveUrl || "", placeholder: "https://drive.google.com/drive/folders/..." });
    editDialog({
      title: "Folder utama aset brand", existing: false,
      body: field("Link folder", url, "Satu folder induk yang berisi semua aset brand ini. Kosongkan untuk menghapus.", "fd-url"),
      onSave: async () => {
        if (url.value.trim() && !safeUrl(url.value)) throw new Error("Link harus diawali http:// atau https://");
        await saveGuide({ driveUrl: url.value.trim() });
      },
    });
  }

  function drawAssets() {
    const card = (a) => {
      const u = safeUrl(a.url);
      const src = u && looksImage(u) ? coverSrc(u) : "";
      return h("div", { class: "asset-card" },
        h("button", { class: "asset-thumb", type: "button", "aria-label": `Ubah ${a.name}`, onclick: () => assetDialog(a), style: src ? `background-image:${cssUrl(src)}` : null }, !src && icon("db", 24)),
        h("div", { class: "asset-body" }, chip(a.category || "Lainnya"), h("b", {}, a.name), a.note && h("span", { class: "muted" }, a.note),
          h("div", { class: "row-tight", style: "margin-top:6px" }, linkBtn(a.url, "Buka"), h("button", { class: "btn sm ghost", type: "button", onclick: () => assetDialog(a) }, "Ubah"))));
    };
    const byCat = {};
    for (const a of assets) (byCat[a.category || "Lainnya"] ||= []).push(a);
    const cats = ASSET_CATS.filter((c) => byCat[c]).concat(Object.keys(byCat).filter((c) => !ASSET_CATS.includes(c)));
    panels.assets.replaceChildren(h("div", { class: "stack" },
      section("Folder utama", "Satu tempat induk untuk semua aset brand.", h("button", { class: "btn sm", type: "button", onclick: folderDialog }, icon("edit", 15), guide.driveUrl ? "Ubah" : "Atur"),
        guide.driveUrl ? h("div", { class: "row-tight" }, linkBtn(guide.driveUrl, "Buka folder aset"), h("span", { class: "muted", style: "overflow-wrap:anywhere;font-size:13px" }, guide.driveUrl)) : emptyNote("Belum ada folder utama.")),
      section("Daftar aset", "Logo, foto, desain, video, dan file penting lain yang dirujuk tim.", addBtn("Tambah aset", () => assetDialog(null)),
        assets.length ? cats.map((c) => h("div", { style: "margin-top:14px" }, h("h4", { class: "cat-h" }, `${c} (${byCat[c].length})`), h("div", { class: "sgrid assets" }, byCat[c].sort((x, y) => String(x.name).localeCompare(String(y.name))).map(card)))) : emptyNote("Belum ada aset. Tambahkan link file pertama."))));
  }

  /* ---------------- Tab 3: Template ---------------- */
  function templateDialog(existing) {
    const t = existing || { id: newId("t"), kind: "Canva" };
    const name = h("input", { class: "input", id: "tp-name", value: t.name || "", placeholder: "Contoh: Template feed promo, Template story menu" });
    const kind = h("select", { class: "select", id: "tp-kind" }, opts(TEMPLATE_KINDS, t.kind));
    const url = h("input", { class: "input", id: "tp-url", type: "url", value: t.url || "", placeholder: "https://..." });
    const desc = h("textarea", { class: "textarea", id: "tp-desc", rows: 3, placeholder: "Untuk apa, ukuran, dan bagian mana yang boleh diubah" });
    desc.value = t.description || "";
    editDialog({
      title: existing ? "Ubah template" : "Template baru", existing, label: `template "${t.name}"`,
      body: h("div", {}, field("Nama template", name, null, "tp-name"), field("Jenis", kind, null, "tp-kind"), field("Link template", url, "Pakai link yang membuat salinan (misalnya link template Canva).", "tp-url"), field("Keterangan", desc, null, "tp-desc")),
      onSave: async () => {
        if (!name.value.trim()) throw new Error("Nama template wajib diisi.");
        if (!safeUrl(url.value)) throw new Error("Link harus diawali http:// atau https://");
        await saveList("templates", { ...t, name: name.value.trim(), kind: kind.value, url: url.value.trim(), description: desc.value.trim() });
      },
      onDelete: () => delList("templates", t.id),
    });
  }

  function drawTemplates() {
    const card = (t) => h("div", { class: "card tpl" }, chip(t.kind || "Lainnya", "brand"), h("h4", {}, t.name), t.description && h("p", { class: "muted" }, t.description),
      h("div", { class: "row-tight", style: "margin-top:auto;padding-top:10px" }, linkBtn(t.url, "Buka template"), h("button", { class: "btn sm ghost", type: "button", onclick: () => templateDialog(t) }, "Ubah")));
    panels.templates.replaceChildren(section("Template", `Template yang dipakai tim untuk ${brand.name}. Tiap brand punya daftarnya sendiri.`, addBtn("Tambah template", () => templateDialog(null)),
      templates.length ? h("div", { class: "sgrid tpls" }, [...templates].sort((a, b) => String(a.name).localeCompare(String(b.name))).map(card)) : emptyNote("Belum ada template. Tambahkan link template pertama.")));
  }

  /* ---------------- Tab 4: Opening Kit ---------------- */
  function kitDialog(existing, defaults = {}) {
    const k = existing || { id: newId("o"), status: KIT_STATUS[0], ...defaults };
    const groups = [...new Set([...KIT_GROUPS, ...kit.map((x) => x.group).filter(Boolean)])];
    const group = h("input", { class: "input", id: "ok-group", list: "ok-groups", value: k.group || "", placeholder: "Pilih atau ketik kelompok" });
    const dl = h("datalist", { id: "ok-groups" }, groups.map((g) => h("option", { value: g })));
    const title = h("input", { class: "input", id: "ok-title", value: k.title || "", placeholder: "Contoh: T-banner depan outlet" });
    const pic = h("input", { class: "input", id: "ok-pic", value: k.pic || "", placeholder: "Nama penanggung jawab" });
    const due = h("input", { class: "input", id: "ok-due", type: "date", value: k.due || "" });
    const status = h("select", { class: "select", id: "ok-status" }, opts(KIT_STATUS, k.status));
    const link = h("input", { class: "input", id: "ok-link", type: "url", value: k.link || "", placeholder: "Opsional: link desain atau brief" });
    const note = h("textarea", { class: "textarea", id: "ok-note", rows: 3, placeholder: "Ukuran, jumlah, lokasi penempatan, vendor" });
    note.value = k.note || "";
    editDialog({
      title: existing ? "Ubah kebutuhan" : "Kebutuhan opening baru", existing, label: `"${k.title}"`,
      body: h("div", {}, field("Kelompok", group, null, "ok-group"), dl, field("Kebutuhan", title, null, "ok-title"),
        h("div", { class: "row" }, field("PIC", pic, null, "ok-pic"), field("Tenggat", due, null, "ok-due")),
        field("Status", status, null, "ok-status"), field("Link", link, null, "ok-link"), field("Catatan", note, null, "ok-note")),
      onSave: async () => {
        if (!title.value.trim()) throw new Error("Nama kebutuhan wajib diisi.");
        if (link.value.trim() && !safeUrl(link.value)) throw new Error("Link harus diawali http:// atau https://");
        await saveList("opening_kit", { ...k, group: group.value.trim() || "Lainnya", title: title.value.trim(), pic: pic.value.trim(), due: due.value, status: status.value, link: link.value.trim(), note: note.value.trim() });
      },
      onDelete: () => delList("opening_kit", k.id),
    });
  }

  const loadDefaults = () => guard(async () => {
    const have = new Set(kit.map((x) => x.title));
    const add = KIT_DEFAULTS.filter(([, t]) => !have.has(t));
    if (!add.length) { toast("Checklist standar sudah lengkap."); return; }
    await Promise.all(add.map(([group, title]) => store.saveSub(brand.id, "opening_kit", { id: newId("o"), group, title, status: KIT_STATUS[0] })));
    await reload(); redraw(); toast(`${add.length} kebutuhan ditambahkan.`);
  });

  function drawKit() {
    const done = kit.filter((x) => x.status === "Selesai").length;
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const bar = (a, b) => h("div", { class: "bar", role: "progressbar", "aria-valuenow": String(pct(a, b)), "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", { style: `width:${pct(a, b)}%` }));
    const today = new Date().toISOString().slice(0, 10);

    const row = (k) => {
      const late = k.due && k.due < today && k.status !== "Selesai";
      return h("div", { class: "kit-row" },
        h("div", { class: "kit-main" }, h("button", { class: "linklike", type: "button", onclick: () => kitDialog(k) }, k.title),
          h("div", { class: "chips", style: "margin-top:4px" }, k.pic && chip(k.pic), k.due && chip(`Tenggat ${fmtShort(k.due)}`, late ? "warn" : ""), k.note && chip("Ada catatan"))),
        linkBtn(k.link, "Link"),
        h("select", { class: "select inline", "aria-label": `Status ${k.title}`, onchange: (e) => guard(() => saveList("opening_kit", { ...k, status: e.target.value })) }, opts(KIT_STATUS, k.status)));
    };

    const order = KIT_GROUPS.filter((g) => kit.some((x) => x.group === g)).concat([...new Set(kit.map((x) => x.group))].filter((g) => !KIT_GROUPS.includes(g)));
    const groups = order.map((g) => {
      const list = kit.filter((x) => x.group === g);
      const d = list.filter((x) => x.status === "Selesai").length;
      return h("section", { class: "card kit-group" }, h("div", { class: "sec-head" }, h("div", { class: "grow" }, h("h3", {}, g), h("p", { class: "muted" }, `${d} dari ${list.length} selesai`)),
        addBtn("Tambah", () => kitDialog(null, { group: g }))), bar(d, list.length), h("div", { class: "kit-rows" }, list.map(row)));
    });

    panels.kit.replaceChildren(h("div", { class: "stack" },
      h("div", { class: "card kit-top" }, h("div", { class: "grow" }, h("h3", {}, "Kesiapan opening"), h("p", { class: "muted" }, kit.length ? `${done} dari ${kit.length} kebutuhan selesai (${pct(done, kit.length)}%)` : "Belum ada kebutuhan. Mulai dari checklist standar di SOP.")),
        h("div", { class: "row-tight" }, h("button", { class: "btn sm", type: "button", onclick: loadDefaults }, "Isi dari checklist SOP"), addBtn("Tambah kebutuhan", () => kitDialog(null))),
        kit.length > 0 && h("div", { style: "flex-basis:100%" }, bar(done, kit.length))),
      kit.length ? groups : h("div", { class: "empty" }, h("h3", {}, "Opening kit masih kosong"),
        h("p", {}, "Isi otomatis dengan checklist kesiapan opening dari SOP (bridging, hiring, properti meja dan kasir, form out, T-banner dan signage, Google Maps, Spotify), lalu sesuaikan PIC dan tenggatnya."),
        h("button", { class: "btn primary", type: "button", onclick: loadDefaults }, "Isi dari checklist SOP")),
      h("p", { class: "muted", style: "font-size:13px" }, "Media & KOL punya menu sendiri, jadi tidak masuk di sini.")));
  }

  /* ---------------- rangka halaman ---------------- */
  const TAB_DEFS = [["guideline", "Brand Guideline"], ["assets", "Aset"], ["templates", "Template"], ["kit", "Opening Kit"]];
  function drawTabs() {
    tabsEl.replaceChildren(...TAB_DEFS.map(([k, label]) => h("button", { type: "button", role: "tab", "aria-selected": String(S.tab === k), onclick: () => { S.tab = k; drawTabs(); } }, label)));
    for (const [k, el] of Object.entries(panels)) el.hidden = k !== S.tab;
  }
  redraw();
  drawTabs();

  return {
    crumbs,
    node: h("div", {},
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", {}, "Brand Set Up"),
        h("p", { class: "lead" }, `Brand guideline, aset, template, dan opening kit ${brand.name} di satu tempat.`))),
      tabsEl, panels.guideline, panels.assets, panels.templates, panels.kit),
  };
}
