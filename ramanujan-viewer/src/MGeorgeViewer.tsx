import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";

type Segment = { id: string; x1: number; y1: number; x2: number; y2: number };
type Place = { id: string; label: string; x: number; y: number; type: string; color: string; source_layer: string };
type Region = { id: string; semantic_id: string; label: string; type: string; color: string; polygon_xy_cm: number[][]; area_m2: number; review_status: string };
type FloorData = {
  schema_version: number; building_id: string; floor_id: string; floor_label: string; source_file: string;
  source_units: string; unit_status: string; coordinate_units: string; meters_per_coordinate_unit: number;
  elevation_m: number | null; plan_bounds_xy: number[]; registration_bounds_xy?: number[];
  semantic_places: Place[]; floor_regions: Region[]; layer_segments: Record<string, Segment[]>; summary: Record<string, unknown>;
};
type IfcElement = { id: string; ifc_type: string; name: string; positions_xyz: number[] };
type IfcData = {
  floor_id: string; floor_label: string; source_file: string; ifc_space_count: number;
  storeys: { id: number; name: string; long_name: string | null; elevation_m: number | null }[];
  mesh_elements: IfcElement[]; summary: { direct_mesh_element_count: number; mesh_vertex_count: number; world_extents_xyz_m: number[] };
  dxf_overlay: { target_floor_id: string | null; status: string; max_dimension_mismatch_fraction: number | null; note: string };
};

const DATA = {
  main_basement: "/data/MITS_Main_Block/main_basement.json",
  main_f1: "/data/MITS_Main_Block/main_f1.json",
  main_f2: "/data/MITS_Main_Block/main_f2.json",
  mgeorge_second: "/data/MGeorge_IFC/mgeorge_second.json",
  mgeorge_third: "/data/MGeorge_IFC/mgeorge_third.json",
} as const;
type ViewId = keyof typeof DATA;
const LAYER_COLORS: Record<string, string> = {
  wall: "#ad696b", DOOR: "#f28b62", STAIR: "#e4b96e", win: "#79b7c4",
  "COR HA": "#c38aaf", Layer1: "#80b9aa", Layer4: "#c4b996", "thin ha": "#8e999b", "0": "#879094",
};
const IFC_COLORS: Record<string, string> = { IFCWALL: "#a85f63", IFCWALLSTANDARDCASE: "#a85f63", IFCSLAB: "#c4c4c4", IFCSTAIR: "#c6a0df", IFCSTAIRFLIGHT: "#c6a0df", IFCDOOR: "#f28b62" };
const DXF_WALL_HEIGHT_M = 3.0;
const WALL_MATERIAL = "#98585b";

function loadJson<T>(path: string): Promise<T> {
  return fetch(path).then((response) => {
    if (!response.ok) throw new Error(`Could not load ${path}`);
    return response.json() as Promise<T>;
  });
}

function worldPoint(x: number, y: number, originX: number, originY: number, factor: number): [number, number] {
  return [(x - originX) * factor, -(y - originY) * factor];
}

function PlanSlab({ width, depth }: { width: number; depth: number }) {
  return <mesh position={[width / 2, -0.12, -depth / 2]} receiveShadow>
    <boxGeometry args={[width + 1.2, 0.24, depth + 1.2]} />
    <meshStandardMaterial color="#c8c8c5" roughness={0.96} />
  </mesh>;
}

function FloorLayerLines({ data, originX, originY }: { data: FloorData; originX: number; originY: number }) {
  const geometries = useMemo(() => Object.entries(data.layer_segments).map(([layer, segments]) => {
    const coords = new Float32Array(segments.length * 6);
    segments.forEach((segment, index) => {
      const a = worldPoint(segment.x1, segment.y1, originX, originY, data.meters_per_coordinate_unit);
      const b = worldPoint(segment.x2, segment.y2, originX, originY, data.meters_per_coordinate_unit);
      coords.set([a[0], 0.055, a[1], b[0], 0.055, b[1]], index * 6);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(coords, 3));
    return { layer, geometry };
  }), [data, originX, originY]);
  return <group>{geometries.map(({ layer, geometry }) => <lineSegments key={layer} geometry={geometry}>
    <lineBasicMaterial color={LAYER_COLORS[layer] || "#a8b2bb"} transparent opacity={layer === "0" ? 0.3 : 0.82} />
  </lineSegments>)}</group>;
}

function ExtrudedDxfWalls({ data, originX, originY }: { data: FloorData; originX: number; originY: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const segments = data.layer_segments.wall || [];
  const matrices = useMemo(() => segments.map((line) => {
    const a = worldPoint(line.x1, line.y1, originX, originY, data.meters_per_coordinate_unit);
    const b = worldPoint(line.x2, line.y2, originX, originY, data.meters_per_coordinate_unit);
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const center = new THREE.Vector3((a[0] + b[0]) / 2, DXF_WALL_HEIGHT_M / 2, (a[1] + b[1]) / 2);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-dz, dx), 0));
    return new THREE.Matrix4().compose(center, rotation, new THREE.Vector3(Math.hypot(dx, dz), DXF_WALL_HEIGHT_M, 0.2));
  }), [segments, originX, originY, data.meters_per_coordinate_unit]);
  useEffect(() => {
    if (!meshRef.current) return;
    matrices.forEach((matrix, index) => meshRef.current?.setMatrixAt(index, matrix));
    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.computeBoundingSphere();
  }, [matrices]);
  if (!segments.length) return null;
  return <instancedMesh ref={meshRef} args={[undefined, undefined, segments.length]} castShadow receiveShadow>
    <boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={WALL_MATERIAL} roughness={0.9} />
  </instancedMesh>;
}

function ColorRegionMeshes({ data, originX, originY }: { data: FloorData; originX: number; originY: number }) {
  const regions = useMemo(() => data.floor_regions.map((region) => {
    const shape = new THREE.Shape();
    region.polygon_xy_cm.forEach(([x, y], index) => {
      const localX = (x - originX) * data.meters_per_coordinate_unit;
      const localY = (y - originY) * data.meters_per_coordinate_unit;
      if (index === 0) shape.moveTo(localX, localY); else shape.lineTo(localX, localY);
    });
    shape.closePath();
    return { region, geometry: new THREE.ShapeGeometry(shape) };
  }), [data, originX, originY]);
  return <group>{regions.map(({ region, geometry }) => <mesh key={region.id} geometry={geometry} position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
    <meshStandardMaterial color={region.color} transparent opacity={0.88} roughness={1} side={THREE.DoubleSide} depthWrite={false} />
  </mesh>)}</group>;
}

function PlaceLabels({ data, originX, originY }: { data: FloorData; originX: number; originY: number }) {
  return <group>{data.semantic_places.map((place) => {
    const [x, z] = worldPoint(place.x, place.y, originX, originY, data.meters_per_coordinate_unit);
    return <group key={place.id} position={[x, DXF_WALL_HEIGHT_M + 0.08, z]}>
      <Text rotation={[-Math.PI / 2, 0, 0]} fontSize={0.5} color={place.color} outlineColor="#282629" outlineWidth={0.03} anchorX="center" anchorY="middle" maxWidth={11} textAlign="center">
        {place.label}
      </Text>
    </group>;
  })}</group>;
}

function IfcGeometry({ data, opacity = 0.9 }: { data: IfcData; opacity?: number }) {
  const grouped = useMemo(() => {
    const positions = new Map<string, number[]>();
    data.mesh_elements.forEach((element) => {
      if (!positions.has(element.ifc_type)) positions.set(element.ifc_type, []);
      positions.get(element.ifc_type)?.push(...element.positions_xyz);
    });
    return [...positions.entries()].map(([type, values]) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
      geometry.computeVertexNormals();
      return { type, geometry };
    });
  }, [data]);
  return <group>{grouped.map(({ type, geometry }) => <mesh key={type} geometry={geometry} castShadow receiveShadow>
    <meshStandardMaterial color={IFC_COLORS[type] || "#cbd5e1"} transparent={opacity < 1} opacity={opacity} roughness={0.82} side={THREE.DoubleSide} depthWrite={opacity >= 0.9} />
  </mesh>)}</group>;
}

function boundsForFloor(data: FloorData) {
  const [minX, minY, maxX, maxY] = data.registration_bounds_xy || data.plan_bounds_xy;
  const factor = data.meters_per_coordinate_unit;
  return { minX, minY, width: (maxX - minX) * factor, depth: (maxY - minY) * factor };
}

function DxfScene({ data, ifcOverlay, showIfc }: { data: FloorData; ifcOverlay: IfcData | null; showIfc: boolean }) {
  const bounds = boundsForFloor(data);
  const center = [bounds.width / 2, 0, -bounds.depth / 2] as [number, number, number];
  return <>
    <color attach="background" args={["#262629"]} />
    <hemisphereLight intensity={1.55} color="#f7f1e8" groundColor="#555257" />
    <directionalLight position={[bounds.width * 0.45, 55, bounds.depth]} intensity={2.35} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
    <PlanSlab width={bounds.width} depth={bounds.depth} />
    <gridHelper args={[Math.max(bounds.width, bounds.depth) * 1.5, 80, "#a2a0a2", "#59575a"]} position={[center[0], -0.145, center[2]]} />
    <ColorRegionMeshes data={data} originX={bounds.minX} originY={bounds.minY} />
    <FloorLayerLines data={data} originX={bounds.minX} originY={bounds.minY} />
    <ExtrudedDxfWalls data={data} originX={bounds.minX} originY={bounds.minY} />
    {showIfc && ifcOverlay && <IfcGeometry data={ifcOverlay} opacity={0.34} />}
    <PlaceLabels data={data} originX={bounds.minX} originY={bounds.minY} />
    <OrbitControls makeDefault target={center} enableDamping dampingFactor={0.08} minDistance={4} maxDistance={260} />
  </>;
}

function IfcScene({ data }: { data: IfcData }) {
  const all = data.mesh_elements.flatMap((element) => element.positions_xyz);
  const xs = all.filter((_, index) => index % 3 === 0), ys = all.filter((_, index) => index % 3 === 1), zs = all.filter((_, index) => index % 3 === 2);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const target: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  return <>
    <color attach="background" args={["#262629"]} />
    <hemisphereLight intensity={1.55} color="#f7f1e8" groundColor="#555257" />
    <directionalLight position={[maxX + 35, maxY + 45, maxZ + 45]} intensity={2.35} />
    <IfcGeometry data={data} />
    <gridHelper args={[Math.max(maxX - minX, maxY - minY) * 1.5, 60, "#a2a0a2", "#59575a"]} position={[target[0], minY - 0.15, target[2]]} />
    <OrbitControls makeDefault target={target} enableDamping dampingFactor={0.08} minDistance={3} maxDistance={300} />
  </>;
}

function MGeorgeViewer() {
  const [datasets, setDatasets] = useState<Partial<Record<ViewId, FloorData | IfcData>>>({});
  const [view, setView] = useState<ViewId>("main_f2");
  const [showIfc, setShowIfc] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(Object.entries(DATA).map(async ([id, path]) => [id, await loadJson<FloorData | IfcData>(path)] as const))
      .then((items) => setDatasets(Object.fromEntries(items) as Record<ViewId, FloorData | IfcData>))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <main className="app"><section className="notice notice-error">Could not load the model data: {error}</section></main>;
  const selected = datasets[view];
  if (!selected) return <main className="app"><section className="loading">Loading DXF floors and IFC geometry…</section></main>;

  const isIfcOnly = view === "mgeorge_third" || view === "mgeorge_second";
  const activeFloor = selected as FloorData;
  const overlay = datasets.mgeorge_second as IfcData | undefined;
  const isDxfFloor = view.startsWith("main_");
  const floorBounds = isDxfFloor ? boundsForFloor(activeFloor) : null;

  return <main className="app">
    <header className="topbar">
      <div><p className="eyebrow">NAVIKA · SPATIAL MODEL VIEWER</p><h1>MITS Main Block + M. George IFC</h1><p className="subhead">CAD floor plans, semantic colors, and a separately reviewable IFC overlay</p></div>
      <div className="topbar-badges"><span className="badge badge-green">3D · Orbit · Pan · Zoom</span><span className="badge badge-amber">Navigation links still need verification</span></div>
    </header>
    <div className="workspace">
      <aside className="sidebar">
        <label className="control-label" htmlFor="floor-view">Floor / source</label>
        <select id="floor-view" value={view} onChange={(event) => setView(event.target.value as ViewId)}>
          <optgroup label="MITS Main Block · DXF">
            <option value="main_basement">Basement · DXF</option><option value="main_f1">First Floor · DXF</option><option value="main_f2">Second Floor · DXF + IFC candidate</option>
          </optgroup>
          <optgroup label="M. George · IFC source">
            <option value="mgeorge_second">Second Floor · IFC export</option><option value="mgeorge_third">Third Floor · IFC export</option>
          </optgroup>
        </select>
        <div className="model-card">
          <div className="model-card-title">{isIfcOnly ? (selected as IfcData).floor_label : activeFloor.floor_label}</div>
          <div className="model-card-subtitle">{isIfcOnly ? (selected as IfcData).source_file : activeFloor.source_file}</div>
        </div>

        {view === "main_f2" && overlay && <label className="toggle-row"><input type="checkbox" checked={showIfc} onChange={(event) => setShowIfc(event.target.checked)} /><span>Show second-floor IFC wall / stair overlay</span></label>}

        {isDxfFloor && <>
          <section className="panel">
            <h2>Color-coded spaces</h2>
            <div className="legend-grid">{[["laboratory", "Labs"], ["office", "Offices"], ["washroom", "Washrooms"], ["corridor", "Corridors"], ["stair", "Stairs"], ["lift", "Lifts"], ["hall", "Halls"], ["room", "Other rooms"]].map(([type, label]) => <span key={type} className="legend-item"><i style={{ background: semanticColor(type) }} />{label}</span>)}</div>
            <p>Room fills appear only where four candidate edges have DXF wall support. Other labels keep their semantic color without an inferred room fill.</p>
          </section>
          <section className="panel panel-info">
            <h2>Geometry and scale</h2>
            <p>{activeFloor.unit_status}</p>
            <p>DXF wall extrusion is shown at an illustrative 3.0 m. Basement geometry is mostly on layer 0 and is shown as plan linework because wall classification is uncertain.</p>
          </section>
          {view === "main_f2" && overlay && <section className="panel panel-warning">
            <h2>IFC overlay · alignment candidate</h2>
            <p>Bounding dimensions differ by {((overlay.dxf_overlay.max_dimension_mismatch_fraction || 0) * 100).toFixed(1)}%. The geometry can be overlaid for inspection, but the IFC filenames identify M. George while the DXF title identifies MITS Main Block. Building identity and registration remain unverified.</p>
            <p>{overlay.ifc_space_count} IFC spaces; room fills and route links are not supplied by this IFC.</p>
          </section>}
          <section className="panel">
            <h2>Floor data</h2>
            <div className="stat-row"><span>Room / connector labels</span><b>{activeFloor.semantic_places.length}</b></div>
            <div className="stat-row"><span>Wall-supported color fills</span><b>{activeFloor.floor_regions.length}</b></div>
            <div className="stat-row"><span>Extracted plan segments</span><b>{activeFloor.summary.segment_count as number}</b></div>
          </section>
        </>}

        {!isDxfFloor && <section className="panel panel-warning">
          <h2>IFC inspection notes</h2>
          <p>{(selected as IfcData).ifc_space_count} IFC spaces. The model is shown from direct tessellated element geometry and is not yet aligned to a DXF floor.</p>
          <p>Storey metadata: {(selected as IfcData).storeys.map((storey) => `${storey.name} (${storey.elevation_m == null ? "?" : Number(storey.elevation_m.toFixed(2))} m)`).join(", ")}. Check these levels against the architectural floor names before stacking floors.</p>
          <div className="stat-row"><span>Rendered IFC elements</span><b>{(selected as IfcData).summary.direct_mesh_element_count}</b></div>
          <div className="stat-row"><span>Mesh vertices</span><b>{(selected as IfcData).summary.mesh_vertex_count.toLocaleString()}</b></div>
        </section>}
        <section className="panel panel-warning"><h2>Navigation status</h2><p>This view is for spatial visualization. A colored label or candidate fill does not prove a door connection. Room-to-corridor links and vertical access must be reviewed before enabling directions.</p></section>
      </aside>
      <section className="viewer-card">
        <div className="viewer-title"><div><span className="viewer-kicker">{isDxfFloor ? "DXF-derived floor model" : "IFC element model"}</span><h2>{isDxfFloor ? activeFloor.floor_label : (selected as IfcData).floor_label}</h2></div><span className="viewer-hint">Drag to rotate · scroll to zoom · right-drag to pan</span></div>
        <div className="canvas-wrap">
          <Canvas shadows camera={isDxfFloor ? { position: [floorBounds!.width * 0.72, Math.max(24, floorBounds!.depth * 0.48), floorBounds!.depth * 0.8], fov: 48 } : { position: [150, 100, 130], fov: 48 }}>
            {isDxfFloor ? <DxfScene data={activeFloor} ifcOverlay={overlay || null} showIfc={showIfc && view === "main_f2"} /> : <IfcScene data={selected as IfcData} />}
          </Canvas>
        </div>
        <footer className="viewer-footer">{isDxfFloor ? <>{Object.entries(LAYER_COLORS).map(([name, color]) => <span key={name}><i style={{ background: color }} />{name}</span>)}<span className="footer-note">Rooms: semantic color · candidate fill only where wall-supported</span></> : <>{Object.entries(IFC_COLORS).map(([name, color]) => <span key={name}><i style={{ background: color }} />{name.replace("IFC", "")}</span>)}<span className="footer-note">IFC geometry shown in its own local frame</span></>}</footer>
      </section>
    </div>
  </main>;
}

function semanticColor(type: string) {
  const colors: Record<string, string> = { laboratory: "#F6D878", office: "#8ED8D0", washroom: "#83D5E3", corridor: "#D9D9D9", stair: "#B9A1E8", lift: "#B9A1E8", hall: "#F6D878", food: "#E9A1A1", room: "#DEE2E6", service: "#9CCFE8" };
  return colors[type] || "#cbd5e1";
}

export default MGeorgeViewer;
