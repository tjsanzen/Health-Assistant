"""Read-only access to the OpenNutrition food database (built by scripts/build_food_db.py)."""
from __future__ import annotations

import os
import re
import sqlite3
import threading

_COLS = (
    "id", "name", "brand", "type", "serving_qty", "serving_unit", "serving_g",
    "kcal", "protein", "fat", "carbs", "fiber", "sugar", "sodium", "sat_fat", "ean",
)
COLUMNS = ", ".join(f"foods.{c}" for c in _COLS)
NUTRIENT_KEYS = ("kcal", "protein", "fat", "carbs", "fiber", "sugar", "sodium", "sat_fat")
TOKEN_RE = re.compile(r"[\w']+", re.UNICODE)


class FoodDatabase:
    def __init__(self, paths: list[str]) -> None:
        self.path = next((p for p in paths if os.path.isfile(p)), None)
        self._local = threading.local()

    @property
    def available(self) -> bool:
        return self.path is not None

    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            self._local.conn = conn
        return conn

    @staticmethod
    def _row(row: sqlite3.Row) -> dict:
        d = dict(row)
        d["per_100g"] = {k: d.pop(k) for k in NUTRIENT_KEYS}
        return d

    def search(self, query: str, limit: int = 25) -> list[dict]:
        """Prefix full-text search; whole foods rank above branded items."""
        if not self.available:
            return []
        tokens = [t for t in TOKEN_RE.findall(query.lower()) if t]
        if not tokens:
            return []
        match = " ".join(f'"{t}"*' for t in tokens)
        sql = f"""
            SELECT {COLUMNS}
            FROM foods_fts JOIN foods ON foods.rowid = foods_fts.rowid
            WHERE foods_fts MATCH ?
            ORDER BY bm25(foods_fts, 10.0, 2.0, 1.0) + foods.rank * 1.5
                     + length(foods.name) * 0.02
            LIMIT ?
        """
        rows = self._conn().execute(sql, (match, limit)).fetchall()
        return [self._row(r) for r in rows]

    def get(self, food_id: str) -> dict | None:
        if not self.available:
            return None
        row = self._conn().execute(f"SELECT {COLUMNS} FROM foods WHERE id = ?", (food_id,)).fetchone()
        return self._row(row) if row else None

    def barcode(self, ean: str) -> dict | None:
        if not self.available:
            return None
        ean = ean.strip().zfill(13)
        row = self._conn().execute(f"SELECT {COLUMNS} FROM foods WHERE ean = ?", (ean,)).fetchone()
        return self._row(row) if row else None

    def count(self) -> int:
        if not self.available:
            return 0
        return self._conn().execute("SELECT count(*) FROM foods").fetchone()[0]
