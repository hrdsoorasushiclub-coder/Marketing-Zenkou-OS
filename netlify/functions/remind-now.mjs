// POST /.netlify/functions/remind-now
//   { note?: string, brandId?: string, uid?: string }   -> supervisor/executive: ingatkan member yang punya job belum selesai
//   { test: true }                                      -> kirim notifikasi uji ke perangkat milik pemanggil sendiri
import { callerFrom, unfinishedByPerson, notifyPeople, listDocs, wibDate } from "./lib/push.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Gunakan POST." });
  try {
    const me = await callerFrom(req);
    if (!me) return json(401, { error: "Harus login." });
    const b = await req.json().catch(() => ({}));

    if (b.test) {
      const res = await notifyPeople([{ uid: me.uid, name: me.name, jobs: [] }], wibDate(), () => ({ title: "Tes pengingat Zenkou", body: "Kalau ini muncul dan HP bergetar, pengingat sudah berfungsi." }), { tag: "zenkou-test" });
      return json(200, res);
    }

    if (!me.lead) return json(403, { error: "Hanya Supervisor atau Executive yang bisa mengingatkan tim." });
    const all = me.brands.includes("*");
    let brandIds;
    if (b.brandId) { if (!all && !me.brands.includes(b.brandId)) return json(403, { error: "Kamu tidak punya akses ke brand ini." }); brandIds = [b.brandId]; }
    else brandIds = all ? (await listDocs("brands")).map((x) => x.id) : me.brands;

    const { today, people } = await unfinishedByPerson({ brandIds, uid: b.uid });
    const note = String(b.note || "").trim().slice(0, 160);
    const res = await notifyPeople(people, today, (p, g) => ({
      title: `${me.name || "Supervisor"} mengingatkan: ${g.jobs} job belum selesai`,
      body: note ? `${note} (checklist ${g.done}/${g.total})` : `${(p.name || "").split(/\s+/)[0] || "Halo"}, checklist baru ${g.done}/${g.total}${g.late ? `, ${g.late} job tertunda` : ""}. Ketuk untuk membuka job.`,
    }), { tag: "zenkou-manual", data: { manual: 1 } });
    return json(200, res);
  } catch (e) { return json(500, { error: e.message || "Gagal mengirim pengingat." }); }
};
