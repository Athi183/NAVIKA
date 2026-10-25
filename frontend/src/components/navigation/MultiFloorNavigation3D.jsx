import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls, Text } from '@react-three/drei'
import { QRCodeSVG } from 'qrcode.react'
import { AlertTriangle, Layers3, Map as MapIcon, MapPin, Minus, Plus, QrCode, Route, RotateCcw, Scan } from 'lucide-react'
import building from '../../data/ramanujan_floors_2_6.json'
import navigationGraph from '../../data/ramanujan_navigation_graph_candidate.json'
import MultiFloorDxfViewer from './MultiFloorDxfViewer'

const FLOOR_GAP = 6
const WALL_HEIGHT = 3
const WALL_THICKNESS = 0.09
const FLOOR_COLORS = ['#dbeafe', '#d1fae5', '#ede9fe', '#ffedd5', '#fce7f3']
const ROUTING_ASSUMPTIONS = navigationGraph.routing_assumptions
const DESTINATIONS = building.floors.flatMap((floor) => floor.labels.map((label, index) => ({
  id: `${floor.floor_number}:${index}`,
  floor: floor.floor_number,
  floorLabel: floor.label,
  label: label.text,
  xy: label.display_xy || label.xy,
})))
const DESTINATION_BY_ID = new Map(DESTINATIONS.map((destination) => [destination.id, destination]))

function readRouteProfile() {
  const profile = new URLSearchParams(window.location.search).get('profile')
  return ['fastest', 'shortest', 'step_free'].includes(profile) ? profile : 'fastest'
}

function formatDuration(seconds) {
  const roundedSeconds = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(roundedSeconds / 60)
  const remainder = roundedSeconds % 60
  return minutes ? `${minutes} min ${remainder} sec` : `${remainder} sec`
}

function point3(xy, floorNumber, lift = 0.16) {
  return [xy[0], (floorNumber - 2) * FLOOR_GAP + lift, -xy[1]]
}

function roomStyle(label) {
  const name = label.toLowerCase()
  if (/toilet|wash/.test(name)) return { color: '#db2777', background: '#fce7f3', category: 'Washroom' }
  if (/lab|laboratory/.test(name)) return { color: '#7c3aed', background: '#ede9fe', category: 'Laboratory' }
  if (/class room|classroom|hall|lecture/.test(name)) return { color: '#2563eb', background: '#dbeafe', category: 'Teaching space' }
  if (/department|staff|office|association|library/.test(name)) return { color: '#0f766e', background: '#ccfbf1', category: 'Department / shared space' }
  if (/lift|stair|bridge|corridor/.test(name)) return { color: '#d97706', background: '#fef3c7', category: 'Circulation' }
  if (/electrical|engine|store|warehouse|room/.test(name)) return { color: '#64748b', background: '#e2e8f0', category: 'Service space' }
  return { color: '#0891b2', background: '#cffafe', category: 'Other space' }
}

function planSegments(floor) {
  return floor.segments.filter(([x1, y1, x2, y2]) => {
    const length = Math.hypot(x2 - x1, y2 - y1)
    const midX = (x1 + x2) / 2
    const midY = (y1 + y2) / 2
    // The sheet frame/title border is outside the actual plan extents.
    return length >= 0.45 && length <= 50 && midX >= 25 && midX <= 123 && midY >= 24 && midY <= 64
  })
}

function planBounds(floor) {
  const points = planSegments(floor).flatMap(([x1, y1, x2, y2]) => [[x1, y1], [x2, y2]])
  return points.reduce((bounds, [x, y]) => ({
    minX: Math.min(bounds.minX, x), maxX: Math.max(bounds.maxX, x),
    minY: Math.min(bounds.minY, y), maxY: Math.max(bounds.maxY, y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity })
}

function readEndpoint(param, fallback) {
  const id = new URLSearchParams(window.location.search).get(param)
  return DESTINATION_BY_ID.has(id) ? id : fallback.id
}

function getConnectorPath(sourceFloor, destinationFloor, connector) {
  const direction = sourceFloor <= destinationFloor ? 1 : -1
  const stops = []
  for (let floor = sourceFloor; direction > 0 ? floor <= destinationFloor : floor >= destinationFloor; floor += direction) {
    const stop = connector.stops[String(floor)]
    if (!stop) return null
    stops.push({ floor, xy: stop })
  }
  return stops
}

function findCandidateRoute(source, destination, connectors, profile, connectorChoice = 'auto') {
  if (!source || !destination) return null
  const planarDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const edges = []
  const adjacency = new Map()
  const addEdge = (edge) => {
    edges.push(edge)
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, [])
    adjacency.get(edge.from).push(edge)
  }
  const metric = (edge) => profile === 'shortest' ? edge.distanceM : edge.durationS
  const start = 'route:source'
  const goal = 'route:destination'
  if (source.floor === destination.floor) {
    const distanceM = planarDistance(source.xy, destination.xy)
    addEdge({ from: start, to: goal, distanceM, durationS: distanceM / (profile === 'step_free' ? ROUTING_ASSUMPTIONS.accessible_walk_speed_mps : ROUTING_ASSUMPTIONS.walk_speed_mps), points: [{ floor: source.floor, xy: source.xy }, { floor: destination.floor, xy: destination.xy }] })
  } else {
    const eligible = connectors.filter((connector) => connectorChoice === 'auto' || connector.id === connectorChoice)
      .filter((connector) => profile !== 'step_free' || connector.type === 'lift')
    for (const connector of eligible) {
      const stops = getConnectorPath(source.floor, destination.floor, connector)
      if (!stops) continue
      const landingId = (floor) => `${connector.id}:${floor}`
      const sourceStop = stops[0]
      const destinationStop = stops.at(-1)
      const startDistance = planarDistance(source.xy, sourceStop.xy)
      const endDistance = planarDistance(destinationStop.xy, destination.xy)
      const walkingSpeed = profile === 'step_free' ? ROUTING_ASSUMPTIONS.accessible_walk_speed_mps : ROUTING_ASSUMPTIONS.walk_speed_mps
      addEdge({ from: start, to: landingId(sourceStop.floor), connectorId: connector.id, distanceM: startDistance, durationS: startDistance / walkingSpeed + (connector.type === 'lift' ? ROUTING_ASSUMPTIONS.lift_wait_seconds_per_trip : 0), points: [{ floor: source.floor, xy: source.xy }, sourceStop] })
      addEdge({ from: landingId(destinationStop.floor), to: goal, connectorId: connector.id, distanceM: endDistance, durationS: endDistance / walkingSpeed, points: [destinationStop, { floor: destination.floor, xy: destination.xy }] })
      for (const [index, fromStop] of stops.slice(0, -1).entries()) {
        const toStop = stops[index + 1]
        const floors = Math.abs(toStop.floor - fromStop.floor)
        const riseM = ROUTING_ASSUMPTIONS.floor_rise_m * floors
        const planOffsetM = planarDistance(fromStop.xy, toStop.xy)
        if (connector.type === 'stair') {
          const stairLengthM = riseM / Math.sin(ROUTING_ASSUMPTIONS.stair_angle_degrees * Math.PI / 180)
          const ascending = toStop.floor > fromStop.floor
          const seconds = stairLengthM / (ascending ? ROUTING_ASSUMPTIONS.stair_up_speed_mps : ROUTING_ASSUMPTIONS.stair_down_speed_mps)
          addEdge({ from: landingId(fromStop.floor), to: landingId(toStop.floor), connectorId: connector.id, distanceM: stairLengthM + planOffsetM, durationS: seconds, points: [fromStop, toStop] })
          addEdge({ from: landingId(toStop.floor), to: landingId(fromStop.floor), connectorId: connector.id, distanceM: stairLengthM + planOffsetM, durationS: stairLengthM / (ascending ? ROUTING_ASSUMPTIONS.stair_down_speed_mps : ROUTING_ASSUMPTIONS.stair_up_speed_mps), points: [toStop, fromStop] })
        } else {
          const liftSeconds = riseM / ROUTING_ASSUMPTIONS.lift_speed_mps + ROUTING_ASSUMPTIONS.lift_door_seconds_per_floor * floors
          addEdge({ from: landingId(fromStop.floor), to: landingId(toStop.floor), connectorId: connector.id, distanceM: riseM + planOffsetM, durationS: liftSeconds, points: [fromStop, toStop] })
          addEdge({ from: landingId(toStop.floor), to: landingId(fromStop.floor), connectorId: connector.id, distanceM: riseM + planOffsetM, durationS: liftSeconds, points: [toStop, fromStop] })
        }
      }
    }
  }

  // Dijkstra: nonnegative distance/time costs, with predecessor edges retained
  // so the preview can show which candidate connector was selected.
  const distances = new Map([[start, 0]])
  const previous = new Map()
  const queue = [{ id: start, cost: 0 }]
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost)
    const current = queue.shift()
    if (current.cost !== distances.get(current.id)) continue
    if (current.id === goal) break
    for (const edge of adjacency.get(current.id) || []) {
      const nextCost = current.cost + metric(edge)
      if (nextCost < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, nextCost)
        previous.set(edge.to, { id: current.id, edge })
        queue.push({ id: edge.to, cost: nextCost })
      }
    }
  }
  if (!distances.has(goal)) return null
  const pathEdges = []
  let cursor = goal
  while (cursor !== start) {
    const step = previous.get(cursor)
    if (!step) return null
    pathEdges.unshift(step.edge)
    cursor = step.id
  }
  const routePoints = pathEdges.flatMap((edge, index) => index === 0 ? edge.points : edge.points.slice(1))
  const uniquePoints = routePoints.filter((item, index) => index === 0 || item.floor !== routePoints[index - 1].floor || planarDistance(item.xy, routePoints[index - 1].xy) > 0.001)
  const connectorId = pathEdges.find((edge) => edge.connectorId)?.connectorId || null
  return {
    algorithm: 'dijkstra',
    profile,
    connectorId,
    points: uniquePoints.map((item) => point3(item.xy, item.floor)),
    distanceM: pathEdges.reduce((sum, edge) => sum + edge.distanceM, 0),
    durationS: pathEdges.reduce((sum, edge) => sum + edge.durationS, 0),
    floorTransitions: pathEdges.filter((edge) => edge.points.length === 2 && edge.points[0].floor !== edge.points[1].floor).length,
    candidateOnly: true,
  }
}

function WallInstances({ floor }) {
  const meshRef = useRef()
  const floorNumber = floor.floor_number
  const segments = floor.segments
  const geometry = useMemo(() => {
    return planSegments({ floor_number: floorNumber, segments })
  }, [floorNumber, segments])
  const matrices = useMemo(() => {
    const result = []
    for (const [x1, y1, x2, y2] of geometry) {
      const dx = x2 - x1
      const dy = y2 - y1
      const length = Math.hypot(dx, dy)
      const position = new THREE.Vector3((x1 + x2) / 2, WALL_HEIGHT / 2 + (floorNumber - 2) * FLOOR_GAP, -(y1 + y2) / 2)
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(dy, dx), 0))
      const scale = new THREE.Vector3(length, WALL_HEIGHT, WALL_THICKNESS)
      result.push(new THREE.Matrix4().compose(position, quaternion, scale))
    }
    return result
  }, [floorNumber, geometry])

  useEffect(() => {
    if (!meshRef.current) return
    matrices.forEach((matrix, index) => {
      meshRef.current.setMatrixAt(index, matrix)
    })
    meshRef.current.instanceMatrix.needsUpdate = true
    meshRef.current.computeBoundingSphere()
  }, [floorNumber, matrices])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, geometry.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#82919a" roughness={0.82} />
    </instancedMesh>
  )
}

function FloorPlate({ floor, index }) {
  const points = planSegments(floor).flatMap(([x1, y1, x2, y2]) => [[x1, y1], [x2, y2]])
  const bounds = points.reduce((result, [x, y]) => ({
    minX: Math.min(result.minX, x), maxX: Math.max(result.maxX, x),
    minY: Math.min(result.minY, y), maxY: Math.max(result.maxY, y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity })
  const width = bounds.maxX - bounds.minX + 2
  const depth = bounds.maxY - bounds.minY + 2
  const floorY = index * FLOOR_GAP
  return (
    <group>
      <mesh position={[(bounds.minX + bounds.maxX) / 2, floorY - 0.09, -(bounds.minY + bounds.maxY) / 2]} receiveShadow>
        <boxGeometry args={[width, 0.18, depth]} />
        <meshStandardMaterial color={FLOOR_COLORS[index]} transparent opacity={0.42} roughness={0.95} />
      </mesh>
      <WallInstances floor={floor} />
      <Text position={[bounds.minX + 2, floorY + 0.08, -bounds.minY + 1]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1.15} color="#334155" anchorX="left" anchorY="middle">
        {floor.label.toUpperCase()}
      </Text>
    </group>
  )
}

function FloorDestinations({ floor, selectedSource, selectedDestination, onPick, showLabels, labelFloor }) {
  return (
    <group>
      {floor.labels.map((label, index) => {
        const id = `${floor.floor_number}:${index}`
        const isSource = id === selectedSource
        const isDestination = id === selectedDestination
        const style = roomStyle(label.text)
        const color = isSource ? '#16a34a' : isDestination ? '#dc2626' : style.color
        const pos = point3(label.display_xy || label.xy, floor.floor_number, 0.2)
        const labelVisible = (showLabels && labelFloor === floor.floor_number) || isSource || isDestination
        return (
          <group key={id} position={pos} onClick={(event) => { event.stopPropagation(); onPick(id) }}>
            {labelVisible && <group position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <mesh position={[0, 0, -0.012]}>
                <planeGeometry args={[Math.min(6.2, Math.max(3.3, label.text.length * 0.22)), 0.92]} />
                <meshBasicMaterial color={isSource ? '#dcfce7' : isDestination ? '#fee2e2' : style.background} transparent opacity={0.94} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
              <Text fontSize={0.37} maxWidth={5.8} color="#17212b" anchorX="center" anchorY="middle" textAlign="center" outlineColor="white" outlineWidth={0.012}>
                {label.text}
              </Text>
              <mesh position={[0, 0, 0.02]}>
                <planeGeometry args={[Math.min(6.2, Math.max(3.3, label.text.length * 0.22)), 0.92]} />
                <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
              </mesh>
            </group>}
            <mesh position={[0, 0.04, 0]}>
              <circleGeometry args={[isSource || isDestination ? 0.3 : 0.2, 20]} />
              <meshBasicMaterial color={color} side={THREE.DoubleSide} />
            </mesh>
            {(isSource || isDestination) && <mesh position={[0, 0.25, 0]}><sphereGeometry args={[0.34, 12, 10]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.24} /></mesh>}
            {isSource && <Text position={[0, WALL_HEIGHT + 1.3, 0]} fontSize={0.68} color="#15803d" outlineColor="white" outlineWidth={0.08} anchorX="center">SOURCE</Text>}
            {isDestination && <Text position={[0, WALL_HEIGHT + 1.3, 0]} fontSize={0.68} color="#b91c1c" outlineColor="white" outlineWidth={0.08} anchorX="center">DESTINATION</Text>}
          </group>
        )
      })}
    </group>
  )
}

function VerticalConnections({ connectorId, sourceFloor, destinationFloor }) {
  const connector = building.vertical_connectors.find((item) => item.id === connectorId)
  if (!connector) return null
  const lowFloor = Math.min(sourceFloor, destinationFloor)
  const highFloor = Math.max(sourceFloor, destinationFloor)
  const direction = sourceFloor <= destinationFloor ? 1 : -1
  const stops = []
  for (let floor = sourceFloor; direction > 0 ? floor <= destinationFloor : floor >= destinationFloor; floor += direction) {
    const xy = connector.stops[String(floor)]
    if (!xy) return null
    stops.push({ floor, xy })
  }
  const points = stops.map((stop) => new THREE.Vector3(...point3(stop.xy, stop.floor, 0.42)))
  const color = connector.type === 'lift' ? '#0284c7' : '#ea580c'
  const labelPosition = point3(stops[Math.floor(stops.length / 2)].xy, (lowFloor + highFloor) / 2, 0.72)
  return <group>
    <Line points={points} color={color} lineWidth={4} dashed dashSize={0.7} gapSize={0.25} />
    {stops.map((stop) => <mesh key={stop.floor} position={point3(stop.xy, stop.floor, 0.42)}><sphereGeometry args={[0.5, 16, 12]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} /></mesh>)}
    <Html position={labelPosition} center distanceFactor={110} sprite zIndexRange={[30, 0]}><span style={{ padding: '3px 6px', borderRadius: 4, background: 'white', border: `2px solid ${color}`, color, font: '700 11px/1.2 system-ui, sans-serif', whiteSpace: 'nowrap' }}>{connector.label} · candidate</span></Html>
  </group>
}

function CandidateRoute({ source, destination, points }) {
  if (!points) return null
  if (source.floor === destination.floor) return <Line points={points.map((point) => new THREE.Vector3(...point))} color="#dc2626" lineWidth={4} dashed dashSize={0.75} gapSize={0.28} />
  return <group>
    <Line points={points.slice(0, 2).map((point) => new THREE.Vector3(...point))} color="#dc2626" lineWidth={4} dashed dashSize={0.75} gapSize={0.28} />
    <Line points={points.slice(-2).map((point) => new THREE.Vector3(...point))} color="#dc2626" lineWidth={4} dashed dashSize={0.75} gapSize={0.28} />
  </group>
}

function Scene({ sourceId, destinationId, setEndpoint, connectorId, routePoints, showLabels, labelFloor, controlsRef }) {
  const { camera } = useThree()
  const source = DESTINATION_BY_ID.get(sourceId)
  const destination = DESTINATION_BY_ID.get(destinationId)
  const lowFloor = Math.min(source?.floor || 2, destination?.floor || 2)
  const highFloor = Math.max(source?.floor || 2, destination?.floor || 2)
  const visibleFloors = building.floors.filter((floor) => floor.floor_number === source?.floor || floor.floor_number === destination?.floor)
  const bounds = planBounds(visibleFloors[0] || building.floors[0])
  const targetX = (bounds.minX + bounds.maxX) / 2
  const targetZ = -(bounds.minY + bounds.maxY) / 2
  const targetY = (((source?.floor || 2) + (destination?.floor || 2)) / 2 - 2) * FLOOR_GAP + WALL_HEIGHT / 2
  const target = [targetX, targetY, targetZ]
  useEffect(() => {
    if (!controlsRef.current) return
    controlsRef.current.target.set(targetX, targetY, targetZ)
    const distance = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 1.28
    camera.position.set(targetX + distance * 0.72, targetY + distance * 0.58, targetZ + distance * 0.72)
    camera.lookAt(targetX, targetY, targetZ)
    camera.updateProjectionMatrix()
    controlsRef.current.update()
    controlsRef.current.saveState()
  }, [camera, targetX, targetY, targetZ, source?.floor, destination?.floor, bounds.maxX, bounds.minX, bounds.maxY, bounds.minY])
  return (
    <>
      <color attach="background" args={['#edf2f5']} />
      <ambientLight intensity={1.3} />
      <directionalLight position={[80, 100, 40]} intensity={2.2} castShadow />
      {visibleFloors.map((floor) => <group key={floor.floor_number}><FloorPlate floor={floor} index={building.floors.findIndex((item) => item.floor_number === floor.floor_number)} /><FloorDestinations floor={floor} selectedSource={sourceId} selectedDestination={destinationId} onPick={setEndpoint} showLabels={showLabels} labelFloor={labelFloor} /></group>)}
      {lowFloor < highFloor && <VerticalConnections connectorId={connectorId} sourceFloor={source.floor} destinationFloor={destination.floor} />}
      <CandidateRoute source={source} destination={destination} points={routePoints} />
      <OrbitControls ref={controlsRef} makeDefault target={target} enableDamping dampingFactor={0.08} minDistance={12} maxDistance={260} zoomSpeed={1.15} />
    </>
  )
}

export default function MultiFloorNavigation3D() {
  const initialSource = DESTINATIONS.find((item) => item.floor === 2 && /301/.test(item.label)) || DESTINATIONS[0]
  const initialDestination = DESTINATIONS.find((item) => item.floor === 6 && /708/.test(item.label)) || DESTINATIONS.at(-1)
  const [sourceId, setSourceId] = useState(() => readEndpoint('from', initialSource.id))
  const [destinationId, setDestinationId] = useState(() => readEndpoint('to', initialDestination.id))
  const [connectorId, setConnectorId] = useState(() => new URLSearchParams(window.location.search).get('connector') || 'auto')
  const [routeProfile, setRouteProfile] = useState(readRouteProfile)
  const [activeEndpoint, setActiveEndpoint] = useState('source')
  const [showLabels, setShowLabels] = useState(true)
  const [labelFloor, setLabelFloor] = useState(initialSource.floor)
  const [showRouteQr, setShowRouteQr] = useState(false)
  const [view, setView] = useState('3d')
  const controlsRef = useRef(null)
  // Hot reloads or old bookmarked links can leave IDs that no longer exist
  // after DXF labels are regenerated. Recover to valid endpoints so route,
  // vertical connector and QR controls remain usable.
  useEffect(() => {
    if (!DESTINATION_BY_ID.has(sourceId)) setSourceId(initialSource.id)
    if (!DESTINATION_BY_ID.has(destinationId)) setDestinationId(initialDestination.id)
  }, [destinationId, initialDestination.id, initialSource.id, sourceId])
  const source = DESTINATION_BY_ID.get(sourceId) || initialSource
  const destination = DESTINATION_BY_ID.get(destinationId) || initialDestination
  const routeConnectorChoices = useMemo(() => {
    if (!source || !destination || source.floor === destination.floor) return []
    const low = Math.min(source.floor, destination.floor)
    const high = Math.max(source.floor, destination.floor)
    return building.vertical_connectors.filter((connector) => Array.from({ length: high - low + 1 }, (_, index) => String(low + index)).every((floor) => connector.stops[floor]))
  }, [destination, source])
  const candidateRoute = useMemo(
    () => findCandidateRoute(source, destination, routeConnectorChoices, routeProfile, connectorId),
    [source, destination, routeConnectorChoices, routeProfile, connectorId],
  )
  const connectorEstimates = useMemo(() => new Map(routeConnectorChoices.map((connector) => [
    connector.id,
    findCandidateRoute(source, destination, routeConnectorChoices, routeProfile, connector.id),
  ])), [source, destination, routeConnectorChoices, routeProfile])
  const selectedConnector = routeConnectorChoices.find((connector) => connector.id === candidateRoute?.connectorId)
  const pickEndpoint = (id) => {
    setLabelFloor(DESTINATION_BY_ID.get(id)?.floor || source.floor)
    if (activeEndpoint === 'source') setSourceId(id)
    else setDestinationId(id)
  }
  const routeQrUrl = useMemo(() => {
    if (!source || !destination) return ''
    const configuredBaseUrl = import.meta.env.VITE_NAVIKA_BASE_URL?.trim()
    const url = new URL('/navigation', configuredBaseUrl || window.location.origin)
    const params = new URLSearchParams({ from: source.id, to: destination.id })
    if (selectedConnector?.id) params.set('connector', selectedConnector.id)
    params.set('profile', routeProfile)
    url.search = params.toString()
    return url.toString()
  }, [destination, routeProfile, selectedConnector, source])
  const focusedFloors = source?.floor === destination?.floor
    ? source?.floorLabel
    : `${source?.floorLabel} + ${destination?.floorLabel}`
  const routeDescription = source && destination
    ? candidateRoute
      ? source.floor === destination.floor
        ? `Dijkstra same-floor preview · ${source.floorLabel}`
        : `Dijkstra ${routeProfile.replace('_', ' ')} estimate via ${selectedConnector?.label} · floors ${source.floor} to ${destination.floor}`
      : routeProfile === 'step_free'
        ? 'No candidate lift route covers these floors.'
        : 'No candidate vertical connector covers these floors.'
    : 'Choose source and destination locations.'
  const estimatedDuration = candidateRoute ? formatDuration(candidateRoute.durationS) : null

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 md:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">{building.building.building_label} · DXF only</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl">3D floors &amp; navigation preview</h1>
            <p className="mt-1 text-sm text-slate-500">DXF floor plans extruded into a stacked 3D model · select labelled places to preview a route</p>
          </div>
          <div className="flex gap-2" role="group" aria-label="View mode">
            <button onClick={() => setView('3d')} className={`rounded-xl px-4 py-2 text-sm font-semibold ${view === '3d' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}><Layers3 className="mr-2 inline h-4 w-4" />3D building</button>
            <button onClick={() => setView('plans')} className={`rounded-xl px-4 py-2 text-sm font-semibold ${view === 'plans' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}><MapIcon className="mr-2 inline h-4 w-4" />2D plans</button>
          </div>
        </header>

        <div className="grid gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)] md:p-6">
          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-200 p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Route size={16} />Source &amp; destination</h2>
              <label className="mt-4 block text-xs font-semibold text-slate-600">Source location</label>
              <select className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm" value={sourceId} onChange={(event) => { setSourceId(event.target.value); setLabelFloor(DESTINATION_BY_ID.get(event.target.value)?.floor || labelFloor) }}>
                {DESTINATIONS.map((item) => <option key={item.id} value={item.id}>{item.floorLabel} · {item.label}</option>)}
              </select>
              <label className="mt-3 block text-xs font-semibold text-slate-600">Destination</label>
              <select className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm" value={destinationId} onChange={(event) => { setDestinationId(event.target.value); setLabelFloor(DESTINATION_BY_ID.get(event.target.value)?.floor || labelFloor) }}>
                {DESTINATIONS.map((item) => <option key={item.id} value={item.id}>{item.floorLabel} · {item.label}</option>)}
              </select>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => setActiveEndpoint('source')} className={`rounded-lg border px-2 py-2 text-xs font-semibold ${activeEndpoint === 'source' ? 'border-green-600 bg-green-50 text-green-800' : 'border-slate-200 text-slate-600'}`}><MapPin size={13} className="mr-1 inline" />Pick source on model</button>
                <button onClick={() => setActiveEndpoint('destination')} className={`rounded-lg border px-2 py-2 text-xs font-semibold ${activeEndpoint === 'destination' ? 'border-red-600 bg-red-50 text-red-800' : 'border-slate-200 text-slate-600'}`}><MapPin size={13} className="mr-1 inline" />Pick destination</button>
              </div>
              <label className="mt-3 block text-xs font-semibold text-slate-600">Route preference</label>
              <select className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm" value={routeProfile} onChange={(event) => setRouteProfile(event.target.value)}>
                <option value="fastest">Fastest estimated time</option>
                <option value="shortest">Shortest estimated distance</option>
                <option value="step_free">Step-free candidate (lift only)</option>
              </select>
              {source?.floor !== destination?.floor && <>
                <label className="mt-3 block text-xs font-semibold text-slate-600">Vertical connection</label>
                <select className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm" value={connectorId} onChange={(event) => setConnectorId(event.target.value)}>
                  <option value="auto">Automatic · Dijkstra compares candidates</option>
                  {routeConnectorChoices.map((connector) => {
                    const estimate = connectorEstimates.get(connector.id)
                    const duration = estimate ? ` · ~${formatDuration(estimate.durationS)}` : ''
                    return <option key={connector.id} value={connector.id}>{connector.label}{duration} · candidate</option>
                  })}
                </select>
                {!routeConnectorChoices.length && <p className="mt-2 text-xs text-red-700">The DXF has no labelled connector covering this floor pair.</p>}
              </>}
              <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                <b>{routeDescription}</b>
                {candidateRoute && <>
                  <span className="mt-1 block text-slate-600">Focused floors: {focusedFloors} · about {candidateRoute.distanceM.toFixed(0)} m · about {estimatedDuration}</span>
                  {candidateRoute.floorTransitions > 0 && <span className="mt-1 block text-slate-500">{candidateRoute.floorTransitions} floor transitions via {selectedConnector?.type === 'stair' ? 'stairs' : 'lift'}</span>}
                  <span className="mt-1 block text-slate-500">Dijkstra score: {routeProfile === 'shortest' ? 'estimated metres' : 'estimated seconds'}.</span>
                </>}
                <span className="mt-2 block border-t border-slate-200 pt-2 text-[11px] leading-4 text-amber-800">Planning estimate only: horizontal room-to-connector links are straight-line guesses. DXF access, corridor, landing, floor-height and lift-wait data are not verified; don’t use this as live wayfinding yet.</span>
                <details className="mt-2 text-[11px] text-slate-500"><summary className="cursor-pointer font-semibold">Travel-time assumptions</summary><p className="mt-1">Walk {ROUTING_ASSUMPTIONS.walk_speed_mps} m/s; accessible walk {ROUTING_ASSUMPTIONS.accessible_walk_speed_mps} m/s; floor rise {ROUTING_ASSUMPTIONS.floor_rise_m} m; stairs {ROUTING_ASSUMPTIONS.stair_angle_degrees}° at {ROUTING_ASSUMPTIONS.stair_up_speed_mps} m/s up / {ROUTING_ASSUMPTIONS.stair_down_speed_mps} m/s down; lift {ROUTING_ASSUMPTIONS.lift_speed_mps} m/s plus {ROUTING_ASSUMPTIONS.lift_wait_seconds_per_trip}s wait.</p></details>
              </div>
              <button type="button" onClick={() => setShowRouteQr((shown) => !shown)} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"><QrCode size={16} />{showRouteQr ? 'Hide phone route QR' : 'Start navigation on phone'}</button>
              {showRouteQr && routeQrUrl && <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-center">
                <p className="text-xs font-semibold text-slate-700">Scan to open this selected route on your phone</p>
                <div className="my-3 flex justify-center"><QRCodeSVG value={routeQrUrl} size={176} level="M" includeMargin /></div>
                <p className="break-all text-[10px] text-slate-500">{routeQrUrl}</p>
                <p className="mt-2 text-[10px] text-slate-500">For local testing, set VITE_NAVIKA_BASE_URL to an address reachable from the phone.</p>
              </div>}
            </div>
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs leading-5 text-amber-950">
              <h2 className="flex items-center gap-2 font-bold"><AlertTriangle size={15} />Route review required</h2>
              <p className="mt-2">The graph draft has {navigationGraph.review_summary.verified_horizontal_edges} verified room-to-corridor connections. It contains {navigationGraph.review_summary.explicit_door_block_candidates} explicit DXF door-block candidates and {navigationGraph.review_summary.doorway_gap_candidates} geometric gap guesses, but neither set is connected to confirmed walkable corridors yet. The red line is an illustrative candidate through the selected stair/lift; review room, doorway, corridor and landing links before using routes as real-world directions.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 px-1 text-xs text-slate-600"><input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} />Show room labels</label>
              <label className="flex items-center gap-2 text-xs text-slate-600">Label floor<select className="rounded-md border border-slate-300 bg-white px-2 py-1" value={labelFloor} onChange={(event) => setLabelFloor(Number(event.target.value))}>{[...new Set([source?.floor, destination?.floor].filter(Boolean))].map((number) => <option key={number} value={number}>{building.floors.find((floor) => floor.floor_number === number)?.label}</option>)}</select></label>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Room color key</p>
              <div className="flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-slate-600">
                {[['#2563eb', 'Teaching'], ['#7c3aed', 'Labs'], ['#0f766e', 'Departments'], ['#db2777', 'Washrooms'], ['#64748b', 'Services']].map(([color, label]) => <span key={label} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}</span>)}
              </div>
              <p className="mt-2 text-[10px] leading-4 text-slate-500">Color marks the labelled room anchor; the DXF does not provide closed room polygons for safe area fills.</p>
            </div>
            <button onClick={() => { setSourceId(initialSource.id); setDestinationId(initialDestination.id); setConnectorId('auto'); setRouteProfile('fastest') }} className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"><RotateCcw size={12} className="mr-1 inline" />Reset sample selection</button>
          </aside>

          <div className="relative min-h-[680px] overflow-hidden rounded-2xl border border-slate-200 bg-[#edf2f5]">
            {view === '3d' && <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-xl border border-slate-300 bg-white/95 shadow-sm" aria-label="3D camera controls">
              <button type="button" onClick={() => { controlsRef.current?.dollyIn(1.22); controlsRef.current?.update() }} className="border-b border-slate-200 p-2 text-slate-700 hover:bg-slate-100" title="Zoom in"><Plus size={18} /></button>
              <button type="button" onClick={() => { controlsRef.current?.dollyOut(1.22); controlsRef.current?.update() }} className="border-b border-slate-200 p-2 text-slate-700 hover:bg-slate-100" title="Zoom out"><Minus size={18} /></button>
              <button type="button" onClick={() => controlsRef.current?.reset()} className="p-2 text-slate-700 hover:bg-slate-100" title="Reset camera"><Scan size={17} /></button>
            </div>}
            {view === '3d'
              ? <Canvas shadows camera={{ position: [180, 120, 100], fov: 42 }} gl={{ antialias: true }}>
                  <Scene sourceId={sourceId} destinationId={destinationId} setEndpoint={pickEndpoint} connectorId={selectedConnector?.id || ''} routePoints={candidateRoute?.points} showLabels={showLabels} labelFloor={labelFloor} controlsRef={controlsRef} />
                </Canvas>
              : <div className="h-full min-h-[680px] overflow-y-auto p-3"><MultiFloorDxfViewer /></div>}
          </div>
        </div>
        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-500 md:px-7">
          <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-green-600" />Source</span>
          <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-red-600" />Destination / candidate path</span>
          <span><i className="mr-1.5 inline-block w-6 border-t-2 border-dashed border-orange-600" />Candidate stair</span>
          <span><i className="mr-1.5 inline-block w-6 border-t-2 border-dashed border-sky-600" />Candidate lift</span>
          <span className="ml-auto">Illustrative wall height {WALL_HEIGHT} m · diagrammatic floor spacing {FLOOR_GAP} m</span>
        </footer>
      </section>
    </div>
  )
}
