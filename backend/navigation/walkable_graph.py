"""Review-gated construction and audit of the Ground-to-Sixth-Floor walkable graph."""

from __future__ import annotations

import math

from .campus_graph import build_confirmed_campus_graph
from .costs import DEFAULT_NAVIGATION_COSTS, NavigationCosts
from .dijkstra import dijkstra
from .tools.build_candidate_navigation_graph import doorway_candidates


ROOM_TYPES = {"classroom", "laboratory", "department", "hall", "toilet", "facility", "food", "ramp", "workshop", "corridor", "vacant"}
MAX_CANDIDATE_BOUNDARY_DISTANCE = 0.8


def cad_to_floor_local(x: float, y: float, walls: list[dict]) -> tuple[float, float]:
    """Use the connector graph's existing x=CAD-minX, z=-(CADY-minY) transform."""
    min_x = min(min(wall["x1"], wall["x2"]) for wall in walls)
    min_y = min(min(wall["y1"], wall["y2"]) for wall in walls)
    return round(x - min_x, 6), round(-(y - min_y), 6)


def _point_segment_distance(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    t = max(0.0, min(1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy)


def _distance_to_polygon_boundary(point: tuple[float, float], polygon: list[list[float]]) -> float:
    return min(
        _point_segment_distance(point, tuple(polygon[index]), tuple(polygon[(index + 1) % len(polygon)]))
        for index in range(len(polygon))
    )


def _door_gap_candidates(floor: str, walls: list[dict]) -> list[dict]:
    segments = [[wall["x1"], wall["y1"], wall["x2"], wall["y2"]] for wall in walls]
    floor_id = "RAMANUJAN_BLOCK_G" if floor == "G" else f"RAMANUJAN_BLOCK_{int(floor):02d}"
    floor_number = 0 if floor == "G" else int(floor)
    return doorway_candidates({"floor_id": floor_id, "floor_number": floor_number, "segments": segments})


def _orientation(a, b, c) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def segments_intersect(a, b, c, d, epsilon: float = 1e-8) -> bool:
    """Inclusive 2D segment intersection, including collinear wall overlap."""
    o1, o2, o3, o4 = _orientation(a, b, c), _orientation(a, b, d), _orientation(c, d, a), _orientation(c, d, b)
    if ((o1 > epsilon and o2 < -epsilon) or (o1 < -epsilon and o2 > epsilon)) and \
       ((o3 > epsilon and o4 < -epsilon) or (o3 < -epsilon and o4 > epsilon)):
        return True

    def on_segment(start, point, end):
        return (
            min(start[0], end[0]) - epsilon <= point[0] <= max(start[0], end[0]) + epsilon
            and min(start[1], end[1]) - epsilon <= point[1] <= max(start[1], end[1]) + epsilon
        )

    return (
        (abs(o1) <= epsilon and on_segment(a, c, b))
        or (abs(o2) <= epsilon and on_segment(a, d, b))
        or (abs(o3) <= epsilon and on_segment(c, a, d))
        or (abs(o4) <= epsilon and on_segment(c, b, d))
    )


def _path_crosses_wall(path: list[list[float]], walls: list[dict]) -> str | None:
    if len(path) < 2:
        return "walking path must contain at least two CAD points"
    for segment_index, (start, end) in enumerate(zip(path, path[1:])):
        a, b = tuple(start), tuple(end)
        for wall in walls:
            c, d = (wall["x1"], wall["y1"]), (wall["x2"], wall["y2"])
            if segments_intersect(a, b, c, d):
                return f"path segment {segment_index} intersects wall {wall.get('id', 'unknown')}"
    return None


def _candidate_door_gaps(floor: str, floor_data: dict, regions: dict[str, dict]) -> dict[str, list[dict]]:
    walls = floor_data["walls"]["walls"]
    candidates = _door_gap_candidates(str(floor), walls)
    results = {}
    for place_id, region in regions.items():
        polygon = region.get("polygon", [])
        nearby = []
        for candidate in candidates:
            point = (candidate["x"], candidate["y"])
            boundary_distance = _distance_to_polygon_boundary(point, polygon)
            if boundary_distance <= MAX_CANDIDATE_BOUNDARY_DISTANCE:
                nearby.append({
                    "candidate_id": candidate["node_id"],
                    "cad_xy": point,
                    "width_candidate": candidate["width_candidate_m"],
                    "source_segment_indices": candidate["source_segment_indices"],
                    "distance_to_region_boundary": round(boundary_distance, 4),
                    "evidence": "collinear_wall_endpoint_gap_candidate",
                    "review_status": "unreviewed_not_a_walkable_edge",
                })
        results[place_id] = sorted(nearby, key=lambda item: (item["distance_to_region_boundary"], item["candidate_id"]))[:3]
    return results


def build_review_candidate_data(
    floor_data: dict[str, dict],
    vertical_data: dict,
    review_manifest: dict,
) -> dict:
    """Package unapproved geometric gap candidates with auditable CAD context."""
    candidates = []
    floors = {}
    review_records = review_manifest.get("candidate_reviews", {})
    for floor, data in floor_data.items():
        floor = str(floor)
        walls = data["walls"]["walls"]
        semantics = data["semantics"].get("places", [])
        regions = {region["semantic_id"]: region for region in data["floor_regions"].get("regions", [])}
        gap_rows = _door_gap_candidates(floor, walls)
        mapped_connectors = [node for node in vertical_data.get("nodes", []) if str(node.get("floor")) == floor]
        floor_candidates = []
        for gap in gap_rows:
            point = (gap["x"], gap["y"])
            nearby_places = []
            for place in semantics:
                distance = math.hypot(place["cadX"] - point[0], place["cadY"] - point[1])
                if distance <= 12:
                    place_type = place.get("type")
                    connector_type = "lift" if place_type == "vertical_transport" else "stairs" if place_type == "staircase" else None
                    matching_connectors = [
                        node for node in mapped_connectors
                        if connector_type == node.get("type")
                        and math.hypot(node.get("cad", {}).get("x", math.inf) - place["cadX"], node.get("cad", {}).get("y", math.inf) - place["cadY"]) <= 0.001
                    ]
                    nearby_places.append({
                        "id": place["id"],
                        "node_id": f"f{floor}:place:{place['id']}" if not connector_type else (matching_connectors[0]["id"] if len(matching_connectors) == 1 else None),
                        "name": place.get("name"),
                        "semantic_type": place_type,
                        "cad_xy": [place["cadX"], place["cadY"]],
                        "distance_from_gap": round(distance, 4),
                        "connector_mapping_match": len(matching_connectors) == 1 if connector_type else None,
                    })
            nearby_places.sort(key=lambda item: (item["distance_from_gap"], item["id"]))

            region_suggestions = []
            for place_id, region in regions.items():
                boundary_distance = _distance_to_polygon_boundary(point, region["polygon"])
                if boundary_distance <= MAX_CANDIDATE_BOUNDARY_DISTANCE:
                    semantic = next((item for item in semantics if item["id"] == place_id), {})
                    region_suggestions.append({
                        "place_id": place_id,
                        "node_id": f"f{floor}:place:{place_id}",
                        "name": semantic.get("name", place_id),
                        "boundary_distance": round(boundary_distance, 4),
                        "polygon_cad_xy": region["polygon"],
                        "review_status": "candidate_only",
                    })
            region_suggestions.sort(key=lambda item: (item["boundary_distance"], item["place_id"]))

            nearby_landing_candidates = []
            for node in mapped_connectors:
                cad = node.get("cad", {})
                distance = math.hypot(cad.get("x", math.inf) - point[0], cad.get("y", math.inf) - point[1])
                if distance <= 8:
                    nearby_landing_candidates.append({
                        "node_id": node["id"],
                        "name": node.get("name"),
                        "connector_type": node.get("type"),
                        "cad_xy": [cad.get("x"), cad.get("y")],
                        "distance_from_gap": round(distance, 4),
                        "mapping_status": "confirmed_physical_mapping_landing_access_unverified",
                    })
            nearby_landing_candidates.sort(key=lambda item: (item["distance_from_gap"], item["node_id"]))

            wall_indices = gap.get("source_segment_indices", [])
            source_walls = [
                {"id": walls[index].get("id", f"WALL_{index + 1}"), "x1": walls[index]["x1"], "y1": walls[index]["y1"], "x2": walls[index]["x2"], "y2": walls[index]["y2"]}
                for index in wall_indices if 0 <= index < len(walls)
            ]
            previous_review = review_records.get(gap["node_id"], {})
            record = {
                "candidate_id": gap["node_id"],
                "floor": floor,
                "cad_xy": [gap["x"], gap["y"]],
                "width_candidate": gap["width_candidate_m"],
                "candidate_method": "nearby collinear wall-segment endpoints",
                "source_wall_segment_indices": wall_indices,
                "source_wall_segments": source_walls,
                "nearby_places": nearby_places[:8],
                "room_region_suggestions": region_suggestions[:5],
                "nearby_connector_landings": nearby_landing_candidates,
                "review_status": previous_review.get("status", "pending"),
                "review_notes": previous_review.get("notes", ""),
                "reviewer": previous_review.get("reviewer", ""),
            }
            candidates.append(record)
            floor_candidates.append(record["candidate_id"])
        floor_candidates.sort()
        min_x = min(min(wall["x1"], wall["x2"]) for wall in walls)
        max_x = max(max(wall["x1"], wall["x2"]) for wall in walls)
        min_y = min(min(wall["y1"], wall["y2"]) for wall in walls)
        max_y = max(max(wall["y1"], wall["y2"]) for wall in walls)
        floors[floor] = {
            "bounds": [min_x, min_y, max_x, max_y],
            "coordinate_system": data["walls"].get("coordinate_system", "CAD XY"),
            "wall_file": f"public/data/Ramanujan_F{floor}/walls.json",
            "semantic_file": f"public/data/Ramanujan_F{floor}/semantics.json",
            "candidate_ids": floor_candidates,
        }

    return {
        "schema_version": 1,
        "building": vertical_data.get("building"),
        "status_note": "Every gap is an unverified geometric candidate. Proximity, region-boundary distance, or a wall-clear segment is not by itself proof of a doorway or walkable connection.",
        "floors": floors,
        "candidates": candidates,
        "review_manifest": review_manifest,
    }


def build_walkable_campus_graph(
    vertical_data: dict,
    floor_data: dict[str, dict],
    review_manifest: dict,
    costs: NavigationCosts = DEFAULT_NAVIGATION_COSTS,
) -> tuple[Any, dict]:
    """Build routeable room/corridor links only from explicitly verified review rows.

    A connection is routable only with verified status, an explicit route flag,
    provenance/evidence, same-floor endpoints, and a polyline clear of extracted
    wall segments. All omitted or rejected connections remain visible in audit.
    """
    graph = build_confirmed_campus_graph(vertical_data, costs)
    room_node_ids: dict[str, list[str]] = {str(floor): [] for floor in floor_data}
    gaps_by_floor: dict[str, dict[str, list[dict]]] = {}
    actual_gap_candidates: dict[str, dict[str, dict]] = {}

    for floor, data in floor_data.items():
        floor = str(floor)
        walls = data["walls"]["walls"]
        regions = {region["semantic_id"]: region for region in data["floor_regions"].get("regions", [])}
        gaps_by_floor[floor] = _candidate_door_gaps(floor, data, regions)
        actual_gap_candidates[floor] = {candidate["node_id"]: candidate for candidate in _door_gap_candidates(floor, walls)}
        for place in data["semantics"].get("places", []):
            if place.get("type") not in ROOM_TYPES:
                continue
            node_id = f"f{floor}:place:{place['id']}"
            local_x, local_z = cad_to_floor_local(place["cadX"], place["cadY"], walls)
            region = regions.get(place["id"])
            graph.add_node(
                node_id,
                x=local_x,
                y=local_z,
                floor=floor,
                name=place.get("name"),
                node_type="room_candidate",
                semantic_type=place.get("type"),
                cad_xy=[place["cadX"], place["cadY"]],
                region_available=region is not None,
                route_eligible=False,
                verification_status="semantic_anchor_not_verified_entrance",
                source_ref=f"public/data/Ramanujan_F{floor}/semantics.json#{place['id']}",
            )
            room_node_ids[floor].append(node_id)

    audit = {"pending_connections": [], "rejected_connections": [], "candidate_door_gaps": []}
    for node in review_manifest.get("corridor_nodes", []):
        floor = str(node.get("floor", ""))
        if (
            floor not in floor_data
            or node.get("verification_status") != "verified"
            or node.get("provenance") not in {"geometry-derived", "manual-verified"}
            or not node.get("evidence")
            or not node.get("source_ref")
            or not node.get("reviewer")
            or not node.get("reviewer_notes")
        ):
            audit["pending_connections"].append({"kind": "corridor_node", "id": node.get("id"), "floor": floor, "reason": "corridor node needs floor-plan verification, provenance, evidence, source reference, reviewer, and notes"})
            continue
        x, y = node["cad_xy"]
        local_x, local_z = cad_to_floor_local(x, y, floor_data[floor]["walls"]["walls"])
        graph.add_node(
            node["id"], x=local_x, y=local_z, floor=floor, cad_xy=[x, y],
            name=node.get("name", node["id"]), node_type=node.get("node_type", "corridor_junction"),
            route_eligible=False, verification_status="verified_location", provenance=node.get("provenance"),
            source_ref=node.get("source_ref"), evidence=node.get("evidence", []),
            reviewer=node.get("reviewer"), reviewer_notes=node.get("reviewer_notes"),
        )

    for connection in review_manifest.get("connections", []):
        connection_id = connection.get("id", "unnamed")
        if connection.get("verification_status") != "verified" or connection.get("route_eligible") is not True:
            audit["pending_connections"].append({"kind": "walking_edge", "id": connection_id, "reason": "connection is not explicitly verified and route eligible"})
            continue
        source, target = connection.get("from"), connection.get("to")
        floor = str(connection.get("floor", ""))
        candidate_review_id = connection.get("candidate_review_id")
        if candidate_review_id:
            review = review_manifest.get("candidate_reviews", {}).get(candidate_review_id, {})
            actual_candidate = actual_gap_candidates.get(str(connection.get("floor")), {}).get(candidate_review_id)
            point_is_in_path = actual_candidate and any(
                math.hypot(point[0] - actual_candidate["x"], point[1] - actual_candidate["y"]) <= 0.02
                for point in connection.get("cad_path", [])
                if isinstance(point, (list, tuple)) and len(point) == 2
            )
            if (
                not actual_candidate
                or review.get("status") != "verified"
                or connection_id not in review.get("connection_ids", [])
                or str(review.get("floor")) != floor
                or review.get("source_node_id") != source
                or review.get("corridor_node_id") != target
                or review.get("reviewer") != connection.get("reviewer")
                or review.get("notes") != connection.get("reviewer_notes")
                or review.get("evidence_text") not in connection.get("evidence", [])
                or not point_is_in_path
            ):
                audit["rejected_connections"].append({"id": connection_id, "reason": "candidate connection lacks a matching verified review record"})
                continue
        if source not in graph.nodes or target not in graph.nodes:
            audit["rejected_connections"].append({"id": connection_id, "reason": "missing endpoint node"})
            continue
        source_node, target_node = graph.nodes[source], graph.nodes[target]
        if floor not in floor_data or str(source_node.get("floor")) != floor or str(target_node.get("floor")) != floor:
            audit["rejected_connections"].append({"id": connection_id, "reason": "walking edge endpoints must be on its declared floor"})
            continue
        provenance = connection.get("provenance")
        evidence = connection.get("evidence", [])
        if (
            provenance not in {"geometry-derived", "manual-verified"}
            or not evidence
            or not connection.get("source_ref")
            or not connection.get("reviewer")
            or not connection.get("reviewer_notes")
        ):
            audit["rejected_connections"].append({"id": connection_id, "reason": "verified walking edge requires provenance, evidence, source reference, reviewer, and notes"})
            continue
        source_cad = source_node.get("cad_xy")
        target_cad = target_node.get("cad_xy")
        path = connection.get("cad_path") or [source_cad, target_cad]
        if not source_cad or not target_cad or any(point is None for point in path):
            audit["rejected_connections"].append({"id": connection_id, "reason": "walking edge needs CAD coordinates for both endpoints and its route"})
            continue
        if math.hypot(path[0][0] - source_cad[0], path[0][1] - source_cad[1]) > 0.02 or math.hypot(path[-1][0] - target_cad[0], path[-1][1] - target_cad[1]) > 0.02:
            audit["rejected_connections"].append({"id": connection_id, "reason": "CAD route endpoints do not match the source and corridor node coordinates"})
            continue
        crossing = _path_crosses_wall(path, floor_data[floor]["walls"]["walls"])
        if crossing:
            audit["rejected_connections"].append({"id": connection_id, "reason": crossing})
            continue
        graph.add_edge(
            source,
            target,
            edge_type="walking",
            connector_id=connection.get("connector_id"),
            edge_id=connection_id,
            candidate_review_id=candidate_review_id,
            bidirectional=connection.get("bidirectional", True),
            floor=floor,
            provenance=provenance,
            verification_status="verified",
            source_ref=connection.get("source_ref"),
            evidence=evidence,
            reviewer=connection.get("reviewer"),
            reviewer_notes=connection.get("reviewer_notes"),
        )

    walking_degree = {}
    for edges in graph.edges.values():
        for edge in edges:
            if edge.edge_type in {"walk", "walking", "ordinary_walking"}:
                walking_degree[edge.source] = walking_degree.get(edge.source, 0) + 1
                walking_degree[edge.target] = walking_degree.get(edge.target, 0) + 1

    for node_id, node in graph.nodes.items():
        if node.get("node_type") == "room_candidate":
            connected = walking_degree.get(node_id, 0) > 0
            node["route_eligible"] = connected
            node["verification_status"] = "verified_entrance_edge" if connected else "needs_entrance_review"
            if not connected:
                floor = str(node["floor"])
                place_id = node_id.rsplit(":", 1)[-1]
                audit["candidate_door_gaps"].append({
                    "node_id": node_id,
                    "name": node.get("name"),
                    "floor": floor,
                    "room_region_available": node.get("region_available", False),
                    "doorway_suggestions": gaps_by_floor[floor].get(place_id, []),
                })
        elif node.get("connector_type") in {"lift", "stairs"}:
            connected = walking_degree.get(node_id, 0) > 0
            node["corridor_access_verified"] = connected
            node["route_eligible"] = connected
            node["verification_status"] = "verified_landing_corridor_edge" if connected else "needs_landing_corridor_review"

    unconnected_rooms = [node_id for ids in room_node_ids.values() for node_id in ids if not graph.nodes[node_id]["route_eligible"]]
    unconnected_connectors = [
        node_id for node_id, node in graph.nodes.items()
        if node.get("connector_type") in {"lift", "stairs"} and not node.get("corridor_access_verified")
    ]
    verified_walk_edges = [edge for edges in graph.edges.values() for edge in edges if edge.edge_type in {"walk", "walking", "ordinary_walking"}]
    candidate_gap_status_counts = {status: 0 for status in ("pending", "verified", "rejected")}
    candidate_reviews = review_manifest.get("candidate_reviews", {})
    for floor, candidates in actual_gap_candidates.items():
        for candidate_id in candidates:
            status = candidate_reviews.get(candidate_id, {}).get("status", "pending")
            candidate_gap_status_counts[status if status in candidate_gap_status_counts else "pending"] += 1
    floor_summary = {}
    for floor, node_ids in room_node_ids.items():
        room_nodes = [graph.nodes[node_id] for node_id in node_ids]
        candidate_rows = [row for row in audit["candidate_door_gaps"] if row["floor"] == floor]
        floor_summary[floor] = {
            "semantic_place_nodes": len(room_nodes),
            "room_regions_available": sum(bool(node.get("region_available")) for node in room_nodes),
            "verified_room_entrances": sum(bool(node.get("route_eligible")) for node in room_nodes),
            "rooms_with_review_only_doorway_candidates": sum(bool(row["doorway_suggestions"]) for row in candidate_rows),
            "connector_landings": sum(str(node.get("floor")) == floor and node.get("connector_type") in {"lift", "stairs"} for node in graph.nodes.values()),
            "connector_landings_connected_to_corridor": sum(
                str(node.get("floor")) == floor
                and node.get("connector_type") in {"lift", "stairs"}
                and bool(node.get("corridor_access_verified"))
                for node in graph.nodes.values()
            ),
            "verified_walk_edges_directed": sum(edge.floor == floor for edge in verified_walk_edges),
        }
    routeable_rooms = [node_id for ids in room_node_ids.values() for node_id in ids if graph.nodes[node_id]["route_eligible"]]
    reachable_room_pairs = 0
    for index, source in enumerate(routeable_rooms):
        for destination in routeable_rooms[index + 1:]:
            if dijkstra(graph, source, destination)["status"] == "ok":
                reachable_room_pairs += 1

    audit.update({
        "building": vertical_data.get("building"),
        "included_floors": [str(floor) for floor in floor_data],
        "room_node_count": sum(map(len, room_node_ids.values())),
        "rooms_with_verified_entrances": sum(graph.nodes[node_id]["route_eligible"] for ids in room_node_ids.values() for node_id in ids),
        "unconnected_room_node_ids": unconnected_rooms,
        "unconnected_connector_node_ids": unconnected_connectors,
        "verified_walk_edge_count_directed": len(verified_walk_edges),
        "pending_connection_count": len(audit["pending_connections"]),
        "rejected_connection_count": len(audit["rejected_connections"]),
        "candidate_review_status_counts": {
            status: sum(record.get("status", "pending") == status for record in review_manifest.get("candidate_reviews", {}).values())
            for status in ("pending", "verified", "rejected")
        },
        "candidate_gap_review_status_counts": candidate_gap_status_counts,
        "validated_room_to_room_pairs": reachable_room_pairs,
        "room_to_room_routing_ready": reachable_room_pairs > 0,
        "floor_summary": floor_summary,
        "source_limitations": [
            "CAD linework provides candidate openings but does not classify each opening as a doorway.",
            "No corridor or corridor-junction centerline data is supplied for the Ground Floor through Floor 6.",
            "Semantic coordinates identify labels/places, not verified entrances.",
            "All geometry-derived doorway suggestions remain review-only until explicitly approved.",
        ],
    })
    graph.metadata.update({
        "graph_kind": "review_gated_walkable_campus_graph",
        "room_to_room_routing_ready": audit["room_to_room_routing_ready"],
        "walkable_edge_count_directed": len(verified_walk_edges),
    })
    return graph, audit
