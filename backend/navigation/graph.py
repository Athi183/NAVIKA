"""Weighted navigation graph with typed edges and connector metadata."""

from dataclasses import dataclass
import math

try:
    from .costs import DEFAULT_NAVIGATION_COSTS, NavigationCosts
except ImportError:  # Supports the existing scripts run from this directory.
    from costs import DEFAULT_NAVIGATION_COSTS, NavigationCosts


@dataclass(frozen=True)
class NavigationEdge:
    source: str
    target: str
    edge_type: str
    weight: float
    connector_id: str | None = None
    edge_id: str | None = None
    candidate_review_id: str | None = None
    floor: str | None = None
    from_floor: str | None = None
    to_floor: str | None = None
    provenance: str = "unspecified"
    verification_status: str = "unspecified"
    source_ref: str | None = None
    evidence: tuple[str, ...] = ()
    reviewer: str | None = None
    reviewer_notes: str | None = None

    def as_dict(self) -> dict:
        return {
            "from": self.source,
            "to": self.target,
            "type": self.edge_type,
            "cost": self.weight,
            "connector_id": self.connector_id,
            "edge_id": self.edge_id,
            "candidate_review_id": self.candidate_review_id,
            "floor": self.floor,
            "from_floor": self.from_floor,
            "to_floor": self.to_floor,
            "provenance": self.provenance,
            "verification_status": self.verification_status,
            "source_ref": self.source_ref,
            "evidence": list(self.evidence),
            "reviewer": self.reviewer,
            "reviewer_notes": self.reviewer_notes,
        }


class NavigationGraph:
    def __init__(self, costs: NavigationCosts = DEFAULT_NAVIGATION_COSTS):
        self.nodes: dict[str, dict] = {}
        self.edges: dict[str, list[NavigationEdge]] = {}
        self.costs = costs
        self.metadata: dict = {}

    def add_node(self, node_id, x=0, y=0, floor=0, **attributes):
        self.nodes[node_id] = {"x": x, "y": y, "floor": floor, **attributes}
        self.edges.setdefault(node_id, [])

    def add_edge(
        self,
        from_node,
        to_node,
        weight=None,
        edge_type="walking",
        connector_id=None,
        edge_id=None,
        candidate_review_id=None,
        bidirectional=False,
        floor=None,
        provenance="unspecified",
        verification_status="unspecified",
        source_ref=None,
        evidence=(),
        reviewer=None,
        reviewer_notes=None,
    ):
        if from_node not in self.nodes or to_node not in self.nodes:
            raise KeyError(f"Both edge endpoints must exist: {from_node!r} -> {to_node!r}")
        cost = self.costs.for_edge(edge_type) if weight is None else weight
        if not isinstance(cost, (int, float)) or not math.isfinite(cost) or cost < 0:
            raise ValueError("Edge cost must be a finite non-negative number")
        from_floor = str(self.nodes[from_node].get("floor")) if self.nodes[from_node].get("floor") is not None else None
        to_floor = str(self.nodes[to_node].get("floor")) if self.nodes[to_node].get("floor") is not None else None
        edge_floor = str(floor) if floor is not None else (from_floor if from_floor == to_floor else None)
        edge = NavigationEdge(
            from_node, to_node, edge_type, cost, connector_id, edge_id, candidate_review_id, edge_floor, from_floor, to_floor,
            provenance, verification_status, source_ref, tuple(evidence), reviewer, reviewer_notes,
        )
        self.edges[from_node].append(edge)
        if bidirectional:
            reverse_id = f"{edge_id}:reverse" if edge_id else None
            self.edges[to_node].append(NavigationEdge(
                to_node, from_node, edge_type, cost, connector_id, reverse_id, candidate_review_id, edge_floor, to_floor, from_floor,
                provenance, verification_status, source_ref, tuple(evidence), reviewer, reviewer_notes,
            ))

    def calculate_distance(self, node_a, node_b):
        a = self.nodes[node_a]
        b = self.nodes[node_b]
        return math.sqrt((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2)

    def get_route_neighbors(self, node_id):
        return self.edges.get(node_id, [])

    def get_neighbors(self, node_id):
        """Legacy tuple view used by existing graph-inspection scripts."""
        return [(edge.target, edge.weight) for edge in self.get_route_neighbors(node_id)]


def build_graph(map_data, costs: NavigationCosts = DEFAULT_NAVIGATION_COSTS):
    """Build a graph from explicit walkable edges; no adjacency is inferred."""
    graph = NavigationGraph(costs)
    for node in map_data["nodes"]:
        graph.add_node(
            node_id=node["id"],
            x=node.get("x", 0),
            y=node.get("y", 0),
            floor=node.get("floor", 0),
            **{key: value for key, value in node.items() if key not in {"id", "x", "y", "floor"}},
        )
    for index, edge in enumerate(map_data["edges"]):
        graph.add_edge(
            edge["from"],
            edge["to"],
            weight=edge.get("weight", edge.get("cost")),
            edge_type=edge.get("edge_type", edge.get("type", "walking")),
            connector_id=edge.get("connector_id"),
            edge_id=edge.get("id", f"edge:{index}"),
            candidate_review_id=edge.get("candidate_review_id"),
            bidirectional=edge.get("bidirectional", True),
            floor=edge.get("floor"),
            provenance=edge.get("provenance", "input_graph"),
            verification_status=edge.get("verification_status", "unspecified"),
            source_ref=edge.get("source_ref"),
            evidence=edge.get("evidence", ()),
            reviewer=edge.get("reviewer"),
            reviewer_notes=edge.get("reviewer_notes"),
        )
    graph.metadata = map_data.get("metadata", {})
    return graph
