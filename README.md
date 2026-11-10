# <img src="custom_components/health_assistant/brand/icon.png" alt="Logo" height="64" style="vertical-align: middle;"> Health Assistant

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2025.2+-41BDF5.svg)](https://www.home-assistant.io/)
[![English](https://img.shields.io/badge/lang-English-blue.svg)](#localization)
![AI Assisted: Claude](https://img.shields.io/badge/Claude-AI_Assisted-orange?logo=claude)

Workout, Nutrition, and Health Datapoint logging inside of Home Assistant. Track workouts, personal records, count calories, and meet your goals without compromising your data. 

> **IMPORTANT NOTICE**
> 
> ⚠️ **This integration is _<ins>NOT</ins>_ able to run offline.**
> Health Assistant requires a connection to your Home Assistant server to run. While most gyms have free wifi for members, please keep this in mind when using. This integration has been developed for web and the iOS companion app.

## Installation

<a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=tjsanzen&repository=health-assistant&category=Integration"><img src="https://my.home-assistant.io/badges/hacs_repository.svg" width="210" height="auto"></a>


## What's in v0.1

**Health panel** (sidebar, apple icon). On phones there's no top bar: a sticky bottom tab bar holds the Home Assistant menu, History, **Start Workout** (centre), Nutrition and Profile, and everything you tap opens as a bottom sheet you can swipe down to dismiss. On desktop the tabs move into a header bar and sheets open as centred dialogs.

| Tab | What it does |
| --- | --- |
| **History** | Past workouts grouped by month (duration, volume, sets, PRs), workout detail, save a workout as a template, delete. A **Records** view shows per-exercise bests (heaviest, estimated 1RM, best set) and an e1RM trend. |
| **Start Workout** | Start empty or from a template. Each exercise has a **•••** menu (add warm-up set, update rest timer, replace exercise, create superset, remove exercise) and a Set / Previous / lbs / Reps / ✓ table. Tap a set number to make it a working set, warm-up (yellow), drop set (purple) or failure (red). Previous shows what you did on the same set last time. Typing reps into one set fills the blank sets below it. Ticking a set asks for effort (6–10), then starts that exercise's rest timer (default 2 min). Rest only starts after the last exercise of a superset. In-progress workouts are saved to HA, so you can start on your phone and finish on your laptop. |
| **Nutrition** | Daily calorie ring and macro bars, meals (breakfast / lunch / dinner / snack), food search across ~327k OpenNutrition foods, recent foods, quick add, custom foods, edit and delete, previous days. Stats: average calories/protein/carbs/fat over 7 days, 30 days and all time, a 14-day chart against your target, logging streak and days on target. On desktop the stats sit in a right-hand column. |
| **Profile** | Weight progress toward your target with a trend chart, health-stat tiles (weight, body fat, BP, heart rate, HRV, SpO₂, respiration, height) with history, daily targets (calculated, or **set your own** calories and protein/carbs/fat), workout & rest-timer settings, and profile editing. |

**Setup flow** asks for name, linked HA user, units, current and target weight, height, body fat % (optional), age, sex, average daily steps, weekly 1-hour lifting days and goal pace. It then shows your numbers before you confirm.

**Sensors** (per profile): calories today/remaining, calorie target, maintenance, BMR, protein/carbs/fat today, weight, body fat, heart rate, blood pressure, last workout, workouts this week.

## Data folder

Everything the integration reads lives in `custom_components/health_assistant/data/`. It has to be inside the integration because HACS only installs that folder.

```
data/
├── opennutrition_foods.tsv     # source export, git-ignored (too big for GitHub)
├── foods.db                    # built from the TSV by scripts/build_food_db.py
├── chime.mp3                   # plays when a rest timer finishes
├── exercises/
│   └── exercises.json          # the exercise library
└── demos/
    └── lateral_raise_cable.gif # one GIF per exercise, named <id>.gif
```

`exercises.json` is keyed by exercise id:

```json
"lateral_raise_cable": {
  "name": "Lateral Raise (Cable)",
  "muscle": "Shoulders",
  "secondary": ["Traps"],
  "equipment": "Cable",
  "kind": "weight_reps",
  "instructions": ["Set a single cable pulley to its lowest position…", "…"],
  "tips": ["Lead with the elbow, not the hand."],
  "demo": "lateral_raise_cable.gif"
}
```

- `kind` is `weight_reps`, `bodyweight_reps`, `duration` or `distance` (it decides which columns the workout table shows).
- `instructions` can be a list of steps or one string; `secondary`, `tips` and `demo` are optional (`demo` defaults to `<id>.gif`).
- The GIF and instructions show when you tap an exercise's name. A missing GIF is simply hidden.
- Changes to the JSON or the demos folder are picked up without restarting Home Assistant. A JSON syntax error is logged and the previous library is kept.
- Don't rename an id after you've logged workouts with it; history refers to the id.

## Rest timer on iPhone (Dynamic Island)

Pick your phone during setup (it's pre-selected when the profile is linked to your Home Assistant user), or later under Profile → Settings → **Workout & rest timer**, which also has a **Send a test** button. Health Assistant then uses the Companion app's Live Activities. One activity runs for the whole workout:

- **While you rest:** a countdown, with "Next: Bench Press · Set 3 · 185 lb × 8" underneath.
- **When the rest ends:** an alert reading "Rest over · Next: …".
- **Between sets:** "Workout in progress".
- **When you finish or discard:** the activity ends.

The countdown ticks on the phone itself, so it keeps going with the panel closed. The Companion app only allows Material Design icons, so the activity uses `mdi:food-apple` in the logo's blue. The title is fixed when the activity starts, so it's always the workout name.

Requires Companion app 2026.9+, iOS 17.2+ and Home Assistant 2026.7+. Live Activities must also be allowed for Home Assistant in iPhone Settings, and the phone needs to reach HA (remote access when you're at the gym). Apple ends Live Activities after 8 hours and limits how many can be started in a row.

## Steps from your iPhone

When you pick your phone during setup, Health Assistant connects that phone's Companion app step sensor (`sensor.<phone>_steps`). You can change it under Profile → iPhone, rest timer & Apple Health.
- Health Assistant keeps one total per day.
- Once 3 days are recorded, your 14-day average replaces the steps you entered at setup in the maintenance-calorie estimate.
- The Steps tile on the Profile tab shows today's count, your average and the last 30 days.
- New sensors: `Steps today` and `Average steps`.

The sensor counts steps your iPhone detects, not your Apple Watch. If it's missing, turn it on in the Companion app under Settings → Companion app → Sensors.

## Saving workouts to Apple Health

Home Assistant can't write to Apple Health itself; only an app on the phone can. So when you finish a workout, Health Assistant sends a **"Save to Apple Health?"** notification to your phone. Tapping it runs an Apple Shortcut that logs the workout. Before iOS 27, iOS requires that tap before a notification may run a Shortcut. Afterwards the workout shows a ♥ Health badge in History.

What gets saved: a Traditional Strength Training workout with the right start time, duration and estimated calories. Calories use 5 METs × your weight × duration. Sets, reps and weights stay in Health Assistant, because the Health app's Log Workout action has nowhere to put them.

**Build the Shortcut once** (Shortcuts app → +), named exactly **Health Assistant Log Workout**, or change the name in Profile → iPhone, rest timer & Apple Health:

1. **Get Dictionary from** *Shortcut Input*.
2. **Get Value for** `start` **in** *Dictionary*, then **Get Dates from** *Dictionary Value*.
3. **Get Value for** `duration_min` **in** *Dictionary*.
4. **Get Value for** `kcal` **in** *Dictionary*.
5. **Log Workout**: type *Traditional Strength Training*, Date = the date from step 2, Duration = the value from step 3 in *minutes*, Calories = the value from step 4 in *kcal*.

The input also includes `title`, `end` and `workout_id` if you want them. The first run asks for Health permission. You can turn the notification off in Profile.

## How the numbers are calculated

- **BMR**: Katch-McArdle (`370 + 21.6 × lean mass kg`) when body fat is known, otherwise Mifflin-St Jeor.
- **Maintenance (TDEE)**: `BMR × 1.2` (sedentary baseline, includes digestion and ~3,000 steps)
  - steps above 3,000 × 0.0005 kcal × body weight (kg) (≈0.04 kcal/step at 80 kg)
  - lifting days × 4 net METs × body weight (kg) ÷ 7
  
  The implied activity multiplier and label (Sedentary → Extremely active) are shown in the panel.
- **Target**: maintenance ± (goal pace × 7,700 kcal/kg ÷ 7). The direction comes from target vs current weight; within 0.5 kg counts as maintain. The target never drops below 1,500 kcal (male) or 1,200 kcal (female).
- **Macros**: protein 2.2 g/kg lean mass (or 1.6 g/kg body weight without body fat), fat 25% of calories, carbs the rest.
- **Manual targets** (Profile → Daily targets → Edit) replace any of these. With only calories set, protein stays calculated, fat is 25% and carbs fill the rest; with fixed protein/fat, carbs fill whatever calories are left.
- **Nutrition averages** count only days you logged something, and leave out today because it isn't finished.
- Current weight, body fat and height always come from your **latest logged health stat**, so the targets update as you log.
- Records ignore warm-up sets. Estimated 1RM uses Epley: `w × (1 + reps/30)`.

## Install

1. Copy `custom_components/health_assistant` into your HA `config/custom_components/` (or add this repo to HACS as a custom repository).
2. **Food database**: put `opennutrition_foods.tsv` in `data/` and run `python3 scripts/build_food_db.py` (about 20 s, produces the ~74 MB `data/foods.db`). HA also looks at `config/health_assistant/foods.db`. If you copy the integration to HA by hand, leave the 282 MB TSV behind; HA only needs `foods.db`.
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

Chime noise: Music by <a href="https://pixabay.com/users/freepalestine_loverespect-55896143/?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=585518">love respect</a> from <a href="https://pixabay.com/music//?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=585518">Pixabay</a>

Icon design by myself in Canva.
