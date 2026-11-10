#!/usr/bin/env python3
"""Build the Health Assistant food database from the OpenNutrition TSV export.

The raw TSV (~280 MB, 300k+ foods, ~100 nutrients each) is far too heavy to load
inside Home Assistant. This script keeps only what the app needs (name, brand,
serving, core macros, barcode) and writes a compact SQLite file with a full-text
search index.

Usage (defaults shown):
    python3 scripts/build_food_db.py \
        [custom_components/health_assistant/data/opennutrition_foods.tsv] \
        [custom_components/health_assistant/data/foods.db]
"""
from __future__ import annotations

import csv
import json
import os
import re
import sqlite3
import sys
import time

csv.field_size_limit(10**9)

# nutrition_100g key -> our column
NUTRIENTS = {
    "calories": "kcal",
    "protein": "protein",
    "total_fat": "fat",
    "carbohydrates": "carbs",
    "dietary_fiber": "fiber",
    "total_sugars": "sugar",
    "sodium": "sodium",  # mg
    "saturated_fats": "sat_fat",
}

# Rank food types so whole/everyday foods outrank the long tail of branded items.
TYPE_RANK = {"everyday": 0, "prepared": 1, "restaurant": 2, "grocery": 3}

BY_RE = re.compile(r"^(?P<name>.+?) by (?P<brand>[^,]+)$")


def split_brand(name: str) -> tuple[str, str | None]:
    """Grocery items look like 'Raw Shrimp by May'. Split off the brand."""
    m = BY_RE.match(name)
    if m:
        return m.group("name").strip(), m.group("brand").strip()
    return name, None


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, 3)


def main(src: str, dst: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    tmp = dst + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)

    db = sqlite3.connect(tmp)
    db.executescript(
        """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE foods (
            rowid INTEGER PRIMARY KEY,
            id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            brand TEXT,
            type TEXT,
            rank INTEGER,
            serving_qty REAL,
            serving_unit TEXT,
            serving_g REAL,
            kcal REAL, protein REAL, fat REAL, carbs REAL,
            fiber REAL, sugar REAL, sodium REAL, sat_fat REAL,
            ean TEXT
        );
        CREATE VIRTUAL TABLE foods_fts USING fts5(
            name, brand, alt, content='', tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        """
    )

    rows, fts = [], []
    count = skipped = 0
    started = time.time()

    with open(src, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for i, row in enumerate(reader, 1):
            try:
                nut = json.loads(row.get("nutrition_100g") or "{}")
            except json.JSONDecodeError:
                skipped += 1
                continue
            kcal = num(nut.get("calories"))
            if kcal is None:
                skipped += 1
                continue

            name, brand = split_brand(row["name"].strip())
            serving_qty = serving_unit = serving_g = None
            try:
                sv = json.loads(row.get("serving") or "{}")
                common = sv.get("common") or {}
                metric = sv.get("metric") or {}
                serving_qty = num(common.get("quantity"))
                serving_unit = common.get("unit")
                if metric.get("unit") in ("g", "ml"):
                    serving_g = num(metric.get("quantity"))
            except json.JSONDecodeError:
                pass

            alt = ""
            try:
                alt = " ".join(json.loads(row.get("alternate_names") or "[]"))
            except json.JSONDecodeError:
                pass

            count += 1
            rows.append(
                (
                    count,
                    row["id"],
                    name,
                    brand,
                    row.get("type"),
                    TYPE_RANK.get(row.get("type"), 9),
                    serving_qty,
                    serving_unit,
                    serving_g,
                    kcal,
                    *(num(nut.get(k)) for k in list(NUTRIENTS)[1:]),
                    (row.get("ean_13") or None),
                )
            )
            fts.append((count, name, brand or "", alt))

            if len(rows) >= 20000:
                db.executemany(
                    f"INSERT INTO foods VALUES ({','.join('?' * 18)})", rows
                )
                db.executemany(
                    "INSERT INTO foods_fts(rowid,name,brand,alt) VALUES (?,?,?,?)", fts
                )
                rows.clear()
                fts.clear()
                print(f"  {i:,} rows read ({time.time() - started:.0f}s)", flush=True)

    if rows:
        db.executemany(f"INSERT INTO foods VALUES ({','.join('?' * 18)})", rows)
        db.executemany("INSERT INTO foods_fts(rowid,name,brand,alt) VALUES (?,?,?,?)", fts)

    db.execute("CREATE INDEX foods_ean ON foods(ean) WHERE ean IS NOT NULL")
    db.execute("INSERT INTO foods_fts(foods_fts) VALUES ('optimize')")
    db.executemany(
        "INSERT INTO meta VALUES (?,?)",
        [
            ("source", "OpenNutrition (opennutrition.app)"),
            ("built", time.strftime("%Y-%m-%dT%H:%M:%S")),
            ("count", str(count)),
            ("schema", "1"),
        ],
    )
    db.commit()
    db.execute("VACUUM")
    db.close()
    os.replace(tmp, dst)
    size = os.path.getsize(dst) / 1e6
    print(f"Done: {count:,} foods ({skipped:,} skipped) -> {dst} ({size:.1f} MB)")


if __name__ == "__main__":
    data = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "custom_components", "health_assistant", "data")
    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)
    src = args[0] if len(args) > 0 else os.path.join(data, "opennutrition_foods.tsv")
    dst = args[1] if len(args) > 1 else os.path.join(data, "foods.db")
    main(src, dst)
