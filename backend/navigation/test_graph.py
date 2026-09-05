from spatial_data import load_map
from graph import build_graph


MAP_FILE = "../../data/campus_demo/demo_map.json"


data = load_map(MAP_FILE)

graph = build_graph(data)

print("----- GRAPH TEST -----")

print("Number of nodes:", len(graph.nodes))

print("Number of graph connections:")

total_connections = sum(
    len(neighbors)
    for neighbors in graph.edges.values()
)

print(total_connections)

print("\nNodes:")

for node_id, info in graph.nodes.items():

    print(
        node_id,
        "=>",
        f"({info['x']}, {info['y']})"
    )

print("\nConnections:")

for node_id, neighbors in graph.edges.items():

    print(node_id, "->", neighbors)

print("\n----- DISTANCE TEST -----")

distance = graph.calculate_distance("N01", "N02")

print("Distance N01 → N02:", distance)