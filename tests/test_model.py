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
for mod in ("const", "calculations", "library", "model", "strong_import"):
    spec = importlib.util.spec_from_file_location(f"ha_pkg.{mod}", os.path.join(PKG_DIR, f"{mod}.py"))
    m = importlib.util.module_from_spec(spec)
    sys.modules[f"ha_pkg.{mod}"] = m
    spec.loader.exec_module(m)

calc = sys.modules["ha_pkg.calculations"]
model_mod = sys.modules["ha_pkg.model"]
library_mod = sys.modules["ha_pkg.library"]


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
    events = []
    m = model_mod.HealthModel(data, lambda: saves.append(1), clock,
                              library=library_mod.ExerciseLibrary().all,
                              emit=lambda ev, p: events.append(ev))
    m.events = events
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


def test_library_loads_json_and_demo(tmp_path=None):
    import json, tempfile
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "demos"))
    path = os.path.join(d, "exercises.json")
    with open(path, "w") as fh:
        json.dump({"lateral_raise_cable": {"name": "Lateral Raise (Cable)", "instructions": "One step"},
                   "broken": {"muscle": "x"}}, fh)
    lib = library_mod.ExerciseLibrary(path, os.path.join(d, "demos"), "/static/demos")
    items = lib.all()
    assert [e["id"] for e in items] == ["lateral_raise_cable"]
    assert items[0]["instructions"] == ["One step"] and items[0]["demo_url"] is None
    open(os.path.join(d, "demos", "lateral_raise_cable.gif"), "wb").close()
    os.utime(os.path.join(d, "demos"), (1, 2))  # make sure the folder change is noticed
    assert lib.all()[0]["demo_url"] == "/static/demos/lateral_raise_cable.gif"


def test_bundled_library():
    lib = library_mod.ExerciseLibrary()
    ids = {e["id"] for e in lib.all()}
    assert {"bench_press", "lateral_raise", "lateral_raise_cable"} <= ids


def test_manual_targets():
    m, _, _ = make()
    auto = m.energy()["target"]
    m.update_profile({"calorie_target_override": 2000})
    e = m.energy()
    assert e["target"] == 2000 and e["target_manual"] and e["target_auto"] == auto
    assert abs(e["protein_g"] * 4 + e["fat_g"] * 9 + e["carbs_g"] * 4 - 2000) < 5
    m.update_profile({"protein_override_g": 180})
    e = m.energy()
    assert e["protein_g"] == 180 and abs(e["protein_g"] * 4 + e["fat_g"] * 9 + e["carbs_g"] * 4 - 2000) < 5
    m.update_profile({"calorie_target_override": None, "protein_override_g": ""})
    assert not m.energy()["target_manual"] and m.energy()["target"] == auto


def test_food_stats():
    m, clock, _ = make()
    for back, kcal in ((1, 2000), (2, 2200), (3, 1800), (20, 3000)):
        clock.t = datetime(2026, 11, 9, 12) - timedelta(days=back)
        m.add_food({"name": "x", "kcal": kcal, "protein": 100})
    clock.t = datetime(2026, 11, 9, 12)
    m.add_food({"name": "today", "kcal": 500})
    st = m.food_stats()
    assert st["d7"]["days_logged"] == 3 and st["d7"]["avg"]["kcal"] == 2000
    assert st["d30"]["days_logged"] == 4 and st["all"]["avg"]["kcal"] == 2250
    assert st["streak"] == 4  # today + 3 days back
    assert len(st["series"]) == 14 and st["series"][-1]["kcal"] == 500


def test_rest_timer_and_events():
    m, clock, _ = make()
    m.update_profile({"rest_default_s": 90})
    w = m.start_workout()
    assert m.rest_for("squat") == 90
    w["exercises"].append({"id": "a", "exercise_id": "squat", "rest_s": 150, "superset": None, "sets": [
        {"id": "1", "type": "working", "weight": 100, "reps": 5, "completed": True}]})
    m.update_active_workout(w)
    m.set_rest(1000.0, 150, "squat")
    import copy
    w2 = copy.deepcopy(m.data["active_workout"])
    w2["rest"] = None  # the client can't clear rest through a workout update
    m.update_active_workout(w2)
    assert m.data["active_workout"]["rest"]["total"] == 150
    m.finish_workout()
    assert "rest" not in m.data["workouts"][-1]
    assert m.rest_for("squat") == 150 and m.last_info("squat")["rest_s"] == 150
    assert [e for e in m.events if e != "profile_updated"] == ["workout_started", "rest", "workout_ended"]


def test_protein_rule():
    e = calc.calculate_energy(weight_kg=90.72, height_cm=180, age=30, sex="male", body_fat_pct=None,
                              daily_steps=5000, lifting_days=3, target_weight_kg=85, goal_rate_kg_week=0.25)
    assert round(e.protein_g) == 120  # 200 lb × 0.6
    e = calc.calculate_energy(weight_kg=90.72, height_cm=180, age=30, sex="male", body_fat_pct=12,
                              daily_steps=5000, lifting_days=3, target_weight_kg=85, goal_rate_kg_week=0.25)
    assert round(e.protein_g) == 180  # lean: 200 lb × 0.9


def test_lifting_switches_to_logged_workouts_after_two_weeks():
    m, clock, _ = make()
    start = clock.t
    for day in (0, 3, 6, 9):
        clock.t = start + timedelta(days=day)
        w = m.start_workout()
        w["exercises"].append({"id": "a", "exercise_id": "squat", "sets": [{"id": "1", "type": "working", "weight": 100, "reps": 5, "completed": True}]})
        m.update_active_workout(w)
        clock.t += timedelta(minutes=90)
        m.finish_workout()
    clock.t = start + timedelta(days=10)
    assert not m.lifting_tracked()["active"]            # only 10 days in
    clock.t = start + timedelta(days=15)
    lt = m.lifting_tracked()
    assert lt["active"] and abs(lt["hours_per_week"] - 6 / (15 / 7)) < 0.05
    assert m.energy()["lifting"]["active"]
    cal = m.workout_calendar(start.year, start.month)
    assert cal and all(d["count"] >= 1 for d in cal)


def test_calorie_engine_hand_check():
    """One exercise, two timed sets, known rest: check against arithmetic by hand."""
    lib = {"squat": {"id": "squat", "kind": "weight_reps", "tier": 1}}
    w = {"started_at": "2026-11-10T18:00:00", "ended_at": "2026-11-10T18:05:00", "exercises": [{
        "exercise_id": "squat", "rest_s": 120, "sets": [
            {"type": "working", "reps": 10, "rpe": 8, "completed": True, "completed_at": "2026-11-10T18:01:00"},
            {"type": "working", "reps": 10, "rpe": 10, "completed": True, "completed_at": "2026-11-10T18:04:00"},
        ]}]}
    r = calc.workout_calories(w, lib, 100)
    set_s = 10 * calc.SECONDS_PER_REP + calc.SET_SETUP_S          # 50 s per set
    met1, met2 = 8.0 * 1.1, 8.0 * 1.2                            # tier 1, RPE 8 and 10
    rest_met = met1 * calc.REST_FRACTION
    gap = 180 - set_s                                            # within 120 s + 60 s grace
    lead, tail = 60 - set_s, 60
    segs = [(set_s, met1), (set_s, met2), (gap, rest_met), (lead, 2.0), (tail, 2.0)]
    exp = sum(t * m for t, m in segs) / 60 * 100 / 60
    exp_active = sum(t * (m - 1) for t, m in segs) / 60 * 100 / 60
    assert r["timed"] and r["kcal_total"] == round(exp) and r["kcal_active"] == round(exp_active)


def test_calorie_engine_long_break_decays_and_untimed_fallback():
    lib = {"curl": {"id": "curl", "kind": "weight_reps", "tier": 4}, "bench": {"id": "bench", "tier": 2}}
    base = {"started_at": "2026-11-10T18:00:00", "ended_at": "2026-11-10T19:00:00"}
    sets = lambda t1, t2: [{"type": "working", "reps": 10, "completed": True, "completed_at": t1},
                           {"type": "working", "reps": 10, "completed": True, "completed_at": t2}]
    short = calc.workout_calories({**base, "exercises": [{"exercise_id": "curl", "rest_s": 90, "sets": sets("2026-11-10T18:01:00", "2026-11-10T18:03:00")}]}, lib, 80)
    long_ = calc.workout_calories({**base, "exercises": [{"exercise_id": "curl", "rest_s": 90, "sets": sets("2026-11-10T18:01:00", "2026-11-10T18:15:00")}]}, lib, 80)
    assert long_["idle_min"] > 10 and long_["kcal_total"] > short["kcal_total"]
    # A 14-minute break mostly counts at the resting rate: far less than lifting through it.
    assert long_["kcal_active"] - short["kcal_active"] < 15
    # No tick times: falls back to the planned rest, and a heavier tier burns more.
    untimed = {"started_at": "x", "exercises": [{"exercise_id": "bench", "rest_s": 120, "sets": [{"type": "working", "reps": 8, "completed": True}] * 3}]}
    r = calc.workout_calories(untimed, lib, 80)
    assert not r["timed"] and r["rest_min"] == 4.0 and r["kcal_active"] > 0
    assert calc.rpe_multiplier(None, "warmup") == 0.85 and calc.rpe_multiplier(9.5) == 1.2


def test_finished_workout_stores_calories():
    m, clock, _ = make()
    w = m.start_workout()
    t0 = clock.t
    w["exercises"].append({"id": "a", "exercise_id": "squat", "rest_s": 120, "sets": [
        {"id": str(i), "type": "working", "weight": 100, "reps": 5, "rpe": 8, "completed": True,
         "completed_at": (t0 + timedelta(minutes=2 * i + 1)).isoformat()} for i in range(3)]})
    m.update_active_workout(w)
    clock.t += timedelta(minutes=8)
    done = m.finish_workout()
    sm = done["summary"]
    assert sm["timed"] and 0 < sm["kcal_active"] < sm["kcal_total"] and "squat" in sm["kcal_by_exercise"]


STRONG_SAMPLE = """Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
5/17/24 21:21,Push,46m,Bench Press (Barbell),W,95,10,0,0,,felt good,
5/17/24 21:21,Push,46m,Bench Press (Barbell),1,135,8,0,0,,,8
5/17/24 21:21,Push,46m,Bench Press (Barbell),Rest Timer,0,0,0,150,,,
5/17/24 21:21,Push,46m,Bench Press (Barbell),2,135,8,0,0,,,9
5/17/24 21:21,Push,46m,Hip Abductor (Machine),1,100,12,0,0,,,
5/17/24 21:21,Push,46m,Totally Made Up Move,1,20,10,0,0,,,
5/17/24 21:21,Push,46m,Walking,1,0,0,1,1200,,,
5/17/24 21:21,Push,46m,Chest Dip (Assisted),1,0,0,0,0,,,
5/20/24 18:00,Push,1h 2m,Bench Press (Barbell),1,145,8,0,0,,,
"""


def test_strong_import():
    si = sys.modules["ha_pkg.strong_import"]
    m, _, _ = make()
    parsed = si.parse_strong_csv(STRONG_SAMPLE, m.exercises(), units="imperial")
    assert len(parsed["workouts"]) == 2 and parsed["skipped_empty_sets"] == 1
    w = parsed["workouts"][0]
    bench = w["exercises"][0]
    assert bench["exercise_id"] == "bench_press" and bench["rest_s"] == 150
    assert [x["type"] for x in bench["sets"]] == ["warmup", "working", "working"]
    assert abs(bench["sets"][1]["weight"] - 135 / 2.2046226218) < 0.01 and bench["sets"][2]["rpe"] == 9
    assert w["exercises"][1]["exercise_id"] == "hip_abductor"
    assert w["exercises"][3]["exercise_id"] == "walking" and round(w["exercises"][3]["sets"][0]["distance_m"]) == 1609
    made_up = next(x for x in parsed["matches"] if x["strong"] == "Totally Made Up Move")
    assert made_up["exercise_id"] is None
    assert w["ended_at"].startswith("2024-05-17T22:07")

    dry = m.import_workouts(parsed, dry_run=True)
    assert dry["new_workouts"] == 2 and not m.data["workouts"]
    res = m.import_workouts(parsed, dry_run=False)
    assert res["new_workouts"] == 2 and len(m.data["workouts"]) == 2
    assert any(e["name"] == "Totally Made Up Move" for e in m.data["custom_exercises"])
    later = sorted(m.data["workouts"], key=lambda x: x["started_at"])[1]
    assert {p["kind"] for p in later["prs"]} >= {"max_weight"}          # 145 beat 135
    assert later["summary"]["kcal_active"] > 0 and not later["summary"]["timed"]
    again = m.import_workouts(si.parse_strong_csv(STRONG_SAMPLE, m.exercises()), dry_run=False)
    assert again["new_workouts"] == 0 and again["already_imported"] == 2
    assert m.delete_imported("strong") == 2 and not m.data["workouts"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
