"""Closed corridors, stairs and lifts, and the emergency switch, set by staff.

The kiosk and the phones read them (GET /api/closures) every half minute and
route around what is closed; in an emergency they show the way out. Staff
change them (POST /api/closures) with the key in NAVIKA_STAFF_KEY; without
that key set, nobody can change them.

State is one small JSON file (NAVIKA_CLOSURES_FILE, default
backend/closures_state.json, not committed), written atomically.
"""
from __future__ import annotations

import hmac
import json
import os
import tempfile
import time
from pathlib import Path

from flask import Blueprint, jsonify, request

closures_bp = Blueprint("closures", __name__)

DEFAULT_FILE = Path(__file__).resolve().parent / "closures_state.json"
MAX_CLOSURES = 50
MAX_TEXT = 120
TYPES = {"area", "shaft", "link"}


def _state_file() -> Path:
    return Path(os.environ.get("NAVIKA_CLOSURES_FILE", DEFAULT_FILE))


def _empty() -> dict:
    return {"schema_version": 1, "emergency": None, "closures": [], "updated_at": None}


def load_state() -> dict:
    try:
        return json.loads(_state_file().read_text())
    except (OSError, ValueError):
        return _empty()


def _text(value, field, required=False):
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > MAX_TEXT:
        raise ValueError(f"{field} must be text of 1-{MAX_TEXT} characters")
    return value.strip()


def _closure(item, index) -> dict:
    if not isinstance(item, dict) or item.get("type") not in TYPES:
        raise ValueError(f"closure {index}: type must be one of {sorted(TYPES)}")
    clean = {"id": _text(item.get("id"), f"closure {index} id", required=True), "type": item["type"]}
    if item["type"] == "area":
        floor = item.get("floor")
        if not (isinstance(floor, int) and not isinstance(floor, bool)) and not (isinstance(floor, str) and len(floor) <= 8):
            raise ValueError(f"closure {index}: floor must be a floor number or key such as 'R2'")
        xy = item.get("xy")
        if not (isinstance(xy, list) and len(xy) == 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) < 5000 for v in xy)):
            raise ValueError(f"closure {index}: xy must be [x, y] in metres")
        radius = item.get("radius_m", 4)
        if not isinstance(radius, (int, float)) or isinstance(radius, bool) or not 1 <= radius <= 25:
            raise ValueError(f"closure {index}: radius_m must be 1-25")
        clean.update(floor=floor, xy=[float(xy[0]), float(xy[1])], radius_m=float(radius))
    elif item["type"] == "shaft":
        clean["shaft"] = _text(item.get("shaft"), f"closure {index} shaft", required=True)
    else:
        clean["name"] = _text(item.get("name"), f"closure {index} name", required=True)
    for field in ("reason", "label"):
        value = _text(item.get(field), f"closure {index} {field}")
        if value:
            clean[field] = value
    return clean


def validate(body) -> dict:
    """The new state from a request body, or ValueError saying what is wrong."""
    if not isinstance(body, dict):
        raise ValueError("expected a JSON object")
    closures = body.get("closures", [])
    if not isinstance(closures, list) or len(closures) > MAX_CLOSURES:
        raise ValueError(f"closures must be a list of at most {MAX_CLOSURES}")
    emergency = body.get("emergency")
    if emergency is not None:
        if not isinstance(emergency, dict):
            raise ValueError("emergency must be null or {\"message\": ...}")
        emergency = {"message": _text(emergency.get("message"), "emergency message") or "Please leave the building by the nearest exit."}
    return {"schema_version": 1, "emergency": emergency,
            "closures": [_closure(item, index) for index, item in enumerate(closures)],
            "updated_at": int(time.time())}


def save_state(state: dict) -> None:
    target = _state_file()
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=target.parent, delete=False, suffix=".tmp") as handle:
        json.dump(state, handle, indent=1)
    os.replace(handle.name, target)


@closures_bp.route("/api/closures", methods=["GET"])
def get_closures():
    response = jsonify(load_state())
    response.headers["Cache-Control"] = "no-store"
    return response


@closures_bp.route("/api/closures", methods=["POST"])
def set_closures():
    key = os.environ.get("NAVIKA_STAFF_KEY", "")
    if not key:
        return jsonify({"error": "Changing closures is switched off: NAVIKA_STAFF_KEY is not set on the server."}), 403
    if not hmac.compare_digest(request.headers.get("X-Staff-Key", ""), key):
        return jsonify({"error": "Wrong staff key."}), 401
    try:
        state = validate(request.get_json(silent=True))
    except ValueError as problem:
        return jsonify({"error": str(problem)}), 400
    save_state(state)
    return jsonify(state)
