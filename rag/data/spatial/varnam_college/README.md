# Varnam College campus-site extraction

This dataset is extracted from `COLLEGE PLAN VARNAM.dxf` using the
dependency-free `backend/navigation/tools/process_campus_dxf.py` utility.
The script scopes a drawing cluster near the `COLLEGE LAYOUT` title because
the source file contains multiple widely separated drawing clusters. It keeps
selected PDF-derived CAD layers and building/site text anchors.

The DXF header declares inches. The file appears PDF-derived, so the declared
unit and drawing extent have not been checked against a known site measurement.
Coordinates in the CSVs remain in the source drawing units. Do not use them as
surveyed distances until the scale is checked.

`places.csv` contains candidate text labels such as Ramanujan Block, M George
Block, halls, hostel and campus access/safety annotations. A label coordinate
is not a building footprint, entrance, or verified location.

`geometry.csv` contains raw line segments grouped by source layer. The geometry
is not classified as a walkable route or a confirmed building boundary.
`topology_edges.csv` is intentionally empty: no outdoor route, indoor-to-outdoor
link, or vertical connector was confirmed from this drawing alone.
`floor_labels.csv` contains the First Floor and Fourth Floor text anchors found
in the scoped drawing cluster; neither is assigned to a building yet.

The frontend presents this as a schematic 3D site context beside the existing
Ramanujan second-to-sixth-floor model. The two views are linked by selecting the
Ramanujan Block label for inspection, not by a routable graph edge.
