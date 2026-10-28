"""Create semantic floor polygons only where wall-enclosure evidence is strong."""

import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_INSET = 0.18
WALL_TOLERANCE = 0.35

# Floor 4 room dimensions come from the wall-measured layout used for its
# adaptive labels. Each candidate is additionally checked against walls.json.
FLOOR4_ROOM_SIZES = {
    "room_501": (17, 10.8),
    "room_502": (10.5, 10.8),
    "room_503": (6, 10.8),
    "room_504": (10.5, 11.7),
    "room_505": (8.2, 11.7),
    "room_506": (10.6, 11.8),
    "room_507": (10.6, 11.8),
    "room_508": (11, 10.9),
    "room_509": (6.5, 10.9),
    "room_510": (9, 10.8),
    "room_511": (3, 10.8),
    "room_512": (10.5, 10.8),
    "staircase_west": (3, 8),
}

# Floor 5 bounds are taken from the DXF enclosure audit, with the lower-row
# partitions corrected to the extracted wall faces.
FLOOR5_BOUNDS = {
    "room_601": (955.13, 967.09, 223.07, 233.86),
    "room_603": (967.33, 978.87, 223.07, 233.86),
    "room_604": (979.10, 988.83, 223.07, 233.86),
    "room_605": (989.01, 998.59, 201.69, 213.45),
    "room_606": (998.83, 1008.12, 201.49, 213.45),
    "room_607": (1008.37, 1018.50, 201.49, 213.45),
    "room_608": (1018.50, 1028.80, 201.49, 213.45),
    "room_609": (1023.20, 1028.77, 220.16, 229.33),
    "room_610": (1013.58, 1023.20, 220.16, 231.10),
    "room_611_612": (1000.73, 1013.58, 220.16, 231.10),
    "room_613": (988.95, 1000.49, 220.31, 231.10),
    "ladies_toilet": (952.10, 955.10, 221.90, 227.00),
    "toilet": (992.20, 996.10, 200.05, 201.65),
    "lift": (1031.93, 1033.74, 214.68, 216.83),
    "electrical_room": (972.50, 980.40, 217.00, 220.00),
    # Enclosed lift bay between Room 605 and Staircase B.
    "lift_b": (980.501, 983.242, 211.031, 213.495),
    "staircase_west": (949.00, 952.30, 218.70, 227.00),
    "staircase_east": (1028.80, 1033.80, 204.00, 213.70),
}

# Floor 6 rectangles follow the CAD wall faces. Small openings on a single
# edge are treated as door thresholds; the remaining edges must still match.
FLOOR6_BOUNDS = {
    "excel_hall": (10617.18, 10650.75, 2033.50, 2044.40),
    # The electrical room is the enclosed bay below the corridor wall at Y=2030.
    "electrical_room": (10634.166, 10641.109, 2027.692, 2030.0),
    "room_703": (10651.07, 10658.20, 2030.76, 2041.65),
    "room_704": (10658.44, 10669.37, 2030.57, 2041.65),
    "room_705": (10669.60, 10681.44, 2030.57, 2041.65),
    "room_706": (10681.78, 10690.83, 2030.57, 2041.65),
    "room_707": (10680.54, 10690.83, 2011.93, 2023.95),
    "room_708": (10669.04, 10680.54, 2011.93, 2023.95),
    # Use the actual west wall; the previous bound started well inside the room.
    "room_709": (10651.14, 10668.79, 2011.93, 2023.95),
    # Small enclosed lift bay beside Room 709, bounded by the extracted walls.
    "lift_middle": (10642.548, 10645.281, 2021.462, 2023.926),
    "ladies_toilet": (10614.28, 10616.94, 2033.50, 2037.18),
    "lift": (10693.97, 10695.78, 2025.12, 2027.27),
    "staircase_left": (10611.41, 10614.07, 2029.10, 2037.18),
    "staircase_middle": (10638.74, 10642.30, 2022.50, 2027.69),
    "staircase_right": (10690.83, 10695.78, 2014.52, 2024.17),
}


def segment_distance(px: float, py: float, wall: dict) -> float:
    ax, ay, bx, by = (wall[key] for key in ("x1", "y1", "x2", "y2"))
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def boundary_coverage(walls: list[dict], bounds: tuple[float, float, float, float]) -> list[float]:
    min_x, max_x, min_y, max_y = bounds
    sides = (
        ("vertical", min_x, min_y, max_y),
        ("vertical", max_x, min_y, max_y),
        ("horizontal", min_y, min_x, max_x),
        ("horizontal", max_y, min_x, max_x),
    )
    coverage = []
    for orientation, coordinate, start, end in sides:
        count = max(12, int((end - start) / 0.1))
        supported = 0
        for index in range(count):
            along = start + (index + 0.5) * (end - start) / count
            distance = min(
                segment_distance(coordinate, along, wall)
                if orientation == "vertical"
                else segment_distance(along, coordinate, wall)
                for wall in walls
            )
            if distance <= WALL_TOLERANCE:
                supported += 1
        coverage.append(supported / count)
    return coverage


def bounds_for_floor(floor: int, places: list[dict]) -> dict[str, tuple[float, float, float, float]]:
    if floor == 4:
        result = {}
        for place_id, (width, height) in FLOOR4_ROOM_SIZES.items():
            place = next((item for item in places if item["id"] == place_id), None)
            if place is None:
                continue
            result[place_id] = (
                place["cadX"] - width / 2,
                place["cadX"] + width / 2,
                place["cadY"] - height / 2,
                place["cadY"] + height / 2,
            )
        return result
    if floor == 5:
        return FLOOR5_BOUNDS
    if floor == 6:
        return FLOOR6_BOUNDS
    return {}


def inset_polygon(bounds: tuple[float, float, float, float]) -> list[list[float]]:
    min_x, max_x, min_y, max_y = bounds
    return [
        [min_x + OUTPUT_INSET, min_y + OUTPUT_INSET],
        [max_x - OUTPUT_INSET, min_y + OUTPUT_INSET],
        [max_x - OUTPUT_INSET, max_y - OUTPUT_INSET],
        [min_x + OUTPUT_INSET, max_y - OUTPUT_INSET],
    ]


def main() -> None:
    report = {"wall_support_tolerance": WALL_TOLERANCE, "floor_inset": OUTPUT_INSET, "floors": {}}
    for floor in range(3, 7):
        directory = ROOT / "public" / "data" / f"Ramanujan_F{floor}"
        walls = json.loads((directory / "walls.json").read_text())
        semantics_text = (directory / "semantics.json").read_text()
        semantics = json.loads(semantics_text) if semantics_text.strip() else {"places": []}
        places = semantics.get("places", [])
        by_id = {place["id"]: place for place in places}
        candidate_bounds = bounds_for_floor(floor, places)
        accepted = []
        excluded = {}
        for place_id, bounds in candidate_bounds.items():
            place = by_id.get(place_id)
            if place is None:
                excluded[place_id] = "No matching semantic place"
                continue
            x1, x2, y1, y2 = bounds
            if not (x1 < place["cadX"] < x2 and y1 < place["cadY"] < y2):
                excluded[place_id] = "Semantic point is outside the candidate enclosure"
                continue
            coverage = boundary_coverage(walls["walls"], bounds)
            if min(coverage) < 0.05 or sum(coverage) / 4 < 0.65:
                excluded[place_id] = f"Insufficient wall support: {[round(value, 3) for value in coverage]}"
                continue
            accepted.append({
                "semantic_id": place_id,
                "polygon": inset_polygon(bounds),
                "wall_edge_coverage": [round(value, 3) for value in coverage],
            })

        # Reject intersecting regions instead of allowing one semantic floor
        # color to cover a neighbouring room.
        rejected_overlap = set()
        for i, first in enumerate(accepted):
            for second in accepted[i + 1:]:
                a, b = first["polygon"], second["polygon"]
                overlap_x = min(max(p[0] for p in a), max(p[0] for p in b)) - max(min(p[0] for p in a), min(p[0] for p in b))
                overlap_y = min(max(p[1] for p in a), max(p[1] for p in b)) - max(min(p[1] for p in a), min(p[1] for p in b))
                if overlap_x > 0.02 and overlap_y > 0.02:
                    rejected_overlap.update((first["semantic_id"], second["semantic_id"]))
        if rejected_overlap:
            for place_id in rejected_overlap:
                excluded[place_id] = "Candidate floor polygon overlaps another semantic region"
            accepted = [item for item in accepted if item["semantic_id"] not in rejected_overlap]

        output = {
            "floor": str(floor),
            "coordinate_system": "CAD XY",
            "surface_elevation": 0.006,
            "floor_inset": OUTPUT_INSET,
            "regions": [
                {"semantic_id": item["semantic_id"], "polygon": item["polygon"]}
                for item in accepted
            ],
            "neutral_fallback_ids": sorted(set(by_id) - {item["semantic_id"] for item in accepted}),
        }
        (directory / "floor_regions.json").write_text(json.dumps(output, indent=2) + "\n")
        report["floors"][str(floor)] = {
            "matched_regions": [
                {"semantic_id": item["semantic_id"], "wall_edge_coverage": item["wall_edge_coverage"]}
                for item in accepted
            ],
            "excluded_regions": excluded,
            "neutral_fallback_ids": output["neutral_fallback_ids"],
        }
    report_path = ROOT / "inspection_navigation" / "floor_region_validation.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote floor_regions.json for Floors 3-6 and {report_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
