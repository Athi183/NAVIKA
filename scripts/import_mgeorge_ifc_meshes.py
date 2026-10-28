#!/usr/bin/env python3
"""Export direct IFC4 tessellated element geometry for the NAVIKA viewer.

Only direct polygonal/triangulated face-set representations are rendered.
The IFC files supplied here do not contain IfcSpace entities.  The second-floor
mesh is registered to the MITS DXF by bounding-box similarity as a candidate;
the building identity and transformation still require manual confirmation.
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data/MGeorge_IFC"
INPUTS = [
    (Path("/home/athira-v/Downloads/MG SECOND FLOOR_rvt.ifc"), "mgeorge_second", "Second Floor", "main_f2"),
    (Path("/home/athira-v/Downloads/MG 3RD FLOOR_rvt.ifc"), "mgeorge_third", "Third Floor", None),
]


def split_args(source: str):
    result, start, depth, quoted, index = [], 0, 0, False, 0
    while index < len(source):
        char = source[index]
        if char == "'":
            if quoted and index + 1 < len(source) and source[index + 1] == "'":
                index += 2
                continue
            quoted = not quoted
        elif not quoted:
            if char == "(": depth += 1
            elif char == ")": depth -= 1
            elif char == "," and depth == 0:
                result.append(source[start:index].strip())
                start = index + 1
        index += 1
    result.append(source[start:].strip())
    return result


def read_ifc(path: Path):
    entities = {}
    for line in path.open("r", encoding="utf-8", errors="replace"):
        match = re.match(r"#(\d+)=([A-Z0-9_]+)\((.*)\);\s*$", line)
        if match:
            entities[int(match[1])] = (match[2], split_args(match[3]))
    return entities


def references(value: str):
    return [int(number) for number in re.findall(r"#(\d+)", value)]


def numbers(value: str):
    return [float(number) for number in re.findall(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?", value)]


def triples(value: str):
    found = []
    for group in re.findall(r"\(([^()]*)\)", value):
        values = numbers(group)
        if len(values) == 3:
            found.append(values)
    return found


def identity():
    return [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]


def dot_cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def unit(a):
    length = math.sqrt(sum(value * value for value in a))
    return [value / length for value in a] if length else [0.0, 0.0, 0.0]


def multiply(a, b):
    return [[sum(a[row][k] * b[k][col] for k in range(4)) for col in range(4)] for row in range(4)]


def transform(matrix, point):
    return [sum(matrix[row][col] * point[col] for col in range(3)) + matrix[row][3] for row in range(3)]


def placement_matrix(entities, ref, cache):
    if ref is None or ref not in entities:
        return identity()
    if ref in cache:
        return cache[ref]
    kind, attrs = entities[ref]
    if kind != "IFCLOCALPLACEMENT":
        return identity()
    parent_ref = references(attrs[0])[0] if attrs[0] != "$" and references(attrs[0]) else None
    axis_ref = references(attrs[1])[0] if len(attrs) > 1 and references(attrs[1]) else None
    parent = placement_matrix(entities, parent_ref, cache)
    if not axis_ref or axis_ref not in entities:
        cache[ref] = parent
        return parent
    axis = entities[axis_ref][1]
    location_ref = references(axis[0])[0] if axis and references(axis[0]) else None
    origin = numbers(entities[location_ref][1][0]) if location_ref else [0.0, 0.0, 0.0]
    origin = (origin + [0.0, 0.0, 0.0])[:3]
    z_ref = references(axis[1])[0] if len(axis) > 1 and axis[1] != "$" and references(axis[1]) else None
    x_ref = references(axis[2])[0] if len(axis) > 2 and axis[2] != "$" and references(axis[2]) else None
    z = unit(numbers(entities[z_ref][1][0])) if z_ref else [0.0, 0.0, 1.0]
    x = unit(numbers(entities[x_ref][1][0])) if x_ref else [1.0, 0.0, 0.0]
    y = unit(dot_cross(z, x))
    x = unit(dot_cross(y, z))
    local = [[x[0], y[0], z[0], origin[0]], [x[1], y[1], z[1], origin[1]], [x[2], y[2], z[2], origin[2]], [0.0, 0.0, 0.0, 1.0]]
    cache[ref] = multiply(parent, local)
    return cache[ref]


def product_triangles(entities, shape_ref):
    if shape_ref not in entities or entities[shape_ref][0] != "IFCPRODUCTDEFINITIONSHAPE":
        return []
    representation_refs = references(entities[shape_ref][1][2]) if len(entities[shape_ref][1]) > 2 else []
    triangles = []
    for representation_ref in representation_refs:
        kind, attrs = entities.get(representation_ref, (None, []))
        if kind != "IFCSHAPEREPRESENTATION" or len(attrs) < 4:
            continue
        for item_ref in references(attrs[3]):
            item_kind, item_attrs = entities.get(item_ref, (None, []))
            if item_kind == "IFCPOLYGONALFACESET" and len(item_attrs) >= 3:
                coord_refs = references(item_attrs[0])
                if not coord_refs: continue
                points = triples(entities[coord_refs[0]][1][0])
                face_refs = references(item_attrs[2])
                for face_ref in face_refs:
                    face_kind, face_attrs = entities.get(face_ref, (None, []))
                    if face_kind not in ("IFCINDEXEDPOLYGONALFACE", "IFCINDEXEDPOLYGONALFACEWITHVOIDS") or not face_attrs:
                        continue
                    indexes = [int(v) for v in numbers(face_attrs[0])]
                    for j in range(1, len(indexes) - 1):
                        tri = (indexes[0] - 1, indexes[j] - 1, indexes[j + 1] - 1)
                        if min(tri) >= 0 and max(tri) < len(points):
                            triangles.append((points[tri[0]], points[tri[1]], points[tri[2]]))
            elif item_kind == "IFCTRIANGULATEDFACESET" and len(item_attrs) >= 4:
                coord_refs = references(item_attrs[0])
                if not coord_refs: continue
                points = triples(entities[coord_refs[0]][1][0])
                for group in re.findall(r"\(([^()]*)\)", item_attrs[3]):
                    indexes = [int(v) for v in numbers(group)]
                    if len(indexes) >= 3:
                        tri = (indexes[0] - 1, indexes[1] - 1, indexes[2] - 1)
                        if min(tri) >= 0 and max(tri) < len(points):
                            triangles.append((points[tri[0]], points[tri[1]], points[tri[2]]))
    return triangles


def enum_names(entities, entity_type):
    result = []
    for _, (kind, attrs) in entities.items():
        if kind == entity_type and len(attrs) > 2:
            name = attrs[2].strip("'")
            if name and name != "$": result.append(name)
    return result


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    dxf_path = ROOT / "public/data/MITS_Main_Block/main_f2.json"
    dxf = json.loads(dxf_path.read_text(encoding="utf-8"))
    dxf_bounds = dxf.get("registration_bounds_xy", dxf["plan_bounds_xy"])
    dxf_x0, dxf_y0, dxf_x1, dxf_y1 = dxf_bounds
    dxf_center = ((dxf_x0 + dxf_x1) / 2 * 0.01, (dxf_y0 + dxf_y1) / 2 * 0.01)
    for source, floor_id, floor_label, align_floor in INPUTS:
        entities = read_ifc(source)
        placement_cache = {}
        elements = []
        bounds = [float("inf"), float("inf"), float("inf"), float("-inf"), float("-inf"), float("-inf")]
        category_counts = Counter()
        for entity_id, (kind, attrs) in entities.items():
            if kind not in {"IFCWALL", "IFCWALLSTANDARDCASE", "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCSLAB", "IFCDOOR"}:
                continue
            if len(attrs) < 7:
                continue
            placement_refs = references(attrs[5])
            shape_refs = references(attrs[6])
            triangles = product_triangles(entities, shape_refs[0]) if shape_refs else []
            matrix = placement_matrix(entities, placement_refs[0] if placement_refs else None, placement_cache)
            flat = []
            for triangle in triangles:
                for point in triangle:
                    world = transform(matrix, point)
                    flat.extend(world)
                    for axis in range(3):
                        bounds[axis] = min(bounds[axis], world[axis])
                        bounds[axis + 3] = max(bounds[axis + 3], world[axis])
            if flat:
                category_counts[kind] += 1
                elements.append({"id": f"ifc_{entity_id}", "ifc_type": kind, "name": attrs[2].strip("'") if attrs[2] not in ("$", "") else kind,
                                 "world_xyz_m": flat})
        extents = [bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]]
        can_align = bool(align_floor and extents[0] > 0 and extents[1] > 0)
        if can_align:
            dxf_width, dxf_depth = (dxf_x1 - dxf_x0) * 0.01, (dxf_y1 - dxf_y0) * 0.01
            scale_x, scale_y = dxf_width / extents[0], dxf_depth / extents[1]
            mismatch = max(abs(scale_x - 1), abs(scale_y - 1))
            can_align = mismatch <= 0.05
        else:
            mismatch, scale_x, scale_y = None, None, None
        if can_align:
            scale = (scale_x + scale_y) / 2
            ifc_center = ((bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2)
            offset_x = dxf_center[0] - ifc_center[0] * scale
            offset_y = dxf_center[1] - ifc_center[1] * scale
            target_origin = (dxf_x0 * 0.01, dxf_y0 * 0.01)
        else:
            scale = 1.0
            offset_x = 0.0
            offset_y = 0.0
            target_origin = ((bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2)
        for element in elements:
            coords = element.pop("world_xyz_m")
            out = []
            for i in range(0, len(coords), 3):
                wx, wy, wz = coords[i], coords[i + 1], coords[i + 2]
                mx, my = wx * scale + offset_x, wy * scale + offset_y
                if can_align:
                    out.extend([(mx - dxf_x0 * 0.01), wz, -(my - dxf_y0 * 0.01)])
                else:
                    out.extend([(mx - target_origin[0]) * scale, wz, -(my - target_origin[1]) * scale])
            element["positions_xyz"] = out
        storeys = []
        for entity_id, (kind, attrs) in entities.items():
            if kind == "IFCBUILDINGSTOREY":
                storeys.append({"id": entity_id, "name": attrs[2].strip("'") if attrs[2] not in ("$", "") else "Unnamed level",
                                "long_name": attrs[7].strip("'") if len(attrs) > 7 and attrs[7] not in ("$", "") else None,
                                "elevation_m": float(attrs[9]) if len(attrs) > 9 and attrs[9] not in ("$", "") else None})
        data = {
            "schema_version": 1, "building_id": "MGEORGE_IFC_CANDIDATE", "floor_id": floor_id, "floor_label": floor_label,
            "source_file": source.name, "ifc_schema": "IFC4", "units": "metres", "ifc_space_count": sum(t == "IFCSPACE" for t, _ in entities.values()),
            "storeys": storeys, "mesh_elements": elements, "summary": {"direct_mesh_element_counts": dict(category_counts), "direct_mesh_element_count": len(elements),
              "mesh_vertex_count": sum(len(e["positions_xyz"]) // 3 for e in elements), "world_bounds_xyz_m": [round(v, 4) for v in bounds], "world_extents_xyz_m": [round(v, 4) for v in extents]},
            "dxf_overlay": {"target_floor_id": align_floor, "status": "bounding_box_fit_candidate_unverified" if can_align else "not_registered_to_mits_dxf",
              "max_dimension_mismatch_fraction": round(mismatch, 4) if mismatch is not None else None,
              "note": "IFC filename/building identity is not proven to match the MITS Main Block DXF; alignment is a reversible visual candidate." if can_align else "No reliable floor-plan registration found; shown in an independent local frame."}}
        out_path = OUT / f"{floor_id}.json"
        out_path.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
        print(json.dumps({"file": str(out_path), "floor": floor_label, "summary": data["summary"], "dxf_overlay": data["dxf_overlay"], "storeys": storeys}))


if __name__ == "__main__":
    main()
