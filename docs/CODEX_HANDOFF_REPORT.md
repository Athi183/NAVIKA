# NAVIKA 3D — Methodology and Workflow Handoff

**Purpose:** give a new Codex agent enough context to continue the work without treating unverified CAD interpretation as ground truth.  
**Repository:** `navika-3d`  
**Snapshot:** 28 October 2026.  
**Evidence used:** current source/data files, recent commit history, and the live Git working tree. Earlier historical details are limited to what is represented in Git and the project documentation.

## 1. Project context

NAVIKA began as a campus assistance and indoor-navigation project. Its original scope includes a React/Vite frontend demo, Python graph-routing foundations, a voice interaction pipeline, and a FAISS/Groq retrieval assistant. The current repository has two frontend tracks:

- `frontend/`: the earlier React demo for assistant, 2D map navigation, QR/mobile route sharing, and an experimental 3D view.
- Root `src/` and root `package.json`: the active TypeScript/React Three Fiber 3D floor-plan viewer.

Recent work is concentrated on turning source CAD (DXF) plans for Ramanujan Block Floors 3–6 into explicit geometry and semantic data that the root 3D viewer can render. The committed history indicates Floor 3 semantic labeling predates the recent Floor 4/5/6 expansion. The active working tree continues improving wall extraction, room floor fills, semantic labels, and vertical connector data.

## 2. Working principles and methodology

1. **Keep source geometry and interpretation separate.** CAD-derived wall segments live in `public/data/Ramanujan_F*/walls.json`; named places live in `semantics.json`; validated floor fills live in `floor_regions.json`. Viewer behavior belongs in `src/App.tsx`, and repeatable transformations belong in `scripts/`.
2. **Preserve CAD coordinates.** Geometry is expressed in source CAD XY units. The viewer converts each floor to its own local frame with `x = cadX - minX`, `z = -(cadY - minY)`. Floor-local frames are not globally aligned.
3. **Make extraction deterministic and auditable.** Scripts record plan bounds, entity counts, excluded entity types/handles, and duplicate removal. Keep source DXFs and inspection artifacts available; do not manually edit generated wall arrays when the extraction script can reproduce them.
4. **Treat visual/semantic interpretation as a hypothesis to verify.** Match semantic positions against geometry, inspect previews and audit JSON, and avoid silently filling areas unsupported by walls. Door openings, symbols, text, dimensions, and duplicate CAD linework can look like walls in naive extraction.
5. **Fail closed when evidence is weak.** The floor-region generator only emits a candidate if the semantic point is inside it, each edge has some wall support, and average boundary coverage passes the threshold. It excludes overlapping polygons and records excluded IDs. Unmatched places get no floor fill and render using neutral fallback behavior.
6. **Keep routing readiness distinct from visualization.** Connector correspondences do not establish traversable routes. Landing-to-corridor links, global alignment, storey elevations, and vertical travel costs must be verified before claiming multi-floor route readiness.
7. **Review artifacts visually and structurally.** Use generated previews and the JSON audit files alongside code-level checks. A successful script run alone does not prove a wall or room has been interpreted correctly.

## 3. Current data pipeline

### A. Inspect source drawing

The inspection artifacts under `inspection_navigation/` include per-floor DXF inspection JSON and previews, wall previews, semantic previews/zoom previews, and targeted fragment audits. Use these to establish the plan window, source coordinates, likely wall entities, and possible non-wall fragments before changing extraction rules.

### B. Extract walls

`scripts/extract_floor_walls.py` reads DXF `LINE`, `LWPOLYLINE`, and `POLYLINE` entities, restricts extraction to an explicit XY bounding box, drops segments below a configurable minimum length, rejects bulged polylines rather than flattening curves, and removes exact duplicate segments while retaining distinct paired wall faces. It writes a normalized wall JSON with source metadata and extraction diagnostics.

The current uncommitted code adds a Floor 4 exception for ten audited entity handles associated with door-opening fragments. The adjacent comment explains that these entities otherwise extrude as isolated full-height posts; two are exact duplicate source lines. See `inspection_navigation/floor4_door_fragment_audit.json`. Do not generalize handle exclusions across other source files without inspecting their entity handles and context.

### C. Maintain semantic places

Each floor's `semantics.json` maps stable IDs and labels/types to CAD coordinates (and optionally room numbers). Those coordinates drive text placement and floor-region matching. The viewer has per-floor display-name/layout overrides in `src/App.tsx`; these are presentation choices, while semantic source names and IDs remain in JSON. Preserve ID stability because floor regions reference semantic IDs.

### D. Generate and validate floor regions

`scripts/generate_floor_regions.py` defines candidate room/space bounds for Floors 4–6 and uses room dimensions plus semantic anchors for Floor 4. It samples all four rectangle edges against extracted wall segments, requiring at least 5% support on each edge and 65% average coverage, with a 0.35 CAD-unit wall tolerance. It checks that the semantic anchor lies inside the candidate and rejects intersecting regions. Accepted polygons are inset by 0.18 units to reduce wall overlap and written to each floor's `floor_regions.json`; `inspection_navigation/floor_region_validation.json` records wall coverage and exclusions.

Floor 3 currently has wall data but its generated floor region file has no regions. Do not infer that Floor 3 floor coloring is complete merely because it has semantic labels and walls.

### E. Render in Three.js

The root viewer in `src/App.tsx` loads the floor JSON, renders wall geometry and semantic labels, and creates region meshes. Semantic types map to colors. The current working tree includes an explicit `excel_hall` color override and small display label adjustments. Keep display overrides understandable and avoid changing source semantics just to achieve presentation effects.

### F. Build vertical connector inventory

The in-progress `scripts/generate_vertical_connector_graph.py` finds connector semantics (`staircase`, `vertical_transport`) on Floors 4–6, assigns floor-specific node IDs, pairs matching named connectors on adjacent floors, and emits `public/data/campus_vertical_connections.json`. The generated file explicitly marks semantic anchor positions as unverified landing positions and connector-to-corridor access as unverified. Edges have no configured weights; global alignment and multi-floor rendering are disabled. This is an inventory/scaffold, not a route graph ready for navigation.

## 4. Current repository state

### Committed recent milestones

Recent commits, newest first, show this progression:

- `3d1ace2` — render semantic room floor colors.
- `a5767e9` — add wall-checked room floor regions.
- `9988634` — add Floor 5 rooms to the 3D viewer.
- `4ffe5f7` — extract Floor 5 wall geometry from CAD.
- `71a8b1f` — add Floor 4 wall and room data.
- Earlier commits added Floor 6 files, organized inspection data, corrected its data directory name, and added Floor 3 semantic labels.

This suggests the workflow has been iterative: add/inspect one floor, extract wall data, align semantic places and display labels, validate candidate room regions against walls, then extend the renderer. It is not evidence that every CAD feature has been field-verified.

### Uncommitted work at snapshot

The working tree is not clean. Existing edits belong to the user/work in progress; inspect them before changing or reverting anything. At snapshot, modified files include:

- `scripts/extract_floor_walls.py`, `scripts/generate_floor_regions.py`, `src/App.tsx`;
- wall/semantic/floor-region JSON on Floors 4–6;
- `inspection_navigation/floor_region_validation.json`.

New files include:

- `scripts/generate_vertical_connector_graph.py`;
- `public/data/campus_vertical_connections.json`;
- `inspection_navigation/floor4_door_fragment_audit.json` and `floor6_wall_fragment_audit.json`.

The generated vertical graph currently reports 15 connector nodes, 10 adjacent-floor edges, and 0 unmatched connector pairs. Every edge/node is still explicitly marked unverified for landing/access; do not interpret zero unmatched as physical alignment proof.

Current checked-in data counts from the JSON files:

| Floor | Wall segments | Semantic places | Generated room regions | Neutral fallback IDs |
|---|---:|---:|---:|---:|
| 3 | 470 | not listed in this snapshot | 0 | 0 |
| 4 | 607 | 21 | 13 | 8 |
| 5 | 551 | 20 | 17 | 3 |
| 6 | 216 | 17 | 15 | 2 |

The Floor 3 semantics file exists, but its JSON currently has no `places` list (it is in a different/legacy shape or empty); inspect before relying on it. Counts describe data files, not correctness.

## 5. Important boundaries and caveats

- The root viewer currently displays one floor at a time. Per-floor local coordinates are not a shared building coordinate system.
- `campus_vertical_connections.json` is not sufficient for navigation: no corridor graph, connector landing offsets, verified floor alignment, storey elevations, or travel costs are provided.
- Wall-supported rectangle checks are a useful filter, not a complete room-boundary/topology solver. A 65% average can accept imperfect geometry, and intentional door openings require interpretation.
- Floor-region IDs and semantic IDs should remain consistent. If a place ID changes, update/regenerate region data.
- CAD data may contain stray annotations, blocks, duplicate lines, partial wall faces, and source-unit inconsistencies. Check DXF `$INSUNITS` and preserve source coordinates/metadata.
- `inspection_navigation/` is valuable provenance. Keep previews and validation artifacts current when changing the generated geometry.
- Root `package.json` is for the current TypeScript viewer; `frontend/package.json` belongs to the older demo. Run commands from the correct directory.
- The root README currently documents the older project layout and may not fully describe the newer root 3D viewer. Prefer inspecting the root source and data contracts for active 3D tasks.

## 6. Suggested continuation workflow for the next Codex agent

1. Start with `git status --short`, `git log --oneline -12`, and read this report plus `docs/PROJECT_GUIDE.md`. Preserve all pre-existing uncommitted edits.
2. Inspect `src/App.tsx`, the relevant floor's `walls.json`, `semantics.json`, and `floor_regions.json`, and matching artifacts in `inspection_navigation/`.
3. For a CAD correction, inspect the source DXF entity in its plan context first. Update extraction rules or bounds in the script, regenerate only the intended floor, then review the JSON diff and preview. Document entity-handle exclusions with audit evidence.
4. For a semantic/fill correction, verify the semantic anchor and all candidate edges against the wall preview. Regenerate via `scripts/generate_floor_regions.py` and inspect both validation report and rendered result.
5. For connector work, verify each landing and corridor access from drawings/source evidence, then establish common building coordinates/storey heights and travel costs before enabling route edges or multi-floor rendering.
6. Keep generated data reproducible. Avoid hand-editing outputs unless there is a clear reason and the source-of-truth update is made too.
7. Report what is evidence-backed, what is a visual inference, what changed, and what remains unverified. Do not claim tests or visual checks unless actually performed.

## 7. Commands and verification notes

The root package scripts are `npm run dev`, `npm run build`, `npm run lint`, and `npm run preview`. The floor scripts are Python 3 scripts and may require `ezdxf`; use the repository's intended Python environment. The separate legacy demo lives under `frontend/`.

No build, lint, or test suite was run while preparing this report. The inventory/counts above were read from the current JSON files. The next agent should verify only after first reviewing the existing dirty tree and understanding any task-specific scope.

