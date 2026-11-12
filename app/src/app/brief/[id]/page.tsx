import { notFound } from "next/navigation";
import { getBrief } from "@/lib/db";
import BriefView from "@/components/BriefView";

export const dynamic = "force-dynamic";

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brief = await getBrief(id);
  if (!brief) notFound();
  return (
    <main className="wrap">
      <BriefView brief={brief} />
    </main>
  );
}
