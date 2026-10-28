# Original CAD and BIM source files

This folder stores source drawings and models separately from the derived JSON files used by the visualizers.

## Included

- `ramanujan_floor5/`: `fifth_floor.dxf` and `ram_5th.ifc`.
- `m_george/`: `college plans 3 (1).dxf`, `MG SECOND FLOOR_rvt.ifc`, `MG 3RD FLOOR_rvt.ifc`, and the available `MG SECOND FLOOR.rvt` source model.
- `main_block/`: `MAIN BLOCK FLOOR PLANS (1)_recover (1).dxf` and `basement.dxf`.

## Not available in the local source folders

These files were previously shared in the conversation, but were not present at their shared paths when this folder was assembled:

- `ramanujan block -2nd floor to 6th floor (1).dxf`
- `COLLEGE PLAN VARNAM.dxf`
- Any `.rfa` family file (no filename or local copy was available)

Add these source files here when they are available. The app uses the processed data under `frontend/public/data/` and `public/data/`; it does not load the original CAD/BIM files directly at runtime.
