// Pembantu pengingat: Firestore REST + FCM HTTP v1 memakai service account. Tanpa dependensi npm (Node 18+).
//
// Environment variable (Netlify > Site configuration > Environment variables):
//   FIREBASE_SERVICE_ACCOUNT : isi file JSON service account dalam satu baris
//     ATAU pisahkan: FCM_CLIENT_EMAIL + FCM_PRIVATE_KEY (batas total env Netlify sekitar 4 KB; pisah bila IG_ACCOUNTS sudah besar)
//   FIREBASE_PROJECT_ID      : opsional bila sudah ada di service account
import crypto from "node:crypto";

export const TZ_OFFSET_H = 7; // WIB
const b64u = (x) => Buffer.from(x).toString("base64url");

function creds() {
  let c = null;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try { c = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); } catch { throw new Error("FIREBASE_SERVICE_ACCOUNT bukan JSON yang valid."); }
  } else if (process.env.FCM_CLIENT_EMAIL && process.env.FCM_PRIVATE_KEY) {
    c = { client_email: process.env.FCM_CLIENT_EMAIL, private_key: process.env.FCM_PRIVATE_KEY, project_id: process.env.FIREBASE_PROJECT_ID };
  }
  if (!c?.client_email || !c?.private_key) throw new Error("Service account belum dipasang (FIREBASE_SERVICE_ACCOUNT).");
  c.private_key = String(c.private_key).replace(/\\n/g, "\n");
  c.project_id = c.project_id || process.env.FIREBASE_PROJECT_ID;
  if (!c.project_id) throw new Error("FIREBASE_PROJECT_ID belum diatur.");
  return c;
}
export const projectId = () => creds().project_id;

let cache = { token: "", exp: 0 };
async function accessToken() {
  if (cache.token && cache.exp > Date.now() + 60000) return cache.token;
  const c = creds();
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(JSON.stringify({ iss: c.client_email, scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${claim}`).sign(c.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gagal masuk sebagai service account: ${j.error_description || j.error || r.status}`);
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cache.token;
}

/* ---------- Firestore (REST) ---------- */
const docsBase = () => `https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)/documents`;
const decode = (v) => {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]));
  return null;
};
const fromDoc = (d) => ({ id: d.name.split("/").pop(), path: d.name, ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, decode(v)])) });
async function fs(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json", ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}
export async function listDocs(collection) {
  const out = []; let page = "";
  do {
    const r = await fs(`${docsBase()}/${collection}?pageSize=300${page ? `&pageToken=${page}` : ""}`);
    if (!r.ok) throw new Error(`Firestore ${collection}: ${r.json?.error?.message || r.status}`);
    (r.json.documents || []).forEach((d) => out.push(fromDoc(d)));
    page = r.json.nextPageToken || "";
  } while (page);
  return out;
}
export async function recentJobs(brandId, fromDate, toDate) {
  const f = (op, v) => ({ fieldFilter: { field: { fieldPath: "date" }, op, value: { stringValue: v } } });
  const r = await fs(`${docsBase()}/brands/${encodeURIComponent(brandId)}:runQuery`, {
    method: "POST",
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "job_assignments" }], where: { compositeFilter: { op: "AND", filters: [f("GREATER_THAN_OR_EQUAL", fromDate), f("LESS_THAN_OR_EQUAL", toDate)] } } } }),
  });
  if (!r.ok) throw new Error(`Firestore job ${brandId}: ${r.json?.error?.message || r.status}`);
  return (r.json || []).filter((x) => x.document).map((x) => ({ ...fromDoc(x.document), brandId }));
}
export async function deleteDoc(collection, id) { await fs(`${docsBase()}/${collection}/${encodeURIComponent(id)}`, { method: "DELETE" }); }
// Penanda "slot ini sudah dikirim" supaya jadwal yang terpanggil dua kali tidak mengirim ganda.
export async function claimSlot(id) {
  const r = await fs(`${docsBase()}/reminder_log?documentId=${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ fields: { at: { timestampValue: new Date().toISOString() } } }) });
  return r.ok; // 409 = sudah ada
}

/* ---------- waktu WIB ---------- */
export const wibNow = () => new Date(Date.now() + TZ_OFFSET_H * 3600 * 1000);
export const wibDate = (d = wibNow()) => d.toISOString().slice(0, 10);
export const addDaysStr = (s, n) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

/* ---------- aturan job (sama dengan js/views/jobs.js) ---------- */
const items = (j) => j.items || [];
const isDone = (j) => items(j).length > 0 && items(j).every((i) => i.done);
export const isUnfinished = (j, today) => !j.cancelled && j.date <= today && !isDone(j);

// { uid -> { name, jobs: [...] } } untuk semua brand (atau satu brand / satu orang).
export async function unfinishedByPerson({ brandIds, uid, lookbackDays = 45 } = {}) {
  const today = wibDate();
  let brands = brandIds;
  if (!brands) brands = (await listDocs("brands")).map((b) => b.id);
  const lists = await Promise.all(brands.map((b) => recentJobs(b, addDaysStr(today, -lookbackDays), today)));
  const people = new Map();
  for (const j of lists.flat()) {
    if (!j.assigneeUid || (uid && j.assigneeUid !== uid) || !isUnfinished(j, today)) continue;
    if (!people.has(j.assigneeUid)) people.set(j.assigneeUid, { uid: j.assigneeUid, name: j.assigneeName || "", jobs: [] });
    people.get(j.assigneeUid).jobs.push(j);
  }
  return { today, people: [...people.values()] };
}
export const progressOf = (p, today) => {
  const total = p.jobs.reduce((s, j) => s + items(j).length, 0);
  const done = p.jobs.reduce((s, j) => s + items(j).filter((i) => i.done).length, 0);
  return { jobs: p.jobs.length, late: p.jobs.filter((j) => j.date < today).length, total, done };
};

/* ---------- FCM ---------- */
// Pesan data-only: service worker di HP yang menampilkan notifikasi (supaya bisa memakai getar).
async function sendOne(device, data) {
  const r = await fs(`https://fcm.googleapis.com/v1/projects/${projectId()}/messages:send`, {
    method: "POST",
    body: JSON.stringify({ message: { token: device.token, data, webpush: { headers: { Urgency: "high", TTL: "7200" } } } }),
  });
  if (r.ok) return true;
  const err = r.json?.error || {};
  const dead = r.status === 404 || err.status === "NOT_FOUND" || (err.details || []).some((d) => d.errorCode === "UNREGISTERED") || (r.status === 400 && err.status === "INVALID_ARGUMENT");
  if (dead) await deleteDoc("push_devices", device.id).catch(() => {});
  return false;
}

// Kirim ke semua perangkat milik tiap orang. build(person, progress) -> { title, body }.
export async function notifyPeople(people, today, build, extra = {}) {
  if (!people.length) return { people: 0, devices: 0, sent: 0, noDevice: [] };
  const devices = await listDocs("push_devices");
  const byUid = new Map();
  devices.forEach((d) => { if (d.token && d.uid) (byUid.get(d.uid) || byUid.set(d.uid, []).get(d.uid)).push(d); });
  let sent = 0, count = 0; const noDevice = [];
  await Promise.all(people.map(async (p) => {
    const ds = byUid.get(p.uid) || [];
    if (!ds.length) { noDevice.push(p.name || p.uid); return; }
    const m = build(p, progressOf(p, today));
    const data = { title: m.title, body: m.body, url: "/#/jobs", tag: extra.tag || "zenkou-reminder", ...Object.fromEntries(Object.entries(extra.data || {}).map(([k, v]) => [k, String(v)])) };
    const res = await Promise.all(ds.map((d) => sendOne(d, data)));
    count += ds.length; sent += res.filter(Boolean).length;
  }));
  return { people: people.length, devices: count, sent, noDevice };
}

const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
export function scheduledText(slot) {
  const lead = { "0915": "Mulai hari ini", "1300": "Cek tengah hari", "1600": "Sebelum jam pulang" }[slot] || "Pengingat job";
  return (p, g) => ({
    title: `${lead}: ${g.jobs} job belum selesai`,
    body: `${first(p.name) ? first(p.name) + ", " : ""}checklist baru ${g.done}/${g.total}${g.late ? `, ${g.late} job tertunda dari hari lalu` : ""}. Ketuk untuk membuka job.`,
  });
}

export async function runScheduled(slot) {
  const today = wibDate();
  if (!(await claimSlot(`${today}-${slot}`))) return { skipped: "sudah dikirim" };
  const { people } = await unfinishedByPerson();
  const res = await notifyPeople(people, today, scheduledText(slot), { tag: `zenkou-${slot}` });
  console.log(`[reminder ${slot}] ${JSON.stringify(res)}`);
  return res;
}

/* ---------- verifikasi pemanggil (token Firebase pengguna, dibaca lewat Firestore dengan token miliknya) ---------- */
export async function callerFrom(req) {
  const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!idToken) return null;
  let uid;
  try { uid = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString()).user_id; } catch { return null; }
  const r = await fetch(`${docsBase()}/users/${uid}`, { headers: { authorization: `Bearer ${idToken}` } });
  if (!r.ok) return null;
  const u = fromDoc(await r.json());
  if (u.active === false) return null;
  return { uid, name: u.name || "", role: u.role, brands: u.brands || [], lead: u.role === "supervisor" || u.role === "executive" };
}
