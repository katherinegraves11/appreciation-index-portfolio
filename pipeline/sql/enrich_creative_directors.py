#!/usr/bin/env python3
"""Apply VERIFIED current creative-director data to creative_directors. Re-runnable/idempotent."""
import sqlite3, csv, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(BASE, "db", "copenhagen-fashion-brands.db")
CSV_OUT = os.path.join(BASE, "raw", "copenhagen-fashion-brands", "copenhagen_creative_directors.csv")

# (brand_name, creative_director, role_title, founder_is_cd(0/1), birth_year|None, gender|None, deceased_year|None, source)
VERIFIED = [
    # --- batch 1 ---
    ("(di)vision", "Nanna Wick", "Co-founder & Head Designer", 1, None, "F", None, "Vogue Scandinavia; Highsnobiety; Scandinavian Mind (sibling label rebooted 2025, Nanna = head designer)"),
    ("A. Roege Hove", "Amalie Roege Hove", "Founder & Creative Director", 1, None, "F", None, "Vogue Scandinavia; Woolmark Prize; brand bio (still her own designer, CPHFW 2025)"),
    ("Aiayu", "Maria Hogh Heilmann", "Founder & Creative Director", 1, None, "F", None, "LinkedIn (Founder/Creative Director); aiayu.com about"),
    ("Alis", "Tobias Birk Nielsen", "Design Lead / Creative Director", 0, None, "M", None, "Vogue Scandinavia; New Wave; Fizzy Mag (design lead from 2025 relaunch; collective founded 1995 by Albert Nielsen & Isabelle Hammerich)"),
    ("Anne Sofie Madsen", "Anne Sofie Madsen", "Founder & Creative Director", 1, None, "F", None, "AnOther; Vogue Scandinavia (relaunched 2025/SS26 with Caroline Clante as co-CD)"),
    ("Baum und Pferdgarten", "Rikke Baumgarten & Helle Hestehave", "Co-founders & Creative Directors", 1, None, "F", None, "Wikipedia; L'Officiel; Vogue Scandinavia (both still CDs, 25th anniversary 2025)"),
    # --- batch 2 ---
    ("Berner Kuhl", "Frederik Berner Kuhl", "Founder & Creative Director", 1, None, "M", None, "Highsnobiety; Vogue Scandinavia (eponymous menswear, still his own designer, CPHFW 2025)"),
    ("Birrot", "Kyeongmin Kim & Seyoung Hong", "Co-founders & Creative Directors", 1, None, None, None, "Leblue; Vogue Scandinavia; SSENSE (Seoul-trained duo, still their own designers; gender not documented)"),
    ("Bonnetje", "Yoko Maja Hansen & Anna Myntekaer", "Co-founders & Creative Directors", 1, None, None, None, "Vogue Scandinavia; CIFF; Tribute To (founded 2021; gender not documented)"),
    ("Bruuns Bazaar", None, None, None, None, None, None, "No verifiable single design lead: founders Bjorn & Teis Bruun departed; brand owned via Hanssen/PBO, no publicly named current CD (last named CD Rebekka Bay, 2011)"),
    ("By Malene Birger", "Soeren Le Schmidt", "Head of Design", 0, None, "M", None, "Vogue Scandinavia (appointed Head of Design; first collection 2026). Malene Birger left brand 2011"),
    ("Caro Editions", "Caroline Brasch Nielsen", "Founder & Creative Director", 1, 1993, "F", None, "Wikipedia (b. 21 Jun 1993); caro-editions.com about; Vitinerantur (model-founder, designs all pieces)"),
    # --- batch 3 ---
    ("Cecilie Bahnsen", "Cecilie Bahnsen", "Founder & Creative Director", 1, 1984, "F", None, "Famous Birthdays / Preview.ph (b. 15 Feb 1984); CNN 2025; still her own house"),
    ("Cecilie Copenhagen", "Cecilie Jorgensen", "Founder & Creative Director", 1, None, "F", None, "TheIndustry.fashion; Refinery29 (founder-designer, eponymous brand)"),
    ("Day Birger et Mikkelsen", "Christina Exsteen", "Creative Director", 0, None, "F", None, "TCB Agency; brand info (CD since March 2020, led 2021 relaunch). Founder Keld Mikkelsen not involved"),
    ("Designers Remix", "Charlotte Eskildsen", "Founder & Creative Director", 1, None, "F", None, "Wikipedia; brand (co-founded 2002, still Creative Director)"),
    ("Ecco", None, None, None, None, None, None, "Corporate footwear group; no single public creative director / head of design (family-owned, product-design teams). Founder Karl Toosbuy d. 2004"),
    ("Fine Chaos", "Ludvig Isaksen & Marc Mollerskov", "Founder & Creative Director", 0, None, None, None, "Vogue Scandinavia; FashionUnited (Isaksen founder, Mollerskov creative director; label closing Aug 2026)"),
    # --- batch 4 ---
    ("Forza Collective", "Kristoffer Kongshaug", "Founder & Creative Director", 1, None, "M", None, "Vogue Scandinavia; Tribute To (Dior/Raf Simons alum, founded 2022, his own brand)"),
    ("Freya Dalsjo", "Freya Dalsjo", "Founder & Creative Director", 1, None, "F", None, "Vogue Scandinavia; Fizzy Mag (SS26 comeback after 6 yrs; eponymous, her own designer)"),
    ("Ganni", "Ditte Reffstrup", "Creative Director", 0, None, "F", None, "Vogue Scandinavia; BoF; models.com (CD since 2009 Reffstrup takeover; original brand founded 2000 by Frans Truelsen)"),
    ("Georg Jensen", "Paula Gerbase", "Creative Director", 0, None, "F", None, "WWD; FashionNetwork (appointed CD 2024 by Fiskars; oversees design across categories). Founder Georg Jensen d. 1935"),
    ("Gestuz", "Sanne Sehested", "Founder & Creative Director", 1, None, "F", None, "LinkedIn; gestuz.com; Facebook (Founder & Creative Director, still leading AW25)"),
    ("Han Kjobenhavn", "Jannik Wikkelso Davidsen", "Founder & Creative Director", 1, None, "M", None, "Wikipedia; Highsnobiety (sole owner/CD after co-founder Tim Faith Hancock exited 2017)"),
    # --- batch 5 ---
    ("Henrik Vibskov", "Henrik Vibskov", "Founder & Creative Director", 1, 1972, "M", None, "Wikipedia; Famous Birthdays (b. 5 Oct 1972); still his own artist-designer house"),
    ("Herskind", "Birgitte Herskind", "Founder & Creative Director", 1, None, "F", None, "herskindofficial.com; Vogue Scandinavia (founded/managed by designer Birgitte Herskind; brands-table 'Julie Herskind' is incorrect)"),
    ("Jane Konig", "Jane Konig", "Founder & Creative Director", 1, None, "F", None, "janekoenig.com about (still in charge of all creative development, designs every piece)"),
    ("Kamo", "Tim Faith Hancock", "Founder & Creative Director", 1, None, "M", None, "Vogue Scandinavia; OPUMO (founder & CD of KAMO; also Han Kjobenhavn co-founder)"),
    ("Kettel Atelier", "Laura Tonder", "Founder & Creative Director", 1, None, "F", None, "Vogue Scandinavia; gocirculaire; Balcone (founder-designer, CPHFW One to Watch SS26)"),
    ("Kinraden", "Sarah Mullertz", "Founder & Creative Director", 1, None, "F", None, "Forbes; Finematter; kinraden.com (founder & creative director, ex-architect, launched 2019)"),
    # --- batch 6 ---
    ("Les Deux", "Andreas von der Heide", "Co-founder & Creative Director", 1, None, "M", None, "Square Mile; FashionUnited; Menswear Style (co-founder & creative lead; co-founder Virgil Mwepele left)"),
    ("MKDT Studio", "Caroline Engelgaar", "Creative Director", 0, None, "F", None, "Kendam; mkdtstudio.com (CD since 2022; founder Mark Kenly Domino Tan stepped back, brand renamed 2025)"),
    ("Mads Norgaard", "Mads Norgaard", "Founder & Creative Director", 1, None, "M", None, "madsnorgaard.com; LeadIQ (founder, still Designer & CEO/Creative Director 2024-25)"),
    ("Maria Black", "Maria Black", "Founder & Creative Director", 1, None, "F", None, "maria-black.com about; JCK; NAKED (founder & creative director, trained goldsmith)"),
    ("Martin Quad", "Martin Juncker", "Founder & Creative Director", 1, None, None, None, "Copenhagen Fashion Week; Vogue Scandinavia (label led by designer Martin Juncker; gender not documented)"),
    ("Mfpen", "Sigurd Bank", "Founder & Creative Director", 1, None, "M", None, "LVMH Prize; PAUSE; Browns (founder-designer, 2025 LVMH Prize semi-finalist)"),
    # --- batch 7 ---
    ("Munthe", "Naja Munthe", "Founder & Creative Director", 1, None, "F", None, "en.munthe.com about; Kendam (sole owner & Creative Director, founded 1994, CPHFW 2025-26)"),
    ("NN07", None, None, None, None, None, None, "No publicly named current head of design/CD: brand was recruiting a Head of Design (2024); founders Victor Lindh & Ulrik Pedersen are business/CEO, not a single design lead"),
    ("Nicklas Skovgaard", "Nicklas Skovgaard", "Founder & Creative Director", 1, None, "M", None, "Wallpaper; Vogue Scandinavia; nicklasskovgaard.com (eponymous, founded 2020, his own designer)"),
    ("Norse Projects", "Tobia Sloth", "Co-founder & Creative Director", 1, None, "M", None, "Highsnobiety; Wikipedia; BoF (creative director guiding men's & women's collections)"),
    ("Nunoo", "Pia Silfen-Jensen & Naja Silfen", "Co-founders & Designers", 1, None, "F", None, "FashionUnited; Fashionista; nunoobags.com (founded 2015 by sisters; gender documented as sisters)"),
    ("O. Files", "Oscar Jardorf", "Founder & Creative Director", 1, None, "M", None, "Vogue Scandinavia; Highsnobiety; Hypebeast (founder & creative director, founded 2018)"),
    # --- batch 8 ---
    ("Ole Lynggaard Copenhagen", "Charlotte Lynggaard", "Creative Director", 0, 1966, "F", None, "Encyclopedia of Design (b. 1966); Shreve; olelynggaard.com (Creative Director, daughter of founder Ole Lynggaard)"),
    ("OperaSport", "Stephanie Gundelach & Awa Malina Stelter", "Co-founders & Creative Directors", 1, None, "F", None, "Wonderland; Numero; operasport.net (co-founders since 2019; brands-table 'Awa Malina Stelia' misspelled -> Stelter)"),
    ("P.L.N.", "Peter Lundvald Nielsen", "Founder & Creative Director", 1, None, "M", None, "FashionUnited; CPHFW; Style Cartel ('his own clothing brand'; founded 2020, ex-Balenciaga/Vetements/Ottolinger)"),
    ("Pandora", None, None, None, None, None, None, "Corporate jewelry group; no single 'creative director' analogous to a fashion house. Creative structure split: Stephen Fairchild (Chief Strategic Creative & Cultural Officer) + Philippa Newman (Chief Product Officer, Mar 2026). Founder Per Enevoldsen not a current design lead"),
    ("Rabens Saloner", "Birgitte Raben Olrik", "Founder & Creative Director", 1, None, "F", None, "Vogue Scandinavia; rabenssaloner.com; LinkedIn (Founder & Creative Director, still leading SS25)"),
    ("Remain Birger Christensen", "Martin Asbjorn", "Creative Director", 0, None, "M", None, "projectscandinavia; brand info (Creative Director since 2023); line is part of Birger Christensen Collective"),
    # --- batch 9 ---
    ("Roccamore", "Frederikke Antonie Schmidt", "Founder & Creative Director", 1, None, "F", None, "Crunchbase; roccamore.com; da.Wikipedia (Founder & Creative Director, designs the shoes)"),
    ("Rotate Birger Christensen", "Jeanette Madsen & Thora Valdimars", "Co-founders & Creative Directors", 1, None, "F", None, "Vogue Scandinavia; WWD; Refinery29 (both still Creative Directors through 2025)"),
    ("Saks Potts", None, None, None, None, None, None, "Brand CLOSED spring 2025 after 10 yrs (not financially driven, creative-evolution choice). No current design leader; founders Cathrine Saks & Barbara Potts. Src: Vogue Scandinavia, Marie Claire, Fashionista"),
    ("Samsoe Samsoe", None, None, None, None, None, None, "No single creative director / head of design: split structure (Head of Menswear + Head of Womenswear). Corporate Scandi brand; founders Klaus & Preben Samsoe not current design leads. Src: LinkedIn, The Org, BoF"),
    ("Skall Studio", "Julie & Marie Skall", "Co-founders & Creative Directors", 1, None, "F", None, "Vogue Scandinavia; skallstudio.com; Keisei (sisters, founded 2014, still their own designers)"),
    ("Sophie Bille Brahe", "Sophie Bille Brahe", "Founder & Creative Director", 1, None, "F", None, "sophiebillebrahe.com about; JCK (eponymous, founded 2011; 2025 Gem Awards nominee)"),
    # --- batch 10 (final) ---
    ("Soulland", None, None, None, None, None, None, "Founder/CD Silas Adler DEPARTED 2024 after 22 yrs; co-founder Jacob Kampp Berliner became sole owner (business), not documented as design lead. No publicly named successor creative director verified. Src: Vogue Scandinavia, Drapers"),
    ("Stel", "Astrid Andersen", "Founder & Creative Director", 1, None, "F", None, "Vogue Scandinavia; Highsnobiety; WWD (founder & CD; womenswear label launched 2024, ex-eponymous menswear)"),
    ("Stem", "Sarah Brunnhuber", "Founder & Creative Director", 1, None, "F", None, "WWD; nssmag; stem.page (founder & textile designer; won Wessel & Vett Prize)"),
    ("Stine Goya", "Stine Goya", "Founder & Creative Director", 1, None, "F", None, "Crunchbase; Drapers; stinegoya.com (founder & CD since 2006; Caroline Clante co-CD from 2025)"),
    ("Sunflower", "Ulrik Pedersen", "Founder & Creative Director", 1, None, "M", None, "WWD; Vogue Scandinavia; sabi (founder & creative lead; ex-NN07 founder)"),
    ("Taus", "Freyja Taus & Juho Lehio", "Co-founders & Creative Directors", 1, None, None, None, "Vogue Scandinavia; CPHFW; tausstudio.com (founded 2024; gender not documented)"),
    ("The Garment", "Sophia Roe & Charlotte Eskildsen", "Co-founders (Creative Director & Designer)", 1, None, "F", None, "SSENSE; Moda Operandi; SHOWstudio (founded 2020 by CD Sophia Roe & designer Charlotte Eskildsen)"),
    ("Won Hundred", "Nikolaj Nielsen", "Founder & Creative Director", 1, None, "M", None, "Vogue Scandinavia; Kendam; nssmag (founder & CD since 2004; Head of Design Katrine Lund Hansen joined 2025)"),
    ("Wood Wood", "Brian SS Jensen", "Co-founder & Creative Director", 1, None, "M", None, "FashionUnited; Drapers (co-founder became CD post DK Company acquisition; FW25 first collection). Co-founder Karl-Oskar Olsen left for Pas Normal"),
]

conn = sqlite3.connect(DB)
c = conn.cursor()
applied = 0
for brand, cd, role, fis, by, gender, dyear, src in VERIFIED:
    if dyear is not None:
        age = None
        src = f"{src}; deceased (d. {dyear})"
    else:
        age = (2026 - by) if by is not None else None
    c.execute("""UPDATE creative_directors
                 SET creative_director=?, role_title=?, founder_is_cd=?, birth_year=?, age_2026=?, gender=?, source=?
                 WHERE brand_name=?""",
              (cd, role, fis, by, age, gender, src, brand))
    applied += c.rowcount
conn.commit()

rows = c.execute("""SELECT brand_name, creative_director, role_title, founder_is_cd,
                    birth_year, age_2026, gender, source, notes FROM creative_directors ORDER BY brand_name""").fetchall()
with open(CSV_OUT, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["brand_name","creative_director","role_title","founder_is_cd","birth_year","age_2026","gender","source","notes"])
    w.writerows(rows)

cd_filled = c.execute("SELECT COUNT(*) FROM creative_directors WHERE creative_director IS NOT NULL").fetchone()[0]
by_filled = c.execute("SELECT COUNT(*) FROM creative_directors WHERE birth_year IS NOT NULL").fetchone()[0]
g_filled = c.execute("SELECT COUNT(*) FROM creative_directors WHERE gender IS NOT NULL").fetchone()[0]
total = c.execute("SELECT COUNT(*) FROM creative_directors").fetchone()[0]
print(f"applied {applied} | CD named={cd_filled}/{total} | birth_year={by_filled} | gender={g_filled}")
conn.close()
