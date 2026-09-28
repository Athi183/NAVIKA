from spatial_data import load_map
from graph import build_graph
from dijkstra import dijkstra


MAP_FILE = "../../data/campus_demo/demo_map.json"


data = load_map(MAP_FILE)

graph = build_graph(data)


print("===== DIJKSTRA TEST =====")


start = "N01"
goal = "N08"


result = dijkstra(
    graph,
    start,
    goal
)


if result:

    print("Start:", start)
    print("Goal:", goal)

    print("Shortest path:")
    print(" → ".join(result["path"]))

    print("Distance:", result["distance"])

else:

    print("No route found.")