#!/usr/bin/env python3
"""Build a walkable navigation graph for one M. George floor from the DXF.

Pipeline (all geometry stays in DXF source units until export):

1. Rasterise obstacle layers (walls, windows, stairs, fixtures, solid hatches)
   inside the floor's plan window onto a 10 cm occupancy grid.
2. Carve every door block (``A$C764D24B9`` / ``A$C67844AE1``) open, so doors
   come from the drawing rather than from guessed wall gaps.
3. Keep free cells with at least ``CLEARANCE_CM`` to the nearest obstacle,
   restricted to the building footprint and to the component reachable from
   the kiosk.
4. Thin that area to its centreline (Zhang-Suen), prune short spurs, and turn
   the skeleton into a node/edge graph weighted in metres.

The DXF declares no $INSUNITS; door block scales (75-120), "TREAD - 30 C.M"
and room size notes such as "974x680" show the drawing is in centimetres.
Doors and walkable space are derived automatically and must be reviewed on
the generated preview before the graph is used for live wayfinding.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
from collections import defaultdict
from pathlib import Path

import ezdxf
import numpy as np
from ezdxf import path as ezpath
from ezdxf.disassemble import recursive_decompose
from matplotlib.path import Path as MplPath
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "data/original_sources/m_george/college plans 3 (1).dxf"
DEFAULT_OUTPUT_DIR = ROOT / "frontend/public/data/MGeorge_nav"
DEFAULT_DESTINATIONS = ROOT / "data/navigation/mgeorge_floor{floor:02d}_destinations.json"
DEFAULT_IN_USE = ROOT / "data/navigation/mgeorge_connectors_in_use.json"

CM_PER_UNIT = 1.0
CELL_CM = 10.0
CLEARANCE_CM = 25.0  # passage must be >= 50 cm wide (toilet aisles, 75 cm doors)
FOOTPRINT_CLOSE_CM = 250.0  # closes entrances up to ~5 m when finding the footprint
SPUR_PRUNE_M = 1.2
SIMPLIFY_CM = 15.0
MIN_AREA_M2 = 30.0  # floors without the kiosk: smaller walkable pockets are ignored

# Origin shared with frontend/public/data/MGeorge_DXF so overlays line up.
ORIGIN_XY = (64508.653, -126418.979)

# Floor 1's plan window; x max reaches past the library semicircle (centre x 70640, r 1272).
FLOOR_1_WINDOW = (57700.0, -131000.0, 72300.0, -121000.0)

# Each floor is drawn elsewhere on the DXF sheet. Offsets (source units) move a
# floor onto floor 1: measured from the repeated structural grid bubbles and
# confirmed by correlating wall/column linework (agreement within 20 cm).
# Floor 3 has no grid bubbles, so its offset comes from the linework alone.
FLOOR_OFFSETS = {
    0: (776.9, -13340.0),
    1: (0.0, 0.0),
    2: (956.2, 13116.8),
    3: (1660.0, 27560.0),
    4: (2240.1, 41563.7),
}
# Estimated: ~22 risers of 15 cm per main-stair run ("RISE - 15 C.M" on the plan).
FLOOR_HEIGHT_M = 3.3
FLOOR_LABELS = {
    0: "Ground Floor",
    1: "First Floor (entrance / reception level)",
    2: "Second Floor",
    3: "Third Floor",
    4: "Fourth Floor",
}
FLOORS = {
    n: {
        "floor_id": f"MGEORGE_{n:02d}",
        "label": FLOOR_LABELS[n],
        "offset": (dx, dy),
        "window": (FLOOR_1_WINDOW[0] + dx, FLOOR_1_WINDOW[1] + dy, FLOOR_1_WINDOW[2] + dx, FLOOR_1_WINDOW[3] + dy),
        "elevation_m": round(n * FLOOR_HEIGHT_M, 2),
    }
    for n, (dx, dy) in FLOOR_OFFSETS.items()
}


def floor_origin(floor_number):
    """Source point that maps to local (0, 0) on this floor, in floor 1's frame."""
    dx, dy = FLOORS[floor_number]["offset"]
    return ORIGIN_XY[0] + dx, ORIGIN_XY[1] + dy

OBSTACLE_LAYERS = {"WALL", "WIN", "STAIR", "THIN", "THIN_HA", "LAYER4", "SANI", "STEEL"}
DOOR_BLOCKS = {"A$C764D24B9", "A$C67844AE1"}


def in_window(points, window):
    x0, y0, x1, y1 = window
    return any(x0 <= x <= x1 and y0 <= y <= y1 for x, y in points)


def collect_geometry(doc, window):
    """Return obstacle polylines, filled hatch polygons and door openings."""
    polylines, polygons, doors = [], [], []
    msp = doc.modelspace()
    for entity in msp:
        kind = entity.dxftype()
        if kind == "INSERT" and entity.dxf.name in DOOR_BLOCKS:
            ins = entity.dxf.insert
            if not in_window([(ins.x, ins.y)], window):
                continue
            sx, sy = entity.dxf.xscale, entity.dxf.yscale
            rot = math.radians(entity.dxf.rotation)
            ux, uy = math.cos(rot), math.sin(rot)
            # Block opening runs along local x from 0 to 1 (leaf drawn open at x=0.1).
            ax, ay = ins.x, ins.y
            bx, by = ins.x + ux * sx, ins.y + uy * sx
            doors.append({"a": (ax, ay), "b": (bx, by), "width_cm": abs(sx) * CM_PER_UNIT, "source": "door_block"})
            continue
        if kind == "ARC" and entity.dxf.layer.upper() == "DOOR":
            # Loose door swing: hinge at the centre, the closed leaf lies along
            # one radius. Which one is ambiguous, so open both; the other runs
            # into the room, which is free space already.
            radius = entity.dxf.radius * CM_PER_UNIT
            sweep = (entity.dxf.end_angle - entity.dxf.start_angle) % 360
            centre = entity.dxf.center
            if 50 <= radius <= 160 and 80 <= sweep <= 100 and in_window([(centre.x, centre.y)], window):
                for end in (entity.start_point, entity.end_point):
                    doors.append({"a": (centre.x, centre.y), "b": (end.x, end.y), "width_cm": radius, "source": "door_arc"})
            continue
        if kind in {"TEXT", "MTEXT", "DIMENSION", "ATTDEF", "POINT"}:
            continue
        candidates = recursive_decompose([entity]) if kind == "INSERT" else [entity]
        for item in candidates:
            if item.dxf.layer.upper() not in OBSTACLE_LAYERS:
                continue
            if item.dxftype() == "HATCH":
                try:
                    for boundary in ezpath.from_hatch(item):
                        pts = [(v.x, v.y) for v in boundary.flattening(5)]
                        if len(pts) >= 3 and in_window(pts, window):
                            polygons.append(pts)
                except Exception:
                    pass
                continue
            if item.dxftype() in {"TEXT", "MTEXT", "INSERT"}:
                continue
            try:
                pts = [(v.x, v.y) for v in ezpath.make_path(item).flattening(2)]
            except Exception:
                continue
            if len(pts) >= 2 and in_window(pts, window):
                polylines.append((item.dxf.layer.upper(), pts))
    return polylines, polygons, doors


class Grid:
    def __init__(self, window):
        self.x0, self.y0, x1, y1 = window
        self.w = int(math.ceil((x1 - self.x0) / CELL_CM)) + 1
        self.h = int(math.ceil((y1 - self.y0) / CELL_CM)) + 1

    def to_cell(self, x, y):
        return (np.asarray(y) - self.y0) / CELL_CM, (np.asarray(x) - self.x0) / CELL_CM

    def to_source(self, row, col):
        return self.x0 + (col + 0.5) * CELL_CM, self.y0 + (row + 0.5) * CELL_CM

    def burn_segments(self, mask, pts, value=True):
        pts = np.asarray(pts, dtype=float)
        for (xa, ya), (xb, yb) in zip(pts[:-1], pts[1:]):
            n = max(2, int(math.hypot(xb - xa, yb - ya) / (CELL_CM / 3)) + 1)
            t = np.linspace(0, 1, n)
            r, c = self.to_cell(xa + (xb - xa) * t, ya + (yb - ya) * t)
            r, c = r.astype(int), c.astype(int)
            ok = (r >= 0) & (r < self.h) & (c >= 0) & (c < self.w)
            mask[r[ok], c[ok]] = value

    def fill_polygon(self, mask, pts):
        pts = np.asarray(pts, dtype=float)
        r, c = self.to_cell(pts[:, 0], pts[:, 1])
        r0, r1 = max(0, int(r.min())), min(self.h - 1, int(r.max()) + 1)
        c0, c1 = max(0, int(c.min())), min(self.w - 1, int(c.max()) + 1)
        if r1 < r0 or c1 < c0:
            return
        rr, cc = np.mgrid[r0:r1 + 1, c0:c1 + 1]
        inside = MplPath(np.column_stack([c, r])).contains_points(np.column_stack([cc.ravel() + 0.5, rr.ravel() + 0.5]))
        mask[rr.ravel()[inside], cc.ravel()[inside]] = True
        self.burn_segments(mask, np.vstack([pts, pts[:1]]))


def carve_doors(grid, obstacles, doors):
    """Clear a rectangle through the wall at every door opening."""
    for door in doors:
        (ax, ay), (bx, by) = door["a"], door["b"]
        length = math.hypot(bx - ax, by - ay)
        if length < 40:
            continue
        ux, uy = (bx - ax) / length, (by - ay) / length
        nx, ny = -uy, ux
        corners = []
        for along, across in ((0.0, -35), (1.0, -35), (1.0, 35), (0.0, 35)):
            corners.append((ax + ux * length * along + nx * across, ay + uy * length * along + ny * across))
        cleared = np.zeros_like(obstacles)
        grid.fill_polygon(cleared, corners)
        obstacles &= ~cleared


def zhang_suen(mask):
    """Vectorised Zhang-Suen thinning; returns a 1-pixel-wide skeleton."""
    img = np.pad(mask.astype(np.uint8), 1)
    changed = True
    while changed:
        changed = False
        for step in (0, 1):
            p2 = img[:-2, 1:-1]; p3 = img[:-2, 2:]; p4 = img[1:-1, 2:]; p5 = img[2:, 2:]
            p6 = img[2:, 1:-1]; p7 = img[2:, :-2]; p8 = img[1:-1, :-2]; p9 = img[:-2, :-2]
            neighbours = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
            seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            transitions = sum(((a == 0) & (b == 1)).astype(np.uint8) for a, b in zip(seq[:-1], seq[1:]))
            if step == 0:
                c1 = (p2 * p4 * p6) == 0
                c2 = (p4 * p6 * p8) == 0
            else:
                c1 = (p2 * p4 * p8) == 0
                c2 = (p2 * p6 * p8) == 0
            remove = (img[1:-1, 1:-1] == 1) & (neighbours >= 2) & (neighbours <= 6) & (transitions == 1) & c1 & c2
            if remove.any():
                img[1:-1, 1:-1][remove] = 0
                changed = True
    return img[1:-1, 1:-1].astype(bool)


OFFSETS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def skeleton_graph(skel):
    """Trace skeleton pixels into chains between junction/end clusters.

    Returns ``(clusters, chains)`` where each chain is ``(a, b, points)`` with
    cluster ids at both ends and points in (row, col) grid coordinates.
    """
    pixels = {(int(r), int(c)) for r, c in zip(*np.nonzero(skel))}
    adj = {p: {(p[0] + dr, p[1] + dc) for dr, dc in OFFSETS if (p[0] + dr, p[1] + dc) in pixels} for p in pixels}
    # A diagonal step bridged by an orthogonal pixel is redundant; dropping it
    # stops staircase pixels from looking like junctions.
    for p in pixels:
        for q in list(adj[p]):
            if q[0] != p[0] and q[1] != p[1] and ((p[0], q[1]) in pixels or (q[0], p[1]) in pixels):
                adj[p].discard(q)
                adj[q].discard(p)

    key = {p for p in pixels if len(adj[p]) != 2}
    cluster_of, clusters = {}, []
    for p in key:
        if p in cluster_of:
            continue
        cid, stack, members = len(clusters), [p], []
        cluster_of[p] = cid
        while stack:
            x = stack.pop()
            members.append(x)
            for y in adj[x]:
                if y in key and y not in cluster_of:
                    cluster_of[y] = cid
                    stack.append(y)
        clusters.append(members)
    centres = [(sum(r for r, _ in m) / len(m), sum(c for _, c in m) / len(m)) for m in clusters]

    chains, visited = [], set()
    for cid, members in enumerate(clusters):
        for p in members:
            for q in adj[p]:
                if q in cluster_of or q in visited:
                    continue
                visited.add(q)
                points, prev, cur, end = [centres[cid], q], p, q, None
                while True:
                    nxt = [y for y in adj[cur] if y != prev]
                    if not nxt:
                        break
                    y = nxt[0]
                    if y in cluster_of:
                        end = cluster_of[y]
                        break
                    if y in visited:
                        break
                    visited.add(y)
                    points.append(y)
                    prev, cur = cur, y
                if end is not None:
                    points.append(centres[end])
                    chains.append((cid, end, points))
    return centres, chains


def chain_length(points):
    return sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(points[:-1], points[1:])) * CELL_CM / 100


def prune_spurs(chains, rounds=6):
    """Drop short dead-end branches left by thinning noise."""
    for _ in range(rounds):
        degree = defaultdict(int)
        for a, b, _ in chains:
            degree[a] += 1
            degree[b] += 1
        kept = [ch for ch in chains if not ((degree[ch[0]] == 1) != (degree[ch[1]] == 1) and chain_length(ch[2]) < SPUR_PRUNE_M)]
        if len(kept) == len(chains):
            break
        chains = kept
    return chains


def rdp(points, tolerance):
    if len(points) < 3:
        return points
    (r0, c0), (r1, c1) = points[0], points[-1]
    dr, dc = r1 - r0, c1 - c0
    norm = math.hypot(dr, dc) or 1.0
    dists = [abs(dc * (r - r0) - dr * (c - c0)) / norm for r, c in points]
    idx = int(np.argmax(dists))
    if dists[idx] <= tolerance:
        return [points[0], points[-1]]
    return rdp(points[:idx + 1], tolerance)[:-1] + rdp(points[idx:], tolerance)


def line_of_sight(mask, a, b):
    n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1]))) * 2 + 2
    rr = np.rint(np.linspace(a[0], b[0], n)).astype(int)
    cc = np.rint(np.linspace(a[1], b[1], n)).astype(int)
    return bool(mask[rr, cc].all())


def local_to_source(xy, origin=ORIGIN_XY):
    return origin[0] + xy[0] * 100, origin[1] + xy[1] * 100


def collect_labels(doc, window):
    """Top-level TEXT/MTEXT inside the plan window as (UPPER-CASE text, x, y)."""
    labels = []
    for entity in doc.modelspace().query("TEXT MTEXT"):
        text = entity.plain_text() if entity.dxftype() == "MTEXT" else entity.dxf.text
        text = " ".join(text.upper().split())
        x, y = entity.dxf.insert.x, entity.dxf.insert.y
        if text and in_window([(x, y)], window):
            labels.append((text, x, y))
    return labels


# DXF design label -> (category, display name). Matched in order; first wins.
DXF_DESTINATION_RULES = [
    (r"^MAIN STAIR$|^STAIR$|^STAIR WELL$", "stairs", "Staircase"),
    (r"^FIRE ESCAPE STAIR$", "exit", "Fire Exit"),
    (r"^BED LIFT$", "lift", "Bed Lift"),
    (r"^FIRE LIFT$", "lift", "Fire Lift"),
    (r"^LIFT$", "lift", "Lift"),
    (r"^H\.TOILET$", "toilet", "Accessible Toilet"),
    (r"^GENTS$", "toilet", "Gents Toilet"),
    (r"^LADIES$", "toilet", "Ladies Toilet"),
    (r"^LIBRARY$", "library", "Library"),
    (r"\bLAB\b", "lab", None),
    (r"^CLASS ?ROOM$", "classroom", "Classroom"),
    (r"^DRAWING HALL$", "hall", "Drawing Hall"),
    (r"^SEMINAR( ROOM)?$", "hall", "Seminar Room"),
    (r"^HALL$", "hall", "Hall"),
    (r"DEPARTMENT$", "department", None),
    (r"^H\.O\.D", "office", "HOD & Faculty Room"),
    (r"STAFF$", "office", None),
    (r"^OFFICE$", "office", "Office"),
    (r"^(PRINCIPAL|DIRECTOR|CONFERENCE) ROOM$", "office", None),
    (r"^SERVER ROOM$", "service", "Server Room"),
    (r"^PANTRY$", "service", "Pantry"),
    (r"^STORE$", "service", "Store"),
]
CONNECTOR_KINDS = {"stairs": "stairs", "exit": "fire_stairs", "lift": "lift"}
KEEP_UPPER = {"CAD", "HOD", "IT", "CSE", "ECE", "EEE"}


def wing_of(x):
    return "west wing" if x < -27 else "east wing" if x > 27 else "centre"


def destinations_from_labels(labels, floor_number, to_local, inside):
    """First-pass destinations for a floor without a reviewed file."""
    import re

    found = []
    for text, sx, sy in labels:
        if not inside(sx, sy):
            continue
        for pattern, category, name in DXF_DESTINATION_RULES:
            if re.search(pattern, text):
                xy = to_local(sx, sy)
                label = name or " ".join(w if w in KEEP_UPPER else w.title() for w in text.split())
                if any(f["name"] == label and math.dist(f["xy"], xy) < 3 for f in found):
                    break
                found.append({"name": label, "category": category, "xy": xy, "dxf_label": text})
                break
    # Disambiguate repeated names: add the wing, then number them west -> east,
    # e.g. "Classroom 2 (east wing)".
    by_name = defaultdict(list)
    for f in found:
        by_name[f["name"]].append(f)
    for name, items in by_name.items():
        if len(items) == 1:
            continue
        by_wing = defaultdict(list)
        for f in items:
            by_wing[wing_of(f["xy"][0])].append(f)
        for wing, group in by_wing.items():
            ordered = sorted(group, key=lambda d: (d["xy"][0], -d["xy"][1]))
            for i, f in enumerate(ordered, start=1):
                f["name"] = f"{name} {i} ({wing})" if len(ordered) > 1 else f"{name} ({wing})"
    destinations = []
    for i, f in enumerate(sorted(found, key=lambda d: (d["category"], d["name"]))):
        destinations.append({
            "id": f"mg{floor_number}_{f['category']}_{i:02d}",
            "pdf_no": None,
            "name": f["name"],
            "category": f["category"],
            "xy": f["xy"],
            "confidence": "low",
            "note": f"DXF design label '{f['dxf_label']}'; current room use not yet confirmed.",
        })
    return {
        "schema_version": "navika-destinations-0.1",
        "building": "M. George Block",
        "floor_number": floor_number,
        "floor_label": FLOOR_LABELS[floor_number],
        "coordinate_system": "metres in floor 1's frame (see FLOOR_OFFSETS in scripts/build_mgeorge_nav_graph.py); x east, y north",
        "sources": {"names": "DXF design labels (generated); replace with the current room-use plan when available",
                    "positions": "data/original_sources/m_george/college plans 3 (1).dxf"},
        "kiosk": None,
        "destinations": destinations,
        "not_placed": [],
    }


def connectors_from_labels(labels, to_local, inside):
    """Stairs and lifts on this floor, from the DXF labels, merged within 2.5 m."""
    import re

    connectors = []
    for text, sx, sy in labels:
        if not inside(sx, sy):
            continue
        for pattern, category, name in DXF_DESTINATION_RULES[:5]:
            if re.search(pattern, text):
                kind = CONNECTOR_KINDS[category]
                xy = to_local(sx, sy)
                # A stair well is ~5 x 8 m and labelled more than once; lifts stand in close pairs.
                merge_m = 7.0 if kind != "lift" else 2.5
                if not any(c["kind"] == kind and math.dist(c["xy"], xy) < merge_m for c in connectors):
                    connectors.append({"kind": kind, "dxf_label": text, "xy": xy})
                break
    return connectors


def centreline_graph(grid, reachable, origin, id_prefix, floor_number):
    """Corridor centreline graph of a walkable mask: skeleton chains simplified
    into nodes (metres in the shared frame) and edges weighted by length."""
    skel = zhang_suen(reachable)
    centres, chains = skeleton_graph(skel)
    chains = prune_spurs(chains)

    node_ids, nodes, edges = {}, [], []

    def node_for(key, rc):
        if key not in node_ids:
            sx, sy = grid.to_source(*rc)
            node_ids[key] = f"{id_prefix}_N{len(nodes):04d}"
            nodes.append({
                "id": node_ids[key], "floor": floor_number,
                "x": round((sx - origin[0]) / 100, 3), "y": round((sy - origin[1]) / 100, 3),
            })
        return node_ids[key]

    seen_pairs = set()
    for a, b, points in chains:
        simplified = rdp(points, SIMPLIFY_CM / CELL_CM)
        if a == b and len(simplified) < 3:
            continue
        keys = [("c", a)] + [("p", pt) for pt in simplified[1:-1]] + [("c", b)]
        ids = [node_for(k, pt) for k, pt in zip(keys, simplified)]
        for (ia, pa), (ib, pb) in zip(zip(ids, simplified), zip(ids[1:], simplified[1:])):
            pair = tuple(sorted((ia, ib)))
            if ia == ib or pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            edges.append({"from": ia, "to": ib, "weight_m": round(chain_length([pa, pb]), 3)})
    return nodes, edges


def make_snapper(grid, reachable, nodes, origin, to_local):
    """snap(xy) joins a place to the graph: the nearest walkable cell, then the
    closest node visible from it without crossing an obstacle."""
    _, (near_r, near_c) = ndimage.distance_transform_edt(~reachable, return_indices=True)
    node_rc = np.array([grid.to_cell(*local_to_source((n["x"], n["y"]), origin)) for n in nodes])

    def snap(xy):
        r, c = (int(v) for v in grid.to_cell(*local_to_source(xy, origin)))
        r, c = min(max(r, 0), grid.h - 1), min(max(c, 0), grid.w - 1)
        ar, ac = int(near_r[r, c]), int(near_c[r, c])
        order = np.argsort((node_rc[:, 0] - ar) ** 2 + (node_rc[:, 1] - ac) ** 2)
        choice, visible = int(order[0]), False
        for idx in order[:40]:
            if line_of_sight(reachable, (ar, ac), node_rc[idx]):
                choice, visible = int(idx), True
                break
        approach = to_local(*grid.to_source(ar, ac))
        return {
            "node": nodes[choice]["id"],
            "approach_xy": approach,
            "anchor_walkable": bool(reachable[r, c]),
            "snap_m": round(math.dist(approach, (nodes[choice]["x"], nodes[choice]["y"])), 2),
            "line_of_sight": visible,
        }

    return snap


def build(source: Path, floor_number: int, output_dir: Path, destinations_path: Path, preview: Path | None, debug_grid: Path | None = None, doc=None):
    spec = FLOORS[floor_number]
    origin = floor_origin(floor_number)
    window = spec["window"]
    doc = doc or ezdxf.readfile(source)
    polylines, polygons, doors = collect_geometry(doc, window)
    grid = Grid(window)

    obstacles = np.zeros((grid.h, grid.w), dtype=bool)
    for _, pts in polylines:
        grid.burn_segments(obstacles, pts)
    for pts in polygons:
        grid.fill_polygon(obstacles, pts)
    obstacles = ndimage.binary_dilation(obstacles, iterations=1)
    # Doors shut (a line across every door opening): used to split the floor into rooms.
    closed_obstacles = obstacles.copy()
    for door in doors:
        grid.burn_segments(closed_obstacles, [door["a"], door["b"]])
    carve_doors(grid, obstacles, doors)

    close = int(FOOTPRINT_CLOSE_CM / CELL_CM)
    structure = ndimage.generate_binary_structure(2, 1)
    footprint = ndimage.binary_closing(np.pad(obstacles, close), structure, iterations=close)[close:-close, close:-close]
    footprint = ndimage.binary_fill_holes(footprint)
    # Keep only the building itself; the DXF sheet also holds detail drawings.
    parts, count = ndimage.label(footprint)
    if count > 1:
        footprint = parts == np.argmax(np.bincount(parts.ravel())[1:]) + 1

    def to_local(x, y):
        return [round((x - origin[0]) / 100, 3), round((y - origin[1]) / 100, 3)]

    def inside(sx, sy):
        r, c = (int(v) for v in grid.to_cell(sx, sy))
        return 0 <= r < grid.h and 0 <= c < grid.w and bool(footprint[r, c])

    dxf_labels = collect_labels(doc, window)
    if not destinations_path.exists():
        destinations_path.parent.mkdir(parents=True, exist_ok=True)
        generated = destinations_from_labels(dxf_labels, floor_number, to_local, inside)
        destinations_path.write_text(json.dumps(generated, indent=2, ensure_ascii=False) + "\n")
        print(f"generated {destinations_path} with {len(generated['destinations'])} destinations from DXF labels")
    config = json.loads(destinations_path.read_text())
    connectors = connectors_from_labels(dxf_labels, to_local, inside)

    clearance = ndimage.distance_transform_edt(~obstacles) * CELL_CM
    walkable = (clearance >= CLEARANCE_CM) & footprint
    labels, _ = ndimage.label(walkable, structure=np.ones((3, 3)))
    _, (wr, wc) = ndimage.distance_transform_edt(~walkable, return_indices=True)

    def walkable_label(xy):
        r, c = (int(v) for v in grid.to_cell(*local_to_source(xy, origin)))
        r, c = min(max(r, 0), grid.h - 1), min(max(c, 0), grid.w - 1)
        return labels[wr[r, c], wc[r, c]]

    # The kiosk's floor keeps what the kiosk can reach; other floors keep what
    # their stairs and lifts reach (anything else cannot be routed to anyway).
    if config.get("kiosk"):
        reachable = labels == walkable_label(config["kiosk"]["xy"])
    else:
        # Ignore small pockets (lift cars, stair-well gaps): a lift labelled
        # inside its shaft must snap to the lobby outside, not the car.
        sizes = np.bincount(labels.ravel())
        big = sizes * (CELL_CM / 100) ** 2 >= MIN_AREA_M2
        big[0] = False
        _, (br, bc) = ndimage.distance_transform_edt(~big[labels], return_indices=True)

        def big_label(xy):
            r, c = (int(v) for v in grid.to_cell(*local_to_source(xy, origin)))
            r, c = min(max(r, 0), grid.h - 1), min(max(c, 0), grid.w - 1)
            return labels[br[r, c], bc[r, c]]

        reachable = np.isin(labels, [big_label(c["xy"]) for c in connectors if c["kind"] != "fire_stairs"])

    nodes, edges = centreline_graph(grid, reachable, origin, f"MG{floor_number:02d}", floor_number)
    snap = make_snapper(grid, reachable, nodes, origin, to_local)

    kiosk = {**config["kiosk"], **snap(config["kiosk"]["xy"])} if config.get("kiosk") else None
    connectors = [{"id": f"MG{floor_number:02d}_C{i:02d}", **c, **snap(c["xy"])} for i, c in enumerate(connectors)]
    # entrance_xy, when given, is a reviewed entrance used instead of the room label.
    destinations = [{**d, **snap(d.get("entrance_xy", d["xy"]))} for d in config["destinations"]]

    result = {
        "schema_version": "navika-walkable-graph-0.1",
        "building": "M. George Block",
        "floor_number": floor_number,
        "floor_id": spec["floor_id"],
        "floor_label": spec["label"],
        "elevation_m": spec["elevation_m"],
        "review_status": "auto_generated_requires_review",
        "coordinate_system": {
            "units": "metres (shared by all floors: floor 1's frame)",
            "origin_source_xy": list(origin),
            "floor_offset_source": list(spec["offset"]),
            "source_units": "centimetres (inferred from door scales and dimension notes)",
            "x": "east = (dxf_x - origin_x) / 100", "y": "north = (dxf_y - origin_y) / 100",
        },
        "parameters": {"cell_cm": CELL_CM, "clearance_cm": CLEARANCE_CM, "spur_prune_m": SPUR_PRUNE_M},
        "source": str(source.relative_to(ROOT)),
        "kiosk": kiosk,
        "destinations": destinations,
        "connectors": connectors,
        "not_placed": config.get("not_placed", []),
        "doors": [{"id": f"MG{floor_number:02d}_D{i:03d}", "a": to_local(*d["a"]), "b": to_local(*d["b"]), "width_cm": round(d["width_cm"]), "source": d["source"]} for i, d in enumerate(doors)],
        "nodes": nodes,
        "edges": edges,
        "walkable_mask": export_mask(grid, reachable, to_local),
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    out = output_dir / f"floor_{floor_number:02d}_walkable_graph.json"
    out.write_text(json.dumps(result, separators=(",", ":")))
    walls_out = output_dir / f"floor_{floor_number:02d}_walls.json"
    walls_out.write_text(json.dumps(export_walls(grid, footprint, polylines, to_local, floor_number, spec), separators=(",", ":")))
    rooms, room_labels = segment_rooms(grid, closed_obstacles, footprint, reachable, destinations, to_local, origin)
    texture_name = f"floor_{floor_number:02d}_rooms.png"
    rooms["texture"]["file"] = texture_name
    rooms.update({"floor_number": floor_number, "floor_label": spec["label"]})
    write_room_texture(output_dir / texture_name, rooms, room_labels, footprint, closed_obstacles)
    (output_dir / f"floor_{floor_number:02d}_rooms.json").write_text(json.dumps(rooms, separators=(",", ":")))
    print(f"rooms: {len(rooms['regions'])} regions ({', '.join(f'{k} {v}' for k, v in sorted(rooms['summary'].items()))})")
    print(f"floor {floor_number}: {len(polylines)} polylines, {len(polygons)} hatch polygons, {len(doors)} doors")
    print(f"walkable cells {int(reachable.sum())} (~{reachable.sum() * CELL_CM ** 2 / 1e4:.0f} m²), nodes {len(nodes)}, edges {len(edges)}")
    print(f"wrote {out}")

    if preview:
        render_preview(preview, grid, obstacles, reachable, doors, nodes, edges, kiosk, destinations, origin)
    if debug_grid:
        np.savez_compressed(debug_grid, reachable=reachable, obstacles=obstacles, window=np.array(window))
    return result


MASK_CELL_CM = 20.0


def export_mask(grid, reachable, to_local):
    """Bit-packed walkable mask for line-of-sight route smoothing in the browser.

    A coarse cell is walkable only if every fine cell inside it is, so a
    straight line that stays on walkable coarse cells never clips a wall.
    """
    k = int(MASK_CELL_CM / CELL_CM)
    rows, cols = np.nonzero(reachable)
    r0, r1 = rows.min() // k * k, (rows.max() // k + 1) * k
    c0, c1 = cols.min() // k * k, (cols.max() // k + 1) * k
    crop = np.zeros((r1 - r0, c1 - c0), dtype=bool)
    sub = reachable[r0:r1, c0:c1]
    crop[:sub.shape[0], :sub.shape[1]] = sub
    coarse = crop.reshape(crop.shape[0] // k, k, crop.shape[1] // k, k).all(axis=(1, 3))
    corner = to_local(grid.x0 + c0 * CELL_CM, grid.y0 + r0 * CELL_CM)
    return {
        "cell_m": MASK_CELL_CM / 100,
        "origin_xy": corner,
        "rows": int(coarse.shape[0]),
        "cols": int(coarse.shape[1]),
        "order": "row-major from origin (south-west), rows go north, bits MSB-first",
        "bits_base64": base64.b64encode(np.packbits(coarse.ravel()).tobytes()).decode("ascii"),
    }


ROOM_SPLIT_CM = 120.0  # openings narrower than 2 x this separate rooms
ROOM_MIN_M2 = 1.0

# Floor colours follow the Ramanujan viewer (ramanujan-viewer/src/App.tsx).
ROOM_COLOURS = {
    "teaching": "#F6D878",   # classrooms, labs, halls
    "office": "#8ED8D0",     # offices, departments, library
    "connector": "#B9A1E8",  # stairs, lifts, fire exits
    "toilet": "#9CCFE8",
    "corridor": "#D9D9D9",
    "unassigned": "#E5E5E5",
}
SLAB_COLOUR = "#BDBDBD"
CONFIDENCE_WEIGHT = {"high": 3, "medium": 2, "low": 1}
CATEGORY_GROUP = {
    "lab": "teaching", "classroom": "teaching", "hall": "teaching",
    "office": "office", "department": "office", "library": "office", "service": "office",
    "facility": "office", "food": "office",
    "stairs": "connector", "lift": "connector", "exit": "connector",
    "toilet": "toilet",
    "circulation": "corridor", "entrance": "corridor",
}


def segment_rooms(grid, closed, footprint, reachable, destinations, to_local, origin=ORIGIN_XY):
    """Split the floor into rooms and colour them by the destinations inside.

    With doors shut, free space is shrunk by ROOM_SPLIT_CM so doorways and
    narrow openings separate; each remaining piece is a room, grown back to
    fill its free space without crossing walls. Rooms holding no destination
    are corridor when the kiosk can walk through them, a void (slab opening)
    when enclosed by corridor alone, else unassigned.
    """
    structure4 = ndimage.generate_binary_structure(2, 1)
    free = ~closed & footprint
    core = free & (ndimage.distance_transform_edt(~closed) * CELL_CM >= ROOM_SPLIT_CM)
    labels, count = ndimage.label(core, structure=structure4)
    sizes = ndimage.sum(core, labels, index=np.arange(count + 1))
    labels[sizes[labels] * (CELL_CM / 100) ** 2 < ROOM_MIN_M2] = 0

    # Grow rooms back over the free cells they were shrunk away from, but only
    # within the same free-space component so no room leaks through a wall.
    free_cc, _ = ndimage.label(free, structure=structure4)
    _, (ir, ic) = ndimage.distance_transform_edt(labels == 0, return_indices=True)
    grown = labels[ir, ic]
    same_space = free_cc == free_cc[ir, ic]
    labels = np.where(free & (labels == 0) & same_space, grown, labels)
    labels[~free] = 0

    by_room = defaultdict(list)
    for d in destinations:
        r, c = (int(v) for v in grid.to_cell(*local_to_source(d["xy"], origin)))
        if not (0 <= r < grid.h and 0 <= c < grid.w):
            continue
        room = labels[r, c]
        if not room:
            window = labels[max(0, r - 15):r + 16, max(0, c - 15):c + 16]
            values = window[window > 0]
            room = int(np.bincount(values).argmax()) if values.size else 0
        if room:
            by_room[int(room)].append(d)

    ids = [i for i in np.unique(labels) if i]
    areas = ndimage.sum(np.ones_like(labels), labels, index=ids)
    walked = ndimage.sum(reachable, labels, index=ids)
    group = {}
    for room, area, walk in zip(ids, areas, walked):
        places = by_room.get(int(room), [])
        groups = [CATEGORY_GROUP.get(d["category"], "unassigned") for d in places]
        # Weighted vote by confidence, ignoring stairs/lifts whose anchors
        # sit just outside their shafts.
        votes = defaultdict(int)
        for d, g in zip(places, groups):
            if g != "connector":
                votes[g] += CONFIDENCE_WEIGHT.get(d["confidence"], 1)
        if "corridor" in groups:
            group[room] = "corridor"
        elif votes:
            group[room] = max(votes, key=votes.get)
        elif groups:
            group[room] = "connector"
        elif walk >= 0.5 * area:
            group[room] = "corridor"
        else:
            group[room] = None

    # Enclosed by corridor only and never touching the outside: a slab opening.
    for room in ids:
        if group[room] is not None:
            continue
        ring = ndimage.binary_dilation(labels == room, iterations=8) & (labels != room)
        touches_outside = bool((ring & ~footprint).any())
        neighbours = {int(v) for v in np.unique(labels[ring]) if v}
        enclosed = neighbours and all(group.get(n) == "corridor" for n in neighbours)
        group[room] = "void" if enclosed and not touches_outside else "unassigned"

    regions = []
    room_index = {}
    for room, area in zip(ids, areas):
        rows, cols = np.nonzero(labels == room)
        (x0, y0), (x1, y1) = to_local(*grid.to_source(rows.min(), cols.min())), to_local(*grid.to_source(rows.max(), cols.max()))
        room_index[room] = len(regions)
        regions.append({
            "id": f"room_{len(regions):03d}",
            "group": group[room],
            "colour": ROOM_COLOURS.get(group[room]),
            "area_m2": round(float(area) * (CELL_CM / 100) ** 2, 1),
            "bbox": [x0, y0, x1, y1],
            "destinations": [d["id"] for d in by_room.get(int(room), [])],
        })

    rows, cols = np.nonzero(footprint)
    r0, r1, c0, c1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
    corner = to_local(grid.x0 + c0 * CELL_CM, grid.y0 + r0 * CELL_CM)
    summary = defaultdict(int)
    for region in regions:
        summary[region["group"]] += 1
    room_labels = np.zeros_like(labels)
    for room, index in room_index.items():
        room_labels[labels == room] = index + 1
    return {
        "schema_version": "navika-floor-rooms-0.1",
        "building": "M. George Block",
        "review_status": "auto_generated_requires_review",
        "method": f"doors closed, free space shrunk by {ROOM_SPLIT_CM:.0f} cm to split rooms, regrown within walls",
        "colours": ROOM_COLOURS,
        "texture": {"origin_xy": corner, "width_m": round((c1 - c0) * CELL_CM / 100, 2),
                    "height_m": round((r1 - r0) * CELL_CM / 100, 2), "crop_cells": [int(r0), int(r1), int(c0), int(c1)]},
        "regions": regions,
        "summary": dict(summary),
    }, room_labels


def hex_rgba(colour, alpha=255):
    colour = colour.lstrip("#")
    return [int(colour[i:i + 2], 16) for i in (0, 2, 4)] + [alpha]


def write_room_texture(path, rooms, room_labels, footprint, closed):
    """Top-down floor texture: room colours, slab grey under walls, voids and
    the outside transparent. Row 0 of the PNG is the north edge."""
    import matplotlib.image as mpimg

    palette = np.zeros((len(rooms["regions"]) + 1, 4), dtype=np.uint8)
    palette[0] = hex_rgba(ROOM_COLOURS["unassigned"])
    for index, region in enumerate(rooms["regions"], start=1):
        palette[index] = [0, 0, 0, 0] if region["group"] == "void" else hex_rgba(region["colour"])
    image = palette[room_labels]
    image[closed & footprint & (room_labels == 0)] = hex_rgba(SLAB_COLOUR)
    image[~footprint] = 0
    r0, r1, c0, c1 = rooms["texture"].pop("crop_cells")
    mpimg.imsave(path, image[r0:r1, c0:c1][::-1])


WALL_EXPORT_LAYERS = {"WALL": "wall", "WIN": "window", "STAIR": "stair"}


def export_walls(grid, footprint, polylines, to_local, floor_number, spec):
    """Wall, window and stair segments in metres, for the 2D/3D route views."""
    near_building = ndimage.binary_dilation(footprint, iterations=10)
    layers = {name: [] for name in WALL_EXPORT_LAYERS.values()}
    for layer, pts in polylines:
        name = WALL_EXPORT_LAYERS.get(layer)
        if not name:
            continue
        for (xa, ya), (xb, yb) in zip(pts[:-1], pts[1:]):
            if math.hypot(xb - xa, yb - ya) < 2:
                continue
            r, c = (int(v) for v in grid.to_cell((xa + xb) / 2, (ya + yb) / 2))
            if not (0 <= r < grid.h and 0 <= c < grid.w and near_building[r, c]):
                continue
            (x1, y1), (x2, y2) = to_local(xa, ya), to_local(xb, yb)
            layers[name].append([round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)])
    return {
        "schema_version": "navika-floor-walls-0.1",
        "building": "M. George Block",
        "floor_number": floor_number,
        "floor_label": spec["label"],
        "units": "metres (same frame as the walkable graph)",
        "segments": layers,
    }


def render_preview(path, grid, obstacles, reachable, doors, nodes, edges, kiosk, destinations, origin=ORIGIN_XY):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    def loc(sx, sy):
        return (sx - origin[0]) / 100, (sy - origin[1]) / 100

    x0, y0 = loc(grid.x0, grid.y0)
    x1, y1 = x0 + grid.w * CELL_CM / 100, y0 + grid.h * CELL_CM / 100
    img = np.ones((grid.h, grid.w, 3))
    img[reachable] = (0.80, 0.93, 0.80)
    img[obstacles] = (0.15, 0.15, 0.15)
    fig, ax = plt.subplots(figsize=(26, 15), dpi=90)
    ax.imshow(img, origin="lower", extent=(x0, x1, y0, y1), interpolation="nearest")
    pos = {n["id"]: (n["x"], n["y"]) for n in nodes}
    for e in edges:
        (xa, ya), (xb, yb) = pos[e["from"]], pos[e["to"]]
        ax.plot([xa, xb], [ya, yb], color="#1d4ed8", lw=1.1)
    for d in doors:
        (xa, ya), (xb, yb) = loc(*d["a"]), loc(*d["b"])
        ax.plot([xa, xb], [ya, yb], color="#dc2626", lw=3)
    colours = {"high": "#15803d", "medium": "#ca8a04", "low": "#dc2626"}
    for d in destinations:
        ax.plot(*d["xy"], "o", color=colours[d["confidence"]], ms=9, mec="black")
        ax.annotate(f'{d["pdf_no"] or "-"} {d["name"]}', d["xy"], xytext=(5, 5), textcoords="offset points", fontsize=8,
                    bbox={"boxstyle": "round,pad=0.15", "fc": "white", "ec": colours[d["confidence"]], "alpha": 0.85})
        if not d["line_of_sight"]:
            ax.plot(*d["xy"], "x", color="black", ms=14, mew=2)
    if kiosk:
        ax.plot(*kiosk["xy"], marker="*", color="#f59e0b", ms=24, mec="black")
    ax.set_xlim(-66, 76); ax.set_ylim(-38, 42); ax.set_aspect("equal")
    ax.grid(True, alpha=0.25)
    ax.set_title("Walkable area (green), obstacles (black), doors (red), centreline graph (blue), kiosk (star) — metres\n"
                 "Destination confidence: green = high, amber = medium, red = low (check on site); x = no line of sight to the graph")
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


# Vertical travel, as "metres of walking" so Dijkstra can mix it with corridors.
# Assumptions, to be confirmed on site: walking 1.2 m/s, one storey of stairs
# ~15 s, a lift ~30 s waiting plus ~3 s per storey.
STAIR_WEIGHT_M = 18.0
LIFT_BOARD_M = 18.0   # charged when boarding and again when leaving: ~30 s wait in total
LIFT_FLOOR_M = 4.0
# How far apart the same stair/lift may be labelled on adjacent floors.
CONNECTOR_MATCH_M = {"stairs": 8.0, "fire_stairs": 8.0, "lift": 3.0}
KIND_LABEL = {"stairs": "Staircase", "lift": "Lift", "fire_stairs": "Fire exit stair"}


def build_building(results, output_dir, in_use_path=DEFAULT_IN_USE):
    """Join the floors: pair stairs/lifts across adjacent floors into shafts."""
    floors = sorted(results)
    parent = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            a = parent[a]
        return a

    links = []
    for lower, upper in zip(floors, floors[1:]):
        if upper != lower + 1:
            continue
        pairs = sorted(
            (math.dist(a["xy"], b["xy"]), a["id"], b["id"], a["kind"])
            for a in results[lower]["connectors"] for b in results[upper]["connectors"]
            if a["kind"] == b["kind"] and math.dist(a["xy"], b["xy"]) <= CONNECTOR_MATCH_M[a["kind"]]
        )
        used = set()
        for d, a, b, kind in pairs:
            if a in used or b in used:
                continue
            used.update((a, b))
            parent[find(a)] = find(b)
            links.append((a, b, kind, round(d, 2)))

    connectors = {c["id"]: {**c, "floor": f} for f in floors for c in results[f]["connectors"]}
    # Name each shaft after the kiosk floor's place name when one is close by.
    kiosk_floor = next((f for f in floors if results[f].get("kiosk")), floors[0])
    named = {}
    for c in results[kiosk_floor]["connectors"]:
        near = [d for d in results[kiosk_floor]["destinations"]
                if CONNECTOR_KINDS.get(d["category"]) == c["kind"] and math.dist(d["xy"], c["xy"]) < 7]
        if near:
            named[find(c["id"])] = min(near, key=lambda d: math.dist(d["xy"], c["xy"]))["name"]
    shafts = defaultdict(list)
    for cid in connectors:
        shafts[find(cid)].append(cid)
    shaft_list, shaft_of = [], {}
    for root, members in shafts.items():
        if len({connectors[m]["floor"] for m in members}) < 2:
            continue  # only on one floor: nothing to travel through
        first = connectors[members[0]]
        name = named.get(root) or f"{KIND_LABEL[first['kind']]} ({wing_of(first['xy'][0])})"
        shaft_id = f"shaft_{len(shaft_list):02d}"
        for m in members:
            shaft_of[m] = shaft_id
        shaft_list.append({
            "id": shaft_id, "name": name, "kind": first["kind"],
            "routable": first["kind"] != "fire_stairs",
            "floors": sorted(connectors[m]["floor"] for m in members),
            "connectors": {str(connectors[m]["floor"]): m for m in members},
        })
    # Unnamed shafts of the same name get numbered.
    counts = defaultdict(int)
    for shaft in shaft_list:
        counts[shaft["name"]] += 1
    seen = defaultdict(int)
    for shaft in shaft_list:
        if counts[shaft["name"]] > 1:
            seen[shaft["name"]] += 1
            shaft["name"] = f"{shaft['name']} {seen[shaft['name']]}"

    # Reviewed list of the stairs/lifts in normal use: only those are routable,
    # under their reviewed names. Without the file every non-fire shaft routes.
    in_use = json.loads(in_use_path.read_text())["in_use"] if in_use_path.exists() else None
    if in_use is not None:
        def gap(entry, shaft):
            return min(math.dist(entry["xy"], connectors[cid]["xy"]) for cid in shaft["connectors"].values())

        # Each reviewed entry claims the single nearest shaft of its kind
        # (lifts stand ~2 m apart, so "any within 3 m" would claim neighbours).
        claimed = {}
        for entry in in_use:
            candidates = [sh for sh in shaft_list if sh["kind"] == entry["kind"] and sh["id"] not in claimed and gap(entry, sh) <= 3]
            if candidates:
                claimed[min(candidates, key=lambda sh: gap(entry, sh))["id"]] = entry
            else:
                print(f"WARNING: in-use {entry['kind']} '{entry['name']}' not found in the drawing near {entry['xy']}")
        for shaft in shaft_list:
            entry = claimed.get(shaft["id"])
            shaft["in_normal_use"] = entry is not None
            shaft["routable"] = entry is not None and shaft["kind"] != "fire_stairs"
            if entry:
                shaft["name"] = entry["name"]

    # Stair/lift destinations follow their shaft: ones not in normal use are
    # flagged so the kiosk does not offer them.
    for floor, result in results.items():
        for place in result["destinations"]:
            kind = CONNECTOR_KINDS.get(place["category"])
            if kind not in ("stairs", "lift"):
                continue
            shaft_of_connector = {cid: sh for sh in shaft_list for cid in sh["connectors"].values()}
            same_kind = [c for c in result["connectors"] if c["kind"] == kind]
            # PDF positions are +/-2 m and rounded lifts stand close together:
            # prefer the nearest stair/lift that is actually in use.
            in_use_near = [c for c in same_kind if math.dist(c["xy"], place["xy"]) <= 7
                           and shaft_of_connector.get(c["id"], {}).get("routable")]
            near = in_use_near or [c for c in same_kind if math.dist(c["xy"], place["xy"]) <= 4]
            nearest = min(near, key=lambda c: math.dist(c["xy"], place["xy"])) if near else None
            shaft = shaft_of_connector.get(nearest["id"]) if nearest else None
            place["in_use"] = bool(shaft and shaft["routable"])
            # The PDFs number staircases differently per floor; use the reviewed shaft name.
            if place["in_use"]:
                place.setdefault("pdf_name", place["name"])
                place["name"] = shaft["name"]

    virtual_nodes, edges = [], []
    for a, b, kind, _ in links:
        ca, cb = connectors[a], connectors[b]
        shaft = shaft_of.get(a)
        if not shaft:
            continue
        if kind == "lift":
            for c in (ca, cb):
                vid = f"{shaft}_F{c['floor']}"
                if not any(v["id"] == vid for v in virtual_nodes):
                    virtual_nodes.append({"id": vid, "floor": c["floor"], "x": c["xy"][0], "y": c["xy"][1], "shaft": shaft})
                    edges.append({"from": c["node"], "to": vid, "weight_m": LIFT_BOARD_M, "kind": "lift_board", "shaft": shaft})
            edges.append({"from": f"{shaft}_F{ca['floor']}", "to": f"{shaft}_F{cb['floor']}", "weight_m": LIFT_FLOOR_M, "kind": "lift", "shaft": shaft})
        else:
            edges.append({"from": ca["node"], "to": cb["node"], "weight_m": STAIR_WEIGHT_M, "kind": kind, "shaft": shaft})

    # Which destinations the kiosk can actually reach, by any route and lifts-only.
    routable = {sh["id"]: sh for sh in shaft_list if sh["routable"]}

    def reach(step_free):
        adjacency = defaultdict(list)
        for result in results.values():
            for e in result["edges"]:
                adjacency[e["from"]].append(e["to"])
                adjacency[e["to"]].append(e["from"])
        for e in edges:
            shaft = routable.get(e["shaft"])
            if shaft and not (step_free and shaft["kind"] != "lift"):
                adjacency[e["from"]].append(e["to"])
                adjacency[e["to"]].append(e["from"])
        start = results[kiosk_floor]["kiosk"]["node"]
        seen, stack = {start}, [start]
        while stack:
            for nxt in adjacency[stack.pop()]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        return seen

    any_route, lifts_only = reach(False), reach(True)
    hidden = []
    for floor, result in results.items():
        for place in result["destinations"]:
            place["reachable"] = place["node"] in any_route
            place["step_free"] = place["node"] in lifts_only
            if not place["reachable"] and place.get("in_use", True):
                hidden.append(f"{place['name']} ({FLOORS[floor]['label'].split(' (')[0]})")
        (output_dir / f"floor_{floor:02d}_walkable_graph.json").write_text(json.dumps(result, separators=(",", ":")))
    if hidden:
        print(f"not reachable with the stairs/lifts in use (hidden in the kiosk): {', '.join(hidden)}")

    building = {
        "schema_version": "navika-building-0.1",
        "building": "M. George Block",
        "review_status": "auto_generated_requires_review",
        "kiosk_floor": kiosk_floor,
        "floors": [{
            "floor_number": f, "label": FLOORS[f]["label"], "elevation_m": FLOORS[f]["elevation_m"],
            "graph": f"floor_{f:02d}_walkable_graph.json", "walls": f"floor_{f:02d}_walls.json", "rooms": f"floor_{f:02d}_rooms.json",
        } for f in floors],
        "shafts": shaft_list,
        "vertical_nodes": virtual_nodes,
        "vertical_edges": edges,
        "assumptions": {
            "floor_height_m": FLOOR_HEIGHT_M,
            "stairs_weight_m_per_floor": STAIR_WEIGHT_M,
            "lift_board_weight_m": LIFT_BOARD_M,
            "lift_weight_m_per_floor": LIFT_FLOOR_M,
            "fire_escape_stairs": "recorded but not used for routing",
            "note": "Stairs (within 8 m) and lifts (within 3 m) are paired across floors by position. Confirm on site which ones are in normal use.",
        },
    }
    (output_dir / "building.json").write_text(json.dumps(building, indent=1))
    print(f"building: {len(shaft_list)} stair/lift shafts across floors {floors}, {len(edges)} vertical edges")
    for shaft in shaft_list:
        print(f"  {shaft['name']:<34} {shaft['kind']:<12} floors {shaft['floors']}  {'ROUTED' if shaft['routable'] else 'not used'}")
    return building


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--floor", default="all", help="floor number (0-4) or 'all' (default) to build every floor and building.json")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--destinations", type=Path, help="destinations/kiosk config for a single --floor (default: data/navigation/mgeorge_floorNN_destinations.json)")
    parser.add_argument("--preview", type=Path, help="single floor: write a review PNG (walkable area, doors, graph, destinations)")
    parser.add_argument("--preview-dir", type=Path, help="all floors: write mgeorge_floorNN_walkable_preview.png review PNGs here")
    parser.add_argument("--debug-grid", type=Path, help="single floor: write the occupancy/walkable grids as .npz for inspection")
    args = parser.parse_args()
    if args.floor != "all":
        floor = int(args.floor)
        destinations = args.destinations or Path(str(DEFAULT_DESTINATIONS).format(floor=floor))
        build(args.source, floor, args.output_dir, destinations, args.preview, args.debug_grid)
        return
    doc = ezdxf.readfile(args.source)
    results = {}
    for floor in sorted(FLOORS):
        print(f"--- {FLOORS[floor]['label']}")
        preview = args.preview_dir / f"mgeorge_floor{floor:02d}_walkable_preview.png" if args.preview_dir else None
        destinations = Path(str(DEFAULT_DESTINATIONS).format(floor=floor))
        results[floor] = build(args.source, floor, args.output_dir, destinations, preview, doc=doc)
    build_building(results, args.output_dir)


if __name__ == "__main__":
    main()
