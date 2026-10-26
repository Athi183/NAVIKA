"""Structured lookup over the DXF-derived semantic, geometry, and topology CSVs."""
from __future__ import annotations

import csv
import re
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data/spatial/ramanujan_block"
CAMPUS_DATA_DIR = Path(__file__).resolve().parent / "data/spatial/varnam_college"


def read_rows(filename: str) -> list[dict[str, str]]:
    path = DATA_DIR / filename
    if not path.is_file():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def read_campus_rows(filename: str) -> list[dict[str, str]]:
    path = CAMPUS_DATA_DIR / filename
    if not path.is_file():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def search_places(query: str, floor_number: int | None = None) -> list[dict[str, str]]:
    needle = " ".join(query.casefold().split())
    if not needle:
        return []
    rows = read_rows("places.csv")
    results = []
    for row in rows:
        if floor_number is not None and row["floor_number"] != str(floor_number):
            continue
        text = " ".join((row.get("display_name", "") + " " + row.get("room_number", "")).casefold().split())
        if needle in text:
            results.append(row)
    return results


def geometry_in_bbox(floor_number: int, min_x: float, min_y: float, max_x: float, max_y: float) -> list[dict[str, str]]:
    """Return extracted line segments whose bounds overlap a registered-plan bbox."""
    if min_x > max_x or min_y > max_y:
        raise ValueError("Bounding-box minima must not exceed maxima")
    matches = []
    for row in read_rows("geometry.csv"):
        if row["floor_number"] != str(floor_number):
            continue
        x1, y1, x2, y2 = (float(row[key]) for key in ("x1", "y1", "x2", "y2"))
        if max(x1, x2) >= min_x and min(x1, x2) <= max_x and max(y1, y2) >= min_y and min(y1, y2) <= max_y:
            matches.append(row)
    return matches


def candidate_vertical_paths(from_floor: int, to_floor: int) -> list[dict]:
    """Return connector candidates with consecutive CSV edges covering the floor range."""
    if from_floor == to_floor:
        return []
    low, high = sorted((from_floor, to_floor))
    rows = read_rows("topology_edges.csv")
    by_connector: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        by_connector.setdefault(row["connector_id"], []).append(row)
    results = []
    for connector_id, edges in by_connector.items():
        ordered = sorted(edges, key=lambda edge: int(edge["from_floor"]))
        needed = list(range(low, high))
        by_transition = {int(edge["from_floor"]): edge for edge in ordered}
        if all(
            floor in by_transition and int(by_transition[floor]["to_floor"]) == floor + 1
            for floor in needed
        ):
            selected = [by_transition[floor] for floor in needed]
            if from_floor > to_floor:
                selected = list(reversed(selected))
            results.append({
                "connector_id": connector_id,
                "label": selected[0]["connector_label"],
                "type": selected[0]["edge_type"].replace("candidate_", "").replace("_floor_transition", ""),
                "status": "candidate_requires_landing_and_continuity_review",
                "edges": selected,
                "estimated_distance_m": sum(float(edge.get("estimated_distance_m") or 0) for edge in selected),
                "estimated_time_s_without_wait": sum(
                    float(edge.get("estimated_time_s_up_without_wait" if from_floor < to_floor else "estimated_time_s_down_without_wait") or 0)
                    for edge in selected
                ),
                "lift_wait_s_once_per_trip": float(selected[0].get("lift_wait_s_once_per_trip_assumption") or 0),
                "time_cost_status": selected[0].get("time_cost_status", "not_available"),
            })
    return results


_FLOOR_WORDS = {
    "second": 2, "2nd": 2, "third": 3, "3rd": 3,
    "fourth": 4, "4th": 4, "fifth": 5, "5th": 5,
    "sixth": 6, "6th": 6,
}

_ORDINAL_FLOORS = "|".join(_FLOOR_WORDS)


def spatial_context_for_question(question: str) -> str:
    """Create grounded context for direct place, floor-link, or coordinate questions."""
    lower = question.casefold()
    contexts = []
    places = read_rows("places.csv")
    campus_places = read_campus_rows("places.csv")
    campus_mentioned = []
    for row in campus_places:
        name = " ".join(row.get("display_name", "").casefold().split())
        if len(name) >= 4 and name in lower:
            campus_mentioned.append(row)
    seen_campus_names = set()
    for row in campus_mentioned:
        name = row["display_name"]
        folded = name.casefold()
        if folded in seen_campus_names:
            continue
        seen_campus_names.add(folded)
        contexts.append(
            f"Varnam campus-site DXF label candidate: {name} ({row['category']}); "
            f"CAD anchor x={row['source_x']}, y={row['source_y']} {row['source_units']}; "
            f"source layer={row['source_layer']}; review status={row['review_status']}. "
            "This is a text anchor, not a surveyed building footprint or entrance, and it is not connected to indoor route edges."
        )
    mentioned = []
    for row in places:
        name = row["display_name"].casefold().strip()
        room_number = row.get("room_number", "")
        if (len(name) >= 4 and name in lower) or (room_number and re.search(rf"(?<!\d){re.escape(room_number)}(?!\d)", lower)):
            mentioned.append(row)
    for row in mentioned[:5]:
        contexts.append(
            f"DXF extracted place candidate: {row['display_name']} ({row['floor_id']}, floor {row['floor_number']}); "
            f"registered plan anchor x={row['registered_x']}, y={row['registered_y']} {row['source_units']}; "
            f"visualization anchor x={row.get('display_x', row['registered_x'])}, y={row.get('display_y', row['registered_y'])} "
            f"({row.get('display_xy_status', 'same_as_extracted_anchor')}); "
            f"original DXF text anchor x={row['source_x']}, y={row['source_y']}; "
            f"review status={row['review_status']}. This text anchor is not a verified room boundary or entrance."
        )

    floor_pair = None
    route_triggers = list(re.finditer(r"\b(?:from|between|connect(?:s|ed|ion)?|route|link)\b", lower))
    if route_triggers:
        route_fragment = lower[route_triggers[-1].start():]
        tokens = re.finditer(rf"\b({_ORDINAL_FLOORS}|[2-6])(?:\s+floor)?\b", route_fragment)
        numbers = []
        for match in tokens:
            token = match.group(1)
            number = _FLOOR_WORDS.get(token, int(token) if token.isdigit() else None)
            if number is not None and number not in numbers:
                numbers.append(number)
        if len(numbers) >= 2:
            floor_pair = (numbers[0], numbers[1])
    if floor_pair:
        connector_candidates = candidate_vertical_paths(*floor_pair)
        if "lift" in lower and "stair" not in lower:
            connector_candidates = [item for item in connector_candidates if item["type"] == "lift"]
        elif "stair" in lower:
            connector_candidates = [item for item in connector_candidates if item["type"] == "stair"]
        for candidate in connector_candidates:
            vertical_seconds = candidate["estimated_time_s_without_wait"] + candidate["lift_wait_s_once_per_trip"]
            contexts.append(
                f"Candidate vertical connector: {candidate['label']} ({candidate['type']}) between floors "
                f"{floor_pair[0]} and {floor_pair[1]}; status={candidate['status']}. "
                f"Illustrative vertical-only estimate: about {vertical_seconds / 60:.1f} minutes for {candidate['estimated_distance_m']:.1f}m; "
                f"estimated_cost_status={candidate['time_cost_status']}. This excludes room-to-corridor walking and uses one lift wait per trip. "
                "This is not a verified pedestrian route."
            )

    single_floor = None
    floor_match = re.search(rf"\b({_ORDINAL_FLOORS})\s+floor\b|\bfloors?\s*([2-6])\b", lower)
    if floor_match:
        token = next(group for group in floor_match.groups() if group is not None)
        single_floor = _FLOOR_WORDS.get(token, int(token) if token.isdigit() else None)

    coordinates = re.search(r"\bx\s*[=:]\s*(-?\d+(?:\.\d+)?)\D+\by\s*[=:]\s*(-?\d+(?:\.\d+)?)", lower)
    if coordinates:
        x, y = float(coordinates.group(1)), float(coordinates.group(2))
        floor = floor_pair[0] if floor_pair else (single_floor or (int(mentioned[0]["floor_number"]) if mentioned else None))
        if floor is not None:
            matches = geometry_in_bbox(floor, x - 1, y - 1, x + 1, y + 1)
            contexts.append(
                f"DXF geometry lookup near registered coordinate x={x:g}, y={y:g} on floor {floor}: "
                f"{len(matches)} unclassified line segments intersect a +/-1 {places[0]['source_units'] if places else 'drawing-unit'} box. "
                "Segments are raw visual linework and are not validated as walls, doors, or walkable areas."
            )
    return "\n".join(contexts)
