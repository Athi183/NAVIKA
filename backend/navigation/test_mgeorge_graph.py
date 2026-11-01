import json
import math
from pathlib import Path

from graph import NavigationGraph
from dijkstra import dijkstra


GRAPH_FILE = Path(__file__).resolve().parents[2] / "frontend/public/data/MGeorge_nav/floor_01_walkable_graph.json"


data = json.loads(GRAPH_FILE.read_text())

graph = NavigationGraph()

for node in data["nodes"]:
    graph.add_node(node["id"], node["x"], node["y"], node["floor"])

for edge in data["edges"]:
    # Weights are walked centreline lengths, never shorter than the straight line.
    straight = graph.calculate_distance(edge["from"], edge["to"])
    assert edge["weight_m"] >= straight - 0.01, edge
    graph.add_edge(edge["from"], edge["to"], edge["weight_m"])
    graph.add_edge(edge["to"], edge["from"], edge["weight_m"])


print("===== M. GEORGE KIOSK GRAPH TEST =====")
print("Nodes:", len(data["nodes"]), "Edges:", len(data["edges"]))

kiosk = data["kiosk"]
assert kiosk["node"] in graph.nodes

ids = [place["id"] for place in data["destinations"]]
assert len(ids) == len(set(ids)), "destination ids must be unique"


for place in data["destinations"]:

    result = dijkstra(graph, kiosk["node"], place["node"])

    assert result, f"no route from the kiosk to {place['name']}"

    # The building is ~135 m end to end; a longer walk means a broken graph.
    assert result["distance"] < 200, (place["name"], result["distance"])

    # Walking distance can never beat the straight line between the nodes.
    start, goal = graph.nodes[kiosk["node"]], graph.nodes[place["node"]]
    straight = math.hypot(start["x"] - goal["x"], start["y"] - goal["y"])
    assert result["distance"] >= straight - 0.01, place["name"]

    print(f"{place['name']:<40} {result['distance']:6.1f} m  ({len(result['path'])} nodes)")


print("All", len(data["destinations"]), "destinations reachable from the kiosk.")
