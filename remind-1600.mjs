// Pengingat terjadwal 1600 WIB (cron memakai UTC: 0 9 * * *). Hanya mengirim ke member yang masih punya job belum selesai.
import { runScheduled } from "./lib/push.mjs";

export default async () => {
  try { await runScheduled("1600"); } catch (e) { console.error("[reminder 1600]", e.message); }
  return new Response("ok");
};

export const config = { schedule: "0 9 * * *" };
