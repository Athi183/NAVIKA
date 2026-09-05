import math


class NavigationGraph:

    def __init__(self):
        self.nodes = {}
        self.edges = {}

    def add_node(self, node_id, x, y, floor=0):
        self.nodes[node_id] = {
            "x": x,
            "y": y,
            "floor": floor
        }

        if node_id not in self.edges:
            self.edges[node_id] = []

    def add_edge(self, from_node, to_node, weight=None):

        if weight is None:
            weight = self.calculate_distance(from_node, to_node)

        self.edges[from_node].append(
            (to_node, weight)
        )

    def calculate_distance(self, node_a, node_b):

        a = self.nodes[node_a]
        b = self.nodes[node_b]

        return math.sqrt(
            (a["x"] - b["x"]) ** 2 +
            (a["y"] - b["y"]) ** 2
        )

    def get_neighbors(self, node_id):
        return self.edges.get(node_id, [])
    
def build_graph(map_data):

    graph = NavigationGraph()

    # Add nodes
    for node in map_data["nodes"]:

        graph.add_node(
            node_id=node["id"],
            x=node["x"],
            y=node["y"],
            floor=node.get("floor", 0)
        )

    # Add edges
    for edge in map_data["edges"]:

        from_node = edge["from"]
        to_node = edge["to"]

        graph.add_edge(
            from_node,
            to_node
        )

        # Indoor walking is normally bidirectional
        graph.add_edge(
            to_node,
            from_node
        )

    return graph