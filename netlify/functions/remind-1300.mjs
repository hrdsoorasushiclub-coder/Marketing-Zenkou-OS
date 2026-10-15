// Pengingat terjadwal 1300 WIB (cron memakai UTC: 0 6 * * *). Hanya mengirim ke member yang masih punya job belum selesai.
import { runScheduled } from "./lib/push.mjs";

export default async () => {
  try { await runScheduled("1300"); } catch (e) { console.error("[reminder 1300]", e.message); }
  return new Response("ok");
};

export const config = { schedule: "0 6 * * *" };
