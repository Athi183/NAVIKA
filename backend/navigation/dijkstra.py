import heapq


def dijkstra(graph, start, goal):

    # Priority queue
    priority_queue = []

    heapq.heappush(
        priority_queue,
        (0, start)
    )

    # Distance from start
    distances = {
        node: float("inf")
        for node in graph.nodes
    }

    distances[start] = 0

    # Previous node for reconstructing path
    previous = {
        node: None
        for node in graph.nodes
    }

    while priority_queue:

        current_distance, current_node = heapq.heappop(
            priority_queue
        )

        # Ignore outdated queue entries
        if current_distance > distances[current_node]:
            continue

        # Goal reached
        if current_node == goal:
            break

        # Explore neighbors
        for neighbor, weight in graph.get_neighbors(current_node):

            new_distance = current_distance + weight

            if new_distance < distances[neighbor]:

                distances[neighbor] = new_distance

                previous[neighbor] = current_node

                heapq.heappush(
                    priority_queue,
                    (new_distance, neighbor)
                )

    # No path exists
    if distances[goal] == float("inf"):
        return None

    # Reconstruct path
    path = []

    current = goal

    while current is not None:

        path.append(current)

        current = previous[current]

    path.reverse()

    return {
        "path": path,
        "distance": distances[goal]
    }