from pathlib import Path

import pandas as pd
from langchain_core.documents import Document


SPATIAL_FILE = Path(__file__).parent / "navika_5th_floor_rag_semantics.csv"


def load_spatial_documents():
    df = pd.read_csv(SPATIAL_FILE)

    required_columns = [
        "Node_ID",
        "Location_Name",
        "Node_Type",
        "Floor_Level",
        "Campus_Zone",
        "Block",
        "RAG_Text",
    ]

    missing = [column for column in required_columns if column not in df.columns]

    if missing:
        raise ValueError(f"Missing columns in spatial dataset: {missing}")

    documents = []

    for _, row in df.iterrows():
        documents.append(
            Document(
                page_content=row["RAG_Text"],
                metadata={
                    "source": "navika_5th_floor_rag_semantics.csv",
                    "node_id": row["Node_ID"],
                    "location_name": row["Location_Name"],
                    "node_type": row["Node_Type"],
                    "floor": row["Floor_Level"],
                    "campus_zone": row["Campus_Zone"],
                    "block": row["Block"],
                },
            )
        )

    return documents