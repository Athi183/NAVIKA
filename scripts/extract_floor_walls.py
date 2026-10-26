#!/usr/bin/env python3
"""Extract floor-plan linework from a DXF using an explicit plan window.

The window is intentional: this Floor 4 file has displaced dimension/block
content outside the architectural plan. Coordinates stay in source CAD units.
"""
import argparse
import json
import math
from pathlib import Path

import ezdxf


def xy_segments(points, closed=False):
    points = list(points)
    pairs = list(zip(points, points[1:]))
    if closed and len(points) > 2:
        pairs.append((points[-1], points[0]))
    return pairs


def inside(p, bounds, margin=0.0):
    x, y = p[0], p[1]
    xmin, ymin, xmax, ymax = bounds
    return xmin - margin <= x <= xmax + margin and ymin - margin <= y <= ymax + margin


def extract(source, output, bounds, min_length, floor, exclude_handles=()):
    doc = ezdxf.readfile(source)
    msp = doc.modelspace()
    segments = []
    included = {}
    excluded = {}

    def add(kind, handle, pairs):
        included[kind] = included.get(kind, 0) + 1
        for a, b in pairs:
            a, b = (float(a[0]), float(a[1])), (float(b[0]), float(b[1]))
            if not (inside(a, bounds) and inside(b, bounds)):
                continue
            length = math.hypot(b[0] - a[0], b[1] - a[1])
            if length < min_length:
                continue
            segments.append((a, b, handle))

    for entity in msp:
        typ = entity.dxftype()
        if entity.dxf.handle in exclude_handles:
            excluded["configured_nonwall_handles"] = excluded.get("configured_nonwall_handles", 0) + 1
            continue
        if typ == "LINE":
            add(typ, entity.dxf.handle, [(entity.dxf.start, entity.dxf.end)])
        elif typ == "LWPOLYLINE":
            # Preserve straight segments; reject bulged curves rather than silently
            # flatten them. The supplied plan polylines have no nonzero bulges.
            pts = list(entity.get_points("xyb"))
            if any(abs(float(p[2])) > 1e-10 for p in pts):
                excluded["LWPOLYLINE_bulged"] = excluded.get("LWPOLYLINE_bulged", 0) + 1
                continue
            add(typ, entity.dxf.handle, xy_segments([(p[0], p[1]) for p in pts], entity.closed))
        elif typ == "POLYLINE":
            verts = list(entity.vertices)
            if any(abs(float(v.dxf.get("bulge", 0))) > 1e-10 for v in verts):
                excluded["POLYLINE_bulged"] = excluded.get("POLYLINE_bulged", 0) + 1
                continue
            add(typ, entity.dxf.handle, xy_segments([v.dxf.location for v in verts], entity.is_closed))
        else:
            excluded[typ] = excluded.get(typ, 0) + 1

    # Remove exact duplicate segments only, keeping distinct paired wall faces.
    unique = {}
    for a, b, handle in segments:
        key = tuple(round(v, 8) for v in (*a, *b))
        rev = tuple(round(v, 8) for v in (*b, *a))
        canonical = min(key, rev)
        unique.setdefault(canonical, (a, b, handle))
    records = []
    for i, (a, b, _handle) in enumerate(sorted(unique.values(), key=lambda s: (s[0], s[1], s[2])), 1):
        x1, y1, x2, y2 = (round(a[0], 6), round(a[1], 6), round(b[0], 6), round(b[1], 6))
        records.append({"id": f"WALL_{i:03d}", "type": "line_wall", "x1": x1,
                        "y1": y1, "x2": x2, "y2": y2,
                        "length": round(math.hypot(x2-x1, y2-y1), 6), "source_segments": 1})
    result = {"floor": str(floor), "source": Path(source).name, "coordinate_system": "CAD XY (source drawing units; see DXF $INSUNITS metadata)",
              "geometry_summary": {"wall_segment_count": len(records), "source_entity_counts": dict(sorted(__import__('collections').Counter(e.dxftype() for e in msp).items())),
                                   "included_entity_counts": included, "excluded_entity_counts": excluded,
                                   "exact_duplicate_segments_removed": len(segments)-len(unique),
                                   "excluded_source_handles": sorted(exclude_handles),
                                   "plan_bounds": {"min_x": bounds[0], "min_y": bounds[1], "max_x": bounds[2], "max_y": bounds[3]},
                                   "minimum_segment_length": min_length, "source_unit_code": doc.header.get("$INSUNITS")}, "walls": records}
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).write_text(json.dumps(result, indent=2) + "\n")
    return doc, result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("input")
    p.add_argument("output")
    p.add_argument("--floor", default="4", help="Floor identifier written to output JSON")
    p.add_argument("--exclude-handles", nargs="*", default=[], help="Source entity handles inspected and excluded as non-wall symbols")
    p.add_argument("--bounds", nargs=4, type=float, default=[642.0, 261.0, 728.0, 297.0], metavar=("MIN_X", "MIN_Y", "MAX_X", "MAX_Y"))
    p.add_argument("--min-length", type=float, default=0.001, help="Discard segments shorter than this source-unit length (default is 1000x the six-decimal output precision)")
    a = p.parse_args()
    _, data = extract(a.input, a.output, a.bounds, a.min_length, a.floor, a.exclude_handles)
    print(json.dumps(data["geometry_summary"], indent=2))


if __name__ == "__main__":
    main()
