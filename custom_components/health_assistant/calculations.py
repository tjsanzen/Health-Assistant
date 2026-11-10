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
    lifting_days: int,
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
    lifting_kcal = lifting_days * 1.0 * LIFT_NET_MET * weight_kg / 7
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

    # Macros: protein from lean mass when known, else body weight; fat 25 %.
    protein_g = (2.2 * lean) if lean else (1.6 * weight_kg)
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
