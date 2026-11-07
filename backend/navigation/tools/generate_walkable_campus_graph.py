#!/usr/bin/env python3
"""Generate an auditable, review-gated walkable graph from Ground Floor through Floor 6."""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.navigation.walkable_graph import build_review_candidate_data, build_walkable_campus_graph

FLOORS = ("G", 1, 2, 3, 4, 5, 6)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def serializable_graph(graph, audit: dict) -> dict:
    edges = [{**edge.as_dict(), "bidirectional": False} for outgoing in graph.edges.values() for edge in outgoing]
    edges.sort(key=lambda edge: (edge["floor"] or "", edge["from"], edge["to"], edge["edge_id"] or ""))
    return {
        "schema_version": 1,
        "building": graph.metadata.get("building"),
        "included_floors": graph.metadata.get("included_floors", []),
        "status": (
            "reviewed_partial_walkable_graph"
            if graph.metadata.get("walkable_edge_count_directed", 0)
            else "incomplete_no_verified_walkable_edges"
        ),
        "costs": {
            "walking": graph.costs.walking,
            "stairs": graph.costs.stairs,
            "lift_journey": graph.costs.lift_journey,
            "units": "abstract navigation cost",
        },
        "coordinate_transform": "node CAD XY is transformed per floor with x = CAD_X - that floor's wall minX; z = -(CAD_Y - that floor's wall minY)",
        "metadata": graph.metadata,
        "nodes": [{"id": node_id, **attributes} for node_id, attributes in sorted(graph.nodes.items())],
        "edges": edges,
        "audit": audit,
    }


def generate(manifest_path: Path, graph_path: Path, audit_path: Path, candidates_path: Path) -> dict:
    floor_data = {}
    for floor in FLOORS:
        directory = ROOT / "public" / "data" / f"Ramanujan_F{floor}"
        floor_data[str(floor)] = {
            "walls": read_json(directory / "walls.json"),
            "semantics": read_json(directory / "semantics.json"),
            "floor_regions": read_json(directory / "floor_regions.json"),
        }
    vertical = read_json(ROOT / "public/data/campus_vertical_connections.json")
    manifest = read_json(manifest_path)
    graph, audit = build_walkable_campus_graph(vertical, floor_data, manifest)
    output = serializable_graph(graph, audit)
    review_data = build_review_candidate_data(floor_data, vertical, manifest)
    graph_path.parent.mkdir(parents=True, exist_ok=True)
    graph_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    audit_path.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    candidates_path.parent.mkdir(parents=True, exist_ok=True)
    candidates_path.write_text(json.dumps(review_data, indent=2) + "\n", encoding="utf-8")
    return audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "backend/navigation/walkable_connections_review.json")
    parser.add_argument("--graph", type=Path, default=ROOT / "public/data/campus_walkable_graph.json")
    parser.add_argument("--audit", type=Path, default=ROOT / "public/data/campus_walkable_graph_review.json")
    parser.add_argument("--candidates", type=Path, default=ROOT / "public/data/campus_walkable_review_candidates.json")
    args = parser.parse_args()
    audit = generate(args.manifest, args.graph, args.audit, args.candidates)
    print(json.dumps({
        "graph": str(args.graph.relative_to(ROOT)) if args.graph.is_relative_to(ROOT) else str(args.graph),
        "audit": str(args.audit.relative_to(ROOT)) if args.audit.is_relative_to(ROOT) else str(args.audit),
        "candidates": str(args.candidates.relative_to(ROOT)) if args.candidates.is_relative_to(ROOT) else str(args.candidates),
        "doorway_candidates": sum(len(row["candidate_ids"]) for row in json.loads(args.candidates.read_text(encoding="utf-8"))["floors"].values()),
        "room_node_count": audit["room_node_count"],
        "rooms_with_verified_entrances": audit["rooms_with_verified_entrances"],
        "verified_walk_edge_count_directed": audit["verified_walk_edge_count_directed"],
        "unconnected_connectors": len(audit["unconnected_connector_node_ids"]),
        "candidate_room_doorway_gaps": sum(bool(row["doorway_suggestions"]) for row in audit["candidate_door_gaps"]),
        "pending_connections": audit["pending_connection_count"],
        "rejected_connections": audit["rejected_connection_count"],
    }, indent=2))


if __name__ == "__main__":
    main()
