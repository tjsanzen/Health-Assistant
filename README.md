# Health Assistant

Calorie tracking, workout logging and health stats for Home Assistant, in an app-style **Health** sidebar panel that works on desktop and on the iOS companion app.

## What's in v0.1

**Health panel** (sidebar, apple icon). On phones the four views sit in a bottom tab bar; on desktop they move into the header.

| Tab | What it does |
| --- | --- |
| **History** | Past workouts grouped by month (duration, volume, sets, PRs), workout detail, save a workout as a template, delete. A **Records** view shows per-exercise bests (heaviest, estimated 1RM, best set) and an e1RM trend. |
| **Start Workout** | Start empty or from a template. Log sets with weight, reps, type (working / warm-up / failure / drop: tap the set number to cycle) and RPE. "Previous" shows last time's numbers; tap it to copy them, or tick an empty set to accept them. A 90 s rest timer starts automatically. In-progress workouts are saved to HA, so you can start on your phone and finish on your laptop. |
| **Nutrition** | Daily calorie ring and macro bars, meals (breakfast / lunch / dinner / snack), food search across ~327k OpenNutrition foods, recent foods, quick add, custom foods, edit and delete, previous days. |
| **Profile** | Weight progress toward your target with a trend chart, health-stat tiles (weight, body fat, BP, heart rate, HRV, SpO₂, respiration, height) with history, energy breakdown (BMR, maintenance, target, macros), and profile editing. |

**Setup flow** asks for name, linked HA user, units, current and target weight, height, body fat % (optional), age, sex, average daily steps, weekly 1-hour lifting days and goal pace. It then shows your numbers before you confirm.

**Sensors** (per profile): calories today/remaining, calorie target, maintenance, BMR, protein/carbs/fat today, weight, body fat, heart rate, blood pressure, last workout, workouts this week.

## How the numbers are calculated

- **BMR**: Katch-McArdle (`370 + 21.6 × lean mass kg`) when body fat is known, otherwise Mifflin-St Jeor.
- **Maintenance (TDEE)**: `BMR × 1.2` (sedentary baseline, includes digestion and ~3,000 steps)
  - steps above 3,000 × 0.0005 kcal × body weight (kg) (≈0.04 kcal/step at 80 kg)
  - lifting days × 4 net METs × body weight (kg) ÷ 7
  
  The implied activity multiplier and label (Sedentary → Extremely active) are shown in the panel.
- **Target**: maintenance ± (goal pace × 7,700 kcal/kg ÷ 7). The direction comes from target vs current weight; within 0.5 kg counts as maintain. The target never drops below 1,500 kcal (male) or 1,200 kcal (female).
- **Macros**: protein 2.2 g/kg lean mass (or 1.6 g/kg body weight without body fat), fat 25% of calories, carbs the rest.
- Current weight, body fat and height always come from your **latest logged health stat**, so the targets update as you log.
- Records ignore warm-up sets. Estimated 1RM uses Epley: `w × (1 + reps/30)`.

## Install

1. Copy `custom_components/health_assistant` into your HA `config/custom_components/` (or add this repo to HACS as a custom repository).
2. **Food database**: the panel searches a compact SQLite file built from the OpenNutrition TSV:
   ```bash
   python3 scripts/build_food_db.py opennutrition_foods.tsv custom_components/health_assistant/data/foods.db
   ```
   (about 20 s, produces ~74 MB). HA looks for it first at `config/health_assistant/foods.db`, which survives HACS updates, then at `custom_components/health_assistant/data/foods.db`.
3. Restart HA → Settings → Devices & services → Add integration → **Health Assistant**. Add one profile per person and link each to their HA user, and the panel opens the right profile automatically. A profile switcher appears when there's more than one.

## Developing

```bash
# Panel preview in a normal browser, no HA needed (uses the real model + food db)
python3 dev/preview_server.py --reset     # http://localhost:8765  (#dark for dark theme)

# Tests
python3 tests/test_model.py                          # pure model/calcs
pip install pytest-homeassistant-custom-component home-assistant-frontend
pytest tests                                         # + full HA integration test
```

The panel is a single dependency-free web component (`frontend/health-panel.js`); no build step. It's cache-busted by file mtime, so a HA restart picks up changes.

### Data model

Everything for a profile lives in `.storage/health_assistant.<entry_id>` (included in HA backups), stored in metric units:

- `profile`: name, linked user, units, sex, age, height, target weight, steps, lifting days, goal pace
- `food_log[]`: date, meal, name, brand, amount + unit (serving / g / oz / quick), grams, kcal, protein, fat, carbs, fiber
- `custom_foods[]`, `recent_foods[]`
- `vitals[]`: type (weight, height, body_fat, blood_pressure, heart_rate, respiration, hrv, spo2), value(s), unit, recorded_at, note
- `workouts[]`: name, started/ended, notes, exercises[] → sets[] (type, weight, reps, rpe, duration_s, distance_m), PRs, summary
- `templates[]`, `custom_exercises[]`, `active_workout`

## Data source

Food data comes from [OpenNutrition](https://www.opennutrition.app). Check their license terms for attribution requirements before you redistribute the built `foods.db`.
