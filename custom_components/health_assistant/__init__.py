"""Health Assistant: nutrition, workouts and health stats for Home Assistant."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    CONF_AGE, CONF_BODY_FAT, CONF_GOAL_RATE, CONF_HEIGHT_CM, CONF_LIFT_DAYS, CONF_NAME,
    CONF_SEX, CONF_STEPS, CONF_TARGET_WEIGHT_KG, CONF_UNITS, CONF_USER_ID, CONF_WEIGHT_KG,
    DOMAIN, PANEL_COMPONENT, PANEL_ICON, PANEL_TITLE, PANEL_URL_PATH, SIGNAL_DATA_UPDATED,
    STATIC_URL, STORAGE_KEY, STORAGE_VERSION,
)
from .food_db import FoodDatabase
from .library import DEMOS_DIR, ExerciseLibrary
from .live_activity import LiveActivity
from .model import HealthModel, empty_data
from .websocket_api import async_register_websocket_commands

_LOGGER = logging.getLogger(__name__)
PLATFORMS = [Platform.SENSOR]
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend")


@dataclass
class HealthRuntime:
    model: HealthModel
    store: Store
    live: LiveActivity


type HealthConfigEntry = ConfigEntry[HealthRuntime]


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    domain = hass.data.setdefault(DOMAIN, {})
    db = FoodDatabase([
        hass.config.path("health_assistant", "foods.db"),
        os.path.join(os.path.dirname(__file__), "data", "foods.db"),
    ])
    domain["food_db"] = db
    domain["library"] = ExerciseLibrary(demo_url=f"{STATIC_URL}/demos")
    count = len(await hass.async_add_executor_job(domain["library"].all))
    _LOGGER.info("Health Assistant exercise library: %s exercises", count)
    if db.available:
        count = await hass.async_add_executor_job(db.count)
        _LOGGER.info("Health Assistant food database loaded: %s foods (%s)", count, db.path)
    else:
        _LOGGER.warning(
            "Health Assistant food database not found. Run scripts/build_food_db.py and copy "
            "foods.db to %s", hass.config.path("health_assistant", "foods.db"),
        )
    async_register_websocket_commands(hass)
    return True


async def _async_register_panel(hass: HomeAssistant) -> None:
    domain = hass.data[DOMAIN]
    if not domain.get("static_registered"):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(f"{STATIC_URL}/demos", DEMOS_DIR, cache_headers=True),
                StaticPathConfig(STATIC_URL, FRONTEND_DIR, cache_headers=False),
            ]
        )
        domain["static_registered"] = True
    if domain.get("panel_registered"):
        return
    # mtime cache-buster so a reload always serves the newest panel build
    mtime = int(os.path.getmtime(os.path.join(FRONTEND_DIR, "health-panel.js")))
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=PANEL_COMPONENT,
        frontend_url_path=PANEL_URL_PATH,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{STATIC_URL}/health-panel.js?v={mtime}",
        embed_iframe=False,
        require_admin=False,
        config={},
    )
    domain["panel_registered"] = True


def _initial_data(entry: ConfigEntry, now_iso: str, today: str) -> dict:
    d = entry.data
    profile = {
        "name": d[CONF_NAME],
        "user_id": d.get(CONF_USER_ID),
        "units": d[CONF_UNITS],
        "sex": d[CONF_SEX],
        "age": d[CONF_AGE],
        "age_recorded": today,
        "height_cm": d[CONF_HEIGHT_CM],
        "target_weight_kg": d[CONF_TARGET_WEIGHT_KG],
        "daily_steps": d[CONF_STEPS],
        "lifting_days": d[CONF_LIFT_DAYS],
        "goal_rate_kg_week": d[CONF_GOAL_RATE],
    }
    data = empty_data(profile)
    # Seed the health-stat history with the setup answers.
    seeds = [("weight", d[CONF_WEIGHT_KG], "kg"), ("height", d[CONF_HEIGHT_CM], "cm")]
    if d.get(CONF_BODY_FAT):
        seeds.append(("body_fat", d[CONF_BODY_FAT], "%"))
    for i, (vtype, value, unit) in enumerate(seeds):
        data["vitals"].append({
            "id": f"setup{i}", "type": vtype, "value": round(float(value), 2),
            "unit": unit, "recorded_at": now_iso, "note": "Initial setup",
        })
    return data


async def async_setup_entry(hass: HomeAssistant, entry: HealthConfigEntry) -> bool:
    store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY.format(entry_id=entry.entry_id))
    data = await store.async_load()
    if data is None:
        now = dt_util.now()
        data = _initial_data(entry, now.isoformat(), now.date().isoformat())
        await store.async_save(data)

    signal = SIGNAL_DATA_UPDATED.format(entry_id=entry.entry_id)

    @callback
    def _save() -> None:
        store.async_delay_save(lambda: model.data, 2)
        async_dispatcher_send(hass, signal)

    library: ExerciseLibrary = hass.data[DOMAIN]["library"]

    def _exercise_name(ex_id: str) -> str:
        ex = model.exercise(ex_id)
        return ex["name"] if ex else ex_id

    live = LiveActivity(hass, lambda: model.profile, _exercise_name)
    model = HealthModel(data, _save, dt_util.now, library=library.all, emit=live.handle)
    entry.runtime_data = HealthRuntime(model=model, store=store, live=live)

    # Day rollover: refresh "today" sensors just after midnight
    @callback
    def _midnight(_now) -> None:
        async_dispatcher_send(hass, signal)

    entry.async_on_unload(async_track_time_change(hass, _midnight, hour=0, minute=0, second=5))

    await _async_register_panel(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: HealthConfigEntry) -> bool:
    await entry.runtime_data.store.async_save(entry.runtime_data.model.data)
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    remaining = [
        e for e in hass.config_entries.async_entries(DOMAIN)
        if e.entry_id != entry.entry_id and e.state is ConfigEntryState.LOADED
    ]
    if ok and not remaining and hass.data[DOMAIN].get("panel_registered"):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
        hass.data[DOMAIN]["panel_registered"] = False
    return ok


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Delete stored data when the profile is removed."""
    await Store(hass, STORAGE_VERSION, STORAGE_KEY.format(entry_id=entry.entry_id)).async_remove()
