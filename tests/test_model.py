"""Unit tests for the pure-python parts (no Home Assistant needed).

Run from the repo root:  python3 -m pytest tests   (or: python3 tests/test_model.py)
"""
from __future__ import annotations

import importlib.util
import os
import sys
import types
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG_DIR = os.path.join(ROOT, "custom_components", "health_assistant")

# Load the modules without executing the HA-dependent package __init__.
pkg = types.ModuleType("ha_pkg")
pkg.__path__ = [PKG_DIR]
sys.modules["ha_pkg"] = pkg
for mod in ("const", "calculations", "exercises", "model"):
    spec = importlib.util.spec_from_file_location(f"ha_pkg.{mod}", os.path.join(PKG_DIR, f"{mod}.py"))
    m = importlib.util.module_from_spec(spec)
    sys.modules[f"ha_pkg.{mod}"] = m
    spec.loader.exec_module(m)

calc = sys.modules["ha_pkg.calculations"]
model_mod = sys.modules["ha_pkg.model"]


class Clock:
    def __init__(self):
        self.t = datetime(2026, 11, 9, 18, 0)

    def __call__(self):
        return self.t


def make():
    clock = Clock()
    data = model_mod.empty_data({
        "name": "Test", "units": "imperial", "sex": "male", "age": 30, "age_recorded": "2026-11-09",
        "height_cm": 180, "target_weight_kg": 75, "daily_steps": 8000, "lifting_days": 3,
        "goal_rate_kg_week": 0.25,
    })
    saves = []
    m = model_mod.HealthModel(data, lambda: saves.append(1), clock)
    m.add_vital("weight", {"value": 80})
    return m, clock, saves


def test_mifflin_and_katch():
    assert round(calc.mifflin_st_jeor(80, 180, 30, "male")) == 1780
    assert round(calc.mifflin_st_jeor(60, 165, 30, "female")) == 1320
    assert round(calc.katch_mcardle(80, 20)) == round(370 + 21.6 * 64)


def test_energy_uses_katch_when_body_fat_known():
    m, _, _ = make()
    assert m.energy()["formula"] == "Mifflin-St Jeor"
    m.add_vital("body_fat", {"value": 18})
    e = m.energy()
    assert e["formula"] == "Katch-McArdle"
    assert e["goal"] == "lose"
    assert e["target"] < e["maintenance"]
    assert 1.2 < e["activity_multiplier"] < 1.7


def test_target_floor():
    e = calc.calculate_energy(weight_kg=50, height_cm=150, age=60, sex="female", body_fat_pct=None,
                              daily_steps=0, lifting_days=0, target_weight_kg=40, goal_rate_kg_week=1)
    assert e.target == 1200 and e.target_floored


def test_food_day_totals():
    m, _, _ = make()
    m.add_food({"name": "Egg", "meal": "breakfast", "kcal": 72, "protein": 6.3, "fat": 4.8, "carbs": 0.4,
                "per_100g": {"kcal": 143}, "food_id": "x"})
    m.add_food({"name": "Rice", "meal": "lunch", "kcal": 200, "protein": 4, "fat": 0.4, "carbs": 44})
    day = m.food_day()
    assert day["totals"]["kcal"] == 272
    assert day["remaining"] == round(day["target"] - 272, 1)
    assert len(m.data["recent_foods"]) == 1  # only foods with nutrient basis are remembered


def test_workout_flow_records_and_prs():
    m, clock, _ = make()
    w = m.start_workout(name="Push")
    w["exercises"].append({"id": "a", "exercise_id": "bench_press", "notes": "", "sets": [
        {"id": "1", "type": "warmup", "weight": 40, "reps": 10, "completed": True},
        {"id": "2", "type": "working", "weight": 80, "reps": 5, "rpe": 8, "completed": True},
        {"id": "3", "type": "working", "weight": 80, "reps": 5, "completed": False},
    ]})
    m.update_active_workout(w)
    clock.t += timedelta(minutes=45)
    done = m.finish_workout()
    assert len(done["exercises"][0]["sets"]) == 2  # incomplete set dropped
    assert done["summary"]["sets"] == 1  # warm-up not counted
    assert done["summary"]["duration_s"] == 2700
    assert done["prs"] == []  # first time isn't a PR

    clock.t += timedelta(days=2)
    w2 = m.start_workout()
    w2["exercises"].append({"id": "b", "exercise_id": "bench_press", "sets": [
        {"id": "1", "type": "working", "weight": 85, "reps": 5, "completed": True}]})
    m.update_active_workout(w2)
    done2 = m.finish_workout()
    kinds = {p["kind"] for p in done2["prs"]}
    assert {"max_weight", "max_e1rm", "max_volume_set"} <= kinds

    rec = m.records()[0]
    assert rec["max_weight"]["value"] == 85
    assert m.last_performance("bench_press")[0]["weight"] == 85
    assert m.workouts_since(7) == 2


def test_template_roundtrip():
    m, _, _ = make()
    t = m.save_template({"name": "Legs", "exercises": [{"exercise_id": "squat", "sets": [
        {"type": "warmup", "reps": 10}, {"type": "working", "reps": 5, "weight": 100}]}]})
    w = m.start_workout(template_id=t["id"])
    assert w["name"] == "Legs"
    assert [s["type"] for s in w["exercises"][0]["sets"]] == ["warmup", "working"]
    assert w["exercises"][0]["sets"][1]["weight"] == 100


def test_validation():
    m, _, _ = make()
    for bad in (lambda: m.add_vital("blood_pressure", {"systolic": 120}),
                lambda: m.add_food({"name": ""}),
                lambda: m.add_food({"name": "x", "meal": "brunch"})):
        try:
            bad()
        except model_mod.ValidationError:
            continue
        raise AssertionError("expected ValidationError")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
