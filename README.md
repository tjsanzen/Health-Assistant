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

## Screenshots:

<img src="images/nutrition_desktop.png" alt="Nutrition Page" style="vertical-align: middle;">

<img src="images/live_activity_mobile.jpeg" alt="Nutrition Page"  style="vertical-align: left;"> <img src="images/workout_mobile.jpeg" alt="Nutrition Page"  style="vertical-align: right;">


## Installation

[![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=tjsanzen&repository=health-assistant&category=integration)

> **CREATOR RECOMMENDATION:**
> 
> By default, there are two different calculations for BMR built in, one with body fat percentage and one without. If you have access to a DEXA scan or similar method to find your exact body fat percentage, I highly recommend it. If you live in one of the cities below, I recommend BodySpec, it is really affordable. Please use my referral link if you're willing to! [BodySpec Sign-Up](https://www.bodyspec.com/r/wZJdna)
> <img src="images/cities.png" alt="BodySpec Cities" height="240" style="vertical-align: middle;"> 


## What's in Health Assistant v0.2.1

**Health Assistant** has four primary views, each serving a different function in your health journey. 

| Tab | What it does |
| --- | --- |
| **Learn** | Dietary recommendations from your last 7 days of food logs (once 5 days are logged): a nudge if fiber averages under 75% of your goal (14 g per 1,000 kcal), if calories average above maintenance, or if they average more than 750 kcal below it. It also flags the highest-calorie food you've logged 3+ times that week as one worth cutting back on. |
| **Workout** | Start an empty workout, with **Templates**, **Workouts** (past workouts, previously the History tab) and **Records** underneath. Past workouts grouped by month (duration, volume, sets, PRs), workout detail, save a workout as a template, delete. A **Records** view shows per-exercise bests (heaviest, estimated 1RM, best set) and an e1RM trend. Start from a template, or empty. Each exercise has a **•••** menu (add warm-up set, update rest timer, replace exercise, create superset, remove exercise) and a Set / Previous / lbs / Reps / ✓ table. Tap a set number to make it a working set, warm-up (yellow), drop set (purple) or failure (red). Previous shows what you did on the same set last time. Typing reps into one set fills the blank sets below it. Ticking a set asks for effort (6–10), then starts that exercise's rest timer (default 2 min). Rest only starts after the last exercise of a superset. In-progress workouts are saved to HA, so you can start on your phone and finish on your laptop. |
| **Nutrition** | Daily calorie ring and macro bars, meals (breakfast / lunch / dinner / snack), food search across ~327k OpenNutrition foods, recent foods, quick add, custom foods, edit and delete, previous days. Meals other than the current one collapse to a one-line summary once they have food; tap to expand. A blue **+** in a meal's header adds food when the meal is collapsed or has more than one item. An optional **barcode scanner** (turn it on in Profile) looks packages up in your custom foods first, then in OpenNutrition (about 313k foods have barcodes). New custom foods can store a barcode. Scanning uses the Home Assistant app's scanner on iPhone and Android, the camera in Chrome where the browser supports it, or typing the number. Stats: average calories/protein/carbs/fat over 7 days, 30 days and all time, a 14-day chart against your target, logging streak and days on target. On desktop the stats sit in a right-hand column. |
| **Profile** | Weight progress toward your target with a trend chart, health-stat tiles (weight, body fat, BP, heart rate, HRV, SpO₂, respiration, height) with history, daily targets (calculated, or **set your own** calories and protein/carbs/fat), workout & rest-timer settings, and profile editing. |

## Setup and Sensors

**Setup flow** asks for name, linked HA user, units, current and target weight, height, body fat % (optional), age, sex, average daily steps, weekly 1-hour lifting days and goal pace. It then shows your numbers before you confirm.

**Sensors** (per profile): calories today/remaining, calorie target, maintenance, BMR, protein/carbs/fat today, weight, body fat, heart rate, blood pressure, last workout, workouts this week.

## Dashboard cards

The integration loads three cards on every dashboard, so there's no resource to add. Find them under **Add card**, or add them in YAML:

```yaml
type: custom:health-assistant-lift-calendar   # this month, days you lifted circled in green (‹ › to change month)
---
type: custom:health-assistant-calorie-gauge   # today's calories as a speedometer against your target
---
type: custom:health-assistant-log-meal        # a button that opens a "Log a meal" dialog
name: Log meal                                # optional
icon: mdi:silverware-fork-knife               # optional
```

- **Profile:** every card takes an optional `profile: Anna` (a profile name or id). By default it uses the profile linked to whoever is signed in.
- **Title:** the calendar and gauge also take an optional `title:`.
- **Gauge colours:** blue up to 90% of your target, green within ±10%, red when you're over.
- **Log a meal dialog:** OpenNutrition search, recent foods and Quick add, logged to the meal you pick.

## Lessons (Learn tab)

Put Markdown files in `custom_components/health_assistant/data/lessons/`. Each one shows up as a card under **Lessons** in the Learn tab, and tapping the card opens the article.

- The title comes from the file name: `intro_to_nutrition.md` becomes **Intro to Nutrition**. A file that starts with its own `# Title` line uses that title in the article.
- Cards are sorted by file name. Start names with a number (`01_…`, `02_…`) to choose the order; the number isn't shown.
- The first paragraph is the card's description.
- Images in the same folder can be linked by file name: `![Plate](plate.png)`.
- Supported formatting: headings, bold, italic, code, lists, links, quotes, tables, images and dividers.
- Edits show up the next time you open the Learn tab, without a restart.

**Merge tags.** Lessons can include these tags, which are filled in with the reader's own numbers (examples are for a 176 lb profile lifting 3 days a week and losing 0.25 kg a week):

| Tag | Shows | Example |
| --- | --- | --- |
| `{weight}` | Current weight | 176.4 lb |
| `{mxcal}` | Maintenance calories | 2,473 kcal |
| `{deficit}` | Maintenance minus 500 kcal (about 1 lb of fat loss a week) | 1,973 kcal |
| `{carbs}` | Carb range for your training level | 265–441 g |
| `{protein}` | Your protein rule (0.6 or 0.9 g/lb) up to 1.0 g/lb | 106–176 g |
| `{fats}` | 20–35% of your calorie target | 49–85 g |
| `{fiber}` | 14 g per 1,000 kcal, from your calorie target to maintenance | 31–35 g |

Values include their unit, so write "about {mxcal} a day" rather than "{mxcal} calories". A tag shows "—" until there's enough data, for example before a weight is entered.

`01_intro_to_nutrition.md` is a full example. HACS replaces the integration folder when it updates, so keep a copy of your own lessons outside it.

## More than one person

Each person gets their own profile, linked to their Home Assistant user. Whoever opens **Health** in the sidebar sees their own data.

1. Make sure each person has their own Home Assistant user (Settings → People) and signs in with it on their phone.
2. Add the integration again for each person (Settings → Devices & services → Add integration → Health Assistant), and pick their user under **Linked user**.
3. To change who a profile belongs to later, an admin opens that profile and goes to **Profile → Home Assistant user**.

Non-admin users only ever see their own profile. Admins can switch between all profiles with the picker in the header. Each visit starts on your own profile, and a switch only lasts for that browser tab. A user with no linked profile is asked to have an admin set one up.

Dashboard cards show the viewer's own profile unless the card sets `profile:`. For non-admin users, a card set to someone else's profile shows an error.

## Importing your workout history (Strong)

Profile → Settings → **Import workout history** → pick a CSV exported from the Strong app (Settings → Export Data).

- **Preview first:** you see how many workouts and sets are new, the date range, and how every Strong exercise name was matched. Nothing is saved until you press **Import**.
- **Matching:** Strong's names are matched with a built-in table, for example "Bench Press (Barbell)" → Bench Press and "Seated Row (Cable)" → Seated Cable Row. Anything not in the table falls back to the closest library name. Anything still left becomes a custom exercise with its Strong name.
- **What's kept:**
  - warm-up, failure and drop sets (W / F / D);
  - effort (RPE) and set notes;
  - the rest timer, used as each exercise's rest;
  - cardio distance and time.

  Weights and distances are converted from your profile's units.
- **Calories and PRs:** each imported workout gets calories from the engine, fitted to the workout's real length, and PRs judged against everything before it.
- **Safe to re-run:** importing the same file again skips workouts already imported. **Remove all imported Strong workouts** undoes it without touching workouts you logged in Health Assistant.

## Rest-over sound in your headphones

When a rest timer ends, Health Assistant sends your phone a notification with a sound, so you hear it through your headphones even when the app is closed. Pick the sound in **Profile → Phone, rest timer & Apple Health → Sound when rest is over**:

- **Chime**: the same chime the panel plays. Import it into the Companion app once: tap *download the chime file* in that sheet, save `health_assistant_chime.wav` to Files or iCloud Drive, then in the Home Assistant app go to **Settings → Companion app → Notifications → Sounds → Import custom sound**, pick the file, and restart the iPhone. Until it's imported, iOS plays its default sound.
- **iPhone default sound**: the standard notification tone.
- **No sound**: the Live Activity update only vibrates the phone.

The notification is time-sensitive, so it gets through Focus modes. Each one is cleared when your next rest starts. The ring/silent switch still applies.

## Steps from your phone (iPhone or Android)

When you pick your phone during setup, Health Assistant connects that phone's best Companion app step sensor. You can change it under Profile → Phone, rest timer & Apple Health.

| Phone | Sensor | Counts |
| --- | --- | --- |
| Android | **Health Connect daily steps** (preferred) | Steps since midnight from Health Connect, so a watch or fitness app that syncs there is included. Needs Health Connect permission in the Companion app. |
| iPhone | **Apple Health steps** (preferred) | Steps since midnight from Apple Health, including an Apple Watch. |
| iPhone | Pedometer **Steps** | Steps the iPhone itself detects. |
| Android | Phone pedometer **Steps sensor** | Counts up from the last reboot. Health Assistant adds each increase to the day's total, so it starts counting from the first reading after you connect it. |

- Health Assistant keeps one total per day.
- Once 3 days are recorded, your 14-day average replaces the steps you entered at setup in the maintenance-calorie estimate.
- The Steps tile on the Profile tab shows today's count, your average and the last 30 days.
- Sensors: `Steps today` and `Average steps`.

If a sensor is missing, turn it on in the Companion app under Settings → Companion app → Sensors. On Android, the pedometer updates every 15 minutes by default; you can make it faster under Sensor Update Frequency.

## How numbers are calculated

- **BMR**: Katch-McArdle (`370 + 21.6 × lean mass kg`) when body fat is known, otherwise Mifflin-St Jeor. Again, I really recommend getting a [DEXA scan](https://www.bodyspec.com/r/wZJdna) as the Katch-McArdle is so much more accurate.
- **Maintenance (TDEE)**: `BMR × 1.2` (sedentary baseline, includes digestion and ~3,000 steps)
  - steps above 3,000 × 0.0005 kcal × body weight (kg) (≈0.04 kcal/step at 80 kg)
  - lifting days × 4 net METs × body weight (kg) ÷ 7
  
  The implied activity multiplier and label (Sedentary → Extremely active) are shown in the panel.
- **Target**: maintenance ± (goal pace × 7,700 kcal/kg ÷ 7). The direction comes from target vs current weight; within 0.5 kg counts as maintain. The target never drops below 1,500 kcal (male) or 1,200 kcal (female).
- **Lifting**: until you've been logging workouts for 2 weeks, lifting calories come from the "days per week" setup answer, at 1 hour each. After that, they're the active calories of your logged workouts (see below), averaged over the last 4 weeks. The setup answer is then locked, and the Profile shows your lifting kcal/day.
- **Protein**: 0.6 g per lb of body weight, or 0.9 g/lb if your latest body fat is under 15%.
- **Carbs**: set by how much you train, per lb of body weight. Training time is your logged workouts (4-week average) once 2 weeks are logged; until then it's your lifting days × 1 hour.

  | Exercise | Average training per day | Carbs per lb of body weight |
  | --- | --- | --- |
  | Light | Low intensity (under 45 min) | 1.5–2.5 g |
  | Moderate | Around 1 hour (45 min–1.5 h) | 2.5–3.5 g |
  | High | 1–3 hours, moderate–high intensity (1.5–3.5 h) | 3–5 g |
  | Very high | 4–5 hours, moderate–high intensity (3.5 h+) | 4–6 g |

- **Fat** fills the calories left after protein and carbs, kept between 20% and 35% of calories. It starts at 25%, then moves calories between fat and carbs to bring carbs inside the range. If your calorie target is too low to reach the bottom of the carb range with fat at 20%, carbs are set as high as the target allows, and the Profile tab says so.
- **Deficit warning**: if a target works out to more than 600 kcal/day below maintenance, Health Assistant shows a warning you can override. This applies in setup, under Daily targets and under Body & goal.
- **Manual targets** (Profile → Daily targets → Edit) replace any of these. With only calories set, protein stays calculated and fat and carbs are fitted as above. With fixed carbs or fat, the other one takes whatever calories are left.
- **Nutrition averages** count only days you logged something, and leave out today because it isn't finished.
- Current weight, body fat and height always come from your **latest logged health stat**, so the targets update as you log.
- Records ignore warm-up sets. Estimated 1RM uses Epley: `w × (1 + reps/30)`.


### Workout calories

Every finished workout gets a set-by-set estimate instead of "time × one MET value":

```
calories = Σ  MET × body weight (kg) × minutes / 60      over every set, rest and transition
```

- **Each set** is reps × 4 s plus 10 s to unrack and brace (or the logged time for timed and cardio exercises), at the exercise's MET × an effort multiplier.
- **Exercise MET**, from `tier` in `exercises.json`:

  | Tier | Type | Examples | MET during the set |
  | --- | --- | --- | --- |
  | 1 | Heavy full-body | squat, deadlift, RDL | 8.0 |
  | 2 | Compound | bench, overhead press, rows, pull-ups | 6.0 |
  | 3 | Machine or supported compound | leg press, lunges, cable row | 5.0 |
  | 4 | Isolation | curls, raises, extensions | 4.0 |

  Cardio and core entries set an exact `base_met` instead. Custom exercises ask for a type when you create them.
- **Effort**: RPE 6–7.5 ×1.0, 8–9 ×1.1, 9.5–10 ×1.2, under 6 ×0.85. A set without an RPE uses its type: warm-up ×0.85, drop ×1.1, failure ×1.2.
- **Rest** between sets of the same exercise burns 75% of the set's intensity (minimum 1.5 METs), because breathing and heart rate stay up after a hard set. That applies for your rest timer plus 60 seconds. Anything longer counts as idle at 1.2 METs, capped at 20 minutes per gap.
- **Moving to the next exercise**: the rest, then a 2-minute transition at 2.0 METs. Switching between superset partners gets 1 minute at 2.0.
- **Before the first set** up to 5 minutes counts at 2.0 METs. **After the last set** 2 minutes counts at 2.0, and anything beyond is idle, capped at 10 minutes in case Finish was pressed late.
- **Timing**: ticking a set records its time, so real rest lengths are used. Workouts logged before this update assume you rested exactly as planned.
- **Results**: workouts show **active** calories (above resting, like Apple Watch's Active Energy) and **total** calories. Maintenance calories and Apple Health use active, so nothing is counted twice.
- **Calibration**: the published MET tiers (7/5/4/3) with rest at a flat 1.5 METs gave whole-session averages around 2 METs. Measured values are higher. The 2024 Compendium of Physical Activities lists ~3.5 METs for moderate multi-exercise training, 5.0 for squats and deadlifts, and 6.0 for vigorous lifting. With the tiers above and rest at 75%, a typical 55-minute session at 80 kg comes out at about 3.9 METs for a moderate push day (~210 active kcal), 4.7 for a hard leg day (~280) and 3.0 for arms (~150). No single segment exceeds 12 METs.

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

Icon and asset design by myself in Canva.
