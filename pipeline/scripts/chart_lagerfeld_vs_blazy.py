#!/usr/bin/env python3
"""Lagerfeld vs Blazy, in dollars: what the bag cost new vs what resale sellers ask (and, where we have it, what it actually sold for)."""
import sqlite3, datetime as dt, matplotlib
matplotlib.use("Agg"); matplotlib.rcParams["text.parse_math"] = False
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
OUT = "/Users/katiegraves/Desktop/Fashion Data Lab/exports/chanel_lagerfeld_vs_blazy.png"
con = sqlite3.connect(DB)
PAPER, INK, INK2, INK3, RULE = "#fbfaf7", "#141311", "#55524c", "#8a867e", "#e4e0d8"
KARL, BLAZY, LOSS, GAIN = "#1f4e9c", "#c2451e", "#9a9690", None
SERIF, SANS = "Didot", "Helvetica Neue"

def med(sql, *p):
    v = sorted(x[0] for x in con.execute(sql, p) if x[0]); 
    return (v[len(v)//2], len(v)) if v else (None, 0)
B = "select price from v_bag_listings where brand='Chanel' and "
rows = [
 # section, name, retail, (ask, n), sold list, note
 ("Karl Lagerfeld", "Classic Flap, medium", 11700, med(B+"model_guess='Classic Flap' and size_guess='Medium'"), [], "Up 50% at retail since 2021; resale didn't follow."),
 ("Karl Lagerfeld", "Boy, old medium", 7400, med(B+"model_guess='Boy' and size_guess in ('Medium','Old Medium')"), [], ""),
 ("Karl Lagerfeld", "Chanel 19, all sizes", 7200, med(B+"model_guess='Chanel 19'"), [], "Retail shown is the small."),
 ("Matthieu Blazy", "Souplissimo, large", 9600, med(B+"model_guess='Souplissimo' and (lower(title) like '%maxi%' or lower(title) like '%large%') and lower(title) not like '%small%' and lower(title) not like '%mini%'"), [], "His debut flap. Sold out at Chanel."),
 ("Matthieu Blazy", "Urban Essentials tote, large", 11000, med(B+"model_guess='Urban Essentials' and lower(title) like '%large%'"), [], ""),
 ("Matthieu Blazy", "Chanel 25 mini, cheetah pony hair", 8400, med(B+"model_guess='Chanel 25' and (lower(title) like '%pony%' or lower(title) like '%cheetah%' or lower(title) like '%calf hair%')"), [17995, 17100], "Two sold on The RealReal this month."),
 ("Matthieu Blazy", "Kelly Shopper, small", 5200, med(B+"model_guess='Kelly Shopper' and size_guess='Small'"), [], "Chanel calls this size 'mini'."),
 ("Matthieu Blazy", "31 Shopping Bag mini, cheetah", 6200, (9925, 1), [], "One listed."),
 ("Matthieu Blazy", "Chic Lady shopper, small", 6700, (9500, 1), [], "One listed."),
 ("Matthieu Blazy", "Classic Flap, cheetah pony hair", None, (None, 0), [17995], "No public retail price. Sotheby's asks $20,000."),
]
fig = plt.figure(figsize=(12, 10.6), dpi=200); fig.patch.set_facecolor(PAPER)
ax = fig.add_axes([0.31, 0.10, 0.65, 0.615]); ax.set_facecolor(PAPER)
XMAX = 21000
# layout with a gap between sections
y = 0; ys = []; section_y = {}
for r in rows[::-1]:
    ys.append(y); y += 1
ys = ys[::-1]
# insert gap: Lagerfeld rows get +1
sec_break = sum(1 for r in rows if r[0] == "Karl Lagerfeld")
ys = [1.18 * yy + (1.1 if i < sec_break else 0) for i, yy in enumerate(ys)]
for (sec, name, retail, (ask, n), sold, note), yy in zip(rows, ys):
    col = KARL if sec == "Karl Lagerfeld" else BLAZY
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
        lab = f"${ask:,.0f} resale ask" + (f"  ({n} listed)" if n > 1 else "")
        ax.text(ask, yy + 0.3, lab, ha="center", va="bottom", fontsize=8.5, fontname=SANS, color=INK2)
        d = ask - retail
        ax.text(max(ask, retail) + 450, yy + 0.02, (f"+${d:,.0f}" if d >= 0 else f"−${-d:,.0f}"), va="center", fontsize=13, fontname=SERIF, weight="bold", color=col if d >= 0 else INK3)
    for s in sold:
        ax.plot(s, yy, marker="*", ms=16, mfc=col, mec=PAPER, mew=0.8, ls="none", zorder=5)
    if sold:
        sx = max(sold); off = 0.3 if not ask else -0.3; va = "bottom" if not ask else "top"
        ax.text(sx, yy + off, f"sold ${sx:,.0f}", ha="center", va=va, fontsize=8.5, fontname=SANS, color=col, weight="bold")
# section labels
ax.text(-0.015, ys[0] + 0.95, "KARL LAGERFELD  ·  the icons, bought new today", transform=ax.get_yaxis_transform(), ha="right", va="center", fontsize=9.5, fontname=SANS, weight="bold", color=KARL)
ax.text(-0.015, ys[sec_break] + 0.95, "MATTHIEU BLAZY  ·  his first year, 2025–26", transform=ax.get_yaxis_transform(), ha="right", va="center", fontsize=9.5, fontname=SANS, weight="bold", color=BLAZY)
ax.axhline(ys[sec_break] + 0.8, color=RULE, lw=1)
ax.set_xlim(0, XMAX); ax.set_ylim(-0.9, ys[0] + 1.35); ax.set_yticks([])
ax.set_xticks(range(0, XMAX, 5000)); ax.set_xticklabels([f"${t//1000}k" if t else "$0" for t in range(0, XMAX, 5000)], fontname=SANS, fontsize=9.5, color=INK3)
ax.tick_params(axis="x", length=0, pad=6); ax.grid(axis="x", color=RULE, lw=0.8); ax.set_axisbelow(True)
for s in ax.spines.values(): s.set_visible(False)
ax.set_xlabel("US dollars", fontname=SANS, fontsize=10, color=INK2, labelpad=8)

fig.text(0.04, 0.965, "THE APPRECIATION INDEX  ·  CHANEL", fontname=SANS, fontsize=9.5, color=INK2, weight="bold")
fig.text(0.96, 0.965, f"RESALE READ, {dt.date.today():%B %Y}".upper(), fontname=SANS, fontsize=9.5, color=INK2, ha="right", weight="bold")
fig.add_artist(Line2D([0.04, 0.96], [0.955, 0.955], color=INK, lw=1))
fig.text(0.04, 0.905, "Lagerfeld's bags lose money the day you buy them.\nBlazy's first bags are going for more than Chanel charged.", fontname=SERIF, fontsize=29, color=INK, va="top", linespacing=1.05)
fig.text(0.04, 0.795, "Each line is one bag. The hollow dot is what it costs new at Chanel. The solid dot is the typical price resale sellers ask for it right now; "
         "a star is a confirmed sale.\nA grey line means you'd get back less than you paid. A coloured line means the secondhand market is paying more than the boutique.",
         fontname=SANS, fontsize=10.5, color=INK2, va="top", linespacing=1.45)
handles = [Line2D([], [], marker="o", ms=9, mfc=PAPER, mec=INK, mew=1.6, ls="none", label="price new at Chanel"),
           Line2D([], [], marker="o", ms=9, mfc=INK2, mec=INK2, ls="none", label="typical resale ask"),
           Line2D([], [], marker="*", ms=14, mfc=INK2, mec=PAPER, ls="none", label="confirmed sale, The RealReal")]
fig.legend(handles=handles, loc="upper left", bbox_to_anchor=(0.035, 0.745), ncol=3, frameon=False, prop={"family": SANS, "size": 9.5}, labelcolor=INK, handletextpad=0.5, columnspacing=1.8)
fig.text(0.04, 0.018, "Resale asks: median of same-size listings on Fashionphile, Rebag, Madison Avenue Couture and Privé Porter (Oct 2 2026), or The RealReal where noted. Retail: Chanel US prices after the\n"
         "Sept 22 2026 increase, from PurseBop, Bragmybag and chanel.com. Asking prices are not sale prices; condition and colour not controlled. Blazy's pieces are months old and scarce, Lagerfeld's\n"
         "are plentiful and pre-owned, so this compares a launch moment with a mature market. Source: Katie's Fashion Data Lab. Value-retention analysis, not investment advice.",
         fontname=SANS, fontsize=7.8, color=INK3, va="bottom", linespacing=1.4)
fig.savefig(OUT, facecolor=PAPER); print(OUT)
for r in rows: print(r[1], r[2], r[3])
