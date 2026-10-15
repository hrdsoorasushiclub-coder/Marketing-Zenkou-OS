import { h, icon, toast, confirmDialog, fmtDate, isLead } from "../ui.js";
import { render as md, slug, plainText } from "../md.js";

export async function list(ctx) {
  const { store, user } = ctx;
  const modules = await store.listHandbook();
  const q = h("input", { class: "input", type: "search", placeholder: "Cari di handbook (misalnya ER, barter, logo)", "aria-label": "Cari di handbook" });
  const box = h("div", { class: "modlist" });
  const plain = new Map(modules.map((m) => [m.id, (m.title + " " + m.summary + " " + plainText(m.body)).toLowerCase()]));

  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const rows = modules.filter((m) => !term || plain.get(m.id).includes(term));
    box.replaceChildren(
      ...(rows.length
        ? rows.map((m) =>
            h("a", { class: "card link mod", href: `#/academy/${m.id}` },
              h("span", { class: "no" }, m.order ?? ""),
              h("div", {}, h("h3", {}, m.title), h("p", {}, m.summary)),
              h("span", { class: "go" }, `${m.minutes || "?"} menit baca`)))
        : [h("div", { class: "empty" }, h("h3", {}, "Tidak ada yang cocok"), h("p", {}, "Coba kata kunci lain, misalnya istilah dari Kamus Marketing."))])
    );
    if (!modules.length) box.replaceChildren(h("div", { class: "empty" }, h("h3", {}, "Handbook masih kosong"),
      h("p", {}, isLead(user) ? "Muat handbook awal dari Pengaturan > Data & koneksi, atau tambahkan modul baru." : "Minta Supervisor memuat handbook.")));
  };
  q.addEventListener("input", draw);
  draw();

  return {
    crumbs: [{ label: "Academy" }],
    node: h("div", {},
      h("div", { class: "page-head" },
        h("div", { class: "grow" }, h("h1", {}, "Handbook"), h("p", { class: "lead" }, "Pengetahuan marketing yang dipakai tim: apa artinya, kapan dipakai, dan standar yang berlaku.")),
        isLead(user) && h("div", { class: "actions" }, h("a", { class: "btn", href: "#/academy/new" }, icon("plus"), "Tambah modul"))),
      h("div", { class: "search" }, icon("search", 17), q),
      box),
  };
}

export async function read(ctx, { id }) {
  const { store, user } = ctx;
  const modules = await store.listHandbook();
  const idx = modules.findIndex((m) => m.id === id);
  if (idx < 0) return notFound();
  const m = modules[idx];
  const { html, toc } = md(m.body);
  const prev = modules[idx - 1], next = modules[idx + 1];

  const tocBox = h("nav", { class: "toc", "aria-label": "Isi halaman" }, h("b", {}, "Di halaman ini"),
    toc.map((t) => h("a", { class: "l" + t.level, href: `#/academy/${id}`, "data-id": t.id, onclick: (e) => {
      e.preventDefault(); document.getElementById(t.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } }, t.text)));

  const body = h("div", { class: "prose", html });
  setTimeout(() => {
    const links = [...tocBox.querySelectorAll("a")];
    const obs = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { links.forEach((a) => a.classList.toggle("on", a.dataset.id === e.target.id)); }
    }, { rootMargin: "-80px 0px -70% 0px" });
    body.querySelectorAll("h2, h3").forEach((el) => obs.observe(el));
  });

  return {
    crumbs: [{ label: "Academy", href: "#/academy" }, { label: m.title }],
    node: h("div", { class: "reader" },
      h("article", { class: "article" },
        h("h1", {}, m.title),
        h("p", { class: "lede" }, m.summary),
        h("div", { class: "chips", style: "margin-bottom:22px" },
          h("span", { class: "chip" }, `${m.minutes || "?"} menit baca`),
          m.updatedAt && h("span", { class: "chip" }, `Diperbarui ${fmtDate(m.updatedAt)}`),
          isLead(user) && h("a", { class: "btn sm", href: `#/academy/${id}/edit` }, icon("edit", 15), "Edit modul")),
        body,
        h("div", { class: "pager" },
          prev ? h("a", { href: `#/academy/${prev.id}` }, h("small", {}, "Sebelumnya"), h("b", {}, prev.title)) : h("span"),
          next && h("a", { class: "next", href: `#/academy/${next.id}` }, h("small", {}, "Berikutnya"), h("b", {}, next.title)))),
      tocBox),
  };
}

export async function edit(ctx, { id }) {
  const { store, user } = ctx;
  if (!isLead(user)) return forbidden();
  const modules = await store.listHandbook();
  const isNew = !id || id === "new";
  const m = isNew
    ? { id: "", order: modules.length + 1, title: "", summary: "", minutes: 5, body: "" }
    : modules.find((x) => x.id === id);
  if (!m) return notFound();

  const f = {
    title: h("input", { class: "input", id: "t", value: m.title }),
    summary: h("input", { class: "input", id: "s", value: m.summary }),
    order: h("input", { class: "input", id: "o", type: "number", min: 1, value: m.order }),
    minutes: h("input", { class: "input", id: "mn", type: "number", min: 1, value: m.minutes }),
    body: h("textarea", { class: "textarea code", id: "b", spellcheck: "true" }, m.body),
  };
  const preview = h("div", { class: "prose" });
  const drawPreview = () => { preview.innerHTML = md(f.body.value).html; };
  f.body.addEventListener("input", drawPreview);
  drawPreview();

  const save = async () => {
    const title = f.title.value.trim();
    if (!title) { toast("Judul modul wajib diisi.", "err"); return; }
    const next = { ...m, id: m.id || slug(title), title, summary: f.summary.value.trim(), order: Number(f.order.value) || 1, minutes: Number(f.minutes.value) || 5, body: f.body.value };
    if (isNew && modules.some((x) => x.id === next.id)) { toast("Sudah ada modul dengan judul serupa.", "err"); return; }
    await store.saveHandbook(next);
    toast("Modul tersimpan.");
    location.hash = `#/academy/${next.id}`;
  };
  const del = async () => {
    if (!(await confirmDialog(`Hapus modul "${m.title}"? Tindakan ini tidak bisa dibatalkan.`, "Hapus modul"))) return;
    await store.deleteHandbook(m.id);
    toast("Modul dihapus.");
    location.hash = "#/academy";
  };

  return {
    crumbs: [{ label: "Academy", href: "#/academy" }, { label: isNew ? "Modul baru" : m.title, href: isNew ? null : `#/academy/${m.id}` }, { label: "Edit" }],
    node: h("div", {},
      h("div", { class: "page-head" },
        h("div", { class: "grow" }, h("h1", {}, isNew ? "Modul baru" : "Edit modul")),
        h("div", { class: "actions" },
          !isNew && h("button", { class: "btn danger", type: "button", onclick: del }, icon("trash", 16), "Hapus"),
          h("a", { class: "btn", href: isNew ? "#/academy" : `#/academy/${m.id}` }, "Batal"),
          h("button", { class: "btn primary", type: "button", onclick: save }, icon("check", 16), "Simpan"))),
      h("div", { class: "row" },
        h("div", { class: "field", style: "flex:3 1 280px" }, h("label", { for: "t" }, "Judul"), f.title),
        h("div", { class: "field", style: "flex:1 1 90px" }, h("label", { for: "o" }, "Urutan"), f.order),
        h("div", { class: "field", style: "flex:1 1 90px" }, h("label", { for: "mn" }, "Menit baca"), f.minutes)),
      h("div", { class: "field" }, h("label", { for: "s" }, "Ringkasan"), f.summary),
      h("div", { class: "editor" },
        h("div", { class: "field" }, h("label", { for: "b" }, "Isi (markdown)"), f.body,
          h("span", { class: "hint" }, "Judul bagian: ## Judul. Daftar: - item atau 1. item. Tabel: | A | B |. Centang: - [ ] tugas. Tebal: **teks**.")),
        h("div", { class: "field" }, h("span", { class: "lbl" }, "Pratinjau"), h("div", { class: "card preview" }, preview)))),
  };
}

const notFound = () => ({ crumbs: [{ label: "Academy", href: "#/academy" }], node: h("div", { class: "empty" }, h("h3", {}, "Modul tidak ditemukan"), h("a", { class: "btn", href: "#/academy" }, "Kembali ke Handbook")) });
const forbidden = () => ({ crumbs: [{ label: "Academy", href: "#/academy" }], node: h("div", { class: "empty" }, h("h3", {}, "Hanya Supervisor dan Executive yang bisa mengedit"), h("a", { class: "btn", href: "#/academy" }, "Kembali")) });
