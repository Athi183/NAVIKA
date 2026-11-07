#!/usr/bin/env python3
"""Query an exported campus graph by node ID and print a JSON route result."""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.navigation.dijkstra import dijkstra
from backend.navigation.graph import build_graph


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="Source graph node ID, e.g. f4:place:room_501")
    parser.add_argument("destination", help="Destination graph node ID")
    parser.add_argument("--graph", type=Path, default=ROOT / "public/data/campus_walkable_graph.json")
    args = parser.parse_args()

    data = json.loads(args.graph.read_text(encoding="utf-8"))
    graph = build_graph({"nodes": data["nodes"], "edges": data["edges"]})
    result = dijkstra(graph, args.source, args.destination)
    result["graph_status"] = data.get("status")
    print(json.dumps(result, indent=2))
    if result["status"] != "ok":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
