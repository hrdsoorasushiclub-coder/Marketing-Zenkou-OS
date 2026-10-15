// Pengingat terjadwal 0915 WIB (cron memakai UTC: 15 2 * * *). Hanya mengirim ke member yang masih punya job belum selesai.
import { runScheduled } from "./lib/push.mjs";

export default async () => {
  try { await runScheduled("0915"); } catch (e) { console.error("[reminder 0915]", e.message); }
  return new Response("ok");
};

export const config = { schedule: "15 2 * * *" };
