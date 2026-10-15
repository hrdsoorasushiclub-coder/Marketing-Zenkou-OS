import { h } from "../ui.js";
import { friendlyError } from "../store.js";

const left = () =>
  h("section", { class: "left" },
    h("div", { class: "wordmark" }, h("span", { class: "mark" }, "Z"), h("div", {}, "Zenkou Marketing OS")),
    h("div", {},
      h("h1", {}, "Satu tempat kerja untuk tim marketing"),
      h("p", {}, "Pengetahuan, prosedur, dan pekerjaan harian tiap brand, dalam satu web.")),
    h("div", { class: "pillars" },
      h("div", {}, h("b", {}, "Academy"), h("span", {}, "Handbook dan pengetahuan marketing")),
      h("div", {}, h("b", {}, "System"), h("span", {}, "SOP umum dan SOP per brand")),
      h("div", {}, h("b", {}, "Operation"), h("span", {}, "Content plan, brand set up, media & KOL, administrasi"))));

export function authView(store, auth) {
  const box = h("div", { class: "box" });

  if (store.mode === "demo") {
    box.append(
      h("h2", {}, "Coba dulu tanpa login"),
      h("p", {}, "Ini mode demo: data hanya tersimpan di browser ini. Sambungkan Firebase supaya seluruh tim memakai data yang sama."),
      h("div", { class: "demo-roles" },
        h("button", { type: "button", onclick: () => store.demoLogin("demo-supervisor") }, h("b", {}, "Masuk sebagai Supervisor"), h("span", {}, "Bisa mengedit handbook, SOP, tim, dan brand")),
        h("button", { type: "button", onclick: () => store.demoLogin("demo-executive") }, h("b", {}, "Masuk sebagai Executive"), h("span", {}, "Akses penuh, termasuk approval")),
        h("button", { type: "button", onclick: () => store.demoLogin("demo-creator") }, h("b", {}, "Masuk sebagai Content Creator"), h("span", {}, "Hanya membaca, dan hanya melihat Soora Sushi Club"))));
  } else if (auth.needsSetup) {
    const name = h("input", { class: "input", id: "nm", placeholder: "Nama lengkap", autocomplete: "name" });
    const err = h("p", { class: "muted", role: "alert" });
    const btn = h("button", { class: "btn primary", type: "button" }, "Jadikan saya Supervisor");
    btn.onclick = async () => {
      if (!name.value.trim()) { err.textContent = "Isi nama lengkapmu dulu."; return; }
      btn.disabled = true;
      try { await store.claimSetup(name.value.trim()); } catch (e) { err.textContent = e.message; btn.disabled = false; }
    };
    box.append(
      h("h2", {}, "Setup awal"),
      h("p", {}, `Database masih kosong. Akun ${auth.email} akan menjadi Supervisor pertama dan membuat brand awal (Soora Sushi Club dan Bulan Purnama).`),
      h("div", { class: "field" }, h("label", { for: "nm" }, "Nama kamu"), name),
      err, btn,
      h("p", { style: "margin-top:16px" }, h("button", { class: "btn ghost sm", type: "button", onclick: () => store.signOut() }, "Keluar")));
  } else if (auth.blocked || auth.email) {
    box.append(
      h("h2", {}, auth.blocked ? "Akun dinonaktifkan" : "Akunmu belum terdaftar di tim"),
      h("p", {}, auth.blocked
        ? "Hubungi Supervisor kalau ini keliru."
        : `Minta Supervisor menambahkan ${auth.email} lewat Pengaturan > Tim, lalu masuk lagi.`),
      h("button", { class: "btn", type: "button", onclick: () => store.signOut() }, "Keluar"));
  } else {
    const email = h("input", { class: "input", id: "em", type: "email", autocomplete: "username", required: true });
    const pw = h("input", { class: "input", id: "pw", type: "password", autocomplete: "current-password", required: true });
    const err = h("p", { class: "muted", role: "alert", style: "min-height:20px;color:var(--danger)" });
    const btn = h("button", { class: "btn primary", type: "submit", style: "width:100%;justify-content:center" }, "Masuk");
    const form = h("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = "";
        btn.disabled = true;
        try { await store.signIn(email.value.trim(), pw.value); }
        catch (ex) { err.textContent = friendlyError(ex); btn.disabled = false; }
      },
    },
      h("div", { class: "field" }, h("label", { for: "em" }, "Email"), email),
      h("div", { class: "field" }, h("label", { for: "pw" }, "Kata sandi"), pw),
      err, btn);
    box.append(h("h2", {}, "Masuk"), h("p", {}, "Gunakan akun yang dibuat Supervisor untukmu."), form);
    if (auth.error) err.textContent = auth.error;
  }

  return h("div", { class: "auth" }, left(), h("section", { class: "right" }, box));
}
