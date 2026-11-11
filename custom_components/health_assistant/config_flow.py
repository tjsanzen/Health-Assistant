"""Setup flow: who you are, your body, and how active you are."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers import selector
from homeassistant.util import slugify
from homeassistant.util.unit_system import METRIC_SYSTEM

from .calculations import MAX_SAFE_DEFICIT, calculate_energy
from .iphone import step_sensor_for_phone
from .const import (
    CM_PER_IN, CONF_AGE, CONF_BODY_FAT, CONF_GOAL_RATE, CONF_GOAL_RATE_INPUT, CONF_HEIGHT,
    CONF_HEIGHT_CM, CONF_HEIGHT_FT, CONF_HEIGHT_IN, CONF_LIFT_DAYS, CONF_LIVE_ACTIVITY, CONF_NAME, CONF_SEX,
    CONF_STEPS_SENSOR,
    CONF_STEPS, CONF_TARGET_WEIGHT, CONF_TARGET_WEIGHT_KG, CONF_UNITS, CONF_USER_ID,
    CONF_WEIGHT, CONF_WEIGHT_KG, DOMAIN, LB_PER_KG, SEX_FEMALE, SEX_MALE, UNITS_IMPERIAL,
    UNITS_METRIC,
)

NO_USER = "__none__"


def _num(min_v: float, max_v: float, step: float, unit: str | None = None) -> selector.NumberSelector:
    return selector.NumberSelector(selector.NumberSelectorConfig(
        min=min_v, max=max_v, step=step, mode=selector.NumberSelectorMode.BOX,
        unit_of_measurement=unit,
    ))


class HealthAssistantConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}

    # Step 1 — profile ---------------------------------------------------------
    async def async_step_user(self, user_input: dict | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            uid = user_input.get(CONF_USER_ID)
            self._data[CONF_NAME] = user_input[CONF_NAME].strip()
            self._data[CONF_USER_ID] = None if uid in (None, NO_USER) else uid
            self._data[CONF_UNITS] = user_input[CONF_UNITS]
            await self.async_set_unique_id(self._data[CONF_USER_ID] or self._data[CONF_NAME].lower())
            self._abort_if_unique_id_configured()
            return await self.async_step_body()

        users = [u for u in await self.hass.auth.async_get_users()
                 if not u.system_generated and u.is_active]
        user_options = [selector.SelectOptionDict(value=NO_USER, label="Not linked")] + [
            selector.SelectOptionDict(value=u.id, label=u.name or u.id) for u in users
        ]
        default_units = UNITS_METRIC if self.hass.config.units is METRIC_SYSTEM else UNITS_IMPERIAL
        schema = vol.Schema({
            vol.Required(CONF_NAME): str,
            vol.Optional(CONF_USER_ID, default=NO_USER): selector.SelectSelector(
                selector.SelectSelectorConfig(options=user_options)),
            vol.Required(CONF_UNITS, default=default_units): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=[UNITS_IMPERIAL, UNITS_METRIC], translation_key="units")),
        })
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    # Step 2 — body ------------------------------------------------------------
    async def async_step_body(self, user_input: dict | None = None) -> ConfigFlowResult:
        imperial = self._data[CONF_UNITS] == UNITS_IMPERIAL
        errors: dict[str, str] = {}
        if user_input is not None:
            if imperial:
                weight = user_input[CONF_WEIGHT] / LB_PER_KG
                target = user_input[CONF_TARGET_WEIGHT] / LB_PER_KG
                height = (user_input[CONF_HEIGHT_FT] * 12 + user_input.get(CONF_HEIGHT_IN, 0)) * CM_PER_IN
            else:
                weight = user_input[CONF_WEIGHT]
                target = user_input[CONF_TARGET_WEIGHT]
                height = user_input[CONF_HEIGHT]
            if not 90 <= height <= 250:
                errors["base"] = "invalid_height"
            else:
                self._data.update({
                    CONF_WEIGHT_KG: round(weight, 2),
                    CONF_TARGET_WEIGHT_KG: round(target, 2),
                    CONF_HEIGHT_CM: round(height, 1),
                    CONF_BODY_FAT: user_input.get(CONF_BODY_FAT) or None,
                    CONF_AGE: int(user_input[CONF_AGE]),
                    CONF_SEX: user_input[CONF_SEX],
                })
                return await self.async_step_activity()

        wunit = "lb" if imperial else "kg"
        fields: dict = {
            vol.Required(CONF_WEIGHT): _num(50 if imperial else 25, 700 if imperial else 320, 0.1, wunit),
            vol.Required(CONF_TARGET_WEIGHT): _num(50 if imperial else 25, 700 if imperial else 320, 0.1, wunit),
        }
        if imperial:
            fields[vol.Required(CONF_HEIGHT_FT)] = _num(3, 8, 1, "ft")
            fields[vol.Required(CONF_HEIGHT_IN, default=0)] = _num(0, 11.5, 0.5, "in")
        else:
            fields[vol.Required(CONF_HEIGHT)] = _num(90, 250, 0.5, "cm")
        fields.update({
            vol.Optional(CONF_BODY_FAT): _num(3, 70, 0.1, "%"),
            vol.Required(CONF_AGE): _num(13, 110, 1, "years"),
            vol.Required(CONF_SEX): selector.SelectSelector(selector.SelectSelectorConfig(
                options=[SEX_MALE, SEX_FEMALE], translation_key="sex")),
        })
        return self.async_show_form(step_id="body", data_schema=vol.Schema(fields), errors=errors)

    # Step 3 — activity & goal -------------------------------------------------
    async def async_step_activity(self, user_input: dict | None = None) -> ConfigFlowResult:
        imperial = self._data[CONF_UNITS] == UNITS_IMPERIAL
        if user_input is not None:
            rate = user_input[CONF_GOAL_RATE_INPUT]
            self._data[CONF_GOAL_RATE] = round(rate / LB_PER_KG if imperial else rate, 3)
            self._data[CONF_STEPS] = int(user_input[CONF_STEPS])
            self._data[CONF_LIFT_DAYS] = int(user_input[CONF_LIFT_DAYS])
            phone = user_input.get(CONF_LIVE_ACTIVITY)
            self._data[CONF_LIVE_ACTIVITY] = None if phone in (None, NO_USER) else phone
            # Use that phone's step counter (Companion app pedometer sensor) automatically.
            entry_id = next((eid for svc, _, _, eid in self._companion_phones() if svc == phone), None)
            self._data[CONF_STEPS_SENSOR] = step_sensor_for_phone(self.hass, entry_id)
            return await self.async_step_summary()

        phones = self._companion_phones()
        default_phone = next((svc for svc, _, uid, _ in phones if uid and uid == self._data.get(CONF_USER_ID)), NO_USER)
        schema = vol.Schema({
            vol.Required(CONF_STEPS, default=6000): _num(0, 40000, 500, "steps/day"),
            vol.Required(CONF_LIFT_DAYS, default=3): _num(0, 7, 1, "days/week"),
            vol.Required(CONF_GOAL_RATE_INPUT, default=0.5 if imperial else 0.25): _num(
                0, 2 if imperial else 1, 0.05, "lb/week" if imperial else "kg/week"),
            vol.Optional(CONF_LIVE_ACTIVITY, default=default_phone): selector.SelectSelector(
                selector.SelectSelectorConfig(options=[selector.SelectOptionDict(value=NO_USER, label="Off")] + [
                    selector.SelectOptionDict(value=svc, label=name) for svc, name, _, _ in phones
                ])),
        })
        return self.async_show_form(step_id="activity", data_schema=schema)

    def _companion_phones(self) -> list[tuple[str, str, str | None, str | None]]:
        """(notify service, device name, HA user id, mobile_app entry id) for each phone."""
        services = self.hass.services.async_services().get("notify", {})
        out = []
        for entry in self.hass.config_entries.async_entries("mobile_app"):
            name = entry.data.get("device_name") or entry.title
            svc = f"mobile_app_{slugify(name)}"
            if svc in services:
                out.append((svc, name, entry.data.get("user_id"), entry.entry_id))
        # Phones the mobile_app entries didn't explain (renamed devices etc.)
        known = {svc for svc, _, _, _ in out}
        out += [(s, s.removeprefix("mobile_app_").replace("_", " "), None, None)
                for s in sorted(services) if s.startswith("mobile_app_") and s not in known]
        return out

    # Step 4 — confirm the numbers ---------------------------------------------
    async def async_step_summary(self, user_input: dict | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title=self._data[CONF_NAME], data=self._data)
        d = self._data
        e = calculate_energy(
            weight_kg=d[CONF_WEIGHT_KG], height_cm=d[CONF_HEIGHT_CM], age=d[CONF_AGE],
            sex=d[CONF_SEX], body_fat_pct=d[CONF_BODY_FAT], daily_steps=d[CONF_STEPS],
            lifting_days=d[CONF_LIFT_DAYS], target_weight_kg=d[CONF_TARGET_WEIGHT_KG],
            goal_rate_kg_week=d[CONF_GOAL_RATE],
        )
        return self.async_show_form(
            step_id="summary",
            data_schema=vol.Schema({}),
            description_placeholders={
                "formula": e.formula,
                "bmr": f"{e.bmr:,.0f}",
                "maintenance": f"{e.maintenance:,.0f}",
                "multiplier": f"{e.activity_multiplier:.2f}",
                "activity": e.activity_label,
                "goal": e.goal,
                "target": f"{e.target:,.0f}",
                "protein": f"{e.protein_g:.0f}",
                "fat": f"{e.fat_g:.0f}",
                "carbs": f"{e.carbs_g:.0f}",
                "floor_note": " (raised to the safe minimum)" if e.target_floored else "",
                "deficit_warning": (
                    f"\n\n⚠️ **Warning!** This is a deficit of {abs(e.daily_adjustment):,.0f} kcal/day. "
                    "Modern research suggests that a caloric deficit of more than 500-600 calories per day can be "
                    "dangerous, and cause you to lose fat and muscle, even with high protein intake. "
                    "We suggest a smaller deficit — go back and lower your weekly goal."
                ) if e.daily_adjustment < -MAX_SAFE_DEFICIT else "",
            },
        )
