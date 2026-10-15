// Lapisan data. Dua pilihan dengan fungsi yang sama:
//  - Firebase (Auth + Firestore) bila config.js sudah diisi
//  - Mode demo (localStorage) bila belum
// Halaman-halaman hanya memanggil fungsi di sini, tidak peduli sumbernya.

import { SEED } from "./seed-data.js";

const FB_VERSION = "10.14.1";
const clean = (o) => JSON.parse(JSON.stringify(o ?? null));
const now = () => new Date().toISOString();

export function friendlyError(e) {
  const code = e?.code || "";
  const map = {
    "auth/invalid-credential": "Email atau kata sandi salah.",
    "auth/wrong-password": "Email atau kata sandi salah.",
    "auth/user-not-found": "Akun dengan email ini belum ada.",
    "auth/invalid-email": "Format email belum benar.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.",
    "auth/email-already-in-use": "Email ini sudah terdaftar.",
    "auth/weak-password": "Kata sandi minimal 6 karakter.",
    "auth/network-request-failed": "Tidak bisa terhubung ke internet.",
    "permission-denied": "Kamu tidak punya izin untuk tindakan ini.",
    "unavailable": "Firebase tidak bisa dijangkau. Periksa koneksi internet.",
  };
  return map[code] || e?.message || "Terjadi kesalahan. Coba lagi.";
}

const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999);
const byCode = (a, b) => String(a.code || "").localeCompare(String(b.code || ""), "id", { numeric: true });

/* ====================================================================== */
/*  MODE DEMO                                                              */
/* ====================================================================== */

const DEMO_KEY = "zenkou-os-demo-v1";
const DEMO_USERS = [
  { uid: "demo-supervisor", name: "Demo Supervisor", email: "supervisor@demo.local", role: "supervisor", brands: ["*"], active: true },
  { uid: "demo-executive", name: "Demo Executive", email: "executive@demo.local", role: "executive", brands: ["*"], active: true },
  { uid: "demo-creator", name: "Demo Content Creator", email: "creator@demo.local", role: "creator", brands: ["soora-sushi-club"], active: true },
];

function createDemoStore() {
  let memory = null;
  const load = () => {
    try { const raw = localStorage.getItem(DEMO_KEY); if (raw) return JSON.parse(raw); } catch { /* abaikan */ }
    return memory;
  };
  const save = (s) => {
    memory = s;
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)); } catch { /* browser memblokir storage: tetap jalan di memori */ }
  };
  const fresh = () => ({
    handbook: clean(SEED.handbook).map((m) => ({ ...m, updatedAt: now() })),
    sops: clean(SEED.sops).map((s) => ({ ...s, updatedAt: now() })),
    brands: clean(SEED.brands),
    users: clean(DEMO_USERS),
    content: {},
    events: {},
  });
  let state = load() || fresh();
  save(state);
  let listener = () => {};
  let current = null;

  const emit = () => listener({ user: current });
  const upsert = (list, item) => {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
  };

  return {
    mode: "demo",
    onAuth(cb) { listener = cb; emit(); },
    async signIn() { throw new Error("Mode demo: pilih salah satu peran di layar masuk."); },
    async demoLogin(uid) {
      current = state.users.find((u) => u.uid === uid) || state.users[0];
      emit();
    },
    async signOut() { current = null; emit(); },
    async getToken() { return null; },
    async pushRegister() { throw new Error("Pengingat HP butuh mode Firebase (bukan mode demo)."); },
    async pushUnregister() {},
    async pushResume() {},
    pushRegistered: () => false,
    async claimSetup() { throw new Error("Tidak dipakai di mode demo."); },

    async listBrands() { return clean(state.brands); },
    async saveBrand(b) { upsert(state.brands, clean(b)); save(state); },
    async listHandbook() { return clean(state.handbook).sort(byOrder); },
    async saveHandbook(m) { upsert(state.handbook, { ...clean(m), updatedAt: now(), updatedBy: current?.name || "" }); save(state); },
    async deleteHandbook(id) { state.handbook = state.handbook.filter((m) => m.id !== id); save(state); },
    async listSops() { return clean(state.sops).sort(byCode); },
    async saveSop(s) { upsert(state.sops, { ...clean(s), updatedAt: now(), updatedBy: current?.name || "" }); save(state); },
    async deleteSop(id) { state.sops = state.sops.filter((s) => s.id !== id); save(state); },
    async listUsers() { return clean(state.users); },
    // Content Plan & kalender: data terpisah per brand
    async listContent(brandId) { return clean((state.content ||= {})[brandId] || []); },
    async saveContent(brandId, item) {
      const list = ((state.content ||= {})[brandId] ||= []);
      upsert(list, { ...clean(item), updatedAt: now(), updatedBy: current?.name || "" }); save(state);
    },
    async deleteContent(brandId, id) { const c = (state.content ||= {}); c[brandId] = (c[brandId] || []).filter((x) => x.id !== id); save(state); },
    async listEvents(brandId) { return clean((state.events ||= {})[brandId] || []); },
    async saveEvent(brandId, item) {
      const list = ((state.events ||= {})[brandId] ||= []);
      upsert(list, { ...clean(item), updatedAt: now() }); save(state);
    },
    async deleteEvent(brandId, id) { const e = (state.events ||= {}); e[brandId] = (e[brandId] || []).filter((x) => x.id !== id); save(state); },
    // Penyimpanan umum per brand (Brand Set Up: setup, brand_assets, templates, opening_kit)
    async listSub(brandId, name) { return clean((state.sub ||= {})[`${brandId}/${name}`] || []); },
    async getSub(brandId, name, id) { return clean(((state.sub ||= {})[`${brandId}/${name}`] || []).find((x) => x.id === id) || null); },
    async saveSub(brandId, name, item) { upsert(((state.sub ||= {})[`${brandId}/${name}`] ||= []), { ...clean(item), updatedAt: now(), updatedBy: current?.name || "" }); save(state); },
    async deleteSub(brandId, name, id) { const k = `${brandId}/${name}`; (state.sub ||= {})[k] = (state.sub[k] || []).filter((x) => x.id !== id); save(state); },
    async addMember(p) {
      if (state.users.some((u) => u.email === p.email)) throw new Error("Email ini sudah terdaftar.");
      state.users.push({ uid: "demo-" + Math.random().toString(36).slice(2, 9), name: p.name, email: p.email, role: p.role, brands: p.brands, active: true });
      save(state);
    },
    async updateMember(uid, patch) {
      const u = state.users.find((x) => x.uid === uid);
      if (u) Object.assign(u, clean(patch));
      save(state);
    },
    async importSeed({ overwrite = false } = {}) {
      const res = { handbook: 0, sops: 0, brands: 0 };
      for (const m of SEED.handbook) {
        if (overwrite || !state.handbook.some((x) => x.id === m.id)) { upsert(state.handbook, { ...clean(m), updatedAt: now() }); res.handbook++; }
      }
      for (const s of SEED.sops) {
        if (overwrite || !state.sops.some((x) => x.id === s.id)) { upsert(state.sops, { ...clean(s), updatedAt: now() }); res.sops++; }
      }
      for (const b of SEED.brands) {
        if (!state.brands.some((x) => x.id === b.id)) { state.brands.push(clean(b)); res.brands++; }
      }
      save(state);
      return res;
    },
    async resetDemo() { state = fresh(); save(state); },
  };
}

/* ====================================================================== */
/*  FIREBASE                                                               */
/* ====================================================================== */

async function createFirebaseStore(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [A, Au, F] = await Promise.all([
    import(base + "firebase-app.js"),
    import(base + "firebase-auth.js"),
    import(base + "firebase-firestore.js"),
  ]);
  const app = A.initializeApp(cfg);
  const auth = Au.getAuth(app);
  const db = F.getFirestore(app);
  let listener = () => {};
  let last = null;
  let me = null;
  const emit = (s) => { last = s; listener(s); };

  const list = async (name) => (await F.getDocs(F.collection(db, name))).docs.map((d) => ({ id: d.id, ...d.data() }));
  const setDoc = (col, id, data) => F.setDoc(F.doc(db, col, id), clean(data));
  const PUSH_KEY = "zenkou-push-id";
  const pushGet = () => { try { return localStorage.getItem(PUSH_KEY); } catch { return null; } };
  const pushSet = (v) => { try { v ? localStorage.setItem(PUSH_KEY, v) : localStorage.removeItem(PUSH_KEY); } catch { /* abaikan */ } };
  let MM = null;
  const loadM = async () => (MM ||= await import(base + "firebase-messaging.js"));
  const hashOf = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  async function pushAttach(vapidKey, ask) {
    if (!vapidKey) throw new Error("Kunci Web Push (vapidKey) belum diisi di js/config.js.");
    const M2 = await loadM();
    if (!(await M2.isSupported())) throw new Error("Browser ini belum mendukung notifikasi push.");
    let perm = Notification.permission;
    if (perm !== "granted" && ask) perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error(perm === "denied" ? "Izin notifikasi diblokir. Buka pengaturan situs di browser, ubah Notifikasi menjadi Izinkan, lalu coba lagi." : "Izin notifikasi belum diberikan.");
    const reg = await navigator.serviceWorker.register("firebase-messaging-sw.js");
    await navigator.serviceWorker.ready;
    const token = await M2.getToken(M2.getMessaging(app), { vapidKey, serviceWorkerRegistration: reg });
    if (!token) throw new Error("Tidak mendapat token notifikasi. Coba lagi.");
    if (!me) throw new Error("Belum masuk.");
    const id = await hashOf(token);
    const old = pushGet();
    await setDoc("push_devices", id, { uid: me.uid, name: me.name || "", token, platform: String(navigator.userAgent).slice(0, 140), updatedAt: now() });
    if (old && old !== id) await F.deleteDoc(F.doc(db, "push_devices", old)).catch(() => {});
    pushSet(id);
    return id;
  }
  async function pushDetach(deleteToken = false) {
    const id = pushGet();
    if (deleteToken) { try { const M2 = await loadM(); await M2.deleteToken(M2.getMessaging(app)); } catch { /* abaikan */ } }
    if (id) await F.deleteDoc(F.doc(db, "push_devices", id));
    pushSet(null);
  }
  const wrap = async (fn) => { try { return await fn(); } catch (e) { throw new Error(friendlyError(e)); } };

  Au.onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) { me = null; emit({ user: null }); return; }
    try {
      const snap = await F.getDoc(F.doc(db, "users", fbUser.uid));
      if (snap.exists()) {
        const p = { uid: fbUser.uid, ...snap.data() };
        if (p.active === false) { me = null; emit({ user: null, blocked: "inactive", email: fbUser.email }); return; }
        me = p; emit({ user: p });
        return;
      }
      const setup = await F.getDoc(F.doc(db, "config", "setup"));
      me = null;
      emit({ user: null, needsSetup: !setup.exists(), uid: fbUser.uid, email: fbUser.email });
    } catch (e) {
      me = null;
      emit({ user: null, error: friendlyError(e) });
    }
  });

  return {
    mode: "firebase",
    onAuth(cb) { listener = cb; if (last) cb(last); },
    signIn: (email, pw) => wrap(() => Au.signInWithEmailAndPassword(auth, email, pw)),
    async demoLogin() {},
    // Lepas perangkat ini dari akun yang keluar, supaya HP bersama tidak menerima pengingat milik orang lain.
    signOut: async () => { try { await pushDetach(); } catch { /* tetap keluar */ } return Au.signOut(auth); },
    getToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),

    // ---- Pengingat HP (Web Push lewat FCM). Perangkat tersimpan di push_devices/{hash token}. ----
    pushRegistered: () => !!pushGet(),
    pushRegister: (vapidKey) => wrap(() => pushAttach(vapidKey, true)),
    pushUnregister: () => wrap(() => pushDetach(true)),
    // Dipanggil setelah login: menyegarkan token (token FCM bisa berganti) dan memasang penerima saat web terbuka.
    async pushResume(vapidKey, onForeground) {
      try {
        if (!vapidKey || !pushGet() || typeof Notification === "undefined" || Notification.permission !== "granted") return;
        await pushAttach(vapidKey, false);
        const MM = await loadM();
        MM.onMessage(MM.getMessaging(app), (p) => onForeground?.(p.data || {}));
      } catch (e) { console.warn("Pengingat tidak dipulihkan:", e); }
    },

    claimSetup: (name) => wrap(async () => {
      const u = auth.currentUser;
      const batch = F.writeBatch(db);
      batch.set(F.doc(db, "config", "setup"), { done: true, by: u.uid, at: now() });
      batch.set(F.doc(db, "users", u.uid), { name, email: u.email, role: "supervisor", brands: ["*"], active: true, createdAt: now() });
      for (const b of SEED.brands) batch.set(F.doc(db, "brands", b.id), clean(b));
      await batch.commit();
      const p = { uid: u.uid, name, email: u.email, role: "supervisor", brands: ["*"], active: true };
      me = p; emit({ user: p });
    }),

    listBrands: () => wrap(() => list("brands")),
    saveBrand: (b) => wrap(() => setDoc("brands", b.id, b)),
    listHandbook: () => wrap(async () => (await list("handbook")).sort(byOrder)),
    saveHandbook: (m) => wrap(() => setDoc("handbook", m.id, { ...m, updatedAt: now(), updatedBy: me?.name || "" })),
    deleteHandbook: (id) => wrap(() => F.deleteDoc(F.doc(db, "handbook", id))),
    listSops: () => wrap(async () => (await list("sops")).sort(byCode)),
    saveSop: (s) => wrap(() => setDoc("sops", s.id, { ...s, updatedAt: now(), updatedBy: me?.name || "" })),
    deleteSop: (id) => wrap(() => F.deleteDoc(F.doc(db, "sops", id))),
    async listUsers() { return wrap(async () => (await F.getDocs(F.collection(db, "users"))).docs.map((d) => ({ uid: d.id, ...d.data() }))); },

    // Content Plan & kalender: tersimpan di brands/{brandId}/content_plan dan calendar_events
    listContent: (brandId) => wrap(() => list(`brands/${brandId}/content_plan`)),
    saveContent: (brandId, c) => wrap(() => setDoc(`brands/${brandId}/content_plan`, c.id, { ...c, updatedAt: now(), updatedBy: me?.name || "" })),
    deleteContent: (brandId, id) => wrap(() => F.deleteDoc(F.doc(db, `brands/${brandId}/content_plan`, id))),
    listEvents: (brandId) => wrap(() => list(`brands/${brandId}/calendar_events`)),
    saveEvent: (brandId, e) => wrap(() => setDoc(`brands/${brandId}/calendar_events`, e.id, { ...e, updatedAt: now() })),
    deleteEvent: (brandId, id) => wrap(() => F.deleteDoc(F.doc(db, `brands/${brandId}/calendar_events`, id))),
    listSub: (brandId, name) => wrap(() => list(`brands/${brandId}/${name}`)),
    getSub: (brandId, name, id) => wrap(async () => { const s = await F.getDoc(F.doc(db, `brands/${brandId}/${name}`, id)); return s.exists() ? { id: s.id, ...s.data() } : null; }),
    saveSub: (brandId, name, item) => wrap(() => setDoc(`brands/${brandId}/${name}`, item.id, { ...item, updatedAt: now(), updatedBy: me?.name || "" })),
    deleteSub: (brandId, name, id) => wrap(() => F.deleteDoc(F.doc(db, `brands/${brandId}/${name}`, id))),

    // Membuat akun lewat aplikasi Firebase kedua supaya sesi supervisor tidak terputus.
    addMember: (p) => wrap(async () => {
      const second = A.initializeApp(cfg, "second-" + Date.now());
      try {
        const sAuth = Au.getAuth(second);
        const cred = await Au.createUserWithEmailAndPassword(sAuth, p.email, p.password);
        await Au.signOut(sAuth);
        await setDoc("users", cred.user.uid, { name: p.name, email: p.email, role: p.role, brands: p.brands, active: true, createdAt: now() });
      } finally { await A.deleteApp(second); }
    }),
    updateMember: (uid, patch) => wrap(() => F.updateDoc(F.doc(db, "users", uid), clean(patch))),

    importSeed: ({ overwrite = false } = {}) => wrap(async () => {
      const [hb, sp, br] = await Promise.all([list("handbook"), list("sops"), list("brands")]);
      const have = { handbook: new Set(hb.map((x) => x.id)), sops: new Set(sp.map((x) => x.id)), brands: new Set(br.map((x) => x.id)) };
      const batch = F.writeBatch(db);
      const res = { handbook: 0, sops: 0, brands: 0 };
      for (const m of SEED.handbook) if (overwrite || !have.handbook.has(m.id)) { batch.set(F.doc(db, "handbook", m.id), { ...clean(m), updatedAt: now() }); res.handbook++; }
      for (const s of SEED.sops) if (overwrite || !have.sops.has(s.id)) { batch.set(F.doc(db, "sops", s.id), { ...clean(s), updatedAt: now() }); res.sops++; }
      for (const b of SEED.brands) if (!have.brands.has(b.id)) { batch.set(F.doc(db, "brands", b.id), clean(b)); res.brands++; }
      await batch.commit();
      return res;
    }),
  };
}

export async function createStore(config, isConfigured) {
  if (!isConfigured()) return createDemoStore();
  return createFirebaseStore(config);
}
