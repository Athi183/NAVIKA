"""Build the Ground-to-Sixth-Floor connector-only graph.

This adapter intentionally adds no room, doorway, landing-access, or corridor
edges: those walkable connections are not yet verified in the source data.
"""

from collections import defaultdict, deque
import json
from pathlib import Path

try:
    from .costs import DEFAULT_NAVIGATION_COSTS, NavigationCosts
    from .graph import NavigationGraph
except ImportError:  # Supports the existing scripts run from this directory.
    from costs import DEFAULT_NAVIGATION_COSTS, NavigationCosts
    from graph import NavigationGraph


def _floor_rank(floor: str) -> int:
    return 0 if str(floor).upper() == "G" else int(floor)


def _lift_components(edges: list[dict]) -> list[tuple[set[str], list[dict]]]:
    adjacency: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for edge in edges:
        if edge.get("type") != "lift":
            continue
        source, target = edge["from"], edge["to"]
        adjacency[source].append((target, edge))
        adjacency[target].append((source, edge))

    components = []
    unseen = set(adjacency)
    while unseen:
        first = unseen.pop()
        nodes = {first}
        component_edges = {}
        queue = deque([first])
        while queue:
            current = queue.popleft()
            for neighbor, edge in adjacency[current]:
                component_edges[edge["id"]] = edge
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    nodes.add(neighbor)
                    queue.append(neighbor)
        components.append((nodes, list(component_edges.values())))
    return components


def build_confirmed_campus_graph(data: dict, costs: NavigationCosts = DEFAULT_NAVIGATION_COSTS) -> NavigationGraph:
    """Load explicit adjacent stair links and per-journey lift ride links.

    A lift component is formed from the already-confirmed mapped connector
    edges, never from source labels. Each pair of served stops receives one
    ride edge so a Floor 4 → Floor 6 ride costs one journey, while exiting on
    Floor 5 and boarding again costs a second journey.
    """
    graph = NavigationGraph(costs)
    for node in data.get("nodes", []):
        local = node.get("floor_local", {})
        graph.add_node(
            node["id"],
            x=local.get("x", 0),
            y=local.get("z", 0),
            floor=node.get("floor"),
            name=node.get("name"),
            connector_type=node.get("type"),
            cad_xy=[node.get("cad", {}).get("x"), node.get("cad", {}).get("y")],
            landing_position_verified=node.get("landing_position_verified", False),
            corridor_access_verified=node.get("corridor_access_verified", False),
        )

    vertical_edges = [edge for edge in data.get("edges", []) if edge.get("type") in {"stairs", "lift"}]
    for edge in vertical_edges:
        if edge["type"] == "stairs":
            graph.add_edge(
                edge["from"], edge["to"],
                edge_type="stairs",
                connector_id=edge["id"].split(":f", 1)[0],
                edge_id=edge["id"],
                bidirectional=edge.get("bidirectional", True),
                floor=str(graph.nodes[edge["from"]]["floor"]),
                provenance="confirmed_physical_connector_mapping",
                verification_status="mapping_confirmed_landing_access_unverified",
                source_ref=f"public/data/campus_vertical_connections.json#{edge['id']}",
                evidence=("confirmed adjacent-floor connector correspondence",),
            )

    for nodes, component_edges in _lift_components(vertical_edges):
        ordered_stops = sorted(nodes, key=lambda node_id: (_floor_rank(graph.nodes[node_id]["floor"]), node_id))
        component_id = min(edge["id"].split(":f", 1)[0] for edge in component_edges)
        for index, first in enumerate(ordered_stops):
            for second in ordered_stops[index + 1:]:
                first_floor = str(graph.nodes[first]["floor"])
                second_floor = str(graph.nodes[second]["floor"])
                low, high = sorted((first_floor, second_floor), key=_floor_rank)
                graph.add_edge(
                    first,
                    second,
                    edge_type="lift_journey",
                    connector_id=component_id,
                    edge_id=f"{component_id}:f{low}-f{high}:ride",
                    bidirectional=True,
                    floor=None,
                    provenance="confirmed_physical_connector_mapping",
                    verification_status="mapping_confirmed_landing_access_unverified",
                    source_ref="public/data/campus_vertical_connections.json",
                    evidence=("continuous served-floor chain in confirmed connector mapping",),
                )

    source_status = data.get("routing_status", {})
    graph.metadata = {
        "building": data.get("building"),
        "included_floors": data.get("included_floors", []),
        "graph_kind": "confirmed_vertical_connectors_only",
        "corridor_graph_available": bool(source_status.get("corridor_graph_available", False)),
        "room_to_room_multifloor_routing_ready": False,
        "unverified_horizontal_connections_added": 0,
    }
    return graph


def load_confirmed_campus_graph(
    path: str | Path,
    costs: NavigationCosts = DEFAULT_NAVIGATION_COSTS,
) -> NavigationGraph:
    with Path(path).open(encoding="utf-8") as source:
        return build_confirmed_campus_graph(json.load(source), costs)
