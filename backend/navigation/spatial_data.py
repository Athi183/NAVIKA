import json


def load_map(file_path):
    with open(file_path, "r") as file:
        return json.load(file)


def get_nodes(data):
    return data["nodes"]


def get_edges(data):
    return data["edges"]


def get_locations(data):
    return data["locations"]