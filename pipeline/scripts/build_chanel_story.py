#!/usr/bin/env python3
"""Builds site/chanel_wtp.html: an editorial, plain-language data story on Chanel resale vs retail by designer era."""
import sqlite3, json, datetime as dt
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
OUT = "/Users/katiegraves/Desktop/Fashion Data Lab/site/chanel_wtp.html"
con = sqlite3.connect(DB)

LINES = [  # line, launch year, designer, one plain-English line about the bag
 ("Reissue 2.55", 1955, "Coco Chanel", "Coco's original 1955 design, re-released by Lagerfeld in 2005. Most of what's on resale is older and well-worn."),
 ("Classic Flap", 1983, "Karl Lagerfeld", "The bag people mean when they say 'a Chanel'. Lagerfeld added the CC turnlock in 1983."),
 ("Boy", 2011, "Karl Lagerfeld", "Lagerfeld's boxy, chain-heavy 2011 hit. Everywhere for a decade, then the market moved on."),
 ("Deauville", 2012, "Karl Lagerfeld", "A canvas tote. Cheap to buy new, so even a modest resale price is a high share of retail."),
 ("Trendy CC", 2014, "Karl Lagerfeld", "Top-handle flap with the metal CC plate."),
 ("Coco Handle", 2015, "Karl Lagerfeld", "Structured top-handle, quietly one of the better holders of value."),
 ("Gabrielle", 2017, "Karl Lagerfeld", "The slouchy hobo launched with a star-studded campaign. The campaign is over."),
 ("Chanel 19", 2019, "Karl Lagerfeld", "Lagerfeld's last design, finished and launched by Viard the year he died."),
 ("Chanel 22", 2022, "Virginie Viard", "Viard's soft, logo-stamped hobo. Divisive at launch, holding up on resale."),
 ("Chanel 25", 2025, "Virginie Viard", "Launched Feb 2025 in the gap between Viard and Blazy. The only Chanel line reselling above the boutique price."),
 ("Blazy 2026 lines", 2026, "Matthieu Blazy", "Blazy's first bags (the Souplissimo and friends). Too few on resale yet to call it, but the early asks are high."),
]
trr = {r[0]: dict(tiles=r[1], n=r[2], pct=r[3], ask=r[4]) for r in con.execute("""
 select case when model_guess in ('Reissue 2.55','Classic Flap','Boy','Deauville','Trendy CC','Coco Handle','Gabrielle','Chanel 19','Chanel 22','Chanel 25') then model_guess
             when era_guess like 'Blazy%' then 'Blazy 2026 lines' end line,
        count(*), sum(est_retail is not null), round(avg(pct_of_retail),1), round(avg(price))
 from trr_item_reads where house='Chanel' group by 1 having line is not null""")}
sized = {r[0]: dict(size=r[1], retail=r[2], n=r[3], ask=r[4], pct=r[5]) for r in con.execute(
 "select model, matched_size, retail_now, n_listings_same_size, median_ask_same_size, retention_pct_same_size from v_retention_scoreboard_sized where house='Chanel'")}
rows = []
for line, yr, des, blurb in LINES:
    t = trr.get(line, {}); s = sized.get(line)
    if s:   # prefer real boutique price, same size
        rows.append(dict(line=line, year=yr, designer=des, blurb=blurb, cents=round(s["pct"]), basis="boutique",
                         retail=s["retail"], ask=s["ask"], n=s["n"], size=s["size"].lower(), trr_pct=t.get("pct"), trr_n=t.get("n")))
    elif t.get("n"):
        rows.append(dict(line=line, year=yr, designer=des, blurb=blurb, cents=round(t["pct"]), basis="trr",
                         retail=None, ask=t["ask"], n=t["n"], size=None, trr_pct=t.get("pct"), trr_n=t.get("n")))
retail_path = [(r[0][:4], r[1]) for r in con.execute("select effective_date, min(price) from retail_reference where house='Chanel' and model='Classic Flap' and is_reference_size=1 group by substr(effective_date,1,4) order by 1")]
n_tiles = con.execute("select count(*) from trr_item_reads where house='Chanel'").fetchone()[0]
n_list = con.execute("select count(*) from v_bag_listings where brand='Chanel'").fetchone()[0]
data = dict(rows=rows, retail_path=retail_path, n_tiles=n_tiles, n_listings=n_list, built=dt.date.today().isoformat())

COLORS = {"Coco Chanel": ["#b07a00", "#d9a53a"], "Karl Lagerfeld": ["#1f4e9c", "#6f9ee8"], "Virginie Viard": ["#0f7a5a", "#4fbf96"], "Matthieu Blazy": ["#c2451e", "#f28a60"]}
flap = sized.get("Classic Flap", {}); c25 = sized.get("Chanel 25", {}); boy = sized.get("Boy", {})
def money(v): return f"${v:,.0f}"

html = f"""<title>Chanel Resale Index</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500;6..96,600&family=Archivo:wght@400;500;600;700&display=swap">
<style>
:root{{color-scheme:light;--paper:#fbfaf7;--ink:#141311;--ink-2:#55524c;--ink-3:#8a867e;--rule:#e4e0d8;--panel:#f2efe8;--track:#ebe7df;
 --coco:#b07a00;--karl:#1f4e9c;--virginie:#0f7a5a;--matthieu:#c2451e;--parity:#141311;--tip:#141311;--tip-ink:#fbfaf7;}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{color-scheme:dark;--paper:#161513;--ink:#f3f0ea;--ink-2:#c3beb3;--ink-3:#8d887f;--rule:#2e2c28;--panel:#1f1e1b;--track:#2a2825;
 --coco:#d9a53a;--karl:#6f9ee8;--virginie:#4fbf96;--matthieu:#f28a60;--parity:#f3f0ea;--tip:#f3f0ea;--tip-ink:#161513;}}}}
:root[data-theme="dark"]{{color-scheme:dark;--paper:#161513;--ink:#f3f0ea;--ink-2:#c3beb3;--ink-3:#8d887f;--rule:#2e2c28;--panel:#1f1e1b;--track:#2a2825;
 --coco:#d9a53a;--karl:#6f9ee8;--virginie:#4fbf96;--matthieu:#f28a60;--parity:#f3f0ea;--tip:#f3f0ea;--tip-ink:#161513;}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--paper);color:var(--ink);font-family:Archivo,"Helvetica Neue",Arial,sans-serif;font-size:16px;line-height:1.5;padding-inline:16px;padding-block:0 48px;-webkit-font-smoothing:antialiased}}
.wrap{{max-width:1040px;margin:0 auto}}
.serif{{font-family:"Bodoni Moda",Didot,"Times New Roman",serif}}
.eyebrow{{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;color:var(--ink-2)}}
header{{padding-block:28px 8px;border-bottom:1px solid var(--ink)}}
.mast{{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap}}
h1{{font-family:"Bodoni Moda",Didot,serif;font-weight:500;font-size:clamp(34px,6vw,64px);line-height:1.02;letter-spacing:-.01em;margin:28px 0 18px;max-width:18ch;text-wrap:balance}}
.dek{{font-size:19px;line-height:1.45;color:var(--ink-2);max-width:62ch;margin:0 0 36px}}
.dek b{{color:var(--ink);font-weight:600}}
section{{padding-block:36px;border-top:1px solid var(--rule)}}
h2{{font-family:"Bodoni Moda",Didot,serif;font-weight:500;font-size:clamp(26px,3.6vw,38px);line-height:1.1;margin:8px 0 10px;text-wrap:balance}}
.lede{{color:var(--ink-2);max-width:62ch;margin:0 0 26px}}
/* 10-second tiles */
.tiles{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0;border:1px solid var(--rule)}}
.tile{{padding:22px 22px 20px;border-right:1px solid var(--rule)}}
.tile:last-child{{border-right:0}}
@media (max-width:760px){{.tile{{border-right:0;border-bottom:1px solid var(--rule)}}.tile:last-child{{border-bottom:0}}}}
.big{{font-family:"Bodoni Moda",Didot,serif;font-size:clamp(44px,6vw,64px);line-height:1;font-weight:500;margin:10px 0 8px;font-variant-numeric:tabular-nums}}
.big small{{font-size:.42em;color:var(--ink-2);font-family:Archivo,sans-serif;font-weight:500;margin-left:4px}}
.tile p{{margin:0;color:var(--ink-2);font-size:14.5px;line-height:1.45}}
/* chart */
.legend{{display:flex;gap:18px;flex-wrap:wrap;margin:0 0 18px;font-size:13px;color:var(--ink-2)}}
.legend span{{display:inline-flex;align-items:center;gap:7px}}
.sw{{width:12px;height:12px;border-radius:2px;display:inline-block}}
.chart{{position:relative}}
.axis{{position:relative;height:22px;margin-left:var(--lab);font-size:11.5px;color:var(--ink-3);font-variant-numeric:tabular-nums}}
.axis span{{position:absolute;transform:translateX(-50%)}}
.row{{display:grid;grid-template-columns:var(--lab) 1fr;gap:0 14px;align-items:center;padding:9px 0;border-top:1px solid var(--rule);cursor:default}}
.row:hover .bar{{filter:brightness(1.08)}}
.lab{{line-height:1.2}}
.lab .name{{font-weight:600;font-size:15px}}
.lab .yr{{font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}}
.trk{{position:relative;height:30px}}
.grid{{position:absolute;inset:0;pointer-events:none}}
.grid i{{position:absolute;top:0;bottom:0;border-left:1px solid var(--rule)}}
.grid i.par{{border-left:1.5px dashed var(--parity);opacity:.7}}
.bar{{position:absolute;top:4px;height:22px;border-radius:0 4px 4px 0;}}
.val{{position:absolute;top:50%;transform:translateY(-50%);font-size:14px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}}
.val small{{font-weight:400;color:var(--ink-3);font-size:12px;margin-left:6px}}
.tip{{position:absolute;z-index:5;background:var(--tip);color:var(--tip-ink);padding:12px 14px;border-radius:4px;font-size:13.5px;line-height:1.45;max-width:320px;pointer-events:none;opacity:0;transition:opacity .12s;box-shadow:0 8px 24px rgba(0,0,0,.18)}}
.tip.on{{opacity:1}}
.tip b{{font-weight:700}}
.note{{font-size:13px;color:var(--ink-3);margin-top:14px;max-width:70ch}}
:root{{--lab:150px}} @media (max-width:560px){{:root{{--lab:104px}} .lab .name{{font-size:13.5px}}}}
/* eras */
.eras{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:22px}}
.era{{border-top:4px solid;padding-top:14px}}
.era .who{{font-family:"Bodoni Moda",Didot,serif;font-size:26px;line-height:1.1;margin:0 0 2px}}
.era .when{{font-size:12px;color:var(--ink-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px}}
.era p{{margin:0;font-size:14.5px;color:var(--ink-2)}}
.era .n{{font-family:"Bodoni Moda",Didot,serif;font-size:40px;line-height:1;margin:8px 0 2px;font-variant-numeric:tabular-nums}}
/* retail path */
.path{{display:flex;gap:0;flex-wrap:wrap;border:1px solid var(--rule)}}
.path div{{flex:1 1 90px;padding:14px 12px;border-right:1px solid var(--rule);text-align:center}}
.path div:last-child{{border-right:0}}
.path .y{{font-size:12px;color:var(--ink-3)}} .path .p{{font-family:"Bodoni Moda",Didot,serif;font-size:24px;font-variant-numeric:tabular-nums}}
/* glossary */
dl{{display:grid;grid-template-columns:max-content 1fr;gap:10px 22px;max-width:76ch;margin:0}}
dt{{font-weight:600}} dd{{margin:0;color:var(--ink-2)}}
@media (max-width:560px){{dl{{grid-template-columns:1fr}} dd{{margin-bottom:8px}}}}
details{{margin-top:18px}} summary{{cursor:pointer;font-weight:600;color:var(--ink)}}
table{{border-collapse:collapse;width:100%;font-size:13.5px;margin-top:12px;font-variant-numeric:tabular-nums}}
th,td{{text-align:left;padding:8px 10px;border-bottom:1px solid var(--rule)}} th{{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}}
.tablewrap{{overflow-x:auto}}
footer{{padding-top:28px;border-top:1px solid var(--ink);font-size:12.5px;color:var(--ink-3);max-width:80ch}}
a{{color:inherit}}
@media (prefers-reduced-motion: reduce){{*{{transition:none!important}}}}
</style>

<div class="wrap">
<header>
  <div class="mast"><span class="eyebrow">The Appreciation Index &nbsp;·&nbsp; Chanel</span><span class="eyebrow">Resale read, {dt.date.today():%B %Y}</span></div>
  <h1>What a Chanel bag is worth the moment you leave the boutique</h1>
  <p class="dek">Chanel has raised prices every year since 2020. The secondhand market hasn't kept up, except for one bag. We looked at <b>{n_tiles:,} listings on The RealReal</b> and <b>{n_list:,} more across four other resale sites</b>, then lined every bag up against the price Chanel charges for it new, and against the designer who created it.</p>
</header>

<section>
  <span class="eyebrow">The ten-second version</span>
  <h2>For every dollar you spend new, here's what resale gives back</h2>
  <div class="tiles">
    <div class="tile"><span class="eyebrow" style="color:var(--karl)">Classic Flap, medium · Lagerfeld</span><div class="big">{flap.get('pct',0)/100:.2f}<small>per $1</small></div><p>New: {money(flap.get('retail',0))}. The going resale ask: about {money(flap.get('ask',0))}. You get back {flap.get('pct',0):.0f} cents on the dollar.</p></div>
    <div class="tile"><span class="eyebrow" style="color:var(--karl)">Boy, old medium · Lagerfeld</span><div class="big">{boy.get('pct',0)/100:.2f}<small>per $1</small></div><p>New: {money(boy.get('retail',0))}. Resale ask: about {money(boy.get('ask',0))}. Steadier than its reputation, but still a loss.</p></div>
    <div class="tile"><span class="eyebrow" style="color:var(--virginie)">Chanel 25, medium · Viard</span><div class="big">{c25.get('pct',0)/100:.2f}<small>per $1</small></div><p>New: {money(c25.get('retail',0))}. Resale ask: about {money(c25.get('ask',0))}. The only Chanel line where resale asks <em>more</em> than the boutique.</p></div>
  </div>
</section>

<section>
  <span class="eyebrow">Every line, by the designer who made it</span>
  <h2>Cents on the dollar, from Coco to Blazy</h2>
  <p class="lede">Oldest at the top, newest at the bottom. The bar is what resale sellers are asking, as a share of the bag's retail price. The dashed line is break-even: a bar that crosses it means the bag resells for more than it costs new. Hover any bar for the plain numbers.</p>
  <div class="legend">
    <span><i class="sw" style="background:var(--coco)"></i>Coco Chanel</span><span><i class="sw" style="background:var(--karl)"></i>Karl Lagerfeld</span><span><i class="sw" style="background:var(--virginie)"></i>Virginie Viard</span><span><i class="sw" style="background:var(--matthieu)"></i>Matthieu Blazy</span>
  </div>
  <div class="chart" id="chart"></div>
  <p class="note">Where we have Chanel's actual boutique price for the same size, the bar uses it. Otherwise it uses the "estimated retail" The RealReal prints on the listing. Small samples are marked. Asking prices, not final sale prices.</p>
  <details><summary>Show me the numbers</summary><div class="tablewrap"><table id="tbl"></table></div></details>
</section>

<section>
  <span class="eyebrow">Four designers, four markets</span>
  <h2>How each era is netting out</h2>
  <div class="eras">
    <div class="era" style="border-color:var(--coco)"><div class="who serif">Coco Chanel</div><div class="when">Designs from 1955</div><div class="n serif">26¢</div><p>Her 2.55 is the oldest stock on resale, and it shows. Vintage reissues with real wear sell for about a quarter of the estimated retail. Heritage is not the same as value retention.</p></div>
    <div class="era" style="border-color:var(--karl)"><div class="who serif">Karl Lagerfeld</div><div class="when">1983 – 2019</div><div class="n serif">32–80¢</div><p>The widest spread. His icons hold the middle: Classic Flap 68¢, Chanel 19 50¢. His trend bags are where the money went, with the Gabrielle at 32¢ and the Boy at 40¢ against RealReal's estimate.</p></div>
    <div class="era" style="border-color:var(--virginie)"><div class="who serif">Virginie Viard</div><div class="when">2019 – 2024</div><div class="n serif">78¢–$1.10</div><p>Critics were cool on Viard. Resale buyers are not. The Chanel 22 holds 78¢ and the Chanel 25 asks $1.10 on the dollar, above the boutique price.</p></div>
    <div class="era" style="border-color:var(--matthieu)"><div class="who serif">Matthieu Blazy</div><div class="when">2025 –</div><div class="n serif">~78¢</div><p>His first bags are barely on resale yet, so this is a first sighting, not a verdict. What's there asks the highest prices on the board, about $8,800 on average, and gets three times the saves of an average Chanel listing.</p></div>
  </div>
</section>

<section>
  <span class="eyebrow">Why the older bags look worse</span>
  <h2>Chanel moved the goalposts</h2>
  <p class="lede">A medium Classic Flap cost {money(retail_path[0][1])} in {retail_path[0][0]}. Today it is {money(retail_path[-1][1])}. Resale asks have not climbed that fast, so a bag bought in 2021 and sold today roughly breaks even, while the same bag bought this year would not.</p>
  <div class="path">{''.join(f'<div><div class="y">{y}</div><div class="p">{money(p)}</div></div>' for y,p in retail_path)}</div>
</section>

<section>
  <span class="eyebrow">How to read this</span>
  <h2>Five words, no jargon</h2>
  <dl>
    <dt>Retail</dt><dd>What Chanel charges in the boutique today, in US dollars.</dd>
    <dt>Resale ask</dt><dd>The price a seller is listing the bag for secondhand. Not what it finally sold for; sale prices come later as we track listings over time.</dd>
    <dt>Cents on the dollar</dt><dd>Resale ask divided by retail. 68¢ means a $100 bag is listed at $68.</dd>
    <dt>Estimated retail</dt><dd>The RealReal's own guess at the original price, printed on about one listing in five. We use it only when we don't have the boutique price for that size.</dd>
    <dt>Small sample</dt><dd>Fewer than three listings. Interesting, not conclusive. The number will firm up as the index reads more pages each day.</dd>
  </dl>
</section>

<footer>Built {dt.date.today():%d %B %Y} from Katie's Fashion Data Lab (luxury_bags.db: RealReal item reads, Fashionphile / Rebag / Madison Avenue Couture / Privé Porter listings, sourced retail reference). Condition, colour and material are not yet controlled for. This is value-retention analysis based on public market data, not investment advice. Past resale performance does not guarantee future results.</footer>
</div>

<script>
const DATA = {json.dumps(data)};
const COL = {{"Coco Chanel":"var(--coco)","Karl Lagerfeld":"var(--karl)","Virginie Viard":"var(--virginie)","Matthieu Blazy":"var(--matthieu)"}};
const MAX = 130;
const money = v => v==null ? "" : "$" + Math.round(v).toLocaleString();
const chart = document.getElementById("chart");
let h = `<div class="axis">${{[0,25,50,75,100,125].map(t=>`<span style="left:${{t/MAX*100}}%">${{t===100?"break-even":t+"¢"}}</span>`).join("")}}</div>`;
for (const r of DATA.rows) {{
  const w = Math.min(r.cents, MAX)/MAX*100;
  const small = r.n < 3;
  const label = r.cents>=100 ? `$${{(r.cents/100).toFixed(2)}} per $1` : `${{r.cents}}¢ on the $`;
  h += `<div class="row" data-i="${{DATA.rows.indexOf(r)}}">
    <div class="lab"><div class="name">${{r.line}}</div><div class="yr">${{r.year}} · ${{r.designer.split(" ").pop()}}</div></div>
    <div class="trk"><div class="grid">${{[25,50,75,125].map(t=>`<i style="left:${{t/MAX*100}}%"></i>`).join("")}}<i class="par" style="left:${{100/MAX*100}}%"></i></div>
      <div class="bar" style="width:${{w}}%;background:${{COL[r.designer]}}"></div>
      <div class="val" style="left:calc(${{w}}% + 10px)">${{label}}<small>${{r.n}} listing${{r.n==1?"":"s"}}${{small?" · small sample":""}}</small></div>
    </div></div>`;
}}
chart.innerHTML = h + `<div class="tip" id="tip"></div>`;
const tip = document.getElementById("tip");
chart.querySelectorAll(".row").forEach(row => {{
  const r = DATA.rows[+row.dataset.i];
  const show = (e) => {{
    const basis = r.basis==="boutique"
      ? `New at Chanel (${{r.size}}): <b>${{money(r.retail)}}</b>.<br>Typical resale ask, same size: <b>${{money(r.ask)}}</b> across ${{r.n}} listings on Fashionphile, Rebag, Madison Avenue Couture and Privé Porter.`
      : `Average resale ask on The RealReal: <b>${{money(r.ask)}}</b>, which is ${{r.cents}}% of the retail price The RealReal estimates for each bag (${{r.n}} listings showed one).`;
    tip.innerHTML = `<b>${{r.line}}</b> · ${{r.designer}}, ${{r.year}}<br>${{basis}}<br><span style="opacity:.8">${{r.blurb}}</span>`;
    tip.classList.add("on");
    const cr = chart.getBoundingClientRect();
    let x = e.clientX - cr.left + 14, y = e.clientY - cr.top + 14;
    if (x + 330 > cr.width) x = Math.max(0, cr.width - 330);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }};
  row.addEventListener("mousemove", show); row.addEventListener("mouseenter", show);
  row.addEventListener("mouseleave", () => tip.classList.remove("on"));
  row.addEventListener("click", show);
}});
document.getElementById("tbl").innerHTML = `<thead><tr><th>Bag</th><th>Year</th><th>Designer</th><th>New price</th><th>Resale ask</th><th>Cents on the $</th><th>Listings</th><th>Basis</th></tr></thead><tbody>` +
  DATA.rows.map(r=>`<tr><td>${{r.line}}</td><td>${{r.year}}</td><td>${{r.designer}}</td><td>${{r.retail?money(r.retail):"—"}}</td><td>${{money(r.ask)}}</td><td>${{r.cents}}¢</td><td>${{r.n}}</td><td>${{r.basis==="boutique"?"Chanel boutique price, same size":"RealReal estimated retail"}}</td></tr>`).join("") + `</tbody>`;
</script>
"""
open(OUT, "w").write(html)
print(OUT, len(html), "bytes;", len(rows), "rows")
