"""Exercise library loaded from data/exercises/exercises.json.

The file is re-read whenever it changes on disk, so you can edit exercises
(or drop a new GIF into data/demos/) without restarting Home Assistant.

exercises.json format — one entry per exercise, keyed by id:

    "lateral_raise_cable": {
      "name": "Lateral Raise (Cable)",
      "muscle": "Shoulders",
      "secondary": ["Traps"],              # optional
      "equipment": "Cable",
      "kind": "weight_reps",               # weight_reps | bodyweight_reps | duration | distance
      "instructions": ["Step 1", "Step 2"],# list of steps, or one string
      "tips": ["..."],                     # optional
      "demo": "lateral_raise_cable.gif"    # file in data/demos/ (defaults to <id>.gif)
    }

Keep ids stable once you've logged workouts with them — history refers to the id.
"""
from __future__ import annotations

import json
import logging
import os
import threading

_LOGGER = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
EXERCISES_FILE = os.path.join(DATA_DIR, "exercises", "exercises.json")
DEMOS_DIR = os.path.join(DATA_DIR, "demos")
KINDS = {"weight_reps", "bodyweight_reps", "duration", "distance"}


class ExerciseLibrary:
    def __init__(self, path: str = EXERCISES_FILE, demos_dir: str = DEMOS_DIR,
                 demo_url: str = "") -> None:
        self.path = path
        self.demos_dir = demos_dir
        self.demo_url = demo_url.rstrip("/")
        self._lock = threading.Lock()
        self._stamp: tuple | None = None
        self._items: list[dict] = []

    def _signature(self) -> tuple:
        try:
            f = os.stat(self.path).st_mtime
        except OSError:
            f = None
        try:
            d = os.stat(self.demos_dir).st_mtime
        except OSError:
            d = None
        return (f, d)

    def all(self) -> list[dict]:
        """Return the library, reloading if the JSON or demos folder changed."""
        sig = self._signature()
        if sig == self._stamp:
            return self._items
        with self._lock:
            if sig != self._stamp:
                self._items = self._load()
                self._stamp = sig
        return self._items

    def _load(self) -> list[dict]:
        try:
            with open(self.path, encoding="utf-8") as fh:
                raw = json.load(fh)
        except FileNotFoundError:
            _LOGGER.warning("Exercise library not found at %s", self.path)
            return []
        except json.JSONDecodeError as err:
            _LOGGER.error("exercises.json is not valid JSON (%s) — keeping the previous library", err)
            return self._items
        try:
            demos = set(os.listdir(self.demos_dir))
        except OSError:
            demos = set()

        items = []
        for ex_id, e in raw.items():
            if not isinstance(e, dict) or not e.get("name"):
                _LOGGER.warning("Skipping exercise %s: missing name", ex_id)
                continue
            instructions = e.get("instructions") or []
            if isinstance(instructions, str):
                instructions = [instructions]
            demo = e.get("demo") or f"{ex_id}.gif"
            kind = e.get("kind", "weight_reps")
            items.append({
                "id": ex_id,
                "name": e["name"],
                "muscle": e.get("muscle") or "Other",
                "secondary": e.get("secondary") or [],
                "equipment": e.get("equipment") or "Other",
                "kind": kind if kind in KINDS else "weight_reps",
                "instructions": instructions,
                "tips": e.get("tips") or [],
                "demo_url": f"{self.demo_url}/{demo}" if demo in demos else None,
                "custom": False,
            })
        return items
