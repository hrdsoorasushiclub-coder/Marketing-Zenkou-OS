import { h, icon, toast, dialog, confirmDialog, ROLES, isLead } from "../ui.js";
import { slug } from "../md.js";
import { SEED } from "../seed-data.js";

const denied = () => ({ crumbs: [{ label: "Pengaturan" }], node: h("div", { class: "empty" }, h("h3", {}, "Hanya Supervisor dan Executive yang bisa membuka halaman ini")) });

/* ---------------- Tim ---------------- */
export async function team(ctx) {
  const { store, user, brands } = ctx;
  if (!isLead(user)) return denied();
  const users = (await store.listUsers()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const brandNames = (u) => (u.brands || []).includes("*") ? "Semua brand" : (u.brands || []).map((id) => brands.find((b) => b.id === id)?.name || id).join(", ") || "Belum ada";

  const brandPicker = (selected) => {
    const all = h("input", { type: "checkbox", class: "check", checked: selected.includes("*") });
    const boxes = brands.map((b) => ({ b, el: h("input", { type: "checkbox", class: "check", checked: selected.includes(b.id) }) }));
    const sync = () => boxes.forEach(({ el }) => { el.disabled = all.checked; });
    all.addEventListener("change", sync); sync();
    const node = h("div", { class: "field" }, h("span", { class: "lbl" }, "Brand yang bisa diakses"),
      h("label", { class: "checkrow" }, all, "Semua brand (termasuk brand baru)"),
      ...boxes.map(({ b, el }) => h("label", { class: "checkrow" }, el, b.name)));
    return { node, value: () => (all.checked ? ["*"] : boxes.filter(({ el }) => el.checked).map(({ b }) => b.id)) };
  };
  const roleSelect = (v) => h("select", { class: "select", id: "rl" }, Object.entries(ROLES).map(([k, label]) => h("option", { value: k, selected: k === v }, label)));

  const addMember = () => {
    const name = h("input", { class: "input", id: "nm" });
    const email = h("input", { class: "input", id: "em", type: "email" });
    const pw = h("input", { class: "input", id: "pw", type: "text", placeholder: "Minimal 6 karakter" });
    const role = roleSelect("creator");
    const picker = brandPicker(["*"]);
    dialog({
      title: "Tambah anggota tim",
      body: h("div", {},
        h("div", { class: "field" }, h("label", { for: "nm" }, "Nama lengkap"), name),
        h("div", { class: "field" }, h("label", { for: "em" }, "Email"), email),
        store.mode === "firebase" && h("div", { class: "field" }, h("label", { for: "pw" }, "Kata sandi sementara"), pw, h("span", { class: "hint" }, "Kirim ke yang bersangkutan, lalu minta mengganti lewat Lupa kata sandi di Firebase bila perlu.")),
        h("div", { class: "field" }, h("label", { for: "rl" }, "Peran"), role),
        picker.node),
      actions: [{ label: "Batal" }, {
        label: "Tambahkan", kind: "primary",
        onClick: async () => {
          if (!name.value.trim() || !email.value.trim()) throw new Error("Nama dan email wajib diisi.");
          if (store.mode === "firebase" && pw.value.length < 6) throw new Error("Kata sandi minimal 6 karakter.");
          const brandsSel = picker.value();
          if (!brandsSel.length) throw new Error("Pilih minimal satu brand.");
          await store.addMember({ name: name.value.trim(), email: email.value.trim(), password: pw.value, role: role.value, brands: brandsSel });
          toast("Anggota ditambahkan."); ctx.rerender();
        },
      }],
    });
  };

  const editMember = (u) => {
    const role = roleSelect(u.role);
    const picker = brandPicker(u.brands || []);
    const active = h("input", { type: "checkbox", class: "check", checked: u.active !== false });
    dialog({
      title: u.name,
      body: h("div", {}, h("p", { class: "muted", style: "margin-bottom:14px" }, u.email),
        h("div", { class: "field" }, h("label", { for: "rl" }, "Peran"), role), picker.node,
        h("label", { class: "checkrow" }, active, "Akun aktif")),
      actions: [{ label: "Batal" }, {
        label: "Simpan", kind: "primary",
        onClick: async () => {
          const brandsSel = picker.value();
          if (!brandsSel.length) throw new Error("Pilih minimal satu brand.");
          if (u.uid === user.uid && (!active.checked || !["supervisor", "executive"].includes(role.value))) throw new Error("Kamu tidak bisa menonaktifkan atau menurunkan peranmu sendiri.");
          await store.updateMember(u.uid, { role: role.value, brands: brandsSel, active: active.checked });
          toast("Perubahan tersimpan."); ctx.rerender();
        },
      }],
    });
  };

  return {
    crumbs: [{ label: "Pengaturan" }, { label: "Tim" }],
    node: h("div", {},
      h("div", { class: "page-head" },
        h("div", { class: "grow" }, h("h1", {}, "Tim"), h("p", { class: "lead" }, "Siapa saja yang bisa masuk, apa perannya, dan brand mana yang boleh mereka lihat.")),
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", onclick: addMember }, icon("plus"), "Tambah anggota"))),
      h("div", { class: "tablewrap plain" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Nama", "Peran", "Brand", "Status", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, users.map((u) => h("tr", {},
          h("td", {}, h("b", {}, u.name), h("div", { class: "muted" }, u.email)),
          h("td", {}, ROLES[u.role] || u.role), h("td", {}, brandNames(u)),
          h("td", {}, h("span", { class: "chip " + (u.active === false ? "warn" : "ok") }, u.active === false ? "Nonaktif" : "Aktif")),
          h("td", { class: "act" }, h("button", { class: "btn sm", type: "button", onclick: () => editMember(u) }, icon("edit", 14), "Ubah")))))))),
  };
}

/* ---------------- Brand ---------------- */
export async function brandsPage(ctx) {
  const { store, user } = ctx;
  if (!isLead(user)) return denied();
  const brands = await store.listBrands();

  const open = (b) => {
    const isNew = !b;
    const v = b || { name: "", short: "", color: "#2f7d5b", instagram: "" };
    const name = h("input", { class: "input", id: "bn", value: v.name });
    const short = h("input", { class: "input", id: "bs", value: v.short, maxlength: 4, placeholder: "SSC" });
    const color = h("input", { type: "color", id: "bc", value: v.color, style: "width:64px;height:40px;border:1px solid var(--line);border-radius:9px;padding:2px;background:var(--surface)" });
    const ig = h("input", { class: "input", id: "bi", value: v.instagram || "", placeholder: "@namabrand" });
    dialog({
      title: isNew ? "Tambah brand" : v.name,
      body: h("div", {},
        h("div", { class: "field" }, h("label", { for: "bn" }, "Nama brand"), name),
        h("div", { class: "row" },
          h("div", { class: "field" }, h("label", { for: "bs" }, "Singkatan (2 sampai 4 huruf)"), short),
          h("div", { class: "field" }, h("label", { for: "bc" }, "Warna penanda di OS"), color, h("span", { class: "hint" }, "Hanya mewarnai tampilan OS. Warna resmi brand disimpan di Brand Guideline."))),
        h("div", { class: "field" }, h("label", { for: "bi" }, "Instagram"), ig)),
      actions: [{ label: "Batal" }, {
        label: "Simpan", kind: "primary",
        onClick: async () => {
          if (!name.value.trim()) throw new Error("Nama brand wajib diisi.");
          const id = v.id || slug(name.value);
          if (isNew && brands.some((x) => x.id === id)) throw new Error("Brand dengan nama serupa sudah ada.");
          await store.saveBrand({ ...v, id, name: name.value.trim(), short: (short.value.trim() || name.value.trim().slice(0, 3)).toUpperCase(), color: color.value, instagram: ig.value.trim() });
          toast("Brand tersimpan."); await ctx.reloadBrands(); ctx.rerender();
        },
      }],
    });
  };

  return {
    crumbs: [{ label: "Pengaturan" }, { label: "Brand" }],
    node: h("div", {},
      h("div", { class: "page-head" },
        h("div", { class: "grow" }, h("h1", {}, "Brand"), h("p", { class: "lead" }, "Daftar brand di bawah Zenkou. Tiap brand punya ruang Operation sendiri.")),
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", onclick: () => open(null) }, icon("plus"), "Tambah brand"))),
      h("div", { class: "grid" }, brands.map((b) =>
        h("div", { class: "card", style: "display:flex;gap:14px;align-items:center" },
          h("span", { style: `width:46px;height:46px;border-radius:12px;background:${b.color};color:#fff;display:grid;place-items:center;font-weight:800;flex:none` }, b.short),
          h("div", { style: "min-width:0;flex:1" }, h("b", {}, b.name), h("div", { class: "muted" }, b.instagram || "Instagram belum diisi")),
          h("button", { class: "btn sm", type: "button", onclick: () => open(b) }, icon("edit", 14), "Ubah"))))),
  };
}

/* ---------------- Data & koneksi ---------------- */
export async function data(ctx) {
  const { store, user } = ctx;
  if (!isLead(user)) return denied();
  const [hb, sp] = await Promise.all([store.listHandbook(), store.listSops()]);
  const missingHb = SEED.handbook.filter((m) => !hb.some((x) => x.id === m.id)).length;
  const missingSp = SEED.sops.filter((m) => !sp.some((x) => x.id === m.id)).length;

  const run = async (overwrite) => {
    if (overwrite && !(await confirmDialog("Ini menimpa modul Handbook dan SOP bawaan dengan versi awal. Perubahan yang sudah kamu buat pada modul dan SOP itu akan hilang. Lanjutkan?", "Timpa dengan data awal"))) return;
    const r = await store.importSeed({ overwrite });
    toast(`Selesai: ${r.handbook} modul, ${r.sops} SOP, ${r.brands} brand ditulis.`);
    ctx.rerender();
  };

  return {
    crumbs: [{ label: "Pengaturan" }, { label: "Data & koneksi" }],
    node: h("div", { style: "max-width:760px" },
      h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", {}, "Data & koneksi"))),
      h("div", { class: "card", style: "margin-bottom:14px" },
        h("h3", { style: "font-size:17px;margin-bottom:10px" }, "Koneksi"),
        store.mode === "firebase"
          ? h("p", {}, h("span", { class: "chip ok" }, "Terhubung ke Firebase"), " Semua perubahan tersimpan di database bersama dan terlihat oleh seluruh tim.")
          : h("div", {}, h("p", {}, h("span", { class: "chip warn" }, "Mode demo"), " Data hanya tersimpan di browser ini."),
              h("p", { class: "muted", style: "margin-top:8px" }, "Untuk dipakai bersama tim, ikuti TUTORIAL-FIREBASE.md lalu isi js/config.js."),
              h("button", { class: "btn sm", type: "button", style: "margin-top:12px", onclick: async () => { if (await confirmDialog("Kembalikan semua data demo ke kondisi awal?", "Reset demo")) { await store.resetDemo(); toast("Data demo direset."); ctx.rerender(); } } }, "Reset data demo"))),
      h("div", { class: "card" },
        h("h3", { style: "font-size:17px;margin-bottom:10px" }, "Data awal"),
        h("dl", { class: "kv", style: "margin-bottom:14px" },
          h("dt", {}, "Handbook"), h("dd", {}, `${hb.length} modul di database, ${missingHb} dari ${SEED.handbook.length} modul bawaan belum dimuat`),
          h("dt", {}, "SOP"), h("dd", {}, `${sp.length} SOP di database, ${missingSp} dari ${SEED.sops.length} SOP bawaan belum dimuat`)),
        h("div", { class: "row", style: "gap:8px" },
          h("button", { class: "btn primary", type: "button", style: "flex:0 0 auto", onclick: () => run(false) }, icon("db", 16), "Muat yang belum ada"),
          h("button", { class: "btn", type: "button", style: "flex:0 0 auto", onclick: () => run(true) }, "Timpa dengan data awal")),
        h("p", { class: "muted", style: "margin-top:12px;font-size:13.5px" }, "Muat yang belum ada: menambah modul dan SOP bawaan yang belum tersimpan, tanpa menyentuh yang sudah ada."))),
  };
}
