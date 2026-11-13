"""Energy & macro calculations. Pure functions, no Home Assistant imports."""
from __future__ import annotations

from dataclasses import asdict, dataclass

from .const import KCAL_PER_KG_FAT, SEX_MALE

# Baseline multiplier for "sedentary" life. It already covers the thermic
# effect of food and roughly 3,000 incidental steps a day.
SEDENTARY_FACTOR = 1.2
BASELINE_STEPS = 3000
# ~0.04 kcal per step for an 80 kg person -> 0.0005 kcal / step / kg
KCAL_PER_STEP_PER_KG = 0.0005
# Resistance training ~5 METs; subtract the 1 MET you'd burn anyway.
LIFT_NET_MET = 4.0
LB_PER_KG = 2.2046226218
# Protein suggestion: 0.6 g per lb of body weight, or 0.9 g/lb when lean (< 15 % body fat).
PROTEIN_G_PER_LB = 0.6
PROTEIN_G_PER_LB_LEAN = 0.9
LEAN_BODY_FAT_PCT = 15
# Deficits bigger than this trigger a warning in the app.
MAX_SAFE_DEFICIT = 600

MIN_KCAL = {"male": 1500, "female": 1200}


def mifflin_st_jeor(weight_kg: float, height_cm: float, age: float, sex: str) -> float:
    """BMR via Mifflin-St Jeor (used when body fat is unknown)."""
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age
    return base + 5 if sex == SEX_MALE else base - 161


def katch_mcardle(weight_kg: float, body_fat_pct: float) -> float:
    """BMR via Katch-McArdle (used when body fat is known)."""
    lean_mass = weight_kg * (1 - body_fat_pct / 100)
    return 370 + 21.6 * lean_mass


@dataclass
class EnergyResult:
    formula: str
    bmr: float
    step_kcal: float
    lifting_kcal: float
    maintenance: float
    activity_multiplier: float
    activity_label: str
    goal: str  # lose | maintain | gain
    daily_adjustment: float
    target: float
    target_floored: bool
    lean_mass_kg: float | None
    protein_g: float
    fat_g: float
    carbs_g: float

    def as_dict(self) -> dict:
        return {k: (round(v, 1) if isinstance(v, float) else v) for k, v in asdict(self).items()}


def activity_label(multiplier: float) -> str:
    if multiplier < 1.3:
        return "Sedentary"
    if multiplier < 1.45:
        return "Lightly active"
    if multiplier < 1.6:
        return "Moderately active"
    if multiplier < 1.75:
        return "Very active"
    return "Extremely active"


def calculate_energy(
    *,
    weight_kg: float,
    height_cm: float,
    age: float,
    sex: str,
    body_fat_pct: float | None,
    daily_steps: int,
    lifting_days: float,
    lifting_hours_per_week: float | None = None,
    lifting_kcal_per_day: float | None = None,
    target_weight_kg: float | None,
    goal_rate_kg_week: float,
) -> EnergyResult:
    """Compute BMR, maintenance (TDEE), target calories and macro targets."""
    if body_fat_pct:
        formula = "Katch-McArdle"
        bmr = katch_mcardle(weight_kg, body_fat_pct)
        lean = weight_kg * (1 - body_fat_pct / 100)
    else:
        formula = "Mifflin-St Jeor"
        bmr = mifflin_st_jeor(weight_kg, height_cm, age, sex)
        lean = None

    base = bmr * SEDENTARY_FACTOR
    step_kcal = max(0, daily_steps - BASELINE_STEPS) * KCAL_PER_STEP_PER_KG * weight_kg
    # Logged training time wins over the "days per week × 1 hour" setup answer.
    hours = lifting_hours_per_week if lifting_hours_per_week is not None else lifting_days * 1.0
    lifting_kcal = hours * LIFT_NET_MET * weight_kg / 7
    if lifting_kcal_per_day is not None:  # per-set estimate from logged workouts wins
        lifting_kcal = lifting_kcal_per_day
    maintenance = base + step_kcal + lifting_kcal
    multiplier = maintenance / bmr

    # Goal direction from target weight (0.5 kg dead-band counts as maintain)
    goal = "maintain"
    if target_weight_kg is not None:
        diff = target_weight_kg - weight_kg
        if diff <= -0.5:
            goal = "lose"
        elif diff >= 0.5:
            goal = "gain"

    adjustment = 0.0
    if goal != "maintain" and goal_rate_kg_week:
        adjustment = abs(goal_rate_kg_week) * KCAL_PER_KG_FAT / 7
        if goal == "lose":
            adjustment = -adjustment

    target = maintenance + adjustment
    floor = MIN_KCAL.get(sex, 1200)
    floored = target < floor
    if floored:
        target = float(floor)

    # Macros: protein per lb of body weight (more when lean); fat 25 %; carbs the rest.
    per_lb = PROTEIN_G_PER_LB_LEAN if body_fat_pct and body_fat_pct < LEAN_BODY_FAT_PCT else PROTEIN_G_PER_LB
    protein_g = weight_kg * LB_PER_KG * per_lb
    fat_g = target * 0.25 / 9
    carbs_g = max(0.0, (target - protein_g * 4 - fat_g * 9) / 4)

    return EnergyResult(
        formula=formula,
        bmr=bmr,
        step_kcal=step_kcal,
        lifting_kcal=lifting_kcal,
        maintenance=maintenance,
        activity_multiplier=multiplier,
        activity_label=activity_label(multiplier),
        goal=goal,
        daily_adjustment=adjustment,
        target=target,
        target_floored=floored,
        lean_mass_kg=lean,
        protein_g=protein_g,
        fat_g=fat_g,
        carbs_g=carbs_g,
    )


# ---- Workout maths ---------------------------------------------------------

def estimated_1rm(weight: float, reps: int) -> float:
    """Epley estimate. A single rep is the 1RM itself."""
    if not weight or not reps:
        return 0.0
    if reps == 1:
        return float(weight)
    return weight * (1 + reps / 30)


def scale_nutrients(per_100g: dict, grams: float) -> dict:
    f = grams / 100
    return {k: round((per_100g.get(k) or 0) * f, 1) for k in per_100g}


# ---- Workout calorie engine -------------------------------------------------
#
# Calories = Σ over time segments of  MET × body weight (kg) × minutes / 60.
# Segments: each set's working time (exercise MET × effort multiplier), the rest
# that follows it, transitions between exercises, and idle time. Based on the
# "dynamic set-by-set" model, adapted to what Health Assistant records:
#   * set tick times (completed_at) give real rest lengths; older workouts without
#     them fall back to the planned rest timer;
#   * "active" calories (above the 1 MET you'd burn sitting still) are reported
#     alongside the total — maintenance calories and Apple Health use active.

# MET while the set is being performed. One step above the textbook tiers (7/5/4/3) so whole
# sessions, rest included, line up with measured values (see REST_FRACTION).
TIER_MET = {1: 8.0, 2: 6.0, 3: 5.0, 4: 4.0}
DEFAULT_BASE_MET = 5.0
MET_CAP = 12.0
SECONDS_PER_REP = 4
SET_SETUP_S = 10                  # unrack, brace, re-rack
MIN_SET_SECONDS = 10
DEFAULT_SET_SECONDS = 30          # a set with no reps or time logged
DEFAULT_REST_S = 120
REST_MET = 1.5                    # floor for recovering between sets, within the rest window
# Breathing and heart rate stay up after a hard set (oxygen debt), so rest burns a share of
# the set's intensity rather than a flat 1.5 METs. Calibrated so whole sessions land on the
# Compendium of Physical Activities: ~3.5 METs for moderate multi-exercise training,
# ~5 for squat/deadlift-heavy work, ~6 for vigorous lifting.
REST_FRACTION = 0.75
REST_GRACE_S = 60                 # minor overrun still counts as rest
TRANSITION_MET = 2.0              # walking to the next station, re-racking
TRANSITION_S = 120
SUPERSET_SWITCH_S = 60            # moving between superset partners
IDLE_MET = 1.2                    # long gaps: back to (nearly) resting
MAX_IDLE_PER_GAP_S = 20 * 60      # phone calls etc. don't count forever
SETUP_S = 5 * 60                  # before the first set: setup / warm-up walk-around
TAIL_IDLE_CAP_S = 10 * 60         # after the last set, if Finish was pressed late


def rpe_multiplier(rpe: float | None, set_type: str = "working") -> float:
    """Effort scaling. Without an RPE, the set type stands in."""
    if rpe in (None, ""):
        return {"warmup": 0.85, "failure": 1.20, "drop": 1.10}.get(set_type, 1.0)
    rpe = float(rpe)
    if rpe < 6:
        return 0.85
    if rpe < 8:
        return 1.0
    if rpe < 9.5:
        return 1.10
    return 1.20


def exercise_base_met(ex: dict | None) -> float:
    if not ex:
        return DEFAULT_BASE_MET
    if ex.get("base_met"):
        return float(ex["base_met"])
    if ex.get("tier") in TIER_MET:
        return TIER_MET[ex["tier"]]
    return DEFAULT_BASE_MET


def set_active_seconds(s: dict, kind: str) -> float:
    if kind in ("duration", "distance") and s.get("duration_s"):
        return float(s["duration_s"])
    reps = s.get("reps")
    if reps:
        return max(MIN_SET_SECONDS, float(reps) * SECONDS_PER_REP + SET_SETUP_S)
    return DEFAULT_SET_SECONDS


def _ts(iso: str | None):
    from datetime import datetime
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso)
    except ValueError:
        return None


def _secs(a, b) -> float:
    """b - a in seconds. If only one has a timezone, the other is taken as local time."""
    if (a.tzinfo is None) != (b.tzinfo is None):
        a = a.astimezone().replace(tzinfo=None) if a.tzinfo else a
        b = b.astimezone().replace(tzinfo=None) if b.tzinfo else b
    return (b - a).total_seconds()


def workout_calories(workout: dict, exercises: dict[str, dict], weight_kg: float | None) -> dict:
    """Estimate energy for a finished workout. `exercises` maps id -> library entry."""
    kg = weight_kg or 75.0
    segs: list[tuple[float, float, str, str]] = []  # (seconds, met, phase, exercise_id)

    seq = []
    for pos, ex in enumerate(workout.get("exercises", [])):
        for si, s in enumerate(ex.get("sets", [])):
            if s.get("completed", True):
                seq.append({"ex": ex, "set": s, "pos": pos, "si": si, "t": _ts(s.get("completed_at"))})
    if not seq:
        return {"kcal_total": 0, "kcal_active": 0, "active_min": 0, "rest_min": 0, "idle_min": 0,
                "avg_met": 0, "timed": False, "by_exercise": {}}

    timed = all(x["t"] for x in seq)
    if timed:
        seq.sort(key=lambda x: x["t"])

    def info(x):
        lib = exercises.get(x["ex"]["exercise_id"])
        kind = (lib or {}).get("kind", "weight_reps")
        return lib, kind, set_active_seconds(x["set"], kind)

    for i, x in enumerate(seq):
        lib, kind, active = info(x)
        met = min(MET_CAP, exercise_base_met(lib) * rpe_multiplier(x["set"].get("rpe"), x["set"].get("type", "working")))
        segs.append((active, met, "set", x["ex"]["exercise_id"]))
        if i == len(seq) - 1:
            break
        nxt = seq[i + 1]
        _, _, next_active = info(nxt)
        same_ex = nxt["pos"] == x["pos"]
        same_ss = bool(x["ex"].get("superset")) and nxt["ex"].get("superset") == x["ex"].get("superset")
        rest_s = x["ex"].get("rest_s")
        rest_s = DEFAULT_REST_S if rest_s is None else float(rest_s)
        if timed:
            gap = max(0.0, _secs(x["t"], nxt["t"]) - next_active)
        else:  # no tick times: assume the plan was followed
            gap = rest_s if same_ex else SUPERSET_SWITCH_S if same_ss else TRANSITION_S + rest_s
        ex_id = x["ex"]["exercise_id"]
        recovery = max(REST_MET, met * REST_FRACTION)
        if same_ex:
            phases = [(rest_s + REST_GRACE_S, recovery, "rest")]
        elif same_ss:
            phases = [(SUPERSET_SWITCH_S, max(TRANSITION_MET, recovery), "transition")]
        else:  # finished an exercise: rest, then a 2-minute transition buffer
            phases = [(rest_s, recovery, "rest"), (TRANSITION_S, TRANSITION_MET, "transition")]
        for length, met, phase in phases:
            take = min(gap, length)
            if take > 0:
                segs.append((take, met, phase, ex_id))
            gap -= take
        if gap > 0:
            segs.append((min(gap, MAX_IDLE_PER_GAP_S), IDLE_MET, "idle", ex_id))

    # No tick times but a known total duration (e.g. imported history): fit the assumed
    # rest to the real length of the workout instead of trusting the planned rest timers.
    start_t, end_t = _ts(workout.get("started_at")), _ts(workout.get("ended_at"))
    if not timed and start_t and end_t:
        total_s = max(0.0, _secs(start_t, end_t))
        work = sum(sec for sec, _, ph, _ in segs if ph == "set")
        gaps = sum(sec for sec, _, ph, _ in segs if ph in ("rest", "transition"))
        if gaps and work + gaps > total_s:
            f = max(0.0, total_s - work) / gaps
            segs = [(sec * f if ph in ("rest", "transition") else sec, met, ph, ex) for sec, met, ph, ex in segs]
        elif total_s > work + gaps:
            segs.append((min(total_s - work - gaps, MAX_IDLE_PER_GAP_S), IDLE_MET, "idle", ""))

    # Before the first set and after the last one (only knowable with tick times).
    start, end = _ts(workout.get("started_at")), _ts(workout.get("ended_at"))
    if timed and start:
        _, _, first_active = info(seq[0])
        lead = max(0.0, _secs(start, seq[0]["t"]) - first_active)
        segs.append((min(lead, SETUP_S), TRANSITION_MET, "transition", ""))
        if lead > SETUP_S:
            segs.append((min(lead - SETUP_S, MAX_IDLE_PER_GAP_S), IDLE_MET, "idle", ""))
    if timed and end:
        tail = max(0.0, _secs(seq[-1]["t"], end))
        segs.append((min(tail, TRANSITION_S), TRANSITION_MET, "transition", ""))
        if tail > TRANSITION_S:
            segs.append((min(tail - TRANSITION_S, TAIL_IDLE_CAP_S), IDLE_MET, "idle", ""))

    total = active = 0.0
    mins = {"set": 0.0, "rest": 0.0, "transition": 0.0, "idle": 0.0}
    by_ex: dict[str, float] = {}
    for secs, met, phase, ex_id in segs:
        m = secs / 60
        kcal = met * kg * m / 60
        total += kcal
        active += max(0.0, met - 1.0) * kg * m / 60
        mins[phase] += m
        if ex_id:
            by_ex[ex_id] = by_ex.get(ex_id, 0.0) + kcal
    all_min = sum(mins.values())
    return {
        "kcal_total": round(total),
        "kcal_active": round(active),
        "active_min": round(mins["set"], 1),
        "rest_min": round(mins["rest"] + mins["transition"], 1),
        "idle_min": round(mins["idle"], 1),
        "avg_met": round(total / (kg * all_min / 60), 2) if all_min else 0,
        "timed": timed,
        "by_exercise": {k: round(v) for k, v in by_ex.items()},
    }
