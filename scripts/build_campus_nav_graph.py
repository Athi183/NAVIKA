#!/usr/bin/env python3
"""Build the outdoor (campus) walking network and join it to the M. George Block.

Source: data/original_sources/campus/COLLEGE PLAN VARNAM.dxf (PDF-derived, so
its declared units are unreliable). The plan includes an outline of the M.
George Block, drawn rotated about 180 degrees; fitting that outline onto the
floor-1 walls (iterative closest point, similarity transform) puts the whole
campus into the same metre frame as the indoor graphs.

Outdoor walkable space = a band around the road, driveway, footpath and paving
linework, with each road's two edge lines merged into one band; it is thinned
to its centreline like the indoor floors. M. George's footprint is cut out, and
the main entrance is linked to the nearest outdoor path.

Outputs (frontend/public/data/MGeorge_nav/): site_graph.json with nodes, edges,
outdoor destinations, the entrance link, the walkable mask and the linework for
drawing roads and paths in 3D.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import ezdxf
import matplotlib.image as mpimg
import numpy as np
from ezdxf import path as ezpath
from scipy import ndimage
from scipy.spatial import cKDTree

import build_mgeorge_nav_graph as mg

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "data/original_sources/campus/COLLEGE PLAN VARNAM.dxf"
DATA_DIR = ROOT / "frontend/public/data/MGeorge_nav"

# The sheet holds several copies; the main "COLLEGE LAYOUT" cluster is here (source units).
LAYOUT_BOX = (1500, 64500, 1000, 39000)
# The M. George outline inside that layout, used to fit the transform.
BUILDING_BOX = (16500, 33000, 17000, 23500)
PATH_LAYERS = {"PDF_INTERNAL ROAD": "road", "PDF_ROAD": "road", "PDF_foot path": "footpath", "PDF_PAVING": "paving"}
BOUNDARY_LAYER = "PDF_BOUNDARY"

CELL_M = 0.5
BAND_M = 2.0         # half-width of walkable space around each path line
ROAD_MERGE_M = 7.0   # closes the gap between a road's two edge lines (10 m road)
BRIDGE_MAX_M = 40.0  # the plan draws paths in pieces; join pieces closer than this
BRIDGE_HALF_WIDTH_M = 1.0
MIN_PIECE_M2 = 40.0
CLEAR_OF_BUILDING_M = 1.0
SPUR_PRUNE_M = 6.0
SIMPLIFY_M = 0.8
KIOSK_FLOOR = 1
# Just outside M. George's main entrance steps, in the indoor frame.
ENTRANCE_OUTSIDE_XY = (14.0, -14.0)

# Campus label -> (name, category). Halls inside M. George are indoor places.
SITE_PLACES = {
    "RAMANUJAN BLOCK": ("Ramanujan Block", "building"),
    "CANTEEN BUILDING": ("Canteen", "food"),
    "WORK SHOP BUILDING": ("Workshop Building", "building"),
    "LADIES HOSTEL": ("Ladies Hostel", "building"),
    "HOSTEL BLOCK": ("Hostel Block", "building"),
    "VIKRAM SARABHAI AUDITORIUM": ("Vikram Sarabhai Auditorium", "hall"),
    "MICHAEL JORDAN ARENA (BASKET BALL COURT)": ("Basketball Court (Michael Jordan Arena)", "sports"),
    "JIMMI GEORGE ARENA (VOLLEY BALL COURT)": ("Volleyball Court (Jimmi George Arena)", "sports"),
    "PARKING GROUND": ("Parking Ground", "parking"),
    "TWO WHEELER PARKING": ("Two-wheeler Parking", "parking"),
    "SECURITY CABIN": ("Security Cabin (main gate)", "gate"),
}


def label_text(entity):
    text = entity.plain_text() if entity.dxftype() == "MTEXT" else entity.dxf.text
    return " ".join(text.upper().split())


def in_box(x, y, box):
    return box[0] <= x <= box[1] and box[2] <= y <= box[3]


def entity_points(entity, step=5):
    if entity.dxftype() == "SOLID":
        d = entity.dxf
        return np.array([(p.x, p.y) for p in (d.vtx0, d.vtx1, d.vtx3, d.vtx2, d.vtx0)])
    return np.array([(v.x, v.y) for v in ezpath.make_path(entity).flattening(step)])


def fit_transform(doc):
    """Similarity transform (scale, rotation, shift) from campus units to the indoor frame."""
    campus = []
    for e in doc.modelspace():
        if e.dxf.layer not in ("PDF_0", "PDF_Wall") or e.dxftype() not in ("LWPOLYLINE", "ARC", "LINE", "SPLINE"):
            continue
        try:
            pts = entity_points(e)
        except Exception:
            continue
        if len(pts) < 2 or not in_box(*pts.mean(0), BUILDING_BOX):
            continue
        for a, b in zip(pts[:-1], pts[1:]):
            n = max(2, int(np.hypot(*(b - a)) / 40))
            campus.extend(a + (b - a) * t for t in np.linspace(0, 1, n))
    campus = np.array(campus)
    walls = json.loads((DATA_DIR / f"floor_{KIOSK_FLOOR:02d}_walls.json").read_text())["segments"]
    target = []
    for x1, y1, x2, y2 in walls["wall"] + walls["window"]:
        n = max(2, int(math.hypot(x2 - x1, y2 - y1) / 0.4))
        target.extend(np.c_[np.linspace(x1, x2, n), np.linspace(y1, y2, n)])
    target = np.array(target)

    # Start from a half-turn (the plan draws the library at the west end).
    theta = math.pi
    scale = np.ptp(target[:, 0]) / np.ptp(campus[:, 0])
    rot = lambda a: np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    shift = target.mean(0) - scale * campus.mean(0) @ rot(theta).T
    tree = cKDTree(target)
    for _ in range(60):
        moved = scale * campus @ rot(theta).T + shift
        dist, idx = tree.query(moved)
        keep = dist < np.percentile(dist, 80)
        a, b = campus[keep], target[idx[keep]]
        ma, mb = a.mean(0), b.mean(0)
        u, sv, vt = np.linalg.svd((b - mb).T @ (a - ma) / len(a))
        d = np.diag([1, np.sign(np.linalg.det(u @ vt))])
        r = u @ d @ vt
        scale = np.trace(np.diag(sv) @ d) / ((a - ma) ** 2).sum(1).mean()
        theta = math.atan2(r[1, 0], r[0, 0])
        shift = mb - scale * ma @ r.T
    dist, _ = tree.query(scale * campus @ rot(theta).T + shift)
    print(f"campus -> indoor frame: {scale:.6f} m/unit, rotation {math.degrees(theta):.1f} deg, median fit {np.median(dist):.2f} m")
    return {"scale_m_per_unit": scale, "rotation_rad": theta, "shift_m": shift.tolist(), "median_fit_m": float(np.median(dist))}, \
        (lambda pts: scale * np.asarray(pts, dtype=float) @ rot(theta).T + shift)


def building_footprint_mask(grid_origin, shape):
    """M. George's footprint (floor-1 room texture alpha) on the outdoor grid."""
    rooms = json.loads((DATA_DIR / f"floor_{KIOSK_FLOOR:02d}_rooms.json").read_text())
    tex = rooms["texture"]
    alpha = mpimg.imread(DATA_DIR / tex["file"])[..., 3][::-1] > 0.5  # row 0 = south
    h, w = alpha.shape
    rows, cols = np.mgrid[0:shape[0], 0:shape[1]]
    x = grid_origin[0] + (cols + 0.5) * CELL_M
    y = grid_origin[1] + (rows + 0.5) * CELL_M
    c = ((x - tex["origin_xy"][0]) / tex["width_m"] * w).astype(int)
    r = ((y - tex["origin_xy"][1]) / tex["height_m"] * h).astype(int)
    inside = (r >= 0) & (r < h) & (c >= 0) & (c < w)
    mask = np.zeros(shape, dtype=bool)
    mask[inside] = alpha[r[inside], c[inside]]
    return ndimage.binary_dilation(mask, iterations=int(CLEAR_OF_BUILDING_M / CELL_M))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--preview", type=Path, help="write a review PNG of the outdoor network")
    args = parser.parse_args()

    doc = ezdxf.readfile(args.source)
    transform, to_frame = fit_transform(doc)

    # Linework in the indoor frame.
    lines = {"road": [], "footpath": [], "paving": [], "boundary": []}
    for e in doc.modelspace():
        kind = PATH_LAYERS.get(e.dxf.layer) or ("boundary" if e.dxf.layer == BOUNDARY_LAYER else None)
        if not kind or e.dxftype() in ("TEXT", "MTEXT", "HATCH"):
            continue
        try:
            pts = entity_points(e, step=20)
        except Exception:
            continue
        if len(pts) >= 2 and in_box(*pts.mean(0), LAYOUT_BOX):
            lines[kind].append(to_frame(pts))

    allpts = np.vstack([p for kind in ("road", "footpath", "paving") for p in lines[kind]])
    x0, y0 = allpts.min(0) - 20
    x1, y1 = allpts.max(0) + 20
    shape = (int((y1 - y0) / CELL_M) + 1, int((x1 - x0) / CELL_M) + 1)
    burned = np.zeros(shape, dtype=bool)
    for kind in ("road", "footpath", "paving"):
        for pts in lines[kind]:
            for (xa, ya), (xb, yb) in zip(pts[:-1], pts[1:]):
                n = max(2, int(math.hypot(xb - xa, yb - ya) / (CELL_M / 2)))
                cc = ((np.linspace(xa, xb, n) - x0) / CELL_M).astype(int)
                rr = ((np.linspace(ya, yb, n) - y0) / CELL_M).astype(int)
                burned[rr, cc] = True
    band = ndimage.distance_transform_edt(~burned) * CELL_M <= BAND_M
    merge = int(ROAD_MERGE_M / CELL_M)
    walkable = ndimage.binary_closing(np.pad(band, merge), iterations=merge)[merge:-merge, merge:-merge]
    footprint = building_footprint_mask((x0, y0), shape)
    walkable &= ~footprint

    def draw_walkway(a, b):
        """Straight walkable strip between two cells (row, col)."""
        n = max(2, int(math.dist(a, b) * 2))
        rr = np.rint(np.linspace(a[0], b[0], n)).astype(int)
        cc = np.rint(np.linspace(a[1], b[1], n)).astype(int)
        strip = np.zeros(shape, dtype=bool)
        strip[rr, cc] = True
        walkable[ndimage.binary_dilation(strip, iterations=int(BRIDGE_HALF_WIDTH_M / CELL_M)) & ~footprint] = True

    # Join the pieces: repeatedly connect the nearest pair of pieces (closest
    # cells) until everything is one network or the gaps exceed BRIDGE_MAX_M.
    labels, count = ndimage.label(walkable, structure=np.ones((3, 3)))
    sizes = np.bincount(labels.ravel())
    pieces = [np.argwhere(labels == i)[::3] for i in range(1, count + 1) if sizes[i] * CELL_M ** 2 >= MIN_PIECE_M2]
    groups = list(range(len(pieces)))
    find = lambda i: i if groups[i] == i else find(groups[i])
    trees = [cKDTree(cells) for cells in pieces]
    candidates = []
    for i in range(len(pieces)):
        for j in range(i + 1, len(pieces)):
            d, k = trees[j].query(pieces[i])
            m = int(np.argmin(d))
            if d[m] * CELL_M <= BRIDGE_MAX_M:
                candidates.append((float(d[m]), i, j, tuple(pieces[i][m]), tuple(pieces[j][int(k[m])])))
    bridges = 0
    for d, i, j, a, b in sorted(candidates):
        if find(i) != find(j):
            groups[find(i)] = find(j)
            draw_walkway(a, b)
            bridges += 1
    labels, _ = ndimage.label(walkable, structure=np.ones((3, 3)))
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    walkable = labels == sizes.argmax()  # one connected campus network
    print(f"joined {len(pieces)} path pieces with {bridges} short walkways")

    # Join M. George's porch to the network.
    porch = (int((ENTRANCE_OUTSIDE_XY[1] - y0) / CELL_M), int((ENTRANCE_OUTSIDE_XY[0] - x0) / CELL_M))
    cells = np.argwhere(walkable)
    near = cells[int(np.argmin(((cells - porch) ** 2).sum(1)))]
    if math.dist(near, porch) * CELL_M > 0.5:
        draw_walkway(porch, tuple(near))
        print(f"porch joined to the nearest path ({math.dist(near, porch) * CELL_M:.1f} m walkway)")

    def to_cell(xy):
        return int((xy[1] - y0) / CELL_M), int((xy[0] - x0) / CELL_M)

    def to_xy(rc):
        return [round(x0 + (rc[1] + 0.5) * CELL_M, 2), round(y0 + (rc[0] + 0.5) * CELL_M, 2)]

    skel = mg.zhang_suen(walkable)
    centres, chains = mg.skeleton_graph(skel)
    length = lambda pts: sum(math.dist(a, b) for a, b in zip(pts[:-1], pts[1:])) * CELL_M
    for _ in range(6):  # drop short dead ends
        degree = {}
        for a, b, _ in chains:
            degree[a] = degree.get(a, 0) + 1
            degree[b] = degree.get(b, 0) + 1
        kept = [ch for ch in chains if not ((degree[ch[0]] == 1) != (degree[ch[1]] == 1) and length(ch[2]) < SPUR_PRUNE_M)]
        if len(kept) == len(chains):
            break
        chains = kept

    node_ids, nodes, edges, seen = {}, [], [], set()

    def node_for(key, rc):
        if key not in node_ids:
            node_ids[key] = f"SITE_N{len(nodes):04d}"
            x, y = to_xy(rc)
            nodes.append({"id": node_ids[key], "floor": "site", "x": x, "y": y})
        return node_ids[key]

    for a, b, points in chains:
        simple = mg.rdp(points, SIMPLIFY_M / CELL_M)
        if a == b and len(simple) < 3:
            continue
        keys = [("c", a)] + [("p", p) for p in simple[1:-1]] + [("c", b)]
        ids = [node_for(k, p) for k, p in zip(keys, simple)]
        for (ia, pa), (ib, pb) in zip(zip(ids, simple), zip(ids[1:], simple[1:])):
            pair = tuple(sorted((ia, ib)))
            if ia != ib and pair not in seen:
                seen.add(pair)
                edges.append({"from": ia, "to": ib, "weight_m": round(math.dist(pa, pb) * CELL_M, 2)})

    node_xy = np.array([[n["x"], n["y"]] for n in nodes])
    tree = cKDTree(node_xy)

    def nearest(xy):
        d, i = tree.query(xy)
        return nodes[int(i)]["id"], [nodes[int(i)]["x"], nodes[int(i)]["y"]], round(float(d), 1)

    destinations = []
    for e in doc.modelspace().query("TEXT MTEXT"):
        if e.dxf.layer != "PDF_TEXT" or not in_box(e.dxf.insert.x, e.dxf.insert.y, LAYOUT_BOX):
            continue
        key = label_text(e)
        if key not in SITE_PLACES or any(d["dxf_label"] == key for d in destinations):
            continue
        name, category = SITE_PLACES[key]
        xy = [round(float(v), 2) for v in to_frame([[e.dxf.insert.x, e.dxf.insert.y]])[0]]
        node, approach, gap = nearest(xy)
        destinations.append({
            "id": f"site_{len(destinations):02d}", "pdf_no": None, "name": name, "category": category,
            "xy": xy, "node": node, "approach_xy": approach, "snap_m": gap,
            "anchor_walkable": False, "line_of_sight": True, "confidence": "low", "dxf_label": key,
            "note": "Campus plan label (building position, not its entrance); route ends at the nearest outdoor path.",
        })

    indoor = json.loads((DATA_DIR / f"floor_{KIOSK_FLOOR:02d}_walkable_graph.json").read_text())
    entrance = next(d for d in indoor["destinations"] if d["category"] == "entrance")
    outside_node, outside_xy, gap = nearest(ENTRANCE_OUTSIDE_XY)
    links = [{
        "name": "Main entrance", "kind": "entrance",
        "indoor_floor": KIOSK_FLOOR, "indoor_node": entrance["node"], "indoor_xy": entrance["approach_xy"],
        "site_node": outside_node, "site_xy": outside_xy,
        "weight_m": round(math.dist(entrance["approach_xy"], outside_xy), 2),
    }]
    print(f"outdoor network: {len(nodes)} nodes, {len(edges)} edges, ~{walkable.sum() * CELL_M ** 2 / 1e3:.1f}k m2 walkable")
    print(f"main entrance joins the outdoor path {gap} m from the porch; {len(destinations)} outdoor places: "
          + ", ".join(d["name"] for d in destinations))

    rows, cols = walkable.shape
    k = 1  # mask already at CELL_M
    site = {
        "schema_version": "navika-site-graph-0.1",
        "campus": "MITS (Varnam college layout)",
        "review_status": "auto_generated_requires_review",
        "source": str(args.source.relative_to(ROOT)),
        "transform_campus_to_indoor": transform,
        "level_floor": KIOSK_FLOOR,
        "nodes": nodes,
        "edges": edges,
        "destinations": destinations,
        "links": links,
        "walkable_mask": {
            "cell_m": CELL_M, "origin_xy": [round(float(x0), 3), round(float(y0), 3)], "rows": rows // k, "cols": cols // k,
            "order": "row-major from origin (south-west), rows go north, bits MSB-first",
            "bits_base64": __import__("base64").b64encode(np.packbits(walkable.ravel()).tobytes()).decode("ascii"),
        },
        "features": {kind: [[[round(float(x), 2), round(float(y), 2)] for x, y in mg.rdp([tuple(p) for p in pts], 0.3)] for pts in lines[kind]]
                     for kind in lines},
    }
    (DATA_DIR / "site_graph.json").write_text(json.dumps(site, separators=(",", ":")))
    print(f"wrote {DATA_DIR / 'site_graph.json'}")

    if args.preview:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(30, 12), dpi=70)
        ax.imshow(np.where(walkable[..., None], [0.85, 0.94, 0.85], [1, 1, 1]), origin="lower", extent=(x0, x0 + cols * CELL_M, y0, y0 + rows * CELL_M))
        colours = {"road": "#2563eb", "footpath": "#16a34a", "paving": "#f59e0b", "boundary": "#dc2626"}
        for kind, polylines in lines.items():
            for pts in polylines:
                ax.plot(pts[:, 0], pts[:, 1], color=colours[kind], lw=0.8)
        pos = {n["id"]: (n["x"], n["y"]) for n in nodes}
        for e in edges:
            (a, b), (c, d) = pos[e["from"]], pos[e["to"]]
            ax.plot([a, c], [b, d], color="#111827", lw=1.2)
        walls = json.loads((DATA_DIR / f"floor_{KIOSK_FLOOR:02d}_walls.json").read_text())["segments"]["wall"]
        for xa, ya, xb, yb in walls:
            ax.plot([xa, xb], [ya, yb], color="#7f1d1d", lw=0.4)
        for d in destinations:
            ax.plot(*d["xy"], "o", color="#9333ea", ms=8)
            ax.annotate(d["name"], d["xy"], fontsize=9, xytext=(4, 4), textcoords="offset points")
        ax.plot(*outside_xy, "*", ms=20, color="#f59e0b", mec="black")
        ax.set_aspect("equal")
        ax.set_title("Outdoor network (black) on roads (blue), footpaths (green), paving (orange); M. George walls (brown); entrance link (star)")
        fig.savefig(args.preview, bbox_inches="tight")


if __name__ == "__main__":
    main()
