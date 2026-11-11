"""Health Assistant data model.

All user data for one profile lives in a single dict persisted by Home
Assistant's Store helper. Everything is stored in metric units (kg, cm, g);
the frontend converts for display.

This module has no Home Assistant imports so it can be unit tested directly.
"""
from __future__ import annotations

import copy
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Callable

from .calculations import calculate_energy, estimated_1rm
from .const import MEALS, SET_TYPES, VITAL_TYPES

RECENT_FOODS_MAX = 40
DEFAULT_REST_S = 120
PROFILE_FIELDS = {
    "name", "units", "sex", "age", "height_cm", "target_weight_kg", "daily_steps",
    "lifting_days", "goal_rate_kg_week",
    # Manual targets (None = use the calculated value)
    "calorie_target_override", "protein_override_g", "carbs_override_g", "fat_override_g",
    # Workout settings
    "rest_default_s", "live_activity_notify",
    # iPhone: step sensor from the Companion app, and Apple Health export
    "steps_sensor", "apple_health_export", "apple_health_shortcut",
}
STEPS_AVG_DAYS = 14
LIFT_TRACK_MIN_DAYS = 14   # logging this long switches activity to logged workouts
LIFT_WINDOW_DAYS = 28      # average training time over the last 4 weeks
LIFT_MAX_SESSION_H = 3.0   # cap forgotten-to-finish workouts
STEPS_MIN_DAYS = 3  # need this many tracked days before replacing the typed-in average
COUNTED_SET_TYPES = {"working", "failure", "drop"}  # warm-ups never count toward records


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def empty_data(profile: dict) -> dict:
    return {
        "profile": profile,
        "food_log": [],
        "custom_foods": [],
        "recent_foods": [],
        "vitals": [],
        "workouts": [],
        "templates": [],
        "custom_exercises": [],
        "active_workout": None,
        "steps_log": {},  # "YYYY-MM-DD" -> steps that day (from the Companion app sensor)
    }


class ValidationError(ValueError):
    """Raised for bad input coming from the panel."""


class HealthModel:
    def __init__(
        self,
        data: dict,
        save: Callable[[], None],
        now: Callable[[], datetime],
        library: Callable[[], list[dict]] = lambda: [],
        emit: Callable[[str, Any], None] | None = None,
    ) -> None:
        self.data = data
        self._save = save
        self._now = now
        self._library = library
        self._emit_cb = emit
        for key, default in empty_data({}).items():
            self.data.setdefault(key, copy.deepcopy(default))

    # ------------------------------------------------------------------ utils
    def today(self) -> str:
        return self._now().date().isoformat()

    def _changed(self) -> None:
        self._save()

    def _emit(self, event: str, payload: Any = None) -> None:
        if self._emit_cb:
            self._emit_cb(event, payload)

    # ---------------------------------------------------------------- profile
    @property
    def profile(self) -> dict:
        return self.data["profile"]

    def update_profile(self, changes: dict) -> dict:
        for k, v in changes.items():
            if k not in PROFILE_FIELDS:
                raise ValidationError(f"Unknown profile field: {k}")
            if k.endswith("_override") or k.endswith("_override_g"):
                v = None if v in (None, "", 0) else round(float(v))
                if v is not None and v < 0:
                    raise ValidationError("Targets can't be negative")
            self.profile[k] = v
        if "age" in changes:
            self.profile["age_recorded"] = self.today()
        if "height_cm" in changes:
            self.add_vital("height", {"value": changes["height_cm"]}, note="Profile update")
        self._changed()
        self._emit("profile_updated", changes)
        return self.profile

    def current_age(self) -> float:
        age = self.profile.get("age") or 30
        recorded = self.profile.get("age_recorded")
        if recorded:
            years = (self._now().date() - date.fromisoformat(recorded)).days / 365.25
            age += int(years)
        return age

    def current_weight(self) -> float | None:
        v = self.latest_vital("weight")
        return v["value"] if v else None

    def current_body_fat(self) -> float | None:
        v = self.latest_vital("body_fat")
        return v["value"] if v else None

    def current_height(self) -> float | None:
        v = self.latest_vital("height")
        return v["value"] if v else self.profile.get("height_cm")

    def energy(self) -> dict | None:
        weight = self.current_weight()
        height = self.current_height()
        if not weight or not height:
            return None
        lift = self.lifting_tracked()
        res = calculate_energy(
            weight_kg=weight,
            height_cm=height,
            age=self.current_age(),
            sex=self.profile.get("sex", "male"),
            body_fat_pct=self.current_body_fat(),
            daily_steps=int(self.steps_for_energy()[0]),
            lifting_days=float(self.profile.get("lifting_days") or 0),
            lifting_hours_per_week=lift["hours_per_week"] if lift["active"] else None,
            target_weight_kg=self.profile.get("target_weight_kg"),
            goal_rate_kg_week=float(self.profile.get("goal_rate_kg_week") or 0),
        )
        out = res.as_dict()
        out["steps_used"], out["steps_source"] = self.steps_for_energy()
        out["lifting"] = lift
        out["protein_rule"] = "0.9 g/lb (under 15% body fat)" if (self.current_body_fat() or 100) < 15 else "0.6 g/lb"
        # Manual overrides from the Profile tab win over the calculated numbers.
        p = self.profile
        out["target_auto"] = out["target"]
        out["macros_auto"] = {"protein_g": out["protein_g"], "fat_g": out["fat_g"], "carbs_g": out["carbs_g"]}
        out["target_manual"] = bool(p.get("calorie_target_override"))
        if out["target_manual"]:
            out["target"] = float(p["calorie_target_override"])
            out["fat_g"] = round(out["target"] * 0.25 / 9, 1)
            out["carbs_g"] = round(max(0.0, (out["target"] - out["protein_g"] * 4 - out["fat_g"] * 9) / 4), 1)
        manual_macros = []
        for key, field in (("protein_g", "protein_override_g"), ("fat_g", "fat_override_g"),
                           ("carbs_g", "carbs_override_g")):
            if p.get(field):
                out[key] = float(p[field])
                manual_macros.append(key)
        if manual_macros and "carbs_g" not in manual_macros:
            # Carbs fill whatever calories the fixed macros leave.
            out["carbs_g"] = round(max(0.0, (out["target"] - out["protein_g"] * 4 - out["fat_g"] * 9) / 4), 1)
        out["macros_manual"] = manual_macros
        return out

    # ---------------------------------------------------------------- lifting
    def lifting_tracked(self) -> dict:
        """Training time from logged workouts. Takes over once 2 weeks of lifting are logged."""
        now = self._now()

        def ts(iso: str) -> datetime:
            d = datetime.fromisoformat(iso)
            # Mixed naive/aware timestamps can't be compared; treat naive as local time.
            if (d.tzinfo is None) != (now.tzinfo is None):
                d = d.replace(tzinfo=now.tzinfo)
            return d

        ws = self.data["workouts"]
        if not ws:
            return {"active": False, "days_logged": 0, "hours_per_week": None, "sessions_per_week": None}
        span_days = (now - min(ts(w["started_at"]) for w in ws)).days
        window = min(LIFT_WINDOW_DAYS, max(span_days, 1))
        cutoff = now - timedelta(days=window)
        hours = sessions = 0.0
        for w in ws:
            if ts(w["started_at"]) < cutoff:
                continue
            dur = (w.get("summary") or {}).get("duration_s") or 0
            hours += min(dur / 3600, LIFT_MAX_SESSION_H)
            sessions += 1
        weeks = window / 7
        return {
            "active": span_days >= LIFT_TRACK_MIN_DAYS,
            "days_logged": span_days,
            "hours_per_week": round(hours / weeks, 2),
            "sessions_per_week": round(sessions / weeks, 1),
        }

    def workout_calendar(self, year: int, month: int) -> list[dict]:
        prefix = f"{year:04d}-{month:02d}-"
        days: dict[str, list[str]] = {}
        for w in self.data["workouts"]:
            d = w["started_at"][:10]
            if d.startswith(prefix):
                days.setdefault(d, []).append(w.get("name") or "Workout")
        return [{"date": d, "count": len(n), "names": n} for d, n in sorted(days.items())]

    # ------------------------------------------------------------------ steps
    def record_steps(self, day: str, steps: int) -> bool:
        """Keep the highest reading per day (the phone's counter only goes up until midnight)."""
        steps = int(steps)
        log = self.data["steps_log"]
        if steps < 0 or log.get(day, -1) >= steps:
            return False
        log[day] = steps
        self._changed()
        return True

    def steps_today(self) -> int | None:
        return self.data["steps_log"].get(self.today())

    def steps_average(self, days: int = STEPS_AVG_DAYS) -> tuple[float | None, int]:
        """Average over recent *complete* days (today is still in progress)."""
        today = self._now().date()
        start = (today - timedelta(days=days)).isoformat()
        vals = [v for d, v in self.data["steps_log"].items() if start <= d < today.isoformat()]
        return (round(sum(vals) / len(vals)) if vals else None), len(vals)

    def steps_for_energy(self) -> tuple[int, str]:
        avg, n = self.steps_average()
        if avg is not None and n >= STEPS_MIN_DAYS:
            return int(avg), "tracked"
        return int(self.profile.get("daily_steps") or 0), "profile"

    def steps_summary(self) -> dict:
        avg, n = self.steps_average()
        used, source = self.steps_for_energy()
        return {"today": self.steps_today(), "avg": avg, "days": n, "used": used, "source": source,
                "sensor": self.profile.get("steps_sensor"),
                "history": dict(sorted(self.data["steps_log"].items())[-30:])}

    # ------------------------------------------------------------------- food
    def add_food(self, entry: dict) -> dict:
        name = (entry.get("name") or "").strip()
        if not name:
            raise ValidationError("Food name is required")
        meal = entry.get("meal") or "snack"
        if meal not in MEALS:
            raise ValidationError(f"Meal must be one of {MEALS}")
        item = {
            "id": new_id(),
            "date": entry.get("date") or self.today(),
            "meal": meal,
            "logged_at": self._now().isoformat(),
            "food_id": entry.get("food_id"),
            "name": name,
            "brand": entry.get("brand"),
            "amount": float(entry.get("amount") or 1),
            "unit": entry.get("unit") or "serving",
            "grams": entry.get("grams"),
        }
        for k in ("kcal", "protein", "fat", "carbs", "fiber"):
            item[k] = round(float(entry.get(k) or 0), 1)
        self.data["food_log"].append(item)
        if entry.get("remember", True):
            self._remember_food(entry)
        self._changed()
        return item

    def _remember_food(self, entry: dict) -> None:
        """Keep a snapshot of recently used foods (per-100g basis) for quick add."""
        if not entry.get("per_100g") and not entry.get("per_serving"):
            return
        key = entry.get("food_id") or entry["name"].lower()
        recent = [r for r in self.data["recent_foods"] if r["key"] != key]
        recent.insert(0, {
            "key": key,
            "food_id": entry.get("food_id"),
            "name": entry["name"],
            "brand": entry.get("brand"),
            "serving_qty": entry.get("serving_qty"),
            "serving_unit": entry.get("serving_unit"),
            "serving_g": entry.get("serving_g"),
            "per_100g": entry.get("per_100g"),
            "per_serving": entry.get("per_serving"),
            "last_amount": entry.get("amount"),
            "last_unit": entry.get("unit"),
        })
        self.data["recent_foods"] = recent[:RECENT_FOODS_MAX]

    def update_food(self, entry_id: str, changes: dict) -> dict:
        for item in self.data["food_log"]:
            if item["id"] == entry_id:
                for k in ("meal", "amount", "unit", "grams", "kcal", "protein", "fat",
                          "carbs", "fiber", "name", "date"):
                    if k in changes:
                        item[k] = changes[k]
                self._changed()
                return item
        raise ValidationError("Food entry not found")

    def delete_food(self, entry_id: str) -> None:
        before = len(self.data["food_log"])
        self.data["food_log"] = [i for i in self.data["food_log"] if i["id"] != entry_id]
        if len(self.data["food_log"]) == before:
            raise ValidationError("Food entry not found")
        self._changed()

    def food_day(self, day: str | None = None) -> dict:
        day = day or self.today()
        entries = [i for i in self.data["food_log"] if i["date"] == day]
        totals = {k: round(sum(i.get(k) or 0 for i in entries), 1)
                  for k in ("kcal", "protein", "fat", "carbs", "fiber")}
        energy = self.energy()
        target = energy["target"] if energy else None
        return {
            "date": day,
            "entries": sorted(entries, key=lambda i: i["logged_at"]),
            "totals": totals,
            "target": target,
            "remaining": round(target - totals["kcal"], 1) if target else None,
            "macro_targets": {
                "protein": energy["protein_g"], "fat": energy["fat_g"], "carbs": energy["carbs_g"],
            } if energy else None,
        }

    def food_stats(self) -> dict:
        """Averages over logged days. Today is excluded because it isn't finished yet."""
        today = self._now().date()
        by_day: dict[str, dict] = {}
        for i in self.data["food_log"]:
            d = by_day.setdefault(i["date"], {"kcal": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0})
            for k in d:
                d[k] += i.get(k) or 0
        past = {d: v for d, v in by_day.items() if d < today.isoformat()}
        energy = self.energy()
        target = energy["target"] if energy else None

        def window(days: int | None) -> dict:
            if days is None:
                picked = past
            else:
                start = (today - timedelta(days=days)).isoformat()
                picked = {d: v for d, v in past.items() if d >= start}
            n = len(picked)
            avg = {k: round(sum(v[k] for v in picked.values()) / n, 1) if n else None
                   for k in ("kcal", "protein", "carbs", "fat")}
            on_target = None
            if n and target:
                on_target = sum(1 for v in picked.values() if abs(v["kcal"] - target) <= target * 0.1)
            return {"days_logged": n, "avg": avg, "on_target_days": on_target}

        streak, d = 0, today if today.isoformat() in by_day else today - timedelta(days=1)
        while d.isoformat() in by_day:
            streak += 1
            d -= timedelta(days=1)

        series = []
        for back in range(13, -1, -1):
            day = (today - timedelta(days=back)).isoformat()
            series.append({"date": day, "kcal": round(by_day.get(day, {}).get("kcal", 0))})

        first = min(by_day) if by_day else None
        return {
            "d7": window(7), "d30": window(30), "all": window(None),
            "first_day": first, "streak": streak, "series": series, "target": target,
        }

    def add_custom_food(self, food: dict) -> dict:
        if not food.get("name"):
            raise ValidationError("Food name is required")
        item = {
            "id": f"custom_{new_id()}",
            "name": food["name"],
            "brand": food.get("brand"),
            "serving_qty": food.get("serving_qty") or 1,
            "serving_unit": food.get("serving_unit") or "serving",
            "serving_g": food.get("serving_g"),
            "per_serving": {k: float(food.get(k) or 0) for k in ("kcal", "protein", "fat", "carbs", "fiber")},
            "custom": True,
        }
        self.data["custom_foods"].append(item)
        self._changed()
        return item

    def delete_custom_food(self, food_id: str) -> None:
        self.data["custom_foods"] = [f for f in self.data["custom_foods"] if f["id"] != food_id]
        self._changed()

    def search_custom_foods(self, query: str) -> list[dict]:
        q = query.lower().strip()
        return [f for f in self.data["custom_foods"] if q in f["name"].lower()]

    # ----------------------------------------------------------------- vitals
    def add_vital(self, vtype: str, values: dict, recorded_at: str | None = None,
                  note: str | None = None) -> dict:
        spec = VITAL_TYPES.get(vtype)
        if not spec:
            raise ValidationError(f"Unknown stat type: {vtype}")
        item: dict[str, Any] = {
            "id": new_id(),
            "type": vtype,
            "recorded_at": recorded_at or self._now().isoformat(),
            "unit": spec["unit"],
            "note": note,
        }
        for f in spec["fields"]:
            if values.get(f) in (None, ""):
                raise ValidationError(f"{f} is required for {vtype}")
            item[f] = round(float(values[f]), 2)
        self.data["vitals"].append(item)
        self._changed()
        return item

    def delete_vital(self, vital_id: str) -> None:
        self.data["vitals"] = [v for v in self.data["vitals"] if v["id"] != vital_id]
        self._changed()

    def vitals(self, vtype: str | None = None, limit: int = 200) -> list[dict]:
        items = [v for v in self.data["vitals"] if vtype is None or v["type"] == vtype]
        items.sort(key=lambda v: v["recorded_at"], reverse=True)
        return items[:limit]

    def latest_vital(self, vtype: str) -> dict | None:
        items = self.vitals(vtype, limit=1)
        return items[0] if items else None

    def latest_vitals(self) -> dict:
        return {t: self.latest_vital(t) for t in VITAL_TYPES}

    # -------------------------------------------------------------- exercises
    def exercises(self) -> list[dict]:
        return list(self._library()) + self.data["custom_exercises"]

    def exercise(self, exercise_id: str) -> dict | None:
        return next((e for e in self.exercises() if e["id"] == exercise_id), None)

    def add_exercise(self, ex: dict) -> dict:
        name = (ex.get("name") or "").strip()
        if not name:
            raise ValidationError("Exercise name is required")
        item = {
            "id": f"custom_{new_id()}",
            "name": name,
            "muscle": ex.get("muscle") or "Other",
            "equipment": ex.get("equipment") or "Other",
            "kind": ex.get("kind") or "weight_reps",
            "instructions": [],
            "demo_url": None,
            "custom": True,
        }
        self.data["custom_exercises"].append(item)
        self._changed()
        return item

    # --------------------------------------------------------------- workouts
    @staticmethod
    def _blank_set(prev: dict | None = None, set_type: str = "working") -> dict:
        return {
            "id": new_id(),
            "type": set_type,
            "weight": prev.get("weight") if prev else None,
            "reps": prev.get("reps") if prev else None,
            "rpe": None,
            "duration_s": prev.get("duration_s") if prev else None,
            "distance_m": prev.get("distance_m") if prev else None,
            "completed": False,
        }

    def start_workout(self, template_id: str | None = None, name: str | None = None) -> dict:
        if self.data["active_workout"]:
            raise ValidationError("A workout is already in progress")
        exercises = []
        if template_id:
            tpl = next((t for t in self.data["templates"] if t["id"] == template_id), None)
            if not tpl:
                raise ValidationError("Template not found")
            name = name or tpl["name"]
            for tex in tpl["exercises"]:
                exercises.append({
                    "id": new_id(),
                    "exercise_id": tex["exercise_id"],
                    "notes": "",
                    "rest_s": tex.get("rest_s", self.rest_for(tex["exercise_id"])),
                    "superset": tex.get("superset"),
                    "sets": [self._blank_set(s, s.get("type", "working")) for s in tex["sets"]],
                })
        workout = {
            "id": new_id(),
            "name": name or self._default_workout_name(),
            "template_id": template_id,
            "started_at": self._now().isoformat(),
            "ended_at": None,
            "notes": "",
            "exercises": exercises,
            "rest": None,
        }
        self.data["active_workout"] = workout
        self._changed()
        self._emit("workout_started", workout)
        return workout

    def rest_for(self, exercise_id: str) -> int:
        """Rest time last used for this exercise, else the profile default."""
        for w in sorted(self.data["workouts"], key=lambda w: w["started_at"], reverse=True):
            for ex in w["exercises"]:
                if ex["exercise_id"] == exercise_id and ex.get("rest_s") is not None:
                    return int(ex["rest_s"])
        return int(self.profile.get("rest_default_s") or DEFAULT_REST_S)

    def set_rest(self, ends_at: float | None, total: int | None = None,
                 exercise_id: str | None = None, next_label: str | None = None) -> dict | None:
        """Start, adjust (call again) or clear (ends_at=None) the rest timer."""
        active = self.data["active_workout"]
        if not active:
            raise ValidationError("No workout in progress")
        active["rest"] = None if ends_at is None else {
            "ends_at": float(ends_at), "total": int(total or 0), "exercise_id": exercise_id,
            "next": next_label,
        }
        self._changed()
        self._emit("rest", {"workout": active, "rest": active["rest"]})
        return active["rest"]

    def _default_workout_name(self) -> str:
        h = self._now().hour
        part = "Morning" if h < 12 else "Afternoon" if h < 17 else "Evening"
        return f"{part} Workout"

    def update_active_workout(self, workout: dict) -> dict:
        active = self.data["active_workout"]
        if not active or active["id"] != workout.get("id"):
            raise ValidationError("No matching workout in progress")
        self._validate_workout(workout)
        # Never let the client move the start time silently; rest is managed by set_rest
        workout["started_at"] = workout.get("started_at") or active["started_at"]
        workout["rest"] = active.get("rest")
        self.data["active_workout"] = workout
        self._changed()
        return workout

    def _validate_workout(self, workout: dict) -> None:
        for ex in workout.get("exercises", []):
            if not ex.get("exercise_id"):
                raise ValidationError("Exercise id missing")
            for s in ex.get("sets", []):
                if s.get("type", "working") not in SET_TYPES:
                    raise ValidationError(f"Set type must be one of {SET_TYPES}")
                rpe = s.get("rpe")
                if rpe not in (None, "") and not (1 <= float(rpe) <= 10):
                    raise ValidationError("RPE must be between 1 and 10")

    def finish_workout(self) -> dict:
        active = self.data["active_workout"]
        if not active:
            raise ValidationError("No workout in progress")
        workout = copy.deepcopy(active)
        workout.pop("rest", None)
        workout["ended_at"] = self._now().isoformat()
        # Drop incomplete sets and exercises left empty
        for ex in workout["exercises"]:
            ex["sets"] = [s for s in ex["sets"] if s.get("completed")]
        workout["exercises"] = [e for e in workout["exercises"] if e["sets"]]
        workout["prs"] = self._detect_prs(workout)
        workout["summary"] = self.workout_summary(workout)
        self.data["workouts"].append(workout)
        self.data["active_workout"] = None
        self._changed()
        self._emit("workout_ended", workout)
        return workout

    def discard_workout(self) -> None:
        self.data["active_workout"] = None
        self._changed()
        self._emit("workout_ended", None)

    def mark_saved_to_health(self, workout_id: str | None = None) -> dict | None:
        """Flag a workout as logged in Apple Health (default: newest one not yet flagged)."""
        items = sorted(self.data["workouts"], key=lambda w: w["started_at"], reverse=True)
        w = next((x for x in items if x["id"] == workout_id), None) if workout_id else \
            next((x for x in items if not x.get("apple_health_saved")), None)
        if w:
            w["apple_health_saved"] = True
            self._changed()
        return w

    def delete_workout(self, workout_id: str) -> None:
        self.data["workouts"] = [w for w in self.data["workouts"] if w["id"] != workout_id]
        self._changed()

    def workout(self, workout_id: str) -> dict | None:
        return next((w for w in self.data["workouts"] if w["id"] == workout_id), None)

    def workout_list(self, offset: int = 0, limit: int = 30) -> dict:
        items = sorted(self.data["workouts"], key=lambda w: w["started_at"], reverse=True)
        return {"total": len(items), "items": items[offset: offset + limit]}

    @staticmethod
    def workout_summary(workout: dict) -> dict:
        volume = 0.0
        sets = 0
        for ex in workout["exercises"]:
            for s in ex["sets"]:
                if s.get("type") in COUNTED_SET_TYPES:
                    sets += 1
                    volume += (s.get("weight") or 0) * (s.get("reps") or 0)
        duration = None
        if workout.get("ended_at"):
            duration = int((datetime.fromisoformat(workout["ended_at"])
                            - datetime.fromisoformat(workout["started_at"])).total_seconds())
        return {"volume_kg": round(volume, 1), "sets": sets,
                "exercises": len(workout["exercises"]), "duration_s": duration}

    def workouts_since(self, days: int) -> int:
        cutoff = (self._now() - timedelta(days=days)).isoformat()
        return sum(1 for w in self.data["workouts"] if w["started_at"] >= cutoff)

    # ---------------------------------------------------------------- records
    def _best_by_exercise(self, workouts: list[dict]) -> dict[str, dict]:
        best: dict[str, dict] = {}
        for w in workouts:
            for ex in w["exercises"]:
                b = best.setdefault(ex["exercise_id"], {
                    "max_weight": None, "max_e1rm": None, "max_reps": None,
                    "max_volume_set": None, "max_duration_s": None, "max_distance_m": None,
                })
                for s in ex["sets"]:
                    if s.get("type") not in COUNTED_SET_TYPES:
                        continue
                    wt, reps = s.get("weight") or 0, s.get("reps") or 0
                    ctx = {"workout_id": w["id"], "date": w["started_at"], "weight": wt, "reps": reps}

                    def bump(key: str, value: float) -> None:
                        if value and (b[key] is None or value > b[key]["value"]):
                            b[key] = {**ctx, "value": round(value, 2)}

                    bump("max_weight", wt)
                    bump("max_e1rm", estimated_1rm(wt, reps))
                    bump("max_reps", reps)
                    bump("max_volume_set", wt * reps)
                    bump("max_duration_s", s.get("duration_s") or 0)
                    bump("max_distance_m", s.get("distance_m") or 0)
        return best

    def records(self) -> list[dict]:
        out = []
        for ex_id, rec in self._best_by_exercise(self.data["workouts"]).items():
            ex = self.exercise(ex_id) or {"id": ex_id, "name": ex_id}
            out.append({"exercise": ex, **rec})
        out.sort(key=lambda r: r["exercise"]["name"])
        return out

    def _detect_prs(self, workout: dict) -> list[dict]:
        before = self._best_by_exercise(self.data["workouts"])
        now = self._best_by_exercise([workout])
        prs = []
        for ex_id, rec in now.items():
            prev = before.get(ex_id)
            if not prev:
                continue  # first time doing an exercise isn't a PR
            for key in ("max_weight", "max_e1rm", "max_reps", "max_volume_set"):
                if rec[key] and (prev[key] is None or rec[key]["value"] > prev[key]["value"]):
                    prs.append({"exercise_id": ex_id, "kind": key, "value": rec[key]["value"]})
        return prs

    def last_info(self, exercise_id: str) -> dict:
        return {"sets": self.last_performance(exercise_id), "rest_s": self.rest_for(exercise_id)}

    def last_performance(self, exercise_id: str) -> list[dict]:
        """Sets from the most recent finished workout containing this exercise."""
        for w in sorted(self.data["workouts"], key=lambda w: w["started_at"], reverse=True):
            for ex in w["exercises"]:
                if ex["exercise_id"] == exercise_id:
                    return ex["sets"]
        return []

    def exercise_history(self, exercise_id: str, limit: int = 50) -> list[dict]:
        out = []
        for w in sorted(self.data["workouts"], key=lambda w: w["started_at"], reverse=True):
            for ex in w["exercises"]:
                if ex["exercise_id"] == exercise_id:
                    counted = [s for s in ex["sets"] if s.get("type") in COUNTED_SET_TYPES]
                    out.append({
                        "workout_id": w["id"], "date": w["started_at"], "sets": ex["sets"],
                        "best_e1rm": round(max((estimated_1rm(s.get("weight") or 0, s.get("reps") or 0)
                                                for s in counted), default=0), 1),
                    })
            if len(out) >= limit:
                break
        return out

    # -------------------------------------------------------------- templates
    def save_template(self, tpl: dict) -> dict:
        name = (tpl.get("name") or "").strip()
        if not name:
            raise ValidationError("Template name is required")
        item = {
            "id": tpl.get("id") or new_id(),
            "name": name,
            "notes": tpl.get("notes") or "",
            "exercises": [
                {"exercise_id": e["exercise_id"],
                 "rest_s": e.get("rest_s"),
                 "superset": e.get("superset"),
                 "sets": [{"type": s.get("type", "working"), "reps": s.get("reps"),
                           "weight": s.get("weight")} for s in e.get("sets", [])]}
                for e in tpl.get("exercises", [])
            ],
        }
        self.data["templates"] = [t for t in self.data["templates"] if t["id"] != item["id"]]
        self.data["templates"].append(item)
        self._changed()
        return item

    def template_from_workout(self, workout_id: str, name: str | None = None) -> dict:
        w = self.workout(workout_id)
        if not w:
            raise ValidationError("Workout not found")
        return self.save_template({"name": name or w["name"], "exercises": w["exercises"]})

    def delete_template(self, template_id: str) -> None:
        self.data["templates"] = [t for t in self.data["templates"] if t["id"] != template_id]
        self._changed()
