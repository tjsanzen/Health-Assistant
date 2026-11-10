"""Home Assistant integration tests.

    pip install pytest-homeassistant-custom-component
    pytest tests/test_integration.py
"""
from __future__ import annotations

import pytest

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component

DOMAIN = "health_assistant"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


async def _create_profile(hass: HomeAssistant, body_fat=None):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "user"
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"name": "Tovin", "user_id": "__none__", "units": "imperial"})
    assert result["step_id"] == "body"
    body = {"weight": 180, "target_weight": 170, "height_ft": 5, "height_in": 11, "age": 30, "sex": "male"}
    if body_fat:
        body["body_fat_pct"] = body_fat
    result = await hass.config_entries.flow.async_configure(result["flow_id"], body)
    assert result["step_id"] == "activity"
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"daily_steps": 8000, "lifting_days": 3, "goal_rate": 0.5})
    assert result["step_id"] == "summary"
    placeholders = result["description_placeholders"]
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    return result["result"], placeholders


async def test_setup_flow_and_panel(hass: HomeAssistant, hass_ws_client) -> None:
    assert await async_setup_component(hass, "http", {})
    entry, ph = await _create_profile(hass, body_fat=18)
    assert ph["formula"] == "Katch-McArdle"
    assert abs(entry.data["weight_kg"] - 81.65) < 0.05
    assert abs(entry.data["height_cm"] - 180.3) < 0.1

    assert "health" in hass.data["frontend_panels"]
    assert hass.data["frontend_panels"]["health"].sidebar_icon == "mdi:food-apple"

    state = hass.states.get("sensor.health_assistant_tovin_calorie_target")
    assert state is not None and float(state.state) > 1500
    assert float(hass.states.get("sensor.health_assistant_tovin_calories_today").state) == 0

    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": f"{DOMAIN}/profiles"})
    msg = await ws.receive_json()
    assert msg["success"] and msg["result"][0]["name"] == "Tovin"

    await ws.send_json({"id": 2, "type": f"{DOMAIN}/food/log", "entry": {
        "name": "Banana", "meal": "breakfast", "kcal": 105, "protein": 1.3, "fat": 0.4, "carbs": 27}})
    msg = await ws.receive_json()
    assert msg["success"], msg
    await hass.async_block_till_done()
    assert float(hass.states.get("sensor.health_assistant_tovin_calories_today").state) == 105

    await ws.send_json({"id": 3, "type": f"{DOMAIN}/vitals/log", "vital_type": "blood_pressure",
                        "values": {"systolic": 120, "diastolic": 80}})
    assert (await ws.receive_json())["success"]
    await hass.async_block_till_done()
    assert hass.states.get("sensor.health_assistant_tovin_blood_pressure").state == "120/80"

    await ws.send_json({"id": 4, "type": f"{DOMAIN}/workout/start"})
    msg = await ws.receive_json()
    w = msg["result"]
    w["exercises"] = [{"id": "x", "exercise_id": "squat", "notes": "", "sets": [
        {"id": "s", "type": "working", "weight": 100, "reps": 5, "rpe": 8, "completed": True}]}]
    await ws.send_json({"id": 5, "type": f"{DOMAIN}/workout/update", "workout": w})
    assert (await ws.receive_json())["success"]
    await ws.send_json({"id": 6, "type": f"{DOMAIN}/workout/finish"})
    msg = await ws.receive_json()
    assert msg["success"] and msg["result"]["summary"]["sets"] == 1

    await ws.send_json({"id": 7, "type": f"{DOMAIN}/vitals/log", "vital_type": "nope", "values": {}})
    assert not (await ws.receive_json())["success"]

    await ws.send_json({"id": 8, "type": f"{DOMAIN}/food/search", "query": "banana"})
    msg = await ws.receive_json()
    assert msg["success"]
    if msg["result"]["db_available"]:
        assert any("Banana" in f["name"] for f in msg["result"]["results"])

    # Unloading the last profile removes the panel
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert "health" not in hass.data["frontend_panels"]


async def test_mifflin_without_body_fat(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, "http", {})
    _, ph = await _create_profile(hass)
    assert ph["formula"] == "Mifflin-St Jeor"
