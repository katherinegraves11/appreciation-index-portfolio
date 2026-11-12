import { raceBoard } from "@/lib/tracker";
import RaceBoard from "@/components/RaceBoard";

export const dynamic = "force-dynamic";

export default function Race() {
  const rows = raceBoard();
  return (
    <main>
      <section className="bookhead">
        <p className="lab">the race · {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }).toLowerCase()}</p>
        <h1 className="vh">Which houses hold value <i>on resale.</i></h1>
        <p className="hint">Three things, in plain terms: which houses <b>sell fastest right now</b>, which <b>keep their value</b> (bags sold close to the store price), and which <b>lose the most</b> (bags sold far below it).<br /><b>Up</b> = sells faster. <b>Right</b> = sold closer to the store price. From {rows.length} houses in the tracker, confirmed sales only.</p>
      </section>
      <RaceBoard rows={rows} />
    </main>
  );
}
