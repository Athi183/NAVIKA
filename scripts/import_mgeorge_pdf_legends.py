#!/usr/bin/env python3
"""Place the room names from the M. George room-use PDFs onto the floor plans.

Each PDF (MG FIRST.pdf, MG SECOND FLOOR.pdf, ...) is a parallel-projection 3D
render with numbered rooms and a legend. A parallel projection maps the floor
plane to the page by an affine transform, so a few known rooms per floor are
enough to convert every numbered label into plan coordinates (metres, floor 1
frame, as used by scripts/build_mgeorge_nav_graph.py).

* The linear part comes from MG FIRST.pdf, fitted against the reviewed floor-1
  positions (median error ~1.6 m). Floors 1, 3 and 4 were rendered with the
  same camera; floor 2 sits on a smaller A1 sheet, so each floor gets its own
  translation, fitted from rooms whose DXF label matches the PDF legend.
* The Ground Floor PDF uses a different zoom and its DXF plan is out of date
  (car parking where the PDF shows rooms), so it is not imported here.

Writes data/navigation/mgeorge_floorNN_destinations.json for floors 2-4 and
updates the low-confidence floor-1 positions listed in FLOOR1_UPDATES.
"""
from __future__ import annotations

import json
import re
import subprocess
from html import unescape
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT / "data/original_sources/m_george"
DEST = ROOT / "data/navigation/mgeorge_floor{floor:02d}_destinations.json"

PDFS = {1: "MG FIRST.pdf", 2: "MG SECOND FLOOR.pdf", 3: "MG BLOCK - THIRD FLOOR.pdf", 4: "MG FOURTH FLOOR.pdf"}
FLOOR_LABELS = {2: "Second Floor", 3: "Third Floor", 4: "Fourth Floor"}

# Staircase positions from the DXF (floor 1 frame), shared by floors 1-4.
STAIRS = {"west": (-44.5, 11.2), "central": (12.4, 25.0), "east": (48.5, 2.6)}
# PDF legend number -> plan position of the same room from its DXF label.
ANCHORS = {
    2: {8: (-34, 17), 13: (-34, 1), 7: (-34, 29), 12: (-34, -12), 15: (-7, 22),
        9: STAIRS["west"], 16: STAIRS["central"], 28: STAIRS["east"]},
    3: {15: (-33, 26), 3: (-57, 14), 13: (-34, 0), 17: (-5, 22),
        9: STAIRS["west"], 19: STAIRS["central"], 29: STAIRS["east"]},
    4: {20: (-5, 21), 10: STAIRS["west"], 21: STAIRS["central"]},
}
# Floor-1 places whose first-pass position was a guess; the PDF places them.
FLOOR1_UPDATES = {7, 8, 16, 17, 18, 19, 25}

KEEP_UPPER = {"CE", "ME", "ECE", "IEDC", "MITS", "VLSI", "RF", "APJ", "CAD", "IEE", "CIDRIE", "II"}
TYPOS = {"DEPARTENT": "DEPARTMENT", "ACADAMIC": "ACADEMICS", "STAIRCASE1": "STAIRCASE 1"}


def pdf_words(pdf):
    html = subprocess.run(["pdftotext", "-bbox", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
    return [{"x0": float(a), "y0": float(b), "x1": float(c), "y1": float(d), "t": unescape(t)}
            for a, b, c, d, t in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', html)]


def parse_pdf(pdf):
    """Legend {number: name} and plan labels [(number, u, v)] in PDF points."""
    words = pdf_words(pdf)
    rows = {}
    for w in words:
        rows.setdefault(round(w["y0"]), []).append(w)
    entries, used = [], set()
    for y in sorted(rows):
        row = sorted(rows[y], key=lambda w: w["x0"])
        i = 0
        while i < len(row):
            m = re.match(r"^(\d{1,2})\.(.*)$", row[i]["t"])
            if not m:
                i += 1
                continue
            parts, j = [m.group(2)] if m.group(2) else [], i + 1
            while j < len(row) and not re.match(r"^\d{1,2}\.", row[j]["t"]) and row[j]["x0"] - row[j - 1]["x1"] < 60:
                parts.append(row[j]["t"])
                j += 1
            name_x0 = row[i + 1]["x0"] if not m.group(2) and i + 1 < j else row[i]["x0"]
            entries.append({"n": int(m.group(1)), "name": " ".join(parts), "x0": row[i]["x0"], "name_x0": name_x0,
                            "x1": row[j - 1]["x1"], "y0": row[i]["y0"], "y1": row[i]["y1"]})
            used.update(id(w) for w in row[i:j])
            i = j
    # Wrapped names: plain upper-case words just below an entry, indented to its name.
    height = np.median([e["y1"] - e["y0"] for e in entries]) if entries else 30
    for w in sorted(words, key=lambda w: (w["y0"], w["x0"])):
        if id(w) in used or not w["t"].isupper():
            continue
        # Legend text boxes overlap from line to line, so compare line tops: the
        # nearest entry whose top is one line above, in the same column, owns it.
        above = [e for e in entries if 0 < w["y0"] - e["y0"] <= 1.6 * height and e["x0"] <= w["x0"] <= e["x1"] + 200]
        if above:
            owner = min(above, key=lambda e: (w["y0"] - e["y0"], abs(w["x0"] - e["name_x0"])))
            owner["name"] += " " + w["t"]
            used.add(id(w))
    legend = {e["n"]: e["name"].strip() for e in entries}
    boxes = [(e["x0"] - 5, e["y0"] - 5, e["x1"] + 200, e["y1"] + height) for e in entries]
    labels = [(int(w["t"]), (w["x0"] + w["x1"]) / 2, (w["y0"] + w["y1"]) / 2) for w in words
              if re.fullmatch(r"\d{1,2}", w["t"]) and id(w) not in used and w["y0"] > 180
              and not any(x0 <= w["x0"] <= x1 and y0 <= w["y0"] <= y1 for x0, y0, x1, y1 in boxes)]
    return legend, labels


def label_positions(labels):
    out = {}
    for n, u, v in labels:
        out.setdefault(n, []).append((u, v))
    return out


def fit_linear_and_floor1():
    """Affine map for MG FIRST.pdf from the reviewed floor-1 positions; drops outliers."""
    cfg = json.loads(Path(str(DEST).format(floor=1)).read_text())
    _, labels = parse_pdf(PDF_DIR / PDFS[1])
    pos = label_positions(labels)
    pairs = [(d["pdf_no"], pos[d["pdf_no"]][0], d["xy"]) for d in cfg["destinations"]
             if d["pdf_no"] in pos and len(pos[d["pdf_no"]]) == 1 and d["confidence"] in ("high", "medium") and d["category"] != "lift"]
    use = pairs
    for _ in range(3):
        A = np.array([[u, v, 1] for _, (u, v), _ in use])
        M, *_ = np.linalg.lstsq(A, np.array([xy for *_, xy in use]), rcond=None)
        errors = [np.linalg.norm(np.array([u, v, 1]) @ M - np.array(xy)) for _, (u, v), xy in pairs]
        use = [p for p, e in zip(pairs, errors) if e <= 4.0]
    print(f"floor 1: affine from {len(use)} reviewed rooms, median error {np.median([e for e in errors if e <= 4]):.2f} m")
    return M


def floor_translation(M, floor, pos):
    linear = M[:2]
    rows = [(n, np.array(pos[n][0]), np.array(xy)) for n, xy in ANCHORS[floor].items() if n in pos and len(pos[n]) == 1]
    t = np.median([xy - uv @ linear for _, uv, xy in rows], axis=0)
    errors = [np.linalg.norm(uv @ linear + t - xy) for _, uv, xy in rows]
    print(f"floor {floor}: shift from {len(rows)} anchor rooms, errors {', '.join(f'{e:.1f}' for e in errors)} m")
    return np.vstack([linear, t])


def tidy(name):
    words = [TYPOS.get(w, w) for w in name.replace("-", " - ").split()]
    text = " ".join(w if w in KEEP_UPPER or w.strip("()") in KEEP_UPPER else w.title() for w in words)
    text = re.sub(r"\b(Of|And|For)\b", lambda m: m.group(1).lower(), text.replace(" - ", "-").replace("( ", "("))
    return re.sub(r"\(([a-z]+)\)", lambda m: f"({m.group(1).upper()})", text)


def category(name):
    n = name.upper()
    rules = [
        ("PASSAGE", None), ("STAIRCASE", "stairs"), ("LIFT", "lift"), ("FIRE EXIT", "exit"),
        ("TOILET", "toilet"), ("ENTRANCE", "entrance"), ("LOBBY", "circulation"),
        ("LIBRARY", "library"), ("DEPARTMENT", "department"), ("DEPARTENT", "department"),
        ("CAFETERIA", "food"), ("DINING", "food"),
        ("SERVER ROOM", "service"), ("ELECTRICAL", "service"), ("MAINTENANCE", "service"),
        ("COMMON ROOM", "facility"), ("PRAYER", "facility"), ("WELLNESS", "facility"), ("IEDC", "facility"), ("FITNESS", "facility"),
        ("CLASS ROOM", "classroom"), ("TUTORIAL", "classroom"),
        ("LAB", "lab"), ("WORKSHOP", "lab"),
        ("HALL", "hall"), ("BOARD ROOM", "hall"),
    ]
    for key, cat in rules:
        if key in n:
            return cat
    return "office"


def wing_of(x):
    return "west wing" if x < -27 else "east wing" if x > 27 else "centre"


def floor_destinations(floor, M):
    legend, labels = parse_pdf(PDF_DIR / PDFS[floor])
    pos = label_positions(labels)
    T = floor_translation(M, floor, pos)
    names = {n: tidy(t) for n, t in legend.items()}
    repeated = {t for t in names.values() if list(names.values()).count(t) > 1}
    found = []
    for n, raw in sorted(legend.items()):
        cat = category(raw)
        if cat is None or n not in pos:
            continue
        base = names[n] if names[n] not in repeated or cat in ("stairs", "lift", "exit") else f"{names[n]} {n}"
        for u, v in pos[n]:
            x, y = np.array([u, v, 1.0]) @ T
            found.append({"pdf_no": n, "name": base, "category": cat, "xy": [round(float(x), 2), round(float(y), 2)]})
    # One legend number used for two rooms: tell them apart by wing, or as
    # A/B (west to east) when both are in the same wing.
    groups = {}
    for f in found:
        groups.setdefault(f["name"], []).append(f)
    for name, twins in groups.items():
        if len(twins) < 2:
            continue
        wings = [wing_of(f["xy"][0]) for f in twins]
        for i, f in enumerate(sorted(twins, key=lambda f: f["xy"][0])):
            f["name"] = f"{name} ({wing_of(f['xy'][0])})" if len(set(wings)) == len(wings) else f"{name} {'ABCD'[i]}"
    destinations = [{
        "id": f"mg{floor}_pdf{f['pdf_no']:02d}{'' if i == 0 else chr(97 + i)}",
        "pdf_no": f["pdf_no"], "name": f["name"], "category": f["category"], "xy": f["xy"],
        "confidence": "medium",
        "note": f"Name and position from {PDFS[floor]} (legend no. {f['pdf_no']}); position via affine fit, about +/-2 m.",
    } for f in found for i in [sum(1 for g in found[:found.index(f)] if g["pdf_no"] == f["pdf_no"])]]
    return {
        "schema_version": "navika-destinations-0.1",
        "building": "M. George Block",
        "floor_number": floor,
        "floor_label": FLOOR_LABELS[floor],
        "coordinate_system": "metres in floor 1's frame (see FLOOR_OFFSETS in scripts/build_mgeorge_nav_graph.py); x east, y north",
        "sources": {"names": f"data/original_sources/m_george/{PDFS[floor]} (current room-use legend)",
                    "positions": "PDF label positions mapped to the plan by scripts/import_mgeorge_pdf_legends.py"},
        "kiosk": None,
        "destinations": destinations,
        "not_placed": [],
    }


def write_config(path, cfg):
    """One destination per line, as the reviewed floor-1 file is laid out."""
    head = {k: v for k, v in cfg.items() if k not in ("destinations", "not_placed")}
    body = ",\n    ".join(json.dumps(d, ensure_ascii=False) for d in cfg["destinations"])
    rest = ",\n    ".join(json.dumps(d, ensure_ascii=False) for d in cfg.get("not_placed", []))
    text = json.dumps(head, indent=2, ensure_ascii=False)[:-2] + f',\n  "destinations": [\n    {body}\n  ],\n  "not_placed": [\n    {rest}\n  ]\n}}\n'
    json.loads(text)
    path.write_text(text)


def main():
    M = fit_linear_and_floor1()
    for floor in (2, 3, 4):
        cfg = floor_destinations(floor, M)
        write_config(Path(str(DEST).format(floor=floor)), cfg)
        print(f"  wrote {len(cfg['destinations'])} destinations for the {FLOOR_LABELS[floor]}")

    path = Path(str(DEST).format(floor=1))
    cfg = json.loads(path.read_text())
    _, labels = parse_pdf(PDF_DIR / PDFS[1])
    pos = label_positions(labels)
    for d in cfg["destinations"]:
        if d["pdf_no"] in FLOOR1_UPDATES and d["pdf_no"] in pos:
            u, v = pos[d["pdf_no"]][0]
            x, y = np.array([u, v, 1.0]) @ M
            d["xy"] = [round(float(x), 2), round(float(y), 2)]
            d["confidence"] = "medium"
            d["note"] = f"Position from MG FIRST.pdf legend no. {d['pdf_no']} (affine fit, about +/-2 m)."
    write_config(path, cfg)
    print(f"  floor 1: moved {len(FLOOR1_UPDATES)} first-pass positions to their PDF positions")


if __name__ == "__main__":
    main()
