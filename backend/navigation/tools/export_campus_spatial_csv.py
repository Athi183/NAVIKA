"""Export the Varnam campus-site extraction to review-aware spatial CSVs."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_INPUT = REPOSITORY_ROOT / "frontend/src/data/varnam_college_site_candidate.json"
DEFAULT_OUTPUT = REPOSITORY_ROOT / "rag/data/spatial/varnam_college"


def write_csv(path: Path, fieldnames: list[str], rows: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    site = json.loads(args.input.read_text(encoding="utf-8"))

    landmark_fields = ["building_id", "place_id", "display_name", "category", "source_x", "source_y", "source_units", "source_layer", "review_status"]
    landmarks = [{
        "building_id": site["building_id"], "place_id": item["id"], "display_name": item["label"],
        "category": item["category"], "source_x": item["x"], "source_y": item["y"],
        "source_units": site["source_unit_label"], "source_layer": item["source_layer"],
        "review_status": item["review_status"],
    } for item in site["features"]]
    write_csv(args.output_dir / "places.csv", landmark_fields, landmarks)

    node_fields = ["node_id", "building_id", "node_type", "label", "x", "y", "source_units", "source_layer", "review_status", "route_eligible"]
    nodes = [{
        "node_id": item["id"], "building_id": site["building_id"], "node_type": item["category"],
        "label": item["label"], "x": item["x"], "y": item["y"], "source_units": site["source_unit_label"],
        "source_layer": item["source_layer"], "review_status": item["review_status"], "route_eligible": "false",
    } for item in site["features"]]
    for index, item in enumerate(site["floor_labels"], start=1):
        nodes.append({
            "node_id": f"floor_label_{index:03d}", "building_id": site["building_id"],
            "node_type": "unassigned_floor_label", "label": item["text"], "x": item["x"], "y": item["y"],
            "source_units": site["source_unit_label"], "source_layer": item["source_layer"],
            "review_status": item["status"], "route_eligible": "false",
        })
    write_csv(args.output_dir / "topology_nodes.csv", node_fields, nodes)

    geometry_fields = ["segment_id", "building_id", "layer", "x1", "y1", "x2", "y2", "source_units", "review_status", "route_eligible"]
    geometry_rows = []
    counter = 0
    for layer, segments in site["layer_segments"].items():
        for x1, y1, x2, y2 in segments:
            counter += 1
            geometry_rows.append({
                "segment_id": f"VARNAM_SEG_{counter:06d}", "building_id": site["building_id"], "layer": layer,
                "x1": x1, "y1": y1, "x2": x2, "y2": y2, "source_units": site["source_unit_label"],
                "review_status": "unclassified_cad_linework", "route_eligible": "false",
            })
    write_csv(args.output_dir / "geometry.csv", geometry_fields, geometry_rows)

    edge_fields = ["edge_id", "building_id", "from_node_id", "to_node_id", "edge_type", "distance", "source_units", "review_status", "route_eligible"]
    write_csv(args.output_dir / "topology_edges.csv", edge_fields, [])
    write_csv(args.output_dir / "floor_labels.csv", ["building_id", "label", "source_x", "source_y", "source_units", "source_layer", "review_status", "assigned_building_id"], [
        {"building_id": site["building_id"], "label": item["text"], "source_x": item["x"], "source_y": item["y"],
         "source_units": site["source_unit_label"], "source_layer": item["source_layer"], "review_status": item["status"], "assigned_building_id": ""}
        for item in site["floor_labels"]
    ])
    print(json.dumps({"output_dir": str(args.output_dir), "landmarks": len(landmarks), "nodes": len(nodes), "geometry_segments": len(geometry_rows), "topology_edges": 0, "unassigned_floor_labels": len(site["floor_labels"])}, indent=2))


if __name__ == "__main__":
    main()
