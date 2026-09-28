from spatial_data import load_map


data = load_map("../../data/campus_demo/demo_map.json")

print("Building:", data["building"])
print("Number of nodes:", len(data["nodes"]))
print("Number of locations:", len(data["locations"]))
print("Number of edges:", len(data["edges"]))