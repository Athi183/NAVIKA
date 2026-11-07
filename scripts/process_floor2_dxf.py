#!/usr/bin/env python3
"""Extract Ramanujan Floor 2 from its official DXF into the existing data schema."""
from __future__ import annotations

import json
import re
from pathlib import Path

import ezdxf
from extract_floor_walls import extract
from generate_floor_regions import boundary_coverage, inset_polygon

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "RAMANUJAN_2ND_FLOOR_REAL.dxf"
OUTPUT = ROOT / "public" / "data" / "Ramanujan_F2"
LABEL_POSITIONS = {
    # Corrected from source text insertion points to usable room interior anchors.
    "room_305": (742.5, 245.8),
    "eee_department_library": (747.2, 250.0),
    "simulation_lab": (747.2, 244.2),
    "microprocessor_microcontrollor_lab": (756.5, 245.8),
    "michael_faraday_hall": (768.3,245.9),
    "electrical_measurements_lab": (781.3, 242.9),
    "steve_jobs_hall": (792.5, 242.9),
    "staff_cabin": (761.0, 250.0),
    "class_room_m_tech_cy_s1_s2": (801.3, 242.9),
    "codd_base_lab": (810.8, 242.9),
    "grace_hopper_lab": (803.5, 225.5),
    "ceaser_lab": (813.0, 224.0),
    "staff_cabin_2": (806.0, 219.2),
}


def display_text(entity) -> str:
    raw = entity.plain_text() if entity.dxftype() == "MTEXT" else entity.dxf.text
    return " ".join(raw.replace("\\P", " ").split()).strip()


def semantic_name(text: str) -> tuple[str, str]:
    name = re.sub(r"\s+(?:\d+(?:\.\d+)?\s*[xX×]\s*\d+(?:\.\d+)?).*$", "", text).strip(" -\n")
    name = re.sub(r"\s+\d+(?:\.\d+)?\s*(?:m²|m2|sq\.?\s*ft).*$", "", name, flags=re.I).strip()
    upper = name.upper()
    if "TOILET" in upper:
        kind = "toilet"
    elif "LAB" in upper:
        kind = "laboratory"
    elif "HALL" in upper or "CLASS ROOM" in upper:
        kind = "classroom"
    elif "DEPARTMENT" in upper or "DEPT" in upper:
        kind = "department"
    else:
        kind = "facility"
    name = re.sub(r"^301\s+", "", name, flags=re.I).strip()
    return name.title() if name.isupper() else name, kind


def build_semantics() -> dict:
    document = ezdxf.readfile(SOURCE)
    places = []
    connectors = {"stairs": [], "lift": []}
    association_room = None
    room_number_305 = None
    for entity in document.modelspace().query("TEXT MTEXT"):
        text = display_text(entity)
        upper = text.upper()
        point = entity.dxf.insert
        if upper in {"UP", "LIFT"}:
            connectors["stairs" if upper == "UP" else "lift"].append((point.x, point.y))
            continue
        if upper in {"SECOND FLOOR", "CONNECTION BRIDGE TO RAMANUJAN BLOCK 3.08 M WIDE"}:
            continue
        if re.fullmatch(r"305", text):
            room_number_305 = (point.x, point.y)
            continue
        if not text:
            continue
        name, kind = semantic_name(text)
        if re.match(r"^301\b", text):
            name = "CSE Department"
        if "ASSOCIATION ROOM" in upper:
            association_room = {
                "id": "room_305", "name": name, "type": kind,
                "cadX": round(point.x, 4), "cadY": round(point.y, 4), "roomNumber": "305",
            }
            places.append(association_room)
            continue
        room_match = re.match(r"^(301)\b", text)
        place_id = "room_301" if room_match else re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
        place = {"id": place_id, "name": name, "type": kind,
                 "cadX": round(point.x, 4), "cadY": round(point.y, 4)}
        if room_match:
            place["roomNumber"] = room_match.group(1)
        dimensions = re.search(r"(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)", text)
        if dimensions:
            place["dimensions_m"] = [float(dimensions.group(1)), float(dimensions.group(2))]
        places.append(place)

    if association_room and room_number_305:
        association_room["cadX"], association_room["cadY"] = map(lambda value: round(value, 4), room_number_305)
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

    # The plan prints department and library as separate stacked labels for one place.
    department = next((place for place in places if place["id"] == "eee_department"), None)
    library = next((place for place in places if place["id"] == "library"), None)
    if department and library:
        places.remove(department)
        library["id"] = "eee_department_library"
        library["name"] = "EEE Department Library"
        library["type"] = "department"

    counts = {}
    for place in places:
        base_id = place["id"]
        counts[base_id] = counts.get(base_id, 0) + 1
        if counts[base_id] > 1:
            place["id"] = f"{base_id}_{counts[base_id]}"
    for place in places:
        label_position = LABEL_POSITIONS.get(place["id"])
        if label_position:
            place["labelCadX"], place["labelCadY"] = label_position
    places.sort(key=lambda place: (place.get("roomNumber", "999"), place["id"]))
    return {
        "floor": "2", "source": "data/RAMANUJAN_2ND_FLOOR_REAL.dxf",
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
        bounds = (place["cadX"] - width / 2, place["cadX"] + width / 2,
                  place["cadY"] - height / 2, place["cadY"] + height / 2)
        coverage = boundary_coverage(walls["walls"], bounds)
        if min(coverage) < 0.05 or sum(coverage) / 4 < 0.65:
            excluded[place["id"]] = f"Insufficient wall support: {[round(value, 3) for value in coverage]}"
            continue
        accepted.append({"semantic_id": place["id"], "polygon": inset_polygon(bounds),
                         "wall_edge_coverage": [round(value, 3) for value in coverage]})
    fallback = sorted({place["id"] for place in semantics["places"]}
                      - {place["semantic_id"] for place in accepted})
    regions = {"floor": "2", "coordinate_system": "CAD XY", "surface_elevation": 0.006,
               "floor_inset": 0.18,
               "regions": [{"semantic_id": item["semantic_id"], "polygon": item["polygon"]}
                           for item in accepted],
               "neutral_fallback_ids": fallback}
    report = {"wall_support_tolerance": 0.35, "floor_inset": 0.18,
              "matched_regions": [{"semantic_id": item["semantic_id"],
                                   "wall_edge_coverage": item["wall_edge_coverage"]} for item in accepted],
              "excluded_regions": excluded, "neutral_fallback_ids": fallback}
    return regions, report


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    document = ezdxf.readfile(SOURCE)
    points = []
    for entity in document.modelspace():
        if entity.dxftype() == "LINE":
            points.extend((entity.dxf.start, entity.dxf.end))
        elif entity.dxftype() == "LWPOLYLINE":
            points.extend(entity.get_points("xy"))
    bounds = (min(point[0] for point in points) - 1, min(point[1] for point in points) - 1,
              max(point[0] for point in points) + 1, max(point[1] for point in points) + 1)
    _doc, walls = extract(SOURCE, OUTPUT / "walls.json", bounds, 0.001, "2")
    # The connection bridge at the east side must remain open to the adjacent
    # Ramanujan Block. Close only the unrelated west-side perimeter gap.
    perimeter_closures = [
        ("WALL_DERIVED_OUTLINE_002", 757.170, 231.409, 757.170, 236.509),
    ]
    for wall_id, x1, y1, x2, y2 in perimeter_closures:
        walls["walls"].append({
            "id": wall_id,
            "type": "line_wall",
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
            "length": round(((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5, 6),
            "source_segments": 0,
            "derived_from": "floor_2_outer_outline_gap_closure",
        })
    walls["geometry_summary"]["source_wall_segment_count"] = walls["geometry_summary"]["wall_segment_count"]
    walls["geometry_summary"]["wall_segment_count"] = len(walls["walls"])
    walls["geometry_summary"]["derived_perimeter_closure_count"] = len(perimeter_closures)
    (OUTPUT / "walls.json").write_text(json.dumps(walls, indent=2) + "\n")
    semantics = build_semantics()
    (OUTPUT / "semantics.json").write_text(json.dumps(semantics, indent=2) + "\n")
    regions, report = build_regions(semantics, walls)
    (OUTPUT / "floor_regions.json").write_text(json.dumps(regions, indent=2) + "\n")
    (ROOT / "inspection_navigation" / "floor2_regions_validation.json").write_text(
        json.dumps(report, indent=2) + "\n")
    print(json.dumps({"source": "data/RAMANUJAN_2ND_FLOOR_REAL.dxf",
                      "wall_segments": len(walls["walls"]), "semantic_places": len(semantics["places"]),
                      "room_regions": len(regions["regions"]),
                      "unsupported_room_regions": len(report["excluded_regions"]),
                      "plan_bounds": bounds}, indent=2))


if __name__ == "__main__":
    main()
