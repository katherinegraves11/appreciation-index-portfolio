#!/usr/bin/env python3
"""Skeleton `creative_directors` table: one row per brand, current design leader.
All demographic fields start NULL; filled only from verified sources by enrich script."""
import sqlite3, csv, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(BASE, "db", "copenhagen-fashion-brands.db")
CSV_OUT = os.path.join(BASE, "raw", "copenhagen-fashion-brands", "copenhagen_creative_directors.csv")

conn = sqlite3.connect(DB)
c = conn.cursor()
brands = [r[0] for r in c.execute("SELECT brand_name FROM brands ORDER BY brand_name").fetchall()]

c.execute("DROP TABLE IF EXISTS creative_directors")
c.execute("""
CREATE TABLE creative_directors (
    brand_name        TEXT,
    creative_director TEXT,     -- current person in charge of design (NULL if unverified/none)
    role_title        TEXT,     -- e.g. 'Creative Director', 'Head Designer', 'Founder & CD'
    founder_is_cd     INTEGER,  -- 1 if the current CD is also the original founder, 0 if not, NULL unknown
    birth_year        INTEGER,
    age_2026          INTEGER,
    gender            TEXT,      -- only from documented public record, never name-inferred
    source            TEXT,
    notes             TEXT
)""")
for b in brands:
    c.execute("""INSERT INTO creative_directors
                 (brand_name, creative_director, role_title, founder_is_cd, birth_year, age_2026, gender, source, notes)
                 VALUES (?,?,?,?,?,?,?,?,?)""",
              (b, None, None, None, None, None, None, None, None))
conn.commit()

rows = c.execute("""SELECT brand_name, creative_director, role_title, founder_is_cd,
                    birth_year, age_2026, gender, source, notes FROM creative_directors ORDER BY brand_name""").fetchall()
with open(CSV_OUT, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["brand_name","creative_director","role_title","founder_is_cd","birth_year","age_2026","gender","source","notes"])
    w.writerows(rows)

print(f"creative_directors skeleton built: {len(brands)} brands")
print(f"CSV -> {CSV_OUT}")
conn.close()
