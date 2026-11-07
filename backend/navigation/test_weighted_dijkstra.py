"""Required NAVIKA abstract-cost scenarios for weighted Dijkstra."""

import json
from pathlib import Path
import unittest

from .campus_graph import build_confirmed_campus_graph
from .costs import NavigationCosts
from .dijkstra import dijkstra
from .graph import NavigationGraph


class WeightedDijkstraTests(unittest.TestCase):
    def make_graph(self):
        return NavigationGraph()

    def add_nodes(self, graph, *node_ids):
        for node_id in node_ids:
            graph.add_node(node_id)

    def test_a_three_walking_edges_cost_three(self):
        graph = self.make_graph()
        self.add_nodes(graph, "source", "w1", "w2", "destination")
        graph.add_edge("source", "w1", edge_type="walking")
        graph.add_edge("w1", "w2", edge_type="walking")
        graph.add_edge("w2", "destination", edge_type="walking")

        result = dijkstra(graph, "source", "destination")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["total_cost"], 3)
        self.assertEqual(result["edge_types"], ["walking"] * 3)

    def test_b_two_stair_transitions_cost_seven_with_walks(self):
        graph = self.make_graph()
        self.add_nodes(graph, "source", "s1:f1", "s1:f2", "s1:f3", "w1", "destination")
        graph.add_edge("source", "s1:f1", edge_type="walking")
        graph.add_edge("s1:f1", "s1:f2", edge_type="stairs")
        graph.add_edge("s1:f2", "s1:f3", edge_type="stairs")
        graph.add_edge("s1:f3", "w1", edge_type="walking")
        graph.add_edge("w1", "destination", edge_type="walking")

        result = dijkstra(graph, "source", "destination")
        self.assertEqual(result["total_cost"], 7)
        self.assertEqual([edge["type"] for edge in result["connector_transitions"]], ["stairs", "stairs"])

    def test_c_lift_journey_costs_one_with_walks(self):
        graph = self.make_graph()
        self.add_nodes(graph, "source", "w1", "lift:f1", "lift:f3", "w2", "w3", "destination")
        graph.add_edge("source", "w1", edge_type="walking")
        graph.add_edge("w1", "lift:f1", edge_type="walking")
        graph.add_edge("lift:f1", "lift:f3", edge_type="lift_journey", connector_id="lift:a")
        graph.add_edge("lift:f3", "w2", edge_type="walking")
        graph.add_edge("w2", "w3", edge_type="walking")
        graph.add_edge("w3", "destination", edge_type="walking")

        result = dijkstra(graph, "source", "destination")
        self.assertEqual(result["total_cost"], 6)
        self.assertEqual(len(result["connector_transitions"]), 1)
        self.assertEqual(result["connector_transitions"][0]["connector_id"], "lift:a")

    def test_d_dijkstra_prefers_lift_route_cost_six_over_stairs_seven(self):
        graph = self.make_graph()
        self.add_nodes(
            graph,
            "source", "stairs:f1", "stairs:f2", "stairs:f3", "stair_exit", "destination",
            "lift_walk", "lift:f1", "lift:f3", "lift_exit1", "lift_exit2",
        )
        graph.add_edge("source", "stairs:f1", edge_type="walking")
        graph.add_edge("stairs:f1", "stairs:f2", edge_type="stairs", connector_id="stairs:a")
        graph.add_edge("stairs:f2", "stairs:f3", edge_type="stairs", connector_id="stairs:a")
        graph.add_edge("stairs:f3", "stair_exit", edge_type="walking")
        graph.add_edge("stair_exit", "destination", edge_type="walking")

        graph.add_edge("source", "lift_walk", edge_type="walking")
        graph.add_edge("lift_walk", "lift:f1", edge_type="walking")
        graph.add_edge("lift:f1", "lift:f3", edge_type="lift_journey", connector_id="lift:a")
        graph.add_edge("lift:f3", "lift_exit1", edge_type="walking")
        graph.add_edge("lift_exit1", "lift_exit2", edge_type="walking")
        graph.add_edge("lift_exit2", "destination", edge_type="walking")

        result = dijkstra(graph, "source", "destination")
        self.assertEqual(result["total_cost"], 6)
        self.assertEqual(len(result["connector_transitions"]), 1)
        self.assertEqual(result["connector_transitions"][0]["type"], "lift_journey")
        self.assertEqual(result["connector_transitions"][0]["connector_id"], "lift:a")

    def test_e_floor_four_to_six_same_confirmed_lift_costs_one(self):
        source = Path(__file__).resolve().parents[2] / "public/data/campus_vertical_connections.json"
        data = json.loads(source.read_text(encoding="utf-8"))
        graph = build_confirmed_campus_graph(data)
        result = dijkstra(graph, "f4:lift:a", "f6:lift:a")

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["total_cost"], 1)
        self.assertEqual(result["connector_transitions"][0]["connector_id"], "lift:a")

        lift_b = dijkstra(graph, "f4:lift:b", "f6:lift:b")
        self.assertEqual(lift_b["total_cost"], 1)
        self.assertEqual(lift_b["connector_transitions"][0]["connector_id"], "lift:b")
        self.assertEqual(dijkstra(graph, "f4:lift:a", "f6:lift:b")["status"], "no_route")

    def test_f_two_consecutive_confirmed_stair_edges_cost_four(self):
        source = Path(__file__).resolve().parents[2] / "public/data/campus_vertical_connections.json"
        data = json.loads(source.read_text(encoding="utf-8"))
        graph = build_confirmed_campus_graph(data)
        result = dijkstra(graph, "f4:stairs:a", "f6:stairs:a")

        self.assertEqual(result["total_cost"], 4)
        self.assertEqual([edge["type"] for edge in result["connector_transitions"]], ["stairs", "stairs"])

    def test_g_disconnected_endpoint_returns_no_route(self):
        graph = self.make_graph()
        self.add_nodes(graph, "source", "destination")

        result = dijkstra(graph, "source", "destination")
        self.assertEqual(result["status"], "no_route")
        self.assertEqual(result["path"], [])
        self.assertIsNone(result["total_cost"])

    def test_custom_costs_are_central_and_configurable(self):
        graph = NavigationGraph(NavigationCosts(walking=3, stairs=5, lift_journey=0.5))
        self.add_nodes(graph, "a", "b", "c")
        graph.add_edge("a", "b", edge_type="walking")
        graph.add_edge("b", "c", edge_type="lift_journey")
        self.assertEqual(dijkstra(graph, "a", "c")["total_cost"], 3.5)


if __name__ == "__main__":
    unittest.main()
