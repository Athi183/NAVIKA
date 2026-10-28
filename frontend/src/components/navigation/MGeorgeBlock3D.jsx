import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls, Text } from '@react-three/drei'
import { Building2, Layers3, RotateCcw } from 'lucide-react'

// Compact display spacing keeps all five plans readable in one view. These
// values intentionally describe a compressed visualization, not real levels.
const FLOOR_GAP = 1.25
const WALL_HEIGHT = 0.72
const SINGLE_FLOOR_WALL_HEIGHT = 1.4
const DRAWN_LAYERS = ['WALL', 'DOOR', 'STAIR', 'COR_HA', 'TOILET_HA', 'THIN_HA', 'WIN', 'THIN']
const LAYER_STYLE = {
  WALL: { color: '#98585b', height: WALL_HEIGHT, thickness: 0.085 },
  DOOR: { color: '#22a6a1', height: 0.055, thickness: 0.045 },
  STAIR: { color: '#9b7bd1', height: 0.065, thickness: 0.055 },
  COR_HA: { color: '#64748b', height: 0.035, thickness: 0.04 },
  TOILET_HA: { color: '#4eb7cb', height: 0.035, thickness: 0.04 },
  THIN_HA: { color: '#d1a64f', height: 0.025, thickness: 0.035 },
  WIN: { color: '#66a8ba', height: 0.055, thickness: 0.045 },
  THIN: { color: '#a5a5a5', height: 0.025, thickness: 0.035 },
}

const CATEGORY_STYLE = {
  teaching: { color: '#F6D878', fill: '#F6D878' },
  laboratory: { color: '#F6D878', fill: '#F6D878' },
  office: { color: '#8ED8D0', fill: '#8ED8D0' },
  washroom: { color: '#83D5E3', fill: '#83D5E3' },
  lift: { color: '#B9A1E8', fill: '#B9A1E8' },
  stair: { color: '#B9A1E8', fill: '#B9A1E8' },
  circulation: { color: '#D9D9D9', fill: '#D9D9D9' },
  access: { color: '#DEE2E6', fill: '#DEE2E6' },
  room: { color: '#DEE2E6', fill: '#DEE2E6' },
}

const FALLBACK_ROOM_COLOR = '#DEE2E6'

function normalizeConnectorLabel(text) {
  return text.toUpperCase().replace(/\s+/g, ' ').trim()
}

function buildConnectorClusters(floors) {
  const clusters = []
  let previousFloorClusters = []
  let sequence = 0
  for (const floor of floors) {
    const currentFloorClusters = []
    const used = new Set()
    const sameFloorLabelCounts = new Map()
    for (const marker of floor.connectors) {
      const key = `${marker.type}:${normalizeConnectorLabel(marker.text)}`
      const candidates = previousFloorClusters
        .filter((cluster) => cluster.key === key && !used.has(cluster.id))
        .map((cluster) => ({ cluster, distance: Math.hypot(cluster.lastXY[0] - marker.xy[0], cluster.lastXY[1] - marker.xy[1]) }))
        .filter((item) => item.distance <= 3.2)
        .sort((a, b) => a.distance - b.distance)
      const matched = candidates[0]?.cluster
      const ordinal = (sameFloorLabelCounts.get(key) || 0) + 1
      sameFloorLabelCounts.set(key, ordinal)
      const cluster = matched || {
        id: `mgeorge-connector-${sequence++}`,
        key,
        type: marker.type,
        name: marker.text,
        label: `${marker.text} ${String(ordinal).padStart(2, '0')}`,
        stops: {},
      }
      cluster.stops[floor.floor_number] = marker.xy
      cluster.lastXY = marker.xy
      cluster.lastFloor = floor.floor_number
      used.add(cluster.id)
      if (!currentFloorClusters.includes(cluster)) currentFloorClusters.push(cluster)
      if (!clusters.includes(cluster)) clusters.push(cluster)
    }
    previousFloorClusters = currentFloorClusters
  }
  return clusters.filter((cluster) => Object.keys(cluster.stops).length > 1)
}

function LayerMesh({ segments, floorY, layer, wallHeight }) {
  const meshRef = useRef(null)
  const style = LAYER_STYLE[layer]
  const height = layer === 'WALL' ? wallHeight : style.height
  const matrices = useMemo(() => segments.map(([x1, y1, x2, y2]) => {
    const dx = x2 - x1
    const dz = -(y2 - y1)
    const length = Math.hypot(dx, dz)
    const position = new THREE.Vector3((x1 + x2) / 2, floorY + height / 2, -(y1 + y2) / 2)
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-dz, dx), 0))
    const scale = new THREE.Vector3(length, height, style.thickness)
    return new THREE.Matrix4().compose(position, quaternion, scale)
  }), [floorY, height, segments, style.thickness])

  useEffect(() => {
    if (!meshRef.current) return
    matrices.forEach((matrix, index) => meshRef.current.setMatrixAt(index, matrix))
    meshRef.current.instanceMatrix.needsUpdate = true
    meshRef.current.computeBoundingSphere()
  }, [matrices])

  if (!segments.length) return null
  return <instancedMesh ref={meshRef} args={[undefined, undefined, segments.length]} castShadow receiveShadow>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color={style.color} roughness={layer === 'WALL' ? 0.88 : 0.65} />
  </instancedMesh>
}

function FloorModel({ floor, stackIndex, labelsVisible, wallHeight }) {
  const floorY = stackIndex * FLOOR_GAP
  const [minX, minY, maxX, maxY] = floor.display_bounds_xy
  const width = maxX - minX + 0.35
  const depth = maxY - minY + 0.35
  const centerX = (minX + maxX) / 2
  const centerZ = -(minY + maxY) / 2
  const regions = (floor.room_regions || []).map((region) => {
    const shape = new THREE.Shape()
    region.polygon_xy.forEach(([x, y], index) => index === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y))
    shape.closePath()
    return { region, geometry: new THREE.ShapeGeometry(shape) }
  })
  return <group>
    <mesh position={[centerX, floorY - 0.09, centerZ]} receiveShadow>
      <boxGeometry args={[width, 0.18, depth]} />
      <meshStandardMaterial color="#d9d9d6" roughness={0.95} />
    </mesh>
    {regions.map(({ region, geometry }) => <mesh key={region.id} geometry={geometry} position={[0, floorY + 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <meshBasicMaterial color={CATEGORY_STYLE[region.type]?.fill || FALLBACK_ROOM_COLOR} transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} />
    </mesh>)}
    {DRAWN_LAYERS.map((layer) => <LayerMesh key={`${floor.floor_id}-${layer}`} segments={floor.layer_segments[layer] || []} floorY={floorY} layer={layer} wallHeight={wallHeight} />)}
    <Text position={[minX + 0.2, floorY + 0.08, -minY + 0.25]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.26} color="#334155" anchorX="left" anchorY="middle">
      {floor.label.toUpperCase()}
    </Text>
    {labelsVisible && floor.labels.map((label, index) => {
      const style = CATEGORY_STYLE[label.type] || CATEGORY_STYLE.room
      return <group key={`${floor.floor_id}-${index}`} position={[label.xy[0], floorY + 0.1, -label.xy[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh position={[0, 0, -0.014]}>
          <planeGeometry args={[Math.min(2.8, Math.max(0.7, label.text.length * 0.045)), 0.26]} />
          <meshBasicMaterial color={style.fill} transparent opacity={0.92} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <Text fontSize={0.12} maxWidth={2.6} color="#202025" anchorX="center" anchorY="middle" textAlign="center" outlineColor="white" outlineWidth={0.004}>
          {label.text}
        </Text>
      </group>
    })}
  </group>
}

function SchematicStair({ connector, fromFloor, toFloor, fromXY, toXY, floorGap, selected }) {
  const centerX = (fromXY[0] + toXY[0]) / 2
  const centerZ = -(fromXY[1] + toXY[1]) / 2
  const baseY = fromFloor * floorGap + 0.05
  const rise = floorGap - 0.18
  const run = 1.6
  const width = 0.8
  const flightRise = rise / 2
  const color = selected ? '#c79a66' : '#bcb3cd'
  const makeFlight = (xStart, z, yStart, reverse, key) => {
    const steps = 6
    return <group key={key}>
      {Array.from({ length: steps }, (_, index) => {
        const fraction = (index + 0.5) / steps
        const x = reverse ? xStart - run * fraction : xStart + run * fraction
        const y = yStart + (index + 1) * flightRise / steps
        const edgeX = reverse ? xStart - run * (index + 1) / steps : xStart + run * (index + 1) / steps
        return <group key={index}>
          <mesh position={[x, y - 0.025, z]}><boxGeometry args={[run / steps + 0.025, 0.05, width]} /><meshStandardMaterial color={color} roughness={0.86} /></mesh>
          <mesh position={[edgeX, y - flightRise / steps / 2, z]}><boxGeometry args={[0.045, flightRise / steps, width]} /><meshStandardMaterial color="#8f8999" /></mesh>
        </group>
      })}
      {[-width / 2, width / 2].map((side) => <mesh key={side} position={[xStart + (reverse ? -run / 2 : run / 2), yStart + flightRise / 2 + 0.45, z + side]} rotation={[0, 0, reverse ? 0.68 : -0.68]}>
        <boxGeometry args={[Math.hypot(run, flightRise), 0.045, 0.045]} /><meshStandardMaterial color="#55545c" />
      </mesh>)}
    </group>
  }
  return <group position={[centerX, 0, centerZ]}>
    {makeFlight(-run / 2, -width / 2, baseY, false, 'lower-flight')}
    <mesh position={[run / 2, baseY + flightRise, 0]}><boxGeometry args={[0.85, 0.09, width * 2]} /><meshStandardMaterial color="#aaa49a" /></mesh>
    {makeFlight(run / 2, width / 2, baseY + flightRise, true, 'upper-flight')}
    <Html position={[0, baseY + rise / 2 + 0.3, 0]} center distanceFactor={75} sprite zIndexRange={[30, 0]}>
      <span style={{ padding: '2px 5px', borderRadius: 4, background: '#fff', border: `1px solid ${selected ? '#c2410c' : '#7c3aed'}`, color: '#334155', font: '700 9px/1.2 system-ui,sans-serif', whiteSpace: 'nowrap' }}>{connector.label} · candidate</span>
    </Html>
  </group>
}

function LiftShaft({ connector, floorGap, selected }) {
  const floors = Object.keys(connector.stops).map(Number).sort((a, b) => a - b)
  if (floors.length < 2) return null
  const points = floors.map((floor) => connector.stops[floor])
  const x = points.reduce((sum, point) => sum + point[0], 0) / points.length
  const z = -points.reduce((sum, point) => sum + point[1], 0) / points.length
  const baseY = floors[0] * floorGap + 0.05
  const height = (floors.at(-1) - floors[0]) * floorGap + 0.12
  const width = 0.95
  const depth = 0.9
  const frame = selected ? '#0284c7' : '#8294a6'
  const glass = { color: '#bce6f2', transparent: true, opacity: 0.2, depthWrite: false, roughness: 0.3 }
  return <group position={[x, 0, z]}>
    <mesh position={[-width / 2, baseY + height / 2, 0]}><boxGeometry args={[0.055, height, depth]} /><meshStandardMaterial {...glass} /></mesh>
    <mesh position={[width / 2, baseY + height / 2, 0]}><boxGeometry args={[0.055, height, depth]} /><meshStandardMaterial {...glass} /></mesh>
    <mesh position={[0, baseY + height / 2, depth / 2]}><boxGeometry args={[width, height, 0.055]} /><meshStandardMaterial {...glass} /></mesh>
    {[-1, 1].flatMap((xSide) => [-1, 1].map((zSide) => <mesh key={`${xSide}-${zSide}`} position={[xSide * width / 2, baseY + height / 2, zSide * depth / 2]}>
      <boxGeometry args={[0.07, height, 0.07]} /><meshStandardMaterial color={frame} metalness={0.25} roughness={0.45} />
    </mesh>))}
    {floors.map((floor) => <group key={floor} position={[0, floor * floorGap + 0.08, -depth / 2]}>
      {[-1, 1].map((side) => <mesh key={side} position={[side * 0.2, 0.36, 0.03]}><boxGeometry args={[0.37, 0.68, 0.04]} /><meshStandardMaterial color={selected ? '#8bd4e9' : '#cbd5e1'} metalness={0.18} roughness={0.4} /></mesh>)}
    </group>)}
    <Html position={[0, baseY + height / 2, 0]} center distanceFactor={85} sprite zIndexRange={[30, 0]}>
      <span style={{ padding: '2px 5px', borderRadius: 4, background: '#fff', border: `1px solid ${frame}`, color: frame, font: '700 9px/1.2 system-ui,sans-serif', whiteSpace: 'nowrap' }}>{connector.label} · candidate</span>
    </Html>
  </group>
}

function VerticalNetwork({ connectors, floors, activeConnectorId, floorGap, singleFloor }) {
  if (singleFloor) return null
  const connections = connectors.flatMap((connector) => {
    const stops = Object.keys(connector.stops).map(Number).sort((a, b) => a - b)
    const pairs = stops.slice(0, -1).map((floor, index) => [floor, stops[index + 1]])
      .filter(([from, to]) => to === from + 1)
    return pairs.map(([from, to]) => ({ connector, from, to }))
  })
  return <group>
    {connections.filter(({ connector }) => connector.id !== activeConnectorId).map(({ connector, from, to }, index) => {
      const a = connector.stops[from]
      const b = connector.stops[to]
      return <Line key={`${connector.id}-${from}-${index}`} points={[
        new THREE.Vector3(a[0], from * floorGap + 0.16, -a[1]),
        new THREE.Vector3(b[0], to * floorGap + 0.16, -b[1]),
      ]} color={connector.type === 'stair' ? '#a78bfa' : '#38bdf8'} lineWidth={1.3} dashed dashSize={0.22} gapSize={0.12} transparent opacity={0.38} />
    })}
    {connectors.filter((item) => item.id === activeConnectorId).map((connector) => connector.type === 'stair'
      ? Object.keys(connector.stops).map(Number).sort((a, b) => a - b).slice(0, -1).map((floor) => connector.stops[floor + 1]
        ? <SchematicStair key={`${connector.id}-${floor}`} connector={connector} fromFloor={floor} toFloor={floor + 1} fromXY={connector.stops[floor]} toXY={connector.stops[floor + 1]} floorGap={floorGap} selected />
        : null)
      : <LiftShaft key={connector.id} connector={connector} floorGap={floorGap} selected />)}
  </group>
}

function Scene({ floors, singleFloor, labelFloor, connectors, activeConnectorId, controlsRef }) {
  const { camera } = useThree()
  const visibleFloors = singleFloor ? floors.filter((floor) => floor.floor_number === labelFloor) : floors
  const wallHeight = singleFloor ? SINGLE_FLOOR_WALL_HEIGHT : WALL_HEIGHT
  const targetFloorIndex = singleFloor ? labelFloor : 2
  const floorGap = FLOOR_GAP
  const target = [0, targetFloorIndex * floorGap + 1.2, 0]
  useEffect(() => {
    if (!controlsRef.current) return
    controlsRef.current.target.set(...target)
    camera.position.set(singleFloor ? 1.5 : 19, (singleFloor ? 13 : 10), singleFloor ? 3 : 22)
    camera.lookAt(...target)
    camera.updateProjectionMatrix()
    controlsRef.current.update()
    controlsRef.current.saveState()
  }, [camera, controlsRef, singleFloor, labelFloor])
  return <>
    <color attach="background" args={['#202025']} />
    <ambientLight intensity={1.2} color="#fff8ef" />
    <directionalLight position={[18, 24, 14]} intensity={1.9} castShadow />
    {visibleFloors.map((floor) => <FloorModel key={floor.floor_id} floor={floor} stackIndex={floor.floor_number} labelsVisible={labelFloor === floor.floor_number} wallHeight={wallHeight} />)}
    <VerticalNetwork connectors={connectors} floors={floors} activeConnectorId={activeConnectorId} floorGap={floorGap} singleFloor={singleFloor} />
    <OrbitControls ref={controlsRef} makeDefault target={target} enableDamping dampingFactor={0.08} minDistance={3} maxDistance={80} zoomSpeed={1.1} />
  </>
}

export default function MGeorgeBlock3D() {
  const [floors, setFloors] = useState([])
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState('floor')
  const [labelFloor, setLabelFloor] = useState(0)
  const [activeConnectorId, setActiveConnectorId] = useState('')
  const controlsRef = useRef(null)

  useEffect(() => {
    Promise.all([
      fetch('/data/MGeorge_DXF/manifest.json').then((response) => { if (!response.ok) throw new Error('Could not load M. George floor manifest.'); return response.json() }),
      fetch('/data/MGeorge_DXF/college_plans.json').then((response) => { if (!response.ok) throw new Error('Could not load M. George drawing layers.'); return response.json() }),
    ])
      .then(async ([manifest, drawing]) => {
        const loadedFloors = await Promise.all(manifest.floors.map(async (entry) => {
          const base = `/data/MGeorge_DXF/${entry.directory}`
          const [wallData, semanticData, regionData] = await Promise.all([
            fetch(`${base}/walls.json`).then((response) => { if (!response.ok) throw new Error(`Missing walls.json for ${entry.label}.`); return response.json() }),
            fetch(`${base}/semantics.json`).then((response) => response.json()),
            fetch(`${base}/floor_regions.json`).then((response) => response.json()),
          ])
          const sourceFloor = drawing.floors.find((floor) => floor.floor_number === entry.floor_number)
          const labels = semanticData.places.map((place) => ({ id: place.id, text: place.name, type: place.type, xy: [place.cadX, place.cadY] }))
          const wallSegments = wallData.walls.map((wall) => [wall.x1, wall.y1, wall.x2, wall.y2])
          const roomRegions = regionData.regions.map((region) => ({
            id: region.semantic_id,
            semantic_id: region.semantic_id,
            type: labels.find((label) => label.id === region.semantic_id)?.type || 'room',
            polygon_xy: region.polygon,
          }))
          return {
            ...sourceFloor,
            walls_json: `${base}/walls.json`,
            labels,
            connectors: labels.filter((label) => label.type === 'stair' || label.type === 'lift'),
            layer_segments: { ...sourceFloor.layer_segments, WALL: wallSegments },
            room_regions: roomRegions,
          }
        }))
        setFloors(loadedFloors)
        const candidates = buildConnectorClusters(loadedFloors)
        setActiveConnectorId(candidates.find((item) => item.type === 'stair' && /main stair/i.test(item.name))?.id || candidates[0]?.id || '')
      })
      .catch((reason) => setError(reason.message || 'Unable to load M. George Block data.'))
  }, [])

  const connectors = useMemo(() => buildConnectorClusters(floors), [floors])
  const selectedConnector = connectors.find((item) => item.id === activeConnectorId)
  if (error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{error}</div>
  if (!floors.length) return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading M. George Block floor plans…</div>

  return <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 md:px-7">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Muthoot Institute of Technology and Science · Building 1</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl">M. George Block · 3D floors</h1>
        <p className="mt-1 text-sm text-slate-500">Explore the Ground through Fourth Floors from the college plan drawing.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Building view mode">
        <button type="button" onClick={() => setViewMode('stack')} className={`rounded-xl px-4 py-2 text-sm font-semibold ${viewMode === 'stack' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}><Building2 className="mr-2 inline h-4 w-4" />Connected building</button>
        <button type="button" onClick={() => setViewMode('floor')} className={`rounded-xl px-4 py-2 text-sm font-semibold ${viewMode === 'floor' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}><Layers3 className="mr-2 inline h-4 w-4" />Single floor</button>
      </div>
    </header>

    <div className="grid gap-4 p-4 lg:grid-cols-[300px_minmax(0,1fr)] md:p-6">
      <aside className="space-y-4">
        <div className="rounded-2xl border border-slate-200 p-4">
          <h2 className="text-sm font-bold text-slate-900">Choose a floor</h2>
          <label className="mt-3 block text-xs font-semibold text-slate-600">Floor labels</label>
          <select className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm" value={labelFloor} onChange={(event) => setLabelFloor(Number(event.target.value))}>
            {floors.map((floor) => <option key={floor.floor_id} value={floor.floor_number}>{floor.label}</option>)}
          </select>
          {viewMode === 'stack' && <>
            <label className="mt-4 block text-xs font-semibold text-slate-600">Connector to highlight</label>
            <select className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm" value={activeConnectorId} onChange={(event) => setActiveConnectorId(event.target.value)}>
              {connectors.map((connector) => <option key={connector.id} value={connector.id}>{connector.label} · {Object.keys(connector.stops).length} floor stops · candidate</option>)}
            </select>
          </>}
          <button type="button" onClick={() => controlsRef.current?.reset()} className="mt-4 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"><RotateCcw size={12} className="mr-1 inline" />Reset camera</button>
        </div>

        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs leading-5 text-amber-950">
          <h2 className="font-bold">Compact display · connections are candidates</h2>
          <p className="mt-2">The floors are drawn close together so the full building fits on screen. This compressed vertical spacing is for visualization only. Repeated stair/lift labels are matched by nearby position across floors; those matches are not verified accessible routes.</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Drawing layers</p>
          <div className="flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-slate-600">
            {[["#925457", "Walls"], ["#22a6a1", "Doors"], ["#9b7bd1", "Stairs"], ["#0284c7", "Lift"], ["#66a8ba", "Windows"]].map(([color, label]) => <span key={label} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}</span>)}
          </div>
        </div>
        <p className="text-[11px] leading-4 text-slate-500">{floors.reduce((sum, floor) => sum + floor.walls.length, 0).toLocaleString()} joined wall segments · {floors.reduce((sum, floor) => sum + floor.room_regions.length, 0)} colored room areas · {floors.reduce((sum, floor) => sum + floor.labels.length, 0)} labels</p>
      </aside>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-[#202025]">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 bg-slate-900 px-4 py-3 text-xs text-slate-300">
          <span>{viewMode === 'stack' ? 'Ground–Fourth Floor · connected stack' : `${floors.find((floor) => floor.floor_number === labelFloor)?.label} · detailed model`}</span>
          <span className="ml-auto rounded-full bg-amber-300/15 px-2 py-1 text-[10px] font-semibold text-amber-200">Candidate geometry</span>
        </div>
        <div className="h-[680px]">
          <Canvas shadows camera={{ position: [19, 18, 22], fov: 45 }} gl={{ antialias: true }}>
            <Scene floors={floors} singleFloor={viewMode === 'floor'} labelFloor={labelFloor} connectors={connectors} activeConnectorId={activeConnectorId} controlsRef={controlsRef} />
          </Canvas>
        </div>
      </div>
    </div>
    <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-500 md:px-7">
      <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[#925457]" />Walls</span>
      <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[#F6D878]" />Teaching / labs</span>
      <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[#8ED8D0]" />Offices / departments</span>
      <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[#83D5E3]" />Washrooms</span>
      <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[#9b7bd1]" />Candidate stair cores</span>
      <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[#0284c7]" />Candidate lift cores</span>
      <span className="ml-auto">Illustrative wall height {viewMode === 'floor' ? SINGLE_FLOOR_WALL_HEIGHT : WALL_HEIGHT} · compressed floor spacing {FLOOR_GAP}</span>
    </footer>
  </section>
}
