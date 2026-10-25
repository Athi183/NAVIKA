# Ramanujan Block DXF spatial data

These CSVs are derived from `ramanujan block -2nd floor to 6th floor (1).dxf` for floors 2–6. DXF text and linework are extracted evidence; labels, coordinate registration, and connector continuity remain candidates until reviewed against the drawing/site.

## Files

| File | Rows | Contents |
|---|---:|---|
| `places.csv` | 110 | Extracted text labels with floor, source DXF anchor, registered plan anchor, and review status. Anchors are not room polygons, doors, or entrances. |
| `topology_nodes.csv` | 133 | 110 label anchors plus candidate stair/lift landing markers. Label anchors are explicitly not routable access nodes. |
| `topology_edges.csv` | 18 | Candidate consecutive-floor stair/lift transitions with explicitly assumed distance/time fields. No horizontal corridor edges are inferred. |
| `geometry.csv` | 5,076 | Extracted line segments, including source and registered endpoints. They are unclassified drawing linework, not validated walls or walkable regions. |
| `floor_summaries.csv` | 5 | Per-floor counts, bounds, units, and diagrammatic elevations. |

## Coordinate and confidence notes

- `source_*` fields preserve coordinates in the source DXF coordinate system. `registered_*` / `x*` fields use the current title-based floor alignment, which is marked as a candidate transform.
- `places.csv` retains both `registered_x/y` (the extracted text insertion) and `display_x/y` (the visualization anchor). Six room labels whose DXF anchors fell west of all floor-plan linework use a candidate group shift into the plan footprint; `display_xy_status` records those adjustments. Check these against the drawing before treating them as surveyed room centroids.
- Units are taken from the processed drawing metadata. Elevations and 3D floor spacing are diagrammatic, not measured building heights.
- Rows retain `review_status`, `verification_status`, or `accessibility_status` fields. An empty access node is intentional until an entrance is reviewed.
- Do not use candidate links as pedestrian directions or claim accessibility from these files.
- Candidate time costs use a 3.2 m storey rise, 35° stair angle, 0.55/0.65 m/s stair speeds, 1.5 m/s lift speed, and 25 s lift wait once per trip. These are planning defaults, not measured Ramanujan Block data. Horizontal routes and actual lift wait are unknown.

## Retrieval

`rag/ingest.py` embeds compact place, candidate-connection, and floor-summary records when rebuilding the FAISS index. It deliberately does not embed thousands of line segments. `rag/spatial_lookup.py` reads the CSVs directly for exact label, floor-pair, and coordinate bounding-box queries, and `rag/app.py` adds matching structured facts to the answer context.

Regenerate data after processing the DXF:

```bash
python backend/navigation/tools/process_multifloor_dxf.py --building-id RAMANUJAN_BLOCK
python backend/navigation/tools/export_spatial_csv.py
```

Rebuild the RAG index from the `rag/` directory (with the project's RAG dependencies installed):

```bash
cd rag && python ingest.py
```

`doorway_review_candidates.csv` is generated separately by `backend/navigation/tools/build_candidate_navigation_graph.py`. It lists geometric gaps and the three nearest suggestions for each room label. These suggestions are not route edges and require manual confirmation. The graph scaffold is `frontend/src/data/ramanujan_navigation_graph_candidate.json`; it currently has zero verified horizontal edges.
