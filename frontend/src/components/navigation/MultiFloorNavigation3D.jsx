import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { Box, Html, Line, OrbitControls, Text } from '@react-three/drei'
import { QRCodeSVG } from 'qrcode.react'
import { AlertTriangle, Layers3, Map as MapIcon, MapPin, Minus, Plus, QrCode, Route, RotateCcw, Scan } from 'lucide-react'
import building from '../../data/ramanujan_floors_2_6.json'
import navigationGraph from '../../data/ramanujan_navigation_graph_candidate.json'
import MultiFloorDxfViewer from './MultiFloorDxfViewer'
import RamanujanFloorModel3D from './RamanujanFloorModel3D'
import { findRamanujanRoute } from '../../services/ramanujanRoute'

const FLOOR_GAP = 6
const WALL_HEIGHT = 3
const WALL_THICKNESS = 0.09
const FLOOR_COLORS = ['#c9c9c6', '#c9c9c6', '#c9c9c6', '#c9c9c6', '#c9c9c6']
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
      <meshStandardMaterial color="#98585b" roughness={0.9} />
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
        <meshStandardMaterial color={FLOOR_COLORS[index]} roughness={0.96} />
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

function StairBeam({ start, end, thickness = 0.07, color = '#5b5b60' }) {
  const a = new THREE.Vector3(...start)
  const b = new THREE.Vector3(...end)
  const direction = b.clone().sub(a)
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.clone().normalize())
  const center = a.clone().add(b).multiplyScalar(0.5)
  return <mesh position={center} quaternion={quaternion}>
    <boxGeometry args={[direction.length(), thickness, thickness]} />
    <meshStandardMaterial color={color} roughness={0.72} />
  </mesh>
}

function StairFlightModel({ xStart, z, baseY, rise, run, width, steps, reverse = false, color }) {
  const stepRun = run / steps
  const riser = rise / steps
  const xAt = (distance) => reverse ? xStart - distance : xStart + distance
  const railSides = [-width / 2, width / 2]
  return <group>
    {Array.from({ length: steps }, (_, index) => {
      const distance = (index + 0.5) * stepRun
      const topY = baseY + (index + 1) * riser
      const edgeX = xAt((index + 1) * stepRun)
      return <group key={index}>
        <Box args={[stepRun + 0.04, 0.08, width]} position={[xAt(distance), topY - 0.04, z]}>
          <meshStandardMaterial color={color} roughness={0.88} />
        </Box>
        <Box args={[0.075, riser, width]} position={[edgeX, topY - riser / 2, z]}>
          <meshStandardMaterial color="#9b968e" roughness={0.9} />
        </Box>
      </group>
    })}
    {railSides.map((side) => {
      const bottom = [xAt(0), baseY + 0.14, z + side]
      const top = [xAt(run), baseY + rise + 0.98, z + side]
      const count = Math.ceil(steps / 2)
      return <group key={side}>
        <StairBeam start={bottom} end={top} />
        {Array.from({ length: count + 1 }, (_, index) => {
          const fraction = index / count
          const x = xAt(run * fraction)
          const y = baseY + rise * fraction + 0.53
          return <Box key={index} args={[0.055, 0.92, 0.055]} position={[x, y, z + side]}>
            <meshStandardMaterial color="#6b6b70" metalness={0.16} roughness={0.62} />
          </Box>
        })}
      </group>
    })}
  </group>
}

function StaircaseModel({ connector, lowerFloor, upperFloor, selected, showLabel }) {
  const lower = connector.stops[String(lowerFloor)]
  const upper = connector.stops[String(upperFloor)]
  if (!lower || !upper) return null
  const centerX = (lower[0] + upper[0]) / 2
  const centerZ = -(lower[1] + upper[1]) / 2
  const baseY = (lowerFloor - 2) * FLOOR_GAP + 0.13
  const rise = FLOOR_GAP - 0.22
  const run = 2.8
  const width = 1.15
  const flightRise = rise / 2
  const firstBase = baseY
  const midBase = baseY + flightRise
  const firstX = -run / 2
  const secondX = run / 2
  const color = selected ? '#c99a64' : '#b8b1a5'
  const labelPosition = [centerX, baseY + rise / 2 + 0.7, centerZ]
  return <group position={[centerX, 0, centerZ]} rotation={[0, connector.id === 'stair_west' || connector.id === 'stair_east' ? Math.PI / 2 : 0, 0]}>
    <Box args={[1.15, 0.12, width * 2.5]} position={[run / 2, midBase, 0]}>
      <meshStandardMaterial color="#aaa49a" roughness={0.9} />
    </Box>
    <StairFlightModel xStart={firstX} z={-width / 2} baseY={firstBase} rise={flightRise} run={run} width={width} steps={8} color={color} />
    <StairFlightModel xStart={secondX} z={width / 2} baseY={midBase} rise={flightRise} run={run} width={width} steps={8} reverse color={color} />
    <Box args={[1.2, 0.12, width]} position={[firstX, baseY, -width / 2]}><meshStandardMaterial color="#aaa49a" /></Box>
    <Box args={[1.2, 0.12, width]} position={[firstX, baseY + rise, width / 2]}><meshStandardMaterial color="#aaa49a" /></Box>
    {showLabel && <Html position={labelPosition} center distanceFactor={95} sprite zIndexRange={[30, 0]}>
      <span style={{ padding: '3px 6px', borderRadius: 5, background: '#fff7ed', border: '1px solid #c2410c', color: '#7c2d12', font: '700 10px/1.2 system-ui,sans-serif', whiteSpace: 'nowrap' }}>{connector.label} · schematic</span>
    </Html>}
  </group>
}

function LiftShaftModel({ connector, sourceFloor, destinationFloor, selected }) {
  const low = Math.min(sourceFloor, destinationFloor)
  const high = Math.max(sourceFloor, destinationFloor)
  const served = Object.keys(connector.stops).map(Number).filter((floor) => floor >= low && floor <= high).sort((a, b) => a - b)
  const linked = served.filter((floor, index) => index < served.length - 1 && served[index + 1] === floor + 1)
  if (!linked.length) return null
  const centers = served.map((floor) => connector.stops[String(floor)])
  const x = centers.reduce((sum, point) => sum + point[0], 0) / centers.length
  const z = -centers.reduce((sum, point) => sum + point[1], 0) / centers.length
  const baseY = (served[0] - 2) * FLOOR_GAP + 0.1
  const topY = (served.at(-1) - 2) * FLOOR_GAP
  const height = Math.max(0.5, topY - baseY + 2.25)
  const width = 1.75
  const depth = 1.65
  const wall = 0.08
  const glass = { color: selected ? '#8ed8ee' : '#cbd5e1', transparent: true, opacity: 0.17, depthWrite: false, roughness: 0.25, metalness: 0.2 }
  const frame = selected ? '#0284c7' : '#748394'
  return <group position={[x, 0, z]}>
    <Box args={[wall, height, depth]} position={[-width / 2, baseY + height / 2, 0]}><meshStandardMaterial {...glass} /></Box>
    <Box args={[wall, height, depth]} position={[width / 2, baseY + height / 2, 0]}><meshStandardMaterial {...glass} /></Box>
    <Box args={[width, height, wall]} position={[0, baseY + height / 2, depth / 2]}><meshStandardMaterial {...glass} /></Box>
    {[-1, 1].flatMap((sideX) => [-1, 1].map((sideZ) => <Box key={`shaft-edge-${sideX}-${sideZ}`} args={[0.09, height, 0.09]} position={[sideX * width / 2, baseY + height / 2, sideZ * depth / 2]}><meshStandardMaterial color={frame} metalness={0.35} roughness={0.4} /></Box>))}
    {served.map((floor) => {
      const y = (floor - 2) * FLOOR_GAP + 0.15
      return <group key={floor} position={[0, y, -depth / 2]}>
        <Box args={[0.08, 2.15, 0.09]} position={[-0.58, 1.08, 0]}><meshStandardMaterial color={frame} /></Box>
        <Box args={[0.08, 2.15, 0.09]} position={[0.58, 1.08, 0]}><meshStandardMaterial color={frame} /></Box>
        <Box args={[1.2, 0.08, 0.09]} position={[0, 2.16, 0]}><meshStandardMaterial color={frame} /></Box>
        {[-1, 1].map((side) => <Box key={side} args={[0.52, 2.02, 0.06]} position={[side * 0.27, 1.04, 0.02]}><meshStandardMaterial color={selected ? '#94d9ed' : '#d1d5db'} metalness={0.18} roughness={0.35} /></Box>)}
        <Html position={[0, 2.42, 0]} center distanceFactor={100} sprite zIndexRange={[30, 0]}><span style={{ padding: '2px 5px', borderRadius: 4, background: 'white', border: `1px solid ${frame}`, color: '#334155', font: '700 9px/1.2 system-ui,sans-serif', whiteSpace: 'nowrap' }}>{building.floors.find((item) => item.floor_number === floor)?.label}</span></Html>
      </group>
    })}
    <Html position={[0, baseY + height / 2, 0]} center distanceFactor={90} sprite zIndexRange={[30, 0]}><span style={{ padding: '3px 6px', borderRadius: 5, background: 'white', border: `1px solid ${frame}`, color: frame, font: '700 10px/1.2 system-ui,sans-serif', whiteSpace: 'nowrap' }}>{connector.label} · schematic</span></Html>
  </group>
}

function VerticalConnections({ connectorId, sourceFloor, destinationFloor }) {
  const low = Math.min(sourceFloor, destinationFloor)
  const high = Math.max(sourceFloor, destinationFloor)
  if (low === high) return null
  const connectors = building.vertical_connectors
  const selected = connectors.find((item) => item.id === connectorId)
  const pairs = Array.from({ length: high - low }, (_, index) => [low + index, low + index + 1])
  const selectedLabelFloor = Math.floor((low + high - 1) / 2)
  const selectedPath = selected ? Array.from({ length: high - low + 1 }, (_, index) => low + index).map((floor) => connectorPoint(selected, floor)).filter(Boolean) : []
  return <group>
    {connectors.map((connector) => connector.type === 'stair'
      ? pairs.map(([lower, upper]) => connector.stops[String(lower)] && connector.stops[String(upper)]
        ? <StaircaseModel key={`${connector.id}-${lower}`} connector={connector} lowerFloor={lower} upperFloor={upper} selected={connector.id === connectorId} showLabel={connector.id === connectorId && lower === selectedLabelFloor} />
        : null)
      : <LiftShaftModel key={connector.id} connector={connector} sourceFloor={low} destinationFloor={high} selected={connector.id === connectorId} />)}
    {selectedPath.length > 1 && <Line points={selectedPath.map((point) => new THREE.Vector3(...point3(point.xy, point.floor, 0.48)))} color={selected.type === 'lift' ? '#0284c7' : '#ea580c'} lineWidth={3} dashed dashSize={0.55} gapSize={0.22} />}
  </group>
}

function connectorPoint(connector, floor) {
  const xy = connector.stops[String(floor)]
  return xy ? { floor, xy } : null
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
  const visibleFloors = building.floors.filter((floor) => floor.floor_number >= lowFloor && floor.floor_number <= highFloor)
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
      <color attach="background" args={['#202025']} />
      <ambientLight intensity={1.25} color="#f7f1e8" />
      <directionalLight position={[80, 100, 40]} intensity={2.1} castShadow />
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
  const [showRouteQr, setShowRouteQr] = useState(() => new URLSearchParams(window.location.search).get('qr') === '1')
  const [qrBaseUrl, setQrBaseUrl] = useState(() => import.meta.env.VITE_NAVIKA_BASE_URL?.trim() || window.location.origin)
  const [view, setView] = useState('3d')
  const [detailFloor, setDetailFloor] = useState(initialSource.floor)
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
    () => findRamanujanRoute(source, destination, routeConnectorChoices, routeProfile, ROUTING_ASSUMPTIONS, connectorId, new Map(building.floors.map((floor) => [floor.floor_number, floor.label]))),
    [source, destination, routeConnectorChoices, routeProfile, connectorId],
  )
  const connectorEstimates = useMemo(() => new Map(routeConnectorChoices.map((connector) => [
    connector.id,
    findRamanujanRoute(source, destination, routeConnectorChoices, routeProfile, ROUTING_ASSUMPTIONS, connector.id, new Map(building.floors.map((floor) => [floor.floor_number, floor.label]))),
  ])), [source, destination, routeConnectorChoices, routeProfile])
  const selectedConnector = routeConnectorChoices.find((connector) => connector.id === candidateRoute?.connectorId)
  const pickEndpoint = (id) => {
    setLabelFloor(DESTINATION_BY_ID.get(id)?.floor || source.floor)
    if (activeEndpoint === 'source') setSourceId(id)
    else setDestinationId(id)
  }
  const routeQrUrl = useMemo(() => {
    if (!source || !destination) return ''
    try {
      const url = new URL('/mobile-route', qrBaseUrl.trim())
      const params = new URLSearchParams({ from: source.id, to: destination.id })
      if (selectedConnector?.id) params.set('connector', selectedConnector.id)
      params.set('profile', routeProfile)
      url.search = params.toString()
      return url.toString()
    } catch {
      return ''
    }
  }, [destination, qrBaseUrl, routeProfile, selectedConnector, source])
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
  const qrHost = routeQrUrl ? new URL(routeQrUrl).hostname.replace(/^\[|\]$/g, '') : ''
  const qrIsLoopback = ['localhost', '127.0.0.1', '::1'].includes(qrHost)

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 md:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">{building.building.building_label} · indoor navigation</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl">3D floors &amp; navigation preview</h1>
            <p className="mt-1 text-sm text-slate-500">Explore the connected Second–Sixth Floor model, choose a destination and preview its candidate route.</p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="View mode">
            <button onClick={() => setView('3d')} className={`rounded-xl px-4 py-2 text-sm font-semibold ${view === '3d' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}><Layers3 className="mr-2 inline h-4 w-4" />3D building</button>
            <button onClick={() => { setDetailFloor(source.floor); setView('detail') }} className={`rounded-xl px-4 py-2 text-sm font-semibold ${view === 'detail' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}><Layers3 className="mr-2 inline h-4 w-4" />Detailed floor 3D</button>
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
              <button type="button" disabled={!candidateRoute} onClick={() => setShowRouteQr((shown) => !shown)} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"><QrCode size={16} />{showRouteQr ? 'Hide phone route QR' : 'Start navigation on phone'}</button>
              {!candidateRoute && <p className="mt-2 text-xs text-slate-500">QR generation is enabled when a same-floor or candidate connector route is available.</p>}
              {showRouteQr && candidateRoute && routeQrUrl && <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-center">
                <p className="text-xs font-semibold text-slate-700">Scan to open this selected route on your phone</p>
                <label className="mt-3 block text-left text-[11px] font-semibold text-slate-600">Phone-reachable NAVIKA address<input value={qrBaseUrl} onChange={(event) => setQrBaseUrl(event.target.value)} placeholder="http://192.168.x.x:5177" className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-xs font-normal" /></label>
                <div className="my-3 flex justify-center"><QRCodeSVG value={routeQrUrl} size={176} level="M" includeMargin /></div>
                <p className="break-all text-[10px] text-slate-500">{routeQrUrl}</p>
                <p className="mt-2 text-[10px] text-slate-500">{qrIsLoopback ? 'This address points back to this computer, so a phone cannot open it. Replace localhost/127.0.0.1 with this computer’s LAN IP and keep the phone on the same Wi-Fi or hotspot.' : `Open on a phone connected to the same Wi-Fi or hotspot. This QR uses ${new URL(routeQrUrl).host}; keep the NAVIKA server running.`}</p>
              </div>}
              {showRouteQr && candidateRoute && !routeQrUrl && <p className="mt-2 text-xs text-red-700">Enter a valid base address, for example http://192.168.1.20:5177.</p>}
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
            {view === 'detail' && <label className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Floor model<select value={detailFloor} onChange={(event) => setDetailFloor(Number(event.target.value))} className="rounded-md border border-slate-300 bg-white px-2 py-1">{building.floors.map((floor) => <option key={floor.floor_number} value={floor.floor_number}>{floor.label}</option>)}</select></label>}
            {view === '3d' && <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-xl border border-slate-300 bg-white/95 shadow-sm" aria-label="3D camera controls">
              <button type="button" onClick={() => { controlsRef.current?.dollyIn(1.22); controlsRef.current?.update() }} className="border-b border-slate-200 p-2 text-slate-700 hover:bg-slate-100" title="Zoom in"><Plus size={18} /></button>
              <button type="button" onClick={() => { controlsRef.current?.dollyOut(1.22); controlsRef.current?.update() }} className="border-b border-slate-200 p-2 text-slate-700 hover:bg-slate-100" title="Zoom out"><Minus size={18} /></button>
              <button type="button" onClick={() => controlsRef.current?.reset()} className="p-2 text-slate-700 hover:bg-slate-100" title="Reset camera"><Scan size={17} /></button>
            </div>}
            {view === '3d'
              ? <Canvas shadows camera={{ position: [180, 120, 100], fov: 42 }} gl={{ antialias: true }}>
                  <Scene sourceId={sourceId} destinationId={destinationId} setEndpoint={pickEndpoint} connectorId={selectedConnector?.id || ''} routePoints={candidateRoute?.points.map((point) => point3(point.xy, point.floor))} showLabels={showLabels} labelFloor={labelFloor} controlsRef={controlsRef} />
                </Canvas>
              : view === 'detail'
                ? <RamanujanFloorModel3D floorNumber={detailFloor} source={source} destination={destination} />
                : <div className="h-full min-h-[680px] overflow-y-auto p-3"><MultiFloorDxfViewer /></div>}
          </div>
        </div>
        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 px-5 py-3 text-xs text-slate-500 md:px-7">
          <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-green-600" />Source</span>
          <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-red-600" />Destination / candidate path</span>
          <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-orange-700" />Schematic stairs</span>
          <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-sky-600" />Schematic lift shaft</span>
          <span className="ml-auto">Illustrative wall height {WALL_HEIGHT} m · diagrammatic floor spacing {FLOOR_GAP} m</span>
        </footer>
      </section>
    </div>
  )
}
