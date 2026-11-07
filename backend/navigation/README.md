# Weighted indoor navigation

`costs.py` defines abstract configurable defaults: walking `1`, one staircase
floor transition `2`, and one continuous lift ride `1`. These scores are not
distances or travel-time estimates. `dijkstra.py` returns the ordered node path,
typed edges, connector transitions, and total cost, or an explicit
`no_route`/`invalid_endpoint` result.

`campus_graph.py` reads the confirmed vertical mapping data from
`public/data/campus_vertical_connections.json`. It preserves the mapped
Ground–1–2–3–4–5–6 Lift A/B and Staircase A/B/C chains. For lifts it creates direct
ride edges between stops in the same connected mapped lift component; stair
edges remain adjacent-floor transitions. It adds no guessed horizontal edges.

The current campus graph is therefore a connector-only graph, not a complete
room-to-room campus graph. Room labels, doorway candidates, and floor geometry
are present elsewhere, but the source does not provide verified walkable
room-to-corridor, corridor-junction, or corridor-to-landing edges. Calls that
need those links correctly return `no_route` until reviewed walkable edges are
added.

`tools/generate_walkable_campus_graph.py` adds semantic place nodes for Ground Floor and Floors
1–6, reports available room-region evidence and nearby wall-gap candidates,
and combines those nodes with the confirmed vertical graph. Candidate gaps stay
review-only. Walking edges enter the routeable graph only from
`walkable_connections_review.json` after they have explicit verification,
provenance, evidence, and a CAD path that does not intersect extracted walls.
The generated graph and audit are written to
`public/data/campus_walkable_graph.json` and
`public/data/campus_walkable_graph_review.json`.

## Reviewing candidate door gaps

Regenerate the review candidate data, then serve the repository with Vite and
open `/review/walkable-connections.html`:

```bash
python3 backend/navigation/tools/generate_walkable_campus_graph.py
npm run dev
```

The local review page shows the candidate in the source CAD plan, its two
supporting wall segments, nearby semantic labels, room-boundary suggestions,
and nearby mapped connector landings. Candidate associations stay suggestions.
To approve a connection, inspect the plan, select the room or connector it
serves, enter or reuse a corridor junction ID and its CAD point, provide
reviewer/evidence notes, and inspect the path through the opening. Save as
verified and download `walkable_connections_review.json`; replace
`backend/navigation/walkable_connections_review.json` with that reviewed file.
Pending or rejected records never create routeable edges. The generator also
checks the submitted path endpoints and rejects any segment intersecting an
extracted wall.

Regenerate the graph and review the audit after each batch of decisions:

```bash
python3 backend/navigation/tools/generate_walkable_campus_graph.py
python3 backend/navigation/tools/query_campus_route.py f4:place:room_501 f4:place:room_502
```

The query exits with a no-route result until the reviewed graph has a complete
path. Do not mark a candidate verified merely because the path passes the wall
intersection check; the opening, served place/landing, and corridor point must
also be confirmed by a human against the floor plan.

Run the abstract cost and connector tests from the repository root:

```bash
python3 -m unittest backend.navigation.test_weighted_dijkstra -v
python3 -m unittest backend.navigation.test_walkable_graph -v
python3 backend/navigation/tools/generate_walkable_campus_graph.py
```
