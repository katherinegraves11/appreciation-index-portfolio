"use client";
/** Condition now, for a bag in My bags: a scuff or a stain lowers what it would resell for. Kept in the "bought" cookie on this device. */
export const CONDITIONS: { code: string; label: string }[] = [
  { code: "P", label: "Never carried" },
  { code: "E", label: "Carried with care" },
  { code: "VG", label: "A scuff or light wear" },
  { code: "G", label: "A stain or visible wear" },
  { code: "F", label: "Heavy wear" },
];

export default function BagCondition({ id, current }: { id: string; current: string }) {
  function set(code: string) {
    try {
      const entries = (document.cookie.match(/(?:^|; )bought=([^;]*)/)?.[1] ?? "").split(",").filter(Boolean)
        .map((e) => { const [i, price, date] = e.split(":"); return i === id ? `${i}:${price}:${date}:${code}` : e; });
      document.cookie = `bought=${entries.join(",")}; path=/; max-age=31536000; samesite=lax`;
      window.location.reload();
    } catch { /* cookies blocked */ }
  }
  return (
    <label className="condnow">
      Condition now
      <select value={current} onChange={(e) => set(e.target.value)}>
        {CONDITIONS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
      </select>
    </label>
  );
}
