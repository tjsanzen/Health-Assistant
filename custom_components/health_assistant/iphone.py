"""iPhone bits that go through the Home Assistant Companion app.

* Steps: follow the Companion app's step sensor (sensor.<phone>_steps) and keep a
  per-day total, which feeds the maintenance-calorie estimate.
* Apple Health: after a finished workout, send a notification that runs an Apple
  Shortcut ("Health Assistant Log Workout") when tapped. The Shortcut uses the
  "Log Workout" action to save it in Apple Health. Home Assistant can't write to
  Apple Health itself — only an app on the phone can — and iOS (before iOS 27)
  requires a tap before a notification may run a Shortcut.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.util import dt as dt_util

if TYPE_CHECKING:
    from .model import HealthModel

_LOGGER = logging.getLogger(__name__)

DEFAULT_SHORTCUT = "Health Assistant Log Workout"
STRENGTH_MET = 5.0  # weight training, moderate-to-vigorous


def step_sensors(hass: HomeAssistant) -> list[dict]:
    """Companion app step sensors: [{entity_id, name}]."""
    reg = er.async_get(hass)
    out = []
    for ent in reg.entities.values():
        if ent.platform == "mobile_app" and ent.domain == "sensor" and ent.entity_id.endswith("_steps"):
            state = hass.states.get(ent.entity_id)
            name = (state.name if state else None) or ent.original_name or ent.entity_id
            out.append({"entity_id": ent.entity_id, "name": name})
    return sorted(out, key=lambda x: x["name"])


def step_sensor_for_phone(hass: HomeAssistant, mobile_app_entry_id: str | None) -> str | None:
    """The step sensor that belongs to a given Companion app phone."""
    if not mobile_app_entry_id:
        return None
    reg = er.async_get(hass)
    for ent in er.async_entries_for_config_entry(reg, mobile_app_entry_id):
        if ent.domain == "sensor" and ent.entity_id.endswith("_steps"):
            return ent.entity_id
    return None


class StepsTracker:
    def __init__(self, hass: HomeAssistant, model: HealthModel) -> None:
        self.hass = hass
        self.model = model
        self._unsub: CALLBACK_TYPE | None = None

    @callback
    def start(self) -> None:
        self.stop()
        entity_id = self.model.profile.get("steps_sensor")
        if not entity_id:
            return
        self._unsub = async_track_state_change_event(self.hass, [entity_id], self._changed)
        if state := self.hass.states.get(entity_id):
            self._record(state.state, dt_util.now())

    @callback
    def stop(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None

    @callback
    def _changed(self, event: Event) -> None:
        new = event.data.get("new_state")
        if new is not None:
            self._record(new.state, dt_util.now())

    def _record(self, value: Any, now: datetime) -> None:
        try:
            steps = int(float(value))
        except (TypeError, ValueError):
            return  # unknown / unavailable
        day = now.date()
        # The phone may report yesterday's final total just after midnight, before it resets.
        if now.hour == 0 and now.minute < 30:
            yesterday = (day - timedelta(days=1)).isoformat()
            if steps >= self.model.data["steps_log"].get(yesterday, 0) > 0:
                self.model.record_steps(yesterday, steps)
                return
        self.model.record_steps(day.isoformat(), steps)


class AppleHealthExport:
    def __init__(self, hass: HomeAssistant, model: HealthModel) -> None:
        self.hass = hass
        self.model = model

    @property
    def enabled(self) -> bool:
        p = self.model.profile
        return bool(p.get("live_activity_notify")) and p.get("apple_health_export", True) is not False

    @property
    def shortcut(self) -> str:
        return self.model.profile.get("apple_health_shortcut") or DEFAULT_SHORTCUT

    @callback
    def handle(self, event: str, payload: Any) -> None:
        if event == "workout_ended" and payload and self.enabled:
            self.offer(payload)

    def shortcut_input(self, w: dict) -> dict:
        start = datetime.fromisoformat(w["started_at"])
        end = datetime.fromisoformat(w["ended_at"]) if w.get("ended_at") else dt_util.now()
        minutes = max(1, round((end - start).total_seconds() / 60))
        # Active calories from the per-set engine (Apple Health "Active Energy" excludes resting burn).
        kcal = self.model.workout_kcal(w).get("kcal_active")
        if kcal is None:
            weight = self.model.current_weight() or 75
            kcal = round((STRENGTH_MET - 1) * weight * minutes / 60)
        return {
            "workout_id": w["id"], "title": w.get("name") or "Workout",
            "start": start.isoformat(), "end": end.isoformat(),
            "duration_min": minutes, "kcal": kcal,
        }

    @callback
    def offer(self, w: dict) -> None:
        svc = self.model.profile.get("live_activity_notify")
        if not svc or not self.hass.services.has_service("notify", svc):
            return
        info = self.shortcut_input(w)
        data = {
            "title": "Save to Apple Health?",
            "message": f"{info['title']} · {info['duration_min']} min · ~{info['kcal']} kcal. Tap to log it as a strength workout.",
            "data": {
                "tag": f"health_assistant_export_{w['id']}",
                "shortcut": {"name": self.shortcut, **info},
            },
        }

        async def _send() -> None:
            try:
                await self.hass.services.async_call("notify", svc, data, blocking=True)
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("Apple Health export notification failed: %s", err)

        self.hass.async_create_task(_send(), "health_assistant_apple_health")

    @callback
    def shortcut_finished(self, event: Event) -> None:
        """ios.shortcut_run fires when the Shortcut finishes; mark the workout as saved."""
        d = event.data
        if d.get("name") != self.shortcut or d.get("status") not in ("success", None):
            return
        workout_id = None
        raw = d.get("input")
        try:
            parsed = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(parsed, dict):
                workout_id = parsed.get("workout_id")
        except ValueError:
            pass
        self.model.mark_saved_to_health(workout_id)
