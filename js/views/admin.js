import { h, icon, toast, dialog, confirmDialog } from "../ui.js";
import { safeUrl } from "./content.js";

/* Administrasi & Pengajuan (per brand). Koleksi:
   rab          : satu dokumen per RAB, rincian item disimpan di dalamnya
   licenses     : satu dokumen per lisensi; isian mengikuti kolom yang diatur tim
   admin_config : pengaturan kolom database lisensi (dokumen "license_columns")
   quotes       : data penawaran vendor */

const RAB_STATUS = ["Draft", "Diajukan", "Disetujui", "Ditolak", "Selesai"];
const QUOTE_STATUS = ["Diterima", "Dipertimbangkan", "Dipilih", "Ditolak"];
const COL_TYPES = [["text", "Teks"], ["date", "Tanggal"], ["expiry", "Tanggal kedaluwarsa"], ["url", "Link"], ["number", "Angka"]];
const DEFAULT_COLS = [
  { key: "nama", label: "Nama lisensi", type: "text" },
  { key: "nomor", label: "Nomor", type: "text" },
  { key: "penerbit", label: "Penerbit", type: "text" },
  { key: "terbit", label: "Tanggal terbit", type: "date" },
  { key: "berlaku", label: "Berlaku sampai", type: "expiry" },
  { key: "dokumen", label: "Link dokumen", type: "url" },
  { key: "catatan", label: "Catatan", type: "text" },
];
const WARN_DAYS = 60;

/* ---------- fungsi bantu ---------- */
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const fmtDate = (s) => (s ? parseYmd(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—");
const newId = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const int = (v) => { const d = String(v ?? "").replace(/\D/g, ""); return d ? parseInt(d, 10) : null; };
const dec = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };
const nf = new Intl.NumberFormat("id-ID");
const fmtRp = (n) => (n == null ? "—" : "Rp " + nf.format(Math.round(n)));
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const chip = (t, kind = "") => h("span", { class: "chip" + (kind ? " " + kind : "") }, t);
const field = (label, node, hint, id) => h("div", { class: "field" }, h("label", { for: id }, label), node, hint && h("span", { class: "hint" }, hint));
const opts = (list, cur) => list.map((t) => (Array.isArray(t) ? h("option", { value: t[0], selected: t[0] === cur }, t[1]) : h("option", { value: t, selected: t === cur }, t)));
const daysLeft = (s) => (s ? Math.round((parseYmd(s) - parseYmd(ymd(new Date()))) / 86400000) : null);
const rabTotal = (r) => (r.items || []).reduce((s, i) => s + dec(i.qty) * (i.price || 0), 0);
const rabKind = (s) => (s === "Disetujui" || s === "Selesai" ? "ok" : s === "Ditolak" ? "warn" : s === "Diajukan" ? "brand" : "");
const quoteKind = (s) => (s === "Dipilih" ? "ok" : s === "Ditolak" ? "warn" : "");

function download(name, rows) {
  const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const a = h("a", { href: URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" })), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

/* ====================================================================== */
export async function render(ctx) {
  const { store, brand } = ctx;
  const crumbs = [{ label: "Operation", href: "#/ops" }, { label: brand.name }, { label: "Administrasi & Pengajuan" }];
  if (!brand.id || brand.id === "-") {
    return { crumbs, node: h("div", { class: "empty" }, h("h3", {}, "Belum ada brand"), h("p", {}, "Tambahkan brand lebih dulu di Pengaturan > Brand.")) };
  }

  let rabs = [], lics = [], quotes = [], cols = DEFAULT_COLS;
  const reload = async () => {
    const [r, l, q, cfg] = await Promise.all(["rab", "licenses", "quotes", "admin_config"].map((n) => store.listSub(brand.id, n)));
    rabs = r; lics = l; quotes = q;
    const saved = cfg.find((x) => x.id === "license_columns");
    cols = saved?.columns?.length ? saved.columns : DEFAULT_COLS;
  };
  await reload();

  const S = { tab: "rab", rq: "", rs: "", lq: "", qq: "", qs: "" };
  const panels = { rab: h("div"), lic: h("div"), quote: h("div") };
  const tabsEl = h("div", { class: "tabs", role: "tablist" });
  const guard = async (fn) => { try { await fn(); } catch (e) { toast(e.message || String(e), "err"); } };
  const redraw = () => { drawRab(); drawLic(); drawQuote(); };
  const save = async (name, item) => { await store.saveSub(brand.id, name, item); await reload(); redraw(); };
  const remove = async (name, id) => { await store.deleteSub(brand.id, name, id); await reload(); redraw(); };

  const editDialog = ({ title, body, existing, label, onSave, onDelete, extra = [] }) => {
    const actions = [{ label: "Batal" }];
    if (existing && onDelete) {
      actions.unshift({ label: "Hapus", kind: "danger", onClick: async () => {
        if (!(await confirmDialog(`Hapus ${label}? Ini tidak bisa dibatalkan.`, "Ya, hapus"))) return false;
        await onDelete(); toast("Dihapus.");
      } });
    }
    actions.unshift(...extra);
    actions.push({ label: existing ? "Simpan" : "Tambahkan", kind: "primary", onClick: async () => { await onSave(); toast("Tersimpan."); } });
    dialog({ title, body, actions });
  };
  const sel = (key, label, list) => h("select", { class: "select", "aria-label": label, onchange: (e) => { S[key] = e.target.value; redraw(); } },
    h("option", { value: "" }, label), list.map((o) => h("option", { value: o, selected: S[key] === o }, o)));
  const searchBox = (key, ph) => h("div", { class: "search" }, icon("search", 16),
    h("input", { class: "input", type: "search", placeholder: ph, value: S[key], "aria-label": ph, oninput: (e) => { S[key] = e.target.value; clearTimeout(searchBox.t); searchBox.t = setTimeout(() => { const pos = e.target.selectionStart; redraw(); const el = panels[S.tab].querySelector("input[type=search]"); if (el) { el.focus(); el.setSelectionRange(pos, pos); } }, 150); } }));
  const stat = (label, value, sub) => h("div", { class: "kstat" }, h("div", { class: "kv" }, value), h("div", { class: "kl" }, label), sub && h("div", { class: "ks" }, sub));
  const linkCell = (u) => { const s = safeUrl(u); return s ? h("a", { href: s, target: "_blank", rel: "noopener noreferrer", title: s }, h("span", {}, hostOf(s)), icon("arrow", 13)) : h("span", { class: "muted" }, "—"); };

  /* ====================== Tab 1: RAB ====================== */
  function openRab(existing) {
    const r = existing || { id: newId("rab"), status: "Draft", date: ymd(new Date()), items: [] };
    const title = h("input", { class: "input", id: "rb-title", value: r.title || "", placeholder: "Contoh: RAB Opening Surabaya" });
    const date = h("input", { class: "input", id: "rb-date", type: "date", value: r.date || "" });
    const status = h("select", { class: "select", id: "rb-status" }, opts(RAB_STATUS, r.status));
    const purpose = h("input", { class: "input", id: "rb-purpose", value: r.purpose || "", placeholder: "Tujuan atau keperluan pengajuan" });
    const notes = h("textarea", { class: "textarea", id: "rb-notes", rows: 2, placeholder: "Catatan untuk approver" }); notes.value = r.notes || "";
    const rowsBox = h("div", { class: "rab-items" });
    const totalEl = h("div", { class: "rab-total" });
    let rows = (r.items?.length ? r.items : [{}]).map((i) => ({ id: i.id || newId("i"), name: i.name || "", qty: i.qty ?? "", unit: i.unit || "", price: i.price ?? "" }));
    const sumRow = (x) => dec(x.qty) * (int(x.price) || 0);

    const drawRows = () => {
      rowsBox.replaceChildren(
        h("div", { class: "rab-row head" }, h("span", {}, "Item"), h("span", {}, "Qty"), h("span", {}, "Satuan"), h("span", {}, "Harga satuan"), h("span", { class: "sub" }, "Subtotal"), h("span", {})),
        ...rows.map((x) => {
          const sub = h("span", { class: "sub" }, fmtRp(sumRow(x)));
          const upd = () => { sub.textContent = fmtRp(sumRow(x)); drawTotal(); };
          const inp = (key, ph, cls, mode) => h("input", { class: "input " + (cls || ""), value: x[key], placeholder: ph, "aria-label": ph, inputmode: mode, oninput: (e) => { x[key] = e.target.value; upd(); } });
          return h("div", { class: "rab-row" }, inp("name", "Nama item"), inp("qty", "1", "", "decimal"), inp("unit", "pcs"), inp("price", "0", "", "numeric"), sub,
            h("button", { class: "btn sm ghost", type: "button", "aria-label": "Hapus item", onclick: () => { rows = rows.filter((y) => y !== x); if (!rows.length) rows = [{ id: newId("i"), name: "", qty: "", unit: "", price: "" }]; drawRows(); } }, icon("x", 15)));
        }),
        h("button", { class: "btn sm", type: "button", onclick: () => { rows.push({ id: newId("i"), name: "", qty: "", unit: "", price: "" }); drawRows(); } }, icon("plus", 14), "Tambah item"));
      drawTotal();
    };
    const drawTotal = () => { totalEl.textContent = "Total: " + fmtRp(rows.reduce((s, x) => s + sumRow(x), 0)); };
    drawRows();

    const collect = () => ({
      ...r, title: title.value.trim(), date: date.value, status: status.value, purpose: purpose.value.trim(), notes: notes.value.trim(),
      items: rows.filter((x) => x.name.trim()).map((x) => ({ id: x.id, name: x.name.trim(), qty: dec(x.qty) || 1, unit: x.unit.trim(), price: int(x.price) || 0 })),
    });
    editDialog({
      title: existing ? "Ubah RAB" : "RAB baru", existing, label: `RAB "${r.title}"`,
      body: h("div", {}, field("Judul RAB", title, null, "rb-title"), h("div", { class: "row" }, field("Tanggal", date, null, "rb-date"), field("Status", status, null, "rb-status")),
        field("Keperluan", purpose, null, "rb-purpose"), h("div", { class: "field" }, h("span", { class: "lbl" }, "Rincian biaya"), rowsBox, totalEl), field("Catatan", notes, null, "rb-notes")),
      onSave: async () => {
        const d = collect();
        if (!d.title) throw new Error("Judul RAB wajib diisi.");
        if (!d.items.length) throw new Error("Isi minimal satu item biaya.");
        await save("rab", d);
      },
      onDelete: () => remove("rab", r.id),
      extra: existing ? [{ label: "Unduh CSV", close: false, onClick: () => { exportRab(collect()); return false; } }] : [],
    });
  }

  function exportRab(r) {
    const rows = [[r.title], ["Tanggal", r.date, "Status", r.status], ["Keperluan", r.purpose || ""], [], ["Item", "Qty", "Satuan", "Harga satuan", "Subtotal"]];
    (r.items || []).forEach((i) => rows.push([i.name, i.qty, i.unit, i.price, dec(i.qty) * (i.price || 0)]));
    rows.push([], ["Total", "", "", "", rabTotal(r)]);
    download(`rab-${(r.title || "rab").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, rows);
  }

  function drawRab() {
    const needle = S.rq.trim().toLowerCase();
    const rows = rabs.filter((r) => (!S.rs || r.status === S.rs) && (!needle || `${r.title} ${r.purpose || ""}`.toLowerCase().includes(needle)))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const sumBy = (f) => rabs.filter(f).reduce((s, r) => s + rabTotal(r), 0);
    const stats = h("div", { class: "kstats" },
      stat("Total RAB", rabs.length, `${rabs.filter((r) => r.status === "Draft").length} masih draft`),
      stat("Menunggu persetujuan", rabs.filter((r) => r.status === "Diajukan").length, fmtRp(sumBy((r) => r.status === "Diajukan"))),
      stat("Disetujui", rabs.filter((r) => r.status === "Disetujui").length, fmtRp(sumBy((r) => r.status === "Disetujui"))),
      stat("Selesai", rabs.filter((r) => r.status === "Selesai").length, fmtRp(sumBy((r) => r.status === "Selesai"))));
    const toolbar = h("div", { class: "toolbar" }, searchBox("rq", "Cari judul RAB"), sel("rs", "Semua status", RAB_STATUS), h("span", { style: "flex:1" }),
      h("button", { class: "btn primary", type: "button", onclick: () => openRab(null) }, icon("plus", 16), "RAB baru"));
    const tr = (r) => h("tr", {},
      h("td", { style: "white-space:nowrap" }, h("b", {}, fmtDate(r.date))),
      h("td", {}, h("button", { class: "linklike", type: "button", onclick: () => openRab(r) }, r.title || "(tanpa judul)"), r.purpose && h("div", { class: "muted", style: "font-size:13px;margin-top:2px" }, r.purpose)),
      h("td", { class: "num" }, (r.items || []).length),
      h("td", { class: "num" }, h("b", {}, fmtRp(rabTotal(r)))),
      h("td", {}, h("select", { class: "select inline", "aria-label": `Status ${r.title}`, onchange: (e) => guard(() => save("rab", { ...r, status: e.target.value })) }, opts(RAB_STATUS, r.status)), h("div", { style: "margin-top:6px" }, chip(r.status, rabKind(r.status)))),
      h("td", { class: "act" },
        h("button", { class: "btn sm ghost", type: "button", title: "Duplikat", "aria-label": `Duplikat ${r.title}`, onclick: () => guard(async () => { await save("rab", { ...r, id: newId("rab"), title: `${r.title} (salinan)`, status: "Draft", date: ymd(new Date()) }); toast("RAB diduplikat sebagai draft."); }) }, icon("copy", 16)),
        h("button", { class: "btn sm ghost", type: "button", "aria-label": `Ubah ${r.title}`, onclick: () => openRab(r) }, icon("edit", 16))));
    panels.rab.replaceChildren(stats, toolbar,
      !rabs.length ? h("div", { class: "empty" }, h("h3", {}, "Belum ada RAB"), h("p", {}, `Buat rencana anggaran biaya pertama untuk ${brand.name}: isi item, jumlah, dan harga satuan, total dihitung otomatis.`), h("button", { class: "btn primary", type: "button", onclick: () => openRab(null) }, icon("plus", 16), "RAB baru"))
        : !rows.length ? h("div", { class: "empty" }, h("h3", {}, "Tidak ada RAB yang cocok"))
        : h("div", { class: "tablewrap plain" }, h("table", {}, h("thead", {}, h("tr", {}, ["Tanggal", "RAB", "Item", "Total", "Status", ""].map((t, i) => h("th", { class: i === 2 || i === 3 ? "num" : "" }, t)))), h("tbody", {}, rows.map(tr)))));
  }

  /* ====================== Tab 2: Database lisensi ====================== */
  const cellText = (c, v) => (c.type === "date" || c.type === "expiry" ? fmtDate(v) : c.type === "number" && v !== "" && v != null ? nf.format(v) : v ?? "");

  function openLic(existing) {
    const l = existing || { id: newId("lic") };
    const inputs = cols.map((c) => {
      const base = { class: "input", id: `lc-${c.key}`, value: l[c.key] ?? "" };
      const el = c.type === "date" || c.type === "expiry" ? h("input", { ...base, type: "date" }) : c.type === "url" ? h("input", { ...base, type: "url", placeholder: "https://..." }) : c.type === "number" ? h("input", { ...base, inputmode: "numeric" }) : h("input", base);
      return { c, el };
    });
    editDialog({
      title: existing ? "Ubah lisensi" : "Lisensi baru", existing, label: "lisensi ini",
      body: h("div", {}, inputs.map(({ c, el }) => field(c.label, el, c.type === "expiry" ? `Pengingat muncul ${WARN_DAYS} hari sebelum tanggal ini.` : null, `lc-${c.key}`))),
      onSave: async () => {
        const d = { ...l };
        for (const { c, el } of inputs) {
          const v = el.value.trim();
          if (c.type === "url" && v && !safeUrl(v)) throw new Error(`Link di kolom "${c.label}" belum benar. Awali dengan https://`);
          d[c.key] = c.type === "number" ? (v ? int(v) : "") : v;
        }
        if (!cols.some((c) => String(d[c.key] || "").trim())) throw new Error("Isi minimal satu kolom.");
        await save("licenses", d);
      },
      onDelete: () => remove("licenses", l.id),
    });
  }

  function openCols() {
    let draft = cols.map((c) => ({ ...c }));
    const box = h("div", { class: "colseditor" });
    const draw = () => box.replaceChildren(...draft.map((c, i) => h("div", { class: "colrow" },
      h("input", { class: "input", value: c.label, "aria-label": "Nama kolom", oninput: (e) => { c.label = e.target.value; } }),
      h("select", { class: "select", "aria-label": "Jenis kolom", onchange: (e) => { c.type = e.target.value; } }, opts(COL_TYPES, c.type)),
      h("button", { class: "btn sm ghost", type: "button", "aria-label": "Naikkan", disabled: i === 0, onclick: () => { [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; draw(); } }, icon("up", 15)),
      h("button", { class: "btn sm ghost", type: "button", "aria-label": "Turunkan", disabled: i === draft.length - 1, onclick: () => { [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]]; draw(); } }, icon("down", 15)),
      h("button", { class: "btn sm ghost", type: "button", "aria-label": "Hapus kolom", onclick: async () => {
        const used = lics.filter((x) => String(x[c.key] ?? "").trim()).length;
        if (used && !(await confirmDialog(`Kolom "${c.label}" berisi data di ${used} lisensi. Data di kolom ini tidak akan tampil lagi. Hapus kolom?`, "Ya, hapus kolom"))) return;
        draft = draft.filter((x) => x !== c); draw();
      } }, icon("trash", 15))))
      .concat([h("button", { class: "btn sm", type: "button", onclick: () => { draft.push({ key: newId("k"), label: "Kolom baru", type: "text" }); draw(); } }, icon("plus", 14), "Tambah kolom")]));
    draw();
    dialog({
      title: "Atur kolom database lisensi",
      body: h("div", {}, h("p", { class: "muted", style: "margin-bottom:12px;font-size:13.5px" }, "Ubah nama, jenis, dan urutan kolom sesuai kebutuhan brand ini. Kolom bertipe Tanggal kedaluwarsa dipakai untuk pengingat masa berlaku."), box),
      actions: [{ label: "Batal" }, { label: "Kembalikan bawaan", onClick: async () => { if (!(await confirmDialog("Kembalikan kolom ke pengaturan bawaan? Kolom tambahan tidak akan tampil lagi (datanya tetap tersimpan).", "Ya, kembalikan", ""))) return false; await save("admin_config", { id: "license_columns", columns: DEFAULT_COLS }); toast("Kolom dikembalikan."); } },
        { label: "Simpan", kind: "primary", onClick: async () => {
          const clean = draft.map((c) => ({ ...c, label: c.label.trim() })).filter((c) => c.label);
          if (!clean.length) throw new Error("Minimal satu kolom.");
          await save("admin_config", { id: "license_columns", columns: clean }); toast("Kolom tersimpan.");
        } }],
    });
  }

  function drawLic() {
    const needle = S.lq.trim().toLowerCase();
    const expCol = cols.find((c) => c.type === "expiry");
    const state = (l) => { const d = expCol ? daysLeft(l[expCol.key]) : null; return d == null ? "" : d < 0 ? "expired" : d <= WARN_DAYS ? "soon" : "ok"; };
    const rows = lics.filter((l) => !needle || cols.some((c) => String(l[c.key] ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => (expCol ? String(a[expCol.key] || "9999").localeCompare(String(b[expCol.key] || "9999")) : 0));
    const stats = h("div", { class: "kstats" }, stat("Total lisensi", lics.length),
      expCol && stat(`Segera habis (${WARN_DAYS} hari)`, lics.filter((l) => state(l) === "soon").length), expCol && stat("Sudah kedaluwarsa", lics.filter((l) => state(l) === "expired").length));
    const toolbar = h("div", { class: "toolbar" }, searchBox("lq", "Cari di semua kolom"), h("span", { style: "flex:1" }),
      h("button", { class: "btn", type: "button", onclick: openCols }, "Atur kolom"),
      h("button", { class: "btn", type: "button", disabled: !rows.length, onclick: () => download(`lisensi-${brand.id}.csv`, [cols.map((c) => c.label), ...rows.map((l) => cols.map((c) => l[c.key] ?? ""))]) }, "Unduh CSV"),
      h("button", { class: "btn primary", type: "button", onclick: () => openLic(null) }, icon("plus", 16), "Lisensi baru"));
    const tr = (l) => {
      const st = state(l);
      return h("tr", { class: st ? "lic-" + st : "" }, ...cols.map((c, i) => {
        const v = l[c.key];
        let node;
        if (c.type === "url") node = h("div", { class: "refcell" }, linkCell(v));
        else if (c.type === "expiry") node = h("div", {}, cellText(c, v), st === "expired" ? h("div", {}, chip("Kedaluwarsa", "warn")) : st === "soon" ? h("div", {}, chip(`${daysLeft(v)} hari lagi`, "warn")) : null);
        else if (i === 0) node = h("button", { class: "linklike", type: "button", onclick: () => openLic(l) }, cellText(c, v) || "(tanpa nama)");
        else node = cellText(c, v) || h("span", { class: "muted" }, "—");
        return h("td", { class: c.type === "number" ? "num" : "" }, node);
      }), h("td", { class: "act" }, h("button", { class: "btn sm ghost", type: "button", "aria-label": "Ubah lisensi", onclick: () => openLic(l) }, icon("edit", 16))));
    };
    panels.lic.replaceChildren(stats, toolbar,
      !lics.length ? h("div", { class: "empty" }, h("h3", {}, "Belum ada lisensi"), h("p", {}, "Catat izin usaha, sertifikat, hak cipta, atau lisensi musik di sini. Kolomnya bisa disesuaikan lewat tombol Atur kolom."), h("button", { class: "btn primary", type: "button", onclick: () => openLic(null) }, icon("plus", 16), "Lisensi baru"))
        : !rows.length ? h("div", { class: "empty" }, h("h3", {}, "Tidak ada lisensi yang cocok"))
        : h("div", { class: "tablewrap plain" }, h("table", {}, h("thead", {}, h("tr", {}, ...cols.map((c) => h("th", { class: c.type === "number" ? "num" : "" }, c.label)), h("th", {}))), h("tbody", {}, rows.map(tr)))));
  }

  /* ====================== Tab 3: Data penawaran ====================== */
  function openQuote(existing) {
    const q = existing || { id: newId("q"), status: "Diterima", date: ymd(new Date()) };
    const vendor = h("input", { class: "input", id: "qt-vendor", value: q.vendor || "", placeholder: "Nama vendor" });
    const need = h("input", { class: "input", id: "qt-need", list: "qt-needs", value: q.need || "", placeholder: "Contoh: T-banner, Signage, Spotify" });
    const needs = h("datalist", { id: "qt-needs" }, [...new Set(quotes.map((x) => x.need).filter(Boolean))].map((n) => h("option", { value: n })));
    const item = h("input", { class: "input", id: "qt-item", value: q.item || "", placeholder: "Spesifikasi atau paket yang ditawarkan" });
    const price = h("input", { class: "input", id: "qt-price", inputmode: "numeric", value: q.price ?? "", placeholder: "0" });
    const date = h("input", { class: "input", id: "qt-date", type: "date", value: q.date || "" });
    const valid = h("input", { class: "input", id: "qt-valid", type: "date", value: q.validUntil || "" });
    const link = h("input", { class: "input", id: "qt-link", type: "url", value: q.link || "", placeholder: "https://... (dokumen penawaran)" });
    const contact = h("input", { class: "input", id: "qt-contact", value: q.contact || "", placeholder: "Nama dan nomor kontak" });
    const status = h("select", { class: "select", id: "qt-status" }, opts(QUOTE_STATUS, q.status));
    const notes = h("textarea", { class: "textarea", id: "qt-notes", rows: 2 }); notes.value = q.notes || "";
    editDialog({
      title: existing ? "Ubah penawaran" : "Penawaran baru", existing, label: `penawaran ${q.vendor || ""}`,
      body: h("div", {}, h("div", { class: "row" }, field("Vendor", vendor, null, "qt-vendor"), field("Kebutuhan", need, "Penawaran dengan kebutuhan sama dibandingkan harganya.", "qt-need")), needs,
        field("Item / paket", item, null, "qt-item"), h("div", { class: "row" }, field("Harga (Rp)", price, null, "qt-price"), field("Status", status, null, "qt-status")),
        h("div", { class: "row" }, field("Tanggal penawaran", date, null, "qt-date"), field("Berlaku sampai", valid, null, "qt-valid")),
        field("Link dokumen", link, null, "qt-link"), field("Kontak vendor", contact, null, "qt-contact"), field("Catatan", notes, null, "qt-notes")),
      onSave: async () => {
        if (!vendor.value.trim()) throw new Error("Nama vendor wajib diisi.");
        if (!need.value.trim()) throw new Error("Isi kebutuhan supaya penawaran bisa dibandingkan.");
        if (link.value.trim() && !safeUrl(link.value)) throw new Error("Link belum benar. Awali dengan https://");
        await save("quotes", { ...q, vendor: vendor.value.trim(), need: need.value.trim(), item: item.value.trim(), price: int(price.value), status: status.value, date: date.value, validUntil: valid.value, link: link.value.trim(), contact: contact.value.trim(), notes: notes.value.trim() });
      },
      onDelete: () => remove("quotes", q.id),
    });
  }

  function drawQuote() {
    const needle = S.qq.trim().toLowerCase();
    const rows = quotes.filter((x) => (!S.qs || x.status === S.qs) && (!needle || `${x.vendor} ${x.need} ${x.item || ""}`.toLowerCase().includes(needle)));
    const groups = {};
    for (const x of quotes) if (x.status !== "Ditolak" && x.price != null) (groups[x.need] ||= []).push(x);
    const cheapest = (x) => { const g = groups[x.need]; return g && g.length > 1 && x.status !== "Ditolak" && x.price != null && x.price === Math.min(...g.map((y) => y.price)); };
    const byNeed = [...new Set(rows.map((x) => x.need))].sort((a, b) => a.localeCompare(b));
    const stats = h("div", { class: "kstats" }, stat("Total penawaran", quotes.length, `${new Set(quotes.map((x) => x.need)).size} kebutuhan`),
      stat("Dipertimbangkan", quotes.filter((x) => x.status === "Dipertimbangkan" || x.status === "Diterima").length),
      stat("Dipilih", quotes.filter((x) => x.status === "Dipilih").length, fmtRp(quotes.filter((x) => x.status === "Dipilih").reduce((s, x) => s + (x.price || 0), 0))));
    const toolbar = h("div", { class: "toolbar" }, searchBox("qq", "Cari vendor atau kebutuhan"), sel("qs", "Semua status", QUOTE_STATUS), h("span", { style: "flex:1" }),
      h("button", { class: "btn", type: "button", disabled: !rows.length, onclick: () => download(`penawaran-${brand.id}.csv`, [["Kebutuhan", "Vendor", "Item", "Harga", "Status", "Tanggal", "Berlaku sampai", "Link", "Kontak", "Catatan"], ...rows.map((x) => [x.need, x.vendor, x.item, x.price, x.status, x.date, x.validUntil, x.link, x.contact, x.notes])]) }, "Unduh CSV"),
      h("button", { class: "btn primary", type: "button", onclick: () => openQuote(null) }, icon("plus", 16), "Penawaran baru"));
    const tr = (x) => {
      const left = daysLeft(x.validUntil);
      return h("tr", {},
        h("td", {}, h("button", { class: "linklike", type: "button", onclick: () => openQuote(x) }, x.vendor), x.contact && h("div", { class: "muted", style: "font-size:12.5px" }, x.contact)),
        h("td", {}, x.item || h("span", { class: "muted" }, "—")),
        h("td", { class: "num" }, h("b", {}, fmtRp(x.price)), cheapest(x) && h("div", {}, chip("Termurah", "ok"))),
        h("td", { style: "white-space:nowrap" }, fmtDate(x.date), x.validUntil && h("div", { class: "muted", style: "font-size:12.5px" }, left < 0 ? "Sudah habis masa berlaku" : `Berlaku s.d. ${fmtDate(x.validUntil)}`)),
        h("td", { class: "refcell" }, linkCell(x.link)),
        h("td", {}, h("select", { class: "select inline", "aria-label": `Status ${x.vendor}`, onchange: (e) => guard(() => save("quotes", { ...x, status: e.target.value })) }, opts(QUOTE_STATUS, x.status)), h("div", { style: "margin-top:6px" }, chip(x.status, quoteKind(x.status)))),
        h("td", { class: "act" }, h("button", { class: "btn sm ghost", type: "button", "aria-label": `Ubah ${x.vendor}`, onclick: () => openQuote(x) }, icon("edit", 16))));
    };
    panels.quote.replaceChildren(stats, toolbar,
      !quotes.length ? h("div", { class: "empty" }, h("h3", {}, "Belum ada data penawaran"), h("p", {}, "Catat penawaran vendor dan kelompokkan per kebutuhan. Harga termurah di tiap kebutuhan ditandai otomatis."), h("button", { class: "btn primary", type: "button", onclick: () => openQuote(null) }, icon("plus", 16), "Penawaran baru"))
        : !rows.length ? h("div", { class: "empty" }, h("h3", {}, "Tidak ada penawaran yang cocok"))
        : h("div", {}, byNeed.map((n) => {
          const list = rows.filter((x) => x.need === n).sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
          return h("section", { class: "quote-group" }, h("h3", {}, n, h("span", { class: "muted" }, ` · ${list.length} penawaran`)),
            h("div", { class: "tablewrap plain" }, h("table", {}, h("thead", {}, h("tr", {}, ["Vendor", "Item / paket", "Harga", "Tanggal", "Dokumen", "Status", ""].map((t, i) => h("th", { class: i === 2 ? "num" : "" }, t)))), h("tbody", {}, list.map(tr)))));
        })));
  }

  /* ---------------- rangka halaman ---------------- */
  const TAB_DEFS = [["rab", "RAB"], ["lic", "Database Lisensi"], ["quote", "Data Penawaran"]];
  function drawTabs() {
    tabsEl.replaceChildren(...TAB_DEFS.map(([k, label]) => h("button", { type: "button", role: "tab", "aria-selected": String(S.tab === k), onclick: () => { S.tab = k; drawTabs(); } }, label)));
    for (const [k, el] of Object.entries(panels)) el.hidden = k !== S.tab;
  }
  redraw();
  drawTabs();

  return {
    crumbs,
    node: h("div", {},
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", {}, "Administrasi & Pengajuan"),
        h("p", { class: "lead" }, `Rencana anggaran, lisensi, dan penawaran vendor ${brand.name} dalam satu tempat.`))),
      tabsEl, panels.rab, panels.lic, panels.quote),
  };
}
