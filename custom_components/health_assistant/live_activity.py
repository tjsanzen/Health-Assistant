"""Workout + rest timer as an iOS Live Activity (Lock Screen / Dynamic Island).

Uses the Home Assistant Companion app's `live_update` notifications
(iOS 17.2+, Companion app 2026.9+, HA Core 2026.7+). iOS limits how often new
activities can be *started*, so one activity is started per workout and then
updated in place: a count-up of workout time, switching to a countdown while
resting. The timer ticks on the phone itself via `chronometer`.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any, Callable

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.event import async_call_later

from .const import PANEL_URL_PATH

_LOGGER = logging.getLogger(__name__)
TAG = "health_assistant_workout"


def notify_targets(hass: HomeAssistant) -> list[str]:
    """Companion-app notify services (e.g. mobile_app_tovins_iphone)."""
    return sorted(s for s in hass.services.async_services().get("notify", {}) if s.startswith("mobile_app_"))


class LiveActivity:
    def __init__(self, hass: HomeAssistant, get_profile: Callable[[], dict],
                 exercise_name: Callable[[str], str]) -> None:
        self.hass = hass
        self._profile = get_profile
        self._exercise_name = exercise_name
        self._rest_timer: CALLBACK_TYPE | None = None
        self._workout: dict | None = None

    @property
    def service(self) -> str | None:
        svc = self._profile().get("live_activity_notify")
        if svc and self.hass.services.has_service("notify", svc):
            return svc
        return None

    # -------------------------------------------------------------- events
    @callback
    def handle(self, event: str, payload: Any) -> None:
        if not self.service:
            return
        if event == "workout_started":
            self._workout = payload
            self._send_workout(silent=False)
        elif event == "rest":
            self._workout = payload["workout"]
            self._cancel_timer()
            rest = payload["rest"]
            if rest:
                self._send_rest(rest)
                delay = max(0.0, rest["ends_at"] - time.time())
                self._rest_timer = async_call_later(self.hass, delay, self._rest_over)
            else:
                self._send_workout(silent=True)
        elif event == "workout_ended":
            self._cancel_timer()
            self._workout = None
            self._call({"message": "clear_notification", "data": {"tag": TAG}})

    def _cancel_timer(self) -> None:
        if self._rest_timer:
            self._rest_timer()
            self._rest_timer = None

    @callback
    def _rest_over(self, _now) -> None:
        self._rest_timer = None
        if self._workout:
            # Not silent: this update is what buzzes your phone when rest is done.
            self._send_workout(silent=False, message="Rest over — time for your next set")

    # ------------------------------------------------------------- payloads
    def _send_workout(self, silent: bool, message: str | None = None) -> None:
        w = self._workout
        if not w:
            return
        started = datetime.fromisoformat(w["started_at"]).timestamp()
        self._call({
            "title": w.get("name") or "Workout",
            "message": message or "Workout in progress",
            "data": {
                "tag": TAG, "live_update": True, "chronometer": True, "when": int(started),
                "notification_icon": "mdi:dumbbell", "url": f"/{PANEL_URL_PATH}",
                "critical_text": "Workout", "silent": silent,
            },
        })

    def _send_rest(self, rest: dict) -> None:
        w = self._workout or {}
        name = self._exercise_name(rest.get("exercise_id")) if rest.get("exercise_id") else None
        self._call({
            "title": w.get("name") or "Workout",
            "message": f"Rest · next: {name}" if name else "Resting",
            "data": {
                "tag": TAG, "live_update": True, "chronometer": True, "when": int(rest["ends_at"]),
                "notification_icon": "mdi:timer-sand", "url": f"/{PANEL_URL_PATH}",
                "critical_text": "Rest", "silent": True,
            },
        })

    def _call(self, data: dict) -> None:
        svc = self.service
        if not svc:
            return
        self.hass.async_create_task(
            self.hass.services.async_call("notify", svc, data, blocking=False),
            "health_assistant_live_activity",
        )
