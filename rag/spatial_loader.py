
import sqlite3
from pathlib import Path

from langchain_core.documents import Document

try:
    from .build_place_index import DATABASE_PATH
except ImportError:
    from build_place_index import DATABASE_PATH


def load_spatial_documents():
    documents = []
    if not DATABASE_PATH.is_file():
        print(f"Place database not found; run build_place_index.py: {DATABASE_PATH}")
        return documents

    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        for row in connection.execute("SELECT * FROM places"):
            place = dict(row)
            documents.append(Document(
                page_content=(
                    f"{place['name']} is a {place['category']} in {place['building']}, "
                    f"{place['floor_name']}."
                    + (f" Room {place['room_no']}." if place.get("room_no") else "")
                ),
                metadata={
                    "source": str(DATABASE_PATH),
                    "content_type": "navigation_place",
                    "place_id": place["place_id"],
                    "category": place["category"],
                    "building": place["building"],
                    "floor_key": place["floor_key"],
                    "floor_name": place["floor_name"],
                    "room_no": place.get("room_no") or "",
                },
            ))

    print(f"Loaded {len(documents)} spatial documents.")
    return documents
