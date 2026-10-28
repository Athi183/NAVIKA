#!/usr/bin/env python3
"""Build an explicit connector-only graph for campus Floors 4, 5, and 6."""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FLOORS = (4, 5, 6)
TYPE_MAP = {"staircase": "stairs", "vertical_transport": "lift"}


def slug(name: str) -> str:
    match = re.fullmatch(r"(Staircase|Lift) ([A-Z])", name)
    if not match:
        raise ValueError(f"Unexpected connector name: {name!r}")
    return match.group(2).lower()


def load_floor(floor: int) -> tuple[dict, dict]:
    directory = ROOT / "public" / "data" / f"Ramanujan_F{floor}"
    walls = json.loads((directory / "walls.json").read_text())
    semantics = json.loads((directory / "semantics.json").read_text())
    return walls, semantics


def build() -> dict:
    nodes_by_floor = {}
    node_records = []
    for floor in FLOORS:
        walls, semantics = load_floor(floor)
        segments = walls["walls"]
        min_x = min(min(wall["x1"], wall["x2"]) for wall in segments)
        min_y = min(min(wall["y1"], wall["y2"]) for wall in segments)
        nodes = {}
        for place in semantics["places"]:
            connector_type = TYPE_MAP.get(place["type"])
            if connector_type is None:
                continue
            name = place["name"]
            key = (connector_type, name)
            if key in nodes:
                raise ValueError(f"Duplicate connector {name!r} on Floor {floor}")
            letter = slug(name)
            node_id = f"f{floor}:{connector_type}:{letter}"
            node = {
                "id": node_id,
                "floor": str(floor),
                "name": name,
                "type": connector_type,
                "cad": {"x": place["cadX"], "y": place["cadY"]},
                "floor_local": {
                    "x": round(place["cadX"] - min_x, 6),
                    "z": round(-(place["cadY"] - min_y), 6),
                },
                "coordinate_source": "semantic_place_position",
                "landing_position_verified": False,
                "corridor_access_verified": False,
            }
            nodes[key] = node
            node_records.append(node)
        nodes_by_floor[floor] = nodes

    edges = []
    unmatched = []
    alignment_diagnostics = []
    for lower, upper in zip(FLOORS, FLOORS[1:]):
        lower_nodes = nodes_by_floor[lower]
        upper_nodes = nodes_by_floor[upper]
        for key in sorted(set(lower_nodes) | set(upper_nodes)):
            first = lower_nodes.get(key)
            second = upper_nodes.get(key)
            if first is None or second is None:
                unmatched.append({
                    "between_floors": [str(lower), str(upper)],
                    "name": (first or second)["name"],
                    "type": key[0],
                    "present_on_floor": str(lower if first else upper),
                })
                continue
            connector_type, name = key
            edges.append({
                "id": f"{connector_type}:{slug(name)}:f{lower}-f{upper}",
                "from": first["id"],
                "to": second["id"],
                "name": name,
                "type": connector_type,
                "bidirectional": True,
                "vertical_cost_key": connector_type,
                "weight": None,
                "corridor_access_verified": False,
            })
            delta_x = second["floor_local"]["x"] - first["floor_local"]["x"]
            delta_z = second["floor_local"]["z"] - first["floor_local"]["z"]
            alignment_diagnostics.append({
                "edge_id": edges[-1]["id"],
                "semantic_anchor_delta_floor_local": {
                    "x": round(delta_x, 6),
                    "z": round(delta_z, 6),
                    "distance": round((delta_x * delta_x + delta_z * delta_z) ** 0.5, 6),
                },
                "interpretation": "Difference between semantic label positions only; not a verified landing alignment.",
            })

    return {
        "schema_version": 1,
        "building": "Ramanujan Block",
        "included_floors": [str(floor) for floor in FLOORS],
        "coordinate_convention": {
            "cad": "Source CAD XY, unchanged.",
            "floor_local": "Matches the current viewer: x = cadX - floor wall minX; z = -(cadY - floor wall minY). Each floor remains in its own local frame.",
            "globally_aligned": False,
        },
        "storey_elevations": {str(floor): None for floor in FLOORS},
        "vertical_costs": {"stairs": None, "lift": None},
        "nodes": sorted(node_records, key=lambda node: node["id"]),
        "edges": sorted(edges, key=lambda edge: edge["id"]),
        "unmatched_connectors": unmatched,
        "alignment_diagnostics": alignment_diagnostics,
        "routing_status": {
            "connector_edges_only": True,
            "weights_configured": False,
            "corridor_graph_available": False,
            "room_to_room_multifloor_routing_ready": False,
            "reason": "Landing-to-corridor links, globally verified landing coordinates, storey elevations, and vertical travel costs are not present in the source data.",
        },
        "visualization_status": {
            "multi_floor_rendering_enabled": False,
            "reason": "The viewer renders one floor at a time; shared alignment and storey elevations are unverified.",
        },
    }


def main() -> None:
    graph = build()
    output = ROOT / "public" / "data" / "campus_vertical_connections.json"
    output.write_text(json.dumps(graph, indent=2) + "\n")
    print(f"Wrote {len(graph['nodes'])} connector nodes and {len(graph['edges'])} vertical edges to {output.relative_to(ROOT)}")
    print(f"Unmatched connector pairs: {len(graph['unmatched_connectors'])}")


if __name__ == "__main__":
    main()
