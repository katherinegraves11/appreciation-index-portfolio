import { SECTION_SOURCES } from "@/lib/cards";
import { COVERED_HOUSES } from "@/lib/houses";

/** About: every thing a customer sees on an answer, in the order they see it, as "when you see X, it means Y". */
export default function About() {
  const S = SECTION_SOURCES;
  return (
    <main>
      <section className="bookhead"><p className="lab">about</p><h1 className="vh">How we <i>decide.</i></h1><p className="hint">Everything you see on an answer, in the order you see it, and what it means.</p></section>
      <div className="about">
        <h3 className="ah">The houses we cover</h3>
        <p className="asub">For now, 16 houses: {COVERED_HOUSES.join(", ")}. Ask about a bag from one of them. More are coming.</p>

        <h3 className="ah">The dial <span className="dim">(1 year · 3 years · forever)</span></h3>
        <p className="asub">The dial picks the question you care about. It changes which question leads the page and the order of the answers. The evidence behind the answer is the same.</p>
        <div className="abox4">
          <div className="abox"><h4>1 year</h4><p>Is it worth the money today?</p></div>
          <div className="abox"><h4>3 years</h4><p>Will I get my money back?</p></div>
          <div className="abox"><h4>Forever bag</h4><p>Is it a bag to pass down?</p></div>
        </div>

        <h3 className="ah">How are you buying it?</h3>
        <p className="asub">Pick how you are buying, and the answer under it changes.</p>
        <div className="abox2">
          <div className="abox"><h4>New, at the boutique</h4><p><b>Yes</b> means you would keep at least 10% more than the boutique price by reselling, after fees. When you would keep 50% or more, it says <b>consider selling it right away</b>: a big payday. <b>No</b> means it is not worth more secondhand, so buy it to wear.</p></div>
          <div className="abox"><h4>Pre-loved, at a price</h4><p>Your quote, or the typical asking price. <b>Likely</b> means it should be worth more in five years after selling fees. <b>Maybe</b> means about what you paid. <b>Unlikely</b> means less.</p></div>
        </div>

        <h3 className="ah">The four answers</h3>
        <p className="asub">Every answer asks four questions and answers each <b className="b">Yes</b>, <b className="w">Not yet</b> or <b className="d">No</b>; a three-year figure is a forecast, so it says <b className="b">Likely</b>.</p>
        <div className="abox4">
          <div className="abox"><h4>Resell within a year?</h4><p className="when"><b>Yes when</b> real sales beat the new price and bags sell fast.</p></div>
          <div className="abox"><h4>Hold three years?</h4><p className="when"><b>Likely when</b> what you would get back in three years, even at the low end and in today&apos;s money, beats what you paid.</p></div>
          <div className="abox"><h4>A forever bag?</h4><p className="when"><b>A forever bag</b> when it&apos;s a shape the house has made for decades, with its price history shown; <b>a moment</b> when it&apos;s a one-season print. No dollar figure: nobody can price a bag twenty years out.</p></div>
          <div className="abox"><h4>Just to wear?</h4><p className="when"><b>Yes</b> almost always. If a boutique price rise is near, buy before it.</p></div>
        </div>

        <h3 className="ah">&ldquo;Based on 5 sales and 3 asking prices&rdquo;</h3>
        <p className="asub">Under the answer we say what it rests on: how many real sales, pre-loved asking prices and sourcer quotes we found for this bag. <b>A solid read</b> means at least five sales and ten prices in all. <b>A fair read</b> means four or more prices. <b>A thin read</b> means fewer, so treat the answer as a first look.</p>

        <h3 className="ah">Behind &ldquo;show me why&rdquo;</h3>
        <p className="asub">Tap &ldquo;show me why&rdquo; for the evidence. Each card says what it measures and where its numbers come from. Its small stamp reads <b>good sign</b>, <b>weak spot</b> or <b>mixed</b> for that part of the picture.</p>
        <div className="abox2">
          <div className="abox"><h4>Where it&apos;s heading</h4><p>Which way this bag&apos;s numbers are moving: our forecast. We weigh four things: searches against a year ago, how fast the boutique raises its price, pre-loved asking prices between our reads, and auction prices against their estimates. It reads &ldquo;an early read&rdquo; unless three of them agree.</p></div>
          <div className="abox"><h4>The money</h4><p>{S.money.about} {S.money.from}</p></div>
          <div className="abox"><h4>The group chat</h4><p>{S.culture.about} {S.culture.from}</p></div>
          <div className="abox"><h4>The designer</h4><p>{S.designer.about} {S.designer.from}</p></div>
          <div className="abox"><h4>The business</h4><p>{S.business.about} {S.business.from}</p></div>
          <div className="abox"><h4>The big picture</h4><p>{S.world.about} {S.world.from}</p></div>
        </div>

        <h3 className="ah">Three prices</h3>
        <p className="asub">The boutique price is the only fixed price. Everything pre-loved is an average: what bags sold for, what websites ask, and, separately, what private sourcers quote, since they set their own price. Every average shows how many prices it rests on.</p>

        <h3 className="ah">My bags and the sell sun</h3>
        <p className="asub">Tap <b>I&apos;m buying it</b> on any answer and add what you paid. The bag moves to My bags, kept on this device. Every time you open My bags we compare what the bag sells for today, after a typical resale fee, with what you paid, and check which way its trends point in the daily reads. The sun shows where that leaves you.</p>
        <div className="abox4">
          <div className="abox"><h4>Sunrise</h4><p>Hold. It is still climbing.</p><p className="when"><b>When</b> its trends point up.</p></div>
          <div className="abox"><h4>Midday</h4><p>Steady. Keep wearing it.</p><p className="when"><b>When</b> trends are flat or mixed, and you are less than 20% up after fees.</p></div>
          <div className="abox"><h4>Golden hour</h4><p>Worth watching.</p><p className="when"><b>When</b> you would keep 20% or more than you paid after fees, and trends are no longer rising.</p></div>
          <div className="abox"><h4>Sunset</h4><p>Time to consider selling.</p><p className="when"><b>When</b> you would keep double what you paid after fees, whatever the trends; or you would keep 50% more and trends are no longer rising; or trends point down and you would at least break even.</p></div>
        </div>
        <p className="asub">Condition matters most. On My bags you can set each bag&apos;s condition now, and its resale estimate and sun change with it. From sold listings on The RealReal: against a bag carried with care, a never-carried Hermès sells for about 24% more; a scuff or light wear, about 19% less; a stain or visible wear, about 37% less; heavy wear, about half. For other houses the steps are similar. A read on today&apos;s numbers, not a promise.</p>

        <div className="abox2">
          <div className="abox"><h4>Ask by photo</h4><p>Drop a photo or a listing screenshot. We name the bag, you confirm, and the answer runs. Photos are read once and not kept, unless you tick "Keep my photos" for faster matching; kept photos are private and never shown to anyone else.</p></div>
          <div className="abox"><h4>Where the numbers come from</h4><p>Sales and asks: The RealReal, Fashionphile, Rebag, Madison Avenue Couture, Privé Porter, Jane Finds, the auction houses. New prices: the houses and the guides that track them. Runway: Vogue. People and money: Vogue Business. Every number keeps its source.</p></div>
          <div className="abox"><h4>Which market</h4><p>The United States, in dollars. New prices are what the US boutiques charge; sales and asks come from the US resale platforms. A bag bought in Paris or Tokyo costs a different sum, and the answer is for the buyer paying in dollars.</p></div>
        </div>
        <p className="asub" style={{ marginTop: 30 }}>Value-retention analysis of the US market, in dollars, based on public market data, not investment advice.</p>
      </div>
    </main>
  );
}
