// Job Harian.
//  - Supervisor/Executive: membagikan job per hari ke tiap member (dikelompokkan per section = peran),
//    memantau progres, memberi review, melihat riwayat dan KPI.
//  - Member: melihat job hari ini beserta checklist, mencentang, menulis catatan hasil, melihat riwayat sendiri.
// Data: brands/{brandId}/job_assignments (satu dokumen per job per orang) lewat store.listSub/saveSub/deleteSub,
// sehingga aturan Firestore yang sudah ada untuk brands/{brandId}/{sub} tetap berlaku.
// Riwayat tiap job disimpan di dalam dokumennya (field "log"); KPI dihitung dari dokumen-dokumen itu.

import { h, icon, toast, dialog, confirmDialog, ROLES, isLead } from "../ui.js";
import { pushCard, remindDialog } from "./push.js";

const COL = "job_assignments";
const PRIORITY = ["Normal", "Penting", "Urgent"];
const SCORES = [[5, "5 · Sangat baik"], [4, "4 · Baik"], [3, "3 · Cukup"], [2, "2 · Kurang"], [1, "1 · Buruk"]];
// Bobot skor KPI (total tidak harus 100; dinormalkan). Komponen yang belum punya data (mis. belum ada review) dilewati.
export const KPI_WEIGHTS = { done: 50, ontime: 30, review: 20 };
const RANGES = [["7", "7 hari terakhir"], ["30", "30 hari terakhir"], ["month", "Bulan ini"], ["lastmonth", "Bulan lalu"], ["quarter", "Kuartal ini"], ["custom", "Kustom"]];
const STATUS_FILTER = [["", "Semua status"], ["Selesai", "Selesai"], ["Menunggu review", "Menunggu review"], ["Berjalan", "Berjalan"], ["Belum mulai", "Belum mulai"], ["Tertunda", "Tertunda (lewat tanggal)"], ["Dibatalkan", "Dibatalkan"]];

// Pilihan filter yang diingat selama sesi supaya tidak reset tiap render.
const UI = { date: null, brand: "", hist: { range: "30", from: "", to: "", uid: "", brand: "", status: "" }, kpi: { range: "month", from: "", to: "", brand: "", role: "" } };

/* ---------- waktu ---------- */
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const parseYmd = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const longDay = (s) => parseYmd(s).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = (s) => (s ? parseYmd(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—");
const hm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const stamp = (iso) => (iso ? `${shortDay(ymd(new Date(iso)))}, ${hm(iso)}` : "—");
const nowIso = () => new Date().toISOString();
const newId = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function rangeOf(key, from, to) {
  const t = todayStr(), d = new Date();
  if (key === "7") return [addDays(t, -6), t];
  if (key === "30") return [addDays(t, -29), t];
  if (key === "month") return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  if (key === "lastmonth") return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))];
  if (key === "quarter") { const q = Math.floor(d.getMonth() / 3); return [ymd(new Date(d.getFullYear(), q * 3, 1)), ymd(new Date(d.getFullYear(), q * 3 + 3, 0))]; }
  return [from || addDays(t, -29), to || t];
}

/* ---------- aturan job ---------- */
const itemsOf = (j) => j.items || [];
const doneCount = (j) => itemsOf(j).filter((i) => i.done).length;
const isDone = (j) => itemsOf(j).length > 0 && doneCount(j) === itemsOf(j).length;
const isOverdue = (j, t = todayStr()) => !j.cancelled && !isDone(j) && j.date < t;
const statusOf = (j) => (j.cancelled ? "Dibatalkan" : isDone(j) ? "Selesai" : doneCount(j) > 0 ? "Berjalan" : "Belum mulai");
const statusKind = (s) => (s === "Selesai" ? "ok" : s === "Berjalan" ? "brand" : s === "Dibatalkan" ? "warn" : "");
const sectionOf = (j) => ROLES[j.role] || j.role || "—";
// Tepat waktu: selesai (pertama kali) pada atau sebelum tanggal job, dan sebelum jam batas bila ada. Revisi tidak mengubah ini.
const onTime = (j) => {
  if (!j.firstCompletedAt) return null;
  const d = ymd(new Date(j.firstCompletedAt));
  if (d < j.date) return true;
  if (d > j.date) return false;
  return !j.dueTime || hm(j.firstCompletedAt) <= j.dueTime;
};
const timing = (j) => (j.cancelled ? "" : isDone(j) ? (onTime(j) === false ? "Terlambat" : "Tepat waktu") : isOverdue(j) ? "Tertunda" : "");
const prioRank = (j) => PRIORITY.length - 1 - Math.max(0, PRIORITY.indexOf(j.priority || "Normal"));
const byPrio = (a, b) => prioRank(a) - prioRank(b) || String(a.dueTime || "99:99").localeCompare(String(b.dueTime || "99:99")) || String(a.title).localeCompare(String(b.title));

const log = (j, by, act, txt = "") => {
  (j.log ||= []).push({ at: nowIso(), by, act, txt });
  if (j.log.length > 300) j.log.splice(0, j.log.length - 300);
};
// Menyesuaikan penanda selesai setelah checklist berubah.
function settle(j, by) {
  if (isDone(j) && !j.completedAt) {
    j.completedAt = nowIso(); j.firstCompletedAt ||= j.completedAt;
    log(j, by, "Selesai", "Semua checklist tercentang");
  } else if (!isDone(j) && j.completedAt) {
    j.completedAt = null; log(j, by, "Dibuka kembali", "Checklist belum lengkap lagi");
  }
}

/* ---------- data ---------- */
async function loadJobs(ctx, brandIds) {
  const errs = [];
  const lists = await Promise.all(brandIds.map(async (id) => {
    try { return (await ctx.store.listSub(id, COL)).map((j) => ({ ...j, brandId: id })); } catch (e) { errs.push(e); return []; }
  }));
  if (errs.length && errs.length === brandIds.length) throw errs[0];
  return lists.flat();
}
// Baca ulang dokumen sebelum mengubah, supaya centang member dan edit supervisor tidak saling menimpa.
async function mutate(ctx, job, fn) {
  const cur = (await ctx.store.listSub(job.brandId, COL)).find((x) => x.id === job.id);
  if (!cur) throw new Error("Job ini sudah dihapus.");
  cur.brandId = job.brandId;
  fn(cur);
  await ctx.store.saveSub(job.brandId, COL, cur);
  return cur;
}
const brandOf = (ctx, id) => ctx.brands.find((b) => b.id === id) || { id, name: id, short: id, color: "#888" };

/* ---------- KPI ---------- */
function kpi(list, t = todayStr()) {
  const js = list.filter((j) => !j.cancelled && j.date <= t);
  const done = js.filter(isDone);
  const pending = js.filter((j) => isOverdue(j, t));
  const ot = done.filter((j) => onTime(j) === true).length;
  const iAll = js.reduce((s, j) => s + itemsOf(j).length, 0);
  const iDone = js.reduce((s, j) => s + doneCount(j), 0);
  const rv = js.filter((j) => j.review?.score);
  const reviewAvg = rv.length ? rv.reduce((s, j) => s + j.review.score, 0) / rv.length : null;
  const doneRate = done.length + pending.length ? (done.length / (done.length + pending.length)) * 100 : null;
  const onTimeRate = done.length ? (ot / done.length) * 100 : null;
  const comps = [[KPI_WEIGHTS.done, doneRate], [KPI_WEIGHTS.ontime, onTimeRate], [KPI_WEIGHTS.review, reviewAvg == null ? null : (reviewAvg / 5) * 100]].filter((c) => c[1] != null);
  const wsum = comps.reduce((s, c) => s + c[0], 0);
  return {
    total: js.length, done: done.length, onTime: ot, late: done.length - ot, pending: pending.length,
    running: js.length - done.length - pending.length, revisions: js.reduce((s, j) => s + (j.revisions || 0), 0),
    checklist: iAll ? (iDone / iAll) * 100 : null, doneRate, onTimeRate, reviewAvg, reviewed: rv.length,
    score: comps.length ? comps.reduce((s, c) => s + c[0] * c[1], 0) / wsum : null,
  };
}

/* ---------- potongan tampilan ---------- */
// replaceChildren yang membuang null/false (DOM biasa akan menulisnya sebagai teks "null").
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const chip = (t, k = "") => h("span", { class: "chip" + (k ? " " + k : "") }, t);
const pct = (v) => (v == null ? "—" : Math.round(v) + "%");
const stars = (n) => (n ? "★".repeat(n) + "☆".repeat(5 - n) : "—");
const bar = (v) => h("div", { class: "jb-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(v || 0)) }, h("i", { style: `width:${Math.max(0, Math.min(100, v || 0))}%` }));
const stat = (label, value, sub) => h("div", { class: "kstat" }, h("div", { class: "kv" }, value), h("div", { class: "kl" }, label), sub && h("div", { class: "ks" }, sub));
const brandChip = (ctx, id) => { const b = brandOf(ctx, id); return h("span", { class: "chip" }, h("span", { class: "jb-dot", style: `background:${b.color}` }), b.short || b.name); };
const safeHref = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };
const sel = (options, cur, attrs = {}) => h("select", { class: "select", ...attrs }, options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h("option", { value: v, selected: v === cur }, l); }));
const scoreKind = (s) => (s == null ? "" : s >= 85 ? "ok" : s >= 65 ? "" : "warn");
const timingChip = (j) => { const t = timing(j); return t ? chip(t, t === "Tepat waktu" ? "ok" : "warn") : null; };

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

/* ====================================================================== */
/*  Router                                                                 */
/* ====================================================================== */
export async function render(ctx, p = {}) {
  const lead = isLead(ctx.user);
  const tab = p.tab || "today";
  if (!ctx.allowedBrands.length) {
    return { crumbs: [{ label: "Kerja Harian" }], node: h("div", { class: "empty" }, h("h3", {}, "Belum ada brand"), h("p", {}, lead ? "Tambahkan brand lebih dulu di Pengaturan > Brand." : "Minta supervisor memberi akses brand ke akunmu.")) };
  }
  if (tab === "history") return history(ctx, p.query, lead);
  if (tab === "kpi" && lead) return kpiPage(ctx);
  return lead ? board(ctx) : memberToday(ctx);
}

// Kartu kecil untuk Beranda.
export async function homeCard(ctx) {
  try {
    if (!ctx.allowedBrands.length) return null;
    const lead = isLead(ctx.user), t = todayStr();
    const jobs = (await loadJobs(ctx, ctx.allowedBrands.map((b) => b.id))).filter((j) => !j.cancelled);
    let meta;
    if (lead) {
      const d = jobs.filter((j) => j.date === t);
      meta = d.length ? `${d.length} job hari ini · ${d.filter(isDone).length} selesai` : "Belum ada job dibagikan hari ini";
    } else {
      const mine = jobs.filter((j) => j.assigneeUid === ctx.user.uid);
      const d = mine.filter((j) => j.date === t), late = mine.filter((j) => isOverdue(j, t)).length;
      meta = d.length ? `${d.reduce((s, j) => s + doneCount(j), 0)}/${d.reduce((s, j) => s + itemsOf(j).length, 0)} checklist hari ini` : "Belum ada job hari ini";
      if (late) meta += ` · ${late} tertunda`;
    }
    return h("a", { class: "card link pillar", href: "#/jobs" }, h("span", { class: "ic" }, icon(lead ? "send" : "clipboard", 22)),
      h("h3", {}, lead ? "Bagikan Job" : "Job Hari Ini"), h("p", {}, lead ? "Bagi tugas harian per section, pantau progres, dan lihat KPI tim." : "Daftar tugas dan checklist yang dibagikan supervisor untukmu hari ini."), h("span", { class: "meta" }, meta));
  } catch { return null; }
}

/* ====================================================================== */
/*  MEMBER: job hari ini                                                   */
/* ====================================================================== */
async function memberToday(ctx) {
  const { user } = ctx;
  const t = todayStr();
  let jobs = (await loadJobs(ctx, ctx.allowedBrands.map((b) => b.id))).filter((j) => j.assigneeUid === user.uid && !j.cancelled);
  const body = h("div");
  const sum = h("div", { class: "jb-sum" });

  const replace = (upd) => { jobs = jobs.map((j) => (j.id === upd.id ? { ...upd, brandId: j.brandId } : j)); paint(); };

  const card = (job) => {
    const done = isDone(job), late = isOverdue(job, t);
    const toggle = async (it, btn) => {
      btn.disabled = true;
      try {
        const upd = await mutate(ctx, job, (cur) => {
          if (cur.cancelled) throw new Error("Job ini sudah dibatalkan supervisor.");
          const x = (cur.items || []).find((i) => i.id === it.id);
          if (!x) return;
          x.done = !x.done; x.doneAt = x.done ? nowIso() : null;
          log(cur, user.name, x.done ? "Centang" : "Batal centang", x.text);
          settle(cur, user.name);
        });
        replace(upd);
        if (isDone(upd) && !isDone(job)) toast("Job selesai. Mantap!");
      } catch (e) { toast(e.message || String(e), "err"); btn.disabled = false; }
    };
    const resultDialog = () => {
      const note = h("textarea", { class: "textarea", id: "jb-note", rows: 4, placeholder: "Apa yang sudah dikerjakan, kendala, atau hal yang perlu dicek supervisor." }, job.notes || "");
      const link = h("input", { class: "input", id: "jb-rl", type: "url", placeholder: "https://… (folder hasil, link postingan, dsb.)", value: job.resultLink || "" });
      dialog({
        title: "Catatan & hasil",
        body: h("div", {}, h("div", { class: "field" }, h("label", { for: "jb-note" }, "Catatan"), note), h("div", { class: "field" }, h("label", { for: "jb-rl" }, "Link hasil"), link)),
        actions: [{ label: "Batal" }, { label: "Simpan", kind: "primary", onClick: async () => {
          if (link.value.trim() && !safeHref(link.value.trim())) throw new Error("Link harus diawali http:// atau https://");
          const upd = await mutate(ctx, job, (cur) => { cur.notes = note.value.trim(); cur.resultLink = link.value.trim(); log(cur, user.name, "Catatan hasil diperbarui"); });
          replace(upd); toast("Tersimpan.");
        } }],
      });
    };
    const ref = safeHref(job.link || ""), res = safeHref(job.resultLink || "");
    return h("article", { class: "jb-card" + (done ? " done" : late ? " late" : "") },
      h("div", { class: "jb-head" },
        h("div", { class: "grow" },
          h("h3", {}, job.title),
          h("div", { class: "chips" }, brandChip(ctx, job.brandId), chip(statusOf(job), statusKind(statusOf(job))), job.priority && job.priority !== "Normal" && chip(job.priority, job.priority === "Urgent" ? "warn" : "brand"),
            job.dueTime && chip("Batas " + job.dueTime), late && chip("Tertunda dari " + shortDay(job.date), "warn"), done && timingChip(job))),
        h("span", { class: "muted jb-count" }, `${doneCount(job)}/${itemsOf(job).length}`)),
      job.brief && h("p", { class: "jb-brief" }, job.brief),
      ref && h("a", { class: "refl", href: ref, target: "_blank", rel: "noopener" }, "Buka referensi"),
      h("ul", { class: "jb-items" }, itemsOf(job).map((it) => {
        const box = h("button", { class: "jb-box" + (it.done ? " on" : ""), type: "button", "aria-pressed": String(!!it.done), "aria-label": (it.done ? "Batalkan centang: " : "Centang: ") + it.text, onclick: () => toggle(it, box) }, icon("check", 18));
        return h("li", { class: "jb-item" + (it.done ? " done" : "") }, box, h("span", { class: "jb-txt" }, it.text, it.revision && chip("Revisi", "warn")), it.done && it.doneAt && h("span", { class: "jb-time" }, hm(it.doneAt)));
      })),
      (job.notes || res) && h("div", { class: "jb-result" }, job.notes && h("div", {}, h("b", {}, "Catatanmu: "), job.notes), res && h("a", { href: res, target: "_blank", rel: "noopener" }, "Link hasil")),
      job.review && h("div", { class: "jb-review" }, h("span", { class: "jb-stars", "aria-label": `Nilai ${job.review.score} dari 5` }, stars(job.review.score)), job.review.note && h("span", {}, " " + job.review.note), h("div", { class: "muted" }, `Review oleh ${job.review.by}, ${stamp(job.review.at)}`)),
      h("div", { class: "jb-acts" },
        h("button", { class: "btn sm", type: "button", onclick: resultDialog }, icon("edit", 14), "Catatan & hasil"),
        h("button", { class: "btn sm ghost", type: "button", onclick: () => openDetail(ctx, job, false) }, icon("history", 14), "Riwayat job")));
  };

  const paint = () => {
    const today = jobs.filter((j) => j.date === t).sort(byPrio);
    const late = jobs.filter((j) => isOverdue(j, t)).sort((a, b) => a.date.localeCompare(b.date) || byPrio(a, b));
    const next = jobs.filter((j) => j.date > t && j.date <= addDays(t, 7)).sort((a, b) => a.date.localeCompare(b.date) || byPrio(a, b));
    const focus = [...late, ...today];
    const iAll = focus.reduce((s, j) => s + itemsOf(j).length, 0), iDone = focus.reduce((s, j) => s + doneCount(j), 0);
    put(sum, 
      h("div", { class: "jb-sumtext" }, focus.length ? h("span", {}, h("b", {}, `${iDone} dari ${iAll}`), ` checklist selesai · ${focus.filter(isDone).length}/${focus.length} job`) : h("span", {}, "Belum ada job aktif.")),
      focus.length ? bar(iAll ? (iDone / iAll) * 100 : 0) : null);
    const group = (title, list, kind) => list.length ? h("section", { class: "jb-section" }, h("h2", { class: "jb-h" }, title, " ", chip(String(list.length), kind)), list.map(card)) : null;
    put(body, 
      group("Tertunda dari hari sebelumnya", late, "warn"),
      today.length ? group("Hari ini", today) : (!late.length && h("div", { class: "empty" }, h("h3", {}, "Belum ada job untuk hari ini"), h("p", {}, "Job akan muncul di sini setelah supervisor membagikannya."))),
      next.length ? h("details", { class: "jb-next" }, h("summary", {}, `Mendatang 7 hari (${next.length})`),
        h("div", { class: "tablewrap plain" }, h("table", {}, h("tbody", {}, next.map((j) => h("tr", {}, h("td", {}, shortDay(j.date)), h("td", {}, h("b", {}, j.title)), h("td", {}, brandChip(ctx, j.brandId)), h("td", {}, `${itemsOf(j).length} checklist`))))))) : null);
  };
  paint();

  return {
    crumbs: [{ label: "Kerja Harian" }, { label: "Job Hari Ini" }],
    node: h("div", { style: "max-width:860px" },
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", {}, "Job Hari Ini"), h("p", { class: "lead" }, longDay(t)))),
      pushCard(ctx), sum, body),
  };
}

/* ====================================================================== */
/*  SUPERVISOR: bagikan job + papan harian                                 */
/* ====================================================================== */
async function board(ctx) {
  const { store, user, allowedBrands } = ctx;
  UI.date ||= todayStr();
  const [users, all] = await Promise.all([store.listUsers(), loadJobs(ctx, allowedBrands.map((b) => b.id))]);
  const members = users.filter((u) => u.active !== false && !isLead(u));
  const day = all.filter((j) => j.date === UI.date && (!UI.brand || j.brandId === UI.brand));
  const live = day.filter((j) => !j.cancelled);
  const toReview = all.filter((j) => !j.cancelled && isDone(j) && !j.review).length;

  // Member yang masih punya job belum selesai (hari ini dan tertunda), mengikuti filter brand.
  const tdy = todayStr();
  const pendingOf = (uid) => all.some((j) => j.assigneeUid === uid && !j.cancelled && !isDone(j) && j.date <= tdy && (!UI.brand || j.brandId === UI.brand));
  const pendingPeople = new Set(all.filter((j) => !j.cancelled && !isDone(j) && j.date <= tdy && (!UI.brand || j.brandId === UI.brand)).map((j) => j.assigneeUid)).size;

  const go = (d) => { UI.date = d || todayStr(); ctx.rerender(); };
  const toolbar = h("div", { class: "toolbar" },
    h("button", { class: "btn sm", type: "button", "aria-label": "Hari sebelumnya", onclick: () => go(addDays(UI.date, -1)) }, icon("left", 16)),
    h("input", { class: "input date-inp", type: "date", value: UI.date, "aria-label": "Tanggal", onchange: (e) => go(e.target.value) }),
    h("button", { class: "btn sm", type: "button", "aria-label": "Hari berikutnya", onclick: () => go(addDays(UI.date, 1)) }, icon("arrow", 16)),
    UI.date !== todayStr() && h("button", { class: "btn sm ghost", type: "button", onclick: () => go(todayStr()) }, "Hari ini"),
    allowedBrands.length > 1 && sel([["", "Semua brand"], ...allowedBrands.map((b) => [b.id, b.name])], UI.brand, { "aria-label": "Brand", onchange: (e) => { UI.brand = e.target.value; ctx.rerender(); } }),
    h("span", { class: "spacer", style: "flex:1" }),
    h("button", { class: "btn", type: "button", title: "Kirim notifikasi dan getar ke member yang masih punya job belum selesai", onclick: () => { if (!pendingPeople) { toast("Semua job sampai hari ini sudah selesai."); return; } remindDialog(ctx, { brandId: UI.brand || undefined, brandName: UI.brand ? brandOf(ctx, UI.brand).name : "" }); } }, icon("bell", 16), pendingPeople ? `Ingatkan tim (${pendingPeople})` : "Ingatkan tim"),
    h("button", { class: "btn", type: "button", onclick: () => copyDialog(ctx, all, members) }, icon("copy", 16), "Salin dari tanggal lain"),
    h("button", { class: "btn primary", type: "button", onclick: () => openAssign(ctx, { users: members, date: UI.date }) }, icon("plus", 16), "Bagikan job"));

  const iAll = live.reduce((s, j) => s + itemsOf(j).length, 0), iDone = live.reduce((s, j) => s + doneCount(j), 0);
  const stats = h("div", { class: "kstats" },
    stat("Job dibagikan", String(live.length), longDay(UI.date)),
    stat("Selesai", String(live.filter(isDone).length), `${live.filter((j) => statusOf(j) === "Berjalan").length} berjalan`),
    stat("Belum mulai", String(live.filter((j) => statusOf(j) === "Belum mulai").length)),
    stat("Checklist", pct(iAll ? (iDone / iAll) * 100 : null), `${iDone} dari ${iAll} item`));

  // Kelompokkan per section (peran), lalu per member.
  const roleOrder = Object.keys(ROLES).filter((k) => k !== "supervisor" && k !== "executive");
  const people = new Map();
  members.filter((u) => !UI.brand || (u.brands || []).includes("*") || (u.brands || []).includes(UI.brand)).forEach((u) => people.set(u.uid, { uid: u.uid, name: u.name, role: u.role }));
  day.forEach((j) => { if (!people.has(j.assigneeUid)) people.set(j.assigneeUid, { uid: j.assigneeUid, name: j.assigneeName, role: j.role }); });

  const jobRow = (j) => h("div", { class: "jb-jobrow" },
    h("button", { class: "linklike", type: "button", onclick: () => openDetail(ctx, j, true, members) }, j.title),
    h("span", { class: "chips" }, brandChip(ctx, j.brandId), chip(statusOf(j), statusKind(statusOf(j))), j.priority && j.priority !== "Normal" && chip(j.priority, j.priority === "Urgent" ? "warn" : "brand"), timingChip(j), isDone(j) && !j.review && !j.cancelled && chip("Belum direview", "brand")),
    h("span", { class: "muted jb-count" }, `${doneCount(j)}/${itemsOf(j).length}`));

  const sections = roleOrder.map((r) => {
    const ppl = [...people.values()].filter((p) => p.role === r).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!ppl.length) return null;
    const js = day.filter((j) => j.role === r && !j.cancelled);
    return h("section", { class: "jb-section" },
      h("h2", { class: "jb-h" }, ROLES[r], " ", chip(`${ppl.length} member · ${js.length} job`)),
      h("div", { class: "grid two" }, ppl.map((p) => {
        const mj = day.filter((j) => j.assigneeUid === p.uid).sort(byPrio);
        const act = mj.filter((j) => !j.cancelled);
        const ia = act.reduce((s, j) => s + itemsOf(j).length, 0), id = act.reduce((s, j) => s + doneCount(j), 0);
        return h("div", { class: "card jb-member" },
          h("div", { class: "jb-mhead" }, h("div", { class: "grow" }, h("b", {}, p.name), h("div", { class: "muted" }, act.length ? `${id}/${ia} checklist · ${act.filter(isDone).length}/${act.length} job` : "Belum ada job")),
            pendingOf(p.uid) && h("button", { class: "btn sm ghost", type: "button", title: "Ingatkan " + p.name, "aria-label": "Ingatkan " + p.name, onclick: () => remindDialog(ctx, { uid: p.uid, name: p.name }) }, icon("bell", 14)),
            h("button", { class: "btn sm", type: "button", "aria-label": "Beri job untuk " + p.name, onclick: () => openAssign(ctx, { users: members, date: UI.date, presetUid: p.uid }) }, icon("plus", 14), "Job")),
          act.length ? bar(ia ? (id / ia) * 100 : 0) : null,
          mj.map(jobRow));
      })));
  }).filter(Boolean);

  return {
    crumbs: [{ label: "Kerja Harian" }, { label: "Bagikan Job" }],
    node: h("div", {},
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", {}, "Bagikan Job"), h("p", { class: "lead" }, "Bagi tugas harian ke tiap member per section. Member langsung melihatnya di Job Hari Ini lengkap dengan checklist."))),
      toolbar,
      toReview ? h("div", { class: "notice", style: "margin-bottom:14px" }, h("b", {}, `${toReview} job selesai menunggu review. `), h("a", { href: "#/jobs/history?status=review" }, "Buka daftar")) : null,
      stats,
      sections.length ? sections : h("div", { class: "empty" }, h("h3", {}, "Belum ada member"), h("p", {}, "Tambahkan anggota tim dengan peran selain Supervisor/Executive di Pengaturan > Tim."), h("a", { class: "btn", href: "#/settings/team" }, "Buka Tim"))),
  };
}

/* ---------- dialog: bagikan / ubah job ---------- */
function openAssign(ctx, { job, users, date, presetUid }) {
  const { store, user, allowedBrands } = ctx;
  const editing = !!job;
  const canBrand = (u, bid) => (u.brands || []).includes("*") || (u.brands || []).includes(bid);
  // Brand awal: yang sedang difilter/aktif, tetapi bila penerima yang dipilih tidak punya akses ke sana, pakai brand pertama yang bisa ia akses.
  let startBrand = job?.brandId || UI.brand || ctx.brand.id;
  const preset = presetUid && users.find((x) => x.uid === presetUid);
  if (preset && !canBrand(preset, startBrand)) startBrand = allowedBrands.find((b) => canBrand(preset, b.id))?.id || startBrand;
  const brandSel = sel(allowedBrands.map((b) => [b.id, b.name]), startBrand, { id: "jb-brand", disabled: editing });
  const title = h("input", { class: "input", id: "jb-title", value: job?.title || "", placeholder: "mis. Produksi 3 Reels menu baru" });
  const dateIn = h("input", { class: "input", id: "jb-date", type: "date", value: job?.date || date || todayStr() });
  const due = h("input", { class: "input", id: "jb-due", type: "time", value: job?.dueTime || "" });
  const prio = sel(PRIORITY, job?.priority || "Normal", { id: "jb-prio" });
  const brief = h("textarea", { class: "textarea", id: "jb-brief", rows: 3, placeholder: "Penjelasan singkat, target, atau acuan." }, job?.brief || "");
  const list = h("textarea", { class: "textarea", id: "jb-list", rows: 5, placeholder: "Satu baris = satu item checklist\nRiset referensi\nShooting\nEditing\nUpload" }, itemsOf(job || {}).map((i) => i.text).join("\n"));
  const link = h("input", { class: "input", id: "jb-link", type: "url", placeholder: "https://… (opsional)", value: job?.link || "" });
  const chosen = new Set(presetUid ? [presetUid] : []);
  const picker = h("div", { class: "jb-picker" });

  const drawPicker = () => {
    if (editing) { put(picker, h("div", { class: "muted" }, `${job.assigneeName} · ${sectionOf(job)}`)); return; }
    const bid = brandSel.value;
    const ok = users.filter((u) => canBrand(u, bid));
    const groups = Object.keys(ROLES).filter((r) => ok.some((u) => u.role === r));
    put(picker, ...(groups.length ? groups.map((r) => {
      const us = ok.filter((u) => u.role === r);
      const allBox = h("input", { type: "checkbox", class: "check", checked: us.every((u) => chosen.has(u.uid)), onchange: (e) => { us.forEach((u) => (e.target.checked ? chosen.add(u.uid) : chosen.delete(u.uid))); drawPicker(); } });
      return h("div", { class: "jb-pgroup" }, h("label", { class: "checkrow" }, allBox, h("b", {}, `${ROLES[r]} (semua)`)),
        us.map((u) => h("label", { class: "checkrow jb-pitem" }, h("input", { type: "checkbox", class: "check", checked: chosen.has(u.uid), onchange: (e) => { e.target.checked ? chosen.add(u.uid) : chosen.delete(u.uid); allBox.checked = us.every((x) => chosen.has(x.uid)); } }), u.name)));
    }) : [h("div", { class: "muted" }, "Belum ada member yang punya akses ke brand ini.")]));
  };
  brandSel.addEventListener("change", () => { [...chosen].forEach((uid) => { const u = users.find((x) => x.uid === uid); if (!u || !canBrand(u, brandSel.value)) chosen.delete(uid); }); drawPicker(); });
  [...chosen].forEach((uid) => { const u = users.find((x) => x.uid === uid); if (!u || !canBrand(u, brandSel.value)) chosen.delete(uid); });
  drawPicker();

  const parseLines = () => list.value.split("\n").map((s) => s.trim()).filter(Boolean);

  dialog({
    title: editing ? "Ubah job" : "Bagikan job",
    body: h("div", {},
      h("div", { class: "row" }, h("div", { class: "field" }, h("label", { for: "jb-date" }, "Tanggal"), dateIn), h("div", { class: "field" }, h("label", { for: "jb-brand" }, "Brand"), brandSel)),
      h("div", { class: "field" }, h("label", { for: "jb-title" }, "Judul job"), title),
      h("div", { class: "field" }, h("label", { for: "jb-brief" }, "Brief"), brief),
      h("div", { class: "field" }, h("label", { for: "jb-list" }, "Checklist"), list, h("span", { class: "hint" }, editing ? "Item yang teksnya sama tetap mempertahankan status centang." : "Kosongkan bila cukup satu langkah; judul job dipakai sebagai satu-satunya item.")),
      h("div", { class: "row" }, h("div", { class: "field" }, h("label", { for: "jb-due" }, "Batas jam (opsional)"), due), h("div", { class: "field" }, h("label", { for: "jb-prio" }, "Prioritas"), prio)),
      h("div", { class: "field" }, h("label", { for: "jb-link" }, "Link referensi"), link),
      h("div", { class: "field" }, h("span", { class: "lbl" }, editing ? "Penerima" : "Dibagikan ke (per section)"), picker)),
    actions: [{ label: "Batal" }, {
      label: editing ? "Simpan" : "Bagikan", kind: "primary",
      onClick: async () => {
        const t = title.value.trim();
        if (!t) throw new Error("Judul job wajib diisi.");
        if (!dateIn.value) throw new Error("Tanggal wajib diisi.");
        if (link.value.trim() && !safeHref(link.value.trim())) throw new Error("Link referensi harus diawali http:// atau https://");
        const lines = parseLines();
        const base = { title: t, brief: brief.value.trim(), date: dateIn.value, dueTime: due.value || "", priority: prio.value, link: link.value.trim() };
        if (editing) {
          const upd = await mutate(ctx, job, (cur) => {
            const old = new Map((cur.items || []).map((i) => [i.text, i]));
            const wanted = lines.length ? lines : [t];
            const kept = wanted.map((txt) => old.get(txt) || { id: newId("i"), text: txt, done: false, doneAt: null });
            const revs = (cur.items || []).filter((i) => i.revision && !wanted.includes(i.text)); // item revisi tidak hilang diam-diam
            const changes = [];
            if (cur.date !== base.date) changes.push(`tanggal ${shortDay(cur.date)} → ${shortDay(base.date)}`);
            if (cur.title !== base.title) changes.push("judul");
            if ((cur.items || []).map((i) => i.text).join("|") !== [...kept, ...revs].map((i) => i.text).join("|")) changes.push("checklist");
            Object.assign(cur, base); cur.items = [...kept, ...revs];
            log(cur, user.name, "Diubah supervisor", changes.join(", ") || "detail");
            settle(cur, user.name);
          });
          toast("Job diperbarui."); ctx.rerender(); return upd;
        }
        if (!chosen.size) throw new Error("Pilih minimal satu penerima.");
        let n = 0;
        for (const uid of chosen) {
          const u = users.find((x) => x.uid === uid);
          if (!u) continue;
          const j = {
            id: newId("job"), brandId: brandSel.value, ...base, assigneeUid: u.uid, assigneeName: u.name, role: u.role,
            items: (lines.length ? lines : [t]).map((txt) => ({ id: newId("i"), text: txt, done: false, doneAt: null })),
            notes: "", resultLink: "", firstCompletedAt: null, completedAt: null, review: null, revisions: 0, cancelled: false, createdAt: nowIso(), createdBy: user.name, log: [],
          };
          log(j, user.name, "Dibagikan", `Untuk ${u.name} (${ROLES[u.role] || u.role}) · ${shortDay(base.date)}`);
          await store.saveSub(j.brandId, COL, j); n++;
        }
        UI.date = base.date;
        toast(`${n} job dibagikan.`); ctx.rerender();
      },
    }],
  });
}

/* ---------- dialog: salin job dari tanggal lain ---------- */
function copyDialog(ctx, all, members) {
  const { user, store } = ctx;
  const src = h("input", { class: "input", id: "jb-src", type: "date", value: addDays(UI.date, -1) });
  const info = h("div", { class: "hint" });
  const pick = () => all.filter((j) => j.date === src.value && !j.cancelled && (!UI.brand || j.brandId === UI.brand));
  const upd = () => { info.textContent = `${pick().length} job di ${shortDay(src.value)} akan disalin ke ${shortDay(UI.date)} dengan checklist baru (belum tercentang).`; };
  src.addEventListener("change", upd); upd();
  dialog({
    title: "Salin job dari tanggal lain",
    body: h("div", {}, h("div", { class: "field" }, h("label", { for: "jb-src" }, "Salin dari tanggal"), src, info), h("p", { class: "muted" }, "Cocok untuk tugas rutin. Job yang sudah sama (judul dan penerima) di tanggal tujuan dilewati.")),
    actions: [{ label: "Batal" }, { label: "Salin", kind: "primary", onClick: async () => {
      const exist = new Set(all.filter((j) => j.date === UI.date && !j.cancelled).map((j) => `${j.brandId}|${j.assigneeUid}|${j.title}`));
      let n = 0;
      for (const o of pick()) {
        if (exist.has(`${o.brandId}|${o.assigneeUid}|${o.title}`)) continue;
        const u = members.find((x) => x.uid === o.assigneeUid);
        if (!u || u.active === false) continue;
        const j = { ...o, id: newId("job"), date: UI.date, items: itemsOf(o).filter((i) => !i.revision).map((i) => ({ id: newId("i"), text: i.text, done: false, doneAt: null })), notes: "", resultLink: "", firstCompletedAt: null, completedAt: null, review: null, revisions: 0, cancelled: false, createdAt: nowIso(), createdBy: user.name, log: [] };
        log(j, user.name, "Dibagikan", `Disalin dari ${shortDay(o.date)} untuk ${j.assigneeName}`);
        await store.saveSub(j.brandId, COL, j); n++;
      }
      if (!n) throw new Error("Tidak ada job baru yang bisa disalin.");
      toast(`${n} job disalin.`); ctx.rerender();
    } }],
  });
}

/* ====================================================================== */
/*  Detail job + riwayat aktivitas + review                                */
/* ====================================================================== */
function openDetail(ctx, job, lead, members) {
  const { user } = ctx;
  const st = statusOf(job);
  const ref = safeHref(job.link || ""), res = safeHref(job.resultLink || "");
  let close;
  const finish = (msg) => { toast(msg); close?.(); ctx.rerender(); };

  const score = sel([["", "Pilih nilai"], ...SCORES.map(([v, l]) => [String(v), l])], job.review ? String(job.review.score) : "", { id: "jb-score" });
  const rnote = h("textarea", { class: "textarea", id: "jb-rnote", rows: 2, placeholder: "Catatan untuk member (wajib bila meminta revisi)" }, job.review?.note || "");

  const reviewBox = lead && !job.cancelled && (isDone(job) || job.review) ? h("div", { class: "jb-rbox" },
    h("h3", {}, "Review supervisor"),
    h("div", { class: "field" }, h("label", { for: "jb-score" }, "Nilai"), score),
    h("div", { class: "field" }, h("label", { for: "jb-rnote" }, "Catatan"), rnote),
    h("div", { class: "row" },
      h("button", { class: "btn primary", type: "button", onclick: async () => {
        if (!score.value) return toast("Pilih nilai dulu.", "err");
        try {
          await mutate(ctx, job, (cur) => { cur.review = { score: Number(score.value), note: rnote.value.trim(), by: user.name, at: nowIso() }; log(cur, user.name, "Review", `Nilai ${score.value}/5${rnote.value.trim() ? " · " + rnote.value.trim() : ""}`); });
          finish("Review tersimpan.");
        } catch (e) { toast(e.message || String(e), "err"); }
      } }, "Simpan review"),
      h("button", { class: "btn", type: "button", onclick: async () => {
        if (!rnote.value.trim()) return toast("Tulis catatan revisi untuk member.", "err");
        try {
          await mutate(ctx, job, (cur) => {
            (cur.items ||= []).push({ id: newId("i"), text: "Revisi: " + rnote.value.trim(), done: false, doneAt: null, revision: true });
            cur.revisions = (cur.revisions || 0) + 1; cur.review = null;
            log(cur, user.name, "Minta revisi", rnote.value.trim()); settle(cur, user.name);
          });
          finish("Revisi diminta. Job kembali terbuka untuk member.");
        } catch (e) { toast(e.message || String(e), "err"); }
      } }, "Minta revisi"))) : null;

  const body = h("div", { class: "jb-detail" },
    h("dl", { class: "kv" },
      h("dt", {}, "Penerima"), h("dd", {}, `${job.assigneeName} · ${sectionOf(job)}`),
      h("dt", {}, "Brand"), h("dd", {}, brandOf(ctx, job.brandId).name),
      h("dt", {}, "Tanggal"), h("dd", {}, shortDay(job.date) + (job.dueTime ? `, batas ${job.dueTime}` : "")),
      h("dt", {}, "Prioritas"), h("dd", {}, job.priority || "Normal"),
      h("dt", {}, "Status"), h("dd", {}, st + (timing(job) ? ` · ${timing(job)}` : "") + (job.completedAt ? ` (${stamp(job.completedAt)})` : "")),
      h("dt", {}, "Dibagikan oleh"), h("dd", {}, `${job.createdBy || "—"}${job.createdAt ? ", " + stamp(job.createdAt) : ""}`),
      job.revisions ? [h("dt", {}, "Revisi"), h("dd", {}, `${job.revisions}x`)] : null),
    job.brief && h("p", { class: "jb-brief" }, job.brief),
    ref && h("a", { class: "refl", href: ref, target: "_blank", rel: "noopener" }, "Buka referensi"),
    h("h3", {}, `Checklist (${doneCount(job)}/${itemsOf(job).length})`),
    h("ul", { class: "jb-items" }, itemsOf(job).map((it) => h("li", { class: "jb-item" + (it.done ? " done" : "") }, h("span", { class: "jb-box" + (it.done ? " on" : ""), "aria-hidden": "true" }, icon("check", 16)), h("span", { class: "jb-txt" }, it.text, it.revision && chip("Revisi", "warn")), h("span", { class: "jb-time" }, it.done && it.doneAt ? stamp(it.doneAt) : "")))),
    (job.notes || res) && h("div", { class: "jb-result" }, job.notes && h("div", {}, h("b", {}, "Catatan hasil: "), job.notes), res && h("a", { href: res, target: "_blank", rel: "noopener" }, "Link hasil")),
    !lead && job.review && h("div", { class: "jb-review" }, h("span", { class: "jb-stars" }, stars(job.review.score)), job.review.note && h("span", {}, " " + job.review.note)),
    reviewBox,
    h("h3", {}, "Riwayat aktivitas"),
    h("ol", { class: "jb-log" }, (job.log || []).slice().reverse().map((e) => h("li", {}, h("span", { class: "muted" }, stamp(e.at)), h("span", {}, h("b", {}, e.act), e.txt ? ` · ${e.txt}` : "", h("span", { class: "muted" }, ` — ${e.by || "—"}`))))));

  const actions = [{ label: "Tutup" }];
  if (lead) {
    actions.unshift({ label: "Ubah", onClick: () => openAssign(ctx, { job, users: members || [] }) });
    const started = doneCount(job) > 0 || job.completedAt;
    if (job.cancelled) actions.unshift({ label: "Aktifkan lagi", onClick: async () => { await mutate(ctx, job, (c) => { c.cancelled = false; log(c, user.name, "Diaktifkan lagi"); }); toast("Job diaktifkan."); ctx.rerender(); } });
    else actions.unshift({ label: started ? "Batalkan job" : "Hapus job", kind: "danger", onClick: async () => {
      if (!(await confirmDialog(started ? "Job ini sudah dikerjakan, jadi tidak dihapus: statusnya menjadi Dibatalkan dan tidak dihitung di KPI, riwayat tetap tersimpan." : "Hapus job ini? Belum ada checklist yang dicentang.", started ? "Ya, batalkan" : "Ya, hapus"))) return false;
      if (started) await mutate(ctx, job, (c) => { c.cancelled = true; log(c, user.name, "Dibatalkan"); });
      else await ctx.store.deleteSub(job.brandId, COL, job.id);
      toast(started ? "Job dibatalkan." : "Job dihapus."); ctx.rerender();
    } });
  }
  close = dialog({ title: job.title, body, actions });
}

/* ====================================================================== */
/*  Riwayat (supervisor: semua; member: milik sendiri + KPI pribadi)       */
/* ====================================================================== */
async function history(ctx, query, lead) {
  const { user } = ctx;
  const F = UI.hist;
  if (query?.get("uid")) F.uid = query.get("uid");
  if (query?.get("status")) { F.status = query.get("status") === "review" ? "Menunggu review" : query.get("status"); if (F.status === "Menunggu review") F.range = "custom", F.from = addDays(todayStr(), -90), F.to = todayStr(); }
  let jobs = await loadJobs(ctx, ctx.allowedBrands.map((b) => b.id));
  if (!lead) jobs = jobs.filter((j) => j.assigneeUid === user.uid);
  const members = lead ? await ctx.store.listUsers().then((us) => us.filter((u) => !isLead(u))).catch(() => []) : [];
  const people = new Map(members.map((u) => [u.uid, u.name]));
  jobs.forEach((j) => { if (!people.has(j.assigneeUid)) people.set(j.assigneeUid, j.assigneeName); });

  const kp = h("div"), tbl = h("div"), cnt = h("div", { class: "summary" });
  const statusMatch = (j, st, t) => !st || (st === "Tertunda" ? isOverdue(j, t)
    : st === "Menunggu review" ? !j.cancelled && isDone(j) && !j.review
    : st === "Dibatalkan" ? !!j.cancelled
    : statusOf(j) === st && !isOverdue(j, t));
  const filtered = () => {
    const [from, to] = rangeOf(F.range, F.from, F.to), t = todayStr();
    return jobs
      .filter((j) => j.date >= from && j.date <= to && (!F.uid || j.assigneeUid === F.uid) && (!F.brand || j.brandId === F.brand) && statusMatch(j, F.status, t))
      .sort((a, b) => b.date.localeCompare(a.date) || String(a.assigneeName).localeCompare(String(b.assigneeName)) || byPrio(a, b));
  };
  const paint = () => {
    const list = filtered();
    if (!lead) {
      const k = kpi(list);
      put(kp, h("div", { class: "kstats" },
        stat("Skor KPI", k.score == null ? "—" : String(Math.round(k.score)), "dari penyelesaian, ketepatan, dan review"),
        stat("Job selesai", `${k.done}/${k.done + k.pending}`, k.running ? `${k.running} masih berjalan` : "tidak termasuk job hari ini yang berjalan"),
        stat("Tepat waktu", pct(k.onTimeRate), `${k.late} terlambat`),
        stat("Nilai review", k.reviewAvg == null ? "—" : k.reviewAvg.toFixed(1) + " / 5", `${k.reviewed} job direview · ${k.revisions} revisi`)));
    }
    cnt.textContent = `${list.length} job`;
    const heads = ["Tanggal", "Job", lead && "Penerima", "Brand", "Checklist", "Status", "Ketepatan", "Review"].filter(Boolean);
    put(tbl, list.length ? h("div", { class: "tablewrap plain" }, h("table", {},
      h("thead", {}, h("tr", {}, heads.map((x) => h("th", {}, x)))),
      h("tbody", {}, list.map((j) => h("tr", {},
        h("td", {}, shortDay(j.date)),
        h("td", {}, h("button", { class: "linklike", type: "button", onclick: () => openDetail(ctx, j, lead, members) }, j.title), j.revisions ? h("div", { class: "muted" }, `${j.revisions}x revisi`) : null),
        lead && h("td", {}, j.assigneeName, h("div", { class: "muted" }, sectionOf(j))),
        h("td", {}, brandChip(ctx, j.brandId)),
        h("td", {}, `${doneCount(j)}/${itemsOf(j).length}`),
        h("td", {}, chip(isOverdue(j) ? "Tertunda" : statusOf(j), isOverdue(j) ? "warn" : statusKind(statusOf(j)))),
        h("td", {}, timing(j) && !isOverdue(j) ? timingChip(j) : "—"),
        h("td", {}, j.review ? h("span", { class: "jb-stars", title: j.review.note || "" }, stars(j.review.score)) : "—")))))) : h("div", { class: "empty" }, h("h3", {}, "Tidak ada job pada filter ini")));
  };
  const exportCsv = () => {
    const rows = [["Tanggal", "Brand", "Penerima", "Section", "Job", "Checklist selesai", "Checklist total", "Status", "Ketepatan", "Selesai pada", "Revisi", "Nilai review", "Catatan review"]];
    filtered().forEach((j) => rows.push([j.date, brandOf(ctx, j.brandId).name, j.assigneeName, sectionOf(j), j.title, doneCount(j), itemsOf(j).length, isOverdue(j) ? "Tertunda" : statusOf(j), timing(j), j.completedAt ? stamp(j.completedAt) : "", j.revisions || 0, j.review?.score || "", j.review?.note || ""]));
    download(`riwayat-job-${todayStr()}.csv`, rows);
  };

  const tools = h("div", { class: "toolbar" },
    ...rangeControls(F, paint),
    lead && sel([["", "Semua member"], ...[...people].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([id, n]) => [id, n])], F.uid, { "aria-label": "Member", onchange: (e) => { F.uid = e.target.value; paint(); } }),
    ctx.allowedBrands.length > 1 && sel([["", "Semua brand"], ...ctx.allowedBrands.map((b) => [b.id, b.name])], F.brand, { "aria-label": "Brand", onchange: (e) => { F.brand = e.target.value; paint(); } }),
    sel(STATUS_FILTER, F.status, { "aria-label": "Status", onchange: (e) => { F.status = e.target.value; paint(); } }),
    h("span", { style: "flex:1" }),
    h("button", { class: "btn", type: "button", onclick: exportCsv }, "Unduh CSV"));
  paint();

  return {
    crumbs: [{ label: "Kerja Harian" }, { label: lead ? "Riwayat Job" : "Riwayat & KPI Saya" }],
    node: h("div", {},
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", {}, lead ? "Riwayat Job" : "Riwayat & KPI Saya"),
        h("p", { class: "lead" }, lead ? "Catatan lengkap semua job: siapa mengerjakan apa, kapan selesai, dan nilai review. Klik judul untuk melihat riwayat aktivitasnya." : "Semua job yang pernah dibagikan kepadamu dan ringkasan KPI untuk periode terpilih."))),
      tools, kp, cnt, tbl),
  };
}

/* ====================================================================== */
/*  KPI tim (supervisor)                                                   */
/* ====================================================================== */
async function kpiPage(ctx) {
  const F = UI.kpi;
  const jobs = await loadJobs(ctx, ctx.allowedBrands.map((b) => b.id));
  const roles = Object.keys(ROLES).filter((r) => r !== "supervisor" && r !== "executive");
  const out = h("div");

  const paint = () => {
    const [from, to] = rangeOf(F.range, F.from, F.to);
    const js = jobs.filter((j) => j.date >= from && j.date <= to && (!F.brand || j.brandId === F.brand) && (!F.role || j.role === F.role));
    const total = kpi(js);
    const per = new Map();
    js.forEach((j) => { if (!per.has(j.assigneeUid)) per.set(j.assigneeUid, { uid: j.assigneeUid, name: j.assigneeName, role: j.role, list: [] }); per.get(j.assigneeUid).list.push(j); });
    const rows = [...per.values()].map((p) => ({ ...p, k: kpi(p.list) })).sort((a, b) => (b.k.score ?? -1) - (a.k.score ?? -1) || a.name.localeCompare(b.name));
    const secRows = roles.map((r) => ({ r, k: kpi(js.filter((j) => j.role === r)) })).filter((x) => x.k.total);

    const scoreCell = (s) => h("div", { class: "jb-score" }, h("b", {}, s == null ? "—" : String(Math.round(s))), s != null && bar(s));
    const head = (arr) => h("thead", {}, h("tr", {}, arr.map(([t, n]) => h("th", { class: n ? "num" : "" }, t))));

    put(out, 
      h("div", { class: "kstats" },
        stat("Skor KPI tim", total.score == null ? "—" : String(Math.round(total.score)), `${shortDay(from)} – ${shortDay(to)}`),
        stat("Job selesai", `${total.done}/${total.done + total.pending}`, `${total.pending} tertunda · ${total.running} berjalan`),
        stat("Tepat waktu", pct(total.onTimeRate), `${total.late} terlambat`),
        stat("Nilai review", total.reviewAvg == null ? "—" : total.reviewAvg.toFixed(1) + " / 5", `${total.reviewed} direview · ${total.revisions} revisi`)),
      h("h3", { class: "jb-h" }, "Per member"),
      rows.length ? h("div", { class: "tablewrap plain" }, h("table", {},
        head([["Member"], ["Job", 1], ["Selesai", 1], ["Tepat waktu", 1], ["Tertunda", 1], ["Revisi", 1], ["Checklist", 1], ["Review", 1], ["Skor KPI"]]),
        h("tbody", {}, rows.map(({ uid, name, role, k }) => h("tr", {},
          h("td", {}, h("a", { href: `#/jobs/history?uid=${encodeURIComponent(uid)}`, class: "linklike" }, name), h("div", { class: "muted" }, ROLES[role] || role)),
          h("td", { class: "num" }, k.total), h("td", { class: "num" }, pct(k.doneRate)), h("td", { class: "num" }, pct(k.onTimeRate)),
          h("td", { class: "num" }, k.pending), h("td", { class: "num" }, k.revisions), h("td", { class: "num" }, pct(k.checklist)),
          h("td", { class: "num" }, k.reviewAvg == null ? "—" : k.reviewAvg.toFixed(1)), h("td", { class: "jb-scorecell" }, scoreCell(k.score)))))))
        : h("div", { class: "empty" }, h("h3", {}, "Belum ada job pada periode ini")),
      secRows.length ? [h("h3", { class: "jb-h", style: "margin-top:24px" }, "Per section"),
        h("div", { class: "tablewrap plain" }, h("table", {},
          head([["Section"], ["Job", 1], ["Selesai", 1], ["Tepat waktu", 1], ["Tertunda", 1], ["Review", 1], ["Skor KPI"]]),
          h("tbody", {}, secRows.map(({ r, k }) => h("tr", {}, h("td", {}, h("b", {}, ROLES[r])), h("td", { class: "num" }, k.total), h("td", { class: "num" }, pct(k.doneRate)), h("td", { class: "num" }, pct(k.onTimeRate)), h("td", { class: "num" }, k.pending), h("td", { class: "num" }, k.reviewAvg == null ? "—" : k.reviewAvg.toFixed(1)), h("td", { class: "jb-scorecell" }, scoreCell(k.score)))))))] : null,
      h("div", { class: "notice", style: "margin-top:20px" }, h("b", {}, "Cara menghitung. "),
        `Hanya job sampai hari ini yang dihitung; job yang dibatalkan dan job hari ini yang masih berjalan tidak mengurangi nilai. Selesai = job yang tuntas ÷ (tuntas + tertunda). Tepat waktu = job tuntas pada atau sebelum tanggal (dan jam batas) ÷ job tuntas; revisi tidak mengubahnya. Review = rata-rata nilai 1–5. Skor KPI = rata-rata berbobot ${KPI_WEIGHTS.done}% selesai, ${KPI_WEIGHTS.ontime}% tepat waktu, ${KPI_WEIGHTS.review}% review (skala 100); komponen yang belum punya data dilewati. Bobot bisa diubah di KPI_WEIGHTS pada js/views/jobs.js.`));
    exportRows = rows;
  };
  let exportRows = [];
  const exportCsv = () => {
    const [from, to] = rangeOf(F.range, F.from, F.to);
    const r = [["Member", "Section", "Job", "Selesai", "Tepat waktu", "Terlambat", "Tertunda", "Berjalan", "Revisi", "Checklist %", "Review rata-rata", "Skor KPI"]];
    exportRows.forEach(({ name, role, k }) => r.push([name, ROLES[role] || role, k.total, k.done, k.onTime, k.late, k.pending, k.running, k.revisions, k.checklist == null ? "" : Math.round(k.checklist), k.reviewAvg == null ? "" : k.reviewAvg.toFixed(2), k.score == null ? "" : Math.round(k.score)]));
    download(`kpi-job-${from}_${to}.csv`, r);
  };

  const tools = h("div", { class: "toolbar" },
    ...rangeControls(F, paint),
    ctx.allowedBrands.length > 1 && sel([["", "Semua brand"], ...ctx.allowedBrands.map((b) => [b.id, b.name])], F.brand, { "aria-label": "Brand", onchange: (e) => { F.brand = e.target.value; paint(); } }),
    sel([["", "Semua section"], ...roles.map((r) => [r, ROLES[r]])], F.role, { "aria-label": "Section", onchange: (e) => { F.role = e.target.value; paint(); } }),
    h("span", { style: "flex:1" }),
    h("button", { class: "btn", type: "button", onclick: exportCsv }, "Unduh CSV"),
    h("button", { class: "btn", type: "button", onclick: () => window.print() }, "Cetak"));
  paint();

  return {
    crumbs: [{ label: "Kerja Harian" }, { label: "KPI Tim" }],
    node: h("div", {},
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", {}, "KPI Tim"), h("p", { class: "lead" }, "Ketuntasan, ketepatan waktu, dan nilai review tiap member, dihitung otomatis dari riwayat job."))),
      tools, out),
  };
}
