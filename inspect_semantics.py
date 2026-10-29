
import ezdxf
import json
from collections import Counter
from pathlib import Path

# Update this path if your DXF is stored elsewhere.
DXF_PATH = Path.home() / "RAMANUJAN_6TH" / "DXF" / "RAMANUJAN_6THFLOOR.dxf"

# If the path differs, replace it with the exact path
# printed by the find command.

doc = ezdxf.readfile(DXF_PATH)
msp = doc.modelspace()

entity_counts = Counter()
layer_counts = Counter()
text_records = []
block_records = []

def point3d(point):
    return [
        round(float(point.x), 4),
        round(float(point.y), 4),
        round(float(point.z), 4)
    ]

for entity in msp:
    entity_type = entity.dxftype()
    layer = entity.dxf.get("layer", "0")

    entity_counts[entity_type] += 1
    layer_counts[layer] += 1

    if entity_type == "TEXT":
        text = entity.dxf.text.strip()
        insert = point3d(entity.dxf.insert)

        if text:
            text_records.append({
                "entity": "TEXT",
                "text": text,
                "layer": layer,
                "position": insert,
                "height": float(entity.dxf.get("height", 0))
            })

    elif entity_type == "MTEXT":
        text = entity.text.strip()
        insert = point3d(entity.dxf.insert)

        if text:
            text_records.append({
                "entity": "MTEXT",
                "text": text,
                "layer": layer,
                "position": insert,
                "height": float(entity.dxf.get("char_height", 0))
            })

    elif entity_type == "INSERT":
        block_records.append({
            "block_name": entity.dxf.name,
            "layer": layer,
            "position": point3d(entity.dxf.insert),
            "rotation": float(entity.dxf.get("rotation", 0))
        })

output = {
    "source_file": str(DXF_PATH),
    "entity_counts": dict(entity_counts),
    "layer_counts": dict(layer_counts),
    "text_records": text_records,
    "block_inserts": block_records
}

output_path = Path("inspection_navigation/floor6_dxf_inspection.json")
output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(
    json.dumps(output, indent=2, ensure_ascii=False),
    encoding="utf-8"
)

print("\n=== ENTITY TYPES ===")
for name, count in entity_counts.most_common():
    print(f"{name}: {count}")

print("\n=== LAYERS ===")
for name, count in layer_counts.most_common():
    print(f"{name}: {count}")

print("\n=== TEXT FOUND ===")
for item in text_records:
    print(
        f'{item["entity"]} | {item["layer"]} | '
        f'{item["text"]} | {item["position"]}'
    )

print(f"\nInspection saved to: {output_path.resolve()}")
print(f"Text objects found: {len(text_records)}")
print(f"Block references found: {len(block_records)}")
