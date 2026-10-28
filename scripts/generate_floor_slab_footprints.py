#!/usr/bin/env python3
"""Recover floor slab footprints from extracted CAD wall linework.

The renderer draws walls as 0.24-unit-thick prisms. This script rasterizes each
floor's own wall segments at 0.05-unit resolution with matching thickness,
flood-fills the exterior from a padded corner, and traces the remaining
interior boundary. This follows concavities/notches without a convex hull.
Semantic floor-region polygons for staircase/lift records are retained as slab
holes only where the source already supplies such a polygon.

Requires Pillow, already used by the repository's inspection environment.
This writes only public/data/floor_slab_footprints.json; it does not modify the
source walls, semantics, or floor-region files.
"""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
FLOORS = (4, 5, 6)
RESOLUTION = 20  # 20 pixels per source unit = 0.05-unit cells.
WALL_THICKNESS = 0.24
PAD = 2.0
EXTERIOR = 128


def signed_area(points: list[tuple[int, int]]) -> float:
    return sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    ) / 2


def boundary_loops(mask: Image.Image) -> list[list[tuple[int, int]]]:
    """Trace cell edges around all non-exterior pixels, keeping void loops."""
    pixels = mask.load()
    width, height = mask.size
    edges: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    for y in range(height):
        for x in range(width):
            if pixels[x, y] == EXTERIOR:
                continue
            if y == 0 or pixels[x, y - 1] == EXTERIOR:
                edges.add(((x, y), (x + 1, y)))
            if x == width - 1 or pixels[x + 1, y] == EXTERIOR:
                edges.add(((x + 1, y), (x + 1, y + 1)))
            if y == height - 1 or pixels[x, y + 1] == EXTERIOR:
                edges.add(((x + 1, y + 1), (x, y + 1)))
            if x == 0 or pixels[x - 1, y] == EXTERIOR:
                edges.add(((x, y + 1), (x, y)))

    outgoing: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for start, end in edges:
        outgoing.setdefault(start, []).append(end)
    loops = []
    while edges:
        start, next_point = next(iter(edges))
        edges.remove((start, next_point))
        points = [start, next_point]
        previous, current = start, next_point
        while current != start:
            candidates = [end for end in outgoing.get(current, []) if (current, end) in edges]
            if not candidates:
                break
            dx, dy = current[0] - previous[0], current[1] - previous[1]
            direction = {(1, 0): 0, (0, 1): 1, (-1, 0): 2, (0, -1): 3}[(dx, dy)]
            # At diagonal pixel contacts, keep the occupied cells on the right.
            def turn_rank(end: tuple[int, int]) -> int:
                out_direction = {(1, 0): 0, (0, 1): 1, (-1, 0): 2, (0, -1): 3}[
                    (end[0] - current[0], end[1] - current[1])
                ]
                return {(direction + 1) % 4: 0, direction: 1, (direction + 3) % 4: 2, (direction + 2) % 4: 3}[out_direction]

            following = min(candidates, key=turn_rank)
            edges.remove((current, following))
            previous, current = current, following
            points.append(current)
        if len(points) >= 4 and points[-1] == points[0]:
            points.pop()
            # Remove collinear raster steps; retain every actual change in direction.
            compact = []
            for index, point in enumerate(points):
                before = points[index - 1]
                after = points[(index + 1) % len(points)]
                if (point[0] - before[0]) * (after[1] - point[1]) != (point[1] - before[1]) * (after[0] - point[0]):
                    compact.append(point)
            if len(compact) >= 3:
                loops.append(compact)
    return loops


def recover_floor(floor: int) -> dict:
    data_dir = ROOT / "public" / "data" / f"Ramanujan_F{floor}"
    walls_data = json.loads((data_dir / "walls.json").read_text())
    wall_segments = walls_data["walls"]
    xs = [wall[key] for wall in wall_segments for key in ("x1", "x2")]
    ys = [wall[key] for wall in wall_segments for key in ("y1", "y2")]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    origin_x, top_y = min_x - PAD, max_y + PAD
    width = math.ceil((max_x - min_x + 2 * PAD) * RESOLUTION)
    height = math.ceil((max_y - min_y + 2 * PAD) * RESOLUTION)
    raster = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(raster)

    def pixel(x: float, y: float) -> tuple[int, int]:
        return round((x - origin_x) * RESOLUTION), round((top_y - y) * RESOLUTION)

    wall_px = round(WALL_THICKNESS * RESOLUTION)
    for wall in wall_segments:
        draw.line((pixel(wall["x1"], wall["y1"]), pixel(wall["x2"], wall["y2"])), fill=0, width=wall_px)

    # Flood-fill the connected exterior. Walls and enclosed floor areas remain.
    ImageDraw.floodfill(raster, (0, 0), EXTERIOR, thresh=0)
    loops = boundary_loops(raster)
    if not loops:
        raise ValueError(f"Floor {floor}: no enclosed outline recovered")

    # Pixel-edge winding is positive for exterior contours and negative for holes.
    outers = [loop for loop in loops if signed_area(loop) > 0]
    if not outers:
        raise ValueError(f"Floor {floor}: no exterior contour recovered")
    # The wall network should describe one main footprint; reject stray loops
    # rather than silently emitting disconnected wall fragments as floor slabs.
    outer = max(outers, key=lambda ring: abs(signed_area(ring)))
    extra_areas = [abs(signed_area(ring)) / RESOLUTION**2 for ring in outers if ring is not outer]

    def cad_ring(ring: list[tuple[int, int]]) -> list[list[float]]:
        return [
            [round(origin_x + x / RESOLUTION, 4), round(top_y - y / RESOLUTION, 4)]
            for x, y in ring
        ]

    regions = json.loads((data_dir / "floor_regions.json").read_text())["regions"]
    semantics = json.loads((data_dir / "semantics.json").read_text())["places"]
    type_by_id = {place["id"]: place.get("type", "") for place in semantics}
    openings = []
    for region in regions:
        if type_by_id.get(region["semantic_id"]) not in {"staircase", "vertical_transport", "lift", "elevator"}:
            continue
        openings.append({"source_region": region["semantic_id"], "cad_xy": region["polygon"]})
    opening_ids = {opening["source_region"] for opening in openings}
    unsupported_connector_regions = [
        place["id"] for place in semantics
        if place.get("type") in {"staircase", "vertical_transport", "lift", "elevator"}
        and place["id"] not in opening_ids
    ]

    return {
        "floor": str(floor),
        "method": "0.05-unit raster wall envelope, exterior flood-fill, pixel-edge contour tracing",
        "source_wall_thickness": WALL_THICKNESS,
        "boundary_cad_xy": cad_ring(outer),
        "openings": openings,
        "diagnostics": {
            "source_wall_segments": len(wall_segments),
            "outer_loop_count": len(outers),
            "ignored_disconnected_loop_areas": [round(area, 3) for area in extra_areas],
            "enclosed_voids_distinguished_from_rooms": False,
            "connector_voids_without_source_region": unsupported_connector_regions,
        },
    }


def main() -> None:
    output = ROOT / "public" / "data" / "floor_slab_footprints.json"
    result = {
        "schema_version": 1,
        "coordinate_system": "Source CAD XY; render with localX = cadX - floorMinX and localZ = -(cadY - floorMinY)",
        "floors": [recover_floor(floor) for floor in FLOORS],
    }
    output.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(f"Wrote per-floor slab contours to {output.relative_to(ROOT)}")
    for floor in result["floors"]:
        print(f"Floor {floor['floor']}: {len(floor['boundary_cad_xy'])} boundary points; diagnostics={floor['diagnostics']}")


if __name__ == "__main__":
    main()
