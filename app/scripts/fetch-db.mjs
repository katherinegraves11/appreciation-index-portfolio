// Download the read-only SQLite copies the app needs. Atomic: writes a temp file, then renames.
// TRACKER_DB_URL -> TRACKER_DB_PATH (default /data/tracker.db); TRENDS_DB_URL -> TRENDS_DB_PATH (default /data/trends.db).
import fs from "node:fs";
import path from "node:path";
const jobs = [
  { name: "tracker", url: process.env.TRACKER_DB_URL, dest: process.env.TRACKER_DB_PATH || "/data/tracker.db", min: 1_000_000 },
  { name: "trends", url: process.env.TRENDS_DB_URL, dest: process.env.TRENDS_DB_PATH || "/data/trends.db", min: 8_192 },
];
let failed = false;
for (const j of jobs) {
  if (!j.url) continue;
  try {
    const res = await fetch(j.url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < j.min || buf.subarray(0, 15).toString() !== "SQLite format 3") throw new Error("not a SQLite file");
    fs.mkdirSync(path.dirname(j.dest), { recursive: true });
    fs.writeFileSync(j.dest + ".tmp", buf);
    fs.renameSync(j.dest + ".tmp", j.dest);
    console.log(`${j.name}.db refreshed (${(buf.length / 1e6).toFixed(1)} MB)`);
  } catch (e) { console.error(`${j.name} download failed: ${e.message}`); failed = true; }
}
process.exit(failed ? 1 : 0);
