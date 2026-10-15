// Pengingat HP: kartu aktivasi untuk member, dan dialog "Ingatkan tim" untuk supervisor.
// Pengirim: fungsi Netlify (jadwal 09.15, 13.00, 16.00 WIB + tombol manual). Lihat PANDUAN-PENGINGAT.md.
import { h, icon, toast, dialog } from "../ui.js";
import { vapidKey } from "../config.js";

const UA = navigator.userAgent || "";
const IOS = /iphone|ipad|ipod/i.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const STANDALONE = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const CAN_PUSH = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function callRemind(ctx, body) {
  const token = await ctx.store.getToken();
  if (!token) throw new Error("Pengingat butuh login Firebase (bukan mode demo).");
  let res;
  try { res = await fetch("/.netlify/functions/remind-now", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new Error("Fungsi pengingat tidak terjangkau. Pastikan web dideploy ke Netlify dengan folder netlify/functions."); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Gagal (${res.status}).`);
  return j;
}

/* ---------- member: aktifkan di HP ini ---------- */
export function pushCard(ctx) {
  const { store, user } = ctx;
  if (store.mode !== "firebase") return null;
  const box = h("div", { class: "jb-push" });
  const set = (...kids) => box.replaceChildren(...kids.flat(Infinity).filter(Boolean));
  const times = "09.15, 13.00, dan 16.00";

  const paint = () => {
    if (!vapidKey) {
      set(user.role === "supervisor" || user.role === "executive" ? h("div", { class: "notice warn" }, h("b", {}, "Pengingat belum aktif. "), "Isi vapidKey di js/config.js (lihat PANDUAN-PENGINGAT.md).") : null);
      return;
    }
    if (!CAN_PUSH) {
      set(h("div", { class: "notice" }, h("b", {}, "Pengingat di HP ini belum bisa. "), IOS && !STANDALONE
        ? "Di iPhone, buka web ini lewat Safari, ketuk tombol Bagikan, pilih Tambah ke Layar Utama, lalu buka dari ikon Zenkou OS di layar utama. Setelah itu tombol aktifkan muncul di sini."
        : "Browser ini belum mendukung notifikasi. Pakai Chrome terbaru di Android."));
      return;
    }
    if (Notification.permission === "denied") {
      set(h("div", { class: "notice warn" }, h("b", {}, "Notifikasi diblokir di browser ini. "), "Buka pengaturan situs (ikon gembok di address bar, atau Pengaturan > Aplikasi di HP), ubah Notifikasi menjadi Izinkan, lalu muat ulang halaman."));
      return;
    }
    if (store.pushRegistered() && Notification.permission === "granted") {
      set(h("div", { class: "jb-pushrow" }, chip("Pengingat aktif di HP ini", "ok"),
        h("span", { class: "muted" }, `Bunyi dan getar jam ${times} bila masih ada job belum dicentang, dan saat supervisor menekan Ingatkan tim.`),
        h("span", { style: "flex:1" }),
        h("button", { class: "btn sm", type: "button", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { const r = await callRemind(ctx, { test: true }); toast(r.sent ? "Notifikasi tes dikirim. Cek HP kamu." : "Tes tidak terkirim. Coba matikan lalu aktifkan lagi.", r.sent ? "ok" : "err"); } catch (err) { toast(err.message, "err"); }
          b.disabled = false;
        } }, "Kirim tes"),
        h("button", { class: "btn sm ghost", type: "button", onclick: async () => { try { await store.pushUnregister(); toast("Pengingat dimatikan di HP ini."); } catch (err) { toast(err.message, "err"); } paint(); } }, "Matikan")));
      return;
    }
    set(h("div", { class: "notice" }, h("div", { class: "jb-pushrow" },
      h("div", { style: "flex:1;min-width:220px" }, h("b", {}, "Aktifkan pengingat di HP ini. "), `Kamu akan diingatkan jam ${times} bila masih ada job yang belum dicentang.`),
      h("button", { class: "btn primary", type: "button", onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { await store.pushRegister(vapidKey); toast("Pengingat aktif. Kirim tes untuk memastikan."); } catch (err) { toast(err.message, "err"); }
        paint();
      } }, icon("bell", 16), "Aktifkan pengingat"))));
  };
  const chip = (t, k = "") => h("span", { class: "chip" + (k ? " " + k : "") }, t);
  paint();
  return box;
}

/* ---------- supervisor: Ingatkan tim ---------- */
// scope: { brandId?, brandName?, uid?, name?, count? }
export function remindDialog(ctx, scope = {}) {
  const note = h("textarea", { class: "textarea", id: "rm-note", rows: 3, maxlength: 160, placeholder: "Opsional, contoh: Tolong selesaikan sebelum jam 5 ya." });
  const target = scope.uid ? scope.name : scope.brandId ? `semua member brand ${scope.brandName}` : "semua member di semua brand yang kamu pegang";
  dialog({
    title: scope.uid ? `Ingatkan ${scope.name}` : "Ingatkan tim",
    body: h("div", {},
      h("p", {}, `Notifikasi dan getar dikirim sekarang ke ${target} yang masih punya job belum selesai (hari ini dan yang tertunda).`),
      h("div", { class: "field" }, h("label", { for: "rm-note" }, "Pesan tambahan"), note)),
    actions: [{ label: "Batal" }, { label: "Kirim pengingat", kind: "primary", onClick: async () => {
      const r = await callRemind(ctx, { note: note.value.trim(), brandId: scope.brandId || undefined, uid: scope.uid || undefined });
      if (!r.people) { toast("Tidak ada member dengan job yang belum selesai."); return; }
      const reached = r.people - r.noDevice.length;
      toast(`Pengingat terkirim ke ${reached} dari ${r.people} orang.`);
      if (r.noDevice.length) setTimeout(() => dialog({
        title: "Belum bisa diingatkan",
        body: h("div", {}, h("p", {}, "Orang berikut belum mengaktifkan pengingat di HP-nya, jadi tidak menerima notifikasi:"), h("ul", { style: "margin:8px 0 0;padding-left:1.2em" }, r.noDevice.map((n) => h("li", {}, n))), h("p", { class: "muted", style: "margin-top:10px" }, "Minta mereka membuka Job Hari Ini lalu menekan Aktifkan pengingat.")),
        actions: [{ label: "Mengerti", kind: "primary" }],
      }), 250);
    } }],
  });
}
