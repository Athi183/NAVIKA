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
- **Position:** Ramanujan is placed by the bridge alone (its door 15 m west of
  M. George's, turned to face it). **The bridge length is a guess (15 m);
  measure it on site** and set `BRIDGE_LENGTH_M`.
- Room numbers run one ahead of the floor (5xx on the Fourth Floor, 6xx on
  the Fifth), as in the drawings. Floor names follow the drawings.

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
  Other campus buildings are only labels on the campus plan, so they appear as
  labels, not blocks.
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

- **Only that route**, always from the kiosk. There is no place picker and no
  other source on the phone.
- The visitor sees the overview first (3D, summary, steps), taps **Start**,
  then goes through the steps with **Next step**. While walking, the 3D view
  follows the current step like a phone map: only that step's floors, the
  camera behind the walker looking along the step, the person walking just
  that stretch, the rest of the route faint (`follow` in `MGeorgeBuilding3D`,
  `stepStretch` in `mgeorgeRoute.js`). There is no indoor positioning, so the
  visitor moves on with **Next step**. On the last step the button
  becomes **I have arrived · Stop**. After stopping, the link shows "You have
  arrived" even if reopened on that phone.
- **The link expires 45 minutes** after the QR code was opened on the kiosk
  (`PHONE_LINK_MINUTES` in `mgeorgeRoute.js`). The screen stays awake while
  walking.
- The phone must be able to reach the kiosk's web address. If the kiosk opens
  the app as `localhost`, set `VITE_NAVIKA_BASE_URL` in `frontend/.env.local`
  to the kiosk's network address (for example `http://192.168.1.20:5173`) or
  the deployed site; the kiosk shows a setup warning until then.
- The expiry is checked on the phone from the link, so it stops casual reuse
  but is not a security control: someone could edit the time in the URL.

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
- **Ramanujan Block:** measure the bridge (15 m assumed) and confirm both
  bridge doors on site.
- **Campus:** the Auditorium is only a label on the campus plan, so its route
  ends on the nearest path. Gates and the security cabin
  are not labelled. Outdoor routes only leave through the main entrance.
  The 3D campus view has blocks for M. George and Ramanujan only; it places
  the campus ground at the main entrance (First Floor) level, so M. George's
  Ground Floor sits below it.
- **Ask NAVIKA hand-off:** a "Show me the way" button in the assistant that
  opens `/navigation?to=<id>`.
