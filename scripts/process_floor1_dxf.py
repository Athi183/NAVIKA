#!/usr/bin/env python3
"""Extract Ramanujan Floor 1 from its official DXF into the existing data schema."""
from __future__ import annotations

import json
import re
from pathlib import Path

import ezdxf
from extract_floor_walls import extract

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "RAMANUJAN_1ST_FLOOR.dxf"
OUTPUT = ROOT / "public" / "data" / "Ramanujan_F1"
LABEL_POSITIONS = {
    # Center the wrapped label within the narrow System Admin room.
    "system_admin_s_room": (855.8, 244.5),
}


def clean_text(entity) -> str:
    raw = entity.plain_text() if entity.dxftype() == "MTEXT" else entity.dxf.text
    return " ".join(raw.replace("\\P", " ").split()).strip(" ()")


def place_type(name: str) -> str:
    upper = name.upper()
    if "TOILET" in upper:
        return "toilet"
    if "LAB" in upper:
        return "laboratory"
    if "CLASS ROOM" in upper or "CONFERENCE" in upper or "HALL" in upper:
        return "classroom"
    if "DEPARTMENT" in upper:
        return "department"
    if "PASSAGE" in upper:
        return "corridor"
    if "ELECTRICAL" in upper:
        return "facility"
    if "VACANT" in upper:
        return "vacant"
    return "facility"


def build_semantics() -> dict:
    document = ezdxf.readfile(SOURCE)
    places = []
    stairs, lifts = [], []
    for entity in document.modelspace().query("TEXT MTEXT"):
        text = clean_text(entity)
        if not text:
            continue
        upper = text.upper()
        point = entity.dxf.insert
        if upper == "UP":
            stairs.append((point.x, point.y))
            continue
        if upper == "LIFT":
            lifts.append((point.x, point.y))
            continue
        if upper in {"FIRST FLOOR", "ROOM"}:
            continue
        if upper.startswith("AREA =") or re.fullmatch(r"\d+(?:\.\d+)?\s*SQ\.?\s*M", upper):
            continue
        name = "Server Room" if upper == "SERVER" else re.sub(r"^\d+\s+", "", text).strip()
        if upper == "VACANT":
            name = "Vacant Room"
        slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "place"
        place = {"id": slug, "name": name, "type": place_type(name),
                 "cadX": round(point.x, 4), "cadY": round(point.y, 4),
                 "source_text": text}
        if slug in LABEL_POSITIONS:
            place["labelCadX"], place["labelCadY"] = LABEL_POSITIONS[slug]
        places.append(place)

    for kind, points in (("stairs", stairs), ("lift", lifts)):
        for index, (x, y) in enumerate(sorted(points), 1):
            letter = chr(ord("A") + index - 1)
            is_stair = kind == "stairs"
            places.append({
                "id": f"{'staircase' if is_stair else 'lift'}_{letter.lower()}",
                "name": f"{'Staircase' if is_stair else 'Lift'} {letter}",
                "type": "staircase" if is_stair else "vertical_transport",
                "cadX": round(x, 4), "cadY": round(y, 4),
                "source_text": "UP" if is_stair else "LIFT",
            })
    counts = {}
    for place in places:
        base = place["id"]
        counts[base] = counts.get(base, 0) + 1
        if counts[base] > 1:
            place["id"] = f"{base}_{counts[base]}"
    places.sort(key=lambda place: place["id"])
    return {
        "floor": "1", "source": "data/RAMANUJAN_1ST_FLOOR.dxf",
        "coordinate_system": "CAD XY (DXF source units)", "places": places,
    }


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    document = ezdxf.readfile(SOURCE)
    points = []
    for entity in document.modelspace():
        if entity.dxftype() == "LINE":
            points.extend((entity.dxf.start, entity.dxf.end))
        elif entity.dxftype() == "LWPOLYLINE":
            points.extend(entity.get_points("xy"))
        elif entity.dxftype() == "POLYLINE":
            points.extend(vertex.dxf.location for vertex in entity.vertices)
    bounds = (min(point[0] for point in points) - 1, min(point[1] for point in points) - 1,
              max(point[0] for point in points) + 1, max(point[1] for point in points) + 1)
    _doc, walls = extract(SOURCE, OUTPUT / "walls.json", bounds, 0.001, "1")
    semantics = build_semantics()
    (OUTPUT / "semantics.json").write_text(json.dumps(semantics, indent=2) + "\n")
    (OUTPUT / "floor_regions.json").write_text(json.dumps({
        "floor": "1", "coordinate_system": "CAD XY", "surface_elevation": 0.006,
        "floor_inset": 0.18, "regions": [],
        "neutral_fallback_ids": sorted(place["id"] for place in semantics["places"]),
    }, indent=2) + "\n")
    print(json.dumps({"source": "data/RAMANUJAN_1ST_FLOOR.dxf",
                      "wall_segments": len(walls["walls"]),
                      "semantic_places": len(semantics["places"]),
                      "plan_bounds": bounds}, indent=2))


if __name__ == "__main__":
    main()
