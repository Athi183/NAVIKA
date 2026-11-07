import json
from pathlib import Path

from graph import NavigationGraph
from dijkstra import dijkstra


DATA_DIR = Path(__file__).resolve().parents[2] / "frontend/public/data/MGeorge_nav"


building = json.loads((DATA_DIR / "building.json").read_text())
floors = {spec["floor_number"]: json.loads((DATA_DIR / spec["graph"]).read_text()) for spec in building["floors"]}
shafts = {shaft["id"]: shaft for shaft in building["shafts"]}


def make_graph(step_free):
    graph = NavigationGraph()
    for number, floor in floors.items():
        for node in floor["nodes"]:
            graph.add_node(node["id"], node["x"], node["y"], number)
    for node in building["vertical_nodes"]:
        graph.add_node(node["id"], node["x"], node["y"], node["floor"])
    edges = [edge for floor in floors.values() for edge in floor["edges"]]
    for edge in building["vertical_edges"]:
        shaft = shafts[edge["shaft"]]
        # Same rules as the kiosk: no fire escape stairs; step-free uses lifts only.
        if not shaft["routable"] or (step_free and shaft["kind"] != "lift"):
            continue
        edges.append(edge)
    for edge in edges:
        graph.add_edge(edge["from"], edge["to"], edge["weight_m"])
        graph.add_edge(edge["to"], edge["from"], edge["weight_m"])
    return graph


print("===== M. GEORGE BUILDING ROUTING TEST =====")

kiosk_floor = floors[building["kiosk_floor"]]
kiosk_node = kiosk_floor["kiosk"]["node"]

ids = [place["id"] for floor in floors.values() for place in floor["destinations"]]
assert len(ids) == len(set(ids)), "destination ids must be unique across floors"

for shaft in building["shafts"]:
    assert len(shaft["floors"]) >= 2, shaft

# The kiosk offers places that are in use and reachable; the build flags them.
offered = [(n, p) for n, f in floors.items() for p in f["destinations"] if p.get("in_use", True) and p.get("reachable", True)]
hidden = [(n, p["name"]) for n, f in floors.items() for p in f["destinations"] if p.get("in_use", True) and not p.get("reachable", True)]
# Above the parking level every place must be reachable.
assert not [h for h in hidden if h[0] != 0], hidden

for step_free in (False, True):
    graph = make_graph(step_free)
    for number, place in offered:
        result = dijkstra(graph, kiosk_node, place["node"])
        # The step_free flag must agree with an actual lifts-only route.
        if step_free and not place.get("step_free", True):
            assert result is None, f"{place['name']} is flagged as not step-free but has a lifts-only route"
            continue
        assert result, f"no {'step-free ' if step_free else ''}route to {place['name']} ({number})"
        # Corridors plus a few storeys of stairs/lifts; far more means a broken join.
        assert result["distance"] < 400, (place["name"], result["distance"])
    print(("Step-free" if step_free else "Any route").ljust(10), "- all", len(offered), "offered destinations checked")

print("Hidden (not reachable with the stairs/lifts in use):", ", ".join(f"{name} (floor {n})" for n, name in hidden) or "none")

print("Shafts:", ", ".join(f"{s['name']} {s['floors'][0]}-{s['floors'][-1]}" for s in building["shafts"] if s["routable"]))

# Outdoor campus paths, joined at the main entrance (scripts/build_campus_nav_graph.py).
site_file = DATA_DIR / "site_graph.json"
if site_file.exists():
    site = json.loads(site_file.read_text())
    graph = make_graph(False)
    for node in site["nodes"]:
        graph.add_node(node["id"], node["x"], node["y"], "site")
    for edge in site["edges"]:
        graph.add_edge(edge["from"], edge["to"], edge["weight_m"])
        graph.add_edge(edge["to"], edge["from"], edge["weight_m"])
    for link in site["links"]:
        graph.add_edge(link["indoor_node"], link["site_node"], link["weight_m"])
        graph.add_edge(link["site_node"], link["indoor_node"], link["weight_m"])
    for place in site["destinations"]:
        result = dijkstra(graph, kiosk_node, place["node"])
        assert result, f"no outdoor route to {place['name']}"
        assert result["distance"] < 800, (place["name"], result["distance"])
    print("Outdoor    - all", len(site["destinations"]), "campus places reachable through the main entrance")

# Ramanujan Block floors 4-6 over the Second Floor bridge (scripts/build_ramanujan_nav_graph.py).
RAMANUJAN_DIR = DATA_DIR.parent / "Ramanujan_nav"
if (RAMANUJAN_DIR / "building.json").exists():
    annex = json.loads((RAMANUJAN_DIR / "building.json").read_text())
    annex_floors = {spec["floor_number"]: json.loads((RAMANUJAN_DIR / spec["graph"]).read_text()) for spec in annex["floors"]}
    for step_free in (False, True):
        graph = make_graph(step_free)
        for number, floor in annex_floors.items():
            for node in floor["nodes"]:
                graph.add_node(node["id"], node["x"], node["y"], number)
        for node in annex["vertical_nodes"]:
            graph.add_node(node["id"], node["x"], node["y"], node["floor"])
        edges = [edge for floor in annex_floors.values() for edge in floor["edges"]]
        edges += [edge for edge in annex["vertical_edges"] if not (step_free and edge["kind"] == "stairs")]
        edges += [{"from": link["from_node"], "to": link["to_node"], "weight_m": link["weight_m"]} for link in annex["links"]]
        for edge in edges:
            graph.add_edge(edge["from"], edge["to"], edge["weight_m"])
            graph.add_edge(edge["to"], edge["from"], edge["weight_m"])
        places = [(n, p) for n, f in annex_floors.items() for p in f["destinations"]]
        assert all(p["reachable"] and p["step_free"] for _, p in places), [p["name"] for _, p in places if not p["reachable"]]
        for number, place in places:
            result = dijkstra(graph, kiosk_node, place["node"])
            assert result, f"no {'step-free ' if step_free else ''}route to {place['name']} ({number})"
            assert result["distance"] < 500, (place["name"], result["distance"])
        print(("Step-free" if step_free else "Any route").ljust(10), "- all", len(places), "Ramanujan places reachable over the bridge")
