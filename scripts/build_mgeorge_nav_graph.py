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

CM_PER_UNIT = 1.0
CELL_CM = 10.0
CLEARANCE_CM = 25.0  # passage must be >= 50 cm wide (toilet aisles, 75 cm doors)
FOOTPRINT_CLOSE_CM = 250.0  # closes entrances up to ~5 m when finding the footprint
SPUR_PRUNE_M = 1.2
SIMPLIFY_CM = 15.0

# Origin shared with frontend/public/data/MGeorge_DXF so overlays line up.
ORIGIN_XY = (64508.653, -126418.979)

FLOORS = {
    1: {
        "floor_id": "MGEORGE_01",
        "label": "First Floor (entrance / reception level)",
        # x max reaches past the library semicircle (centre x 70640, r 1272).
        "window": (57700.0, -131000.0, 72300.0, -121000.0),
    },
}

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


def local_to_source(xy):
    return ORIGIN_XY[0] + xy[0] * 100, ORIGIN_XY[1] + xy[1] * 100


def build(source: Path, floor_number: int, output_dir: Path, destinations_path: Path, preview: Path | None, debug_grid: Path | None = None):
    config = json.loads(destinations_path.read_text())
    kiosk_xy = local_to_source(config["kiosk"]["xy"])
    spec = FLOORS[floor_number]
    window = spec["window"]
    doc = ezdxf.readfile(source)
    polylines, polygons, doors = collect_geometry(doc, window)
    grid = Grid(window)

    obstacles = np.zeros((grid.h, grid.w), dtype=bool)
    for _, pts in polylines:
        grid.burn_segments(obstacles, pts)
    for pts in polygons:
        grid.fill_polygon(obstacles, pts)
    obstacles = ndimage.binary_dilation(obstacles, iterations=1)
    carve_doors(grid, obstacles, doors)

    close = int(FOOTPRINT_CLOSE_CM / CELL_CM)
    structure = ndimage.generate_binary_structure(2, 1)
    footprint = ndimage.binary_closing(np.pad(obstacles, close), structure, iterations=close)[close:-close, close:-close]
    footprint = ndimage.binary_fill_holes(footprint)

    clearance = ndimage.distance_transform_edt(~obstacles) * CELL_CM
    walkable = (clearance >= CLEARANCE_CM) & footprint
    labels, _ = ndimage.label(walkable, structure=np.ones((3, 3)))
    kr, kc = (int(v) for v in grid.to_cell(*kiosk_xy))
    if not walkable[kr, kc]:
        rr, cc = np.nonzero(walkable)
        nearest = int(np.argmin((rr - kr) ** 2 + (cc - kc) ** 2))
        kr, kc = int(rr[nearest]), int(cc[nearest])
    reachable = labels == labels[kr, kc]

    skel = zhang_suen(reachable)
    centres, chains = skeleton_graph(skel)
    chains = prune_spurs(chains)

    node_ids, nodes, edges = {}, [], []

    def node_for(key, rc):
        if key not in node_ids:
            sx, sy = grid.to_source(*rc)
            node_ids[key] = f"MG{floor_number:02d}_N{len(nodes):04d}"
            nodes.append({
                "id": node_ids[key], "floor": floor_number,
                "x": round((sx - ORIGIN_XY[0]) / 100, 3), "y": round((sy - ORIGIN_XY[1]) / 100, 3),
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

    def to_local(x, y):
        return [round((x - ORIGIN_XY[0]) / 100, 3), round((y - ORIGIN_XY[1]) / 100, 3)]

    # Snap places to the graph: nearest walkable cell, then the closest node
    # visible from it without crossing an obstacle.
    _, (near_r, near_c) = ndimage.distance_transform_edt(~reachable, return_indices=True)
    node_rc = np.array([grid.to_cell(*local_to_source((n["x"], n["y"]))) for n in nodes])

    def snap(xy):
        r, c = (int(v) for v in grid.to_cell(*local_to_source(xy)))
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

    kiosk = {**config["kiosk"], **snap(config["kiosk"]["xy"])}
    # entrance_xy, when given, is a reviewed entrance used instead of the room label.
    destinations = [{**d, **snap(d.get("entrance_xy", d["xy"]))} for d in config["destinations"]]

    result = {
        "schema_version": "navika-walkable-graph-0.1",
        "building": "M. George Block",
        "floor_number": floor_number,
        "floor_id": spec["floor_id"],
        "floor_label": spec["label"],
        "review_status": "auto_generated_requires_review",
        "coordinate_system": {
            "units": "metres",
            "origin_source_xy": list(ORIGIN_XY),
            "source_units": "centimetres (inferred from door scales and dimension notes)",
            "x": "east = (dxf_x - origin_x) / 100", "y": "north = (dxf_y - origin_y) / 100",
        },
        "parameters": {"cell_cm": CELL_CM, "clearance_cm": CLEARANCE_CM, "spur_prune_m": SPUR_PRUNE_M},
        "source": str(source.relative_to(ROOT)),
        "kiosk": kiosk,
        "destinations": destinations,
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
    print(f"floor {floor_number}: {len(polylines)} polylines, {len(polygons)} hatch polygons, {len(doors)} doors")
    print(f"walkable cells {int(reachable.sum())} (~{reachable.sum() * CELL_CM ** 2 / 1e4:.0f} m²), nodes {len(nodes)}, edges {len(edges)}")
    print(f"wrote {out}")

    if preview:
        render_preview(preview, grid, obstacles, reachable, doors, nodes, edges, kiosk, destinations)
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


def render_preview(path, grid, obstacles, reachable, doors, nodes, edges, kiosk, destinations):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    def loc(sx, sy):
        return (sx - ORIGIN_XY[0]) / 100, (sy - ORIGIN_XY[1]) / 100

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
    ax.plot(*kiosk["xy"], marker="*", color="#f59e0b", ms=24, mec="black")
    ax.set_xlim(-66, 76); ax.set_ylim(-38, 42); ax.set_aspect("equal")
    ax.grid(True, alpha=0.25)
    ax.set_title("Walkable area (green), obstacles (black), doors (red), centreline graph (blue), kiosk (star) — metres\n"
                 "Destination confidence: green = high, amber = medium, red = low (check on site); x = no line of sight to the graph")
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--floor", type=int, default=1, choices=sorted(FLOORS))
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--destinations", type=Path, help="destinations/kiosk config (default: data/navigation/mgeorge_floorNN_destinations.json)")
    parser.add_argument("--preview", type=Path, help="write a review PNG (walkable area, doors, graph, destinations)")
    parser.add_argument("--debug-grid", type=Path, help="write the occupancy/walkable grids as .npz for inspection")
    args = parser.parse_args()
    destinations = args.destinations or Path(str(DEFAULT_DESTINATIONS).format(floor=args.floor))
    build(args.source, args.floor, args.output_dir, destinations, args.preview, args.debug_grid)


if __name__ == "__main__":
    main()
