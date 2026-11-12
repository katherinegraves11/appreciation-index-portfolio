import Catalogue from "@/components/Catalogue";
import { catalogue } from "@/lib/tracker";

export const dynamic = "force-dynamic";

/** Browse: every bag the tracker prices, drawn, as one ruled catalogue. Tap a cell and the tool asks about it. */
export default function Browse() {
  const rows = catalogue();
  return (
    <main>
      <section className="bookhead">
        <p className="lab">browse · {rows.length} bags we price</p>
        <h1 className="vh">Pick a bag <i>by sight.</i></h1>
        <p className="hint">Drawn, not photographed: the plates are ours. Each cell shows today&apos;s boutique price and, where we have confirmed sales, what the bag actually sold for against it. Tap any bag to ask about it.</p>
      </section>
      <Catalogue rows={rows} />
    </main>
  );
}
