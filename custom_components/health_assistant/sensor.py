"""Sensors so other dashboards/automations can use Health Assistant data."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass, SensorEntity, SensorEntityDescription, SensorStateClass,
)
from homeassistant.const import PERCENTAGE, UnitOfMass
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN, NAME, SIGNAL_DATA_UPDATED, UNITS_IMPERIAL, VERSION
from .model import HealthModel

KCAL = "kcal"
GRAMS = UnitOfMass.GRAMS


def _energy(key: str) -> Callable[[HealthModel], Any]:
    def fn(m: HealthModel):
        e = m.energy()
        return round(e[key]) if e else None
    return fn


def _today(key: str) -> Callable[[HealthModel], Any]:
    return lambda m: m.food_day()["totals"][key]


def _latest(vtype: str, field: str = "value") -> Callable[[HealthModel], Any]:
    def fn(m: HealthModel):
        v = m.latest_vital(vtype)
        return v[field] if v else None
    return fn


def _last_workout(m: HealthModel):
    items = m.workout_list(0, 1)["items"]
    return dt_util.parse_datetime(items[0]["started_at"]) if items else None


@dataclass(frozen=True, kw_only=True)
class HealthSensorDescription(SensorEntityDescription):
    value_fn: Callable[[HealthModel], Any]
    attrs_fn: Callable[[HealthModel], dict] | None = None


SENSORS: tuple[HealthSensorDescription, ...] = (
    HealthSensorDescription(key="calories_today", name="Calories today", icon="mdi:fire",
                            native_unit_of_measurement=KCAL, state_class=SensorStateClass.TOTAL,
                            value_fn=_today("kcal")),
    HealthSensorDescription(key="calories_remaining", name="Calories remaining", icon="mdi:fire-off",
                            native_unit_of_measurement=KCAL,
                            value_fn=lambda m: (round(r) if (r := m.food_day()["remaining"]) is not None else None)),
    HealthSensorDescription(key="calorie_target", name="Calorie target", icon="mdi:target",
                            native_unit_of_measurement=KCAL, value_fn=_energy("target"),
                            attrs_fn=lambda m: {k: v for k, v in (m.energy() or {}).items()
                                                if k in ("goal", "daily_adjustment", "target_floored")}),
    HealthSensorDescription(key="maintenance_calories", name="Maintenance calories", icon="mdi:scale-balance",
                            native_unit_of_measurement=KCAL, value_fn=_energy("maintenance"),
                            attrs_fn=lambda m: {k: v for k, v in (m.energy() or {}).items()
                                                if k in ("formula", "activity_multiplier", "activity_label",
                                                         "step_kcal", "lifting_kcal")}),
    HealthSensorDescription(key="bmr", name="BMR", icon="mdi:sleep", native_unit_of_measurement=KCAL,
                            value_fn=_energy("bmr")),
    HealthSensorDescription(key="protein_today", name="Protein today", icon="mdi:food-steak",
                            native_unit_of_measurement=GRAMS, state_class=SensorStateClass.TOTAL,
                            value_fn=_today("protein")),
    HealthSensorDescription(key="carbs_today", name="Carbs today", icon="mdi:bread-slice",
                            native_unit_of_measurement=GRAMS, state_class=SensorStateClass.TOTAL,
                            value_fn=_today("carbs")),
    HealthSensorDescription(key="fat_today", name="Fat today", icon="mdi:water",
                            native_unit_of_measurement=GRAMS, state_class=SensorStateClass.TOTAL,
                            value_fn=_today("fat")),
    HealthSensorDescription(key="weight", name="Weight", device_class=SensorDeviceClass.WEIGHT,
                            native_unit_of_measurement=UnitOfMass.KILOGRAMS,
                            state_class=SensorStateClass.MEASUREMENT, suggested_display_precision=1,
                            value_fn=_latest("weight")),
    HealthSensorDescription(key="body_fat", name="Body fat", icon="mdi:percent",
                            native_unit_of_measurement=PERCENTAGE,
                            state_class=SensorStateClass.MEASUREMENT, value_fn=_latest("body_fat")),
    HealthSensorDescription(key="resting_heart_rate", name="Heart rate", icon="mdi:heart-pulse",
                            native_unit_of_measurement="bpm",
                            state_class=SensorStateClass.MEASUREMENT, value_fn=_latest("heart_rate")),
    HealthSensorDescription(key="blood_pressure", name="Blood pressure", icon="mdi:heart",
                            value_fn=lambda m: (f"{v['systolic']:.0f}/{v['diastolic']:.0f}"
                                                if (v := m.latest_vital("blood_pressure")) else None)),
    HealthSensorDescription(key="last_workout", name="Last workout", icon="mdi:dumbbell",
                            device_class=SensorDeviceClass.TIMESTAMP, value_fn=_last_workout),
    HealthSensorDescription(key="workouts_7d", name="Workouts this week", icon="mdi:calendar-check",
                            native_unit_of_measurement="workouts", state_class=SensorStateClass.MEASUREMENT,
                            value_fn=lambda m: m.workouts_since(7)),
)


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    model: HealthModel = entry.runtime_data.model
    async_add_entities(HealthSensor(entry, model, d) for d in SENSORS)


class HealthSensor(SensorEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False
    entity_description: HealthSensorDescription

    def __init__(self, entry, model: HealthModel, description: HealthSensorDescription) -> None:
        self.entity_description = description
        self._entry = entry
        self._model = model
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        if description.key == "weight" and model.profile.get("units") == UNITS_IMPERIAL:
            self._attr_suggested_unit_of_measurement = UnitOfMass.POUNDS
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=f"{NAME} – {model.profile.get('name')}",
            manufacturer=NAME,
            model="Health profile",
            sw_version=VERSION,
            entry_type=DeviceEntryType.SERVICE,
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(
            self.hass, SIGNAL_DATA_UPDATED.format(entry_id=self._entry.entry_id), self._refresh))

    @callback
    def _refresh(self) -> None:
        self.async_write_ha_state()

    @property
    def native_value(self):
        return self.entity_description.value_fn(self._model)

    @property
    def extra_state_attributes(self):
        fn = self.entity_description.attrs_fn
        return fn(self._model) if fn else None
