import { h, icon, toast, dialog, confirmDialog } from "../ui.js";

/* ---------- pilihan isian (mengikuti SOP dan handbook) ---------- */
const STATUSES = ["Planned", "Production", "Editing", "Pending Approval", "Revision Required", "Approved", "Published", "Upload Issue"];
const CAPTION_STATES = ["Belum diajukan", "Pending Caption Approval", "Revision Required", "Approved"];
const TYPES = ["Feed Post", "Carousel", "Reels", "Story", "Video", "Lainnya"];
const PLATFORMS = ["Instagram", "TikTok", "YouTube", "Facebook"];
const PILLARS = ["Produk & appetite appeal", "Edukasi", "Pengalaman pelanggan", "Brand story", "Komunitas", "Promosi"];
const FEED_TYPES = ["Feed Post", "Carousel", "Reels"]; // Story tidak masuk grid profil
// Hari penting yang tanggalnya tetap setiap tahun. Hari besar yang berpindah (Lebaran dll.) ditambah manual.
const FIXED_DAYS = [[1, 1, "Tahun Baru"], [14, 2, "Hari Valentine"], [21, 4, "Hari Kartini"], [1, 5, "Hari Buruh"], [1, 6, "Hari Lahir Pancasila"],
  [17, 8, "Hari Kemerdekaan RI"], [28, 10, "Hari Sumpah Pemuda"], [10, 11, "Hari Pahlawan"], [22, 12, "Hari Ibu"], [25, 12, "Natal"], [31, 12, "Malam Tahun Baru"]];
const DOW = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/* ---------- fungsi bantu ---------- */
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const fmtDay = (s) => (s ? parseYmd(s).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "");
const fmtShort = (s) => (s ? parseYmd(s).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "");
const monthLabel = (y, m) => new Date(y, m, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
const newId = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const sortKey = (c) => `${c.date || "9999-12-31"} ${c.time || "00:00"}`;
const statusKind = (s) => (s === "Published" || s === "Approved" ? "ok" : s === "Revision Required" || s === "Upload Issue" ? "warn" : "");

export const safeUrl = (u) => {
  try { const x = new URL(String(u || "").trim()); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; }
};
// Link Google Drive dibuat menjadi thumbnail supaya bisa tampil di simulasi feed (file harus dibagikan publik).
export const coverSrc = (u) => {
  const s = safeUrl(u);
  if (!s) return "";
  const m = s.match(/drive\.google\.com\/file\/d\/([\w-]+)/) || s.match(/drive\.google\.com\/open\?id=([\w-]+)/);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w600` : s;
};
const cssUrl = (s) => `url("${s.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const chip = (text, kind = "") => h("span", { class: "chip" + (kind ? " " + kind : "") }, text);
const field = (label, node, hint, id) => h("div", { class: "field" }, h("label", { for: id }, label), node, hint && h("span", { class: "hint" }, hint));

/* ====================================================================== */
export async function render(ctx) {
  const { store, brand } = ctx;
  const crumbs = [{ label: "Operation", href: "#/ops" }, { label: brand.name }, { label: "Content Plan" }];

  if (!brand.id || brand.id === "-") {
    return { crumbs, node: h("div", { class: "empty" }, h("h3", {}, "Belum ada brand"), h("p", {}, "Tambahkan brand lebih dulu di Pengaturan > Brand.")) };
  }

  let items = [];
  let events = [];
  const reload = async () => {
    [items, events] = await Promise.all([store.listContent(brand.id), store.listEvents(brand.id)]);
  };
  await reload();

  const now = new Date();
  const S = { tab: "planner", y: now.getFullYear(), m: now.getMonth(), f: { q: "", status: "", pillar: "", platform: "", month: "" } };
  const panels = { planner: h("div"), calendar: h("div"), feed: h("div") };
  const tabsEl = h("div", { class: "tabs", role: "tablist" });

  const redraw = () => { drawPlanner(); drawCalendar(); drawFeed(); };
  const guard = async (fn) => {
    try { await fn(); } catch (e) { toast(e.message || String(e), "err"); }
  };
  const persist = (c) => guard(async () => { await store.saveContent(brand.id, c); await reload(); redraw(); });

  /* ---------------- editor konten ---------------- */
  function openContent(existing, defaults = {}) {
    const c = existing || { id: newId("c"), status: "Planned", captionApproval: CAPTION_STATES[0], type: "Feed Post", platforms: ["Instagram"], ...defaults };
    const title = h("input", { class: "input", id: "ct-title", value: c.title || "", placeholder: "Contoh: Reels proses membuat salmon aburi" });
    const ref = h("input", { class: "input", id: "ct-ref", type: "url", value: c.reference || "", placeholder: "https://..." });
    const plink = h("input", { class: "input", id: "ct-plink", type: "url", value: c.postLink || "", placeholder: "https://www.instagram.com/p/... (isi setelah konten tayang)" });
    const cover = h("input", { class: "input", id: "ct-cover", type: "url", value: c.cover || "", placeholder: "https://... (opsional)" });
    const date = h("input", { class: "input", id: "ct-date", type: "date", value: c.date || "" });
    const time = h("input", { class: "input", id: "ct-time", type: "time", value: c.time || "" });
    const type = h("select", { class: "select", id: "ct-type" }, TYPES.map((t) => h("option", { value: t, selected: t === c.type }, t)));
    const pillar = h("input", { class: "input", id: "ct-pillar", list: "ct-pillars", value: c.pillar || "", placeholder: "Pilih atau ketik sendiri" });
    const pillars = h("datalist", { id: "ct-pillars" }, [...new Set([...PILLARS, ...items.map((i) => i.pillar).filter(Boolean)])].map((p) => h("option", { value: p })));
    const status = h("select", { class: "select", id: "ct-status" }, STATUSES.map((t) => h("option", { value: t, selected: t === c.status }, t)));
    const caption = h("textarea", { class: "textarea", id: "ct-caption", rows: 5, placeholder: "Tulis caption di sini" });
    caption.value = c.caption || "";
    const capState = h("select", { class: "select", id: "ct-capstate" }, CAPTION_STATES.map((t) => h("option", { value: t, selected: t === c.captionApproval }, t)));
    const plats = PLATFORMS.map((p) => ({ p, el: h("input", { type: "checkbox", class: "check", checked: (c.platforms || []).includes(p) }) }));

    const body = h("div", {},
      field("Judul / topik konten", title, null, "ct-title"),
      h("div", { class: "row" }, field("Tanggal upload", date, null, "ct-date"), field("Jam upload", time, null, "ct-time")),
      h("div", { class: "row" }, field("Tipe konten", type, null, "ct-type"), field("Pillar", pillar, null, "ct-pillar")),
      pillars,
      h("div", { class: "field" }, h("span", { class: "lbl" }, "Platform upload"),
        h("div", { class: "chips" }, plats.map(({ p, el }) => h("label", { class: "checkrow", style: "margin-right:12px" }, el, p)))),
      field("Referensi konten", ref, "Link contoh atau moodboard yang jadi acuan.", "ct-ref"),
      field("Caption", caption, null, "ct-caption"),
      h("div", { class: "row" }, field("Approval caption", capState, null, "ct-capstate"), field("Status konten", status, "Alur: Planned sampai Published (lihat SOP).", "ct-status")),
      field("Link konten (hasil upload)", plink, "Tempel link postingan setelah konten tayang, misalnya link Instagram, TikTok, atau YouTube.", "ct-plink"),
      field("Link cover / visual", cover, "Dipakai di simulasi feed Instagram. Link Google Drive atau gambar langsung; file harus bisa dilihat publik. Kalau kosong, tampil kotak warna.", "ct-cover"));

    const actions = [{ label: "Batal" }];
    if (existing) {
      actions.unshift({
        label: "Hapus", kind: "danger",
        onClick: async () => {
          if (!(await confirmDialog(`Hapus konten "${c.title}"? Ini tidak bisa dibatalkan.`, "Ya, hapus"))) return false;
          await store.deleteContent(brand.id, c.id); await reload(); redraw(); toast("Konten dihapus.");
        },
      });
    }
    actions.push({
      label: existing ? "Simpan" : "Tambahkan", kind: "primary",
      onClick: async () => {
        if (!title.value.trim()) throw new Error("Judul konten wajib diisi.");
        if (!date.value) throw new Error("Tanggal upload wajib diisi supaya konten muncul di kalender.");
        if (plink.value.trim() && !safeUrl(plink.value)) throw new Error("Link konten belum benar. Awali dengan https://");
        await store.saveContent(brand.id, {
          ...c, title: title.value.trim(), date: date.value, time: time.value, type: type.value, pillar: pillar.value.trim(),
          platforms: plats.filter(({ el }) => el.checked).map(({ p }) => p), reference: ref.value.trim(), caption: caption.value,
          captionApproval: capState.value, status: status.value, cover: cover.value.trim(), postLink: plink.value.trim(),
        });
        await reload(); redraw(); toast("Konten tersimpan.");
      },
    });
    dialog({ title: existing ? "Ubah konten" : "Konten baru", body, actions });
  }

  /* ---------------- isi link konten (cepat dari tabel) ---------------- */
  function openLink(c) {
    const inp = h("input", { class: "input", id: "pl-url", type: "url", value: c.postLink || "", placeholder: "https://..." });
    dialog({
      title: "Link konten",
      body: h("div", {}, h("p", { class: "muted", style: "margin-bottom:12px" }, c.title || "(tanpa judul)"),
        field("Link postingan", inp, "Tempel link setelah konten tayang di platform.", "pl-url")),
      actions: [{ label: "Batal" }, {
        label: "Simpan", kind: "primary",
        onClick: async () => {
          const v = inp.value.trim();
          if (v && !safeUrl(v)) throw new Error("Link belum benar. Awali dengan https://");
          await store.saveContent(brand.id, { ...c, postLink: v });
          await reload(); redraw(); toast(v ? "Link konten tersimpan." : "Link konten dikosongkan.");
        },
      }],
    });
  }

  /* ---------------- editor event / hari penting ---------------- */
  function openEvent(existing, defaults = {}) {
    const e = existing || { id: newId("e"), kind: "event", ...defaults };
    const title = h("input", { class: "input", id: "ev-title", value: e.title || "", placeholder: "Contoh: Grand opening" });
    const date = h("input", { class: "input", id: "ev-date", type: "date", value: e.date || "" });
    const kind = h("select", { class: "select", id: "ev-kind" },
      h("option", { value: "event", selected: e.kind !== "hari-penting" }, "Event brand"),
      h("option", { value: "hari-penting", selected: e.kind === "hari-penting" }, "Hari penting"));
    const actions = [{ label: "Batal" }];
    if (existing) {
      actions.unshift({
        label: "Hapus", kind: "danger",
        onClick: async () => {
          if (!(await confirmDialog(`Hapus "${e.title}" dari kalender?`, "Ya, hapus"))) return false;
          await store.deleteEvent(brand.id, e.id); await reload(); redraw(); toast("Dihapus dari kalender.");
        },
      });
    }
    actions.push({
      label: existing ? "Simpan" : "Tambahkan", kind: "primary",
      onClick: async () => {
        if (!title.value.trim() || !date.value) throw new Error("Nama dan tanggal wajib diisi.");
        await store.saveEvent(brand.id, { ...e, title: title.value.trim(), date: date.value, kind: kind.value });
        await reload(); redraw(); toast("Tersimpan di kalender.");
      },
    });
    dialog({
      title: existing ? "Ubah event" : "Event / hari penting",
      body: h("div", {}, field("Nama", title, null, "ev-title"), h("div", { class: "row" }, field("Tanggal", date, null, "ev-date"), field("Jenis", kind, null, "ev-kind"))),
      actions,
    });
  }

  const addAt = (date) => dialog({
    title: `Tambah di ${fmtDay(date)}`,
    body: h("p", { class: "muted" }, "Mau menambahkan apa di tanggal ini?"),
    actions: [{ label: "Batal" }, { label: "Event / hari penting", onClick: () => { openEvent(null, { date }); } }, { label: "Konten", kind: "primary", onClick: () => { openContent(null, { date }); } }],
  });

  /* ---------------- tab 1: Content Planner ---------------- */
  function drawPlanner() {
    const F = S.f;
    const pillarOpts = [...new Set([...PILLARS, ...items.map((i) => i.pillar).filter(Boolean)])];
    const sel = (key, label, opts) => h("select", { class: "select", "aria-label": label, onchange: (ev) => { F[key] = ev.target.value; drawTable(); } },
      h("option", { value: "" }, label), opts.map((o) => h("option", { value: o, selected: F[key] === o }, o)));
    const q = h("input", { class: "input", type: "search", placeholder: "Cari judul atau caption", value: F.q, "aria-label": "Cari konten", oninput: (ev) => { F.q = ev.target.value; drawTable(); } });
    const month = h("input", { class: "input", type: "month", value: F.month, "aria-label": "Filter bulan", onchange: (ev) => { F.month = ev.target.value; drawTable(); } });
    const tableBox = h("div");

    function drawTable() {
      const needle = F.q.trim().toLowerCase();
      const rows = items
        .filter((c) => (!F.status || c.status === F.status) && (!F.pillar || c.pillar === F.pillar) && (!F.platform || (c.platforms || []).includes(F.platform))
          && (!F.month || String(c.date || "").startsWith(F.month))
          && (!needle || `${c.title || ""} ${c.caption || ""}`.toLowerCase().includes(needle)))
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

      if (!items.length) {
        tableBox.replaceChildren(h("div", { class: "empty" }, h("h3", {}, "Belum ada konten"),
          h("p", {}, `Mulai isi content plan ${brand.name}. Setiap konten otomatis muncul di Marketing Calendar dan simulasi feed.`),
          h("button", { class: "btn primary", type: "button", onclick: () => openContent(null) }, icon("plus", 16), "Tambah konten pertama")));
        return;
      }
      if (!rows.length) { tableBox.replaceChildren(h("div", { class: "empty" }, h("h3", {}, "Tidak ada konten yang cocok"), h("p", {}, "Ubah atau kosongkan filter di atas."))); return; }

      const statusSel = (c) => h("select", {
        class: "select inline", "aria-label": `Status ${c.title}`,
        onchange: (ev) => persist({ ...c, status: ev.target.value }),
      }, STATUSES.map((s) => h("option", { value: s, selected: s === c.status }, s)));

      const postCell = (c) => {
        const pl = safeUrl(c.postLink);
        const edit = h("button", { class: "linklike small", type: "button", "aria-label": `Ubah link konten ${c.title}`, onclick: () => openLink(c) }, pl ? "ubah" : (c.status === "Published" ? "Isi link (sudah tayang)" : "+ Isi link"));
        return h("div", {}, pl && h("a", { href: pl, target: "_blank", rel: "noopener noreferrer", title: pl }, h("span", {}, hostOf(pl)), icon("arrow", 13)),
          h("div", { class: c.status === "Published" && !pl ? "need-link" : "" }, edit));
      };
      const tr = (c) => {
        const link = safeUrl(c.reference);
        return h("tr", {},
          h("td", { style: "white-space:nowrap" }, h("b", {}, fmtShort(c.date)), h("div", { class: "muted", style: "font-size:12.5px" }, c.time || "—")),
          h("td", {}, h("button", { class: "linklike", type: "button", onclick: () => openContent(c) }, c.title || "(tanpa judul)"),
            h("div", { class: "chips", style: "margin-top:6px" }, chip(c.type || "—"), c.pillar && chip(c.pillar, "brand"))),
          h("td", { class: "refcell" }, link
            ? h("a", { href: link, target: "_blank", rel: "noopener noreferrer", title: link }, h("span", {}, hostOf(link)), icon("arrow", 13))
            : c.reference ? h("span", { class: "muted", title: c.reference }, c.reference) : h("span", { class: "muted" }, "—")),
          h("td", {}, (c.platforms || []).length ? h("div", { class: "chips" }, c.platforms.map((p) => chip(p))) : h("span", { class: "muted" }, "—")),
          h("td", { style: "min-width:170px" }, c.caption ? h("div", { class: "cap-prev" }, c.caption) : h("span", { class: "muted" }, "Belum ada caption"),
            h("div", { style: "margin-top:6px" }, chip(c.captionApproval || CAPTION_STATES[0], c.captionApproval === "Approved" ? "ok" : c.captionApproval === "Revision Required" ? "warn" : ""))),
          h("td", {}, statusSel(c)),
          h("td", { class: "refcell" }, postCell(c)),
          h("td", { class: "act" }, h("button", { class: "btn sm ghost", type: "button", "aria-label": `Ubah ${c.title}`, onclick: () => openContent(c) }, icon("edit", 16))));
      };
      tableBox.replaceChildren(h("div", { class: "tablewrap plain" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Tanggal", "Konten", "Referensi", "Platform", "Caption", "Status", "Link konten", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, rows.map(tr)))),
      h("p", { class: "muted", style: "margin-top:8px;font-size:13px" }, `${rows.length} dari ${items.length} konten`));
    }

    panels.planner.replaceChildren(
      h("div", { class: "toolbar" },
        h("div", { class: "search" }, icon("search", 16), q),
        sel("status", "Semua status", STATUSES), sel("pillar", "Semua pillar", pillarOpts), sel("platform", "Semua platform", PLATFORMS), month),
      tableBox);
    drawTable();
  }

  /* ---------------- tab 2: Marketing Calendar ---------------- */
  function openDay(date) {
    const dayEvents = events.filter((e) => e.date === date);
    const dayItems = items.filter((c) => c.date === date).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const row = (label, sub, onclick) => h("button", { class: "daylist-row", type: "button", onclick: () => { closeDlg(); onclick(); } }, h("b", {}, label), h("span", {}, sub));
    const closeDlg = dialog({
      title: fmtDay(date),
      body: h("div", { class: "daylist" },
        dayEvents.map((e) => row(e.title, e.kind === "hari-penting" ? "Hari penting" : "Event brand", () => openEvent(e))),
        dayItems.map((c) => row(c.title || "(tanpa judul)", `${c.time || "—"} · ${c.type || ""} · ${c.status || ""}`, () => openContent(c))),
        !dayEvents.length && !dayItems.length && h("p", { class: "muted" }, "Belum ada apa-apa di tanggal ini.")),
      actions: [{ label: "Tutup" }, { label: "Tambah", kind: "primary", onClick: () => { addAt(date); } }],
    });
  }

  function drawCalendar() {
    const { y, m } = S;
    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7; // minggu dimulai Senin
    const days = new Date(y, m + 1, 0).getDate();
    const cells = Math.ceil((offset + days) / 7) * 7;
    const today = ymd(new Date());
    const by = {};
    for (const e of events) (by[e.date] ||= { ev: [], ct: [] }).ev.push(e);
    for (const c of items) if (c.date) (by[c.date] ||= { ev: [], ct: [] }).ct.push(c);

    const go = (delta) => { const d = new Date(y, m + delta, 1); S.y = d.getFullYear(); S.m = d.getMonth(); drawCalendar(); };
    const head = h("div", { class: "cal-head" },
      h("button", { class: "btn sm", type: "button", "aria-label": "Bulan sebelumnya", onclick: () => go(-1) }, icon("left", 16)),
      h("h2", {}, monthLabel(y, m)),
      h("button", { class: "btn sm", type: "button", "aria-label": "Bulan berikutnya", onclick: () => go(1) }, icon("arrow", 16)),
      h("button", { class: "btn sm ghost", type: "button", onclick: () => { const d = new Date(); S.y = d.getFullYear(); S.m = d.getMonth(); drawCalendar(); } }, "Hari ini"),
      h("span", { class: "spacer" }),
      h("button", { class: "btn sm", type: "button", title: "Tahun Baru, Kartini, Kemerdekaan, Natal, dan hari tetap lainnya", onclick: () => guard(async () => {
        const have = new Set(events.map((e) => `${e.date}|${e.title}`));
        const add = FIXED_DAYS.map(([d, mo, t]) => ({ id: newId("e"), title: t, date: `${y}-${pad(mo)}-${pad(d)}`, kind: "hari-penting" })).filter((e) => !have.has(`${e.date}|${e.title}`));
        if (!add.length) { toast(`Hari penting tetap ${y} sudah lengkap.`); return; }
        await Promise.all(add.map((e) => store.saveEvent(brand.id, e)));
        await reload(); redraw(); toast(`${add.length} hari penting ${y} ditambahkan.`);
      }) }, `Isi hari penting ${y}`),
      h("button", { class: "btn sm primary", type: "button", onclick: () => addAt(today.startsWith(`${y}-${pad(m + 1)}`) ? today : `${y}-${pad(m + 1)}-01`) }, icon("plus", 16), "Tambah"));

    const pill = (cls, text, tip, onclick) => h("button", { class: `pill ${cls}`, type: "button", title: tip, onclick }, text);
    const grid = h("div", { class: "cal" }, DOW.map((d) => h("div", { class: "dow" }, d)));
    for (let i = 0; i < cells; i++) {
      const d = new Date(y, m, 1 - offset + i);
      const key = ymd(d);
      const data = by[key] || { ev: [], ct: [] };
      const cts = [...data.ct].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      const all = [
        ...data.ev.map((e) => pill(e.kind === "hari-penting" ? "hp" : "ev", e.title, e.kind === "hari-penting" ? "Hari penting" : "Event brand", () => openEvent(e))),
        ...cts.map((c) => pill(statusKind(c.status), `${c.time ? c.time + " " : ""}${c.title || "(tanpa judul)"}`, `${c.type || ""} · ${c.status || ""}`, () => openContent(c))),
      ];
      const shown = all.slice(0, 3);
      grid.append(h("div", { class: "day" + (d.getMonth() !== m ? " out" : "") + (key === today ? " today" : "") },
        h("span", { class: "num" }, d.getDate()),
        h("button", { class: "add", type: "button", "aria-label": `Tambah di ${fmtDay(key)}`, onclick: () => addAt(key) }, icon("plus", 14)),
        shown,
        all.length > 3 && h("button", { class: "more", type: "button", onclick: () => openDay(key) }, `+${all.length - 3} lagi`)));
    }

    const legend = h("div", { class: "legend" },
      h("span", {}, h("i", { class: "sw" }), "Konten"), h("span", {}, h("i", { class: "sw ok" }), "Approved / Published"),
      h("span", {}, h("i", { class: "sw warn" }), "Perlu revisi / masalah upload"), h("span", {}, h("i", { class: "sw ev" }), "Event brand"), h("span", {}, h("i", { class: "sw hp" }), "Hari penting"));
    panels.calendar.replaceChildren(head, h("div", { class: "calwrap" }, grid), legend,
      h("p", { class: "muted", style: "margin-top:10px;font-size:13px" }, "Kalender dan Content Planner memakai data yang sama: ubah tanggal atau status di salah satunya, yang lain ikut berubah."));
  }

  /* ---------------- tab 3: simulasi feed Instagram ---------------- */
  function drawFeed() {
    const feed = items
      .filter((c) => (c.platforms || []).includes("Instagram") && FEED_TYPES.includes(c.type))
      .sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
      .slice(0, 60);
    const todayKey = ymd(new Date());

    const tile = (c) => {
      const src = coverSrc(c.cover);
      const published = c.status === "Published";
      const el = h("button", {
        class: "tile" + (published ? "" : " plan") + (src ? " img" : ""), type: "button", title: `${c.title} · ${fmtDay(c.date)}`,
        style: src ? `background-image:${cssUrl(src)}` : null, onclick: () => openContent(c),
      },
      h("span", { class: "tb tl" }, fmtShort(c.date)),
      c.type !== "Feed Post" && h("span", { class: "tb tr" }, c.type),
      h("span", { class: "tt" }, c.title || "(tanpa judul)"),
      h("span", { class: "tb bl" }, published ? "Published" : c.date && c.date < todayKey ? `Lewat: ${c.status}` : c.status));
      return el;
    };

    const body = !feed.length
      ? h("div", { class: "empty" }, h("h3", {}, "Belum ada konten untuk feed"),
        h("p", {}, "Tambahkan konten bertipe Feed Post, Carousel, atau Reels dengan platform Instagram. Story tidak ditampilkan karena tidak masuk grid profil."))
      : h("div", { class: "phone" },
        h("div", { class: "phone-top" }, h("span", { class: "badge" }, brand.short || "—"), h("div", {}, h("b", {}, brand.name), h("div", { class: "muted", style: "font-size:12.5px" }, `${feed.length} posting dalam simulasi`))),
        h("div", { class: "feedgrid" }, feed.map(tile)));

    panels.feed.replaceChildren(
      h("p", { class: "muted", style: "margin-bottom:14px;max-width:62ch" }, "Posisi kiri atas adalah posting terbaru, seperti grid profil Instagram. Garis putus-putus berarti belum Published. Ubah tanggal atau jam konten untuk menggeser posisinya."),
      body);
  }

  /* ---------------- rangka halaman ---------------- */
  const TAB_DEFS = [["planner", "Content Planner"], ["calendar", "Marketing Calendar"], ["feed", "Feed Instagram"]];
  function drawTabs() {
    tabsEl.replaceChildren(...TAB_DEFS.map(([k, label]) => h("button", {
      type: "button", role: "tab", "aria-selected": String(S.tab === k),
      onclick: () => { S.tab = k; drawTabs(); },
    }, label)));
    for (const [k, el] of Object.entries(panels)) el.hidden = k !== S.tab;
  }

  redraw();
  drawTabs();

  return {
    crumbs,
    node: h("div", {},
      h("div", { class: "page-head" },
        h("div", { class: "grow" }, h("h1", {}, "Content Plan"),
          h("p", { class: "lead" }, `Rencana konten ${brand.name}: tabel konten, kalender marketing, dan simulasi feed Instagram dalam satu data.`)),
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", onclick: () => openContent(null) }, icon("plus", 16), "Tambah konten"))),
      tabsEl, panels.planner, panels.calendar, panels.feed),
  };
}
