#!/usr/bin/env python3
"""Storey outlines of M. George and Ramanujan Blocks, for the kiosk's 3D campus view.

Each drawn floor's outline = its coloured room plan (the rooms texture, which
leaves courtyards empty) plus its walls, closed over small gaps. The view
stacks one block per storey at real height. Ramanujan floors that are not
drawn (Ground, First and Third) borrow the outline of the floor above them,
and are flagged as estimated.

Run after the M. George and Ramanujan builds:

    PYTHONPATH=scripts .venv/bin/python scripts/build_campus_massing.py
"""
from __future__ import annotations

import json
from pathlib import Path

import contourpy
import matplotlib.image as mpimg
import numpy as np
from scipy import ndimage
from shapely.geometry import Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "frontend/public/data"
OUTPUT = DATA / "campus_massing.json"

CELL_M = 0.25
CLOSE_M = 0.75        # bridges door openings and gaps in the wall linework
MIN_HOLE_M2 = 25.0    # smaller holes are drawing gaps, larger ones courtyards
MIN_PART_M2 = 20.0
SIMPLIFY_M = 0.35
STOREY_HEIGHT_M = 3.3

# Ramanujan storeys not drawn yet -> the drawn floor whose outline they borrow.
RAMANUJAN_UNDRAWN = {"R0": "R2", "R1": "R2", "R3": "R4"}


def floor_outline(base: Path, rooms_file: str, walls_file: str) -> list[Polygon]:
    rooms = json.loads((base / rooms_file).read_text())
    tex = rooms["texture"]
    alpha = mpimg.imread(base / tex["file"])[..., 3][::-1] > 0.5  # row 0 = south
    x0, y0 = tex["origin_xy"][0] - 2, tex["origin_xy"][1] - 2
    cols = int((tex["width_m"] + 4) / CELL_M)
    rows = int((tex["height_m"] + 4) / CELL_M)
    r, c = np.mgrid[0:rows, 0:cols]
    tr = (((y0 + (r + 0.5) * CELL_M) - tex["origin_xy"][1]) / tex["height_m"] * alpha.shape[0]).astype(int)
    tc = (((x0 + (c + 0.5) * CELL_M) - tex["origin_xy"][0]) / tex["width_m"] * alpha.shape[1]).astype(int)
    inside = (tr >= 0) & (tr < alpha.shape[0]) & (tc >= 0) & (tc < alpha.shape[1])
    mask = np.zeros((rows, cols), dtype=bool)
    mask[inside] = alpha[tr[inside], tc[inside]]

    walls = json.loads((base / walls_file).read_text())["segments"]
    for x1, y1, x2, y2 in walls["wall"] + walls["window"]:
        n = max(2, int(np.hypot(x2 - x1, y2 - y1) / (CELL_M / 2)))
        cc = ((np.linspace(x1, x2, n) - x0) / CELL_M).astype(int)
        rr = ((np.linspace(y1, y2, n) - y0) / CELL_M).astype(int)
        ok = (rr >= 0) & (rr < rows) & (cc >= 0) & (cc < cols)
        mask[rr[ok], cc[ok]] = True

    steps = int(CLOSE_M / CELL_M)
    mask = ndimage.binary_closing(np.pad(mask, steps), iterations=steps)[steps:-steps, steps:-steps]
    holes, count = ndimage.label(~mask)
    sizes = ndimage.sum(np.ones_like(mask), holes, range(1, count + 1)) * CELL_M ** 2
    for label, size in enumerate(sizes, start=1):
        if size < MIN_HOLE_M2:
            mask[holes == label] = True

    # Traced on cell centres, so the outline sits on the plan's edge.
    generator = contourpy.contour_generator(
        x=x0 + (np.arange(cols) + 0.5) * CELL_M, y=y0 + (np.arange(rows) + 0.5) * CELL_M,
        z=mask.astype(float), fill_type=contourpy.FillType.OuterOffset)
    polygons = []
    for points, offsets in zip(*generator.filled(0.5, 1.5)):
        rings = [points[a:b] for a, b in zip(offsets[:-1], offsets[1:])]
        polygons.append(Polygon(rings[0], rings[1:]).buffer(0))
    parts = unary_union(polygons).simplify(SIMPLIFY_M)
    parts = list(getattr(parts, "geoms", [parts]))
    return [part for part in parts if part.area >= MIN_PART_M2]


def as_json(polygon: Polygon) -> dict:
    ring = lambda coords: [[round(x, 2), round(y, 2)] for x, y in list(coords)[:-1]]
    return {"outer": ring(polygon.exterior.coords), "holes": [ring(hole.coords) for hole in polygon.interiors]}


def building(base: Path) -> dict:
    data = json.loads((base / "building.json").read_text())
    storeys = []
    outlines = {}
    for floor in data["floors"]:
        key = floor["floor_number"]
        outlines[key] = floor_outline(base, floor["rooms"], floor["walls"])
        level = floor.get("stack_level", floor.get("level", key))
        storeys.append({"floor": key, "label": floor["label"], "stack_level": level, "estimated": False,
                        "parts": [as_json(part) for part in outlines[key]]})
    if data["building"] == "Ramanujan Block":
        offset = storeys[0]["stack_level"] - int(str(storeys[0]["floor"])[1:])
        for key, source in RAMANUJAN_UNDRAWN.items():
            storeys.append({"floor": key, "label": None, "stack_level": int(key[1:]) + offset, "estimated": True,
                            "parts": [as_json(part) for part in outlines[source]]})
    storeys.sort(key=lambda item: item["stack_level"])
    for storey in storeys:
        area = sum(Polygon(p["outer"], p["holes"]).area for p in storey["parts"])
        print(f"{data['building']} {storey['floor']}: level {storey['stack_level']}, {len(storey['parts'])} part(s), {area:.0f} m2"
              + (" (estimated)" if storey["estimated"] else ""))
    return {"name": data["building"], "storeys": storeys}


def main():
    result = {
        "schema_version": 1,
        "note": "Storey outlines in M. George's frame (metres). stack_level: storeys counted from M. George's Ground Floor.",
        "storey_height_m": STOREY_HEIGHT_M,
        "buildings": [building(DATA / "MGeorge_nav"), building(DATA / "Ramanujan_nav")],
    }
    OUTPUT.write_text(json.dumps(result, separators=(",", ":")))
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
