"""Websocket commands used by the Health panel.

Every command takes an optional ``profile_id`` (a config entry id). When it is
omitted the profile linked to the logged-in Home Assistant user is used,
falling back to the first profile.
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN, VITAL_TYPES
from .live_activity import notify_targets
from .model import HealthModel, ValidationError

Handler = Callable[[HomeAssistant, HealthModel, dict], Any | Awaitable[Any]]
_COMMANDS: list[tuple[str, dict, Handler]] = []


def command(name: str, schema: dict | None = None):
    def wrap(fn: Handler) -> Handler:
        _COMMANDS.append((f"{DOMAIN}/{name}", schema or {}, fn))
        return fn
    return wrap


def _entries(hass: HomeAssistant):
    return [e for e in hass.config_entries.async_entries(DOMAIN)
            if e.state is ConfigEntryState.LOADED]


def _resolve(hass: HomeAssistant, connection, profile_id: str | None) -> HealthModel:
    entries = _entries(hass)
    if not entries:
        raise ValidationError("No Health Assistant profile is set up")
    if profile_id:
        for e in entries:
            if e.entry_id == profile_id:
                return e.runtime_data.model
        raise ValidationError("Profile not found")
    uid = connection.user.id if connection.user else None
    for e in entries:
        if e.runtime_data.model.profile.get("user_id") == uid:
            return e.runtime_data.model
    return entries[0].runtime_data.model


@callback
def async_register_websocket_commands(hass: HomeAssistant) -> None:
    if hass.data[DOMAIN].get("ws_registered"):
        return
    hass.data[DOMAIN]["ws_registered"] = True

    websocket_api.async_register_command(
        hass, f"{DOMAIN}/profiles", _ws_profiles,
        websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend({vol.Required("type"): f"{DOMAIN}/profiles"}),
    )
    for cmd, extra, fn in _COMMANDS:
        schema = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend({
            vol.Required("type"): cmd,
            vol.Optional("profile_id"): str,
            **extra,
        })
        websocket_api.async_register_command(hass, cmd, _make_handler(fn), schema)


def _make_handler(fn: Handler):
    @websocket_api.async_response
    async def handler(hass: HomeAssistant, connection, msg: dict) -> None:
        try:
            model = _resolve(hass, connection, msg.get("profile_id"))
            result = fn(hass, model, msg)
            if hasattr(result, "__await__"):
                result = await result
        except (ValidationError, ValueError, TypeError) as err:
            connection.send_error(msg["id"], "invalid", str(err))
            return
        connection.send_result(msg["id"], result)
    return handler


@callback
def _ws_profiles(hass: HomeAssistant, connection, msg: dict) -> None:
    uid = connection.user.id if connection.user else None
    out = []
    for e in _entries(hass):
        p = e.runtime_data.model.profile
        out.append({"id": e.entry_id, "name": p.get("name"), "mine": p.get("user_id") == uid})
    connection.send_result(msg["id"], out)


# ------------------------------------------------------------------- overview
@command("overview", {vol.Optional("date"): str})
def _overview(hass, model: HealthModel, msg):
    return {
        "profile": model.profile,
        "age": model.current_age(),
        "energy": model.energy(),
        "today": model.food_day(msg.get("date")),
        "latest": model.latest_vitals(),
        "active_workout": model.data["active_workout"],
        "workouts_7d": model.workouts_since(7),
        "food_db": hass.data[DOMAIN]["food_db"].available,
        "chime_url": hass.data[DOMAIN].get("chime_url"),
    }


@command("profile/update", {vol.Required("changes"): dict})
def _profile_update(hass, model, msg):
    model.update_profile(msg["changes"])
    return {"profile": model.profile, "energy": model.energy()}


# ----------------------------------------------------------------------- food
@command("food/search", {vol.Required("query"): str, vol.Optional("limit", default=25): int})
async def _food_search(hass, model, msg):
    db = hass.data[DOMAIN]["food_db"]
    custom = model.search_custom_foods(msg["query"])
    results = await hass.async_add_executor_job(db.search, msg["query"], msg["limit"])
    return {"custom": custom, "results": results, "db_available": db.available}


@command("food/barcode", {vol.Required("code"): str})
async def _food_barcode(hass, model, msg):
    return await hass.async_add_executor_job(hass.data[DOMAIN]["food_db"].barcode, msg["code"])


@command("food/recent")
def _food_recent(hass, model, msg):
    return {"recent": model.data["recent_foods"], "custom": model.data["custom_foods"]}


@command("food/stats")
def _food_stats(hass, model, msg):
    return model.food_stats()


@command("food/day", {vol.Optional("date"): str})
def _food_day(hass, model, msg):
    return model.food_day(msg.get("date"))


@command("food/log", {vol.Required("entry"): dict})
def _food_log(hass, model, msg):
    return model.add_food(msg["entry"])


@command("food/update", {vol.Required("entry_id"): str, vol.Required("changes"): dict})
def _food_update(hass, model, msg):
    return model.update_food(msg["entry_id"], msg["changes"])


@command("food/delete", {vol.Required("entry_id"): str})
def _food_delete(hass, model, msg):
    model.delete_food(msg["entry_id"])
    return None


@command("food/custom/create", {vol.Required("food"): dict})
def _custom_create(hass, model, msg):
    return model.add_custom_food(msg["food"])


@command("food/custom/delete", {vol.Required("food_id"): str})
def _custom_delete(hass, model, msg):
    model.delete_custom_food(msg["food_id"])
    return None


# --------------------------------------------------------------------- vitals
@command("vitals/log", {
    vol.Required("vital_type"): vol.In(list(VITAL_TYPES)),
    vol.Required("values"): dict,
    vol.Optional("recorded_at"): str,
    vol.Optional("note"): vol.Any(str, None),
})
def _vitals_log(hass, model, msg):
    return model.add_vital(msg["vital_type"], msg["values"], msg.get("recorded_at"), msg.get("note"))


@command("vitals/list", {vol.Optional("vital_type"): str, vol.Optional("limit", default=200): int})
def _vitals_list(hass, model, msg):
    return model.vitals(msg.get("vital_type"), msg["limit"])


@command("vitals/delete", {vol.Required("vital_id"): str})
def _vitals_delete(hass, model, msg):
    model.delete_vital(msg["vital_id"])
    return None


# ------------------------------------------------------------------ exercises
@command("exercises/list")
async def _exercises(hass, model, msg):
    # The library re-reads exercises.json when it changes, which touches the disk.
    await hass.async_add_executor_job(hass.data[DOMAIN]["library"].all)
    return model.exercises()


@command("exercises/create", {vol.Required("exercise"): dict})
def _exercise_create(hass, model, msg):
    return model.add_exercise(msg["exercise"])


@command("exercises/history", {vol.Required("exercise_id"): str})
def _exercise_history(hass, model, msg):
    return model.exercise_history(msg["exercise_id"])


@command("exercises/last", {vol.Required("exercise_ids"): [str]})
def _exercise_last(hass, model, msg):
    return {eid: model.last_info(eid) for eid in msg["exercise_ids"]}


# ------------------------------------------------------------------- workouts
@command("workout/start", {vol.Optional("template_id"): vol.Any(str, None), vol.Optional("name"): str})
def _workout_start(hass, model, msg):
    return model.start_workout(msg.get("template_id"), msg.get("name"))


@command("workout/active")
def _workout_active(hass, model, msg):
    return model.data["active_workout"]


@command("workout/update", {vol.Required("workout"): dict})
def _workout_update(hass, model, msg):
    return model.update_active_workout(msg["workout"])


@command("rest/set", {
    vol.Required("ends_at"): vol.Any(None, vol.Coerce(float)),
    vol.Optional("total"): vol.Any(None, int),
    vol.Optional("exercise_id"): vol.Any(None, str),
    vol.Optional("next"): vol.Any(None, str),
})
def _rest_set(hass, model, msg):
    return model.set_rest(msg["ends_at"], msg.get("total"), msg.get("exercise_id"), msg.get("next"))


@command("notify/targets")
def _notify_targets(hass, model, msg):
    return notify_targets(hass)


@command("workout/finish")
def _workout_finish(hass, model, msg):
    return model.finish_workout()


@command("workout/discard")
def _workout_discard(hass, model, msg):
    model.discard_workout()
    return None


@command("workout/list", {vol.Optional("offset", default=0): int, vol.Optional("limit", default=30): int})
def _workout_list(hass, model, msg):
    return model.workout_list(msg["offset"], msg["limit"])


@command("workout/get", {vol.Required("workout_id"): str})
def _workout_get(hass, model, msg):
    return model.workout(msg["workout_id"])


@command("workout/delete", {vol.Required("workout_id"): str})
def _workout_delete(hass, model, msg):
    model.delete_workout(msg["workout_id"])
    return None


@command("records")
def _records(hass, model, msg):
    return model.records()


# ------------------------------------------------------------------ templates
@command("templates/list")
def _templates(hass, model, msg):
    return sorted(model.data["templates"], key=lambda t: t["name"].lower())


@command("templates/save", {vol.Required("template"): dict})
def _template_save(hass, model, msg):
    return model.save_template(msg["template"])


@command("templates/from_workout", {vol.Required("workout_id"): str, vol.Optional("name"): str})
def _template_from_workout(hass, model, msg):
    return model.template_from_workout(msg["workout_id"], msg.get("name"))


@command("templates/delete", {vol.Required("template_id"): str})
def _template_delete(hass, model, msg):
    model.delete_template(msg["template_id"])
    return None
