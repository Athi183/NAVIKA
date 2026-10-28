#!/usr/bin/env python3
"""Extract the M. George Building-1 floor plans from the supplied college DXF.

The source is kept untouched. Drawing units are not declared in the DXF, so
geometry is preserved in source units and converted to display metres using a
provisional scale; routes and connector matches remain candidates.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path("/home/athira-v/Downloads/college plans 3 (1).dxf")
DEFAULT_OUTPUT = ROOT / "frontend/public/data/MGeorge_DXF/college_plans.json"
METERS_PER_SOURCE_UNIT = 0.001  # provisional; validate against labelled dimensions
FLOOR_BANDS = [
    {"number": 0, "label": "Ground Floor", "y_min": -145000, "y_max": -134000},
    {"number": 1, "label": "First Floor", "y_min": -131000, "y_max": -121000},
    {"number": 2, "label": "Second Floor", "y_min": -118000, "y_max": -108000},
    {"number": 3, "label": "Third Floor", "y_min": -103000, "y_max": -93000},
    {"number": 4, "label": "Fourth Floor", "y_min": -89000, "y_max": -78000},
]
DISPLAY_LAYERS = {
    "wall", "door", "stair", "cor_ha", "toilet_ha", "thin_ha", "hat",
    "win", "thin", "sani", "layer4", "0",
}


def records(path: Path):
    section = ""
    current = None
    with path.open("r", encoding="cp1252", errors="replace") as stream:
        while True:
            code_line, value_line = stream.readline(), stream.readline()
            if not code_line or not value_line:
                break
            try:
                code = int(code_line.strip())
            except ValueError:
                continue
            value = value_line.strip()
            if code == 0:
                if current is not None:
                    yield section, current
                if value == "SECTION":
                    current = {"type": "SECTION", "pairs": []}
                elif value == "ENDSEC":
                    current = None
                    section = ""
                else:
                    current = {"type": value, "pairs": []}
            elif current is not None:
                current["pairs"].append((code, value))
                if current["type"] == "SECTION" and code == 2:
                    section = value
        if current is not None:
            yield section, current


def values(data, code):
    return [value for group, value in data if group == code]


def point(data, x_code=10, y_code=20):
    try:
        return float(values(data, x_code)[0]), float(values(data, y_code)[0])
    except (IndexError, ValueError):
        return None


def segments(kind, data):
    if kind == "LINE":
        a, b = point(data, 10, 20), point(data, 11, 21)
        return [(a, b)] if a and b else []
    if kind != "LWPOLYLINE":
        return []
    points = []
    x = None
    for code, value in data:
        if code == 10:
            try:
                x = float(value)
            except ValueError:
                x = None
        elif code == 20 and x is not None:
            try:
                points.append((x, float(value)))
            except ValueError:
                pass
            x = None
    try:
        closed = bool(int(values(data, 70)[0]) & 1)
    except (IndexError, ValueError):
        closed = False
    if closed and len(points) > 2:
        points.append(points[0])
    return list(zip(points, points[1:]))


def clean_text(raw):
    raw = re.sub(r"\\[A-Za-z]+[^;]*;", " ", raw)
    raw = raw.replace("\\P", " ").replace("%%U", " ")
    raw = re.sub(r"[{}]", " ", raw)
    return " ".join(raw.split()).strip(" -")


def semantic_type(text):
    value = text.upper()
    if "FIRE LIFT" in value or "LIFT" in value or "ELEVATOR" in value:
        return "lift"
    if "STAIR" in value or value == "UP":
        return "stair"
    if any(term in value for term in ("TOILET", "LADIES", "GENTS", "WASH")):
        return "washroom"
    if any(term in value for term in ("CORRIDOR", "PASSAGE", "LOBBY")):
        return "circulation"
    if any(term in value for term in ("LAB", "LABORATORY", "WORKSHOP")):
        return "laboratory"
    if any(term in value for term in ("OFFICE", "DEPARTMENT", "ADMIN", "CABIN", "STAFF", "H.O.D")):
        return "office"
    if any(term in value for term in ("HALL", "SEMINAR", "AUDITORIUM", "CLASSROOM", "CLASS ROOM", "LIBRARY", "DRAWING")):
        return "teaching"
    if any(term in value for term in ("RAMP", "ENTRY", "PORCH", "PARKING", "EXIT")):
        return "access"
    if any(term in value for term in ("ROOM", "STORE", "PANTRY", "KITCHEN", "DINING")):
        return "room"
    return None


def is_room_label(text):
    upper = text.upper()
    if not text or len(text) > 75 or "FLOOR PLAN" in upper:
        return False
    if re.search(r"\d+(?:\.\d+)?\s*(?:X|×)\s*\d+", upper):
        return False
    if any(token in upper for token in ("SQ.M", "SQ.M.", "SCALE", "AREA STATEMENT", "BUILT UP AREA", "CARPET AREA", "COMPLETED ENGINEERING COLLEGE", "CERTIFIED THAT", "MUTHOOT INSTITUTE", "DRAWN BY", "CHECKED BY", "OWNER", "PANCHAYAT", "PERMIT NO", "DATE:")):
        return False
    if re.fullmatch(r"(?:D|D\d|W|W\d|V|V\d|DT|MD|AD|UP|[A-Z]{1,2}\d{1,3}|\d{1,3})", upper):
        return False
    return semantic_type(text) is not None


def floor_for_y(y):
    return next((floor for floor in FLOOR_BANDS if floor["y_min"] <= y <= floor["y_max"]), None)


def merge_intervals(intervals, tolerance=80.0):
    merged = []
    for lo, hi in sorted((min(a, b), max(a, b)) for a, b in intervals):
        if merged and lo <= merged[-1][1] + tolerance:
            merged[-1][1] = max(merged[-1][1], hi)
        else:
            merged.append([lo, hi])
    return merged


def wall_edge_coverage(groups, coord, lo, hi):
    span = hi - lo
    if span <= 0:
        return 0.0
    key = round(coord / 50) * 50
    covered = 0.0
    for candidate in (key - 50, key, key + 50):
        for a, b in groups.get(candidate, ()):
            covered += max(0.0, min(hi, b) - max(lo, a))
    return min(1.0, covered / span)


def infer_wall_supported_regions(wall_segments, labels, center_x, center_y):
    """Infer per-room color regions from the nearest rectangular wall evidence."""
    vertical, horizontal = defaultdict(list), defaultdict(list)
    for line in wall_segments:
        dx = line["x2_source"] - line["x1_source"]
        dy = line["y2_source"] - line["y1_source"]
        if abs(dx) <= max(20.0, abs(dy) * 0.035):
            vertical[round(((line["x1_source"] + line["x2_source"]) / 2) / 50) * 50].append((line["y1_source"], line["y2_source"]))
        if abs(dy) <= max(20.0, abs(dx) * 0.035):
            horizontal[round(((line["y1_source"] + line["y2_source"]) / 2) / 50) * 50].append((line["x1_source"], line["x2_source"]))
    vertical = {key: merge_intervals(parts) for key, parts in vertical.items()}
    horizontal = {key: merge_intervals(parts) for key, parts in horizontal.items()}
    xs, ys = sorted(vertical), sorted(horizontal)
    regions = []
    for index, label in enumerate(labels):
        if label["type"] not in {"teaching", "laboratory", "office", "washroom", "room"}:
            continue
        px, py = label["source_xy"]
        # TEXT anchors can sit directly on an inside wall edge, so allow a
        # near-zero offset while still requiring the final polygon to contain
        # actual wall evidence on every side.
        left = [x for x in xs if 40 <= px - x <= 6500][-8:]
        right = [x for x in xs if 40 <= x - px <= 6500][:8]
        below = [y for y in ys if 40 <= py - y <= 6500][-8:]
        above = [y for y in ys if 40 <= y - py <= 6500][:8]
        candidates = []
        for x0 in left:
            for x1 in right:
                width = x1 - x0
                if not 450 <= width <= 35000:
                    continue
                for y0 in below:
                    for y1 in above:
                        height = y1 - y0
                        area_m2 = width * height * METERS_PER_SOURCE_UNIT ** 2
                        if not 1.0 <= area_m2 <= 700 or height < 450:
                            continue
                        coverage = [wall_edge_coverage(vertical, x0, y0, y1), wall_edge_coverage(vertical, x1, y0, y1),
                                    wall_edge_coverage(horizontal, y0, x0, x1), wall_edge_coverage(horizontal, y1, x0, x1)]
                        average = sum(coverage) / 4
                        # Prefer room-sized boxes with the strongest wall support.
                        # Some CAD labels sit in door gaps, so retain a nearest-wall
                        # candidate when the drawing does not close all four edges.
                        score = abs(math.log(max(area_m2, 0.1) / 28.0)) + (1.0 - average) * 0.8
                        candidates.append((score, -average, area_m2, x0, y0, x1, y1, coverage))
        if not candidates:
            continue
        candidates.sort()
        candidate = candidates[0]
        score, negative_average, area, x0, y0, x1, y1, coverage = candidate
        regions.append({
            "id": f"{label['type']}-{index}", "semantic_id": label["id"], "label": label["text"], "type": label["type"],
            "polygon_xy": [[round((x - center_x) * METERS_PER_SOURCE_UNIT, 4), round((y - center_y) * METERS_PER_SOURCE_UNIT, 4)]
                           for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))],
            "area_m2_candidate": round(area, 2),
            "edge_wall_coverage": [round(value, 3) for value in coverage],
            "average_wall_coverage": round(-negative_average, 3),
            "review_status": "wall_supported_rectangle_candidate" if -negative_average >= 0.18 else "nearest_wall_color_region_candidate",
        })
    return regions


def consolidate_walls(raw_walls, center_x, center_y):
    """Join tiny collinear CAD fragments while leaving normal door openings."""
    horizontal, vertical, angled = defaultdict(list), defaultdict(list), []
    for wall in raw_walls:
        x1, y1 = wall["x1_source"], wall["y1_source"]
        x2, y2 = wall["x2_source"], wall["y2_source"]
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy)
        if abs(dy) <= max(12.0, length * 0.004):
            key = round(((y1 + y2) / 2) / 10) * 10
            horizontal[key].append((min(x1, x2), max(x1, x2)))
        elif abs(dx) <= max(12.0, length * 0.004):
            key = round(((x1 + x2) / 2) / 10) * 10
            vertical[key].append((min(y1, y2), max(y1, y2)))
        else:
            angled.append((x1, y1, x2, y2))

    def merge_runs(groups, horizontal_axis):
        merged = []
        for fixed, intervals in groups.items():
            for lo, hi in merge_intervals(intervals, tolerance=40.0):
                if horizontal_axis:
                    segment = (lo, fixed, hi, fixed)
                else:
                    segment = (fixed, lo, fixed, hi)
                merged.append(segment)
        return merged

    segments = merge_runs(horizontal, True) + merge_runs(vertical, False) + angled
    seen = set()
    walls = []
    for x1, y1, x2, y2 in segments:
        key = tuple(sorted(((round(x1, 2), round(y1, 2)), (round(x2, 2), round(y2, 2)))))
        if key in seen:
            continue
        seen.add(key)
        ax, ay = (x1 - center_x) * METERS_PER_SOURCE_UNIT, (y1 - center_y) * METERS_PER_SOURCE_UNIT
        bx, by = (x2 - center_x) * METERS_PER_SOURCE_UNIT, (y2 - center_y) * METERS_PER_SOURCE_UNIT
        walls.append({"id": f"WALL_{len(walls) + 1:05d}", "type": "line_wall", "x1": round(ax, 4), "y1": round(ay, 4),
                      "x2": round(bx, 4), "y2": round(by, 4), "length": round(math.hypot(bx - ax, by - ay), 4)})
    return walls


def extract(source: Path):
    by_floor = {floor["number"]: {"spec": floor, "layers": defaultdict(list), "labels": [], "counts": Counter()} for floor in FLOOR_BANDS}
    text_seen = set()
    source_entity_counts = Counter()
    for section, record in records(source):
        if section != "ENTITIES":
            continue
        kind, data = record["type"], record["pairs"]
        layer = next(iter(values(data, 8)), "0")
        normalized_layer = layer.casefold()
        if kind in ("TEXT", "MTEXT"):
            raw = " ".join(values(data, 1) + values(data, 3))
            text = clean_text(raw)
            pos = point(data)
            if not pos:
                continue
            floor = floor_for_y(pos[1])
            if not floor or not is_room_label(text):
                continue
            key = (floor["number"], text.casefold(), round(pos[0], 2), round(pos[1], 2))
            if key in text_seen:
                continue
            text_seen.add(key)
            by_floor[floor["number"]]["labels"].append({
                "id": f"mgeorge_{floor['number']}_{len(by_floor[floor['number']]['labels']) + 1:03d}",
                "text": text,
                "type": semantic_type(text),
                "source_xy": [round(pos[0], 3), round(pos[1], 3)],
                "source_layer": layer,
                "source_entity": kind,
            })
            by_floor[floor["number"]]["counts"][f"text:{layer}"] += 1
            continue
        if kind not in ("LINE", "LWPOLYLINE") or normalized_layer not in DISPLAY_LAYERS:
            continue
        pairs = segments(kind, data)
        if not pairs:
            continue
        source_entity_counts[(layer, kind)] += 1
        for index, (a, b) in enumerate(pairs):
            midpoint_y = (a[1] + b[1]) / 2
            floor = floor_for_y(midpoint_y)
            if not floor:
                continue
            if min(a[1], b[1]) < floor["y_min"] - 1200 or max(a[1], b[1]) > floor["y_max"] + 1200:
                continue
            bucket = by_floor[floor["number"]]
            length = math.dist(a, b)
            if length < 0.02:
                continue
            bucket["layers"][layer].append({
                "x1_source": a[0], "y1_source": a[1],
                "x2_source": b[0], "y2_source": b[1],
                "source_entity": kind,
                "source_handle": next(iter(values(data, 5)), ""),
                "source_segment": index,
            })
            bucket["counts"][f"geometry:{layer}"] += 1

    floors = []
    for number, bucket in by_floor.items():
        all_segments = [line for layer in bucket["layers"].values() for line in layer]
        if not all_segments:
            raise ValueError(f"No wall/plan geometry extracted for {bucket['spec']['label']}")
        coords_x = [line[k] for line in all_segments for k in ("x1_source", "x2_source")]
        coords_y = [line[k] for line in all_segments for k in ("y1_source", "y2_source")]
        min_x, max_x = min(coords_x), max(coords_x)
        min_y, max_y = min(coords_y), max(coords_y)
        center_x, center_y = (min_x + max_x) / 2, (min_y + max_y) / 2
        scale = METERS_PER_SOURCE_UNIT
        layer_segments = {}
        for layer, lines in bucket["layers"].items():
            normalized = []
            for line in lines:
                normalized.append([
                    round((line["x1_source"] - center_x) * scale, 4),
                    round((line["y1_source"] - center_y) * scale, 4),
                    round((line["x2_source"] - center_x) * scale, 4),
                    round((line["y2_source"] - center_y) * scale, 4),
                ])
            layer_segments[layer] = normalized
        labels = []
        for label in bucket["labels"]:
            labels.append({
                **label,
                "xy": [round((label["source_xy"][0] - center_x) * scale, 4), round((label["source_xy"][1] - center_y) * scale, 4)],
            })
        wall_segments = [line for layer_name, lines in bucket["layers"].items() if layer_name.casefold() == "wall" for line in lines]
        merged_walls = consolidate_walls(wall_segments, center_x, center_y)
        regions = infer_wall_supported_regions(wall_segments, bucket["labels"], center_x, center_y)
        floors.append({
            "floor_number": number,
            "floor_id": f"MGEORGE_{number:02d}",
            "label": bucket["spec"]["label"],
            "coordinate_system": "centered DXF drawing coordinates, provisional metres",
            "source_origin_xy": [round(center_x, 3), round(center_y, 3)],
            "source_window_y": [bucket["spec"]["y_min"], bucket["spec"]["y_max"]],
            "source_bounds_xy": [round(min_x, 3), round(min_y, 3), round(max_x, 3), round(max_y, 3)],
            "display_bounds_xy": [round((min_x - center_x) * scale, 3), round((min_y - center_y) * scale, 3), round((max_x - center_x) * scale, 3), round((max_y - center_y) * scale, 3)],
            "source_layer_counts": dict(sorted(bucket["counts"].items())),
            "layer_segments": layer_segments,
            "walls": merged_walls,
            "labels": labels,
            "room_regions": regions,
            "connectors": [label for label in labels if label["type"] in ("stair", "lift")],
        })
    return {
        "schema_version": "navika-mgeorge-dxf-0.1",
        "building": {
            "building_id": "MGEORGE_BLOCK",
            "building_label": "M. George Block · Building 1",
            "campus": "Muthoot Institute of Technology and Science, Varikoli",
            "source_file": source.name,
            "source_format": "DXF R14/AC1014",
            "source_units": "not declared in DXF header",
            "provisional_meters_per_source_unit": METERS_PER_SOURCE_UNIT,
            "scale_status": "provisional_mm_inference; drawing dimension cross-check required before measured routes",
            "horizontal_authority": "college plan DXF",
        },
        "status": "3d_visualization_candidate_unverified_topology",
        "visualization_settings": {"wall_height_m": 2.8, "floor_gap_m": 3.4, "floor_gap_status": "diagrammatic_assumption"},
        "floors": floors,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    result = extract(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    manifest_floors = []
    for floor in result["floors"]:
        folder_name = floor["floor_id"]
        folder = args.output.parent / folder_name
        folder.mkdir(parents=True, exist_ok=True)
        source_summary = floor["source_layer_counts"]
        walls = floor["walls"]
        (folder / "walls.json").write_text(json.dumps({
            "floor": str(floor["floor_number"]), "floor_label": floor["label"],
            "source": result["building"]["source_file"],
            "coordinate_system": floor["coordinate_system"],
            "geometry_summary": {"wall_segment_count": len(walls), "source_wall_segments": source_summary.get("geometry:WALL", 0)},
            "walls": walls,
        }, separators=(",", ":")) + "\n", encoding="utf-8")
        (folder / "semantics.json").write_text(json.dumps({
            "floor": str(floor["floor_number"]), "floor_label": floor["label"],
            "places": [{"id": item["id"], "name": item["text"], "type": item["type"], "roomNumber": None,
                        "cadX": item["xy"][0], "cadY": item["xy"][1]} for item in floor["labels"]],
        }, separators=(",", ":")) + "\n", encoding="utf-8")
        (folder / "floor_regions.json").write_text(json.dumps({
            "floor": str(floor["floor_number"]), "coordinate_system": "centered CAD XY, provisional metres",
            "surface_elevation": 0.02, "floor_inset": 0,
            "regions": [{"semantic_id": item["semantic_id"], "polygon": item["polygon_xy"],
                         "review_status": item["review_status"], "wall_coverage": item["average_wall_coverage"]}
                        for item in floor["room_regions"]],
        }, separators=(",", ":")) + "\n", encoding="utf-8")
        manifest_floors.append({"floor_number": floor["floor_number"], "floor_id": folder_name,
                                "label": floor["label"], "directory": folder_name})
    (args.output.parent / "manifest.json").write_text(json.dumps({
        "building_id": "MGEORGE_BLOCK", "building_label": "M. George Block · Building 1",
        "source": result["building"]["source_file"], "floors": manifest_floors,
    }, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "floors": [{"label": floor["label"], "segments": sum(map(len, floor["layer_segments"].values())), "walls_json_segments": len(floor["walls"]), "room_fills": len(floor["room_regions"]), "labels": len(floor["labels"]), "connectors": len(floor["connectors"])} for floor in result["floors"]],
        "scale_status": result["building"]["scale_status"],
    }, indent=2))


if __name__ == "__main__":
    main()
