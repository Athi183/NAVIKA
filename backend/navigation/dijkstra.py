"""Dijkstra shortest path for non-negative typed navigation edges."""

import heapq
import itertools
import math


def dijkstra(graph, start, goal):
    """Return a typed route result, including a clear result for missing paths."""
    if start not in graph.nodes or goal not in graph.nodes:
        missing = [node for node in (start, goal) if node not in graph.nodes]
        return {
            "status": "invalid_endpoint",
            "reason": f"Unknown navigation node(s): {', '.join(map(str, missing))}",
            "source": start,
            "destination": goal,
            "path": [],
            "edges": [],
            "connector_transitions": [],
            "total_cost": None,
        }

    distances = {node: math.inf for node in graph.nodes}
    previous: dict[str, tuple[str, object]] = {}
    distances[start] = 0
    sequence = itertools.count()
    queue = [(0, next(sequence), start)]

    while queue:
        current_cost, _, current = heapq.heappop(queue)
        if current_cost > distances[current]:
            continue
        if current == goal:
            break

        for edge in graph.get_route_neighbors(current):
            if not math.isfinite(edge.weight) or edge.weight < 0:
                raise ValueError(f"Dijkstra requires non-negative edge costs ({edge.edge_id or current})")
            next_cost = current_cost + edge.weight
            if next_cost < distances[edge.target]:
                distances[edge.target] = next_cost
                previous[edge.target] = (current, edge)
                heapq.heappush(queue, (next_cost, next(sequence), edge.target))

    if math.isinf(distances[goal]):
        return {
            "status": "no_route",
            "reason": f"No defined walkable/connector path from {start!r} to {goal!r}.",
            "source": start,
            "destination": goal,
            "path": [],
            "edges": [],
            "connector_transitions": [],
            "total_cost": None,
        }

    path = [goal]
    route_edges = []
    cursor = goal
    while cursor != start:
        predecessor, edge = previous[cursor]
        route_edges.append(edge)
        path.append(predecessor)
        cursor = predecessor
    path.reverse()
    route_edges.reverse()

    serialized_edges = [edge.as_dict() for edge in route_edges]
    transitions = [
        edge.as_dict()
        for edge in route_edges
        if edge.edge_type not in {"walk", "walking", "ordinary_walking"}
    ]
    total_cost = distances[goal]
    return {
        "status": "ok",
        "source": start,
        "destination": goal,
        "path": path,
        "edges": serialized_edges,
        "edge_types": [edge.edge_type for edge in route_edges],
        "connector_transitions": transitions,
        "total_cost": total_cost,
        # Compatibility with the original demo script.
        "distance": total_cost,
    }
