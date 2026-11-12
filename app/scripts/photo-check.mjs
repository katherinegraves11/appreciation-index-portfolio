// Photo checklist (Katie, 2026-10-25: "save all the photos that I send you"): every labelled reference photo, and the real Baguettes
// that must stay Baguettes, are read by the live photo reader; each must come back as its own identification. Usage: node scripts/photo-check.mjs
import fs from "node:fs"; import path from "node:path";
const CODE_FILE = `${process.env.HOME}/Desktop/Appreciation Index passcode.txt`;
const GATE = fs.existsSync(CODE_FILE) ? { cookie: `bagindex_access=${encodeURIComponent(fs.readFileSync(CODE_FILE, "utf8").trim())}` } : {};
const DIR = "/Users/katiegraves/Desktop/Fashion Data Lab/photos/reference", T = "/Users/katiegraves/Desktop/Appreciation test photos";
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cases = fs.readFileSync(path.join(DIR, "reference.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.multi).map((r) => ({ file: path.join(DIR, r.file), want: r.model, not: /baguette/i.test(r.model) && !/mamma/i.test(r.model) ? "mamma" : null }));
cases.push({ file: path.join(T, "46.jpg"), want: "Baguette", not: "mamma" }, { file: path.join(T, "47.jpg"), want: "Baguette", not: "mamma" });
let fail = 0;
for (const c of cases) {
  const ext = path.extname(c.file).slice(1).toLowerCase(); const mt = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  const r = await fetch("http://localhost:3000/api/identify?fresh=1", { method: "POST", headers: { "content-type": "application/json", ...GATE }, body: JSON.stringify({ image: `data:${mt};base64,${fs.readFileSync(c.file).toString("base64")}` }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
  const got = `${r.model ?? ""}`; const ok = fold(got).includes(fold(c.want)) && !(c.not && fold(got).includes(c.not));
  if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${path.basename(c.file)}: want "${c.want}", got "${r.house ?? ""} ${got}" ${r.designer_era ? `(${r.designer_era})` : ""}`);
}
console.log(`\n${cases.length - fail} of ${cases.length} photos read right`); if (fail) process.exit(1);
