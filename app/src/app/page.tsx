import Ask, { type Done } from "@/components/Ask";
import { getBrief } from "@/lib/db";
import { quickNumbers } from "@/lib/tracker";

export const dynamic = "force-dynamic";

/** Home. `?brief=<id>` reopens a saved answer in the simple view (My bags links here). */
export default async function Home({ searchParams }: { searchParams: Promise<{ brief?: string }> }) {
  const { brief } = await searchParams;
  let initial: Done | null = null;
  if (brief) {
    const b = await getBrief(brief).catch(() => null);
    if (b) initial = { result: b.result, id: b.id, bagName: `${b.house} · ${b.bag}${b.spec ? ` · ${b.spec}` : ""}`, numbers: quickNumbers(b.house, b.bag, b.spec || undefined, b.notes) };
  }
  return (
    <main>
      <Ask initial={initial} />
    </main>
  );
}
