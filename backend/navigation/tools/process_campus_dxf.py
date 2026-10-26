"""Extract a lightweight campus-site layer from a CAD DXF.

The DXF supplied for the Varnam college layout contains several drawing
clusters. This dependency-free extractor scopes the cluster around the
"COLLEGE LAYOUT" title, keeps selected site/building layers, and emits
candidate landmarks. It does not infer doors, walkable paths, building
heights, or a registered transform to another building's indoor plans.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_INPUT = Path("/home/athira-v/Downloads/COLLEGE PLAN VARNAM.dxf")
DEFAULT_OUTPUT = REPOSITORY_ROOT / "frontend/src/data/varnam_college_site_candidate.json"
LAYERS = {
    "PDF_0", "PDF_Wall", "PDF_Lines", "PDF_BOUNDARY", "PDF_ROAD",
    "PDF_INTERNAL ROAD", "PDF_STAIR", "PDF_foot path", "PDF_PAVING",
}
UNIT_TO_M = {0: None, 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0}


def pairs(path: Path):
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


def records(path: Path):
    section = ""
    current = None
    for code, value in pairs(path):
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


def clean_text(value: str) -> str:
    value = value.replace("\\P", " ")
    value = re.sub(r"\\[A-Za-z]+[^;]*;", "", value)
    value = re.sub(r"[{}]", "", value)
    return " ".join(value.split()).strip()


def title_anchor(path: Path):
    for section, entity in records(path):
        if section != "ENTITIES" or entity["type"] != "MTEXT":
            continue
        pairs_ = entity["pairs"]
        text = clean_text(" ".join(value for code, value in pairs_ if code in (1, 3)))
        if text.upper() != "COLLEGE LAYOUT":
            continue
        x = next((float(v) for c, v in pairs_ if c == 10), None)
        y = next((float(v) for c, v in pairs_ if c == 20), None)
        if x is not None and y is not None:
            return x, y
    raise ValueError("Could not find the COLLEGE LAYOUT title in the model-space DXF text.")


def extract(path: Path):
    title_x, title_y = title_anchor(path)
    # The supplied file contains repeated drawing content offset far along X.
    # This window isolates the campus cluster associated with its layout title.
    bounds = (title_x - 20_000, title_x + 40_000, title_y + 4_000, title_y + 32_000)
    x0, x1, y0, y1 = bounds
    layer_segments = defaultdict(list)
    features = []
    counts = Counter()
    floor_labels = []
    unit_code = 0
    active_section = ""

    for section, entity in records(path):
        if section == "HEADER":
            if entity["type"] == "$INSUNITS":
                continue
            continue
        if section != "ENTITIES":
            continue
        kind = entity["type"]
        data = entity["pairs"]
        layer = next((value for code, value in data if code == 8), "0")
        counts[(layer, kind)] += 1

        if kind == "MTEXT":
            value = clean_text(" ".join(text for code, text in data if code in (1, 3)))
            try:
                x = next(float(v) for c, v in data if c == 10)
                y = next(float(v) for c, v in data if c == 20)
            except (StopIteration, ValueError):
                continue
            if not value or not (x0 <= x <= x1 and y0 <= y <= y1):
                continue
            upper = value.upper()
            if "FLOOR" in upper or upper == "GROUND":
                floor_labels.append({"text": value, "x": round(x, 3), "y": round(y, 3), "source_layer": layer, "status": "label_candidate_unassigned_to_building"})
            is_landmark = any(term in upper for term in (
                "BLOCK", "BUILDING", "HOSTEL", "CANTEEN", "HALL", "ARENA",
                "AUDITORIUM", "COLLEGE LAYOUT", "ENTRY", "ENTRANCE", "EXIT",
                "ROAD", "PARKING", "SAFE ZONE", "ASSEMBLY", "EVACUATION",
            ))
            if is_landmark:
                features.append({
                    "id": f"site_label_{len(features) + 1:03d}",
                    "label": value,
                    "x": round(x, 3),
                    "y": round(y, 3),
                    "category": "building" if any(term in upper for term in ("BLOCK", "BUILDING", "HOSTEL", "CANTEEN", "HALL", "ARENA", "AUDITORIUM")) else "site_annotation",
                    "source_layer": layer,
                    "review_status": "label_anchor_candidate",
                })
            continue

        if layer not in LAYERS or kind not in {"LWPOLYLINE", "LINE"}:
            continue
        points = []
        if kind == "LWPOLYLINE":
            for code, value in data:
                if code == 10:
                    try:
                        points.append([float(value), None])
                    except ValueError:
                        pass
                elif code == 20 and points and points[-1][1] is None:
                    try:
                        points[-1][1] = float(value)
                    except ValueError:
                        pass
            points = [point for point in points if point[1] is not None]
            closed = bool(int(next((v for c, v in data if c == 70), "0")) & 1)
            if closed and len(points) > 2:
                points.append(points[0])
        else:
            try:
                points = [
                    [next(float(v) for c, v in data if c == 10), next(float(v) for c, v in data if c == 20)],
                    [next(float(v) for c, v in data if c == 11), next(float(v) for c, v in data if c == 21)],
                ]
            except (StopIteration, ValueError):
                continue
        for a, b in zip(points, points[1:]):
            midpoint_x = (a[0] + b[0]) / 2
            midpoint_y = (a[1] + b[1]) / 2
            if x0 <= midpoint_x <= x1 and y0 <= midpoint_y <= y1 and (a[0] != b[0] or a[1] != b[1]):
                layer_segments[layer].append([round(a[0], 3), round(a[1], 3), round(b[0], 3), round(b[1], 3)])

    # Read $INSUNITS from the header value that follows its group-code marker.
    all_pairs = list(pairs(path))
    for index, (code, value) in enumerate(all_pairs):
        if code == 9 and value == "$INSUNITS" and index + 1 < len(all_pairs):
            try:
                if all_pairs[index + 1][0] == 70:
                    unit_code = int(all_pairs[index + 1][1])
            except ValueError:
                pass
            break
    factor = UNIT_TO_M.get(unit_code)
    return {
        "schema_version": 1,
        "building_id": "VARNAM_COLLEGE_SITE",
        "label": "Varnam college campus layout",
        "source_file": path.name,
        "source_format": "DXF ASCII, AutoCAD 2004",
        "source_insunits_code": unit_code,
        "source_unit_label": {1: "inches", 2: "feet", 4: "millimetres", 5: "centimetres", 6: "metres"}.get(unit_code, "unitless_or_other"),
        "scale_status": "declared DXF units only; PDF-derived drawing scale not field-verified",
        "scope": {"title_anchor_xy": [round(title_x, 3), round(title_y, 3)], "bounds_xy": [round(v, 3) for v in bounds], "selection_status": "candidate_cluster_scoped_near_COLLEGE_LAYOUT_title"},
        "layer_segments": dict(layer_segments),
        "features": features,
        "floor_labels": floor_labels,
        "vertical_links": [],
        "outdoor_indoor_links": [],
        "summary": {
            "segment_count": sum(map(len, layer_segments.values())),
            "feature_count": len(features),
            "floor_label_candidates": len(floor_labels),
            "verified_vertical_links": 0,
            "verified_outdoor_indoor_links": 0,
            "source_entity_counts_by_layer_and_type": {f"{layer}|{kind}": count for (layer, kind), count in counts.items()},
            "geometry_unit_to_m_factor_if_units_are_correct": factor,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    result = extract(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), **result["summary"], "floor_labels": result["floor_labels"]}, indent=2))


if __name__ == "__main__":
    main()
