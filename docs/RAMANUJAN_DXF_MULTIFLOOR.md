# Ramanujan Block DXF floors 2–6

## Current visualization

`/navigation` displays the supplied multi-floor DXF as a 3D exploded stack with source/destination selection and a separate stacked or individual 2D plan view. The frontend data is generated at `frontend/src/data/ramanujan_floors_2_6.json`; the 3D view is `frontend/src/components/navigation/MultiFloorNavigation3D.jsx`, and the 2D viewer is `frontend/src/components/navigation/MultiFloorDxfViewer.jsx`. Both use DXF linework, block contents, and text labels only. IFC/Revit geometry is not part of this view.

The source drawing is read-only. Its printed floor titles identify floors 2–6. Each plan is registered horizontally by translating its printed title Y coordinate to the fifth-floor title coordinate. This preserves each floor’s DXF X/Y distances; the registration is a candidate because the drawing contains no surveyed cross-floor control points. The 6 m spacing in the exploded 3D view is diagrammatic, not a measured floor elevation. Wall height is also an illustrative 3 m extrusion because no verified heights are supplied by the DXF.

Repeated `UP` labels yield three candidate stair links across floors 2–6. The east-side `LIFT` label repeats on floors 2–6. A second, centrally placed lift label appears only on floors 2–4, so the view does not create center-lift stops on floors 5–6. Source and destination selections draw an explicitly unverified visual path via a labelled connector; this is not a corridor-following route planner. The DXF alone does not establish door openings, landing geometry, continuous shafts, operational status, accessible routing, or verified navigation connectivity.

## Regenerate from a DXF

The processor accepts an explicit source path and output paths, and leaves the input unchanged:

```bash
backend/navigation/venv/bin/python backend/navigation/tools/process_multifloor_dxf.py \
  "/path/to/floors.dxf" \
  --building-id EXAMPLE_BLOCK \
  --output frontend/src/data/ramanujan_floors_2_6.json \
  --preview NAVIKA_FLOOR_05_GOLD/diagnostics/ramanujan_dxf_floors_2_6_preview.png
```

For another DXF with floor titles using the same ordinal naming convention and separated plan bands, pass its path, set `--building-id`, and choose an output file. The processor currently expects titles for floors 2–6; adapt the floor-title selection when the floor range or title scheme differs. Review the generated preview and connector alignment before using the data. This workflow does not create or certify cross-floor route graphs.

## Review artifacts

- Generated data: `frontend/src/data/ramanujan_floors_2_6.json`
- Static extraction preview: `NAVIKA_FLOOR_05_GOLD/diagnostics/ramanujan_dxf_floors_2_6_preview.png`
- Processor: `backend/navigation/tools/process_multifloor_dxf.py`

The visualization intentionally labels connectors as candidates and keeps floor stack spacing and plan registration assumptions visible in the UI.
# Spatial CSV and RAG lookup

The extracted floor data is also exported as CSV files under [`rag/data/spatial/ramanujan_block`](../rag/data/spatial/ramanujan_block/README.md). The set contains semantic label candidates, candidate connector topology, unclassified DXF geometry, and per-floor summaries. `rag/spatial_lookup.py` reads these files directly for room/floor and coordinate queries, while `rag/app.py` adds matching structured facts to the RAG answer context. `rag/ingest.py` includes the compact semantic and connector rows in future vector-store rebuilds.

Room labels in the 3D view are enabled by default. Use the **Label floor** selector to show one floor’s labels at a time; source and destination labels remain visible across floors. The selector avoids stacking every room name on top of the model simultaneously.

When both endpoints are selected, the 3D scene now frames and renders only the source and destination floor plates; it shows the chosen candidate stair/lift transitions between them. **Start navigation on phone** creates a QR link carrying the selected endpoints and connector into `/navigation`. For an on-campus phone scan during local development, set `VITE_NAVIKA_BASE_URL` to the computer’s reachable LAN URL. The QR opens a route preview; it does not provide live indoor positioning. Travel time stays unavailable until horizontal paths, distances, and lift-wait assumptions are verified.

The CSVs do not establish room boundaries, entrances, horizontal walkable links, or verified pedestrian routes. The 18 vertical links are candidate transitions only and require review before use for real navigation.
