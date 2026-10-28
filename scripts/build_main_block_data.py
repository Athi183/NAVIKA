#!/usr/bin/env python3
"""Extract the supplied MITS Main Block DXFs into reviewable 3D-viewer data.

This deliberately uses only standard-library DXF parsing.  Source coordinates
are retained, the drawing's centimetre note is recorded separately from its
conflicting INSUNITS header, and room fills are emitted only where near-axis
wall segments support all four candidate rectangle edges.
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data/MITS_Main_Block"
MAIN_DXF = Path("/home/athira-v/Downloads/MAIN BLOCK FLOOR PLANS (1)_recover (1).dxf")
BASEMENT_DXF = Path("/home/athira-v/Downloads/basement.dxf")

FLOORS = [
    {
        "id": "main_f1", "label": "First Floor", "source": MAIN_DXF,
        "bounds": (151500.0, 167500.0, -56500.0, -49000.0),
        "wall_layers": {"wall"}, "display_layers": {"wall", "DOOR", "STAIR", "win", "COR HA", "Layer1", "Layer4", "thin ha", "0"},
        "elevation_m": None,
    },
    {
        "id": "main_f2", "label": "Second Floor", "source": MAIN_DXF,
        "bounds": (151500.0, 167500.0, -69000.0, -61000.0),
        "wall_layers": {"wall"}, "display_layers": {"wall", "DOOR", "STAIR", "win", "COR HA", "Layer1", "Layer4", "thin ha", "0"},
        "elevation_m": None,
    },
    {
        "id": "main_basement", "label": "Basement", "source": BASEMENT_DXF,
        "bounds": (0.0, 10200.0, 0.0, 5050.0),
        "wall_layers": set(), "display_layers": {"0", "wall", "thin ha"},
        "elevation_m": None,
    },
]

COLORS = {
    "laboratory": "#F6D878", "office": "#8ED8D0", "washroom": "#83D5E3",
    "corridor": "#D9D9D9", "stair": "#B9A1E8", "lift": "#B9A1E8",
    "hall": "#F6D878", "food": "#E9A1A1", "room": "#DEE2E6",
    "service": "#9CCFE8", "other": "#DEE2E6",
}


def dxf_pairs(path: Path):
    with path.open("r", encoding="cp1252", errors="replace") as stream:
        while True:
            code = stream.readline()
            value = stream.readline()
            if not code or not value:
                return
            try:
                yield int(code.strip()), value.strip()
            except ValueError:
                continue


def dxf_records(path: Path):
    section = ""
    current = None
    for code, value in dxf_pairs(path):
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


def dxf_text(value: str) -> str:
    value = value.replace("\\P", " ")
    value = re.sub(r"\\[A-Za-z]+[^;]*;", "", value)
    value = re.sub(r"%%U", "", value, flags=re.I)
    value = re.sub(r"[{}]", "", value)
    return " ".join(value.split()).strip()


def entity_layer(data):
    return next((v for c, v in data if c == 8), "0")


def entity_points(kind, data):
    if kind == "LINE":
        try:
            return [
                (float(next(v for c, v in data if c == 10)), float(next(v for c, v in data if c == 20))),
                (float(next(v for c, v in data if c == 11)), float(next(v for c, v in data if c == 21))),
            ]
        except (StopIteration, ValueError):
            return []
    if kind == "LWPOLYLINE":
        pts = []
        current = None
        for code, value in data:
            if code == 10:
                try:
                    current = [float(value), None]
                    pts.append(current)
                except ValueError:
                    current = None
            elif code == 20 and current is not None and current[1] is None:
                try:
                    current[1] = float(value)
                except ValueError:
                    pass
        points = [tuple(p) for p in pts if p[1] is not None]
        try:
            is_closed = bool(int(next(value for code, value in data if code == 70)) & 1)
        except (StopIteration, ValueError):
            is_closed = False
        if is_closed and len(points) > 2:
            points.append(points[0])
        return points
    return []


def label_type(text: str):
    t = text.upper()
    if any(x in t for x in ("STAIR", "STAIRCASE", "STAIR WELL")): return "stair"
    if "LIFT" in t or "ELEVATOR" in t: return "lift"
    if any(x in t for x in ("TOILET", "LADIES", "GENTS", "WASHROOM", "REST ROOM")): return "washroom"
    if any(x in t for x in ("CORRIDOR", "PASSAGE")): return "corridor"
    if any(x in t for x in ("LAB", "LABORATORY", "WORKSHOP")): return "laboratory"
    if any(x in t for x in ("OFFICE", "DEPARTMENT", "ADMIN", "CABIN", "STAFF")): return "office"
    if any(x in t for x in ("HALL", "SEMINAR", "AUDITORIUM", "CONFERENCE")): return "hall"
    if any(x in t for x in ("PANTRY", "KITCHEN", "CANTEEN", "DINING")): return "food"
    if any(x in t for x in ("SERVICE DUCT", "PLUMBING DUCT", "FIRE DUCT", "ELECTRICAL ROOM", "STORE")): return "service"
    if any(x in t for x in ("ROOM", "LOBBY", "LIBRARY", "READING", "CLASS", "VACANT", "ENTRY", "PORCH")): return "room"
    return None


def semantic_eligible(text: str):
    t = text.upper().strip()
    if not t or len(t) > 70 or t.startswith("AREA") or "FLOOR PLAN" in t:
        return False
    if re.fullmatch(r"[A-Z]{1,3}\d{0,3}", t) or re.fullmatch(r"\d+(?:\.\d+)?(?:X|X\d+).*", t):
        return False
    if any(t.startswith(x) for x in ("SCALE", "DRAWN", "CHECKED", "DATE", "JOB NO", "NOTE", "BUILDING OWNER", "LAND OWNER")):
        return False
    return label_type(t) is not None


def read_floor(spec):
    x0, x1, y0, y1 = spec["bounds"]
    lines_by_layer = defaultdict(list)
    texts = []
    counts = Counter()
    unit_code = None
    for section, entity in dxf_records(spec["source"]):
        if section == "HEADER" and entity["type"] == "$INSUNITS":
            continue
        if section != "ENTITIES":
            continue
        kind, data = entity["type"], entity["pairs"]
        layer = entity_layer(data)
        counts[(layer, kind)] += 1
        if kind in ("TEXT", "MTEXT"):
            text = dxf_text(" ".join(v for c, v in data if c in (1, 3)))
            try:
                x = float(next(v for c, v in data if c == 10))
                y = float(next(v for c, v in data if c == 20))
            except (StopIteration, ValueError):
                continue
            if x0 <= x <= x1 and y0 <= y <= y1 and semantic_eligible(text):
                handle = next((v for c, v in data if c == 5), f"t{len(texts)}")
                texts.append({"id": f"{spec['id']}_{handle}", "label": text, "x": x, "y": y, "type": label_type(text), "color": COLORS[label_type(text)], "source_layer": layer})
            continue
        if kind not in ("LINE", "LWPOLYLINE") or layer not in spec["display_layers"]:
            continue
        points = entity_points(kind, data)
        if len(points) < 2:
            continue
        handle = next((v for c, v in data if c == 5), f"l{sum(map(len, lines_by_layer.values()))}")
        for index, (a, b) in enumerate(zip(points, points[1:])):
            mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            if x0 <= mx <= x1 and y0 <= my <= y1 and math.dist(a, b) > 0.02:
                lines_by_layer[layer].append({"id": f"{handle}_{index}", "x1": a[0], "y1": a[1], "x2": b[0], "y2": b[1]})
    pairs = list(dxf_pairs(spec["source"]))
    for index, (code, value) in enumerate(pairs):
        if code == 9 and value == "$INSUNITS" and index + 1 < len(pairs) and pairs[index + 1][0] == 70:
            try: unit_code = int(pairs[index + 1][1])
            except ValueError: pass
            break
    all_lines = [line for lines in lines_by_layer.values() for line in lines]
    bounds = [min([line["x1"] for line in all_lines] + [line["x2"] for line in all_lines]),
              min([line["y1"] for line in all_lines] + [line["y2"] for line in all_lines]),
              max([line["x1"] for line in all_lines] + [line["x2"] for line in all_lines]),
              max([line["y1"] for line in all_lines] + [line["y2"] for line in all_lines])]
    wall_lines = [line for layer in spec["wall_layers"] for line in lines_by_layer.get(layer, [])]
    wall_bounds = [min([line["x1"] for line in wall_lines] + [line["x2"] for line in wall_lines]),
                   min([line["y1"] for line in wall_lines] + [line["y2"] for line in wall_lines]),
                   max([line["x1"] for line in wall_lines] + [line["x2"] for line in wall_lines]),
                   max([line["y1"] for line in wall_lines] + [line["y2"] for line in wall_lines])] if wall_lines else bounds
    return {
        "schema_version": 1, "building_id": "MITS_MAIN_BLOCK", "floor_id": spec["id"], "floor_label": spec["label"],
        "source_file": spec["source"].name, "source_format": "DXF", "source_insunits_code": unit_code,
        "source_units": "drawing note states centimetres; DXF header declares inches",
        "unit_status": "centimetre scaling selected from explicit drawing note; header conflict retained for review",
        "coordinate_units": "cm", "meters_per_coordinate_unit": 0.01, "elevation_m": spec["elevation_m"],
        "plan_bounds_xy": [round(v, 3) for v in bounds], "registration_bounds_xy": [round(v, 3) for v in wall_bounds], "floor_regions": [], "semantic_places": texts,
        "layer_segments": dict(lines_by_layer),
        "summary": {"segment_count": sum(map(len, lines_by_layer.values())), "semantic_place_count": len(texts),
                    "source_entities_by_layer_and_type": {f"{l}|{t}": n for (l, t), n in counts.items()}},
    }


def merge_intervals(intervals, tolerance=4.0):
    merged = []
    for lo, hi in sorted((min(a, b), max(a, b)) for a, b in intervals):
        if merged and lo <= merged[-1][1] + tolerance:
            merged[-1][1] = max(merged[-1][1], hi)
        else:
            merged.append([lo, hi])
    return merged


def edge_coverage(groups, coord, lo, hi, coord_tol=3.0):
    span = hi - lo
    if span <= 0: return 0.0
    covered = 0.0
    center_key = round(coord / 2) * 2
    keys = (center_key - 2, center_key, center_key + 2) if coord_tol >= 2 else (center_key,)
    for c in keys:
        intervals = groups.get(c, ())
        for a, b in intervals:
            covered += max(0.0, min(hi, b) - max(lo, a))
    return min(1.0, covered / span)


def infer_supported_rectangles(floor):
    if floor["floor_id"] == "main_basement":
        return
    walls = floor["layer_segments"].get("wall", [])
    vertical, horizontal = defaultdict(list), defaultdict(list)
    for line in walls:
        dx, dy = line["x2"] - line["x1"], line["y2"] - line["y1"]
        if abs(dx) <= max(1.5, abs(dy) * 0.035):
            vertical[round(((line["x1"] + line["x2"]) / 2) / 2) * 2].append((line["y1"], line["y2"]))
        if abs(dy) <= max(1.5, abs(dx) * 0.035):
            horizontal[round(((line["y1"] + line["y2"]) / 2) / 2) * 2].append((line["x1"], line["x2"]))
    vertical = {k: merge_intervals(v) for k, v in vertical.items()}
    horizontal = {k: merge_intervals(v) for k, v in horizontal.items()}
    xs, ys = sorted(vertical), sorted(horizontal)
    accepted = []
    for place in floor["semantic_places"]:
        px, py = place["x"], place["y"]
        # Text anchors often sit close to (or just beyond) the room's inside
        # face. Keep near boundaries eligible, but never use a line through
        # the anchor itself as a room edge.
        left = [x for x in xs if 5 <= px - x <= 5000][-16:]
        right = [x for x in xs if 5 <= x - px <= 5000][:16]
        below = [y for y in ys if 5 <= py - y <= 5000][-16:]
        above = [y for y in ys if 5 <= y - py <= 5000][:16]
        candidates = []
        for x0 in left:
            for x1 in right:
                w = x1 - x0
                if not 100 <= w <= 5000: continue
                for y0 in below:
                    for y1 in above:
                        h = y1 - y0
                        area_m2 = w * h / 10000
                        if not 4.0 <= area_m2 <= 1500.0: continue
                        cover = [edge_coverage(vertical, x0, y0, y1), edge_coverage(vertical, x1, y0, y1),
                                 edge_coverage(horizontal, y0, x0, x1), edge_coverage(horizontal, y1, x0, x1)]
                        if min(cover) >= 0.05 and sum(cover) / 4 >= 0.65:
                            candidates.append((area_m2, -sum(cover) / 4, x0, y0, x1, y1, cover))
        if not candidates: continue
        area, neg_cover, x0, y0, x1, y1, cover = min(candidates)
        candidate = {"id": f"region_{place['id']}", "semantic_id": place["id"], "label": place["label"], "type": place["type"], "color": place["color"],
                     "polygon_xy_cm": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], "area_m2": round(area, 2),
                     "edge_wall_coverage": [round(v, 3) for v in cover], "average_wall_coverage": round(-neg_cover, 3),
                     "review_status": "wall_supported_rectangle_candidate_not_field_verified"}
        if any(not (x1 <= r["polygon_xy_cm"][0][0] or x0 >= r["polygon_xy_cm"][1][0] or y1 <= r["polygon_xy_cm"][0][1] or y0 >= r["polygon_xy_cm"][2][1]) for r in accepted):
            continue
        accepted.append(candidate)
    floor["floor_regions"] = accepted


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for spec in FLOORS:
        floor = read_floor(spec)
        infer_supported_rectangles(floor)
        (OUT / f"{spec['id']}.json").write_text(json.dumps(floor, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(json.dumps({"file": str(OUT / f"{spec['id']}.json"), "floor": spec["label"], **floor["summary"],
                          "wall_supported_region_count": len(floor["floor_regions"]),
                          "region_labels": [r["label"] for r in floor["floor_regions"]]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
