"""Extract and normalize the Ramanujan Block floors explicitly titled 2–6.

The source DXF is read-only. This utility uses only DXF entities and text; it
does not consume IFC/Revit data. Floor-to-floor connector matches are candidates
from repeated UP/LIFT labels, not certified navigation links.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter
from pathlib import Path

import ezdxf
from ezdxf.disassemble import recursive_decompose
from ezdxf.path import make_path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT = REPOSITORY_ROOT / "frontend/src/data/ramanujan_floors_2_6.json"
DEFAULT_PREVIEW = REPOSITORY_ROOT / "NAVIKA_FLOOR_05_GOLD/diagnostics/ramanujan_dxf_floors_2_6_preview.png"
FLOOR_NAMES = {2: "SECOND", 3: "THIRD", 4: "FOURTH", 5: "FIFTH", 6: "SIXTH"}
FLOOR_WINDOW_BELOW_M = 22.5
FLOOR_WINDOW_ABOVE_M = 46.5
STACK_SPACING_M = 6.0  # exploded-view spacing only; this DXF does not specify storey elevations.


def raw_text(entity) -> str:
    if entity.dxftype() == "MTEXT":
        return entity.plain_text()
    return str(entity.dxf.get("text", ""))


def clean_display_text(value: str) -> str:
    value = value.replace("\\P", "\n")
    value = re.sub(r"\\px[^;]*;", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\\C\d+;", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\\[A-Za-z]+[^;]*;", "", value)
    value = value.replace("{", "").replace("}", "")
    lines = []
    for line in value.splitlines():
        line = " ".join(line.split()).strip()
        if not line:
            continue
        # Keep room names while removing dimension strings wherever they occur.
        line = re.sub(r"\s*\d+(?:\.\d+)?\s*[xX×]\s*\d+(?:\.\d+)?\s*(?:m)?", " ", line, flags=re.IGNORECASE)
        line = " ".join(line.split()).strip(" -·")
        if not line:
            continue
        if re.search(r"sq\.?\s*ft|sq\.?\s*m|m²|area\s*=", line, re.IGNORECASE):
            continue
        if line:
            lines.append(line)
    return " ".join(lines)


def floor_titles(doc) -> dict[int, dict]:
    pattern = re.compile(r"\b(SECOND|THIRD|FOURTH|FIFTH|SIXTH)\s+FLOOR\b", re.IGNORECASE)
    anchors = {}
    for entity in doc.modelspace().query("TEXT MTEXT"):
        match = pattern.search(clean_display_text(raw_text(entity)))
        if not match:
            continue
        name = match.group(1).upper()
        floor_number = next(number for number, title in FLOOR_NAMES.items() if title == name)
        insert = entity.dxf.insert
        anchors[floor_number] = {
            "title": f"{name.title()} Floor",
            "source_text": clean_display_text(raw_text(entity)),
            "anchor_xy": [float(insert.x), float(insert.y)],
        }
    missing = sorted(set(FLOOR_NAMES) - set(anchors))
    if missing:
        raise ValueError(f"DXF is missing explicit floor title(s) for: {missing}")
    return anchors


def entity_xy_points(entity):
    kind = entity.dxftype()
    if kind == "INSERT":
        # Insertions are expanded separately so block geometry gets transformed.
        return []
    if kind in {"TEXT", "MTEXT"}:
        p = entity.dxf.insert
        return [[float(p.x), float(p.y)]]
    try:
        path = make_path(entity)
        points = [[float(p.x), float(p.y)] for p in path.flattening(distance=0.08)]
        if len(points) > 2 and path.is_closed and math.dist(points[0], points[-1]) > 1e-6:
            points.append(points[0])
        return points
    except (TypeError, ValueError, AttributeError, ezdxf.DXFError):
        return []


def belongs_to_floor(y: float, floor: int, anchors: dict[int, dict]) -> bool:
    title_y = anchors[floor]["anchor_xy"][1]
    return title_y - FLOOR_WINDOW_BELOW_M <= y <= title_y + FLOOR_WINDOW_ABOVE_M


def add_path_segments(target: list, source_target: list, points: list[list[float]], floor: int, title_y: float, source_type: str):
    if len(points) < 2:
        return
    normalize_delta = anchors_fifth_y() - title_y
    for start, end in zip(points, points[1:]):
        length = math.dist(start, end)
        if length < 0.015:
            continue
        source_target.append([
            round(start[0], 4), round(start[1], 4),
            round(end[0], 4), round(end[1], 4),
        ])
        target.append([
            round(start[0], 4), round(start[1] + normalize_delta, 4),
            round(end[0], 4), round(end[1] + normalize_delta, 4),
        ])


_FIFTH_TITLE_Y = 0.0


def anchors_fifth_y() -> float:
    return _FIFTH_TITLE_Y


def label_kind(label: str) -> str:
    value = " ".join(label.split()).upper()
    if value == "UP":
        return "stair_up"
    if value == "LIFT":
        return "lift"
    return "annotation"


def extract(source: Path, building_id: str = "RAMANUJAN_BLOCK") -> dict:
    doc = ezdxf.readfile(source)
    anchors = floor_titles(doc)
    global _FIFTH_TITLE_Y
    _FIFTH_TITLE_Y = anchors[5]["anchor_xy"][1]
    floors = {
        number: {
            "floor_number": number,
            "floor_id": f"{building_id}_{number:02d}",
            "label": anchors[number]["title"],
            "source_title": anchors[number]["source_text"],
            "plan_title_anchor_xy_dxf": anchors[number]["anchor_xy"],
            "coordinate_transform": {
                "method": "translation by printed floor-title Y coordinate",
                "x_offset_m": 0.0,
                "y_offset_m": round(_FIFTH_TITLE_Y - anchors[number]["anchor_xy"][1], 6),
                "status": "candidate_plan_alignment",
            },
            "stack_index": number - 2,
            "diagram_elevation_m": round((number - 2) * STACK_SPACING_M, 3),
            "segments": [],
            "segments_source_dxf": [],
            "labels": [],
            "connectors": [],
            "source_entity_counts": Counter(),
        }
        for number in FLOOR_NAMES
    }

    # Process non-block geometry with an entity-center floor assignment.
    for entity in doc.modelspace():
        kind = entity.dxftype()
        if kind in {"TEXT", "MTEXT"}:
            label = clean_display_text(raw_text(entity))
            if not label:
                continue
            insert = entity.dxf.insert
            floor = next((n for n in FLOOR_NAMES if belongs_to_floor(insert.y, n, anchors)), None)
            if floor is None:
                continue
            role = label_kind(label)
            normalized_y = insert.y + _FIFTH_TITLE_Y - anchors[floor]["anchor_xy"][1]
            item = {
                "text": label,
                "xy": [round(float(insert.x), 4), round(float(normalized_y), 4)],
                "source_xy_dxf": [round(float(insert.x), 4), round(float(insert.y), 4)],
                "source_entity": kind,
                "source_layer": entity.dxf.layer,
            }
            if role == "stair_up":
                floors[floor]["connectors"].append({**item, "type": "stair", "marker": "UP"})
            elif role == "lift":
                floors[floor]["connectors"].append({**item, "type": "lift", "marker": "LIFT"})
            elif not re.fullmatch(r"(?:GROUND|FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH) FLOOR", label.upper()):
                floors[floor]["labels"].append(item)
            floors[floor]["source_entity_counts"][kind] += 1
            continue

        if kind == "INSERT":
            insert = entity.dxf.insert
            floor = next((n for n in FLOOR_NAMES if belongs_to_floor(insert.y, n, anchors)), None)
            if floor is None:
                continue
            virtual_entities = list(recursive_decompose([entity]))
            floors[floor]["source_entity_counts"]["INSERT"] += 1
            floors[floor]["source_entity_counts"][f"BLOCK:{entity.dxf.name}"] += 1
            for virtual in virtual_entities:
                points = entity_xy_points(virtual)
                if len(points) < 2:
                    continue
                title_y = anchors[floor]["anchor_xy"][1]
                add_path_segments(floors[floor]["segments"], floors[floor]["segments_source_dxf"], points, floor, title_y, virtual.dxftype())
            continue

        points = entity_xy_points(entity)
        if len(points) < 2:
            continue
        center_y = (min(point[1] for point in points) + max(point[1] for point in points)) / 2
        floor = next((n for n in FLOOR_NAMES if belongs_to_floor(center_y, n, anchors)), None)
        if floor is None:
            continue
        add_path_segments(
            floors[floor]["segments"], floors[floor]["segments_source_dxf"], points, floor, anchors[floor]["anchor_xy"][1], kind
        )
        floors[floor]["source_entity_counts"][kind] += 1

    for floor in floors.values():
        floor["source_entity_counts"] = dict(floor["source_entity_counts"])
        floor["segment_count"] = len(floor["segments"])
        plan_segments = [
            segment for segment in floor["segments"]
            if 0.45 <= math.dist(segment[:2], segment[2:]) <= 50
            and 25 <= (segment[0] + segment[2]) / 2 <= 123
            and 24 <= (segment[1] + segment[3]) / 2 <= 64
        ]
        if plan_segments and floor["labels"]:
            plan_min_x = min(min(segment[0], segment[2]) for segment in plan_segments)
            outside_left = [label for label in floor["labels"] if label["xy"][0] < plan_min_x - 0.25]
            # A few DXF room-name MTEXT anchors sit west of all floor-plan
            # linework. Preserve the extracted anchor, but register the group
            # inside the plan footprint for legible visualization/routing.
            # This remains an explicit display candidate, not source geometry.
            if outside_left:
                offset = plan_min_x + 1.0 - min(label["xy"][0] for label in outside_left)
            else:
                offset = 0.0
            for label in floor["labels"]:
                label["display_xy"] = [round(label["xy"][0] + offset, 4), label["xy"][1]]
                label["display_xy_status"] = "candidate_left_alignment_to_plan_extent" if label in outside_left else "same_as_extracted_anchor"
        floor["labels"].sort(key=lambda label: (label["xy"][1], label["xy"][0]))
        floor["connectors"].sort(key=lambda connector: (connector["type"], connector["xy"][0]))

    connector_network = build_connector_network(floors)
    normalized = {
        "building": {
            "building_id": building_id,
            "building_label": building_id.replace("_", " ").title(),
            "source_file": source.name,
            "source_format": "DXF",
            "source_version": doc.dxfversion,
            "units": "meters" if doc.header.get("$INSUNITS") == 6 else "source_units_unverified",
            "horizontal_authority": "DXF",
        },
        "status": "visualization_candidate",
        "notes": [
            "The five plans were separated using their printed SECOND through SIXTH FLOOR text and local Y extents.",
            "Horizontal floor registration uses the printed floor-title Y coordinates; no surveyed cross-floor control points are in the file.",
            f"Stack spacing of {STACK_SPACING_M:.1f} m is only a visualization aid; this DXF contains no verified storey elevations.",
            "Repeated UP/LIFT text and similar positions create candidate connector matches. Confirm each stair/lift landing and operational continuity before using them for routes.",
            "This extraction uses only the supplied DXF; IFC/Revit data is not used.",
        ],
        "visualization_settings": {
            "floor_spacing_m": STACK_SPACING_M,
            "floor_spacing_status": "diagrammatic_not_measured",
            "plan_registration_status": "candidate_from_printed_floor_titles",
        },
        "floors": [floors[number] for number in sorted(floors)],
        "vertical_connectors": connector_network["connectors"],
        "vertical_transitions": connector_network["transitions"],
        "connector_alignment_review": connector_network["review"],
    }
    return normalized


def build_connector_network(floors: dict[int, dict]) -> dict:
    by_floor = {number: floor["connectors"] for number, floor in floors.items()}
    connectors = []
    transitions = []
    review = []
    stair_names = [("stair_west", "West stair"), ("stair_center", "Center stair"), ("stair_east", "East stair")]
    for connector_id, title in stair_names:
        stops = {}
        for number in sorted(floors):
            landings = sorted(
                [item for item in by_floor[number] if item["type"] == "stair"],
                key=lambda item: item["xy"][0],
            )
            if len(landings) == 3:
                item = landings[stair_names.index((connector_id, title))]
                stops[str(number)] = item["xy"]
            else:
                review.append({"floor_number": number, "connector_id": connector_id, "reason": f"Expected 3 UP markers; found {len(landings)}."})
        connectors.append({"id": connector_id, "label": title, "type": "stair", "marker": "UP", "status": "candidate_from_repeated_DXF_labels", "stops": stops})

    lift_defs = [("lift_center", "Center lift", 80.0), ("lift_east", "East lift", 80.0)]
    for connector_id, title, split_x in lift_defs:
        stops = {}
        for number in sorted(floors):
            landings = sorted(
                [item for item in by_floor[number] if item["type"] == "lift"],
                key=lambda item: item["xy"][0],
            )
            if connector_id == "lift_center":
                landing = next((item for item in landings if item["xy"][0] < split_x), None)
            else:
                landing = next((item for item in landings if item["xy"][0] >= split_x), None)
            if landing:
                stops[str(number)] = landing["xy"]
        connectors.append({"id": connector_id, "label": title, "type": "lift", "marker": "LIFT", "status": "candidate_from_repeated_DXF_labels", "stops": stops})

    for connector in connectors:
        stop_numbers = sorted(int(number) for number in connector["stops"])
        for low, high in zip(stop_numbers, stop_numbers[1:]):
            if high != low + 1:
                review.append({"connector_id": connector["id"], "reason": f"No labelled intermediate stop between floors {low} and {high}."})
                continue
            a, b = connector["stops"][str(low)], connector["stops"][str(high)]
            transitions.append({
                "id": f"{connector['id']}_{low}_{high}",
                "connector_id": connector["id"],
                "type": connector["type"],
                "from_floor": low,
                "to_floor": high,
                "from_xy": a,
                "to_xy": b,
                "plan_offset_m": round(math.dist(a, b), 3),
                "status": "candidate_requires_landing_review",
            })
    return {"connectors": connectors, "transitions": transitions, "review": review}


def write_preview(data: dict, destination: Path):
    import matplotlib.pyplot as plt

    floors = data["floors"]
    figure, axes = plt.subplots(2, 3, figsize=(17, 10))
    colors = {2: "#315f86", 3: "#43866a", 4: "#8062a5", 5: "#bd7034", 6: "#a34c56"}
    for axis, floor in zip(axes.flat, floors):
        color = colors[floor["floor_number"]]
        for x1, y1, x2, y2 in floor["segments"]:
            axis.plot([x1, x2], [y1, y2], color="#7d858b", linewidth=0.45, alpha=0.72)
        for label in floor["labels"]:
            axis.text(label["xy"][0], label["xy"][1], label["text"], fontsize=4.7, color="#28343b", alpha=0.82)
        for connector in floor["connectors"]:
            marker = "^" if connector["type"] == "stair" else "s"
            axis.scatter(*connector["xy"], marker=marker, s=22, color=color, edgecolor="white", linewidth=0.35, zorder=5)
            axis.annotate(connector["text"], connector["xy"], xytext=(2, 2), textcoords="offset points", fontsize=4.8, color=color)
        axis.set_title(f"{floor['label']} — {floor['segment_count']} line segments", fontsize=10)
        axis.set_aspect("equal", adjustable="datalim")
        axis.grid(alpha=0.12)
        axis.set_xlabel("DXF X (m)")
        axis.set_ylabel("Registered plan Y (m)")
    for axis in axes.flat[len(floors):]:
        axis.axis("off")
    figure.suptitle("Ramanujan Block · DXF-only floor extraction · connector markers are candidates", fontsize=14)
    figure.tight_layout()
    destination.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(destination, dpi=180)
    plt.close(figure)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, help="Path to the source DXF drawing.")
    parser.add_argument("--building-id", default="RAMANUJAN_BLOCK", help="Stable building identifier for generated floor IDs.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--preview", type=Path, default=DEFAULT_PREVIEW)
    parser.add_argument("--no-preview", action="store_true")
    args = parser.parse_args()
    if args.source is None:
        parser.error("provide a source DXF path")
    if not args.source.is_file():
        parser.error(f"DXF source not found: {args.source}")
    result = extract(args.source, args.building_id.strip().upper())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    if not args.no_preview:
        write_preview(result, args.preview)
    print(json.dumps({
        "output": str(args.output),
        "preview": None if args.no_preview else str(args.preview),
        "floors": [{"floor": floor["label"], "segments": floor["segment_count"], "labels": len(floor["labels"]), "connectors": len(floor["connectors"])} for floor in result["floors"]],
        "candidate_vertical_transitions": len(result["vertical_transitions"]),
        "connector_review_items": len(result["connector_alignment_review"]),
        "DXF_unchanged": True,
    }, indent=2))


if __name__ == "__main__":
    main()
