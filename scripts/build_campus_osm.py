#!/usr/bin/env python3
"""OpenStreetMap layer for the 3D campus view, and GPS-to-map conversion.

Source: OpenStreetMap data around the campus, cached in
data/original_sources/campus/osm_mits_campus.osm (--download refreshes it from
api.openstreetmap.org). © OpenStreetMap contributors, ODbL: the map must show
that credit wherever this layer is drawn.

Georeference: OSM's M. George outline is fitted onto our own (its First Floor
outline in campus_massing.json) by iterative closest point with rotation,
scale and shift. The same fit turns any GPS position into map metres:

    map_xy = matrix @ [east_m, north_m] + shift

with east/north in metres from (lat0, lon0). M. George and Ramanujan are drawn
from the CAD drawings, so their OSM outlines are only used for the fit and to
report how far apart OSM puts the two buildings (the bridge is not measured).

Writes frontend/public/data/campus_osm.json. Run after build_campus_massing.py:

    PYTHONPATH=scripts .venv/bin/python scripts/build_campus_osm.py
"""
from __future__ import annotations

import argparse
import json
import math
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

import pilot_ifc_floor as pilot

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/original_sources/campus/osm_mits_campus.osm"
DATA = ROOT / "frontend/public/data"
OUTPUT = DATA / "campus_osm.json"
BBOX = (76.3961, 9.9536, 76.4181, 9.9736)  # lon/lat, about 2.4 x 2.2 km round Varikoli

CAMPUS_NAME = "Muthoot Institute of Technology & Science"
CAD_BUILDINGS = {"Muthoot M George Block": "M. George Block", "Ramanujan Block, Muthoot Institute of Technology": "Ramanujan Block"}
CAMPUS_MARGIN_M = 40      # buildings this close to the campus boundary count as campus
CONTEXT_MARGIN_M = 120    # everything else drawn within this distance, unlabelled
PLACE_LINK_M = 60         # a campus place with a matching name this close is the same building
# Words that name the same thing on the campus plan and in OSM.
SYNONYMS = {"girls": "ladies", "workshop": "lab", "boys": "mens"}
NAME_NOISE = {"mits", "the", "of", "block", "building", "open"}
TREE_SPACING_M = 9.0
MAX_EXTRA_TREES = 260
# OSM has floor counts only for the CAD buildings; the rest are typical values.
ESTIMATED_LEVELS = {"hostel": 4, "lab": 1, "canteen": 1, "cafe": 1, "college": 2, "other": 1}


def download():
    url = "https://api.openstreetmap.org/api/0.6/map?bbox=" + ",".join(map(str, BBOX))
    request = urllib.request.Request(url, headers={"User-Agent": "navika-campus-map/1.0 (student project)"})
    SOURCE.write_bytes(urllib.request.urlopen(request, timeout=120).read())
    print(f"downloaded {SOURCE.relative_to(ROOT)}")


def read_osm():
    root = ET.parse(SOURCE).getroot()
    tags = lambda element: {t.get("k"): t.get("v") for t in element.findall("tag")}
    nodes = {n.get("id"): (float(n.get("lat")), float(n.get("lon")), tags(n)) for n in root.iter("node")}
    ways = []
    for way in root.iter("way"):
        refs = [nd.get("ref") for nd in way.findall("nd") if nd.get("ref") in nodes]
        if len(refs) >= 2:
            ways.append({"id": way.get("id"), "tags": tags(way), "latlon": [nodes[r][:2] for r in refs], "closed": refs[0] == refs[-1]})
    return nodes, ways


class Geo:
    """Local east/north metres round (lat0, lon0), then the fitted map transform."""

    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.matrix, self.shift = np.eye(2), np.zeros(2)

    def metres(self, latlon):
        latlon = np.asarray(latlon, dtype=float).reshape(-1, 2)
        east = (latlon[:, 1] - self.lon0) * 111320 * math.cos(math.radians(self.lat0))
        north = (latlon[:, 0] - self.lat0) * 110574
        return np.c_[east, north]

    def to_map(self, latlon):
        return self.metres(latlon) @ self.matrix.T + self.shift


def ring_points(coords, step=0.5):
    coords = [tuple(c) for c in coords]
    return pilot.densify(list(zip(coords, coords[1:] + coords[:1])), step)


def fit_to_cad(geo, osm_outline, massing):
    mg = next(b for b in massing["buildings"] if b["name"] == "M. George Block")
    ours = next(s for s in mg["storeys"] if s["floor"] == 1)["parts"][0]["outer"]
    result = pilot.fit(ring_points(geo.metres(osm_outline)), ring_points(ours))
    geo.matrix = result["scale"] * pilot.rotation(math.radians(result["rotation_deg"]))
    geo.shift = np.array(result["shift_m"])
    return result


def kind_of(tags):
    name = (tags.get("name") or "").lower()
    if "hostel" in name:
        return "hostel"
    if "lab" in name or "workshop" in name:
        return "lab"
    if "canteen" in name:
        return "canteen"
    if "cafe" in name:
        return "cafe"
    if tags.get("building") in ("college", "school", "university"):
        return "college"
    return "other"


def name_words(name):
    words = {re.sub(r"[^a-z]", "", w) for w in (name or "").lower().split()} - NAME_NOISE - {""}
    return {SYNONYMS.get(w, w) for w in words}


def link_places(buildings, polygons, places):
    """Pair each campus place with at most one building: most shared name words first, then nearest."""
    pairs = []
    for index, building in enumerate(buildings):
        for point, place in places:
            gap = point.distance(polygons[index])
            shared = len(name_words(building["name"]) & name_words(place["name"]))
            if building["name"] and gap <= PLACE_LINK_M and shared:
                pairs.append((-shared, gap, index, place["id"]))
    used_buildings, used_places = set(), set()
    for _, _, index, place_id in sorted(pairs):
        if index not in used_buildings and place_id not in used_places:
            buildings[index]["place_id"] = place_id
            used_buildings.add(index)
            used_places.add(place_id)


def display_name(name):
    if not name:
        return None
    name = re.sub(r"^MITS\s+", "", name)
    if name.isupper():
        name = name.title()
    return name[:1].upper() + name[1:] if name.islower() or name.split()[0].islower() else name


def rounded(points):
    return [[round(float(x), 2), round(float(y), 2)] for x, y in points]


def scatter_trees(grass, blocked, existing):
    """Evenly spaced trees on the grass, kept clear of buildings, pitches and paths."""
    trees = []
    taken = [Point(xy) for xy in existing]
    for area in grass:
        x0, y0, x1, y1 = area.bounds
        for i, x in enumerate(np.arange(x0 + TREE_SPACING_M / 2, x1, TREE_SPACING_M)):
            for y in np.arange(y0 + TREE_SPACING_M / 2 + (i % 2) * TREE_SPACING_M / 2, y1, TREE_SPACING_M):
                # A little jitter, fixed by position, so the rows do not look planted.
                jx, jy = math.sin(x * 12.9898 + y * 78.233) * 2.2, math.cos(x * 39.346 + y * 11.135) * 2.2
                spot = Point(x + jx, y + jy)
                if area.buffer(-1.5).contains(spot) and not blocked.contains(spot) and all(spot.distance(t) > 5 for t in taken):
                    trees.append(spot)
                    taken.append(spot)
    return trees[:MAX_EXTRA_TREES]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--download", action="store_true", help="refresh the cached OpenStreetMap extract first")
    args = parser.parse_args()
    if args.download or not SOURCE.exists():
        download()

    nodes, ways = read_osm()
    by_name = {w["tags"]["name"]: w for w in ways if w["tags"].get("name")}
    campus_way = by_name[CAMPUS_NAME]
    lat0, lon0 = np.mean(campus_way["latlon"], axis=0)
    geo = Geo(float(lat0), float(lon0))

    massing = json.loads((DATA / "campus_massing.json").read_text())
    fit = fit_to_cad(geo, by_name["Muthoot M George Block"]["latlon"], massing)
    print(f"OSM -> map: rotation {fit['rotation_deg']:.1f} deg, scale {fit['scale']:.3f}; "
          f"M. George outlines {fit['median_m']:.2f} m apart (median), 90% within {fit['p90_m']:.2f} m")

    campus = Polygon(geo.to_map(campus_way["latlon"]))
    near_campus = campus.buffer(CAMPUS_MARGIN_M)
    context = campus.buffer(CONTEXT_MARGIN_M)
    site = json.loads((DATA / "MGeorge_nav/site_graph.json").read_text())
    places = [(Point(p["xy"]), p) for p in site["destinations"]]

    buildings, footprints, polygons = [], [], []
    for way in ways:
        tags = way["tags"]
        if "building" not in tags or not way["closed"] or len(way["latlon"]) < 4:
            continue
        outline = geo.to_map(way["latlon"])
        polygon = Polygon(outline).buffer(0)
        if polygon.is_empty or not context.intersects(polygon):
            continue
        footprints.append(polygon)
        name = tags.get("name")
        if name in CAD_BUILDINGS:
            continue
        # Named buildings are campus only when OSM says so (an "MITS" name or inside the
        # boundary); the hospital and church next door are not.
        on_campus = (name or "").startswith("MITS") or (campus.contains(polygon.centroid) if name else near_campus.intersects(polygon))
        kind = kind_of(tags) if on_campus else "neighbour"
        levels = tags.get("building:levels")
        polygons.append(polygon)
        buildings.append({
            "id": way["id"], "name": display_name(name) if on_campus else None, "kind": kind,
            "levels": int(levels) if levels and levels.isdigit() else ESTIMATED_LEVELS.get(kind, 1),
            "levels_estimated": not (levels and levels.isdigit()),
            "roof_only": tags.get("building") == "roof",
            "place_id": None,
            "outline": rounded(outline[:-1]),
        })

    link_places(buildings, polygons, places)

    areas = []
    for way in ways:
        tags = way["tags"]
        kind = ("grass" if tags.get("landuse") == "grass" or tags.get("natural") == "grassland"
                else "pitch" if tags.get("leisure") == "pitch"
                else "parking" if tags.get("amenity") in ("parking", "motorcycle_parking")
                else "water" if tags.get("natural") == "water" else None)
        if not kind or not way["closed"] or len(way["latlon"]) < 4:
            continue
        outline = geo.to_map(way["latlon"])
        if not context.intersects(Polygon(outline)):
            continue
        # A named area gets its own label unless a campus place with that name is already there.
        polygon = Polygon(outline)
        labelled = any(point.distance(polygon) <= PLACE_LINK_M and name_words(tags.get("name")) & name_words(place["name"]) for point, place in places)
        areas.append({"kind": kind, "name": tags.get("name"), "sport": tags.get("sport"), "show_label": bool(tags.get("name")) and not labelled,
                      "outline": rounded(outline[:-1])})

    osm_trees = [geo.to_map([lat, lon])[0] for lat, lon, tags in nodes.values() if tags.get("natural") == "tree"]
    osm_trees = [xy for xy in osm_trees if context.contains(Point(xy))]
    paths = [geo.to_map(w["latlon"]) for w in ways if w["tags"].get("highway")]
    blocked = unary_union(
        [f.buffer(4) for f in footprints]
        + [Polygon(a["outline"]).buffer(2) for a in areas if a["kind"] != "grass"]
        + [LineString(p).buffer(4) for p in paths if len(p) > 1]
        + [Polygon(s["outer"]).buffer(5) for b in massing["buildings"] for st in b["storeys"] for s in st["parts"]])
    grass = [Polygon(a["outline"]).buffer(0) for a in areas if a["kind"] == "grass"]
    extra = scatter_trees(grass, blocked, osm_trees)

    # Where OSM puts Ramanujan relative to M. George, against our bridge-based placement.
    osm_mg = Polygon(geo.to_map(by_name["Muthoot M George Block"]["latlon"]))
    osm_ram = Polygon(geo.to_map(by_name["Ramanujan Block, Muthoot Institute of Technology"]["latlon"]))
    storeys = {b["name"]: b["storeys"] for b in massing["buildings"]}
    our_mg = Polygon(next(s for s in storeys["M. George Block"] if s["floor"] == 3)["parts"][0]["outer"])
    our_ram = Polygon(next(s for s in storeys["Ramanujan Block"] if s["floor"] == "R4")["parts"][0]["outer"])
    print(f"gap M. George - Ramanujan: OSM {osm_mg.distance(osm_ram):.1f} m, our map {our_mg.distance(our_ram):.1f} m; "
          f"Ramanujan centres {osm_ram.centroid.distance(our_ram.centroid):.1f} m apart")

    result = {
        "schema_version": 1,
        "attribution": "© OpenStreetMap contributors",
        "licence": "ODbL 1.0, https://www.openstreetmap.org/copyright",
        "source": str(SOURCE.relative_to(ROOT)),
        "built": date.today().isoformat(),
        "geo": {
            "lat0": geo.lat0, "lon0": geo.lon0,
            "matrix": geo.matrix.round(6).tolist(), "shift": geo.shift.round(3).tolist(),
            "note": "map_xy = matrix @ [east_m, north_m] + shift; east/north metres from (lat0, lon0)",
            "fit_median_m": round(fit["median_m"], 2), "fit_p90_m": round(fit["p90_m"], 2),
        },
        "boundary": rounded(campus.exterior.coords[:-1]),
        "buildings": buildings,
        "areas": areas,
        "trees": [{"xy": rounded([xy])[0], "decorative": False} for xy in osm_trees]
                 + [{"xy": rounded([(p.x, p.y)])[0], "decorative": True} for p in extra],
    }
    OUTPUT.write_text(json.dumps(result, separators=(",", ":")))
    counts = {}
    for b in buildings:
        counts[b["kind"]] = counts.get(b["kind"], 0) + 1
    print(f"buildings {counts}; areas {[a['kind'] for a in areas]}; trees {len(osm_trees)} mapped + {len(extra)} decorative")
    for b, polygon in zip(buildings, polygons):
        if b["name"]:
            print(f"  {b['name']:32s} {b['kind']:8s} {b['levels']} storey(s){' (estimated)' if b['levels_estimated'] else ''}"
                  f"{'  roof only' if b['roof_only'] else ''} at ({polygon.centroid.x:.0f}, {polygon.centroid.y:.0f}) -> place {b['place_id']}")
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
