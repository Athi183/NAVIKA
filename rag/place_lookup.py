"""Deterministic matching against the current kiosk destination catalog."""
from __future__ import annotations

import difflib
import re
import sqlite3
from pathlib import Path

try:
    from .build_place_index import DATABASE_PATH
except ImportError:
    from build_place_index import DATABASE_PATH

NEAREST_TOILET = {
    "place_id": "nearest-toilet",
    "name": "Nearest toilet",
    "category": "toilet",
    "building": "M. George Block",
    "floor_name": "Nearest available toilet",
    "room_no": None,
    "step_free": 1,
}


def _normalize(value: str) -> str:
    return " ".join(re.sub(r"[^\w\s&/-]", " ", value.casefold()).split())


def _whole_word(needle: str, haystack: str) -> bool:
    return bool(re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", haystack, re.IGNORECASE))


def find_places(question: str, database_path: Path = DATABASE_PATH) -> list[dict]:
    query = _normalize(question or "")
    if not query or not database_path.is_file():
        return []
    with sqlite3.connect(database_path) as connection:
        connection.row_factory = sqlite3.Row
        places = [dict(row) for row in connection.execute("SELECT * FROM places")]
        aliases = [dict(row) for row in connection.execute("SELECT * FROM aliases")]

    # An exact three-digit room/PDF number is the strongest signal.
    number = re.search(r"(?<!\d)(\d{3})(?!\d)", query)
    if number:
        matches = [place for place in places if place.get("room_no") == number.group(1)]
        if matches:
            return matches[:3]

    alias_matches = [item for item in aliases if _whole_word(item["alias"], query)]
    alias_matches.sort(key=lambda item: len(item["alias"]), reverse=True)
    for alias in alias_matches:
        if alias["place_id"]:
            target = next((place for place in places if place["place_id"] == alias["place_id"]), None)
            if target:
                return [target]
        if alias["category"] == "toilet":
            return [NEAREST_TOILET.copy()]
        if alias["category"]:
            category_matches = [place for place in places if place["category"] == alias["category"]]
            if category_matches:
                return category_matches[:3]

    named = [place for place in places if _whole_word(_normalize(place["name"]), query)]
    named.sort(key=lambda place: len(_normalize(place["name"])), reverse=True)
    if named:
        return named[:3]

    # Compare meaningful query tokens individually so a misspelling in a
    # longer question ("where is the libary") can still match a name/alias.
    ignored = {"where", "is", "the", "in", "on", "at", "find", "show", "me", "way", "to", "how", "do", "i", "get", "room", "please"}
    tokens = [token for token in re.findall(r"[\w&/-]+", query) if token not in ignored and len(token) >= 4]
    candidate_terms = {}
    for place in places:
        candidate_terms.setdefault(_normalize(place["name"]), place)
    for alias in aliases:
        if alias["place_id"]:
            place = next((item for item in places if item["place_id"] == alias["place_id"]), None)
            if place:
                candidate_terms[alias["alias"]] = place
    for token in tokens:
        close = difflib.get_close_matches(token, list(candidate_terms), n=3, cutoff=0.8)
        if close:
            found = []
            for candidate in close:
                place = candidate_terms[candidate]
                if place not in found:
                    found.append(place)
            found.sort(key=lambda place: len(_normalize(place["name"])), reverse=True)
            return found[:3]
    return []


def format_place_context(places: list[dict]) -> str:
    facts = []
    for place in places:
        if place["place_id"] == "nearest-toilet":
            facts.append("A washroom request can be routed to the nearest toilet selected by the kiosk navigation system.")
            continue
        facts.append(
            f"{place['name']} is on the {place['floor_name']} of {place['building']}"
            + (", the same floor as the kiosk." if place["building"] == "M. George Block" and place["floor_key"] == "1" else ".")
        )
    return "\n".join(facts)
