#!/usr/bin/env python3
"""Ground heights for the 3D campus view: measured spot heights, with public
elevation tiles for the shape of the ground between them.

Measured spots (data/campus_levels/spot_heights.json, made with --template):
the team reads air pressure with a phone barometer app at each spot, starting
and ending at the main entrance. Height above the entrance =
29.27 m/K x (T + 273.15) x ln(P_entrance / P_spot), with P_entrance drifting
linearly between the entrance readings (weather changes during the walk). A
spot can also give height_m directly (e.g. counted stair steps x 0.15 m).

Satellite tiles: AWS Terrain Tiles ("terrarium" PNGs, zoom 15, about 4.7 m per pixel,
resampled from SRTM about 30 m), cached in data/original_sources/campus/terrain/
(--download refreshes them). They are a surface model, so trees and large
roofs bump them up; heights are smoothed over SMOOTH_M to keep the shape of the
hill rather than every bump, and are good to a few metres at best.

They date from 2000 (before the campus) and include trees, so on their own
they are wrong by up to about 12 m at the buildings. The measured spots are
taken as the truth: the tiles are corrected by the spots' differences,
spread by inverse-distance weighting, so the result passes through the spots
and keeps the tiles' shape in between. The view uses the terrain once
MIN_SPOTS spots are measured ("ready"); until then it stays flat.

Heights are relative to the main entrance (0 = the campus ground the 3D view
already uses, level with M. George's First Floor). Map metres are turned into
GPS with the inverse of the OpenStreetMap fit in campus_osm.json.

Writes frontend/public/data/campus_terrain.json: a grid from origin_xy (south-
west corner), cell_m apart, rows going north, heights in centimetres.

    PYTHONPATH=scripts .venv/bin/python scripts/build_campus_terrain.py --template   # spot list + field sheet
    PYTHONPATH=scripts .venv/bin/python scripts/build_campus_terrain.py              # after filling it in
"""
from __future__ import annotations

import argparse
import json
import math
import re
from datetime import datetime
import urllib.request
from pathlib import Path

import matplotlib.image as mpimg
import numpy as np
from scipy import ndimage
from shapely.geometry import Point, Polygon

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "frontend/public/data"
TILES = ROOT / "data/original_sources/campus/terrain"
OUTPUT = DATA / "campus_terrain.json"
ZOOM = 15
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
CELL_M = 5.0
SMOOTH_M = 15.0
MARGIN_M = 60.0
LEVELS = ROOT / "data/campus_levels"
SPOTS = LEVELS / "spot_heights.json"
SHEET = LEVELS / "spot_sheet.md"
MIN_SPOTS = 8               # measured spots (besides the entrance) before the view uses the terrain
SCALE_M_PER_K = 29.27       # R / g for dry air: metres of height per kelvin per unit ln(pressure)


def tile_path(x, y):
    return TILES / f"terrarium_{ZOOM}_{x}_{y}.png"


def global_pixel(lat, lon):
    """Web Mercator pixel position at ZOOM (256 pixels per tile)."""
    n = 2 ** ZOOM * 256
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


class Elevation:
    """Heights in metres from the cached tiles, by bilinear interpolation."""

    def __init__(self, download=False):
        self.tiles = {}
        self.download = download

    def tile(self, x, y):
        if (x, y) not in self.tiles:
            path = tile_path(x, y)
            if self.download or not path.exists():
                TILES.mkdir(parents=True, exist_ok=True)
                request = urllib.request.Request(TILE_URL.format(z=ZOOM, x=x, y=y), headers={"User-Agent": "navika-campus-map/1.0"})
                path.write_bytes(urllib.request.urlopen(request, timeout=60).read())
            rgb = mpimg.imread(path)[..., :3].astype(float) * 255
            self.tiles[(x, y)] = rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
        return self.tiles[(x, y)]

    def at(self, lat, lon):
        px, py = global_pixel(lat, lon)
        px, py = px - 0.5, py - 0.5  # pixel centres
        x0, y0 = math.floor(px), math.floor(py)
        fx, fy = px - x0, py - y0
        value = lambda gx, gy: self.tile(gx // 256, gy // 256)[gy % 256, gx % 256]
        top = value(x0, y0) * (1 - fx) + value(x0 + 1, y0) * fx
        bottom = value(x0, y0 + 1) * (1 - fx) + value(x0 + 1, y0 + 1) * fx
        return top * (1 - fy) + bottom * fy


def map_to_latlon(geo):
    """Inverse of the OpenStreetMap fit: map metres -> (lat, lon)."""
    inverse = np.linalg.inv(np.array(geo["matrix"]))
    shift = np.array(geo["shift"])
    lat0, lon0 = geo["lat0"], geo["lon0"]

    def convert(xy):
        east, north = inverse @ (np.asarray(xy, dtype=float) - shift)
        return lat0 + north / 110574, lon0 + east / (111320 * math.cos(math.radians(lat0)))
    return convert


def suggested_spots(site, osm):
    """Places a visitor would recognise, spread over the campus, with their map positions."""
    entrance = site["links"][0]["site_xy"]
    spots = [{"id": "entrance", "name": "Main entrance, just outside the doors. Read here FIRST and LAST.", "xy": entrance,
              "readings": [{"time": "", "pressure_hpa": None}, {"time": "", "pressure_hpa": None}]}]
    for place in site["destinations"]:
        if place["name"] == "Ramanujan Block":  # an outdoor label by the bridge; its own door is asked for below
            continue
        spots.append({"id": place["id"], "name": f"{place['name']}: at its door or edge, on the ground", "xy": place["xy"],
                      "readings": [{"time": "", "pressure_hpa": None}]})
    for building in osm["buildings"]:
        if building["name"] and not building["place_id"]:
            spots.append({"id": "osm_" + building["id"], "name": f"{building['name']}: at its main door", "xy": np.mean(building["outline"], axis=0).round(2).tolist(),
                          "readings": [{"time": "", "pressure_hpa": None}]})
    for area in osm["areas"]:
        # Areas the campus plan already names (show_label false) are in the list once, above.
        if area["name"] and area.get("show_label") and area["kind"] != "parking":
            spots.append({"id": "osm_area_" + re.sub(r"\W+", "_", area["name"].lower()), "name": f"{area['name']}: centre", "xy": np.mean(area["outline"], axis=0).round(2).tolist(),
                          "readings": [{"time": "", "pressure_hpa": None}]})
    spots.append({"id": "mgeorge_ground_floor_door", "name": "M. George Ground Floor: where it opens to the outside (write where, or give lat/lon)", "xy": None,
                  "where": "", "lat": None, "lon": None, "readings": [{"time": "", "pressure_hpa": None}]})
    spots.append({"id": "ramanujan_ground_door", "name": "Ramanujan Block: its lowest outside door (write where, or give lat/lon)", "xy": None,
                  "where": "", "lat": None, "lon": None, "readings": [{"time": "", "pressure_hpa": None}]})
    return spots


def write_template(site, osm):
    LEVELS.mkdir(parents=True, exist_ok=True)
    spots = suggested_spots(site, osm)
    SPOTS.write_text(json.dumps({
        "how_to": [
            "Use any phone app that shows air pressure in hPa (for example Physics Toolbox Sensor Suite). Use the same phone all walk.",
            "Hold the phone at waist height, wait about 10 seconds for the number to settle, then write the time (HH:MM) and the pressure.",
            "Start at the entrance, visit the spots in any order, and end at the entrance again (this corrects for the weather).",
            "Finish within about an hour. Skip a spot rather than guess. height_m can be given instead of pressure when it is known (e.g. stair steps x 0.15 m).",
        ],
        "temperature_c": 30,
        "spots": spots,
    }, indent=1))
    rows = "\n".join(f"| {s['id']} | {s['name']} |  |  |" for s in spots)
    SHEET.write_text(f"""# NAVIKA campus spot heights: field sheet

Phone app showing air pressure (hPa), same phone all walk. Start and end at the
entrance. At each spot: phone at waist height, wait 10 s, write time and hPa.

| Spot | Where | Time (HH:MM) | Pressure (hPa) |
|---|---|---|---|
{rows}
| entrance | Main entrance again (LAST) |  |  |

Temperature today (°C): ______  Phone / app: ______  Walker: (not needed)
""")
    print(f"wrote {SPOTS.relative_to(ROOT)} and {SHEET.relative_to(ROOT)} ({len(spots)} spots)")


def minutes(text):
    return datetime.strptime(text.strip(), "%H:%M").hour * 60 + datetime.strptime(text.strip(), "%H:%M").minute


def measured_heights(osm):
    """Measured spots as [(id, xy, height above the entrance)], from pressures or given heights."""
    if not SPOTS.exists():
        return []
    sheet = json.loads(SPOTS.read_text())
    scale = SCALE_M_PER_K * (sheet.get("temperature_c", 30) + 273.15)
    spots = sheet["spots"]
    entrance = next(s for s in spots if s["id"] == "entrance")
    reference = sorted((minutes(r["time"]), r["pressure_hpa"]) for r in entrance["readings"] if r.get("pressure_hpa") and r.get("time"))

    def reference_at(t):
        if len(reference) == 1:
            return reference[0][1]
        return float(np.interp(t, [r[0] for r in reference], [r[1] for r in reference]))

    to_map = lambda lat, lon: None
    if osm.get("geo"):
        geo = osm["geo"]
        def to_map(lat, lon):
            east = (lon - geo["lon0"]) * 111320 * math.cos(math.radians(geo["lat0"]))
            north = (lat - geo["lat0"]) * 110574
            return (np.array(geo["matrix"]) @ [east, north] + np.array(geo["shift"])).tolist()
    result = [("entrance", entrance["xy"], 0.0)]
    for spot in spots:
        if spot["id"] == "entrance":
            continue
        xy = spot.get("xy") or (to_map(spot["lat"], spot["lon"]) if spot.get("lat") and spot.get("lon") else None)
        if not xy:
            continue
        if spot.get("height_m") is not None:
            result.append((spot["id"], xy, float(spot["height_m"])))
            continue
        heights = [scale * math.log(reference_at(minutes(r["time"])) / r["pressure_hpa"])
                   for r in spot.get("readings", []) if r.get("pressure_hpa") and r.get("time") and reference]
        if heights:
            result.append((spot["id"], xy, float(np.mean(heights))))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--download", action="store_true", help="refresh the cached elevation tiles")
    parser.add_argument("--template", action="store_true", help="write the spot list and field sheet (data/campus_levels/)")
    args = parser.parse_args()

    osm = json.loads((DATA / "campus_osm.json").read_text())
    site = json.loads((DATA / "MGeorge_nav/site_graph.json").read_text())
    massing = json.loads((DATA / "campus_massing.json").read_text())
    if args.template:
        if SPOTS.exists():
            raise SystemExit(f"{SPOTS.relative_to(ROOT)} already exists; delete it first to start again")
        write_template(site, osm)
        return
    to_latlon = map_to_latlon(osm["geo"])
    elevation = Elevation(download=args.download)

    # The same area the OpenStreetMap layer draws ground under.
    points = osm["boundary"] + [p for b in osm["buildings"] for p in b["outline"]] + [p for a in osm["areas"] for p in a["outline"]]
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    x0, y0 = min(xs) - MARGIN_M, min(ys) - MARGIN_M
    cols = int((max(xs) + MARGIN_M - x0) / CELL_M) + 1
    rows = int((max(ys) + MARGIN_M - y0) / CELL_M) + 1
    raw = np.array([[elevation.at(*to_latlon((x0 + c * CELL_M, y0 + r * CELL_M))) for c in range(cols)] for r in range(rows)])
    smooth = ndimage.gaussian_filter(raw, SMOOTH_M / CELL_M, mode="nearest")

    def height(xy):
        c, r = (xy[0] - x0) / CELL_M, (xy[1] - y0) / CELL_M
        return float(ndimage.map_coordinates(smooth, [[r], [c]], order=1, mode="nearest")[0])

    entrance = site["links"][0]["site_xy"]
    reference = height(entrance)
    satellite = smooth - reference

    # Correct the satellite heights to the measured spots: each spot's difference,
    # spread by inverse-distance weighting (exact at the spots, an average far away).
    spots = measured_heights(osm)
    measured = [s for s in spots if s[0] != "entrance"]
    grid_x = x0 + np.arange(cols) * CELL_M
    grid_y = y0 + np.arange(rows) * CELL_M
    gx, gy = np.meshgrid(grid_x, grid_y)
    report = []
    if measured:
        weights_sum = np.zeros_like(gx)
        correction = np.zeros_like(gx)
        for spot_id, xy, measured_h in spots:
            residual = measured_h - (height(xy) - reference)
            report.append((spot_id, measured_h, height(xy) - reference, residual))
            weight = 1 / np.maximum(np.hypot(gx - xy[0], gy - xy[1]), 1.0) ** 2
            weights_sum += weight
            correction += weight * residual
        heights = satellite + correction / weights_sum
    else:
        heights = satellite

    if report:
        print(f"measured spots: {len(measured)} (the view uses the terrain from {MIN_SPOTS})")
        print("  spot                               measured  satellite  satellite error")
        for spot_id, measured_h, satellite_h, residual in report:
            print(f"  {spot_id:34s} {measured_h:+8.1f} m {satellite_h:+8.1f} m {-residual:+9.1f} m")
        errors = np.array([r[3] for r in report if r[0] != "entrance"])
        print(f"  satellite terrain vs measured: RMSE {math.sqrt(float(np.mean(errors ** 2))):.1f} m, worst {np.max(np.abs(errors)):.1f} m")
        ramanujan = next((r for r in report if r[0] == "ramanujan_ground_door"), None)
        if ramanujan:
            print(f"  Ramanujan lowest door measured {ramanujan[1]:+.1f} m; the model puts its Ground Floor at 0.0 m "
                  f"(Second Floor level with M. George's Third). A difference of about 3.3 m means STOREY_OFFSET is off by a floor.")
    else:
        print(f"no measured spots yet: the view stays flat until {MIN_SPOTS} are measured (--template makes the spot list)")
    def final(xy):
        c, r = (xy[0] - x0) / CELL_M, (xy[1] - y0) / CELL_M
        return float(ndimage.map_coordinates(heights, [[r], [c]], order=1, mode="nearest")[0])

    campus = Polygon(osm["boundary"])
    inside = np.array([[campus.contains(Point(x0 + c * CELL_M, y0 + r * CELL_M)) for c in range(cols)] for r in range(rows)])
    print(f"grid {cols} x {rows} at {CELL_M:.0f} m; entrance ground {reference:.1f} m above sea level (SRTM)")
    print(f"inside the campus boundary: {heights[inside].min():+.1f} to {heights[inside].max():+.1f} m from the entrance")
    for building in massing["buildings"]:
        outline = Polygon(building["storeys"][0]["parts"][0]["outer"])
        corners = [final(p) for p in outline.exterior.coords]
        print(f"  {building['name']:22s} ground {min(corners):+.1f} to {max(corners):+.1f} m, centre {final(outline.centroid.coords[0]):+.1f} m")
    for b in osm["buildings"]:
        if b["name"]:
            centre = np.mean(b["outline"], axis=0)
            print(f"  {b['name']:22s} centre {final(centre):+.1f} m")
    for a in osm["areas"]:
        if a["name"]:
            print(f"  {a['name']:22s} centre {final(np.mean(a['outline'], axis=0)):+.1f} m")

    OUTPUT.write_text(json.dumps({
        "schema_version": 1,
        "source": "Measured spot heights (data/campus_levels/spot_heights.json), with AWS Terrain Tiles (terrarium, zoom 15, from SRTM) between them",
        "attribution": "Terrain: campus spot heights; SRTM via AWS Terrain Tiles",
        "ready": len(measured) >= MIN_SPOTS,
        "measured_spots": len(measured),
        "reference": "0 = ground at the main entrance (the campus ground level of the 3D view)",
        "entrance_above_sea_m": round(reference, 2),
        "smoothing_m": SMOOTH_M,
        "origin_xy": [round(x0, 2), round(y0, 2)],
        "cell_m": CELL_M, "cols": cols, "rows": rows,
        "order": "row-major from origin_xy (south-west), rows go north",
        "heights_cm": [int(round(h * 100)) for h in heights.ravel()],
    }, separators=(",", ":")))
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
