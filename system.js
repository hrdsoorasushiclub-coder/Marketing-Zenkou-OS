import { h, icon, toast, confirmDialog, fmtDate, isLead } from "../ui.js";
import { render as md, inline, slug } from "../md.js";

const CHECK_KEY = "zenkou-os-checks";
const loadChecks = () => { try { return JSON.parse(localStorage.getItem(CHECK_KEY) || "{}"); } catch { return {}; } };
const saveChecks = (m) => { try { localStorage.setItem(CHECK_KEY, JSON.stringify(m)); } catch { /* abaikan */ } };

const scopeLabel = (s, brands) => (s.scope === "brand" ? brands.find((b) => b.id === s.brandId)?.name || "Brand" : "Umum");
const nextCode = (sops, prefix) => {
  const nums = sops.filter((s) => String(s.code || "").startsWith(prefix + "-")).map((s) => parseInt(String(s.code).split("-").pop(), 10) || 0);
  return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, "0")}`;
};

async function copyToBrand(ctx, sop) {
  const { store, brand } = ctx;
  const sops = await store.listSops();
  const id = `${brand.id}-${sop.id}`;
  if (sops.some((s) => s.id === id)) { toast(`${brand.name} sudah punya salinan SOP ini.`, "err"); location.hash = `#/system/${id}`; return; }
  const ok = await confirmDialog(`Salin "${sop.title}" ke ${brand.name}? Salinan bisa diubah tanpa memengaruhi SOP umum.`, "Salin ke brand", "primary");
  if (!ok) return;
  await store.saveSop({ ...sop, id, scope: "brand", brandId: brand.id, code: nextCode(sops.filter((s) => s.brandId === brand.id), brand.short || "BR"), sourceId: sop.id, version: "1.0" });
  toast("SOP disalin. Sesuaikan isinya untuk brand ini.");
  location.hash = `#/system/${id}/edit`;
}

export async function list(ctx, { query }) {
  const { store, user, brand, brands } = ctx;
  const sops = await store.listSops();
  const general = sops.filter((s) => s.scope !== "brand");
  const mine = sops.filter((s) => s.scope === "brand" && s.brandId === brand.id);
  let tab = query.get("tab") === "brand" ? "brand" : "general";
  const lead = isLead(user);

  const tabs = h("div", { class: "tabs", role: "tablist" });
  const grid = h("div", { class: "grid" });
  const headNote = h("p", { class: "muted", style: "margin:-8px 0 16px" });

  const card = (s) =>
    h("a", { class: "card link sop-card", href: `#/system/${s.id}` },
      h("span", { class: "code" }, s.code),
      h("h3", {}, s.title),
      h("p", {}, s.summary),
      h("div", { class: "foot" },
        h("span", { class: "chip" }, `${(s.steps || []).length} tahap`),
        h("span", {}, `v${s.version || "1.0"}`),
        lead && s.scope !== "brand" && h("button", { class: "btn sm", style: "margin-left:auto", type: "button",
          onclick: (e) => { e.preventDefault(); e.stopPropagation(); copyToBrand(ctx, s); } }, icon("copy", 14), `Salin ke ${brand.short || "brand"}`)));

  const draw = () => {
    tabs.replaceChildren(
      h("button", { role: "tab", "aria-selected": tab === "general", onclick: () => { tab = "general"; draw(); } }, `SOP umum (${general.length})`),
      h("button", { role: "tab", "aria-selected": tab === "brand", onclick: () => { tab = "brand"; draw(); } }, `SOP ${brand.name} (${mine.length})`));
    const rows = tab === "general" ? general : mine;
    headNote.textContent = tab === "general"
      ? "Berlaku untuk semua brand. Dasar dari SOP khusus brand."
      : `Khusus ${brand.name}. Dibuat dengan menyalin SOP umum lalu menyesuaikannya.`;
    if (rows.length) grid.replaceChildren(...rows.map(card));
    else grid.replaceChildren(h("div", { class: "empty", style: "grid-column:1/-1" },
      h("h3", {}, tab === "general" ? "Belum ada SOP umum" : `${brand.name} belum punya SOP khusus`),
      h("p", {}, tab === "general"
        ? (lead ? "Muat SOP awal dari Pengaturan > Data & koneksi, atau buat SOP baru." : "Minta Supervisor menambahkan SOP.")
        : "Buka SOP umum lalu pilih Salin ke brand, atau buat SOP baru dari nol."),
      lead && h("a", { class: "btn", href: `#/system/new?scope=${tab}` }, icon("plus"), "Buat SOP baru")));
  };
  draw();

  return {
    crumbs: [{ label: "System" }, { label: "SOP" }],
    node: h("div", {},
      h("div", { class: "page-head" },
        h("div", { class: "grow" }, h("h1", {}, "SOP"), h("p", { class: "lead" }, "Cara standar mengerjakan tiap proses: siapa PIC-nya, apa outputnya, dan aturan mainnya.")),
        lead && h("div", { class: "actions" }, h("a", { class: "btn", href: `#/system/new?scope=${tab}` }, icon("plus"), "SOP baru"))),
      tabs, headNote, grid),
  };
}

export async function read(ctx, { id }) {
  const { store, user, brand, brands } = ctx;
  const sops = await store.listSops();
  const s = sops.find((x) => x.id === id);
  if (!s) return { crumbs: [{ label: "System", href: "#/system" }], node: h("div", { class: "empty" }, h("h3", {}, "SOP tidak ditemukan"), h("a", { class: "btn", href: "#/system" }, "Kembali ke daftar SOP")) };
  const lead = isLead(user);
  const checks = loadChecks();
  const checkKey = `${brand.id}:${s.id}`;
  const { html } = md(s.body, { checkKey, checked: checks });
  const bodyEl = h("div", { class: "prose", html });
  bodyEl.addEventListener("change", (e) => {
    const k = e.target?.dataset?.key;
    if (!k) return;
    const m = loadChecks(); m[k] = e.target.checked; saveChecks(m);
  });

  const steps = s.steps || [];
  const stepsEl = steps.length
    ? h("div", { class: "rail" }, steps.map((st, i) =>
        h("div", { class: "step" },
          h("span", { class: "node", "aria-hidden": "true" }, i + 1),
          h("h3", {}, st.stage),
          st.detail && h("p", { class: "detail" }, st.detail),
          h("div", { class: "tags" },
            st.pic && h("div", { class: "tag" }, h("span", {}, "PIC"), h("b", {}, st.pic)),
            st.output && h("div", { class: "tag out" }, h("span", {}, "Output"), h("b", {}, st.output))))))
    : null;

  const flow = (s.statusFlow || []).length
    ? h("div", {}, h("h2", { class: "sec-title" }, "Status"),
        h("div", { class: "flow" }, s.statusFlow.flatMap((st, i) => [i ? h("span", { class: "ar" }, icon("arrow", 16)) : null, h("span", { class: "st" }, st)])),
        s.statusNotes && h("p", { style: "margin-top:12px;color:var(--ink-2)", html: inline(s.statusNotes) }))
    : null;

  const del = async () => {
    if (!(await confirmDialog(`Hapus SOP "${s.title}"?`, "Hapus SOP"))) return;
    await store.deleteSop(s.id); toast("SOP dihapus."); location.hash = "#/system";
  };

  return {
    crumbs: [{ label: "System" }, { label: "SOP", href: "#/system" + (s.scope === "brand" ? "?tab=brand" : "") }, { label: s.code }],
    node: h("div", { class: "sop-body", style: "max-width:860px" },
      h("div", { class: "sop-head" },
        h("span", { class: "chip brand" }, s.code),
        h("span", { class: "chip" }, scopeLabel(s, brands)),
        h("span", { class: "chip" }, `Versi ${s.version || "1.0"}`),
        s.updatedAt && h("span", { class: "muted" }, `Diperbarui ${fmtDate(s.updatedAt)}`)),
      h("div", { class: "page-head", style: "margin-bottom:6px" },
        h("div", { class: "grow" }, h("h1", {}, s.title)),
        lead && h("div", { class: "actions" },
          s.scope !== "brand" && h("button", { class: "btn", type: "button", onclick: () => copyToBrand(ctx, s) }, icon("copy", 16), `Salin ke ${brand.name}`),
          h("a", { class: "btn", href: `#/system/${s.id}/edit` }, icon("edit", 16), "Edit"),
          h("button", { class: "btn danger", type: "button", onclick: del }, icon("trash", 16)))),
      s.purpose && h("p", { class: "purpose" }, s.purpose),
      stepsEl && h("div", {}, h("h2", { class: "sec-title", style: "margin-top:0" }, s.stepsTitle || "Alur dan tanggung jawab"), stepsEl),
      flow,
      h("div", { style: "margin-top:8px" }, bodyEl)),
  };
}

export async function edit(ctx, { id, query }) {
  const { store, user, brand, brands } = ctx;
  if (!isLead(user)) return { crumbs: [{ label: "System", href: "#/system" }], node: h("div", { class: "empty" }, h("h3", {}, "Hanya Supervisor dan Executive yang bisa mengedit SOP"), h("a", { class: "btn", href: "#/system" }, "Kembali")) };
  const sops = await store.listSops();
  const isNew = !id || id === "new";
  const scope = isNew ? (query.get("scope") === "brand" ? "brand" : "general") : null;
  const s = isNew
    ? { id: "", code: nextCode(scope === "brand" ? sops.filter((x) => x.brandId === brand.id) : sops.filter((x) => x.scope !== "brand"), scope === "brand" ? brand.short || "BR" : "SOP"),
        scope, brandId: scope === "brand" ? brand.id : null, title: "", summary: "", purpose: "", stepsTitle: "Alur dan tanggung jawab", steps: [{ stage: "", pic: "", output: "", detail: "" }], statusFlow: [], statusNotes: "", body: "", version: "1.0" }
    : sops.find((x) => x.id === id);
  if (!s) return { crumbs: [{ label: "System", href: "#/system" }], node: h("div", { class: "empty" }, h("h3", {}, "SOP tidak ditemukan")) };

  const steps = (s.steps || []).map((x) => ({ ...x }));
  const f = {
    code: h("input", { class: "input", id: "c", value: s.code }),
    version: h("input", { class: "input", id: "v", value: s.version || "1.0" }),
    title: h("input", { class: "input", id: "t", value: s.title }),
    summary: h("input", { class: "input", id: "s", value: s.summary }),
    purpose: h("textarea", { class: "textarea", id: "p" }, s.purpose),
    stepsTitle: h("input", { class: "input", id: "st", value: s.stepsTitle || "Alur dan tanggung jawab" }),
    flow: h("input", { class: "input", id: "fl", value: (s.statusFlow || []).join(" → "), placeholder: "Planned → Production → Approved → Published" }),
    notes: h("textarea", { class: "textarea", id: "n", style: "min-height:64px" }, s.statusNotes),
    body: h("textarea", { class: "textarea code", id: "b", style: "min-height:300px" }, s.body),
  };
  const stepsBox = h("div", { class: "steps-edit" });
  const drawSteps = () => {
    stepsBox.replaceChildren(...steps.map((st, i) => {
      const bind = (key, label, ph) => h("div", { class: "field", style: "margin:0" }, h("label", {}, label),
        h("input", { class: "input", value: st[key] || "", placeholder: ph || "", oninput: (e) => { st[key] = e.target.value; } }));
      return h("div", { class: "step-edit" },
        h("div", { class: "bar" }, h("b", {}, `Tahap ${i + 1}`),
          h("button", { class: "btn sm ghost", type: "button", disabled: i === 0, "aria-label": "Naikkan", onclick: () => { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; drawSteps(); } }, icon("up", 15)),
          h("button", { class: "btn sm ghost", type: "button", disabled: i === steps.length - 1, "aria-label": "Turunkan", onclick: () => { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; drawSteps(); } }, icon("down", 15)),
          h("button", { class: "btn sm ghost danger", type: "button", "aria-label": "Hapus tahap", onclick: () => { steps.splice(i, 1); drawSteps(); } }, icon("trash", 15))),
        h("div", { class: "row" }, bind("stage", "Nama tahap", "Mis. Approval Konten"), bind("pic", "PIC", "Mis. Supervisor / Admin"), bind("output", "Output (boleh kosong)", "Mis. Konten Disetujui")),
        h("div", { class: "field", style: "margin:0" }, h("label", {}, "Detail proses"),
          h("textarea", { class: "textarea", style: "min-height:64px", oninput: (e) => { st.detail = e.target.value; } }, st.detail || "")));
    }), h("button", { class: "btn", type: "button", style: "justify-self:start", onclick: () => { steps.push({ stage: "", pic: "", output: "", detail: "" }); drawSteps(); } }, icon("plus", 16), "Tambah tahap"));
  };
  drawSteps();
  const preview = h("div", { class: "prose" });
  const drawPrev = () => { preview.innerHTML = md(f.body.value).html; };
  f.body.addEventListener("input", drawPrev); drawPrev();

  const save = async () => {
    const title = f.title.value.trim();
    if (!title) { toast("Judul SOP wajib diisi.", "err"); return; }
    let newId = s.id;
    if (isNew) {
      newId = (s.scope === "brand" ? `${brand.id}-` : "sop-") + slug(title);
      if (sops.some((x) => x.id === newId)) newId += "-" + Math.random().toString(36).slice(2, 5);
    }
    const out = {
      ...s, id: newId, code: f.code.value.trim() || s.code, version: f.version.value.trim() || "1.0", title,
      summary: f.summary.value.trim(), purpose: f.purpose.value.trim(), stepsTitle: f.stepsTitle.value.trim() || "Alur dan tanggung jawab",
      steps: steps.filter((x) => (x.stage || "").trim()).map((x) => ({ stage: x.stage.trim(), pic: (x.pic || "").trim(), output: (x.output || "").trim(), detail: (x.detail || "").trim() })),
      statusFlow: f.flow.value.split(/→|->|,/).map((x) => x.trim()).filter(Boolean),
      statusNotes: f.notes.value.trim(), body: f.body.value,
    };
    await store.saveSop(out);
    toast("SOP tersimpan.");
    location.hash = `#/system/${newId}`;
  };

  return {
    crumbs: [{ label: "System" }, { label: "SOP", href: "#/system" }, { label: isNew ? "SOP baru" : s.code }, { label: "Edit" }],
    node: h("div", { style: "max-width:980px" },
      h("div", { class: "page-head" },
        h("div", { class: "grow" }, h("h1", {}, isNew ? "SOP baru" : "Edit SOP"), h("p", { class: "lead" }, s.scope === "brand" ? `SOP khusus ${brands.find((b) => b.id === s.brandId)?.name || "brand"}` : "SOP umum untuk semua brand")),
        h("div", { class: "actions" },
          h("a", { class: "btn", href: isNew ? "#/system" : `#/system/${s.id}` }, "Batal"),
          h("button", { class: "btn primary", type: "button", onclick: save }, icon("check", 16), "Simpan"))),
      h("div", { class: "row" },
        h("div", { class: "field", style: "flex:1 1 120px" }, h("label", { for: "c" }, "Kode"), f.code),
        h("div", { class: "field", style: "flex:4 1 280px" }, h("label", { for: "t" }, "Judul"), f.title),
        h("div", { class: "field", style: "flex:1 1 100px" }, h("label", { for: "v" }, "Versi"), f.version)),
      h("div", { class: "field" }, h("label", { for: "s" }, "Ringkasan (tampil di daftar)"), f.summary),
      h("div", { class: "field" }, h("label", { for: "p" }, "Tujuan"), f.purpose),
      h("div", { class: "field" }, h("label", { for: "st" }, "Judul bagian alur"), f.stepsTitle),
      h("div", { class: "field" }, h("span", { class: "lbl" }, "Tahap, PIC, dan output"), stepsBox),
      h("div", { class: "field" }, h("label", { for: "fl" }, "Alur status (boleh kosong)"), f.flow, h("span", { class: "hint" }, "Pisahkan dengan tanda panah → atau koma.")),
      h("div", { class: "field" }, h("label", { for: "n" }, "Catatan status (boleh kosong)"), f.notes),
      h("div", { class: "editor", style: "grid-template-columns:minmax(0,1fr)" },
        h("div", { class: "field" }, h("label", { for: "b" }, "Isi lainnya (markdown): ketentuan, checklist, output"), f.body,
          h("span", { class: "hint" }, "Judul bagian: ## Judul. Daftar bernomor: 1. item. Checklist: - [ ] item. Tabel: | A | B |.")),
        h("div", { class: "field" }, h("span", { class: "lbl" }, "Pratinjau isi"), h("div", { class: "card", style: "max-height:420px;overflow:auto" }, preview)))),
  };
}
