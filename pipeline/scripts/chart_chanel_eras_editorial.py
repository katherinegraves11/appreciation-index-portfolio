#!/usr/bin/env python3
"""One editorial graphic, for fashion readers: what Chanel bags resell for vs. what they cost new, by the designer who made them.
Scale is 'cents on the dollar' (resale ask ÷ retail). Re-run any time; it reads luxury_bags.db."""
import sqlite3, datetime as dt, matplotlib
matplotlib.rcParams["text.parse_math"] = False
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
from matplotlib.lines import Line2D

DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
OUT = "/Users/katiegraves/Desktop/Fashion Data Lab/exports/chanel_eras_editorial.png"
con = sqlite3.connect(DB)

PAPER, INK, INK2, INK3, RULE = "#fbfaf7", "#141311", "#55524c", "#8a867e", "#e4e0d8"
C = {"Coco Chanel": "#b07a00", "Karl Lagerfeld": "#1f4e9c", "Virginie Viard": "#0f7a5a", "Matthieu Blazy": "#c2451e"}
SERIF, SANS = "Didot", "Helvetica Neue"

# line, year, designer, plain-English note
LINES = [
 ("Reissue 2.55", 1955, "Coco Chanel", "Coco's 1955 design. Mostly vintage and well-worn on resale."),
 ("Classic Flap", 1983, "Karl Lagerfeld", "The bag people mean by 'a Chanel'."),
 ("Boy", 2011, "Karl Lagerfeld", "Everywhere for a decade, then the market moved on."),
 ("Deauville", 2012, "Karl Lagerfeld", "Canvas tote: cheap new, so even a modest ask is a big share."),
 ("Coco Handle", 2015, "Karl Lagerfeld", "Structured top-handle, a quiet holder of value."),
 ("Gabrielle", 2017, "Karl Lagerfeld", "Launched with a star campaign. The campaign is over."),
 ("Chanel 19", 2019, "Karl Lagerfeld", "Lagerfeld's last design, launched by Viard."),
 ("Chanel 22", 2022, "Virginie Viard", "Divisive at launch, holding up on resale."),
 ("Chanel 25", 2025, "Virginie Viard", "Launched in the gap before Blazy. Resells above retail."),
 ("Souplissimo", 2026, "Matthieu Blazy", "Blazy's debut flap. Sold out; resale asks start near $13k."),
 ("Chanel 25, cheetah pony hair", 2026, "Matthieu Blazy", "The one everyone screenshots. Asks up to $18.5k."),
]
sized = {r[0]: dict(size=r[1], retail=r[2], n=r[3], ask=r[4], pct=r[5]) for r in con.execute(
    "select model, matched_size, retail_now, n_listings_same_size, median_ask_same_size, retention_pct_same_size from v_retention_scoreboard_sized where house='Chanel'")}
trr = {r[0]: dict(n=r[1], pct=r[2], ask=r[3]) for r in con.execute(
    "select model_guess, sum(est_retail is not null), round(avg(pct_of_retail),1), round(avg(price)) from trr_item_reads where house='Chanel' group by 1")}
def retail_for(model, like=None):
    q = "select price, size_or_spec from retail_reference where house='Chanel' and model=? and price_type='current'"
    p = [model]
    if like: q += " and lower(size_or_spec) like ?"; p.append(like)
    else: q += " and is_reference_size=1"
    r = con.execute(q + " order by effective_date desc limit 1", p).fetchone(); return r
def median_ask(model, like=None):
    q = "select price from v_bag_listings where brand='Chanel' and model_guess=? and price is not null"; p=[model]
    if like: q += " and lower(title) like ?"; p.append(like)
    v = sorted(x[0] for x in con.execute(q, p)); 
    return (v[len(v)//2], len(v)) if v else (None, 0)

rows = []
for line, yr, des, note in LINES:
    if line == "Souplissimo":
        r = retail_for("Souplissimo"); ask, n = median_ask("Souplissimo")
    elif line.startswith("Chanel 25, cheetah"):
        r = retail_for("Chanel 25", "%pony%") or retail_for("Chanel 25", "%cheetah%") or retail_for("Chanel 25", "%calf hair%")
        ask, n = median_ask("Chanel 25", "%pony hair%")
        if not n: ask, n = median_ask("Chanel 25", "%cheetah%")
    else:
        r = None; ask = n = None
    if line in sized:
        s = sized[line]; rows.append(dict(line=line, yr=yr, des=des, note=note, cents=s["pct"], retail=s["retail"], ask=s["ask"], n=s["n"], basis="boutique"))
    elif r and ask:
        rows.append(dict(line=line, yr=yr, des=des, note=note, cents=100*ask/r[0], retail=r[0], ask=ask, n=n, basis="boutique"))
    elif ask:   # retail still unsourced: show the ask, no bar
        rows.append(dict(line=line, yr=yr, des=des, note=note, cents=None, retail=None, ask=ask, n=n, basis="pending"))
    elif line in trr and trr[line]["n"]:
        t = trr[line]; rows.append(dict(line=line, yr=yr, des=des, note=note, cents=t["pct"], retail=None, ask=t["ask"], n=t["n"], basis="trr"))

MAX = 260
fig = plt.figure(figsize=(12, 10.2), dpi=200); fig.patch.set_facecolor(PAPER)
ax = fig.add_axes([0.26, 0.125, 0.70, 0.585]); ax.set_facecolor(PAPER)
ys = list(range(len(rows)))[::-1]; H = 0.46
for y, r in zip(ys, rows):
    c = C[r["des"]]
    ax.text(-0.012, y + 0.12, r["line"], transform=ax.get_yaxis_transform(), ha="right", va="center", fontsize=12.5, fontname=SANS, weight="bold", color=INK)
    ax.text(-0.012, y - 0.2, f"{r['yr']}  ·  {r['des'].split()[-1]}", transform=ax.get_yaxis_transform(), ha="right", va="center", fontsize=9.5, fontname=SANS, color=INK3)
    if r["cents"] is None:
        ax.text(1.5, y, f"ask ${r['ask']:,.0f} · retail price still being verified", va="center", fontsize=10.5, fontname=SANS, color=INK3, style="italic")
        continue
    v = min(r["cents"], MAX)
    ax.add_patch(FancyBboxPatch((0, y - H/2), v, H, boxstyle="round,pad=0,rounding_size=2.2", fc=c, ec="none", mutation_aspect=0.06))
    ax.add_patch(plt.Rectangle((0, y - H/2), min(v, 2.2), H, fc=c, ec="none"))
    big = f"${r['cents']/100:.2f}" if r["cents"] >= 100 else f"{r['cents']:.0f}¢"
    unit = " back per $1" if r["cents"] >= 100 else " on the dollar"
    if r["basis"] == "boutique":
        sub = f"new ${r['retail']:,.0f}, resale ask about ${r['ask']:,.0f}"
    else:
        sub = f"resale ask about ${r['ask']:,.0f}, vs. The RealReal's estimated retail"
    if r["n"] < 3: sub += "  (only %d listed)" % r["n"]
    ax.text(v + 2.5, y + 0.11, big, va="center", fontsize=15, fontname=SERIF, color=INK, weight="bold")
    ax.text(v + 2.5 + len(big) * 4.4 + 1.5, y + 0.11, unit, va="center", fontsize=10.5, fontname=SANS, color=INK2)
    ax.text(v + 2.5, y - 0.2, sub, va="center", fontsize=9.5, fontname=SANS, color=INK3)
ax.axvline(100, color=INK, lw=1, ls=(0, (2, 3)), zorder=0, alpha=.8)
ax.text(100, len(rows) - 0.35, "break-even: resells for what it cost new", ha="center", va="bottom", fontsize=9.5, fontname=SANS, color=INK2)
ax.set_xlim(0, MAX); ax.set_ylim(-0.7, len(rows) - 0.1); ax.set_yticks([])
ax.set_xticks([0, 50, 100, 150, 200, 250]); ax.set_xticklabels(["0", "50¢", "$1", "$1.50", "$2", "$2.50"], fontname=SANS, fontsize=9.5, color=INK3)
ax.tick_params(axis="x", length=0, pad=6); ax.grid(axis="x", color=RULE, lw=0.8); ax.set_axisbelow(True)
for s in ax.spines.values(): s.set_visible(False)
ax.set_xlabel("What resale sellers ask, for every $1 the bag costs new at Chanel today", fontname=SANS, fontsize=10.5, color=INK2, labelpad=10)

# masthead
fig.text(0.04, 0.965, "THE APPRECIATION INDEX  ·  CHANEL", fontname=SANS, fontsize=9.5, color=INK2, weight="bold")
fig.text(0.96, 0.965, f"RESALE READ, {dt.date.today():%B %Y}".upper(), fontname=SANS, fontsize=9.5, color=INK2, ha="right", weight="bold")
fig.add_artist(Line2D([0.04, 0.96], [0.955, 0.955], color=INK, lw=1))
fig.text(0.04, 0.905, "What a Chanel bag is worth\nthe moment you leave the boutique", fontname=SERIF, fontsize=30, color=INK, va="top", linespacing=1.05)
fig.text(0.04, 0.80, "Each bar is a bag line, oldest at the top, coloured by the designer who created it. The length is what resale sellers are asking today\n"
         "for every dollar the bag costs new. Most of Lagerfeld's bags give back 40 to 70 cents. Viard's Chanel 25 gives back more than a dollar.\n"
         "Blazy's first bags are the outliers: sold out, and asking far above the boutique price.", fontname=SANS, fontsize=10.5, color=INK2, va="top", linespacing=1.45)
# legend
x = 0.04
for des, col in C.items():
    fig.patches.append(plt.Rectangle((x, 0.722), 0.012, 0.012, transform=fig.transFigure, fc=col, ec="none"))
    fig.text(x + 0.017, 0.728, des, fontname=SANS, fontsize=10, color=INK, va="center"); x += 0.045 + len(des) * 0.0062
fig.text(0.04, 0.022, "Asking prices on Fashionphile, Rebag, Madison Avenue Couture, Privé Porter and The RealReal, read Sept–Oct 2026; median for the same size as the retail price. "
         "Not final sale prices; condition and colour not controlled.\nSource: Katie's Fashion Data Lab. Value-retention analysis based on public market data, not investment advice.",
         fontname=SANS, fontsize=8, color=INK3, va="bottom", linespacing=1.4)
fig.savefig(OUT, facecolor=PAPER); print(OUT); print(rows[-2:])
