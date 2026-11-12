#!/usr/bin/env python3
"""Chanel: resale ask as % of retail, by bag line, coloured by the designer who introduced it.
Bars = The RealReal tiles with an 'Est. Retail' shown (Katie's WTP pulse). Diamonds = size-matched
median ask across Fashionphile/Rebag/MAC/Privé Porter ÷ current US retail (v_retention_scoreboard_sized)."""
import sqlite3, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
from matplotlib.lines import Line2D

DB = "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db"
OUT = "/Users/katiegraves/Desktop/Fashion Data Lab/exports/chanel_wtp_by_designer.png"
con = sqlite3.connect(DB)

# line → (launch year, designer who introduced it)
LINES = {
    "Reissue 2.55":   (1955, "Coco Chanel"),
    "Classic Flap":   (1983, "Karl Lagerfeld"),
    "Boy":            (2011, "Karl Lagerfeld"),
    "Deauville":      (2012, "Karl Lagerfeld"),
    "Trendy CC":      (2014, "Karl Lagerfeld"),
    "Coco Handle":    (2015, "Karl Lagerfeld"),
    "Gabrielle":      (2017, "Karl Lagerfeld"),
    "Chanel 19":      (2019, "Karl Lagerfeld"),   # his last design, launched with Viard
    "Chanel 22":      (2022, "Virginie Viard"),
    "Chanel 25":      (2025, "Virginie Viard"),   # launched Feb 2025, studio transition before Blazy's first show
    "Blazy 2026 lines": (2026, "Matthieu Blazy"),
}
DESIGNER_COLOR = {"Coco Chanel": "#eda100", "Karl Lagerfeld": "#2a78d6", "Virginie Viard": "#1baf7a", "Matthieu Blazy": "#eb6834"}

rows = con.execute("""
select case when model_guess in ('Reissue 2.55','Classic Flap','Boy','Deauville','Trendy CC','Coco Handle','Gabrielle','Chanel 19','Chanel 22','Chanel 25') then model_guess
            when era_guess like 'Blazy%' then 'Blazy 2026 lines' end line,
       count(*), sum(est_retail is not null), round(avg(pct_of_retail),1), round(avg(price))
from trr_item_reads where house='Chanel' group by 1 having line is not null""").fetchall()
trr = {r[0]: {"tiles": r[1], "n_est": r[2], "pct": r[3], "ask": r[4]} for r in rows}
sized = {r[0]: r[1] for r in con.execute("select model, retention_pct_same_size from v_retention_scoreboard_sized where house='Chanel'")}

order = sorted(LINES, key=lambda k: LINES[k][0])          # chronological, oldest at top
ys = list(range(len(order)))[::-1]

SURF, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e1"
fig, ax = plt.subplots(figsize=(11, 7.6), dpi=200)
fig.patch.set_facecolor(SURF); ax.set_facecolor(SURF)
H = 0.42
for y, line in zip(ys, order):
    yr, des = LINES[line]; c = DESIGNER_COLOR[des]; d = trr[line]
    v = d["pct"]
    # rounded data-end, square at baseline
    ax.add_patch(FancyBboxPatch((0, y - H/2), v, H, boxstyle="round,pad=0,rounding_size=1.6",
                                fc=c, ec="none", mutation_aspect=0.08))
    ax.add_patch(plt.Rectangle((0, y - H/2), min(v, 1.6), H, fc=c, ec="none"))
    small = " · small sample" if d["n_est"] < 3 else ""
    small = " · n<3, indicative" if d["n_est"] < 3 else ""
    xtext = max(v, sized.get(line, 0) + 2.5) + 1.5
    ax.text(xtext, y, f"{v:.0f}%  (n={d['n_est']}, avg ask ${d['ask']/1000:.1f}k){small}",
            va="center", ha="left", fontsize=8.5, color=INK)
    if line in sized:
        ax.plot(sized[line], y, marker="D", ms=7, mfc=SURF, mec=c, mew=1.8, ls="none", zorder=5)
        ax.text(sized[line], y + H/2 + 0.06, f"◇ {sized[line]:.0f}%", ha="center", va="bottom", fontsize=7.5, color=INK2)
    ax.text(-2, y, f"{line}\n{yr}", va="center", ha="right", fontsize=9, color=INK, linespacing=1.15)

ax.axvline(100, color=INK2, lw=1, ls=(0, (3, 3)), zorder=1)
ax.text(101, len(order) - 0.55, "retail parity", ha="left", va="center", fontsize=8, color=INK2)
ax.set_xlim(0, 165); ax.set_ylim(-0.7, len(order) - 0.2)
ax.set_yticks([]); ax.tick_params(axis="x", colors=INK2, labelsize=8.5, length=0)
ax.set_xticks([0, 25, 50, 75, 100, 125, 150]); ax.set_xticklabels([f"{t}%" for t in [0, 25, 50, 75, 100, 125, 150]])
ax.grid(axis="x", color=GRID, lw=0.8, zorder=0); ax.set_axisbelow(True)
for s in ax.spines.values(): s.set_visible(False)
ax.set_xlabel("Secondhand asking price as % of retail (bars: RealReal est. retail; diamonds: current boutique retail)", color=INK2, fontsize=9, labelpad=8)

handles = [Line2D([], [], marker="s", ms=9, mfc=DESIGNER_COLOR[d], mec="none", ls="none", label=d) for d in DESIGNER_COLOR]
handles.append(Line2D([], [], marker="D", ms=7, mfc=SURF, mec=INK2, mew=1.6, ls="none", label="◇ multi-platform, same size ÷ current retail"))
leg = ax.legend(handles=handles, loc="lower left", bbox_to_anchor=(0.0, 1.01), ncol=5, frameon=False, fontsize=8.5, labelcolor=INK, handletextpad=0.4, columnspacing=1.6)

fig.suptitle("Chanel: what the secondhand market will pay, by designer era", x=0.02, ha="left", fontsize=15, color=INK, weight="semibold", y=0.985)
fig.text(0.02, 0.905, "Bars: The RealReal asking price ÷ RealReal's stated est. retail, averaged over tiles read Oct 2–3 2026 (only ~1 in 5 tiles shows est. retail; n = those tiles). "
         "Diamonds: median ask on Fashionphile, Rebag, Madison Avenue Couture, Privé Porter for the reference size ÷ today's US retail.",
         fontsize=8.5, color=INK2, wrap=True)
fig.text(0.02, 0.012, "Asking prices, not sales. Condition and material not controlled. Chanel 19 was Lagerfeld's last design, launched with Viard; the Chanel 25 launched Feb 2025 during the studio transition before Blazy's first show. "
         "Source: Katie's Fashion Data Lab (luxury_bags.db: trr_item_reads, retail_reference, v_retention_scoreboard_sized). Value-retention analysis, not investment advice.",
         fontsize=7.2, color=INK2, wrap=True)
plt.subplots_adjust(left=0.16, right=0.985, top=0.80, bottom=0.12)
fig.savefig(OUT, facecolor=SURF)
print(OUT)
