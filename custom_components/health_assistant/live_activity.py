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
# Separate, ordinary notification at the end of each rest: unlike a Live Activity update it can
# carry a sound, which iOS plays through connected headphones even with the app closed.
REST_TAG = "health_assistant_rest_over"
CHIME_FILE = "health_assistant_chime.wav"  # imported into the Companion app (see README)
REST_SOUNDS = ("chime", "default", "off")
# The Companion app draws Live Activity icons from Material Design Icons only (no custom
# images), so this is the closest match to brand/icon.png, in the same blue.
ICON = "mdi:food-apple"
ICON_COLOR = "#40C8F4"


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
        self._next: str | None = None

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
            self._clear_rest_alert()
            rest = payload["rest"]
            if rest:
                self._next = rest.get("next")
                self._send_rest(rest)
                delay = max(0.0, rest["ends_at"] - time.time())
                self._rest_timer = async_call_later(self.hass, delay, self._rest_over)
            else:
                self._send_workout(silent=True)
        elif event == "workout_ended":
            self._cancel_timer()
            self._workout = None
            self._clear_rest_alert()
            self._call({"message": "clear_notification", "data": {"tag": TAG}})

    def _cancel_timer(self) -> None:
        if self._rest_timer:
            self._rest_timer()
            self._rest_timer = None

    @property
    def rest_sound(self) -> str:
        v = self._profile().get("rest_sound") or "chime"
        return v if v in REST_SOUNDS else "chime"

    @callback
    def _rest_over(self, _now) -> None:
        self._rest_timer = None
        if not self._workout:
            return
        msg = f"Rest over · Next: {self._next}" if self._next else "Rest over — time for your next set"
        sound = self.rest_sound
        if sound == "off":
            # Live Activity update only: buzzes the phone, no sound in headphones.
            self._send_workout(silent=False, message=msg)
            return
        self._send_workout(silent=True, message=msg)
        self._send_rest_alert(msg, sound)

    def _send_rest_alert(self, message: str, sound: str) -> None:
        """Rest-over notification with a sound. Time-sensitive so it gets through Focus modes;
        replaced by the next one (same tag) and cleared when the next rest starts."""
        w = self._workout or {}
        self._call({
            "title": w.get("name") or "Workout",
            "message": message,
            "data": {
                "tag": REST_TAG, "url": f"/{PANEL_URL_PATH}",
                "push": {
                    "sound": CHIME_FILE if sound == "chime" else "default",
                    "interruption-level": "time-sensitive",
                },
            },
        })

    def _clear_rest_alert(self) -> None:
        if self.rest_sound != "off":
            self._call({"message": "clear_notification", "data": {"tag": REST_TAG}})

    async def async_test_sound(self, service: str, sound: str) -> None:
        await self.hass.services.async_call("notify", service, {
            "title": "Health Assistant",
            "message": "Rest over — this is how the end of a rest will sound",
            "data": {"tag": "health_assistant_test_sound", "push": {
                "sound": CHIME_FILE if sound == "chime" else "default",
                "interruption-level": "time-sensitive"}},
        }, blocking=True)

    # ------------------------------------------------------------- payloads
    # Shapes follow https://companion.home-assistant.io/docs/notifications/live-activities/
    # title/message at the top of `data`, everything else in the nested `data` block.
    # `title` is fixed when the activity starts, so it stays the workout name.

    def _send_workout(self, silent: bool, message: str | None = None) -> None:
        """Between sets: no timer (a count-up from the past isn't a documented case)."""
        w = self._workout
        if not w:
            return
        started = datetime.fromisoformat(w["started_at"]).astimezone()
        self._call({
            "title": w.get("name") or "Workout",
            "message": message or f"Workout in progress · started {started.strftime('%-I:%M %p')}",
            "data": {
                "tag": TAG, "live_update": True,
                "critical_text": "Lifting",
                "notification_icon": ICON, "notification_icon_color": ICON_COLOR,
                "url": f"/{PANEL_URL_PATH}", "silent": silent,
            },
        })

    def _send_rest(self, rest: dict) -> None:
        """While resting: countdown ticking on the phone, exactly like the docs' example."""
        w = self._workout or {}
        nxt = rest.get("next") or (self._exercise_name(rest["exercise_id"]) if rest.get("exercise_id") else None)
        seconds_left = max(1, int(round(rest["ends_at"] - time.time())))
        self._call({
            "title": w.get("name") or "Workout",
            "message": f"Next: {nxt}" if nxt else "Resting",
            "data": {
                "tag": TAG, "live_update": True,
                "chronometer": True, "when": seconds_left, "when_relative": True,
                "critical_text": "Rest",
                "notification_icon": ICON, "notification_icon_color": ICON_COLOR,
                "url": f"/{PANEL_URL_PATH}", "silent": True,
            },
        })

    async def async_test(self, service: str) -> None:
        """Send the docs' minimal countdown so the setup can be checked on its own."""
        await self.hass.services.async_call("notify", service, {
            "title": "Health Assistant",
            "message": "Test rest timer · 60 seconds",
            "data": {
                "tag": "health_assistant_test", "live_update": True,
                "chronometer": True, "when": 60, "when_relative": True,
                "critical_text": "Test", "notification_icon": ICON, "notification_icon_color": ICON_COLOR,
            },
        }, blocking=True)

        async def _clear(_now) -> None:
            await self.hass.services.async_call("notify", service, {
                "message": "clear_notification", "data": {"tag": "health_assistant_test"}}, blocking=True)

        async_call_later(self.hass, 75, _clear)

    def _call(self, data: dict) -> None:
        svc = self.service
        if not svc:
            _LOGGER.debug("Live Activity skipped: no phone selected (Profile → Workout & rest timer)")
            return
        _LOGGER.debug("Live Activity → notify.%s: %s", svc, data)

        async def _send() -> None:
            try:
                await self.hass.services.async_call("notify", svc, data, blocking=True)
            except Exception as err:  # noqa: BLE001 - surface any failure in the log
                _LOGGER.warning("Live Activity notification to notify.%s failed: %s", svc, err)

        self.hass.async_create_task(_send(), "health_assistant_live_activity")
