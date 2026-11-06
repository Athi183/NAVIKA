# Original CAD and BIM source files

This folder stores source drawings and models separately from the derived JSON files used by the visualizers.

## Included

- `ramanujan_floor5/`: `fifth_floor.dxf` and `ram_5th.ifc`.
- `ramanujan_multifloor/`: `ramanujan block -2nd floor to 6th floor.dxf`.
- `m_george/`: `college plans 3 (1).dxf`, `MG SECOND FLOOR_rvt.ifc`, `MG 3RD FLOOR_rvt.ifc`, and the available `MG SECOND FLOOR.rvt` source model.
  - `MG FIRST.pdf`: rendered First Floor (entrance/reception level) with the current room-use legend 1–36; source of the kiosk destination names.
  - `MG FIRST.rfa` (and Revit backup `MG FIRST.0001.rfa`): the whole First Floor modelled as a Revit 2023 family. Needs Revit to open; families cannot hold rooms, so an IFC export from the project `.rvt` is preferred.
- `main_block/`: `MAIN BLOCK FLOOR PLANS (1)_recover (1).dxf` and `basement.dxf`.

## Not available in the local source folders

These files were previously shared in the conversation, but were not present at their shared paths when this folder was assembled:

- `COLLEGE PLAN VARNAM.dxf`

Add these source files here when they are available. The apps use the processed data under `frontend/public/data/` and `ramanujan-viewer/public/data/`; they do not load the original CAD/BIM files directly at runtime.
