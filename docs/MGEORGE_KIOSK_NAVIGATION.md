# M. George kiosk navigation

The kiosk stands at reception on the M. George Block entrance level and is the
fixed start of every route. Visitors pick a destination by typing or by
category; the app draws the shortest walking route (Dijkstra) on a 2D plan or
in 3D, with step-by-step directions.

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

## Commands

```bash
# rebuild graph, walls and review image after editing the destinations file
.venv/bin/python scripts/build_mgeorge_nav_graph.py --preview inspection_navigation/mgeorge_floor01_walkable_preview.png

# check every destination is reachable with a sane distance
cd backend/navigation && ../../.venv/bin/python test_mgeorge_graph.py

# open a route directly (also usable from the assistant or a QR code)
http://localhost:5173/navigation?to=mg1_tagore_library        # add &map=3d for the 3D view
```

The earlier Ramanujan, M. George and campus visualisations are still available
at `/navigation?view=indoor|mgeorge|campus`.

## Not done yet

- Only the entrance level is routed. Upper floors and stair/lift transitions
  come next.
- Students Activity Center (PDF no. 12) is not placed; its entrance is unknown.
- An IFC export with rooms (`IfcSpace`) and doors would let the room outlines
  and doors come from the model instead of the DXF.
