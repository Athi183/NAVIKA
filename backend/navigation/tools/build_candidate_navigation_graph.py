"""Build a review-gated room-access graph scaffold from DXF extraction data.

Geometric gaps are doorway *candidates*, not confirmed doors. The generated
graph deliberately keeps horizontal room/access relationships out of `edges`
until they are reviewed. Only then may they be marked `verified` and routed.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_INPUT = REPOSITORY_ROOT / "frontend/src/data/ramanujan_floors_2_6.json"
DEFAULT_GRAPH = REPOSITORY_ROOT / "frontend/src/data/ramanujan_navigation_graph_candidate.json"
DEFAULT_REVIEW = REPOSITORY_ROOT / "rag/data/spatial/ramanujan_block/doorway_review_candidates.csv"
ROUTING_ASSUMPTIONS = {
    "status": "illustrative_not_surveyed",
    "floor_rise_m": 3.2,
    "walk_speed_mps": 1.2,
    "accessible_walk_speed_mps": 0.9,
    "stair_angle_degrees": 35,
    "stair_up_speed_mps": 0.55,
    "stair_down_speed_mps": 0.65,
    "lift_speed_mps": 1.5,
    "lift_wait_seconds_per_trip": 25,
    "lift_door_seconds_per_floor": 4,
}


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def doorway_candidates(floor: dict) -> list[dict]:
    """Find plausible collinear gaps between line endpoints for human review."""
    segments = []
    for index, raw in enumerate(floor["segments"]):
        a = (float(raw[0]), float(raw[1]))
        b = (float(raw[2]), float(raw[3]))
        length = distance(a, b)
        # Very short furniture/detail edges create a large number of false gaps.
        if 1.2 <= length <= 40.0:
            segments.append((index, a, b, length))

    endpoints = []
    for index, a, b, length in segments:
        endpoints.extend(((a, index, a, b, length), (b, index, a, b, length)))

    # A small spatial hash avoids a quadratic all-pairs search on dense plans.
    cell_size = 2.0
    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    for endpoint_index, endpoint in enumerate(endpoints):
        p = endpoint[0]
        buckets[(math.floor(p[0] / cell_size), math.floor(p[1] / cell_size))].append(endpoint_index)

    raw_candidates = []
    for endpoint_index, endpoint in enumerate(endpoints):
        p, segment_index, a, b, length = endpoint
        dx, dy = b[0] - a[0], b[1] - a[1]
        cx, cy = math.floor(p[0] / cell_size), math.floor(p[1] / cell_size)
        for cell_x in range(cx - 1, cx + 2):
            for cell_y in range(cy - 1, cy + 2):
                for other_index in buckets[(cell_x, cell_y)]:
                    if other_index <= endpoint_index:
                        continue
                    q, other_segment_index, c, d, other_length = endpoints[other_index]
                    if segment_index == other_segment_index:
                        continue
                    gap = distance(p, q)
                    if not 0.55 <= gap <= 1.8:
                        continue
                    ex, ey = d[0] - c[0], d[1] - c[1]
                    parallel = abs((dx * ex + dy * ey) / (length * other_length))
                    cross_track = abs(dx * (q[1] - p[1]) - dy * (q[0] - p[0])) / length
                    if parallel < 0.995 or cross_track > 0.08:
                        continue
                    midpoint = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
                    raw_candidates.append((midpoint, gap, segment_index, other_segment_index))

    # Parallel/double-drawn wall lines produce duplicate gaps. Collapse nearby
    # candidates but retain source segment indices as review evidence.
    collapsed = []
    for midpoint, width, first_segment, second_segment in sorted(raw_candidates, key=lambda item: item[1]):
        existing = next((row for row in collapsed if distance(midpoint, row["xy"]) <= 0.3), None)
        if existing:
            existing["source_segment_indices"].update((first_segment, second_segment))
            continue
        collapsed.append({
            "xy": midpoint,
            "width_candidate_m": width,
            "source_segment_indices": {first_segment, second_segment},
        })

    result = []
    for index, item in enumerate(collapsed, start=1):
        result.append({
            "node_id": f"{floor['floor_id']}_DOOR_CAND_{index:03d}",
            "floor_id": floor["floor_id"],
            "floor_number": floor["floor_number"],
            "node_type": "doorway_candidate",
            "label": f"Possible opening {index}",
            "x": round(item["xy"][0], 4),
            "y": round(item["xy"][1], 4),
            "width_candidate_m": round(item["width_candidate_m"], 3),
            "source_segment_indices": sorted(item["source_segment_indices"]),
            "review_status": "unreviewed_geometric_gap_candidate",
            "route_eligible": False,
        })
    return result


def build_graph(data: dict) -> tuple[dict, list[dict]]:
    nodes = []
    edges = []
    review_rows = []
    for floor in data["floors"]:
        room_nodes = []
        for index, label in enumerate(floor["labels"], start=1):
            node = {
                "node_id": f"{floor['floor_id']}_ROOM_{index:03d}",
                "building_id": data["building"]["building_id"],
                "floor_id": floor["floor_id"],
                "floor_number": floor["floor_number"],
                "node_type": "room_label_candidate",
                "label": label["text"],
                "x": round(label["xy"][0], 4),
                "y": round(label["xy"][1], 4),
                "source_xy_dxf": label.get("source_xy_dxf"),
                "display_xy": label.get("display_xy", label["xy"]),
                "review_status": "unreviewed_label_not_room_entrance",
                "route_eligible": False,
            }
            nodes.append(node)
            room_nodes.append(node)

        connector_nodes = []
        for connector in floor["connectors"]:
            candidates = [
                item for item in data["vertical_connectors"]
                if item["type"] == connector["type"] and str(floor["floor_number"]) in item["stops"]
            ]
            matched = min(
                candidates,
                key=lambda item: distance(tuple(item["stops"][str(floor["floor_number"])]), tuple(connector["xy"])),
                default=None,
            )
            connector_key = matched["id"].upper() if matched else f"{connector['type'].upper()}_UNMATCHED_{len(connector_nodes) + 1:02d}"
            node = {
                "node_id": f"{floor['floor_id']}_{connector_key}",
                "building_id": data["building"]["building_id"],
                "floor_id": floor["floor_id"],
                "floor_number": floor["floor_number"],
                "node_type": f"{connector['type']}_landing_candidate",
                "label": connector["text"],
                "x": round(connector["xy"][0], 4),
                "y": round(connector["xy"][1], 4),
                "source_xy_dxf": connector.get("source_xy_dxf"),
                "review_status": "unreviewed_connector_marker",
                "route_eligible": False,
            }
            nodes.append(node)
            connector_nodes.append(node)

        doors = doorway_candidates(floor)
        nodes.extend(doors)
        explicit_doors = []
        for index, source in enumerate(floor.get("door_entity_candidates", []), start=1):
            node = {
                "node_id": f"{floor['floor_id']}_DOOR_ENTITY_{index:03d}",
                "building_id": data["building"]["building_id"],
                "floor_id": floor["floor_id"],
                "floor_number": floor["floor_number"],
                "node_type": "door_entity_candidate",
                "label": f"DXF door block {index}",
                "x": source["xy"][0],
                "y": source["xy"][1],
                "width_candidate_m": source["width_candidate_m"],
                "source_block": source["source_block"],
                "source_layer": source["source_layer"],
                "source_xy_dxf": source["source_xy_dxf"],
                "evidence": source["evidence"],
                "review_status": source["review_status"],
                "route_eligible": False,
            }
            nodes.append(node)
            explicit_doors.append(node)

        # Keep nearest geometric gap suggestions as a review worklist only.
        # They are not edges and are never used by a route solver.
        for room in room_nodes:
            nearest = sorted(
                doors,
                key=lambda door: distance((room["x"], room["y"]), (door["x"], door["y"])),
            )[:3]
            for rank, door in enumerate(nearest, start=1):
                d = distance((room["x"], room["y"]), (door["x"], door["y"]))
                review_rows.append({
                    "building_id": room["building_id"],
                    "floor_id": room["floor_id"],
                    "room_node_id": room["node_id"],
                    "room_label": room["label"],
                    "candidate_door_node_id": door["node_id"],
                    "candidate_node_type": door["node_type"],
                    "candidate_x": door["x"],
                    "candidate_y": door["y"],
                    "candidate_gap_width_m": door["width_candidate_m"],
                    "candidate_evidence": "collinear_wall_endpoint_gap",
                    "candidate_source_block": "",
                    "distance_to_label_m": round(d, 3),
                    "rank": rank,
                    "review_status": "unreviewed_suggestion_only",
                    "reviewer_confirmed_room_access": "",
                })
            explicit_nearest = sorted(
                explicit_doors,
                key=lambda door: distance((room["x"], room["y"]), (door["x"], door["y"])),
            )[:3]
            for rank, door in enumerate(explicit_nearest, start=1):
                d = distance((room["x"], room["y"]), (door["x"], door["y"]))
                review_rows.append({
                    "building_id": room["building_id"],
                    "floor_id": room["floor_id"],
                    "room_node_id": room["node_id"],
                    "room_label": room["label"],
                    "candidate_door_node_id": door["node_id"],
                    "candidate_node_type": door["node_type"],
                    "candidate_x": door["x"],
                    "candidate_y": door["y"],
                    "candidate_gap_width_m": door["width_candidate_m"],
                    "candidate_evidence": door["evidence"],
                    "candidate_source_block": door["source_block"],
                    "distance_to_label_m": round(d, 3),
                    "rank": rank,
                    "review_status": "unreviewed_suggestion_only",
                    "reviewer_confirmed_room_access": "",
                })

    for transition in data["vertical_transitions"]:
        connector = next(item for item in data["vertical_connectors"] if item["id"] == transition["connector_id"])
        floor_count = abs(transition["to_floor"] - transition["from_floor"])
        rise_m = ROUTING_ASSUMPTIONS["floor_rise_m"] * floor_count
        if connector["type"] == "stair":
            incline_m = rise_m / math.sin(math.radians(ROUTING_ASSUMPTIONS["stair_angle_degrees"]))
            estimated_distance_m = incline_m + float(transition.get("plan_offset_m") or 0)
            estimated_up_time_s = incline_m / ROUTING_ASSUMPTIONS["stair_up_speed_mps"]
            estimated_down_time_s = incline_m / ROUTING_ASSUMPTIONS["stair_down_speed_mps"]
            estimated_time_s = estimated_up_time_s if transition["to_floor"] > transition["from_floor"] else estimated_down_time_s
        else:
            estimated_distance_m = rise_m
            estimated_time_s = rise_m / ROUTING_ASSUMPTIONS["lift_speed_mps"] + ROUTING_ASSUMPTIONS["lift_door_seconds_per_floor"] * floor_count
            estimated_up_time_s = estimated_time_s
            estimated_down_time_s = estimated_time_s
        edges.append({
            "edge_id": transition["id"],
            "building_id": data["building"]["building_id"],
            "source_node_id": f"{data['building']['building_id']}_{transition['from_floor']:02d}_{connector['id'].upper()}",
            "target_node_id": f"{data['building']['building_id']}_{transition['to_floor']:02d}_{connector['id'].upper()}",
            "edge_type": f"{connector['type']}_floor_transition",
            "connector_id": connector["id"],
            "plan_offset_m": transition.get("plan_offset_m"),
            "estimated_distance_m": round(estimated_distance_m, 2),
            "estimated_time_s_without_wait": round(estimated_time_s, 1),
            "estimated_time_s_up_without_wait": round(estimated_up_time_s, 1),
            "estimated_time_s_down_without_wait": round(estimated_down_time_s, 1),
            "lift_wait_seconds_per_trip_assumption": ROUTING_ASSUMPTIONS["lift_wait_seconds_per_trip"] if connector["type"] == "lift" else 0,
            "cost_status": "illustrative_assumption_not_surveyed",
            "from_floor": transition["from_floor"],
            "to_floor": transition["to_floor"],
            "review_status": "candidate_requires_landing_review",
            "route_eligible": False,
        })

    graph = {
        "schema_version": "navika-room-graph-0.1",
        "building": data["building"],
        "status": "review_scaffold_no_verified_horizontal_edges",
        "coordinate_system": {"units": data["building"]["units"], "floor_elevation": "diagrammatic_only"},
        "routing_assumptions": ROUTING_ASSUMPTIONS,
        "nodes": nodes,
        "edges": edges,
        "routing_policy": "Only edges explicitly marked review_status=verified and route_eligible=true may be used for wayfinding.",
        "review_summary": {
            "room_label_nodes": sum(node["node_type"] == "room_label_candidate" for node in nodes),
            "doorway_gap_candidates": sum(node["node_type"] == "doorway_candidate" for node in nodes),
            "explicit_door_block_candidates": sum(node["node_type"] == "door_entity_candidate" for node in nodes),
            "vertical_edges": len(edges),
            "verified_horizontal_edges": 0,
            "verified_edges": 0,
        },
    }
    return graph, review_rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--graph", type=Path, default=DEFAULT_GRAPH)
    parser.add_argument("--review-csv", type=Path, default=DEFAULT_REVIEW)
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    graph, review_rows = build_graph(data)
    args.graph.parent.mkdir(parents=True, exist_ok=True)
    args.graph.write_text(json.dumps(graph, indent=2) + "\n", encoding="utf-8")
    args.review_csv.parent.mkdir(parents=True, exist_ok=True)
    columns = list(review_rows[0]) if review_rows else []
    with args.review_csv.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(review_rows)
    print(json.dumps({"graph": str(args.graph), "review_csv": str(args.review_csv), **graph["review_summary"]}, indent=2))


if __name__ == "__main__":
    main()
