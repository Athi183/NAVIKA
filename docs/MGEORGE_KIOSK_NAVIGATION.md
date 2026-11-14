# M. George kiosk navigation

The kiosk stands at reception on the M. George Block entrance level and is the
fixed start of every route. Visitors pick a destination by typing or by
category; the app shows the shortest walking route (Dijkstra) in 3D, with a
person walking it, and step-by-step directions.

## Which floor is this?

Reception, the main entrance and Tagore Library are on the level that both the
DXF and `MG FIRST.pdf` call **First Floor**. The DXF level below it is labelled
**Ground Floor**. Everyday speech may call the entrance level "ground floor";
the data files keep the drawing's name.

## Pipeline

```text
college plans 3 (1).dxf ──┐
                          ├─ scripts/build_mgeorge_nav_graph.py ─┬─ frontend/public/data/MGeorge_nav/floor_01_walkable_graph.json
data/navigation/          │                                      ├─ frontend/public/data/MGeorge_nav/floor_01_walls.json
  mgeorge_floor01_        ┘                                      └─ inspection_navigation/mgeorge_floor01_walkable_preview.png (--preview)
  destinations.json
```

1. **Units.** The DXF declares no units. Door block scales (75–120), notes such
   as `TREAD - 30 C.M` and room sizes such as `974x680` show it is in
   centimetres. (The older `MGeorge_DXF` extraction assumed millimetres, so its
   distances are 10× too small.)
2. **Obstacles.** Walls, windows, stairs, fixtures and solid hatches are drawn
   onto a 10 cm grid. The plan window reaches past the library semicircle.
3. **Doors** come from the drawing's 93 door blocks (`A$C764D24B9`,
   `A$C67844AE1`). Each opening is cut through the wall. Gaps in walls are not
   guessed to be doors.
4. **Walkable area.** These are free cells at least 25 cm from any obstacle
   (passages ≥ 50 cm), inside the building footprint, that can be reached from
   the kiosk.
5. **Graph.** The walkable area is thinned to its centreline. Short spurs are
   pruned and the result is simplified into about 440 nodes and 480 edges, with
   weights in metres.
6. **Destinations.** Each one is snapped to the nearest graph node it can see
   without crossing a wall.

7. **Rooms (for the 3D model).** All 93 doors are shut by drawing a line across
   each opening. Free space is then shrunk by 1.2 m, so any opening narrower
   than 2.4 m separates two rooms, and each room is grown back inside its own
   walls. Each room is coloured by the destinations inside it, using the
   Ramanujan viewer's palette: yellow for labs, classrooms and halls; teal for
   offices, departments and the library; purple for stairs, lifts and fire
   exits; blue for toilets. A room with no destination is grey corridor if the
   kiosk can walk through it, or a slab opening (hole) if only corridor
   surrounds it, like the lobby atrium. The output is `floor_01_rooms.png`,
   a top-down floor texture, plus `floor_01_rooms.json`, which lists each
   room's type, area, bounding box and destinations.

The 3D model, [MGeorgeFloorModel3D.jsx](../frontend/src/components/navigation/MGeorgeFloorModel3D.jsx),
follows the Ramanujan viewer's style: dark scene, 2.8 m brick walls, coloured
room floors and floating labels. Labels use the bundled
`frontend/public/fonts/NotoSans-Bold.ttf` (SIL OFL), so they also work offline.
Open it with **Explore the floor in 3D** on the destination screen, or at
`/navigation?explore=1`. Tapping a room name opens the route to that room. The
route's own 3D tab uses the same model.

In the browser, [mgeorgeRoute.js](../frontend/src/services/mgeorgeRoute.js)
runs Dijkstra. It then straightens the route by line-of-sight checks against
the exported walkable mask, and turns the result into directions that only
announce real turns.

## Destinations

The names and numbers in
[mgeorge_floor01_destinations.json](../data/navigation/mgeorge_floor01_destinations.json)
come from the `MG FIRST.pdf` legend. Positions come from the DXF. Each entry
has a `confidence`:

- `high`: the DXF label and the PDF agree.
- `medium`: matched by position, but the DXF uses an older or generic name.
- `low`: the PDF shows partitions that the DXF does not; the position is an
  estimate.

`entrance_xy` sends the route to a reviewed entrance instead of the room label.
It is used where the DXF has no walkable entrance, for example the Gents Toilet.

**Before going live, walk the low and medium destinations on site** and correct
`xy` / `entrance_xy`. Also confirm the kiosk's exact standing position
(`kiosk.xy`). Then rebuild.

## All floors

The DXF sheet holds all five floors (Ground to Fourth), each drawn at a
different spot on the sheet. `FLOOR_OFFSETS` in the build script moves every
floor onto floor 1. The offsets come from the structural grid bubbles that
repeat on each floor, and were checked by sliding each floor's walls and
columns over floor 1; both methods agree within 20 cm. Floor 3 has no grid
bubbles, so its offset comes from the walls alone. All floors share floor 1's
coordinates in metres, so they stack exactly in 3D.

- **Destinations.** Floor 1 uses the reviewed names from `MG FIRST.pdf`.
  Floors 0, 2, 3 and 4 use names generated from the DXF labels, for example
  Chemistry Lab, Principal Room, CAD Lab and Classroom 2 (east wing). They are
  saved to `data/navigation/mgeorge_floorNN_destinations.json` the first time
  the script runs, all marked `low` confidence. **Edit those files** when the
  current room-use plans arrive; the script never overwrites them.
- **Stairs and lifts.** These come from the DXF labels (`MAIN STAIR`,
  `STAIR WELL`, `LIFT`, `FIRE LIFT`, `BED LIFT`, `FIRE ESCAPE STAIR`).
  `building.json` pairs them across adjacent floors by position, within 8 m for
  stairs and 3 m for lifts. Each staircase or lift is named after the floor-1
  place nearby. Fire escape stairs are recorded but never used for routes.
- **Stairs and lifts in normal use** are listed in
  [`data/navigation/mgeorge_connectors_in_use.json`](../data/navigation/mgeorge_connectors_in_use.json).
  These are the three main staircases, the main lift (corridor) and the west wing
  lift, confirmed by the project team. Routes use only these, under the names
  in that file. Every other stair or lift in the drawing stays in
  `building.json` with `routable: false`, and the kiosk does not offer them.
- **Reachability flags.** The build marks each destination `reachable` and
  `step_free` (lifts only). The kiosk hides places the stairs and lifts in use
  cannot reach (currently only the Ground Floor Staff room). For places with no
  lift access it says "only by stairs".
- **Travel cost** is measured as metres of walking, so Dijkstra can mix it with
  corridors:
  - one storey of stairs = 18 m (about 15 s);
  - a lift = 18 m to board + 18 m to leave (about 30 s waiting in total), plus
    4 m per storey.

  **"Lifts only"** in the kiosk drops the stairs. The display spacing between
  stacked floors is not the real storey height; the real height is taken as
  3.3 m (22 risers × 15 cm).
- **Floors without the kiosk** keep the walkable area connected to their stairs
  and lifts. Pockets smaller than 30 m², such as lift cars, are ignored, so each
  lift attaches to its lobby.

The kiosk lists every floor's places with a floor filter. Routes are shown in
3D only:
- all the floors the route passes through are stacked, and the blue route line
  climbs at the stairs or lift;
- a walking figure follows the route, and the walked part turns grey behind it;
- steps read like "Take Staircase 1 (central) up to the Third Floor".

**Explore the building in 3D** shows one floor at a time, or **All floors**
stacked (`/navigation?explore=1&floor=all`).

## Campus (outdoor paths)

`scripts/build_campus_nav_graph.py` builds the outdoor network from
`data/original_sources/campus/COLLEGE PLAN VARNAM.dxf` and writes
`frontend/public/data/MGeorge_nav/site_graph.json`.

- **Same coordinates as indoors.** The campus plan was converted from a PDF, so
  its units can't be trusted. It also draws an outline of the M. George Block,
  rotated about 180°. The script fits that outline onto the floor-1 walls
  (iterative closest point: scale, rotation and shift; median fit about 1.3 m),
  which puts the whole campus in the indoor frame.
- **Walkable outdoors** is a band around the plan's roads, driveways, footpaths
  and paving. Each road's two edge lines are merged into one band, and the
  result is thinned to its centreline like the indoor floors. The plan draws
  paths in pieces, so pieces closer than 40 m are joined by short walkways.
  M. George's footprint is kept out.
- **Outdoor places** come from the plan's labels: Ramanujan Block, Canteen,
  Workshop, hostels, Auditorium, the courts and parking. A label marks the
  building, not its door, so routes end on the nearest path (confidence `low`).
- **Joining indoors and outdoors:** the main entrance is linked to the nearest
  outdoor path. A route can leave the building ("Go out through the main
  entrance") and continue outside, at the entrance floor's level in 3D.

## Ramanujan Block (over the bridge)

Floors 4, 5 and 6 of Ramanujan Block are routed too, using Fathima Mehrin's
floor data in `ramanujan-viewer/public/data/Ramanujan_F4..F6` (walls, room
names and positions, room outlines), aligned by her `stackedFloorConfig.ts`.
`scripts/build_ramanujan_nav_graph.py` only reads that folder.

- **How visitors get there:** the bridge from the M. George **Third Floor**
  (the floor above Visvesvaraya Hall, west end of the main corridor) to
  Ramanujan's **Second Floor**, where the multi-floor Ramanujan DXF labels a
  3.08 m opening between Turing Lab and Caeser Lab "CONNECTION BRIDGE".
  Ramanujan stands lower, so its floor N is level with M. George's floor N + 1
  (`STOREY_OFFSET`; `stack_level` in its building.json keeps the bridge flat
  in 3D). A route reads, for example: *"Take Staircase 2 (west wing) up to the
  Third Floor, then cross the bridge into Ramanujan Block (its Second Floor),
  then take Lift A up to the Fifth Floor."*
- **Ramanujan's Second Floor** comes from the multi-floor DXF and is only
  walked through, from the bridge to the stairs and lifts. Its rooms are not
  offered. The Third Floor is not drawn; stairs and lifts pass through it.
- **Stairs and lifts:** Lift A, Lift B and Staircases A, B and C, all in
  normal use (project team).
- **Places:** 59 on floors 4-6, named as in Mehrin's data with the room number
  added, e.g. *S5/S6 CSE-A Class Room (601)*, so searching "601" works.
  Rooms are coloured from her room outlines.
- **Position:** Ramanujan is placed by the bridge alone (its door
  `BRIDGE_LENGTH_M` west of M. George's, turned to face it). The bridge is not
  measured: it was 15 m until OpenStreetMap's outlines put the two buildings
  8.5 m apart, so it is now 10 m (our map: 8.4 m apart). **Measure it on site**
  and set `BRIDGE_LENGTH_M`, then rebuild Ramanujan, the IFC pilot, the storey
  outlines and the OSM layer (see Commands).
- Room numbers run one ahead of the floor (5xx on the Fourth Floor, 6xx on
  the Fifth), as in the drawings. Floor names follow the drawings.

## IFC pilot (Ramanujan Fifth Floor)

`scripts/pilot_ifc_floor.py` tests whether the IFC models can improve the map.
On `ram_5th.ifc` (66 walls, 19 doors, 1 slab; no rooms, stairs or lifts):

- **The IFC was modelled about 19% too small.** It fits our Fifth Floor
  (Mehrin's CAD) only when scaled by 1.232; then it is a quarter turn off,
  with IFC walls a median 0.10 m from ours (90% within 0.28 m), covering 89%
  of our wall lines. The CAD stays the reference for sizes.
- **Door check:** the route into 10 rooms crosses their boundary at a real IFC
  door. Rooms 611/612 and 613 are entered 1.5-2.7 m away from their doors
  (probably a gap in the CAD walls, not a door); the Electrical Room has no
  IFC door. Toilets, stairs and lifts have no room outline to check.
- **3D model:** the IFC walls, doors and slab, fitted into our frame, are
  written as `Ramanujan_nav/floor_R5_ifc.glb` (63 KB) and linked from
  `building.json` (`ifc_model`). Open `/navigation?floor=R5&walls=ifc` to see it
  in place of the CAD walls; the kiosk default is unchanged.
- Report: `Ramanujan_nav/floor_R5_ifc.json`; picture:
  `inspection_navigation/ifc_pilot_R5.png`.

```bash
PYTHONPATH=scripts .venv/bin/python scripts/pilot_ifc_floor.py \
  data/original_sources/ramanujan_floor5/ram_5th.ifc R5 --preview inspection_navigation/ifc_pilot_R5.png
```

## What visitors see

The kiosk is a wide (landscape) touch screen at reception, used by one visitor
at a time.

- **It opens on the map.** The 3D view starts on the visitor's own floor (M.
  George First Floor) with "You are here". Search and popular places sit above
  the map; on the right, building tabs (**Whole campus**, **M. George Block**,
  **Ramanujan Block**) and lift-style floor buttons (4, 3, 2, 1 · You, G, All).
- **Whole campus** shows M. George and Ramanujan as 3D buildings at real
  height (one block per storey, with a darker band at each floor level), the
  bridge between them, the campus paths and the outdoor places. Tapping a
  building opens it. Outlines come from `scripts/build_campus_massing.py`
  (`frontend/public/data/campus_massing.json`). Ramanujan's Ground, First and
  Third Floors are not drawn, so they borrow the outline of the floor above.
  Around them, from OpenStreetMap (next section): the hostels, labs, canteen,
  cafe and the open-air auditorium roof, grass, sports pitches, parking,
  ponds, trees and the campus boundary. Tapping a building that is also a
  campus place (the canteen, Ladies Hostel...) chooses that place.
- **Stacked floors** (the **All** button, and routes that change floor) show
  the lifts and stairs in use the way Mehrin's Ramanujan viewer draws them:
  see-through shafts with doors at each floor, and switchback stairs with
  handrails. The ones on the route turn blue. Sizes are typical, not measured
  (`frontend/src/components/navigation/VerticalCores.jsx`).
- **Tap any room** on the map (the room itself, not only its name), or pick a
  place from search or the popular list: the map switches to its building and
  floor, drops a pin, and a card shows the time, distance and **Show me the
  way**. A tap never jumps straight to a route.
- **Zoom in / out** and **Back to me** buttons sit on the map for visitors who
  do not drag or pinch.
- **The route screen:** one plain sentence (e.g. *"Take the main lift
  (corridor) up to the Second Floor. Principal is about 2 min away."*), the
  distance and time, the steps, the 3D walker, and **Send to my phone**.
- **Thank you** (top right on every screen) ends the visitor's turn: a short
  thank-you message, then everything resets for the next person. The kiosk
  also resets after 90 seconds without a touch. A presence sensor can later
  trigger the same reset.

## On the phone (QR code)

Every route screen on the kiosk has a **Send to my phone** button that opens a
large QR code. Scanning it opens
`/route?to=<id>&until=<unix time>` (plus `lifts=1` for a lifts-only route) on
the visitor's phone:

- **Only that route**, from the kiosk (or from where the visitor re-routes
  outside, below). There is no place picker on the phone.
- The visitor sees the overview first (3D, summary, steps), taps **Start**,
  then goes through the steps with **Next step**. While walking, the 3D view
  follows the current step like a phone map: only that step's floors, the
  camera behind the walker looking along the step, the person walking just
  that stretch, the rest of the route faint (`follow` in `MGeorgeBuilding3D`,
  `stepStretch` in `mgeorgeRoute.js`). Indoors the phone's motion sensors
  track the visitor along the route (next section); without them the visitor
  moves on with **Next step**. On stairs, lifts, the bridge and the entrance
  the button confirms the change ("I'm on the Third Floor", "I'm outside").
  On the last step the button
  becomes **I have arrived · Stop**. After stopping, the link shows "You have
  arrived" even if reopened on that phone.
- **Live location outside.** On routes that go outside, the phone watches GPS
  after **Start** (it asks permission once):
  - a blue dot with its accuracy circle, snapped onto the path while the
    visitor follows it (`locateOnRoute`), converted with the OpenStreetMap fit
    (`latLonToMap`);
  - reaching a later step's path moves the steps on by themselves (only with a
    fix better than 25 m, so indoor GPS never does);
  - more than 25 m (or 1.5x the fix's error) off the path shows "You seem to
    be off the path" and **Re-route from here**, which plans a new route from
    the nearest campus path in sight (`siteStart`, `routeFrom`);
  - without permission, without GPS or on plain `http://` it says so and the
    visitor uses **Next step** as before. Browsers only give GPS to `https://`
    pages (and `localhost`), so it needs the deployed site.
- **The link expires 45 minutes** after the QR code was opened on the kiosk
  (`PHONE_LINK_MINUTES` in `mgeorgeRoute.js`). The screen stays awake while
  walking.
- The phone must be able to reach the kiosk's web address. If the kiosk opens
  the app as `localhost`, set `VITE_NAVIKA_BASE_URL` in `frontend/.env.local`
  to the kiosk's network address (for example `http://192.168.1.20:5173`) or
  the deployed site; the kiosk shows a setup warning until then.
- The expiry is checked on the phone from the link, so it stops casual reuse
  but is not a security control: someone could edit the time in the URL.

## Indoor tracking (route-anchored) and the research study

Inside, GPS is tens of metres off and has no floor, so the phone tracks the
visitor's **progress along the planned route** from its motion sensors, with
no app and no beacons (`frontend/src/services/indoorTracker.js`, used by
`hooks/useIndoorTracking.js`):

- **Steps** (the bounce in the accelerometer) move the dot one stride along
  the route; the steps move on by themselves as the dot reaches them.
- **Corners:** a turn of 50° or more (the gyroscope's rotation about the
  vertical) snaps the dot to the route's nearest unused corner, which resets
  the error the steps build up.
- **Stride:** outside, GPS snapped to the path against the steps counted
  teaches the visitor's own stride (kept between 0.45 and 0.95 m; 0.70 m until
  learned).
- **Floors:** stairs, lifts, the bridge and the entrance are confirmed with
  one tap; a tapped step also re-anchors the dot at its start.
- Needs the https site; iPhones ask permission on **Start**. Without motion
  sensors the phone says so and the visitor taps **Next step**.

**Research mode.** Add `&research=1` to a phone route link. While walking, a
panel shows what is recorded and offers **Mark spot N** (tap when standing on
numbered spot N) and **Save log** (a JSON file on the phone: the route, raw
motion readings, GPS fixes, step changes and marks; nothing about the person).

**Running the study:**

1. Choose 30-50 spots along 3-4 routes (gate to M. George, across the bridge,
   up to Ramanujan rooms), number them, and write `spots.json` with each true
   position: map metres, a place id or a graph node id, e.g.
   `{"1": {"place": "mg1_tagore_library"}, "2": {"node": "MG01_N0123"}}`.
2. Each walker opens the route link with `&research=1`, taps **Start**,
   walks normally, taps **Mark spot** on each spot, and saves the log. Use
   several people and phones (Android and iPhone). Ask for consent first.
3. Compare the methods on the same walks:

   ```bash
   cd frontend
   node scripts/replay-walk.mjs spots.json walk1.json walk2.json ...   # --json for raw numbers
   ```

   It reports the error (mean, median, 90th percentile, max) at the marked
   spots for: GPS, free step-and-heading dead reckoning (`--turn-sign=-1` if
   the phones report turns the other way), steps along the route, + corner
   snapping, and the full method with the stride learned outdoors.

`npm test` checks the tracker on simulated walks
(`frontend/scripts/synthetic-walk.mjs`). On an 87 m simulated corridor the
mean error falls from about 6 m (free dead reckoning) to 4 m (on the route),
1.4 m (+ corners) and 0.3 m (+ learned stride). **These are simulations that
check the code, not results;** only the campus walks give real numbers.

## OpenStreetMap layer and GPS

`scripts/build_campus_osm.py` reads OpenStreetMap data for the campus, cached
in `data/original_sources/campus/osm_mits_campus.osm` (`--download` refreshes
it), and writes `frontend/public/data/campus_osm.json`.

- **Licence:** OSM data is ODbL. Wherever the layer is drawn the map shows
  "© OpenStreetMap contributors" (the kiosk map does, bottom right).
- **Fit:** OSM's M. George outline is fitted onto ours (rotation, scale,
  shift): median 1.1 m apart, 90% within 5.4 m. The same fit turns GPS into
  map metres: `latLonToMap(model.osm, lat, lon)` in `mgeorgeRoute.js`, for a
  future outdoor blue dot. Check it once on site at the main entrance.
- **Buildings:** M. George and Ramanujan stay from the CAD drawings. The rest
  come from OSM; only M. George and Ramanujan have floor counts there, so the
  others are estimates (hostels 4, labs, canteen and cafe 1).
- **Place links** pair a building with a campus place by shared name words
  (girls = ladies, workshop = lab) within 60 m. **To confirm on site:** New
  Hostel is linked to the plan's "Hostel Block" and Men's Hostel to nothing.
- **Trees:** 27 mapped in OSM, plus about 150 decorative ones spaced over
  the grass (marked `decorative`), not surveyed.

## Deploying for feedback (Vercel)

Navigation runs entirely in the browser (static files, routes worked out on
the device), so the website alone can be hosted free on Vercel:

1. Sign in at vercel.com with the GitHub account that owns the repo, **Add
   New → Project**, import `NAVIKA`.
2. **Root Directory:** `frontend`. Vercel detects Vite (build `npm run build`,
   output `dist`). Leave the other settings as they are.
3. Deploy. Every push to `main` redeploys; other branches get preview links.

`frontend/vercel.json` sends paths such as `/navigation` and `/route?...` to the
app, so links opened directly (QR codes, refreshes) work.
`VITE_NAVIKA_BASE_URL` is not needed there: QR links use the site's own
address, and over https they open on any phone (mobile data too) and can keep
the screen on. The local `.env.local` is git-ignored and never uploaded.

Ask NAVIKA needs its Python backend (torch, sentence-transformers, FAISS,
Groq; about 2-3 GB of memory), which Vercel cannot run. Until it is hosted
(e.g. a Hugging Face Docker Space, with `GROQ_API_KEY` as a secret, and
`VITE_API_BASE_URL` set on Vercel to its address), the Ask NAVIKA page cannot
answer on the deployed site.

## Commands

```bash
# rebuild every floor, building.json and the review images
.venv/bin/python scripts/build_mgeorge_nav_graph.py --preview-dir inspection_navigation

# outdoor campus paths (run after the floors; needs floor 1's walls and rooms)
PYTHONPATH=scripts .venv/bin/python scripts/build_campus_nav_graph.py --preview inspection_navigation/campus_walkable_preview.png

# Ramanujan Block floors 4-6 and the bridge (run after the M. George floors)
PYTHONPATH=scripts .venv/bin/python scripts/build_ramanujan_nav_graph.py --preview-dir inspection_navigation

# storey outlines for the 3D campus view (run after both buildings)
PYTHONPATH=scripts .venv/bin/python scripts/build_campus_massing.py

# OpenStreetMap layer and GPS fit (after the storey outlines)
PYTHONPATH=scripts .venv/bin/python scripts/build_campus_osm.py

# one floor only (no building.json)
.venv/bin/python scripts/build_mgeorge_nav_graph.py --floor 1 --preview inspection_navigation/mgeorge_floor01_walkable_preview.png

# check every destination on every floor is reachable, normally and lifts-only
cd backend/navigation && ../../.venv/bin/python test_mgeorge_building.py && ../../.venv/bin/python test_mgeorge_graph.py

# open a route directly (also usable from the assistant or a QR code)
http://localhost:5173/navigation?to=mg1_tagore_library
```

The earlier Ramanujan, M. George and campus visualisations are still available
at `/navigation?view=indoor|mgeorge|campus`.

## Not done yet

- **Ground Floor:** the DXF is out of date (parking where the PDF shows rooms),
  so its room names are not imported and the Staff room is hidden. Needs a DXF
  or IFC export of `GROUND FLOOR.rvt`.
- **On-site checks:** the exact kiosk position; the First Floor Gents Toilet
  entrance, Admission Cell and Students Activity Center; PDF room positions
  (expected within about 2 m); the real storey height (3.3 m assumed).
- **Ramanujan Block:** measure the bridge (10 m from OpenStreetMap, not
  measured) and confirm both bridge doors on site.
- **Campus:** the Auditorium is only a label on the campus plan, so its route
  ends on the nearest path. Gates and the security cabin
  are not labelled. Outdoor routes only leave through the main entrance.
  The 3D campus view has blocks for M. George and Ramanujan only; it places
  the campus ground at the main entrance (First Floor) level, so M. George's
  Ground Floor sits below it.
- **Ask NAVIKA hand-off:** a "Show me the way" button in the assistant that
  opens `/navigation?to=<id>`.
