"""Tests for review-gated, wall-aware campus graph generation."""

import json
from pathlib import Path
import unittest
from copy import deepcopy

from .dijkstra import dijkstra
from .walkable_graph import build_review_candidate_data, build_walkable_campus_graph


ROOT = Path(__file__).resolve().parents[2]


def floor_fixture(walls=None, places=None, regions=None):
    return {
        "walls": {"walls": walls or []},
        "semantics": {"places": places or []},
        "floor_regions": {"regions": regions or []},
    }


def place(place_id, x, y, name=None):
    return {"id": place_id, "name": name or place_id, "type": "classroom", "cadX": x, "cadY": y}


def region(place_id, x1, y1, x2, y2):
    return {"semantic_id": place_id, "polygon": [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]}


def checked_edge(edge_id, source, target, floor="4"):
    return {
        "id": edge_id,
        "from": source,
        "to": target,
        "floor": floor,
        "verification_status": "verified",
        "route_eligible": True,
        "provenance": "manual-verified",
        "source_ref": "review-test",
        "evidence": ["doorway and corridor path reviewed against floor plan"],
        "reviewer": "Test Reviewer",
        "reviewer_notes": "The tested path remains within the corridor and room entrance.",
    }


def reviewed_corridor(node_id, floor, cad_xy):
    return {
        "id": node_id, "floor": floor, "cad_xy": cad_xy,
        "verification_status": "verified", "provenance": "manual-verified",
        "source_ref": "review-test", "evidence": ["corridor position reviewed against plan"],
        "reviewer": "Test Reviewer", "reviewer_notes": "Corridor node point checked on plan.",
    }


class WalkableGraphTests(unittest.TestCase):
    def test_actual_floors_add_room_and_landing_audit_without_guessing_edges(self):
        vertical = json.loads((ROOT / "public/data/campus_vertical_connections.json").read_text())
        floor_data = {}
        for floor in (4, 5, 6):
            base = ROOT / "public/data" / f"Ramanujan_F{floor}"
            floor_data[str(floor)] = {
                "walls": json.loads((base / "walls.json").read_text()),
                "semantics": json.loads((base / "semantics.json").read_text()),
                "floor_regions": json.loads((base / "floor_regions.json").read_text()),
            }
        graph, audit = build_walkable_campus_graph(
            vertical,
            floor_data,
            {"corridor_nodes": [], "connections": []},
        )

        self.assertGreater(audit["room_node_count"], 0)
        self.assertEqual(audit["rooms_with_verified_entrances"], 0)
        self.assertEqual(audit["verified_walk_edge_count_directed"], 0)
        self.assertEqual(len(audit["unconnected_connector_node_ids"]), 15)
        self.assertFalse(graph.metadata["room_to_room_routing_ready"])
        self.assertEqual(dijkstra(graph, "f4:place:room_501", "f4:place:room_502")["status"], "no_route")

    def test_verified_rooms_route_through_multiple_corridor_junctions(self):
        vertical = {"building": "fixture", "included_floors": ["4"], "nodes": [], "edges": []}
        rooms = [place("room_501", 1, 5), place("room_502", 9, 5)]
        floor_data = {"4": floor_fixture(
            walls=[{"id": "partition", "x1": 5, "y1": 0, "x2": 5, "y2": 4}],
            places=rooms,
            regions=[region("room_501", 0, 3, 3, 7), region("room_502", 7, 3, 10, 7)],
        )}
        manifest = {
            "corridor_nodes": [
                reviewed_corridor("f4:corridor:a", "4", [3, 5]),
                reviewed_corridor("f4:corridor:b", "4", [6, 5]),
            ],
            "connections": [
                checked_edge("r501-corridor-a", "f4:place:room_501", "f4:corridor:a"),
                checked_edge("corridor-a-corridor-b", "f4:corridor:a", "f4:corridor:b"),
                checked_edge("corridor-b-r502", "f4:corridor:b", "f4:place:room_502"),
            ],
        }
        graph, audit = build_walkable_campus_graph(vertical, floor_data, manifest)
        result = dijkstra(graph, "f4:place:room_501", "f4:place:room_502")

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["total_cost"], 3)
        self.assertEqual(result["path"], ["f4:place:room_501", "f4:corridor:a", "f4:corridor:b", "f4:place:room_502"])
        self.assertEqual(audit["rooms_with_verified_entrances"], 2)
        self.assertTrue(all(edge["provenance"] == "manual-verified" for edge in result["edges"]))

    def test_room_route_uses_lower_cost_confirmed_lift_instead_of_stairs(self):
        vertical = json.loads((ROOT / "public/data/campus_vertical_connections.json").read_text())
        vertical = deepcopy(vertical)
        connector_xy = {
            "f4:lift:a": [2, 0], "f5:lift:a": [2, 10], "f6:lift:a": [2, 20],
            "f4:stairs:a": [8, 0], "f5:stairs:a": [8, 10], "f6:stairs:a": [8, 20],
        }
        for node in vertical["nodes"]:
            xy = connector_xy.get(node["id"], [100 + len(node["id"]), 100])
            node["cad"] = {"x": xy[0], "y": xy[1]}
            node["floor_local"] = {"x": xy[0], "z": xy[1]}
        far_wall = {"id": "remote", "x1": 1000, "y1": 1000, "x2": 1010, "y2": 1000}
        floor_data = {
            "4": floor_fixture(walls=[far_wall], places=[place("source", 0, 0)]),
            "5": floor_fixture(walls=[far_wall]),
            "6": floor_fixture(walls=[far_wall], places=[place("destination", 10, 20)]),
        }
        corridor_nodes = [
            reviewed_corridor("f4:corridor:lift-approach", "4", [1, 0]),
            reviewed_corridor("f6:corridor:lift-exit-1", "6", [4, 20]),
            reviewed_corridor("f6:corridor:lift-exit-2", "6", [7, 20]),
            reviewed_corridor("f6:corridor:stairs-exit", "6", [9, 20]),
        ]
        connections = [
            checked_edge("source-lift-approach", "f4:place:source", "f4:corridor:lift-approach"),
            checked_edge("lift-approach-lift-a", "f4:corridor:lift-approach", "f4:lift:a"),
            checked_edge("source-stairs-a", "f4:place:source", "f4:stairs:a"),
            checked_edge("lift-a-exit-1", "f6:lift:a", "f6:corridor:lift-exit-1", floor="6"),
            checked_edge("lift-exit-1-2", "f6:corridor:lift-exit-1", "f6:corridor:lift-exit-2", floor="6"),
            checked_edge("lift-exit-2-destination", "f6:corridor:lift-exit-2", "f6:place:destination", floor="6"),
            checked_edge("stairs-a-exit", "f6:stairs:a", "f6:corridor:stairs-exit", floor="6"),
            checked_edge("stairs-exit-destination", "f6:corridor:stairs-exit", "f6:place:destination", floor="6"),
        ]

        graph, audit = build_walkable_campus_graph(vertical, floor_data, {"corridor_nodes": corridor_nodes, "connections": connections})
        result = dijkstra(graph, "f4:place:source", "f6:place:destination")

        self.assertEqual(audit["rejected_connection_count"], 0)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["total_cost"], 6)
        self.assertEqual([edge["connector_id"] for edge in result["connector_transitions"]], ["lift:a"])

    def test_unreviewed_connection_is_not_routable(self):
        vertical = {"building": "fixture", "included_floors": ["4"], "nodes": [], "edges": []}
        floor_data = {"4": floor_fixture(
            walls=[{"id": "remote", "x1": 100, "y1": 100, "x2": 110, "y2": 100}],
            places=[place("room_501", 1, 5), place("room_502", 9, 5)],
        )}
        manifest = {"corridor_nodes": [], "connections": [{
            **checked_edge("unreviewed", "f4:place:room_501", "f4:place:room_502"),
            "verification_status": "pending",
        }]}

        graph, audit = build_walkable_campus_graph(vertical, floor_data, manifest)
        result = dijkstra(graph, "f4:place:room_501", "f4:place:room_502")

        self.assertEqual(result["status"], "no_route")
        self.assertEqual(audit["pending_connection_count"], 1)

    def test_verified_edge_crossing_wall_is_rejected(self):
        vertical = {"building": "fixture", "included_floors": ["4"], "nodes": [], "edges": []}
        wall = {"id": "wall-east-west", "x1": 5, "y1": 0, "x2": 5, "y2": 10}
        floor_data = {"4": floor_fixture(walls=[wall], places=[place("room_501", 1, 5)])}
        manifest = {
            "corridor_nodes": [reviewed_corridor("f4:corridor", "4", [8, 5])],
            "connections": [checked_edge("cross-wall", "f4:place:room_501", "f4:corridor")],
        }

        graph, audit = build_walkable_campus_graph(vertical, floor_data, manifest)

        self.assertEqual(audit["rejected_connection_count"], 1)
        self.assertIn("intersects wall wall-east-west", audit["rejected_connections"][0]["reason"])
        self.assertEqual(dijkstra(graph, "f4:place:room_501", "f4:corridor")["status"], "no_route")

    def test_door_gap_suggestions_remain_review_only(self):
        vertical = {"building": "fixture", "included_floors": ["4"], "nodes": [], "edges": []}
        floor_data = {"4": floor_fixture(
            walls=[
                {"id": "wall-left", "x1": 0, "y1": 0, "x2": 4, "y2": 0},
                {"id": "wall-right", "x1": 5, "y1": 0, "x2": 9, "y2": 0},
            ],
            places=[place("room_501", 4.5, 2)],
            regions=[region("room_501", 0, 0, 9, 5)],
        )}

        graph, audit = build_walkable_campus_graph(vertical, floor_data, {"corridor_nodes": [], "connections": []})

        suggestion = audit["candidate_door_gaps"][0]["doorway_suggestions"]
        self.assertTrue(suggestion)
        self.assertEqual(suggestion[0]["review_status"], "unreviewed_not_a_walkable_edge")
        self.assertEqual(audit["verified_walk_edge_count_directed"], 0)
        self.assertEqual(len(graph.edges["f4:place:room_501"]), 0)

    def test_only_explicitly_approved_real_gap_becomes_a_walk_edge(self):
        vertical = {"building": "fixture", "included_floors": ["4"], "nodes": [], "edges": []}
        floor_data = {"4": floor_fixture(
            walls=[
                {"id": "wall-left", "x1": 0, "y1": 0, "x2": 4, "y2": 0},
                {"id": "wall-right", "x1": 5, "y1": 0, "x2": 9, "y2": 0},
            ],
            places=[place("room_501", 1, 2)],
            regions=[region("room_501", 0, 1, 4, 5)],
        )}
        empty_manifest = {"candidate_reviews": {}, "corridor_nodes": [], "connections": []}
        review_data = build_review_candidate_data(floor_data, vertical, empty_manifest)
        candidate = next(row for row in review_data["candidates"] if row["source_wall_segment_indices"] == [0, 1])
        candidate_id = candidate["candidate_id"]
        self.assertEqual(candidate["review_status"], "pending")
        self.assertEqual([wall["id"] for wall in candidate["source_wall_segments"]], ["wall-left", "wall-right"])

        corridor = reviewed_corridor("f4:corridor:north", "4", [4.5, -2])
        edge_id = f"walk:{candidate_id}:f4:place:room_501:f4:corridor:north"
        evidence = "The marked opening is shown as a doorway on the reviewed plan; the route lies in the room, crosses this opening, and reaches the corridor side."
        connection = {
            "id": edge_id,
            "from": "f4:place:room_501",
            "to": corridor["id"],
            "floor": "4",
            "verification_status": "verified",
            "route_eligible": True,
            "provenance": "manual-verified",
            "source_ref": candidate_id,
            "evidence": [evidence],
            "reviewer": "Reviewer One",
            "reviewer_notes": "The opening and corridor-side point are visible in the fixture plan.",
            "candidate_review_id": candidate_id,
            "bidirectional": True,
            "cad_path": [[1, 2], candidate["cad_xy"], corridor["cad_xy"]],
        }
        verified_manifest = {
            "candidate_reviews": {candidate_id: {
                "status": "verified", "floor": "4", "source_node_id": connection["from"],
                "corridor_node_id": connection["to"], "connection_ids": [edge_id],
                "reviewer": connection["reviewer"], "notes": connection["reviewer_notes"], "evidence_text": evidence,
            }},
            "corridor_nodes": [corridor],
            "connections": [connection],
        }
        graph, audit = build_walkable_campus_graph(vertical, floor_data, verified_manifest)
        result = dijkstra(graph, "f4:place:room_501", corridor["id"])
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["total_cost"], 1)
        self.assertEqual(result["edges"][0]["candidate_review_id"], candidate_id)
        self.assertEqual(audit["verified_walk_edge_count_directed"], 2)

        rejected_manifest = deepcopy(verified_manifest)
        rejected_manifest["candidate_reviews"][candidate_id]["status"] = "rejected"
        rejected_graph, rejected_audit = build_walkable_campus_graph(vertical, floor_data, rejected_manifest)
        self.assertEqual(dijkstra(rejected_graph, "f4:place:room_501", corridor["id"])["status"], "no_route")
        self.assertEqual(rejected_audit["rejected_connection_count"], 1)


if __name__ == "__main__":
    unittest.main()
