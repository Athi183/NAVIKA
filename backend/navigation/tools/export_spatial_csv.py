"""Export the DXF-only multi-floor data to semantic, topological, and geometric CSVs."""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_INPUT = REPOSITORY_ROOT / "frontend/src/data/ramanujan_floors_2_6.json"
DEFAULT_OUTPUT = REPOSITORY_ROOT / "rag/data/spatial/ramanujan_block"
ROUTING_ASSUMPTIONS = {
    "floor_rise_m": 3.2,
    "stair_angle_degrees": 35,
    "stair_up_speed_mps": 0.55,
    "stair_down_speed_mps": 0.65,
    "lift_speed_mps": 1.5,
    "lift_wait_seconds_per_trip": 25,
    "lift_door_seconds_per_floor": 4,
}


def write_csv(path: Path, columns: list[str], rows: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def leading_room_number(label: str) -> str:
    match = re.match(r"^\s*(\d{3,4}(?:\s*/\s*\d{3,4})?)\b", label)
    return re.sub(r"\s+", "", match.group(1)) if match else ""


def export(data: dict, destination: Path) -> dict[str, int]:
    building = data["building"]
    building_id = building["building_id"]
    source_file = building["source_file"]
    units = building["units"]
    places = []
    nodes = []
    geometry = []
    floor_summaries = []

    for floor in data["floors"]:
        number = floor["floor_number"]
        floor_id = floor["floor_id"]
        raw_points = []
        for index, label in enumerate(floor["labels"]):
            x, y = label["xy"]
            display_x, display_y = label.get("display_xy", label["xy"])
            source_x, source_y = label.get("source_xy_dxf", label["xy"])
            place_id = f"{floor_id}_PLACE_{index + 1:04d}"
            text = label["text"].strip()
            search_text = (
                f"{text} is a text label extracted from the DXF for {building.get('building_label', building_id)}, "
                f"{floor['label']}. Its extracted registered anchor is x={x:.3f}, y={y:.3f} {units}; "
                f"the visualization anchor is x={display_x:.3f}, y={display_y:.3f} {units} "
                f"({label.get('display_xy_status', 'same_as_extracted_anchor')}). "
                "It is an unreviewed label anchor, not a verified room boundary, entrance, or route node."
            )
            places.append({
                "place_id": place_id,
                "building_id": building_id,
                "floor_id": floor_id,
                "floor_number": number,
                "room_number": leading_room_number(text),
                "display_name": text,
                "aliases": "",
                "entity_type": "dxf_text_label_candidate",
                "source_file": source_file,
                "source_text": text,
                "source_x": f"{source_x:.4f}",
                "source_y": f"{source_y:.4f}",
                "source_z": "",
                "registered_x": f"{x:.4f}",
                "registered_y": f"{y:.4f}",
                "display_x": f"{display_x:.4f}",
                "display_y": f"{display_y:.4f}",
                "display_xy_status": label.get("display_xy_status", "same_as_extracted_anchor"),
                "source_units": units,
                "coordinate_transform": "title_based_Y_translation_candidate",
                "extraction_confidence": "text_extracted; semantic_mapping_unreviewed",
                "review_status": "unreviewed_candidate",
                "access_node_id": "",
                "search_text": search_text,
            })
            nodes.append({
                "node_id": place_id,
                "building_id": building_id,
                "floor_id": floor_id,
                "floor_number": number,
                "node_type": "label_anchor_not_access_node",
                "label": text,
                "x": f"{x:.4f}",
                "y": f"{y:.4f}",
                "source_x": f"{source_x:.4f}",
                "source_y": f"{source_y:.4f}",
                "z_diagrammatic": f"{floor['diagram_elevation_m']:.3f}",
                "units": units,
                "verification_status": "not_routable_without_entrance_review",
                "source_file": source_file,
                "source_text": text,
            })

        for connector in floor["connectors"]:
            x, y = connector["xy"]
            source_x, source_y = connector.get("source_xy_dxf", connector["xy"])
            node_id = f"{connector['type']}_{'west' if connector['type'] == 'stair' and x < 45 else 'center' if connector['type'] == 'stair' or x < 80 else 'east'}_F{number:02d}"
            nodes.append({
                "node_id": node_id,
                "building_id": building_id,
                "floor_id": floor_id,
                "floor_number": number,
                "node_type": f"{connector['type']}_landing_candidate",
                "label": connector["marker"],
                "x": f"{x:.4f}",
                "y": f"{y:.4f}",
                "source_x": f"{source_x:.4f}",
                "source_y": f"{source_y:.4f}",
                "z_diagrammatic": f"{floor['diagram_elevation_m']:.3f}",
                "units": units,
                "verification_status": "candidate_from_repeated_DXF_label",
                "source_file": source_file,
                "source_text": connector["text"],
            })

        source_segments = floor.get("segments_source_dxf", floor["segments"])
        if len(source_segments) != len(floor["segments"]):
            raise ValueError(f"Source and registered linework counts differ for floor {number}")
        for index, ((x1, y1, x2, y2), (source_x1, source_y1, source_x2, source_y2)) in enumerate(zip(floor["segments"], source_segments)):
            raw_points.extend(((x1, y1), (x2, y2)))
            geometry.append({
                "geometry_id": f"{floor_id}_SEGMENT_{index + 1:05d}",
                "building_id": building_id,
                "floor_id": floor_id,
                "floor_number": number,
                "geometry_type": "line_segment",
                "x1": f"{x1:.4f}",
                "y1": f"{y1:.4f}",
                "x2": f"{x2:.4f}",
                "y2": f"{y2:.4f}",
                "source_x1": f"{source_x1:.4f}",
                "source_y1": f"{source_y1:.4f}",
                "source_x2": f"{source_x2:.4f}",
                "source_y2": f"{source_y2:.4f}",
                "midpoint_x": f"{(x1 + x2) / 2:.4f}",
                "midpoint_y": f"{(y1 + y2) / 2:.4f}",
                "length": f"{((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5:.4f}",
                "units": units,
                "coordinate_transform": "title_based_Y_translation_candidate",
                "geometry_role": "unclassified_dxf_linework",
                "review_status": "extracted_visual_geometry_not_validated_as_wall_or_walkable_area",
                "source_file": source_file,
            })

        if raw_points:
            xs, ys = zip(*raw_points)
            floor_summaries.append({
                "building_id": building_id,
                "floor_id": floor_id,
                "floor_number": number,
                "floor_label": floor["label"],
                "source_file": source_file,
                "units": units,
                "segment_count": len(floor["segments"]),
                "label_count": len(floor["labels"]),
                "connector_marker_count": len(floor["connectors"]),
                "bounds_min_x": f"{min(xs):.4f}",
                "bounds_max_x": f"{max(xs):.4f}",
                "bounds_min_y": f"{min(ys):.4f}",
                "bounds_max_y": f"{max(ys):.4f}",
                "diagram_elevation_m": f"{floor['diagram_elevation_m']:.3f}",
                "elevation_status": "illustrative_not_measured",
                "search_text": (
                    f"{building.get('building_label', building_id)}, {floor['label']}: "
                    f"{len(floor['labels'])} extracted text labels and {len(floor['segments'])} unclassified DXF line segments. "
                    f"Registered plan bounds x {min(xs):.2f} to {max(xs):.2f} {units}, "
                    f"y {min(ys):.2f} to {max(ys):.2f} {units}. "
                    "Vertical elevation is diagrammatic and linework has not been classified as verified walls or walkable space."
                ),
            })

    topology_edges = []
    for transition in data["vertical_transitions"]:
        connector_id = transition["connector_id"]
        connector = next(item for item in data["vertical_connectors"] if item["id"] == connector_id)
        def stop_node(floor_number):
            keys = [key for key in connector["stops"] if key == str(floor_number)]
            if not keys:
                return ""
            point = connector["stops"][keys[0]]
            return next(
                node["node_id"] for node in nodes
                if node["floor_number"] == floor_number
                and node["node_type"] == f"{connector['type']}_landing_candidate"
                and node["x"] == f"{point[0]:.4f}"
                and node["y"] == f"{point[1]:.4f}"
            )
        def raw_stop(floor_number):
            floor_data = next(item for item in data["floors"] if item["floor_number"] == floor_number)
            point = connector["stops"][str(floor_number)]
            marker = next(
                item for item in floor_data["connectors"]
                if item["type"] == connector["type"] and item["xy"] == point
            )
            return marker.get("source_xy_dxf", marker["xy"])
        from_source = raw_stop(transition["from_floor"])
        to_source = raw_stop(transition["to_floor"])
        floor_count = abs(transition["to_floor"] - transition["from_floor"])
        assumed_rise_m = ROUTING_ASSUMPTIONS["floor_rise_m"] * floor_count
        if connector["type"] == "stair":
            stair_angle = math.radians(ROUTING_ASSUMPTIONS["stair_angle_degrees"])
            vertical_walk_m = assumed_rise_m / math.sin(stair_angle)
            estimated_distance = vertical_walk_m + float(transition.get("plan_offset_m") or 0)
            estimated_up_time = vertical_walk_m / ROUTING_ASSUMPTIONS["stair_up_speed_mps"]
            estimated_down_time = vertical_walk_m / ROUTING_ASSUMPTIONS["stair_down_speed_mps"]
            estimated_time = estimated_up_time if transition["to_floor"] > transition["from_floor"] else estimated_down_time
            lift_wait = 0
        else:
            estimated_distance = assumed_rise_m
            estimated_time = assumed_rise_m / ROUTING_ASSUMPTIONS["lift_speed_mps"] + ROUTING_ASSUMPTIONS["lift_door_seconds_per_floor"] * floor_count
            estimated_up_time = estimated_time
            estimated_down_time = estimated_time
            lift_wait = ROUTING_ASSUMPTIONS["lift_wait_seconds_per_trip"]
        topology_edges.append({
            "edge_id": transition["id"],
            "building_id": building_id,
            "source_node_id": stop_node(transition["from_floor"]),
            "target_node_id": stop_node(transition["to_floor"]),
            "connector_id": connector_id,
            "connector_label": connector["label"],
            "edge_type": f"candidate_{connector['type']}_floor_transition",
            "from_floor": transition["from_floor"],
            "to_floor": transition["to_floor"],
            "from_x": f"{transition['from_xy'][0]:.4f}",
            "from_y": f"{transition['from_xy'][1]:.4f}",
            "to_x": f"{transition['to_xy'][0]:.4f}",
            "to_y": f"{transition['to_xy'][1]:.4f}",
            "source_from_x": f"{from_source[0]:.4f}",
            "source_from_y": f"{from_source[1]:.4f}",
            "source_to_x": f"{to_source[0]:.4f}",
            "source_to_y": f"{to_source[1]:.4f}",
            "plan_offset_m": f"{transition['plan_offset_m']:.3f}",
            "estimated_distance_m": f"{estimated_distance:.2f}",
            "estimated_time_s_without_trip_wait": f"{estimated_time:.1f}",
            "estimated_time_s_up_without_wait": f"{estimated_up_time:.1f}",
            "estimated_time_s_down_without_wait": f"{estimated_down_time:.1f}",
            "lift_wait_s_once_per_trip_assumption": lift_wait,
            "time_cost_status": "illustrative_assumption_not_surveyed",
            "assumed_floor_rise_m": f"{ROUTING_ASSUMPTIONS['floor_rise_m']:.2f}",
            "assumed_stair_angle_degrees": ROUTING_ASSUMPTIONS["stair_angle_degrees"] if connector["type"] == "stair" else "",
            "assumed_lift_speed_mps": ROUTING_ASSUMPTIONS["lift_speed_mps"] if connector["type"] == "lift" else "",
            "units": units,
            "verification_status": "candidate_requires_landing_and_continuity_review",
            "accessibility_status": "unknown",
            "source_file": source_file,
            "source_text": "Repeated UP/LIFT markers; continuity is inferred, not verified.",
            "search_text": (
                f"Candidate {connector['type']} connection, {connector['label']}, from floor "
                f"{transition['from_floor']} to floor {transition['to_floor']} in "
                f"{building.get('building_label', building_id)}. The DXF has repeated {connector['marker']} labels. "
                f"Illustrative one-transition estimate: {estimated_distance:.1f}m and {estimated_up_time:.0f}s ascending / {estimated_down_time:.0f}s descending before lift wait. "
                f"Illustrative cost assumes {ROUTING_ASSUMPTIONS['floor_rise_m']:.1f}m floor rise; "
                + (f"{ROUTING_ASSUMPTIONS['stair_angle_degrees']} degree stair angle and {ROUTING_ASSUMPTIONS['stair_up_speed_mps']:.2f}/{ROUTING_ASSUMPTIONS['stair_down_speed_mps']:.2f}m/s up/down stair speeds. " if connector["type"] == "stair" else f"{ROUTING_ASSUMPTIONS['lift_speed_mps']:.1f}m/s lift speed and {ROUTING_ASSUMPTIONS['lift_wait_seconds_per_trip']}s wait once per trip. ")
                + "Connection, landing geometry, actual time, and accessibility are not verified; do not treat as a confirmed route."
            ),
        })

    columns = {
        "places.csv": list(places[0].keys()) if places else [],
        "topology_nodes.csv": list(nodes[0].keys()) if nodes else [],
        "topology_edges.csv": list(topology_edges[0].keys()) if topology_edges else [],
        "geometry.csv": list(geometry[0].keys()) if geometry else [],
        "floor_summaries.csv": list(floor_summaries[0].keys()) if floor_summaries else [],
    }
    rows_by_name = {
        "places.csv": places,
        "topology_nodes.csv": nodes,
        "topology_edges.csv": topology_edges,
        "geometry.csv": geometry,
        "floor_summaries.csv": floor_summaries,
    }
    for name, rows in rows_by_name.items():
        write_csv(destination / name, columns[name], rows)
    return {name: len(rows) for name, rows in rows_by_name.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    counts = export(data, args.output_dir)
    print(json.dumps({"output_dir": str(args.output_dir), "rows": counts}, indent=2))


if __name__ == "__main__":
    main()
