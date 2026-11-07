#!/usr/bin/env python3
"""Extract Ramanujan Floor 3 from its official DXF into the existing data schema."""
from __future__ import annotations

import json
import re
from pathlib import Path

import ezdxf
from extract_floor_walls import extract
from generate_floor_regions import boundary_coverage, inset_polygon, segment_distance

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "RAMANUJAN_3RD_FLOOR.dxf"
OUTPUT = ROOT / "public" / "data" / "Ramanujan_F3"
LABEL_POSITIONS = {
    # The source MTEXT anchors for the long north-side room row are displaced
    # west of their matching wall enclosures. These are the CAD room centers.
    "room_400": (692.0, 316.5),
    "room_401": (700.0, 316.5),
    "room_402": (708.5, 316.5),
    "room_403": (715.5, 316.5),
    "room_404": (724.0, 316.5),
    "room_406": (734.0, 316.5),
    "room_407": (744.0, 316.5),
    "room_409": (754.0, 316.5),
    "room_410": (764.0, 316.5),
}
ROOMS = {
    "400": ("CSE Department Library", "facility"),
    "401": ("S5/S6 CSE B", "classroom"),
    "402": ("Singularity Lab", "laboratory"),
    "403": ("S5/S6 Cyber Security", "classroom"),
    "404": ("S7/S8 CSE A", "classroom"),
    "405": ("CSE Staff Room 2", "facility"),
    "406": ("CSE Staff Room 1", "facility"),
    "407": ("Shannon Lab", "laboratory"),
    "408": ("FOSS Lab", "laboratory"),
    "409": ("Class Room - S3 CSE AI-B", "classroom"),
    "410": ("Elective Class Room", "classroom"),
    "411": ("Neumann Lab", "laboratory"),
}


def display_text(entity) -> str:
    raw = entity.plain_text() if entity.dxftype() == "MTEXT" else entity.dxf.text
    return " ".join(raw.replace("\\P", " ").split()).strip()


def build_semantics() -> dict:
    document = ezdxf.readfile(SOURCE)
    places = []
    connectors = {"stairs": [], "lift": []}
    for entity in document.modelspace().query("TEXT MTEXT"):
        text = display_text(entity)
        upper = text.upper()
        point = entity.dxf.insert
        room = re.match(r"^(40[0-9]|41[01])\b", text)
        if room and room.group(1) in ROOMS:
            number = room.group(1)
            dimensions = re.search(r"(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)", text)
            name, kind = ROOMS[number]
            place = {
                "id": f"room_{number}", "name": name, "type": kind,
                "cadX": round(point.x, 4), "cadY": round(point.y, 4),
                "roomNumber": number,
            }
            if dimensions:
                place["dimensions_m"] = [float(dimensions.group(1)), float(dimensions.group(2))]
            places.append(place)
        elif upper == "UP":
            connectors["stairs"].append((point.x, point.y))
        elif upper == "LIFT":
            connectors["lift"].append((point.x, point.y))
        elif upper in {"GENTS TOILET", "LADIES TOILET", "ELECTRICAL ROOM", "TOILET"}:
            place_id, kind = {
                "GENTS TOILET": ("gents_toilet", "toilet"),
                "LADIES TOILET": ("ladies_toilet", "toilet"),
                "ELECTRICAL ROOM": ("electrical_room", "facility"),
                "TOILET": ("toilet_3f", "toilet"),
            }[upper]
            places.append({"id": place_id, "name": text.title(), "type": kind,
                           "cadX": round(point.x, 4), "cadY": round(point.y, 4)})

    for connector_type, points in connectors.items():
        for index, (x, y) in enumerate(sorted(points), 1):
            letter = chr(ord("A") + index - 1)
            is_stair = connector_type == "stairs"
            places.append({
                "id": f"{'staircase' if is_stair else 'lift'}_{letter.lower()}",
                "name": f"{'Staircase' if is_stair else 'Lift'} {letter}",
                "type": "staircase" if is_stair else "vertical_transport",
                "cadX": round(x, 4), "cadY": round(y, 4),
            })
    places.sort(key=lambda place: (place.get("roomNumber", "999"), place["id"]))
    for place in places:
        label_position = LABEL_POSITIONS.get(place["id"])
        if label_position:
            place["labelCadX"], place["labelCadY"] = label_position
    return {
        "floor": "3",
        "source": "data/RAMANUJAN_3RD_FLOOR.dxf",
        "coordinate_system": "CAD XY (source drawing units; plan labels show dimensions in metres)",
        "places": places,
    }


def build_regions(semantics: dict, walls: dict) -> tuple[dict, dict]:
    accepted, excluded = [], {}
    for place in semantics["places"]:
        dimensions = place.get("dimensions_m")
        if not dimensions:
            continue
        width, height = dimensions
        bounds = (
            place["cadX"] - width / 2, place["cadX"] + width / 2,
            place["cadY"] - height / 2, place["cadY"] + height / 2,
        )
        coverage = boundary_coverage(walls["walls"], bounds)
        if min(coverage) < 0.05 or sum(coverage) / 4 < 0.65:
            excluded[place["id"]] = f"Insufficient wall support: {[round(value, 3) for value in coverage]}"
            continue
        accepted.append({"semantic_id": place["id"], "polygon": inset_polygon(bounds),
                         "wall_edge_coverage": [round(value, 3) for value in coverage]})

    regions = [
        {"semantic_id": place["semantic_id"], "polygon": place["polygon"]}
        for place in accepted
    ]
    region_data = {
        "floor": "3", "coordinate_system": "CAD XY", "surface_elevation": 0.006,
        "floor_inset": 0.18, "regions": regions,
        "neutral_fallback_ids": sorted({place["id"] for place in semantics["places"]}
                                        - {place["semantic_id"] for place in accepted}),
    }
    report = {
        "wall_support_tolerance": 0.35, "floor_inset": 0.18,
        "matched_regions": [{"semantic_id": item["semantic_id"],
                             "wall_edge_coverage": item["wall_edge_coverage"]} for item in accepted],
        "excluded_regions": excluded,
        "neutral_fallback_ids": region_data["neutral_fallback_ids"],
    }
    return region_data, report


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    _document, walls = extract(SOURCE, OUTPUT / "walls.json", (670, 287, 776, 323), 0.001, "3")
    semantics = build_semantics()
    (OUTPUT / "semantics.json").write_text(json.dumps(semantics, indent=2) + "\n")
    regions, report = build_regions(semantics, walls)
    (OUTPUT / "floor_regions.json").write_text(json.dumps(regions, indent=2) + "\n")
    (ROOT / "inspection_navigation" / "floor3_regions_validation.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    print(json.dumps({
        "source": "data/RAMANUJAN_3RD_FLOOR.dxf",
        "wall_segments": len(walls["walls"]),
        "semantic_places": len(semantics["places"]),
        "room_regions": len(regions["regions"]),
        "unsupported_room_regions": len(report["excluded_regions"]),
    }, indent=2))


if __name__ == "__main__":
    main()
