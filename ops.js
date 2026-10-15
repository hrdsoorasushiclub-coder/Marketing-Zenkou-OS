import { h, icon } from "../ui.js";
import * as content from "./content.js";
import * as setup from "./setup.js";
import * as kol from "./kol.js";
import * as admin from "./admin.js";
import * as report from "./report.js";

// Rencana menu Operation System. Isinya mengikuti rancangan: dibangun bertahap per bagian.
export const OPS = [
  {
    slug: "content-plan", title: "Content Plan", icon: "calendar", part: 2, ready: true,
    summary: "Content Planner dan Marketing Calendar yang saling terhubung.",
    sections: [
      { title: "Content Planner", items: ["Input dan tampilan tabel konten", "Referensi konten", "Tanggal dan jam upload", "Caption, lengkap dengan approval caption", "Platform upload, pillar, dan tipe konten", "Status konten (Planned sampai Published)"] },
      { title: "Marketing Calendar", items: ["Pemetaan tanggal konten, event, dan hari penting", "Simulasi posisi konten di feed Instagram", "Terhubung dengan Content Planner: ubah di satu sisi, sisi lain ikut berubah"] },
    ],
  },
  {
    slug: "brand-setup", title: "Brand Set Up", icon: "palette", part: 3, ready: true,
    summary: "Brand guideline, template, dan opening kit untuk tiap brand.",
    sections: [
      { title: "Brand Guideline", items: ["Logo dan versinya", "Color palette", "Tipografi dan brand character", "Aset brand tersimpan di satu tempat"] },
      { title: "Template", items: ["Template yang bisa disesuaikan per brand"] },
      { title: "Opening Kit", items: ["Bridging dan content plan, hiring, properti meja dan kasir", "Form out, T-banner dan signage, pendukung (Spotify, Google Maps, sign)", "Media & KOL tidak masuk di sini karena punya menu sendiri"] },
    ],
  },
  {
    slug: "media-kol", title: "Media & KOL", icon: "megaphone", part: 4, ready: true,
    summary: "Campaign KOL paid dan barter, database, template approach, absensi, dan reporting.",
    sections: [
      { title: "Campaign KOL baru", items: ["Paid: nama KOL, kolom ER, rank, dan pricelist", "Barter: nama KOL dan status persetujuan"] },
      { title: "Pengelolaan", items: ["Database campaign yang sedang berjalan", "Template approach yang bisa disesuaikan", "Absensi kunjungan KOL", "Reporting performa KOL"] },
    ],
  },
  {
    slug: "report", title: "Report", icon: "chart", part: 6, ready: true,
    summary: "Report kuartal (Q1 sampai Q4) dan tahunan, terhubung langsung ke Instagram lewat API.",
    sections: [
      { title: "Periode", items: ["Q1, Q2, Q3, Q4, dan Tahunan", "Perbandingan dengan periode sebelumnya"] },
      { title: "Isi report", items: ["Instagram: reach, views, interaksi, ER, followers", "Realisasi Content Plan", "Hasil Media & KOL", "Unduh CSV dan cetak PDF"] },
    ],
  },
  {
    slug: "administrasi", title: "Administrasi & Pengajuan", icon: "wallet", part: 5, ready: true,
    summary: "RAB, database lisensi, dan data penawaran.",
    sections: [
      { title: "Isi menu", items: ["RAB (rencana anggaran biaya)", "Database lisensi, kolom bisa disesuaikan", "Data penawaran"] },
    ],
  },
];

export async function overview(ctx) {
  const { brand } = ctx;
  return {
    crumbs: [{ label: "Operation" }, { label: brand.name }],
    node: h("div", {},
      h("div", { class: "page-head" },
        h("div", { class: "grow" },
          h("h1", {}, `Operation: ${brand.name}`),
          h("p", { class: "lead" }, "Ruang kerja harian brand ini. Setiap brand punya data sendiri, jadi Content Plan Soora tidak bercampur dengan Bulan Purnama."))),
      h("div", { class: "grid two" }, OPS.map((o) =>
        h("a", { class: "card link pillar", href: `#/ops/${o.slug}` },
          h("span", { class: "ic" }, icon(o.icon, 22)),
          h("h3", {}, o.title), h("p", {}, o.summary),
          h("span", { class: "meta" }, o.ready ? "Aktif" : `Dibangun di Bagian ${o.part}`))))),
  };
}

export async function page(ctx, { slug }) {
  if (slug === "content-plan") return content.render(ctx);
  if (slug === "brand-setup") return setup.render(ctx);
  if (slug === "media-kol") return kol.render(ctx);
  if (slug === "administrasi") return admin.render(ctx);
  if (slug === "report") return report.render(ctx);
  const { brand } = ctx;
  const o = OPS.find((x) => x.slug === slug);
  if (!o) return { crumbs: [{ label: "Operation", href: "#/ops" }], node: h("div", { class: "empty" }, h("h3", {}, "Menu tidak ditemukan")) };
  return {
    crumbs: [{ label: "Operation", href: "#/ops" }, { label: brand.name }, { label: o.title }],
    node: h("div", { style: "max-width:820px" },
      h("div", { class: "page-head" },
        h("div", { class: "grow" }, h("h1", {}, o.title), h("p", { class: "lead" }, o.summary)),
        h("span", { class: "chip warn" }, `Dibangun di Bagian ${o.part}`)),
      h("div", { class: "notice warn", style: "margin-bottom:20px" }, h("b", {}, "Menu ini belum aktif. "), `Berikut rancangan isinya untuk ${brand.name}; semua data akan tersimpan terpisah per brand.`),
      h("div", { class: "grid two" }, o.sections.map((sec) =>
        h("div", { class: "card" }, h("h3", { style: "font-size:17px;margin-bottom:10px" }, sec.title),
          h("ul", { style: "margin:0;padding-left:1.2em;display:grid;gap:6px;color:var(--ink-2)" }, sec.items.map((i) => h("li", {}, i))))))),
  };
}
