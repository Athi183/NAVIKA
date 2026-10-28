import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Line, OrbitControls, Text } from '@react-three/drei'
import building from '../../data/ramanujan_floors_2_6.json'

const ROOM_COLORS = {
  classroom: '#F6D878', laboratory: '#F6D878', tutorial: '#F6D878',
  department: '#8ED8D0', office: '#8ED8D0', administrative: '#8ED8D0',
  vertical_transport: '#B9A1E8', lift: '#B9A1E8', elevator: '#B9A1E8',
  staircase: '#B9A1E8', stair: '#B9A1E8', toilet: '#83D5E3', facility: '#83D5E3',
  hall: '#D9D9D9', corridor: '#D9D9D9', circulation: '#D9D9D9',
}
const FALLBACK_COLOR = '#DEE2E6'
const WALL_HEIGHT = 2.8

function semanticColor(type = '') {
  const key = type.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return ROOM_COLORS[key] || FALLBACK_COLOR
}

function textColor(place) {
  const name = `${place.name || place.label || ''} ${place.type || ''}`.toLowerCase()
  if (/lab|class|room|hall|tutorial/.test(name)) return '#eed06b'
  if (/department|office|staff|library/.test(name)) return '#83cfc4'
  if (/toilet|wash/.test(name)) return '#83d5e3'
  if (/stair|lift/.test(name)) return '#c5a9e8'
  return '#e6e7e8'
}

function toPlace(item, index, floorNumber, sourceKind) {
  const xy = sourceKind === 'legacy'
    ? (floorNumber === 3 ? item.source_xy_dxf || item.xy : item.display_xy || item.xy)
    : [item.cadX, item.cadY]
  return {
    id: item.id || `floor-${floorNumber}-place-${index}`,
    name: item.name || item.text || item.label || 'Unnamed place',
    type: item.type || 'other',
    roomNumber: item.roomNumber,
    x: xy?.[0], y: xy?.[1],
  }
}

function modelPlaceMatches(place, endpoint) {
  if (!endpoint) return false
  const sourceName = String(endpoint.label || endpoint.name || '').toLowerCase()
  const endpointNumber = sourceName.match(/\b[1-7]\d{2}\b/)?.[0]
  if (endpointNumber && String(place.roomNumber || '').trim() === endpointNumber) return true
  const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const wanted = normalize(sourceName)
  const candidate = normalize(place.name)
  return wanted.length > 5 && (candidate.includes(wanted) || wanted.includes(candidate))
}

function boundsOf(points) {
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

function World({ model, source, destination, onPick, stops = [] }) {
  const wallRef = useRef(null)
  const { data, floorNumber, mode } = model
  const originX = data.bounds.minX
  const originY = data.bounds.minY
  const factor = 1
  const worldPoint = (x, y) => [(x - originX) * factor, -(y - originY) * factor]
  const width = data.bounds.maxX - originX
  const depth = data.bounds.maxY - originY
  const center = [width / 2, 0, -depth / 2]
  const walls = useMemo(() => {
    if (mode === 'legacy') return data.walls.map((wall, index) => ({ id: `legacy-${index}`, x1: wall[0], y1: wall[1], x2: wall[2], y2: wall[3] }))
    return data.walls
  }, [data, mode])
  const matrices = useMemo(() => walls.map((wall) => {
    const a = worldPoint(wall.x1, wall.y1)
    const b = worldPoint(wall.x2, wall.y2)
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const position = new THREE.Vector3((a[0] + b[0]) / 2, WALL_HEIGHT / 2, (a[1] + b[1]) / 2)
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-dz, dx), 0))
    return new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(Math.hypot(dx, dz), WALL_HEIGHT, 0.22))
  }), [walls, originX, originY])
  useEffect(() => {
    if (!wallRef.current) return
    matrices.forEach((matrix, index) => wallRef.current.setMatrixAt(index, matrix))
    wallRef.current.instanceMatrix.needsUpdate = true
    wallRef.current.computeBoundingSphere()
  }, [matrices])
  const regions = useMemo(() => (data.regions || []).map((region) => {
    const shape = new THREE.Shape()
    const polygon = region.polygon || []
    polygon.forEach(([x, y], index) => {
      const point = worldPoint(x, y)
      if (index === 0) shape.moveTo(point[0], -point[1])
      else shape.lineTo(point[0], -point[1])
    })
    shape.closePath()
    const geometry = new THREE.ShapeGeometry(shape)
    return { region, geometry }
  }), [data.regions, originX, originY])
  const selectedSource = data.places.find((place) => modelPlaceMatches(place, source))
  const selectedDestination = data.places.find((place) => modelPlaceMatches(place, destination))
  const floorStop = stops.find((stop) => stop.floor === floorNumber)
  const stopPlace = floorStop ? { x: floorStop.xy[0], y: floorStop.xy[1] } : null
  const routeStart = floorNumber === source?.floor ? selectedSource : stopPlace
  const routeEnd = floorNumber === destination?.floor ? selectedDestination : stopPlace
  const routeLine = routeStart && routeEnd && Math.hypot(routeStart.x - routeEnd.x, routeStart.y - routeEnd.y) > 0.001
    ? [routeStart, routeEnd].map((place) => {
      const point = worldPoint(place.x, place.y)
      return new THREE.Vector3(point[0], WALL_HEIGHT + 0.16, point[1])
    })
    : null
  const footprintGeometry = useMemo(() => {
    if (!data.footprint) return null
    const footprint = data.footprint
    const shape = new THREE.Shape()
    footprint.boundary_cad_xy.forEach(([x, y], index) => {
      const p = worldPoint(x, y)
      if (index === 0) shape.moveTo(p[0], -p[1])
      else shape.lineTo(p[0], -p[1])
    })
    shape.closePath()
    for (const opening of footprint.openings || []) {
      const hole = new THREE.Path()
      opening.cad_xy.forEach(([x, y], index) => {
        const p = worldPoint(x, y)
        if (index === 0) hole.moveTo(p[0], -p[1])
        else hole.lineTo(p[0], -p[1])
      })
      hole.closePath()
      shape.holes.push(hole)
    }
    return new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false, curveSegments: 1 })
  }, [data.footprint, originX, originY])

  return <>
    <color attach="background" args={['#202025']} />
    <hemisphereLight intensity={1.2} color="#f7f1e8" groundColor="#4a484d" />
    <directionalLight position={[width * 0.5, 45, depth]} intensity={2} castShadow />
    {footprintGeometry
      ? <mesh geometry={footprintGeometry} position={[0, -0.16, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><meshStandardMaterial color="#c9c9c6" roughness={0.96} /></mesh>
      : <mesh position={center} receiveShadow><boxGeometry args={[width + 1, 0.16, depth + 1]} /><meshStandardMaterial color="#c9c9c6" roughness={0.96} /></mesh>}
    {regions.map(({ region, geometry }) => {
      const place = data.places.find((item) => item.id === region.semantic_id)
      return <mesh key={region.semantic_id} geometry={geometry} position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial color={semanticColor(place?.type)} roughness={1} side={THREE.DoubleSide} />
      </mesh>
    })}
    {walls.length > 0 && <instancedMesh ref={wallRef} args={[undefined, undefined, walls.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#98585b" roughness={0.9} />
    </instancedMesh>}
    {data.places.map((place) => {
      const [x, z] = worldPoint(place.x, place.y)
      const isSource = modelPlaceMatches(place, source) && source?.floor === floorNumber
      const isDestination = modelPlaceMatches(place, destination) && destination?.floor === floorNumber
      const label = `${place.roomNumber ? `${place.roomNumber}\n` : ''}${place.name}`
      const fontSize = place.roomNumber ? 0.38 : 0.44
      return <group key={place.id} position={[x, WALL_HEIGHT + 0.08, z]} onClick={(event) => { event.stopPropagation(); onPick?.(place) }}>
        {(isSource || isDestination) && <mesh rotation={[-Math.PI / 2,0,0]} position={[0,0.01,0]}><circleGeometry args={[0.64,24]} /><meshBasicMaterial color={isSource ? '#16a34a' : '#dc2626'} side={THREE.DoubleSide} /></mesh>}
        <Text rotation={[-Math.PI / 2, 0, 0]} fontSize={fontSize} color={textColor(place)} outlineColor="#202025" outlineWidth={0.028} anchorX="center" anchorY="middle" maxWidth={10} textAlign="center">{label}</Text>
        {(isSource || isDestination) && <Text position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.42} color={isSource ? '#118044' : '#b91c1c'} outlineColor="white" outlineWidth={0.03} anchorX="center" anchorY="top">{isSource ? 'SOURCE' : 'DESTINATION'}</Text>}
      </group>
    })}
    {floorStop && floorNumber !== source?.floor && floorNumber !== destination?.floor && (() => {
      const [x, z] = worldPoint(floorStop.xy[0], floorStop.xy[1])
      return <group position={[x, WALL_HEIGHT + 0.14, z]}>
        <mesh><sphereGeometry args={[0.32, 16, 12]} /><meshStandardMaterial color="#0284c7" emissive="#0284c7" emissiveIntensity={0.2} /></mesh>
        <Text position={[0, 0.48, 0]} fontSize={0.36} color="#075985" outlineColor="white" outlineWidth={0.04} anchorX="center">CONNECTOR STOP · CANDIDATE</Text>
      </group>
    })()}
    {routeLine && <Line points={routeLine} color="#dc2626" lineWidth={3} dashed dashSize={0.75} gapSize={0.28} />}
    <gridHelper args={[Math.max(width, depth) * 1.4, 60, '#a2a0a2', '#59575a']} position={[center[0], -0.18, center[2]]} />
    <OrbitControls makeDefault target={center} enableDamping dampingFactor={0.08} minDistance={5} maxDistance={180} />
  </>
}

export default function RamanujanFloorModel3D({ floorNumber = 4, source = null, destination = null, onPick = null, stops = [], compact = false }) {
  const [model, setModel] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const legacyFloor = building.floors.find((floor) => floor.floor_number === floorNumber)
    if (floorNumber === 2) {
      const segments = legacyFloor?.segments.filter(([x1,y1,x2,y2]) => {
        const length = Math.hypot(x2-x1,y2-y1)
        const midX = (x1+x2)/2
        const midY = (y1+y2)/2
        return length >= 0.45 && length <= 50 && midX >= 25 && midX <= 123 && midY >= 24 && midY <= 64
      }) || []
      const endpoints = segments.flatMap(([x1,y1,x2,y2]) => [[x1,y1],[x2,y2]])
      const bounds = boundsOf(endpoints)
      const places = (legacyFloor?.labels || []).map((item,index) => toPlace(item,index,floorNumber,'legacy')).filter((place) => Number.isFinite(place.x) && Number.isFinite(place.y))
      setModel({ floorNumber, mode: 'legacy', data: { walls: segments, bounds, places, regions: [], footprint: null } })
      return () => { active = false }
    }
    const base = `/data/Ramanujan_F${floorNumber}`
    const requests = [fetch(`${base}/walls.json`).then((r) => { if (!r.ok) throw new Error('Detailed floor wall data unavailable'); return r.json() })]
    if (floorNumber >= 4) requests.push(fetch(`${base}/semantics.json`).then((r) => { if (!r.ok) throw new Error('Floor semantic data unavailable'); return r.json() }))
    requests.push(fetch(`${base}/floor_regions.json`).then((r) => r.ok ? r.json() : { regions: [] }))
    requests.push(fetch('/data/floor_slab_footprints.json').then((r) => r.ok ? r.json() : { floors: [] }))
    Promise.all(requests).then((items) => {
      if (!active) return
      const wallData = items[0]
      let sem, regionData, footprints
      if (floorNumber >= 4) [sem, regionData, footprints] = items.slice(1)
      else [regionData, footprints] = items.slice(1)
      const walls = wallData.walls || []
      const bounds = boundsOf(walls.flatMap((wall) => [[wall.x1,wall.y1],[wall.x2,wall.y2]]))
      let places = floorNumber >= 4
        ? (sem?.places || []).map((item,index) => toPlace(item,index,floorNumber,'semantic'))
        : (legacyFloor?.labels || []).map((item,index) => toPlace(item,index,floorNumber,'legacy'))
      if (floorNumber === 3) {
        const rawCoords = (legacyFloor?.labels || []).map((item) => item.source_xy_dxf).filter(Boolean)
        if (rawCoords.length) places = places.map((place,index) => ({ ...place, x: rawCoords[index]?.[0] ?? place.x, y: rawCoords[index]?.[1] ?? place.y }))
      }
      places = places.filter((place) => Number.isFinite(place.x) && Number.isFinite(place.y))
      const footprint = footprints?.floors?.find((item) => item.floor === String(floorNumber)) || null
      const regionFloor = regionData?.regions || []
      setModel({ floorNumber, mode: 'detailed', data: { walls, bounds, places, regions: regionFloor, footprint } })
    }).catch((err) => { if (active) setError(err.message || 'Could not load this floor model') })
    return () => { active = false }
  }, [floorNumber])

  if (error) return <div className="flex min-h-[320px] items-center justify-center rounded-xl bg-slate-900 p-6 text-sm text-white">{error}</div>
  if (!model) return <div className="flex min-h-[320px] items-center justify-center rounded-xl bg-slate-900 p-6 text-sm text-white">Loading Floor {floorNumber} 3D geometry…</div>
  const floorLabel = building.floors.find((floor) => floor.floor_number === floorNumber)?.label || `Floor ${floorNumber}`
  return <div className={`overflow-hidden rounded-2xl border border-slate-700 bg-[#202025] ${compact ? '' : 'min-h-[520px]'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3 text-white">
      <div><h3 className="text-sm font-bold">{floorLabel} · detailed 3D model</h3><p className="text-[11px] text-slate-300">CAD-derived walls and supported room fills · drag, zoom and pan</p></div>
      <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[10px] font-semibold text-amber-200">Candidate geometry · review before wayfinding</span>
    </div>
    <div className={compact ? 'h-[360px]' : 'h-[min(72vh,760px)] min-h-[420px]'}>
      <Canvas shadows camera={{ position: [model.data.bounds.maxX-model.data.bounds.minX, Math.max(20,(model.data.bounds.maxY-model.data.bounds.minY)*0.62), model.data.bounds.maxY-model.data.bounds.minY], fov: 48 }}>
        <World model={model} source={source} destination={destination} onPick={onPick} stops={stops} />
      </Canvas>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 px-4 py-2 text-[10px] text-slate-300">
      <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#98585b]" />Walls</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#F6D878]" />Teaching / lab</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#8ED8D0]" />Office / department</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#83D5E3]" />Washroom</span>
      <span className="ml-auto">Room color fills are emitted only where the DXF wall check passed.</span>
    </div>
  </div>
}
