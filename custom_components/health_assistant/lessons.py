"""Lessons for the Learn tab: Markdown files in data/lessons/.

Each ``name.md`` becomes a card titled from its file name (``intro_to_nutrition.md`` →
"Intro to Nutrition"). Cards are sorted by file name, so a numeric prefix such as
``01_intro_to_nutrition.md`` sets the order and is left out of the title. Images and
other files next to the lessons are served at ``/health_assistant_lessons/``, so a lesson
can use ``![Plate](plate.png)``. Files are read fresh each time, so edits show up on the
next visit without restarting Home Assistant.
"""
from __future__ import annotations

import os
import re

from .library import DATA_DIR

LESSONS_DIR = os.path.join(DATA_DIR, "lessons")
LESSONS_URL = "/health_assistant_lessons"
_SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\- .]*$")
_SMALL = {"a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with"}


def title_from_name(stem: str) -> str:
    words = re.sub(r"^\d+[\s_\-.]+", "", stem).replace("_", " ").replace("-", " ").split()
    out = []
    for i, w in enumerate(words):
        if w.isupper() and len(w) > 1:  # acronyms typed in capitals stay that way (USDA_basics)
            out.append(w)
        elif i and w.lower() in _SMALL:
            out.append(w.lower())
        else:
            out.append(w[:1].upper() + w[1:].lower())
    return " ".join(out) or stem


def _summary(text: str) -> str:
    """First plain paragraph, for the card's subtitle."""
    for block in re.split(r"\n\s*\n", text):
        b = block.strip()
        if not b or b[0] in "#>!|-*`" or re.match(r"^\d+\.", b):
            continue
        b = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", b)
        b = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", b)
        b = re.sub(r"[*_`]", "", b)
        b = " ".join(b.split())
        return b[:157] + "…" if len(b) > 160 else b
    return ""


def list_lessons() -> list[dict]:
    if not os.path.isdir(LESSONS_DIR):
        return []
    out = []
    for name in sorted(os.listdir(LESSONS_DIR), key=str.lower):
        stem, ext = os.path.splitext(name)
        if ext.lower() != ".md" or not _SLUG.match(stem):
            continue
        try:
            with open(os.path.join(LESSONS_DIR, name), encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        minutes = max(1, round(len(text.split()) / 200))
        out.append({"slug": stem, "title": title_from_name(stem), "summary": _summary(text), "minutes": minutes})
    return out


def read_lesson(slug: str) -> dict | None:
    if not _SLUG.match(slug or "") or "/" in slug or "\\" in slug or ".." in slug:
        return None
    path = os.path.join(LESSONS_DIR, f"{slug}.md")
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        text = f.read()
    return {"slug": slug, "title": title_from_name(slug), "markdown": text, "base_url": LESSONS_URL}
