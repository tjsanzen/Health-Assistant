#!/usr/bin/env python3
"""Run the Health panel in a normal browser without Home Assistant.

    python3 dev/preview_server.py            # then open http://localhost:8765
    python3 dev/preview_server.py --reset    # start over with a fresh demo profile

Uses the real model.py / food_db.py, keeps data in dev/dev_data.json, and fakes
`hass.callWS` over a tiny HTTP endpoint. Handy for UI work on desktop or on a
phone on the same network (http://<your-computer-ip>:8765).
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import types
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PKG = os.path.join(ROOT, "custom_components", "health_assistant")
DATA_FILE = os.path.join(HERE, "dev_data.json")

pkg = types.ModuleType("hp")
pkg.__path__ = [PKG]
sys.modules["hp"] = pkg
for name in ("const", "calculations", "library", "model", "food_db", "strong_import"):
    spec = importlib.util.spec_from_file_location(f"hp.{name}", os.path.join(PKG, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[f"hp.{name}"] = mod
    spec.loader.exec_module(mod)
model_mod = sys.modules["hp.model"]
FoodDatabase = sys.modules["hp.food_db"].FoodDatabase
strong = sys.modules["hp.strong_import"]
library = sys.modules["hp.library"].ExerciseLibrary(demo_url="/custom_components/health_assistant/data/demos")

db = FoodDatabase([os.path.join(PKG, "data", "foods.db")])


def seed() -> dict:
    """A demo profile with a few weeks of history so every screen has content."""
    now = datetime.now()
    data = model_mod.empty_data({
        "name": "Demo", "user_id": None, "units": "imperial", "sex": "male", "age": 30,
        "age_recorded": now.date().isoformat(), "height_cm": 178, "target_weight_kg": 77,
        "daily_steps": 8000, "lifting_days": 4, "goal_rate_kg_week": 0.23,
    })
    clock = {"t": now - timedelta(days=42)}
    m = model_mod.HealthModel(data, lambda: None, lambda: clock["t"], library=library.all)
    for i in range(0, 43, 3):
        clock["t"] = now - timedelta(days=42 - i, hours=-7)
        m.add_vital("weight", {"value": 84 - i * 0.07 + (0.3 if i % 2 else -0.2)})
    m.add_vital("height", {"value": 178})
    m.add_vital("heart_rate", {"value": 58})
    m.add_vital("blood_pressure", {"systolic": 118, "diastolic": 76})
    plan = [("Push Day", [("bench_press", 70), ("incline_db_press", 26), ("lateral_raise", 9), ("tricep_pushdown", 30)]),
            ("Pull Day", [("deadlift", 120), ("lat_pulldown", 60), ("db_row", 30), ("db_curl", 14)]),
            ("Leg Day", [("squat", 95), ("romanian_deadlift", 80), ("leg_press", 160), ("calf_raise", 60)])]
    for wk in range(5):
        for j, (name, exs) in enumerate(plan):
            clock["t"] = now - timedelta(days=35 - wk * 7 - j * 2, hours=-6)
            w = m.start_workout(name=name)
            for ex_id, base in exs:
                load = base * (1 + wk * 0.025)
                sets = [{"id": "w", "type": "warmup", "weight": round(load * 0.5, 1), "reps": 10, "completed": True}]
                sets += [{"id": str(k), "type": "working", "weight": round(load, 1), "reps": 8 - (k == 2),
                          "rpe": 7.5 + k * 0.5, "completed": True} for k in range(3)]
                w["exercises"].append({"id": ex_id, "exercise_id": ex_id, "notes": "", "sets": sets})
            m.update_active_workout(w)
            clock["t"] += timedelta(minutes=55)
            m.finish_workout()
    for name, exs in plan:
        m.save_template({"name": name, "exercises": [{"exercise_id": e, "sets": [{"type": "working", "reps": 8}] * 3} for e, _ in exs]})
    import random
    random.seed(4)
    for back in range(1, 26):
        if back % 6 == 0:
            continue  # a few unlogged days
        clock["t"] = now - timedelta(days=back)
        kcal = random.randint(1850, 2650)
        m.add_food({"meal": "lunch", "name": "Meals (demo)", "amount": 1, "unit": "quick", "kcal": kcal,
                    "protein": kcal * 0.3 / 4, "carbs": kcal * 0.45 / 4, "fat": kcal * 0.25 / 9, "remember": False})
    clock["t"] = now
    for meal, q in (("breakfast", "greek yogurt"), ("breakfast", "banana"), ("lunch", "chicken breast"), ("lunch", "rice cooked")):
        res = db.search(q, 1)
        if res:
            f = res[0]
            g = f["serving_g"] or 100
            m.add_food({"meal": meal, "food_id": f["id"], "name": f["name"], "brand": f["brand"], "amount": 1,
                        "unit": "serving", "grams": g, **{k: (f["per_100g"][k] or 0) * g / 100 for k in ("kcal", "protein", "fat", "carbs", "fiber")},
                        "per_100g": f["per_100g"], "serving_qty": f["serving_qty"], "serving_unit": f["serving_unit"], "serving_g": f["serving_g"]})
    return data


if "--reset" in sys.argv or not os.path.exists(DATA_FILE):
    DATA = seed()
else:
    with open(DATA_FILE) as fh:
        DATA = json.load(fh)


def save() -> None:
    with open(DATA_FILE, "w") as fh:
        json.dump(DATA, fh)


M = model_mod.HealthModel(DATA, save, lambda: datetime.now().astimezone(), library=library.all,
                          emit=lambda ev, payload: print(f"[live activity] {ev}"))
save()

C = {
    "profiles": lambda m: [{"id": "dev", "name": m.profile["name"], "mine": True}],
    "overview": lambda m, date=None: {"profile": m.profile, "age": m.current_age(), "energy": m.energy(),
                                      "today": m.food_day(date), "latest": m.latest_vitals(),
                                      "active_workout": m.data["active_workout"], "workouts_7d": m.workouts_since(7),
                                      "food_db": db.available,
                                      "chime_url": "/custom_components/health_assistant/data/chime.mp3",
                                      "steps": m.steps_summary()},
    "profile/update": lambda m, changes: (m.update_profile(changes), {"profile": m.profile, "energy": m.energy()})[1],
    "food/search": lambda m, query, limit=25: {"custom": m.search_custom_foods(query), "results": db.search(query, limit), "db_available": db.available},
    "food/barcode": lambda m, code: db.barcode(code),
    "food/recent": lambda m: {"recent": m.data["recent_foods"], "custom": m.data["custom_foods"]},
    "food/day": lambda m, date=None: m.food_day(date),
    "food/log": lambda m, entry: m.add_food(entry),
    "food/update": lambda m, entry_id, changes: m.update_food(entry_id, changes),
    "food/delete": lambda m, entry_id: m.delete_food(entry_id),
    "food/custom/create": lambda m, food: m.add_custom_food(food),
    "food/custom/delete": lambda m, food_id: m.delete_custom_food(food_id),
    "vitals/log": lambda m, vital_type, values, recorded_at=None, note=None: m.add_vital(vital_type, values, recorded_at, note),
    "vitals/list": lambda m, vital_type=None, limit=200: m.vitals(vital_type, limit),
    "vitals/delete": lambda m, vital_id: m.delete_vital(vital_id),
    "exercises/list": lambda m: m.exercises(),
    "exercises/create": lambda m, exercise: m.add_exercise(exercise),
    "exercises/history": lambda m, exercise_id: m.exercise_history(exercise_id),
    "exercises/last": lambda m, exercise_ids: {e: m.last_info(e) for e in exercise_ids},
    "rest/set": lambda m, ends_at, total=None, exercise_id=None, next=None: m.set_rest(ends_at, total, exercise_id, next),
    "notify/targets": lambda m: ["mobile_app_demo_iphone"],
    "steps/sensors": lambda m: [{"entity_id": "sensor.demo_iphone_steps", "name": "Demo iPhone Steps"}],
    "food/stats": lambda m: m.food_stats(),
    "workout/start": lambda m, template_id=None, name=None: m.start_workout(template_id, name),
    "workout/active": lambda m: m.data["active_workout"],
    "workout/update": lambda m, workout: m.update_active_workout(workout),
    "workout/finish": lambda m: m.finish_workout(),
    "workout/discard": lambda m: m.discard_workout(),
    "workout/list": lambda m, offset=0, limit=30: m.workout_list(offset, limit),
    "workout/get": lambda m, workout_id: m.workout(workout_id),
    "workout/delete": lambda m, workout_id: m.delete_workout(workout_id),
    "records": lambda m: m.records(),
    "workout/calendar": lambda m, year, month: m.workout_calendar(year, month),
    "import/strong": lambda m, csv, dry_run=True: m.import_workouts(
        strong.parse_strong_csv(csv, m.exercises(), units=m.profile.get("units", "imperial"),
                                tz=datetime.now().astimezone().tzinfo), dry_run=dry_run),
    "import/status": lambda m, source="strong": {"count": sum(1 for w in m.data["workouts"] if w.get("source") == source)},
    "import/undo": lambda m, source="strong": {"removed": m.delete_imported(source)},
    "templates/list": lambda m: sorted(m.data["templates"], key=lambda t: t["name"].lower()),
    "templates/save": lambda m, template: m.save_template(template),
    "templates/from_workout": lambda m, workout_id, name=None: m.template_from_workout(workout_id, name),
    "templates/delete": lambda m, template_id: m.delete_template(template_id),
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.path = "/dev/preview.html"
        elif self.path.startswith("/cards"):
            self.path = "/dev/cards.html"
        return super().do_GET()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        cmd = body.pop("type").split("/", 1)[1]
        body.pop("profile_id", None)
        try:
            result, status = {"result": C[cmd](M, **body)}, 200
        except (model_mod.ValidationError, ValueError, TypeError, KeyError) as err:
            result, status = {"error": str(err)}, 400
        out = json.dumps(result).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    print(f"Health panel preview: http://localhost:{port}  (food db: {'yes' if db.available else 'missing'})")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
