#!/usr/bin/env python3
"""Pilot: put one floor's IFC model (walls, doors, slab) on the NAVIKA map.

1. Read the IFC with IfcOpenShell (world coordinates, metres).
2. Fit it onto the floor's walls in M. George's frame by iterative closest
   point (rotation, shift and scale), tried from the four quarter turns.
   Reported: the scale the IFC needed (1.000 = it was modelled at true size;
   the CAD is taken as the true size) and how far IFC walls sit from ours.
3. Door check: for each destination, walk the graph from the floor's first
   lift to the room and find where the route crosses into the room's box.
   That crossing should be at a real IFC door.
4. Export the IFC geometry, moved into our frame, as GLB for the 3D view.

    PYTHONPATH=scripts .venv/bin/python scripts/pilot_ifc_floor.py \
        data/original_sources/ramanujan_floor5/ram_5th.ifc R5 --preview inspection_navigation/ifc_pilot_R5.png

Writes <building dir>/floor_<key>_ifc.glb and floor_<key>_ifc.json, and adds
"ifc_model" to that floor in building.json.
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import numpy as np
import trimesh
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "frontend/public/data"
BUILDING_DIRS = {"R": DATA / "Ramanujan_nav"}
COLOURS = {"IfcWall": "#B86F70", "IfcDoor": "#8B5A2B", "IfcSlab": "#D9D9D9", "IfcStair": "#9b7bd1",
           "IfcStairFlight": "#9b7bd1", "IfcRailing": "#50545a", "IfcWindow": "#79b7c4", "IfcMember": "#77777b"}
SAMPLE_M = 0.25
DOOR_OK_M = 1.2     # a route crossing this close to a door goes through it
ROOM_PAD_M = 0.3    # room boxes are drawn inside the walls


def floor_dir(key: str) -> Path:
    return BUILDING_DIRS.get(str(key)[0], DATA / "MGeorge_nav")


def ifc_elements(path: Path):
    """[(ifc class, name, vertices (n, 3), faces (m, 3))] in IFC world metres."""
    model = ifcopenshell.open(str(path))
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    iterator = ifcopenshell.geom.iterator(settings, model)
    elements = []
    if iterator.initialize():
        while True:
            shape = iterator.get()
            element = model.by_id(shape.id)
            verts = np.array(shape.geometry.verts).reshape(-1, 3)
            faces = np.array(shape.geometry.faces).reshape(-1, 3)
            elements.append((element.is_a(), element.Name or "", verts, faces))
            if not iterator.next():
                break
    return elements


def densify(segments, step=SAMPLE_M):
    points = []
    for (x1, y1), (x2, y2) in segments:
        n = max(2, int(math.hypot(x2 - x1, y2 - y1) / step) + 1)
        points.extend(np.c_[np.linspace(x1, x2, n), np.linspace(y1, y2, n)])
    return np.array(points)


def wall_outline_points(elements):
    """Plan outline of every IFC wall: the edges of its triangles at floor level."""
    segments = []
    for kind, _, verts, faces in elements:
        if kind != "IfcWall":
            continue
        low = verts[:, 2] < verts[:, 2].min() + 0.05
        for tri in faces:
            for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
                if low[a] and low[b]:
                    segments.append((verts[a, :2], verts[b, :2]))
    return densify(segments)


def rotation(theta):
    return np.array([[math.cos(theta), -math.sin(theta)], [math.sin(theta), math.cos(theta)]])


def fit(source, target):
    """Similarity fit (rotation, scale, shift) of source points onto target; tries the four quarter turns."""
    tree = cKDTree(target)
    best = None
    for start in range(4):
        theta = start * math.pi / 2
        scale = float(np.sqrt(target.var(0).sum() / source.var(0).sum()))
        shift = target.mean(0) - scale * source.mean(0) @ rotation(theta).T
        for _ in range(100):
            moved = scale * source @ rotation(theta).T + shift
            dist, idx = tree.query(moved)
            keep = dist < max(np.percentile(dist, 80), 0.05)
            a, b = source[keep], target[idx[keep]]
            ma, mb = a.mean(0), b.mean(0)
            u, sv, vt = np.linalg.svd((b - mb).T @ (a - ma) / len(a))
            d = np.diag([1, np.sign(np.linalg.det(u @ vt))])
            r = u @ d @ vt
            scale = float(np.trace(np.diag(sv) @ d) / ((a - ma) ** 2).sum(1).mean())
            theta = math.atan2(r[1, 0], r[0, 0])
            shift = mb - scale * ma @ r.T
        dist, _ = tree.query(scale * source @ rotation(theta).T + shift)
        if best is None or np.median(dist) < best["median_m"]:
            best = {"rotation_deg": math.degrees(theta) % 360, "scale": scale, "shift_m": shift.tolist(), "median_m": float(np.median(dist)),
                    "p90_m": float(np.percentile(dist, 90)), "within_0_3_m": float(np.mean(dist < 0.3))}
    return best


def shortest_path(graph, start, goal):
    adjacency = {}
    for edge in graph["edges"]:
        adjacency.setdefault(edge["from"], []).append((edge["to"], edge["weight_m"]))
        adjacency.setdefault(edge["to"], []).append((edge["from"], edge["weight_m"]))
    queue, seen, previous = [(0.0, start)], {start: 0.0}, {}
    while queue:
        cost, node = heapq.heappop(queue)
        if node == goal:
            path = [node]
            while path[-1] in previous:
                path.append(previous[path[-1]])
            return path[::-1]
        if cost > seen[node]:
            continue
        for nxt, weight in adjacency.get(node, []):
            if cost + weight < seen.get(nxt, math.inf):
                seen[nxt] = cost + weight
                previous[nxt] = node
                heapq.heappush(queue, (cost + weight, nxt))
    return None


def entry_point(points, box):
    """Where a polyline first enters an axis-aligned box (x0, y0, x1, y1)."""
    inside = lambda p: box[0] <= p[0] <= box[2] and box[1] <= p[1] <= box[3]
    for a, b in zip(points[:-1], points[1:]):
        if not inside(a) and inside(b):
            lo, hi = 0.0, 1.0
            for _ in range(30):
                mid = (lo + hi) / 2
                if inside(a + (b - a) * mid):
                    hi = mid
                else:
                    lo = mid
            return a + (b - a) * hi
    return None


def door_check(graph, rooms, doors_xy):
    nodes = {node["id"]: np.array([node["x"], node["y"]]) for node in graph["nodes"]}
    start = next(c["node"] for c in graph["connectors"] if c["kind"] == "lift")
    region_of = {pid: region for region in rooms["regions"] for pid in region["destinations"]}
    tree = cKDTree(doors_xy) if len(doors_xy) else None
    results = []
    for place in graph["destinations"]:
        region = region_of.get(place["id"])
        row = {"id": place["id"], "name": place["name"]}
        if not region:
            results.append({**row, "status": "no room outline"})
            continue
        x0, y0, x1, y1 = region["bbox"]
        box = (x0 - ROOM_PAD_M, y0 - ROOM_PAD_M, x1 + ROOM_PAD_M, y1 + ROOM_PAD_M)
        doors_here = [i for i, (x, y) in enumerate(doors_xy) if box[0] - 0.5 <= x <= box[2] + 0.5 and box[1] - 0.5 <= y <= box[3] + 0.5]
        path = shortest_path(graph, start, place["node"])
        points = [nodes[n] for n in path] + [np.array(place["xy"])] if path else []
        entry = entry_point(points, box) if points else None
        if entry is None:
            results.append({**row, "status": "route starts inside the room" if path else "no route", "ifc_doors": len(doors_here)})
            continue
        gap = float(tree.query(entry)[0]) if tree else math.inf
        status = "through a door" if gap <= DOOR_OK_M else ("no IFC door on this room" if not doors_here else "enters away from the doors")
        results.append({**row, "status": status, "entry_xy": entry.round(2).tolist(), "nearest_door_m": round(gap, 2), "ifc_doors": len(doors_here)})
    return results


def export_glb(elements, transform, path):
    """Each IFC class as one coloured mesh, in the 3D view's axes: (x, height, -y)."""
    r, shift = transform
    scene = trimesh.Scene()
    by_kind = {}
    for kind, _, verts, faces in elements:
        plan = verts[:, :2] @ r.T + shift
        world = np.c_[plan[:, 0], verts[:, 2], -plan[:, 1]]
        by_kind.setdefault(kind, []).append(trimesh.Trimesh(world, faces, process=False))
    for kind, meshes in by_kind.items():
        mesh = trimesh.util.concatenate(meshes)
        colour = COLOURS.get(kind, "#cccccc")
        rgba = [int(colour[i:i + 2], 16) / 255 for i in (1, 3, 5)] + [1.0]
        mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
            name=kind, baseColorFactor=rgba, roughnessFactor=0.9, metallicFactor=0.0))
        scene.add_geometry(mesh, node_name=kind, geom_name=kind)
    path.write_bytes(scene.export(file_type="glb"))


def preview(path, ours, ifc_points, doors_xy, results):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(10, 18))
    ax.scatter(ours[:, 0], ours[:, 1], s=0.3, c="#999999", label="NAVIKA walls (Mehrin's data)")
    ax.scatter(ifc_points[:, 0], ifc_points[:, 1], s=0.3, c="#B86F70", label="IFC walls, fitted")
    ax.scatter(doors_xy[:, 0], doors_xy[:, 1], s=40, marker="s", c="#8B5A2B", label="IFC doors")
    marks = {"through a door": "#16a34a", "enters away from the doors": "#dc2626", "no IFC door on this room": "#f59e0b"}
    for row in results:
        if "entry_xy" in row:
            ax.scatter(*row["entry_xy"], s=60, c=marks.get(row["status"], "#2563eb"), edgecolors="black", zorder=5)
            ax.annotate(row["name"][:28], row["entry_xy"], fontsize=6, xytext=(4, 4), textcoords="offset points")
    ax.set_aspect("equal")
    ax.legend(loc="upper right", markerscale=8)
    ax.set_title("IFC pilot: green = route enters through a door, red = away from doors, amber = no IFC door")
    fig.savefig(path, dpi=110, bbox_inches="tight")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("ifc", type=Path)
    parser.add_argument("floor", help="floor key, e.g. R5 or 2")
    parser.add_argument("--preview", type=Path)
    args = parser.parse_args()

    base = floor_dir(args.floor)
    tag = args.floor if str(args.floor).startswith("R") else f"{int(args.floor):02d}"
    graph = json.loads((base / f"floor_{tag}_walkable_graph.json").read_text())
    rooms = json.loads((base / f"floor_{tag}_rooms.json").read_text())
    walls = json.loads((base / f"floor_{tag}_walls.json").read_text())["segments"]
    ours = densify([((x1, y1), (x2, y2)) for x1, y1, x2, y2 in walls["wall"] + walls.get("window", [])])

    elements = ifc_elements(args.ifc)
    ifc_points = wall_outline_points(elements)
    result = fit(ifc_points, ours)
    # Plan transform; heights are left as modelled (the scale is a plan-drawing error).
    r = result["scale"] * rotation(math.radians(result["rotation_deg"]))
    shift = np.array(result["shift_m"])
    doors = [(name, verts) for kind, name, verts, _ in elements if kind == "IfcDoor"]
    doors_xy = np.array([verts[:, :2].mean(0) @ r.T + shift for _, verts in doors]).reshape(-1, 2)

    # How much of our floor the IFC covers: our wall points with an IFC wall within 0.5 m.
    covered = float(np.mean(cKDTree(ifc_points @ r.T + shift).query(ours)[0] < 0.5))
    results = door_check(graph, rooms, doors_xy)
    counts = {}
    for row in results:
        counts[row["status"]] = counts.get(row["status"], 0) + 1

    export_glb(elements, (r, shift), base / f"floor_{tag}_ifc.glb")
    # Point the floor at its model (the building scripts keep this on rebuild).
    building_path = base / "building.json"
    building = json.loads(building_path.read_text())
    for spec in building["floors"]:
        if str(spec["floor_number"]) == str(args.floor):
            spec["ifc_model"] = f"floor_{tag}_ifc.glb"
    building_path.write_text(json.dumps(building, indent=1))
    report = {
        "schema_version": 1, "source": str(args.ifc.relative_to(ROOT)) if args.ifc.is_absolute() else str(args.ifc),
        "floor": args.floor, "elements": {k: sum(1 for e in elements if e[0] == k) for k in sorted({e[0] for e in elements})},
        "fit": {**result, "our_walls_covered_by_ifc": covered},
        "doors_xy": doors_xy.round(2).tolist(), "door_check": counts, "rooms": results,
    }
    (base / f"floor_{tag}_ifc.json").write_text(json.dumps(report, indent=1))
    print(f"elements: {report['elements']}")
    print(f"fit: rotation {result['rotation_deg']:.1f} deg, scale {result['scale']:.3f} (IFC size x this = CAD size); "
          f"IFC walls from ours: median {result['median_m']:.2f} m, 90% within {result['p90_m']:.2f} m, {result['within_0_3_m']:.0%} within 0.3 m")
    print(f"IFC covers {covered:.0%} of our wall lines")
    print(f"door check: {counts}")
    for row in results:
        if row["status"] != "through a door":
            print(f"  {row['status']:<28} {row['name']}  (nearest door {row.get('nearest_door_m', '-')} m)")
    if args.preview:
        preview(args.preview, ours, ifc_points @ r.T + shift, doors_xy, results)
        print(f"preview: {args.preview}")


if __name__ == "__main__":
    main()
