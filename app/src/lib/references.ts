/** Katie's reference photos (2026-10-25: "save all the photos that I send you ... that's the only way you're going to deal with all the
 *  edge case scenarios and all the bespoke bags"). Each photo she sends is kept privately with its correct identification in
 *  Fashion Data Lab/photos/reference/reference.jsonl; the photo reader compares a new photo with these, picture to picture. Never shown. */
import fs from "node:fs";
import path from "node:path";

export type RefPhoto = { file: string; house: string; model: string; spec: string; era: string; source: string; catalog_ref: string | null; multi?: boolean };
const DIR = process.env.TRACKER_REFERENCE_DIR ?? "/Users/katiegraves/Desktop/Fashion Data Lab/photos/reference";
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function referencePhotos(house: string, words: string, limit = 6): (RefPhoto & { data: string; mediaType: string })[] {
  let rows: RefPhoto[] = [];
  try { rows = fs.readFileSync(path.join(DIR, "reference.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as RefPhoto); } catch { return []; }
  const h = fold(house).split(" ")[0]; const w = new Set(fold(words).split(/[^a-z0-9]+/).filter((x) => x.length > 2));
  const same = rows.filter((r) => !r.multi && fold(r.house).startsWith(h));
  // most shared words with the first reading first, one photo per identification
  const seen = new Set<string>();
  return same.map((r) => ({ r, s: fold(`${r.model} ${r.spec}`).split(/[^a-z0-9]+/).filter((x) => w.has(x)).length }))
    .sort((a, b) => b.s - a.s).filter(({ r }) => { const k = `${r.model}|${r.spec}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit)
    .flatMap(({ r }) => { try { const ext = path.extname(r.file).slice(1).toLowerCase(); const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      return [{ ...r, mediaType, data: fs.readFileSync(path.join(DIR, r.file)).toString("base64") }]; } catch { return []; } });
}
