// Proxy Instagram Graph API untuk halaman Report.
// Token Instagram disimpan di environment variable Netlify, tidak pernah dikirim ke browser.
//
// Environment variable yang dibutuhkan (Netlify > Site configuration > Environment variables):
//   FIREBASE_PROJECT_ID : id project Firebase (sama dengan projectId di js/config.js)
//   IG_ACCOUNTS         : JSON per brand, contoh:
//     {"soora-sushi-club":{"igUserId":"1784...","token":"EAAG..."},
//      "bulan-purnama":{"igUserId":"1784...","token":"EAAG...","host":"graph.facebook.com"}}
//   Kunci JSON = id brand di OS. "host" opsional (default graph.facebook.com;
//   pakai graph.instagram.com bila memakai Instagram API with Instagram Login).

const V = "v23.0";
const json = (code, body) => ({ statusCode: code, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Pastikan pemanggil sudah login dan boleh mengakses brand ini (baca dokumen users/{uid} dengan token miliknya).
async function canAccess(idToken, brandId) {
  const pid = process.env.FIREBASE_PROJECT_ID;
  if (!pid || !idToken) return false;
  const [, payload] = idToken.split(".");
  let uid;
  try { uid = JSON.parse(Buffer.from(payload, "base64url").toString()).user_id; } catch { return false; }
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/users/${uid}`, { headers: { authorization: `Bearer ${idToken}` } });
  if (!r.ok) return false;
  const f = (await r.json()).fields || {};
  if (f.active?.booleanValue === false) return false;
  const brands = (f.brands?.arrayValue?.values || []).map((v) => v.stringValue);
  return brands.includes("*") || brands.includes(brandId);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Gunakan POST." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Isi permintaan tidak valid." }); }
  const { brandId, since, until } = body;
  if (!brandId || !/^\d{4}-\d{2}-\d{2}$/.test(since || "") || !/^\d{4}-\d{2}-\d{2}$/.test(until || "")) return json(400, { error: "brandId, since, until (YYYY-MM-DD) wajib diisi." });

  const idToken = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
  if (!(await canAccess(idToken, brandId))) return json(403, { error: "Kamu tidak punya akses ke brand ini." });

  let accounts;
  try { accounts = JSON.parse(process.env.IG_ACCOUNTS || "{}"); } catch { return json(500, { error: "IG_ACCOUNTS bukan JSON yang valid." }); }
  const acc = accounts[brandId];
  if (!acc?.token || !acc?.igUserId) return json(404, { error: `Akun Instagram untuk brand "${brandId}" belum dipasang di IG_ACCOUNTS.` });

  const host = acc.host || "graph.facebook.com";
  const call = async (url) => {
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error?.message || `Graph API ${r.status}`);
    return j;
  };
  const g = (path, params) => {
    const u = new URL(`https://${host}/${V}/${path}`);
    for (const [k, v] of Object.entries({ ...params, access_token: acc.token })) u.searchParams.set(k, v);
    return call(u);
  };

  try {
    const prof = await g(acc.igUserId, { fields: "username,followers_count,media_count" });

    // Ambil media terbaru mundur sampai melewati tanggal awal periode.
    const end = new Date(until + "T23:59:59+07:00").getTime();
    const start = new Date(since + "T00:00:00+07:00").getTime();
    const MAX = 150;
    let page = await g(`${acc.igUserId}/media`, { fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count", limit: 50 });
    const media = [];
    let truncated = false;
    for (let i = 0; i < 12; i++) {
      let older = false;
      for (const m of page.data || []) {
        const t = new Date(m.timestamp).getTime();
        if (t < start) { older = true; continue; }
        if (t <= end) media.push(m);
      }
      if (older || !page.paging?.next) break;
      page = await call(page.paging.next);
    }
    if (media.length > MAX) { media.length = MAX; truncated = true; }

    const METRICS = ["reach,saved,shares,total_interactions,views", "reach,saved,total_interactions"];
    const insights = async (id) => {
      for (const metric of METRICS) {
        try {
          const j = await g(`${id}/insights`, { metric });
          const o = {};
          for (const d of j.data || []) o[d.name] = d.values?.[0]?.value ?? d.total_value?.value ?? null;
          return o;
        } catch { /* coba set metrik yang lebih kecil */ }
      }
      return {};
    };
    const kind = (m) => (m.media_product_type === "REELS" ? "Reels" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : m.media_type === "VIDEO" ? "Video" : "Feed Post");

    const posts = [];
    for (let i = 0; i < media.length; i += 10) {
      const chunk = media.slice(i, i + 10);
      const ins = await Promise.all(chunk.map((m) => insights(m.id)));
      chunk.forEach((m, j) => posts.push({
        id: m.id, date: m.timestamp.slice(0, 10), type: kind(m), permalink: m.permalink || "", caption: (m.caption || "").slice(0, 140),
        likes: m.like_count ?? 0, comments: m.comments_count ?? 0,
        reach: ins[j].reach ?? null, views: ins[j].views ?? null, saved: ins[j].saved ?? null, shares: ins[j].shares ?? null, interactions: ins[j].total_interactions ?? null,
      }));
    }
    return json(200, { profile: { username: prof.username, followers: prof.followers_count, mediaCount: prof.media_count }, posts, truncated });
  } catch (e) {
    return json(502, { error: "Instagram: " + (e.message || String(e)) });
  }
};
