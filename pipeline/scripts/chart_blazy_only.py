#!/usr/bin/env python3
"""Blazy's first year at Chanel, in dollars: boutique price vs resale ask, by show. Like-for-like: these bags are months old and mostly pristine."""
import sqlite3, datetime as dt, matplotlib
matplotlib.use("Agg"); matplotlib.rcParams["text.parse_math"] = False
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
OUT = "/Users/katiegraves/Desktop/Fashion Data Lab/exports/chanel_blazy_first_year.png"
con = sqlite3.connect(DB)
PAPER, INK, INK2, INK3, RULE = "#fbfaf7", "#141311", "#55524c", "#8a867e", "#e4e0d8"
RTW, MDA, LOSS = "#c2451e", "#8a5a1e", "#9a9690"      # Spring 2026 runway / Métiers d'Art Paris–New York
SERIF, SANS = "Didot", "Helvetica Neue"
def med(sql):
    v = sorted(x[0] for x in con.execute(sql) if x[0]); return (v[len(v)//2], len(v)) if v else (None, 0)
B = "select price from v_bag_listings where brand='Chanel' and "
S1, S2 = "Spring 2026 runway · his debut, Oct 2025", "Métiers d'Art Paris–New York · Dec 2025"
def sold(like_model, like_title=None, exclude=None):
    q="select price from trr_item_reads where house='Chanel' and sold=1 and model_guess=? and era_guess like 'Blazy%'"; p=[like_model]
    if like_title: q+=" and lower(title) like ?"; p.append(like_title)
    if exclude: q+=" and lower(title) not like ?"; p.append(exclude)
    return sorted(x[0] for x in con.execute(q,p) if x[0])
rows = [
 (S1, "Souplissimo flap, large", 9600, med(B+"model_guess='Souplissimo' and (lower(title) like '%maxi%' or lower(title) like '%large%') and lower(title) not like '%small%' and lower(title) not like '%mini%'"), sold('Souplissimo','%maxi%','%small%'), "The debut bag. Sold out at Chanel."),
 (S1, "Souplissimo flap, small", 8800, med(B+"model_guess='Souplissimo' and lower(title) like '%small%'"), sold('Souplissimo','%small%'), ""),
 (S1, "Urban Essentials tote, large", 11000, med(B+"model_guess='Urban Essentials' and lower(title) like '%large%'"), sold('Urban Essentials','%large%'), ""),
 (S1, "Urban Essentials tote, small", 7000, med(B+"model_guess='Urban Essentials' and lower(title) like '%small%'"), sold('Urban Essentials','%small%'), ""),
 (S1, "Kelly Shopper, small", 5200, med(B+"model_guess='Kelly Shopper' and size_guess='Small'"), [], "Chanel calls this size 'mini'."),
 (S1, "Neo Cabas, small", 7300, med(B+"model_guess='Neo Cabas'"), [], "Retail is our least certain number here."),
 (S2, "Chanel 25 mini, cheetah pony hair", 8400, med(B+"model_guess='Chanel 25' and (lower(title) like '%pony%' or lower(title) like '%cheetah%' or lower(title) like '%calf hair%')"), sold('Chanel 25','%pony%') or [17995, 17100], "Confirmed sales on The RealReal."),
 (S2, "31 Shopping Bag mini, cheetah", 6200, (9925, 1), [], "One listed, The RealReal."),
 (S2, "Chic Lady shopper, small", 6700, (9500, 1), [], "One listed, The RealReal."),
 (S2, "Classic Flap medium, cheetah pony hair", None, (None, 0), [17995], "No public retail price. Sotheby's asks $20,000."),
 (S2, "Bucket bag, cheetah pony hair", None, (None, 0), [8500], "No public retail price."),
]
fig = plt.figure(figsize=(12, 11), dpi=200); fig.patch.set_facecolor(PAPER)
ax = fig.add_axes([0.31, 0.095, 0.65, 0.62]); ax.set_facecolor(PAPER)
XMAX = 21000
n1 = sum(1 for r in rows if r[0] == S1)
ys = []; y = 0
for i in range(len(rows)):
    ys.append(y); y += 1.18
ys = ys[::-1]
ys = [yy + (1.1 if i < n1 else 0) for i, yy in enumerate(ys)]
for (sec, name, retail, (ask, n), sold, note), yy in zip(rows, ys):
    col = RTW if sec == S1 else MDA
    ax.text(-0.015, yy + 0.1, name, transform=ax.get_yaxis_transform(), ha="right", va="center", fontsize=12, fontname=SANS, weight="bold", color=INK)
    if note: ax.text(-0.015, yy - 0.22, note, transform=ax.get_yaxis_transform(), ha="right", va="center", fontsize=8.5, fontname=SANS, color=INK3, style="italic")
    end = ask if ask else (max(sold) if sold else None)
    if retail and end:
        ax.plot([retail, end], [yy, yy], color=col if end >= retail else LOSS, lw=3, solid_capstyle="round", zorder=2)
    if retail:
        ax.plot(retail, yy, "o", ms=10, mfc=PAPER, mec=INK, mew=1.8, zorder=3)
        ax.text(retail, yy - 0.3, f"${retail:,.0f} new", ha="center", va="top", fontsize=8.5, fontname=SANS, color=INK2)
    if ask:
        ax.plot(ask, yy, "o", ms=10, mfc=col, mec=col, zorder=4)
        ax.text(ask, yy + 0.3, f"${ask:,.0f} resale ask" + (f"  ({n} listed)" if n > 1 else ""), ha="center", va="bottom", fontsize=8.5, fontname=SANS, color=INK2)
        d = ask - retail
        ax.text(max([ask, retail] + (sold or [])) + 450, yy + 0.02, (f"+${d:,.0f}" if d >= 0 else f"−${-d:,.0f}"), va="center", fontsize=13, fontname=SERIF, weight="bold", color=col if d >= 0 else INK3)
    for s in sold[:12]:
        ax.plot(s, yy - 0.16, marker="*", ms=12, mfc=col, mec=PAPER, mew=0.8, ls="none", zorder=5)
    if sold:
        sx = sorted(sold)[len(sold)//2]; off, va = (0.3, "bottom") if not ask else (-0.36, "top")
        ax.text(max(sold), yy + off, f"{len(sold)} sold, median ${sx:,.0f}" if len(sold) > 1 else f"sold ${sx:,.0f}", ha="center", va=va, fontsize=8.5, fontname=SANS, color=col, weight="bold")
ax.text(-0.015, ys[0] + 0.95, S1.upper(), transform=ax.get_yaxis_transform(), ha="right", va="center", fontsize=9.5, fontname=SANS, weight="bold", color=RTW)
ax.text(-0.015, ys[n1] + 0.95, S2.upper(), transform=ax.get_yaxis_transform(), ha="right", va="center", fontsize=9.5, fontname=SANS, weight="bold", color=MDA)
ax.axhline(ys[n1] + 0.8, color=RULE, lw=1)
ax.set_xlim(0, XMAX); ax.set_ylim(-0.9, ys[0] + 1.35); ax.set_yticks([])
ax.set_xticks(range(0, XMAX, 5000)); ax.set_xticklabels([f"${t//1000}k" if t else "$0" for t in range(0, XMAX, 5000)], fontname=SANS, fontsize=9.5, color=INK3)
ax.tick_params(axis="x", length=0, pad=6); ax.grid(axis="x", color=RULE, lw=0.8); ax.set_axisbelow(True)
for s in ax.spines.values(): s.set_visible(False)
ax.set_xlabel("US dollars", fontname=SANS, fontsize=10, color=INK2, labelpad=8)

fig.text(0.04, 0.967, "THE APPRECIATION INDEX  ·  CHANEL", fontname=SANS, fontsize=9.5, color=INK2, weight="bold")
fig.text(0.96, 0.967, f"RESALE READ, {dt.date.today():%B %Y}".upper(), fontname=SANS, fontsize=9.5, color=INK2, ha="right", weight="bold")
fig.add_artist(Line2D([0.04, 0.96], [0.957, 0.957], color=INK, lw=1))
fig.text(0.04, 0.912, "Blazy's first year at Chanel:\nhis bags are selling, not just listing, above the boutique price.", fontname=SERIF, fontsize=28, color=INK, va="top", linespacing=1.05)
fig.text(0.04, 0.808, "Each line is one bag from Matthieu Blazy's first two collections. The hollow dot is what it costs new at Chanel. The solid dot is the typical price resale sellers\n"
         "ask for it right now; a star is a confirmed sale. These bags are months old and mostly pristine or still tagged, so this is new versus new, not new versus worn.",
         fontname=SANS, fontsize=10.5, color=INK2, va="top", linespacing=1.45)
handles = [Line2D([], [], marker="o", ms=9, mfc=PAPER, mec=INK, mew=1.6, ls="none", label="price new at Chanel"),
           Line2D([], [], marker="o", ms=9, mfc=INK2, mec=INK2, ls="none", label="typical resale ask"),
           Line2D([], [], marker="*", ms=14, mfc=INK2, mec=PAPER, ls="none", label="confirmed sale, The RealReal")]
fig.legend(handles=handles, loc="upper left", bbox_to_anchor=(0.035, 0.758), ncol=3, frameon=False, prop={"family": SANS, "size": 9.5}, labelcolor=INK, handletextpad=0.5, columnspacing=1.8)
fig.text(0.04, 0.016, "Resale asks: median of same-size listings on Fashionphile, Rebag, Madison Avenue Couture and Privé Porter (Oct 2 2026), or The RealReal where noted. Retail: Chanel US prices after the\n"
         "Sept 22 2026 increase, from PurseBop, Bragmybag and chanel.com. Stars are confirmed RealReal sales (Oct 2026). Scarcity at launch inflates early resale; the test is whether these hold in a year.\n"
         "Source: Katie's Fashion Data Lab. Value-retention analysis based on public market data, not investment advice.", fontname=SANS, fontsize=7.8, color=INK3, va="bottom", linespacing=1.4)
fig.savefig(OUT, facecolor=PAPER); print(OUT)
for r in rows: print(r[1], r[2], r[3])
