"""One-time import of workout history exported from the Strong app (CSV).

Strong: Settings → Export Data (CSV). Columns:
Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps, Distance,
Seconds, Notes, Workout Notes, RPE

* Set Order is 1, 2, 3… for working sets, W (warm-up), F (failure), D (drop), or
  "Rest Timer" (a row whose Seconds is the rest after the previous set).
* Weight/Distance are in the units the Strong app was set to (lb / miles by default
  in the US) — the panel passes the profile's units.

Exercise names are matched to the Health Assistant library with the table below,
then by fuzzy name match; anything left becomes a custom exercise.
No Home Assistant imports, so it can be tested directly.
"""
from __future__ import annotations

import csv
import difflib
import hashlib
import io
import re
from datetime import datetime, timedelta, tzinfo

LB_PER_KG = 2.2046226218
M_PER_MI = 1609.344

# Strong exercise name (lower-case) -> Health Assistant exercise id.
STRONG_MAP: dict[str, str] = {
    # Chest
    "bench press (barbell)": "bench_press",
    "bench press - wide grip (barbell)": "bench_press",
    "decline bench press (barbell)": "bench_press",
    "bench press - close grip (barbell)": "close_grip_bench_press",
    "bench press (dumbbell)": "db_bench_press",
    "decline bench press (dumbbell)": "db_bench_press",
    "incline bench press (barbell)": "incline_bench_press",
    "incline bench press (dumbbell)": "incline_db_press",
    "chest press (machine)": "chest_press_machine",
    "iso-lateral chest press (machine)": "chest_press_machine",
    "iso-lateral decline press": "chest_press_machine",
    "mts decline press": "chest_press_machine",
    "incline chest press (machine)": "incline_chest_press_machine",
    "iso-lateral incline press": "incline_chest_press_machine",
    "mts incline press": "incline_chest_press_machine",
    "chest fly": "chest_fly_machine",
    "chest fly (machine)": "chest_fly_machine",
    "chest fly (dumbbell)": "db_chest_fly",
    "incline chest fly (dumbbell)": "db_chest_fly",
    "chest fly (band)": "cable_crossover",
    "cable fly crossovers": "cable_crossover",
    "chest dip": "dip",
    "triceps dip": "dip",
    "chest dip (assisted)": "assisted_dip",
    "push up": "push_up",
    "pike pushup": "push_up",
    "decline pushup": "push_up",
    # Back
    "deadlift (barbell)": "deadlift",
    "bent over row (barbell)": "barbell_row",
    "inverted row (bodyweight)": "barbell_row",
    "incline row (dumbbell)": "db_row",
    "dumbbell row": "db_row",
    "lat pulldown (machine)": "lat_pulldown",
    "lat pulldown (cable)": "lat_pulldown",
    "iso-lateral front lat pulldown": "lat_pulldown",
    "pullover (machine)": "lat_pulldown",
    "seated row (machine)": "seated_cable_row",
    "seated row (cable)": "seated_cable_row",
    "seated wide-grip row (cable)": "seated_cable_row",
    "iso-lateral high row": "seated_cable_row",
    "t bar row": "t_bar_row",
    "pull up": "pull_up",
    "wide pull up": "pull_up",
    "pull up (assisted)": "assisted_pull_up",
    "chin up": "chin_up",
    "dead hang": "dead_hang",
    # Legs
    "squat (barbell)": "squat",
    "front squat (barbell)": "front_squat",
    "squat (machine)": "hack_squat",
    "hack squat": "hack_squat",
    "linear hack squat": "hack_squat",
    "romanian deadlift (barbell)": "romanian_deadlift",
    "romanian deadlift (smith machine)": "romanian_deadlift",
    "hip hinge": "romanian_deadlift",
    "leg press": "leg_press",
    "seated leg press (machine)": "leg_press",
    "seated squat": "leg_press",
    "leg extension (machine)": "leg_extension",
    "iso-lateral leg extension": "leg_extension",
    "sissy squat (bodyweight)": "leg_extension",
    "seated leg curl (machine)": "leg_curl",
    "lying leg curl (machine)": "leg_curl",
    "bulgarian split squat": "bulgarian_split_squat",
    "pistol squat": "bulgarian_split_squat",
    "lunge (dumbbell)": "walking_lunge",
    "lunge (bodyweight)": "walking_lunge",
    "step-up": "step_up",
    "goblet squat (kettlebell)": "goblet_squat",
    "goblet squat (dumbbell)": "goblet_squat",
    "hip thrust (barbell)": "hip_thrust",
    "hip thrust (dumbbell)": "hip_thrust",
    "booty builder": "hip_thrust",
    "glute kickback (machine)": "glute_kickback",
    "hip abductor (machine)": "hip_abductor",
    "hip adductor (machine)": "hip_adductor",
    "seated calf raise (plate loaded)": "calf_raise",
    "seated calf raise (machine)": "calf_raise",
    "standing calf raise (dumbbell)": "calf_raise",
    "standing calf raise (barbell)": "calf_raise",
    # Shoulders
    "overhead press (barbell)": "overhead_press",
    "overhead press (dumbbell)": "db_shoulder_press",
    "seated overhead press (dumbbell)": "db_shoulder_press",
    "shoulder press (dumbells)": "db_shoulder_press",
    "shoulder press (dumbbell)": "db_shoulder_press",
    "shoulder press (machine)": "shoulder_press_machine",
    "shoulder press (plate loaded)": "shoulder_press_machine",
    "converging shoulder press": "shoulder_press_machine",
    "lateral raise (dumbbell)": "lateral_raise",
    "lateral raise (machine)": "lateral_raise",
    "lateral raise (cable)": "lateral_raise_cable",
    "reverse fly (machine)": "rear_delt_fly",
    "reverse fly (cable)": "rear_delt_fly",
    "reverse fly (dumbbell)": "rear_delt_fly",
    "face pull (cable)": "face_pull",
    "upright row (barbell)": "upright_row",
    # Arms
    "bicep curl (barbell)": "barbell_curl",
    "preacher curl (barbell)": "barbell_curl",
    "bicep curl (dumbbell)": "db_curl",
    "bicep curl (cable)": "db_curl",
    "bicep curl (kettlebell)": "db_curl",
    "concentration curl (dumbbell)": "db_curl",
    "incline curl (dumbbell)": "db_curl",
    "preacher curl (dumbbell)": "db_curl",
    "bicep curl (machine)": "machine_curl",
    "hammer curl (dumbbell)": "hammer_curl",
    "hammer curl (cable)": "hammer_curl",
    "tricep pushdown": "tricep_pushdown",
    "triceps pushdown (cable - straight bar)": "tricep_pushdown",
    "triceps pushdown (cable - rope)": "tricep_pushdown",
    "overhead tricep extension": "overhead_tricep_ext",
    "triceps extension": "overhead_tricep_ext",
    "triceps extension (dumbbell)": "overhead_tricep_ext",
    "triceps extension (machine)": "overhead_tricep_ext",
    "triceps extension (barbell)": "skull_crusher",
    "skullcrusher (dumbbell)": "skull_crusher",
    "skullcrusher (barbell)": "skull_crusher",
    "tricep press (machine)": "seated_dip_machine",
    "seated dip": "seated_dip_machine",
    "bench dip": "bench_dip",
    # Core
    "plank": "plank",
    "bench hold": "plank",
    "pallof press (duration)": "plank",
    "pallof press (reps)": "pallof_press",
    "knee raise (captain's chair)": "hanging_leg_raise",
    "hanging leg raise": "hanging_leg_raise",
    "flat leg raise": "hanging_leg_raise",
    "dragon flag": "hanging_leg_raise",
    "crunch (machine)": "cable_crunch",
    "cable crunch": "cable_crunch",
    "sit up": "cable_crunch",
    "farmer’s carry": "farmers_carry",
    "farmer's carry": "farmers_carry",
    "waiter carry": "farmers_carry",
    # Cardio & activities
    "running (treadmill)": "treadmill",
    "walking": "walking",
    "stairmaster": "stair_climber",
    "rowing (machine)": "rowing_machine",
    "fan bike": "stationary_bike",
    "seated bike": "stationary_bike",
    "elliptical machine": "elliptical",
    "swimming": "swimming",
    "stretching": "stretching",
    "baseball": "baseball",
    "zumba": "dance_fitness",
}

SET_TYPES = {"W": "warmup", "F": "failure", "D": "drop"}
DATE_FORMATS = ("%m/%d/%y %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%m/%d/%Y %H:%M")


def _norm(name: str) -> str:
    return re.sub(r"\s+", " ", name.replace("’", "'")).strip().lower()


def _num(v) -> float | None:
    try:
        f = float(str(v).strip())
    except (TypeError, ValueError):
        return None
    return f if f else None


def _duration(text: str) -> timedelta:
    h = re.search(r"(\d+)\s*h", text or "")
    m = re.search(r"(\d+)\s*m(?!s)", text or "")
    s = re.search(r"(\d+)\s*s", text or "")
    return timedelta(hours=int(h[1]) if h else 0, minutes=int(m[1]) if m else 0, seconds=int(s[1]) if s else 0)


def _parse_date(text: str, tz: tzinfo | None) -> datetime:
    for fmt in DATE_FORMATS:
        try:
            d = datetime.strptime(text.strip(), fmt)
            return d.replace(tzinfo=tz) if tz else d
        except ValueError:
            continue
    raise ValueError(f"Unrecognised date: {text!r}")


def match_exercise(name: str, library: list[dict]) -> tuple[str | None, str]:
    """(exercise id or None, how it was matched: table | name | fuzzy | none)."""
    key = _norm(name)
    ids = {e["id"] for e in library}
    if key in STRONG_MAP and STRONG_MAP[key] in ids:
        return STRONG_MAP[key], "table"
    by_name = {_norm(e["name"]): e["id"] for e in library}
    if key in by_name:
        return by_name[key], "name"
    close = difflib.get_close_matches(key, list(by_name), n=1, cutoff=0.82)
    if close:
        return by_name[close[0]], "fuzzy"
    return None, "none"


def parse_strong_csv(text: str, library: list[dict], *, units: str = "imperial",
                     tz: tzinfo | None = None) -> dict:
    """Turn a Strong export into Health Assistant workouts plus a matching report."""
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    need = {"Date", "Workout Name", "Exercise Name", "Set Order"}
    if not reader.fieldnames or not need <= set(reader.fieldnames):
        raise ValueError("This doesn't look like a Strong export (missing Date / Workout Name / Exercise Name / Set Order)")

    to_kg = (lambda w: w / LB_PER_KG) if units == "imperial" else (lambda w: w)
    to_m = (lambda d: d * M_PER_MI) if units == "imperial" else (lambda d: d * 1000)
    lib_by_id = {e["id"]: e for e in library}

    workouts: dict[tuple, dict] = {}
    matches: dict[str, dict] = {}
    skipped_empty = 0

    for row in reader:
        key = (row["Date"], row["Workout Name"])
        w = workouts.get(key)
        if w is None:
            start = _parse_date(row["Date"], tz)
            wid = "strong_" + hashlib.sha1(f"{row['Date']}|{row['Workout Name']}".encode()).hexdigest()[:12]
            w = workouts[key] = {
                "id": wid, "name": row["Workout Name"].strip() or "Workout",
                "started_at": start.isoformat(),
                "ended_at": (start + (_duration(row.get("Duration", "")) or timedelta(minutes=45))).isoformat(),
                "notes": "", "template_id": None, "source": "strong", "exercises": [],
            }
        if row.get("Workout Notes") and not w["notes"]:
            w["notes"] = row["Workout Notes"].strip()

        name = row["Exercise Name"].strip()
        m = matches.get(name)
        if m is None:
            ex_id, how = match_exercise(name, library)
            m = matches[name] = {"strong": name, "exercise_id": ex_id, "how": how, "sets": 0, "workouts": set()}
        ex_id = m["exercise_id"] or f"strong_custom_{re.sub(r'[^a-z0-9]+', '_', _norm(name)).strip('_')}"
        if not m["exercise_id"]:
            m["custom_id"] = ex_id

        exs = w["exercises"]
        if not exs or exs[-1]["_strong"] != name:
            exs.append({"id": f"{w['id']}_{len(exs)}", "exercise_id": ex_id, "notes": "", "rest_s": None,
                        "superset": None, "sets": [], "_strong": name, "_rests": []})
        ex = exs[-1]

        order = (row.get("Set Order") or "").strip()
        if order.lower() == "rest timer":
            if (r := _num(row.get("Seconds"))):
                ex["_rests"].append(int(r))
            continue

        weight, reps = _num(row.get("Weight")), _num(row.get("Reps"))
        dist, secs = _num(row.get("Distance")), _num(row.get("Seconds"))
        if not any((weight, reps, dist, secs)):
            skipped_empty += 1
            continue
        kind = (lib_by_id.get(ex_id) or {}).get("kind", "weight_reps")
        if ex_id == "stair_climber":
            dist = None  # Strong logs floors in the distance column
        rpe = _num(row.get("RPE"))
        ex["sets"].append({
            "id": f"{ex['id']}_{len(ex['sets'])}",
            "type": SET_TYPES.get(order.upper(), "working"),
            "weight": round(to_kg(weight), 3) if weight else None,
            "reps": int(reps) if reps else None,
            "rpe": rpe if rpe and 1 <= rpe <= 10 else None,
            "duration_s": int(secs) if secs else None,
            "distance_m": round(to_m(dist), 1) if dist and kind == "distance" else None,
            "completed": True,
            **({"note": row["Notes"].strip()} if row.get("Notes") else {}),
        })
        m["sets"] += 1
        m["workouts"].add(w["id"])

    out = []
    for w in workouts.values():
        for ex in w["exercises"]:
            rests = ex.pop("_rests")
            ex.pop("_strong")
            if rests:
                ex["rest_s"] = max(set(rests), key=rests.count)
        w["exercises"] = [e for e in w["exercises"] if e["sets"]]
        if w["exercises"]:
            out.append(w)
    out.sort(key=lambda w: w["started_at"])

    report = sorted(({**m, "workouts": len(m["workouts"]),
                      "name": (lib_by_id.get(m["exercise_id"]) or {}).get("name")} for m in matches.values()),
                    key=lambda m: -m["sets"])
    return {"workouts": out, "matches": report, "skipped_empty_sets": skipped_empty}
