"""Constants for Health Assistant."""
from __future__ import annotations

DOMAIN = "health_assistant"
NAME = "Health Assistant"
VERSION = "0.2.0"

STORAGE_VERSION = 1
STORAGE_KEY = "health_assistant.{entry_id}"

PANEL_URL_PATH = "health"
PANEL_TITLE = "Health"
PANEL_ICON = "mdi:food-apple"
PANEL_COMPONENT = "health-assistant-panel"
STATIC_URL = "/health_assistant_static"

SIGNAL_DATA_UPDATED = f"{DOMAIN}_data_updated_{{entry_id}}"

# ---- Config / profile keys -------------------------------------------------
CONF_NAME = "name"
CONF_USER_ID = "user_id"
CONF_UNITS = "units"
CONF_SEX = "sex"
CONF_AGE = "age"
CONF_HEIGHT_CM = "height_cm"
CONF_WEIGHT_KG = "weight_kg"
CONF_TARGET_WEIGHT_KG = "target_weight_kg"
CONF_BODY_FAT = "body_fat_pct"
CONF_STEPS = "daily_steps"
CONF_LIFT_DAYS = "lifting_days"
CONF_GOAL_RATE = "goal_rate_kg_week"
CONF_LIVE_ACTIVITY = "live_activity_notify"

# Form-only fields (converted to the metric keys above before storing)
CONF_WEIGHT = "weight"
CONF_TARGET_WEIGHT = "target_weight"
CONF_HEIGHT = "height"
CONF_HEIGHT_FT = "height_ft"
CONF_HEIGHT_IN = "height_in"
CONF_GOAL_RATE_INPUT = "goal_rate"

UNITS_IMPERIAL = "imperial"
UNITS_METRIC = "metric"
SEX_MALE = "male"
SEX_FEMALE = "female"

LB_PER_KG = 2.2046226218
CM_PER_IN = 2.54
KCAL_PER_KG_FAT = 7700

# ---- Domain enums ----------------------------------------------------------
MEALS = ["breakfast", "lunch", "dinner", "snack"]

SET_TYPES = ["working", "warmup", "failure", "drop"]

EXERCISE_KINDS = ["weight_reps", "bodyweight_reps", "duration", "distance"]

# Health stat types: key -> (unit stored, fields)
VITAL_TYPES: dict[str, dict] = {
    "weight": {"unit": "kg", "fields": ["value"]},
    "height": {"unit": "cm", "fields": ["value"]},
    "body_fat": {"unit": "%", "fields": ["value"]},
    "blood_pressure": {"unit": "mmHg", "fields": ["systolic", "diastolic"]},
    "heart_rate": {"unit": "bpm", "fields": ["value"]},
    "respiration": {"unit": "br/min", "fields": ["value"]},
    "hrv": {"unit": "ms", "fields": ["value"]},
    "spo2": {"unit": "%", "fields": ["value"]},
}
