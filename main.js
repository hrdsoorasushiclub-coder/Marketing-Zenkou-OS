import { firebaseConfig, isConfigured, vapidKey } from "./config.js";
import { createStore } from "./store.js";
import { h, icon, toast, ROLES, isLead } from "./ui.js";
import { authView } from "./views/login.js";
import * as home from "./views/home.js";
import * as academy from "./views/academy.js";
import * as system from "./views/system.js";
import * as ops from "./views/ops.js";
import * as jobs from "./views/jobs.js";
import * as absensi from "./views/absensi.js";
import * as settings from "./views/settings.js";

const app = document.getElementById("app");
const S = { store: null, user: null, all: [], brandId: null };
const BRAND_KEY = "zenkou-os-brand";
const THEME_KEY = "zenkou-os-theme";
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* abaikan */ } };

/* ---------- tema & brand ---------- */
const savedTheme = safeGet(THEME_KEY);
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
const isDark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);

const PLACEHOLDER = { id: "-", name: "Belum ada brand", short: "—", color: "#2f7d5b" };
const allowed = () => {
  const u = S.user;
  if (!u) return [];
  return (u.brands || []).includes("*") ? S.all : S.all.filter((b) => (u.brands || []).includes(b.id));
};
const currentBrand = () => {
  const list = allowed();
  return list.find((b) => b.id === S.brandId) || list[0] || PLACEHOLDER;
};
function paintBrand(b) {
  const hex = (b.color || "#2f7d5b").replace("#", "");
  const n = parseInt(hex.length === 3 ? hex.replace(/./g, "$&$&") : hex, 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  const root = document.documentElement.style;
  root.setProperty("--brand", "#" + hex);
  root.setProperty("--brand-ink", L > 0.45 ? "#111111" : "#ffffff");
}

/* ---------- router ---------- */
const ROUTES = [
  ["/", home.render],
  ["/academy", academy.list],
  ["/academy/new", academy.edit],
  ["/academy/:id", academy.read],
  ["/academy/:id/edit", academy.edit],
  ["/system", system.list],
  ["/system/new", system.edit],
  ["/system/:id", system.read],
  ["/system/:id/edit", system.edit],
  ["/jobs", jobs.render],
  ["/jobs/:tab", jobs.render],
  ["/absensi", absensi.render],
  ["/absensi/:tab", absensi.render],
  ["/ops", ops.overview],
  ["/ops/:slug", ops.page],
  ["/settings/team", settings.team],
  ["/settings/brands", settings.brandsPage],
  ["/settings/data", settings.data],
];

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  return { path: path.replace(/\/+$/, "") || "/", query: new URLSearchParams(qs || "") };
}
function match(path) {
  const parts = path.split("/").filter(Boolean);
  for (const [pattern, handler] of ROUTES) {
    const pp = pattern.split("/").filter(Boolean);
    if (pp.length !== parts.length) continue;
    const params = {};
    let ok = true;
    pp.forEach((seg, i) => { if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(parts[i]); else if (seg !== parts[i]) ok = false; });
    if (ok) return { handler, params };
  }
  return null;
}

let seq = 0;
async function route() {
  if (!S.user) return;
  const view = document.getElementById("view");
  if (!view) return;
  const mine = ++seq;
  const { path, query } = parseHash();
  markNav(path);
  document.body.classList.remove("nav-open");
  const m = match(path);
  const ctx = { store: S.store, user: S.user, brand: currentBrand(), brands: S.all, allowedBrands: allowed(), rerender: route, reloadBrands, query };
  try {
    const res = m
      ? await m.handler(ctx, { ...m.params, query })
      : { crumbs: [{ label: "Tidak ditemukan" }], node: h("div", { class: "empty" }, h("h3", {}, "Halaman tidak ditemukan"), h("a", { class: "btn", href: "#/" }, "Ke beranda")) };
    if (mine !== seq) return;
    drawCrumbs(res.crumbs);
    view.replaceChildren(res.node);
    document.title = `${res.crumbs.at(-1)?.label || "Beranda"} · Zenkou Marketing OS`;
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    if (mine !== seq) return;
    view.replaceChildren(h("div", { class: "notice warn" }, h("b", {}, "Halaman gagal dimuat. "), e.message || String(e)));
  }
}

async function reloadBrands() {
  S.all = await S.store.listBrands();
  S.all.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  paintBrand(currentBrand());
  drawShell();
}

/* ---------- kerangka ---------- */
function navItems() {
  const items = [
    { href: "#/", icon: "home", label: "Beranda", m: (p) => p === "/" },
    { group: "Kerja Harian" },
    ...(isLead(S.user)
      ? [
        { href: "#/jobs", icon: "send", label: "Bagikan Job", m: (p) => p === "/jobs" },
        { href: "#/jobs/history", icon: "history", label: "Riwayat Job", m: (p) => p === "/jobs/history" },
        { href: "#/jobs/kpi", icon: "chart", label: "KPI Tim", m: (p) => p === "/jobs/kpi" },
      ]
      : [
        { href: "#/jobs", icon: "clipboard", label: "Job Hari Ini", m: (p) => p === "/jobs" },
        { href: "#/jobs/history", icon: "history", label: "Riwayat & KPI Saya", m: (p) => p === "/jobs/history" },
      ]),
    { href: "#/absensi", icon: "clock", label: isLead(S.user) ? "Absensi Hari Ini" : "Absensi", m: (p) => p === "/absensi" },
    { href: "#/absensi/history", icon: "history", label: "Riwayat Absensi", m: (p) => p === "/absensi/history" },
    ...(isLead(S.user) ? [{ href: "#/absensi/recap", icon: "chart", label: "Rekap Absensi", m: (p) => p === "/absensi/recap" }] : []),
    { group: "Academy" },
    { href: "#/academy", icon: "book", label: "Handbook", m: (p) => p.startsWith("/academy") },
    { group: "System" },
    { href: "#/system", icon: "flow", label: "SOP", m: (p) => p.startsWith("/system") },
    { group: "Operation" },
    { href: "#/ops/content-plan", icon: "calendar", label: "Content Plan", m: (p) => p === "/ops/content-plan" },
    { href: "#/ops/brand-setup", icon: "palette", label: "Brand Set Up", m: (p) => p === "/ops/brand-setup" },
    { href: "#/ops/media-kol", icon: "megaphone", label: "Media & KOL", m: (p) => p === "/ops/media-kol" },
    { href: "#/ops/administrasi", icon: "wallet", label: "Administrasi & Pengajuan", m: (p) => p === "/ops/administrasi" },
    { href: "#/ops/report", icon: "chart", label: "Report", m: (p) => p === "/ops/report" },
  ];
  if (isLead(S.user)) {
    items.push(
      { group: "Pengaturan" },
      { href: "#/settings/team", icon: "users", label: "Tim", m: (p) => p === "/settings/team" },
      { href: "#/settings/brands", icon: "tag", label: "Brand", m: (p) => p === "/settings/brands" },
      { href: "#/settings/data", icon: "db", label: "Data & koneksi", m: (p) => p === "/settings/data" }
    );
  }
  return items;
}
let currentItems = [];
function markNav(path) {
  document.querySelectorAll(".nav a").forEach((a) => {
    const it = currentItems.find((x) => x.href === a.getAttribute("href"));
    if (it?.m(path)) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

function brandSwitch() {
  const b = currentBrand();
  const list = allowed();
  const wrap = h("div", { class: "brand-switch" });
  const btn = h("button", { class: "brand-plate", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": `Brand aktif: ${b.name}. Ganti brand` },
    h("span", { class: "badge" }, b.short), h("div", {}, h("div", { class: "nm" }, b.name), h("div", { class: "sub" }, "Brand aktif")),
    list.length > 1 && icon("chevron", 18));
  wrap.append(btn);
  if (list.length > 1) {
    let menu = null;
    const close = () => { menu?.remove(); menu = null; btn.setAttribute("aria-expanded", "false"); document.removeEventListener("click", outside, true); };
    const outside = (e) => { if (!wrap.contains(e.target)) close(); };
    btn.onclick = () => {
      if (menu) return close();
      menu = h("div", { class: "brand-menu", role: "listbox" }, list.map((x) =>
        h("button", { type: "button", role: "option", "aria-current": String(x.id === b.id), onclick: () => { S.brandId = x.id; safeSet(BRAND_KEY, x.id); close(); paintBrand(x); drawShell(); route(); } },
          h("span", { class: "dot", style: `background:${x.color}` }), x.name)));
      wrap.append(menu); btn.setAttribute("aria-expanded", "true");
      setTimeout(() => document.addEventListener("click", outside, true));
    };
  }
  return wrap;
}

function drawShell() {
  currentItems = navItems();
  const nav = h("nav", { class: "nav", "aria-label": "Menu utama" });
  let group = null;
  for (const it of currentItems) {
    if (it.group) { group = h("div", { class: "nav-group" }, h("div", { class: "gl" }, it.group)); nav.append(group); continue; }
    const a = h("a", { href: it.href }, icon(it.icon, 18), it.label, it.soon && h("span", { class: "soon" }, "segera"));
    (group || nav).append(a);
  }
  const side = h("aside", { class: "side" },
    h("div", { class: "wordmark" }, h("span", { class: "mark" }, "Z"), h("div", {}, "Zenkou", h("small", {}, "Marketing OS"))),
    brandSwitch(), nav,
    h("div", { class: "side-foot" },
      h("div", { class: "who" }, h("b", {}, S.user.name), h("span", {}, ROLES[S.user.role] || S.user.role)),
      h("button", { type: "button", "aria-label": "Keluar", title: "Keluar", onclick: () => S.store.signOut() }, icon("logout", 16))));

  const crumbs = h("nav", { class: "crumbs", id: "crumbs", "aria-label": "Lokasi" });
  const top = h("header", { class: "topbar" },
    h("button", { class: "btn sm menu-btn", type: "button", "aria-label": "Buka menu", onclick: () => document.body.classList.toggle("nav-open") }, icon("menu", 18)),
    crumbs, h("span", { class: "spacer" }),
    S.store.mode === "demo" && h("a", { class: "chip warn mode-pill", href: "#/settings/data", title: "Data hanya tersimpan di browser ini" }, "Mode demo"),
    h("button", { class: "btn sm ghost", type: "button", "aria-label": "Ganti tema terang atau gelap", onclick: () => {
      const next = isDark() ? "light" : "dark";
      document.documentElement.dataset.theme = next; safeSet(THEME_KEY, next);
    } }, icon("moon", 17)));
  const prevView = document.getElementById("view");
  const view = prevView || h("main", { class: "view", id: "view", tabindex: "-1" });
  app.replaceChildren(h("div", { class: "app" }, side, h("div", { class: "main" }, top, view)));
  markNav(parseHash().path);
}

function drawCrumbs(list) {
  const box = document.getElementById("crumbs");
  if (!box) return;
  box.replaceChildren(...list.flatMap((c, i) => {
    const last = i === list.length - 1;
    const el = c.href && !last ? h("a", { href: c.href }, c.label) : h("span", { class: last ? "cur" : "" }, c.label);
    return i ? [h("span", { "aria-hidden": "true" }, "/"), el] : [el];
  }));
}

/* ---------- siklus masuk / keluar ---------- */
async function onAuth(a) {
  if (!a.user) { S.user = null; seq++; app.replaceChildren(authView(S.store, a)); return; }
  S.user = a.user;
  try {
    S.all = (await S.store.listBrands()).sort((x, y) => String(x.name).localeCompare(String(y.name)));
  } catch (e) {
    app.replaceChildren(h("div", { class: "view" }, h("div", { class: "notice warn" }, h("b", {}, "Data gagal dimuat. "), e.message)));
    return;
  }
  S.brandId = safeGet(BRAND_KEY);
  paintBrand(currentBrand());
  drawShell();
  route();
  // Segarkan token pengingat HP dan tampilkan pesan bila web sedang terbuka saat pengingat masuk.
  S.store.pushResume?.(vapidKey, (d) => { toast([d.title, d.body].filter(Boolean).join(" · ")); try { navigator.vibrate?.([300, 120, 300]); } catch { /* abaikan */ } });
}

window.addEventListener("hashchange", route);
// Ketuk area gelap di luar menu (HP) untuk menutup menu.
document.addEventListener("click", (e) => { if (e.target === document.body) document.body.classList.remove("nav-open"); });

(async function boot() {
  try {
    S.store = await createStore(firebaseConfig, isConfigured);
    S.store.onAuth(onAuth);
  } catch (e) {
    console.error(e);
    app.replaceChildren(h("div", { style: "padding:32px;max-width:560px;font-family:system-ui" },
      h("h2", {}, "Web belum bisa dimulai"),
      h("p", {}, "Koneksi ke Firebase gagal. Periksa koneksi internet dan isi js/config.js."),
      h("pre", { style: "white-space:pre-wrap" }, e.message || String(e))));
  }
})();
