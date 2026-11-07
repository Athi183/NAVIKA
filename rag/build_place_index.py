"""Build the RAG place catalog from the kiosk's navigation destinations."""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


RAG_DIR = Path(__file__).resolve().parent
REPO_DIR = RAG_DIR.parent
DATABASE_PATH = RAG_DIR / "data" / "spatial" / "navika_places.db"
DATA_DIR = REPO_DIR / "frontend" / "public" / "data"

SOURCES = [
    (DATA_DIR / "MGeorge_nav" / f"floor_{floor:02d}_walkable_graph.json", "MGEORGE", "M. George Block")
    for floor in range(5)
] + [
    (DATA_DIR / "MGeorge_nav" / "site_graph.json", "site", "Outside (campus)")
] + [
    (DATA_DIR / "Ramanujan_nav" / f"floor_R{floor}_walkable_graph.json", f"R{floor}", "Ramanujan Block")
    for floor in (2, 4, 5, 6)
]


def _read_places():
    places = []
    indoor_buildings = set()
    for path, _, _ in SOURCES:
        if path.parent.name == "Ramanujan_nav" and path.name == "floor_R2_walkable_graph.json":
            # The site graph's approximate Ramanujan label is omitted by the
            # kiosk once the bridge-linked indoor destination is available.
            indoor_buildings.add("Ramanujan Block")
    for path, floor_key, building in SOURCES:
        if not path.is_file():
            raise FileNotFoundError(f"Navigation source is missing: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
        floor_name = data.get("floor_label") or data.get("floor_number")
        if floor_key == "site":
            floor_name = "Outside (campus)"
        elif floor_key == "MGEORGE":
            floor_key = str(data.get("floor_number"))
            floor_name = str(floor_name).split(" (")[0]
        else:
            floor_name = f"{floor_name} (Ramanujan)"

        for item in data.get("destinations", []):
            if item.get("in_use") is False or item.get("reachable") is False:
                continue
            if floor_key == "site" and item.get("name") in indoor_buildings:
                continue
            places.append({
                "place_id": item["id"],
                "name": item["name"],
                "category": item.get("category") or "facility",
                "building": building,
                "floor_key": floor_key,
                "floor_name": floor_name,
                "room_no": str(item.get("room_no") or item.get("pdf_no") or "") or None,
                "step_free": int(bool(item.get("step_free", False))),
            })
    return places


def _alias_targets(places):
    by_name = {" ".join(place["name"].casefold().split()): place["place_id"] for place in places}
    aliases = []

    def place_alias(alias, target_name):
        place_id = by_name.get(" ".join(target_name.casefold().split()))
        if place_id:
            aliases.append((alias.casefold(), place_id, None))

    place_alias("library", "Tagore Library")
    place_alias("admission", "Admission Cell")
    place_alias("principal", "Principal")
    place_alias("mechanical department", "Mechanical Engineering Department")
    place_alias("mechanical engineering", "Mechanical Engineering Department")
    for alias in ("washroom", "restroom", "bathroom"):
        aliases.append((alias, None, "toilet"))
    aliases.append(("elevator", None, "lift"))

    # Keep this builder independent of interaction/nlu.py: importing the
    # NLU stack loads the language-model dependencies and can make this
    # small, deterministic catalog build stall on kiosk deployments.
    ENTITY_ALIASES = {
        "mech": "Mechanical Engineering Department",
        "mechanical": "Mechanical Engineering Department",
        "cse": "Computer Science Engineering",
        "ece": "Electronics and Communication Engineering",
        "eee": "Electrical and Electronics Engineering",
        "library": "Tagore Library",
        "admission": "Admission Cell",
        "principal": "Principal",
        "vice principal": "Vice Principal",
        "placement cell": "Placement Cell",
        "sports complex": "Sports Complex",
        "auditorium": "Auditorium",
    }
    for alias, canonical in ENTITY_ALIASES.items():
        key = " ".join(canonical.casefold().split())
        target_id = by_name.get(key)
        if target_id:
            aliases.append((alias.casefold(), target_id, None))

    return sorted(set(aliases))


def build_place_index(database_path: Path = DATABASE_PATH) -> int:
    places = _read_places()
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database_path) as connection:
        connection.executescript("""
            DROP TABLE IF EXISTS aliases;
            DROP TABLE IF EXISTS places;
            CREATE TABLE places (
                place_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                building TEXT NOT NULL,
                floor_key TEXT NOT NULL,
                floor_name TEXT NOT NULL,
                room_no TEXT,
                step_free INTEGER NOT NULL
            );
            CREATE TABLE aliases (
                alias TEXT NOT NULL,
                place_id TEXT,
                category TEXT
            );
            CREATE INDEX aliases_alias_idx ON aliases(alias);
            CREATE INDEX places_room_no_idx ON places(room_no);
        """)
        connection.executemany(
            "INSERT INTO places VALUES (:place_id, :name, :category, :building, :floor_key, :floor_name, :room_no, :step_free)",
            places,
        )
        connection.executemany("INSERT INTO aliases VALUES (?, ?, ?)", _alias_targets(places))
    return len(places)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DATABASE_PATH)
    args = parser.parse_args()
    count = build_place_index(args.database)
    print(f"Built {args.database} with {count} routable place records.")
