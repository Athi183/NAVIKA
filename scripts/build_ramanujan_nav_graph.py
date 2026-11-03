#!/usr/bin/env python3
"""Walkable-route data for Ramanujan Block floors 4-6, joined to M. George by the bridge.

Floors 4, 5 and 6 come from Fathima Mehrin's Ramanujan viewer data
(ramanujan-viewer/public/data/Ramanujan_F4..F6: walls, room names and
positions), aligned with each other by her stackedFloorConfig.ts offsets. That
data is read only, never changed.

Visitors reach those floors over the bridge on the Second Floor: from the west
end of the M. George Second Floor corridor across to Ramanujan's Second Floor,
where a 3.08 m opening between Turing Lab and Caeser Lab is labelled
"CONNECTION BRIDGE" in the multi-floor Ramanujan DXF. The Second Floor comes
from that DXF (frontend/src/data/ramanujan_floors_2_6.json) and is used only to
walk from the bridge to the lifts and stairs.

Everything is written in M. George's frame (metres, floor 1 frame) so routes
run straight from one building into the other. Ramanujan is placed by the
bridge alone: its door faces M. George's west-end door across BRIDGE_LENGTH_M.
That placement is approximate until the bridge is measured.

Run after scripts/build_mgeorge_nav_graph.py (the bridge joins a M. George
Second Floor node by id):

    PYTHONPATH=scripts .venv/bin/python scripts/build_ramanujan_nav_graph.py --preview-dir inspection_navigation
"""
from __future__ import annotations

import argparse
import json
import math
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy import ndimage, signal

import build_mgeorge_nav_graph as mg

ROOT = Path(__file__).resolve().parents[1]
VIEWER_DATA = ROOT / "ramanujan-viewer/public/data"
MULTIFLOOR = ROOT / "frontend/src/data/ramanujan_floors_2_6.json"
MGEORGE_DIR = ROOT / "frontend/public/data/MGeorge_nav"
DEFAULT_OUTPUT_DIR = ROOT / "frontend/public/data/Ramanujan_nav"

# Mehrin's floor alignment (offsetX, offsetZ) from ramanujan-viewer/src/stackedFloorConfig.ts.
MEHRIN_OFFSETS = {4: (0.0, 0.0), 5: (-0.024855, 0.002161), 6: (-0.572493, -1.527466)}
ORDINAL = {2: "Second", 4: "Fourth", 5: "Fifth", 6: "Sixth"}

# The bridge. M. George side: the west-end opening of the Second Floor main
# corridor. Ramanujan side: the bridge opening on its Second Floor, in the
# multi-floor DXF's coordinates. The length has not been measured.
BRIDGE_MG_FLOOR = 2
BRIDGE_MG_DOOR = (-61.9, 9.0)
BRIDGE_RAMANUJAN_DOOR_DXF = (93.1, 27.4)
BRIDGE_LENGTH_M = 15.0

MIN_AREA_M2 = 30          # walkable pockets smaller than this (lift cars, stair wells) are ignored
SHEET_FRAME_M = 50        # longer single lines are the drawing sheet frame, not walls
ALIGN_CELL_M = 0.2

CATEGORIES = {
    "classroom": "classroom", "laboratory": "lab", "department": "department", "hall": "hall",
    "toilet": "toilet", "vertical_transport": "lift", "staircase": "stairs", "facility": "facility",
}
SERVICE_WORDS = ("ELECTRICAL", "ENGINE", "WASH")
KEEP_UPPER = {"CSE", "AIDS", "IDP", "CY", "CS", "AI", "DS"}
STAIR_WEIGHT_M = mg.STAIR_WEIGHT_M
LIFT_BOARD_M = mg.LIFT_BOARD_M
LIFT_FLOOR_M = mg.LIFT_FLOOR_M
CONNECTOR_MATCH_M = {"stairs": 8.0, "lift": 4.0}


def floor_key(level):
    return f"R{level}"


def tidy(name):
    """'S5/S6 CSE-A CLASS ROOM' -> 'S5/S6 CSE-A Class Room'; acronyms and mixed-case words stay."""
    def fix(match):
        word = match.group(0)
        if word in ("OF", "AND", "FOR"):
            return word.lower()
        return word.title() if word.isupper() and len(word) > 2 and word not in KEEP_UPPER else word

    return re.sub(r"[A-Za-z]+", fix, re.sub(r"\s*/\s*", "/", name.strip()))


def category(place):
    if place["type"] == "facility" and any(w in place["name"].upper() for w in SERVICE_WORDS):
        return "service"
    return CATEGORIES.get(place["type"], "facility")


# ---------------------------------------------------------------- source data

def mehrin_floor(level):
    """Walls (segments), places and room outlines of one of Mehrin's floors, in her shared frame."""
    folder = VIEWER_DATA / f"Ramanujan_F{level}"
    walls = json.loads((folder / "walls.json").read_text())["walls"]
    places = json.loads((folder / "semantics.json").read_text())["places"]
    regions = json.loads((folder / "floor_regions.json").read_text())["regions"]
    # Her viewer: x = cadX - minX + offsetX, z = -(cadY - minY) + offsetZ, so plan y = cadY - minY - offsetZ.
    min_x = min(min(w["x1"], w["x2"]) for w in walls)
    min_y = min(min(w["y1"], w["y2"]) for w in walls)
    ox, oz = MEHRIN_OFFSETS[level]

    def to_frame(x, y):
        return (x - min_x + ox, y - min_y - oz)

    segments = [(*to_frame(w["x1"], w["y1"]), *to_frame(w["x2"], w["y2"])) for w in walls]
    for place in places:
        place["frame_xy"] = to_frame(place["cadX"], place["cadY"])
    outlines = [(r["semantic_id"], [to_frame(x, y) for x, y in r["polygon"]]) for r in regions]
    return segments, places, outlines


def multifloor_floor(level):
    """Segments, labels and stair/lift positions from the multi-floor DXF, without the sheet frame."""
    floor = next(f for f in json.loads(MULTIFLOOR.read_text())["floors"] if f["floor_number"] == level)
    dy = floor["coordinate_transform"]["y_offset_m"]
    segments = [(x1, y1 + dy, x2, y2 + dy) for x1, y1, x2, y2 in floor["segments_source_dxf"]
                if math.hypot(x2 - x1, y2 - y1) < SHEET_FRAME_M]
    return segments, floor["labels"], floor["connectors"]


def raster(segments, origin, shape):
    img = np.zeros(shape, dtype=np.float32)
    for x1, y1, x2, y2 in segments:
        n = max(2, int(math.hypot(x2 - x1, y2 - y1) / (ALIGN_CELL_M / 2)))
        cols = ((np.linspace(x1, x2, n) - origin[0]) / ALIGN_CELL_M).astype(int)
        rows = ((np.linspace(y1, y2, n) - origin[1]) / ALIGN_CELL_M).astype(int)
        ok = (rows >= 0) & (rows < shape[0]) & (cols >= 0) & (cols < shape[1])
        img[rows[ok], cols[ok]] = 1
    return ndimage.binary_dilation(img, iterations=2).astype(np.float32)


def align_to_mehrin(segments, mehrin_segments):
    """Translation taking multi-floor DXF coordinates into Mehrin's frame, by
    cross-correlating the two wall drawings (same building, same scale)."""
    def bounds(segs):
        xs = [v for s in segs for v in (s[0], s[2])]
        ys = [v for s in segs for v in (s[1], s[3])]
        return min(xs), min(ys), max(xs), max(ys)

    ax0, ay0, ax1, ay1 = bounds(mehrin_segments)
    bx0, by0, bx1, by1 = bounds(segments)
    size = (int(max(ay1 - ay0, by1 - by0) / ALIGN_CELL_M) + 20, int(max(ax1 - ax0, bx1 - bx0) / ALIGN_CELL_M) + 20)
    a = raster(mehrin_segments, (ax0, ay0), size)
    b = raster(segments, (bx0, by0), size)
    corr = signal.fftconvolve(a, b[::-1, ::-1], mode="full")
    r, c = np.unravel_index(np.argmax(corr), corr.shape)
    shift_rows, shift_cols = r - (size[0] - 1), c - (size[1] - 1)
    # mehrin = dxf - (bx0, by0) + (ax0, ay0) + shift
    return (ax0 - bx0 + shift_cols * ALIGN_CELL_M, ay0 - by0 + shift_rows * ALIGN_CELL_M)


# ---------------------------------------------------------------- placement

def placement(bridge_door_frame):
    """Rigid transform from Mehrin's frame into M. George's frame.

    The bridge leaves Ramanujan southwards (-y in Mehrin's frame) and reaches
    M. George's west end heading east, so the frame turns by +90 degrees and
    Ramanujan's door lands BRIDGE_LENGTH_M west of M. George's door.
    """
    far_end = (BRIDGE_MG_DOOR[0] - BRIDGE_LENGTH_M, BRIDGE_MG_DOOR[1])
    bx, by = bridge_door_frame

    def to_mg(x, y):
        dx, dy = x - bx, y - by
        return (round(far_end[0] - dy, 3), round(far_end[1] + dx, 3))

    return to_mg, far_end


# ---------------------------------------------------------------- one floor

def build_floor(level, segments, places, connectors, output_dir, extra_destinations=(), outlines=None):
    """Walkable graph, walls, rooms and mask for one floor (segments and places in M. George's frame)."""
    key = floor_key(level)
    origin = mg.ORIGIN_XY

    def src(x, y):
        return origin[0] + x * 100, origin[1] + y * 100

    def to_local(sx, sy):
        return [round((sx - origin[0]) / 100, 3), round((sy - origin[1]) / 100, 3)]

    xs = [v for s in segments for v in (s[0], s[2])]
    ys = [v for s in segments for v in (s[1], s[3])]
    window = (*src(min(xs) - 3, min(ys) - 3), *src(max(xs) + 3, max(ys) + 3))
    grid = mg.Grid(window)
    obstacles = np.zeros((grid.h, grid.w), dtype=bool)
    polylines = []
    for x1, y1, x2, y2 in segments:
        pts = [src(x1, y1), src(x2, y2)]
        grid.burn_segments(obstacles, pts)
        polylines.append(("WALL", pts))
    obstacles = ndimage.binary_dilation(obstacles, iterations=1)

    close = int(mg.FOOTPRINT_CLOSE_CM / mg.CELL_CM)
    structure = ndimage.generate_binary_structure(2, 1)
    footprint = ndimage.binary_closing(np.pad(obstacles, close), structure, iterations=close)[close:-close, close:-close]
    footprint = ndimage.binary_fill_holes(footprint)
    parts, count = ndimage.label(footprint)
    if count > 1:
        footprint = parts == np.argmax(np.bincount(parts.ravel())[1:]) + 1

    clearance = ndimage.distance_transform_edt(~obstacles) * mg.CELL_CM
    walkable = (clearance >= mg.CLEARANCE_CM) & footprint
    labels, _ = ndimage.label(walkable, structure=np.ones((3, 3)))
    sizes = np.bincount(labels.ravel())
    big = sizes * (mg.CELL_CM / 100) ** 2 >= MIN_AREA_M2
    big[0] = False
    _, (br, bc) = ndimage.distance_transform_edt(~big[labels], return_indices=True)

    def big_label(xy):
        r, c = (int(v) for v in grid.to_cell(*src(*xy)))
        r, c = min(max(r, 0), grid.h - 1), min(max(c, 0), grid.w - 1)
        return labels[br[r, c], bc[r, c]]

    # Keep the corridors the stairs and lifts (and the bridge) open onto.
    seeds = [c["xy"] for c in connectors] + [d["xy"] for d in extra_destinations]
    reachable = np.isin(labels, [big_label(xy) for xy in seeds])

    nodes, edges = mg.centreline_graph(grid, reachable, origin, f"RB{level:02d}", key)
    snap = mg.make_snapper(grid, reachable, nodes, origin, to_local)

    destinations = []
    for place in places:
        name = tidy(place["name"])
        number = place.get("roomNumber")
        destinations.append({
            "id": f"rb{level}_{place['id']}",
            "semantic_id": place["id"],
            "name": f"{name} ({number})" if number and number not in name else name,
            "room_no": number,
            "category": category(place),
            "xy": list(place["xy"]),
            "confidence": "high",
            "note": f"From Mehrin's Ramanujan Floor {level} data (semantics.json id {place['id']}).",
        })
    destinations += [dict(d) for d in extra_destinations]
    destinations = [{**d, **snap(d["xy"])} for d in destinations]
    connectors = [{"id": f"RB{level:02d}_C{i:02d}", **c, **snap(c["xy"])} for i, c in enumerate(connectors)]

    result = {
        "schema_version": "navika-walkable-graph-0.1",
        "building": "Ramanujan Block",
        "floor_number": key,
        "level": level,
        "floor_label": f"{ORDINAL[level]} Floor",
        "elevation_m": round(level * mg.FLOOR_HEIGHT_M, 2),
        "review_status": "auto_generated_requires_review",
        "coordinate_system": {"units": "metres, M. George's frame (floor 1); Ramanujan placed by the bridge, approximate"},
        "parameters": {"cell_cm": mg.CELL_CM, "clearance_cm": mg.CLEARANCE_CM},
        "kiosk": None,
        "destinations": destinations,
        "connectors": connectors,
        "nodes": nodes,
        "edges": edges,
        "walkable_mask": mg.export_mask(grid, reachable, to_local),
    }
    spec = {"label": result["floor_label"]}
    walls = mg.export_walls(grid, footprint, polylines, to_local, key, spec)
    walls["building"] = "Ramanujan Block"
    if outlines:
        rooms, room_labels = rooms_from_outlines(grid, footprint, obstacles, reachable, outlines, destinations, to_local, src)
    else:
        rooms, room_labels = mg.segment_rooms(grid, obstacles, footprint, reachable, destinations, to_local, origin)
    texture = f"floor_{key}_rooms.png"
    rooms["texture"]["file"] = texture
    rooms.update({"building": "Ramanujan Block", "floor_number": key, "floor_label": result["floor_label"]})
    mg.write_room_texture(output_dir / texture, rooms, room_labels, footprint, obstacles)
    (output_dir / f"floor_{key}_walls.json").write_text(json.dumps(walls, separators=(",", ":")))
    (output_dir / f"floor_{key}_rooms.json").write_text(json.dumps(rooms, separators=(",", ":")))
    print(f"{key}: {len(segments)} wall segments, walkable ~{reachable.sum() * mg.CELL_CM ** 2 / 1e4:.0f} m², "
          f"{len(nodes)} nodes, {len(edges)} edges, {len(destinations)} places, {len(connectors)} stairs/lifts")
    return result, grid, obstacles, reachable


def rooms_from_outlines(grid, footprint, obstacles, reachable, outlines, destinations, to_local, src):
    """Room colours from Mehrin's room outlines: each outline coloured by its
    place's category, walkable space outside them as corridor."""
    by_semantic = {d["semantic_id"]: d for d in destinations if d.get("semantic_id")}
    labels = np.zeros((grid.h, grid.w), dtype=np.int32)
    regions = []
    for semantic_id, polygon in outlines:
        place = by_semantic.get(semantic_id)
        if place:
            group = mg.CATEGORY_GROUP.get(place["category"], "unassigned")
        else:  # stair and lift outlines ('lift', 'staircase_left', ...) are not room places
            group = "connector" if semantic_id.startswith(("lift", "staircase")) else "unassigned"
        mask = np.zeros_like(footprint)
        grid.fill_polygon(mask, [src(x, y) for x, y in polygon])
        labels[mask & ~obstacles & (labels == 0)] = len(regions) + 1
        xs, ys = zip(*polygon)
        regions.append({"id": f"room_{len(regions):03d}", "group": group, "colour": mg.ROOM_COLOURS.get(group),
                        "area_m2": round(float(mask.sum()) * (mg.CELL_CM / 100) ** 2, 1),
                        "bbox": [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)],
                        "destinations": [place["id"]] if place else []})
    corridor = reachable & (labels == 0)
    labels[corridor] = len(regions) + 1
    rows, cols = np.nonzero(corridor)
    regions.append({"id": f"room_{len(regions):03d}", "group": "corridor", "colour": mg.ROOM_COLOURS["corridor"],
                    "area_m2": round(float(corridor.sum()) * (mg.CELL_CM / 100) ** 2, 1),
                    "bbox": [*to_local(*grid.to_source(rows.min(), cols.min())), *to_local(*grid.to_source(rows.max(), cols.max()))],
                    "destinations": []})
    rows, cols = np.nonzero(footprint)
    r0, r1, c0, c1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
    summary = defaultdict(int)
    for region in regions:
        summary[region["group"]] += 1
    return {
        "schema_version": "navika-floor-rooms-0.1",
        "building": "Ramanujan Block",
        "review_status": "from Mehrin's floor_regions.json",
        "method": "room outlines from ramanujan-viewer floor_regions.json; walkable space outside them is corridor",
        "colours": mg.ROOM_COLOURS,
        "texture": {"origin_xy": to_local(grid.x0 + c0 * mg.CELL_CM, grid.y0 + r0 * mg.CELL_CM),
                    "width_m": round((c1 - c0) * mg.CELL_CM / 100, 2), "height_m": round((r1 - r0) * mg.CELL_CM / 100, 2),
                    "crop_cells": [int(r0), int(r1), int(c0), int(c1)]},
        "regions": regions,
        "summary": dict(summary),
    }, labels


def render_preview(path, grid, obstacles, reachable, result):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    x0, y0 = (grid.x0 - mg.ORIGIN_XY[0]) / 100, (grid.y0 - mg.ORIGIN_XY[1]) / 100
    extent = (x0, x0 + grid.w * mg.CELL_CM / 100, y0, y0 + grid.h * mg.CELL_CM / 100)
    img = np.ones((grid.h, grid.w, 3))
    img[reachable] = (0.80, 0.93, 0.80)
    img[obstacles] = (0.15, 0.15, 0.15)
    fig, ax = plt.subplots(figsize=(12, 18), dpi=80)
    ax.imshow(img, origin="lower", extent=extent, interpolation="nearest")
    pos = {n["id"]: (n["x"], n["y"]) for n in result["nodes"]}
    for e in result["edges"]:
        (xa, ya), (xb, yb) = pos[e["from"]], pos[e["to"]]
        ax.plot([xa, xb], [ya, yb], color="#1d4ed8", lw=1)
    for d in result["destinations"]:
        ax.plot(*d["xy"], "o", color="#15803d" if d["line_of_sight"] else "#dc2626", ms=7, mec="black")
        ax.annotate(d["name"], d["xy"], xytext=(4, 4), textcoords="offset points", fontsize=7,
                    bbox={"boxstyle": "round,pad=0.15", "fc": "white", "alpha": 0.8})
    for c in result["connectors"]:
        ax.plot(*c["xy"], "s", color="#7c3aed", ms=8)
    ax.set_aspect("equal")
    ax.grid(True, alpha=0.25)
    ax.set_title(f"Ramanujan {result['floor_label']} — walkable (green), graph (blue), places (green dot; red = no line of sight), stairs/lifts (purple)")
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------- building

def connect(results):
    """Pair each floor's stairs/lifts with Floor 4's by kind and position."""
    reference = results[4]["connectors"]
    shafts = {c["id"]: {"id": f"rb_shaft_{c['name'].lower().replace(' ', '_')}", "name": c["name"], "kind": c["kind"],
                        "routable": True, "in_normal_use": True, "floors": [], "connectors": {}} for c in reference}
    for level, result in sorted(results.items()):
        for c in result["connectors"]:
            options = [r for r in reference if r["kind"] == c["kind"] and math.dist(r["xy"], c["xy"]) <= CONNECTOR_MATCH_M[c["kind"]]]
            if not options:
                print(f"WARNING: {floor_key(level)} {c['kind']} at {c['xy']} matches no Floor 4 stair/lift")
                continue
            ref = min(options, key=lambda r: math.dist(r["xy"], c["xy"]))
            shaft = shafts[ref["id"]]
            if floor_key(level) in shaft["connectors"]:
                continue
            c["name"] = ref["name"]
            shaft["floors"].append(floor_key(level))
            shaft["connectors"][floor_key(level)] = c["id"]

    connectors = {c["id"]: (level, c) for level, r in results.items() for c in r["connectors"]}
    vertical_nodes, edges = [], []
    for shaft in shafts.values():
        stops = sorted((connectors[cid] for cid in shaft["connectors"].values()), key=lambda item: item[0])
        for (la, ca), (lb, cb) in zip(stops, stops[1:]):
            storeys = lb - la
            if shaft["kind"] == "lift":
                for level, c in ((la, ca), (lb, cb)):
                    vid = f"{shaft['id']}_{floor_key(level)}"
                    if not any(v["id"] == vid for v in vertical_nodes):
                        vertical_nodes.append({"id": vid, "floor": floor_key(level), "x": c["xy"][0], "y": c["xy"][1], "shaft": shaft["id"]})
                        edges.append({"from": c["node"], "to": vid, "weight_m": LIFT_BOARD_M, "kind": "lift_board", "shaft": shaft["id"]})
                edges.append({"from": f"{shaft['id']}_{floor_key(la)}", "to": f"{shaft['id']}_{floor_key(lb)}",
                              "weight_m": LIFT_FLOOR_M * storeys, "kind": "lift", "shaft": shaft["id"]})
            else:
                edges.append({"from": ca["node"], "to": cb["node"], "weight_m": STAIR_WEIGHT_M * storeys, "kind": "stairs", "shaft": shaft["id"]})
    shaft_list = [s for s in shafts.values() if len(s["floors"]) >= 2]
    return shaft_list, vertical_nodes, edges


def bridge_link(r2):
    """The bridge as one walkable edge between M. George's and Ramanujan's Second Floor graphs."""
    mg_floor = json.loads((MGEORGE_DIR / f"floor_{BRIDGE_MG_FLOOR:02d}_walkable_graph.json").read_text())
    mg_node = min(mg_floor["nodes"], key=lambda n: math.dist((n["x"], n["y"]), BRIDGE_MG_DOOR))
    door = next(d for d in r2["destinations"] if d["category"] == "building")
    r_node = next(n for n in r2["nodes"] if n["id"] == door["node"])
    weight = (math.dist((mg_node["x"], mg_node["y"]), BRIDGE_MG_DOOR) + BRIDGE_LENGTH_M
              + math.dist(door["approach_xy"], (r_node["x"], r_node["y"])))
    return {
        "kind": "bridge",
        "name": "bridge to Ramanujan Block",
        "from_floor": BRIDGE_MG_FLOOR, "from_node": mg_node["id"],
        "to_floor": r2["floor_number"], "to_node": r_node["id"],
        "points": [[mg_node["x"], mg_node["y"]], list(BRIDGE_MG_DOOR), door["approach_xy"], [r_node["x"], r_node["y"]]],
        "length_m": BRIDGE_LENGTH_M,
        "weight_m": round(weight, 2),
        "step_free": True,
        "note": "Bridge length not measured; Ramanujan's position follows from it.",
    }


def flag_reachability(results, shafts, edges, link):
    """reachable / step_free flags from the kiosk, through M. George and the bridge."""
    building = json.loads((MGEORGE_DIR / "building.json").read_text())
    mg_floors = [json.loads((MGEORGE_DIR / spec["graph"]).read_text()) for spec in building["floors"]]
    routable = {s["id"]: s for s in building["shafts"] if s["routable"]} | {s["id"]: s for s in shafts}
    kiosk = next(f for f in mg_floors if f.get("kiosk"))["kiosk"]["node"]

    def reach(step_free):
        adjacency = defaultdict(list)
        for floor in mg_floors + list(results.values()):
            for e in floor["edges"]:
                adjacency[e["from"]].append(e["to"])
                adjacency[e["to"]].append(e["from"])
        for e in building["vertical_edges"] + edges:
            shaft = routable.get(e["shaft"])
            if shaft and not (step_free and shaft["kind"] != "lift"):
                adjacency[e["from"]].append(e["to"])
                adjacency[e["to"]].append(e["from"])
        adjacency[link["from_node"]].append(link["to_node"])
        adjacency[link["to_node"]].append(link["from_node"])
        seen, stack = {kiosk}, [kiosk]
        while stack:
            for nxt in adjacency[stack.pop()]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        return seen

    any_route, lifts_only = reach(False), reach(True)
    hidden = []
    for result in results.values():
        for place in result["destinations"]:
            place["reachable"] = place["node"] in any_route
            place["step_free"] = place["node"] in lifts_only
            if not place["reachable"]:
                hidden.append(f"{place['name']} ({result['floor_label']})")
    if hidden:
        print("not reachable from the kiosk (hidden):", ", ".join(hidden))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--preview-dir", type=Path, help="write ramanujan_floorRN_walkable_preview.png review images here")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    mehrin = {level: mehrin_floor(level) for level in MEHRIN_OFFSETS}
    dxf2_segments, _, dxf2_connectors = multifloor_floor(2)
    dxf4_segments, _, _ = multifloor_floor(4)
    shift = align_to_mehrin(dxf2_segments, mehrin[4][0])
    check = align_to_mehrin(dxf4_segments, mehrin[4][0])
    print(f"multi-floor DXF -> Mehrin frame: Second Floor shift {shift[0]:.2f}, {shift[1]:.2f} m "
          f"(Fourth Floor alone gives {check[0]:.2f}, {check[1]:.2f})")

    def dxf_to_frame(x, y):
        return (x + shift[0], y + shift[1])

    bridge_door = dxf_to_frame(*BRIDGE_RAMANUJAN_DOOR_DXF)
    to_mg, _ = placement(bridge_door)

    def segs_to_mg(segments):
        return [(*to_mg(x1, y1), *to_mg(x2, y2)) for x1, y1, x2, y2 in segments]

    results, previews = {}, {}
    # Second Floor: only the bridge entrance and the way to the stairs/lifts.
    r2_connectors = [{"kind": "lift" if c["type"] == "lift" else "stairs", "name": c["type"], "xy": list(to_mg(*dxf_to_frame(*c["xy"])))}
                     for c in dxf2_connectors]
    entrance = {"id": "rb2_bridge_entrance", "name": "Ramanujan Block (bridge entrance)", "category": "building",
                "xy": list(to_mg(bridge_door[0], bridge_door[1] + 1.5)), "confidence": "medium",
                "note": "Inside the bridge opening on Ramanujan's Second Floor (multi-floor DXF)."}
    dxf2_in_frame = [(*dxf_to_frame(x1, y1), *dxf_to_frame(x2, y2)) for x1, y1, x2, y2 in dxf2_segments]
    results[2], *previews[2] = build_floor(2, segs_to_mg(dxf2_in_frame), [], r2_connectors, args.output_dir, [entrance])
    for level, (segments, places, outlines) in mehrin.items():
        for place in places:
            place["xy"] = to_mg(*place["frame_xy"])
        outlines = [(semantic_id, [to_mg(x, y) for x, y in polygon]) for semantic_id, polygon in outlines]
        rooms = [p for p in places if p["type"] not in ("vertical_transport", "staircase")]
        connectors = [{"kind": "lift" if p["type"] == "vertical_transport" else "stairs", "name": p["name"], "xy": list(p["xy"])}
                      for p in places if p["type"] in ("vertical_transport", "staircase")]
        results[level], *previews[level] = build_floor(level, segs_to_mg(segments), rooms, connectors, args.output_dir, outlines=outlines)
        # Stairs and lifts are places too, under their shaft names.
        for c in results[level]["connectors"]:
            results[level]["destinations"].append({
                "id": f"rb{level}_{c['name'].lower().replace(' ', '_')}", "name": c["name"], "room_no": None,
                "category": c["kind"], "xy": c["xy"], "confidence": "high", "note": "Stair/lift from Mehrin's data.",
                **{k: c[k] for k in ("node", "approach_xy", "anchor_walkable", "snap_m", "line_of_sight")},
            })

    shafts, vertical_nodes, edges = connect(results)
    link = bridge_link(results[2])
    flag_reachability(results, shafts, edges, link)

    for level, result in results.items():
        (args.output_dir / f"floor_{floor_key(level)}_walkable_graph.json").write_text(json.dumps(result, separators=(",", ":")))
        if args.preview_dir:
            render_preview(args.preview_dir / f"ramanujan_floor{floor_key(level)}_walkable_preview.png", *previews[level], result)

    building = {
        "schema_version": "navika-building-0.1",
        "building": "Ramanujan Block",
        "review_status": "auto_generated_requires_review",
        "floors": [{
            "floor_number": floor_key(level), "level": level, "label": result["floor_label"], "elevation_m": result["elevation_m"],
            "graph": f"floor_{floor_key(level)}_walkable_graph.json", "walls": f"floor_{floor_key(level)}_walls.json",
            "rooms": f"floor_{floor_key(level)}_rooms.json",
            # The Second Floor is only walked through, from the bridge to the stairs/lifts.
            "transit_only": level == 2,
        } for level, result in sorted(results.items())],
        "shafts": shafts,
        "vertical_nodes": vertical_nodes,
        "vertical_edges": edges,
        "links": [link],
        "placement": {
            "method": "Mehrin's frame turned +90 degrees so the bridge door faces M. George's west-end door",
            "bridge_mg_door": list(BRIDGE_MG_DOOR), "bridge_length_m": BRIDGE_LENGTH_M,
            "multifloor_dxf_shift_m": [round(shift[0], 3), round(shift[1], 3)],
        },
        "assumptions": {
            "floor_height_m": mg.FLOOR_HEIGHT_M,
            "stairs_weight_m_per_floor": STAIR_WEIGHT_M,
            "lift_board_weight_m": LIFT_BOARD_M,
            "lift_weight_m_per_floor": LIFT_FLOOR_M,
            "note": "All Ramanujan stairs and lifts are in normal use (project team, 2026-11-02). "
                    "The Third Floor is not drawn; stairs and lifts pass through it.",
        },
    }
    (args.output_dir / "building.json").write_text(json.dumps(building, indent=1))
    print(f"bridge: {link['from_node']} -> {link['to_node']}, {link['weight_m']} m")
    for shaft in shafts:
        print(f"  {shaft['name']:<14} {shaft['kind']:<7} floors {shaft['floors']}")
    print(f"wrote {args.output_dir / 'building.json'}")


if __name__ == "__main__":
    main()
