import { h, icon } from "../ui.js";
import { homeCard } from "./jobs.js";
import { homeCard as absenCard } from "./absensi.js";

export async function render(ctx) {
  const { store, user, brand } = ctx;
  const [hb, sops] = await Promise.all([store.listHandbook(), store.listSops()]);
  const general = sops.filter((s) => s.scope !== "brand").length;
  const mine = sops.filter((s) => s.scope === "brand" && s.brandId === brand.id).length;
  const [jobCard, attCard] = await Promise.all([homeCard(ctx), absenCard(ctx)]);
  const first = (user.name || "").split(" ")[0] || "kamu";

  const card = (href, ic, title, text, meta) =>
    h("a", { class: "card link pillar", href },
      h("span", { class: "ic" }, icon(ic, 22)),
      h("h3", {}, title), h("p", {}, text), h("span", { class: "meta" }, meta));

  return {
    crumbs: [{ label: "Beranda" }],
    node: h("div", {},
      h("div", { class: "hello" },
        h("h1", {}, `Halo, ${first}`),
        h("p", {}, `Kamu sedang bekerja di ${brand.name}. Pilih brand lain dari menu di kiri atas kapan saja; Operation akan menyesuaikan.`)),
      h("div", { class: "grid" },
        attCard,
        jobCard,
        card("#/academy", "book", "Academy", "Handbook: istilah, KOL & media, brand guideline, produksi konten, dan perencanaan.", `${hb.length} modul`),
        card("#/system", "flow", "System", "SOP umum untuk semua brand dan SOP khusus tiap brand.", `${general} SOP umum, ${mine} SOP ${brand.short || "brand"}`),
        card("#/ops", "grid", `Operation: ${brand.name}`, "Content Plan, Brand Set Up, Media & KOL, Administrasi & Pengajuan, serta Report.", "5 menu"))),
  };
}
