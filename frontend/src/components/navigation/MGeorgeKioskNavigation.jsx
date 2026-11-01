import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import { ArrowLeft, Box, Clock, Footprints, Map as MapIcon, MapPin, Search, X } from 'lucide-react'
import { CATEGORY_LABELS, formatDuration, loadKioskFloor, routeBounds, routeFromKiosk, searchDestinations } from '../../services/mgeorgeRoute'

const IDLE_RESET_MS = 90_000
const WALL_HEIGHT = 1.6
const BRAND = '#d8151c'

function useIdleReset(onReset) {
  const callback = useRef(onReset)
  useEffect(() => {
    callback.current = onReset
  })
  useEffect(() => {
    let timer
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => callback.current(), IDLE_RESET_MS)
    }
    const events = ['pointerdown', 'keydown', 'wheel']
    events.forEach((name) => window.addEventListener(name, arm))
    arm()
    return () => {
      clearTimeout(timer)
      events.forEach((name) => window.removeEventListener(name, arm))
    }
  }, [])
}

// Where the pin goes: a reviewed entrance when the room itself is not walkable.
const pinXY = (destination) => destination.entrance_xy || destination.xy

function viewPoints(route, destination) {
  return [...route.points, pinXY(destination)]
}

function DestinationPicker({ destinations, onPick }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const categories = useMemo(() => [...new Set(destinations.map((place) => place.category))]
    .sort((a, b) => (CATEGORY_LABELS[a] || a).localeCompare(CATEGORY_LABELS[b] || b)), [destinations])
  const results = useMemo(() => searchDestinations(destinations, query)
    .filter((place) => category === 'all' || place.category === category)
    .sort((a, b) => a.name.localeCompare(b.name)), [destinations, query, category])

  return <div className="space-y-5">
    <h2 className="text-3xl font-black tracking-tight text-slate-900">Where do you want to go?</h2>
    <label className="flex items-center gap-3 rounded-2xl border-2 border-slate-300 bg-white px-5 py-4 focus-within:border-brand-500">
      <Search className="h-7 w-7 text-slate-400" />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a room, lab, office…" className="w-full bg-transparent text-xl outline-none" aria-label="Search destinations" />
      {query && <button type="button" onClick={() => setQuery('')} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Clear search"><X className="h-6 w-6" /></button>}
    </label>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
      {['all', ...categories].map((item) => <button key={item} type="button" onClick={() => setCategory(item)}
        className={`rounded-full px-5 py-3 text-base font-semibold ${category === item ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
        {item === 'all' ? 'All places' : CATEGORY_LABELS[item] || item}
      </button>)}
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {results.map((place) => <button key={place.id} type="button" onClick={() => onPick(place)}
        className="flex min-h-[76px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left shadow-sm hover:border-brand-400 hover:shadow">
        <span><span className="block text-lg font-bold leading-6 text-slate-900">{place.name}</span><span className="text-sm text-slate-500">{CATEGORY_LABELS[place.category] || place.category}</span></span>
        <MapPin className="h-6 w-6 shrink-0 text-brand-500" />
      </button>)}
      {!results.length && <p className="rounded-2xl bg-slate-50 p-6 text-lg text-slate-600 sm:col-span-2 lg:col-span-3">No place matches “{query}”. Try another word, or pick a category.</p>}
    </div>
  </div>
}

function RoutePlan2D({ walls, route, destination, kiosk }) {
  const bounds = useMemo(() => routeBounds(viewPoints(route, destination), 40, 8), [route, destination])
  const viewBox = `${bounds.minX} ${-bounds.maxY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`
  // Markers and labels keep the same on-screen size whatever the zoom.
  const unit = (bounds.maxX - bounds.minX) / 60
  const routePoints = route.points.map(([x, y]) => `${x},${-y}`).join(' ')
  const segments = (list, props) => list.map(([x1, y1, x2, y2], index) => <line key={index} x1={x1} y1={-y1} x2={x2} y2={-y2} {...props} />)
  return <svg viewBox={viewBox} className="h-full w-full" role="img" aria-label={`Floor plan with the route from the kiosk to ${destination.name}`}>
    <rect x={bounds.minX} y={-bounds.maxY} width={bounds.maxX - bounds.minX} height={bounds.maxY - bounds.minY} fill="#f8fafc" />
    <g strokeLinecap="round">
      {segments(walls.segments.stair, { stroke: '#f2c48d', strokeWidth: 0.08 })}
      {segments(walls.segments.window, { stroke: '#93c5fd', strokeWidth: 0.16 })}
      {segments(walls.segments.wall, { stroke: '#334155', strokeWidth: 0.18 })}
    </g>
    <polyline points={routePoints} fill="none" stroke="white" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    <polyline points={routePoints} fill="none" stroke={BRAND} strokeWidth={0.8} strokeLinejoin="round" strokeLinecap="round" />
    <polyline points={routePoints} fill="none" stroke="white" strokeWidth={0.3} strokeDasharray="0.6 1.8" strokeLinecap="round" className="navika-route-flow" />
    <g transform={`translate(${kiosk.xy[0]} ${-kiosk.xy[1]}) scale(${unit})`}>
      <circle r={1.6} fill="#2563eb" stroke="white" strokeWidth={0.4} />
      <text y={-2.4} textAnchor="middle" fontSize={2} fontWeight={700} fill="#1e3a8a" stroke="white" strokeWidth={0.4} paintOrder="stroke">You are here</text>
    </g>
    <g transform={`translate(${pinXY(destination)[0]} ${-pinXY(destination)[1]}) scale(${unit})`}>
      <path d="M0 0 C -1.6 -2.4 -2.2 -3.2 -2.2 -4.4 A 2.2 2.2 0 1 1 2.2 -4.4 C 2.2 -3.2 1.6 -2.4 0 0 Z" fill={BRAND} stroke="white" strokeWidth={0.35} />
      <circle cy={-4.4} r={0.8} fill="white" />
      <text y={-7.6} textAnchor="middle" fontSize={2} fontWeight={700} fill="#7f1d1d" stroke="white" strokeWidth={0.4} paintOrder="stroke">{destination.name}</text>
    </g>
  </svg>
}

function WallMeshes({ segments, color, height, thickness }) {
  const meshRef = useRef()
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    segments.forEach(([x1, y1, x2, y2], index) => {
      const length = Math.hypot(x2 - x1, y2 - y1)
      quaternion.setFromAxisAngle(up, Math.atan2(y2 - y1, x2 - x1))
      matrix.compose(new THREE.Vector3((x1 + x2) / 2, height / 2, -(y1 + y2) / 2), quaternion, new THREE.Vector3(length, height, thickness))
      mesh.setMatrixAt(index, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [segments, height, thickness])
  return <instancedMesh ref={meshRef} args={[undefined, undefined, segments.length]} castShadow>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color={color} roughness={0.85} />
  </instancedMesh>
}

function Walker({ points }) {
  const ref = useRef()
  const path = useMemo(() => {
    const cumulative = [0]
    for (let i = 1; i < points.length; i += 1) cumulative.push(cumulative[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
    return { cumulative, total: cumulative.at(-1) }
  }, [points])
  useFrame(({ clock }) => {
    if (!ref.current || !path.total) return
    const travelled = (clock.getElapsedTime() * 6) % path.total
    let i = 1
    while (i < path.cumulative.length - 1 && path.cumulative[i] < travelled) i += 1
    const t = (travelled - path.cumulative[i - 1]) / ((path.cumulative[i] - path.cumulative[i - 1]) || 1)
    const [xa, ya] = points[i - 1]
    const [xb, yb] = points[i]
    ref.current.position.set(xa + (xb - xa) * t, 0.6, -(ya + (yb - ya) * t))
  })
  return <mesh ref={ref}><sphereGeometry args={[0.6, 20, 20]} /><meshStandardMaterial color="#facc15" emissive="#f59e0b" emissiveIntensity={0.6} /></mesh>
}

function RouteModel3D({ walls, route, destination, kiosk }) {
  const bounds = useMemo(() => routeBounds(viewPoints(route, destination), 30, 4), [route, destination])
  const centre = [(bounds.minX + bounds.maxX) / 2, 0, -(bounds.minY + bounds.maxY) / 2]
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
  const floor = useMemo(() => {
    const xs = walls.segments.wall.flatMap(([x1, , x2]) => [x1, x2])
    const ys = walls.segments.wall.flatMap(([, y1, , y2]) => [y1, y2])
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
  }, [walls])
  const linePoints = route.points.map(([x, y]) => [x, 0.25, -y])
  return <Canvas shadows camera={{ position: [centre[0], span * 0.8, centre[2] + span * 0.7], fov: 45 }} gl={{ antialias: true }}>
    <color attach="background" args={['#eef2f7']} />
    <ambientLight intensity={0.75} />
    <directionalLight position={[centre[0] + 30, 60, centre[2] + 40]} intensity={1.1} castShadow />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(floor.minX + floor.maxX) / 2, -0.02, -(floor.minY + floor.maxY) / 2]} receiveShadow>
      <planeGeometry args={[floor.maxX - floor.minX + 6, floor.maxY - floor.minY + 6]} />
      <meshStandardMaterial color="#e2ddd3" />
    </mesh>
    <WallMeshes segments={walls.segments.wall} color="#9a8f86" height={WALL_HEIGHT} thickness={0.12} />
    <WallMeshes segments={walls.segments.window} color="#9cc7e6" height={WALL_HEIGHT * 0.6} thickness={0.08} />
    <Line points={linePoints} color={BRAND} lineWidth={7} />
    <Walker points={route.points} />
    <mesh position={[kiosk.xy[0], 0.9, -kiosk.xy[1]]}><cylinderGeometry args={[0.7, 0.7, 1.8, 24]} /><meshStandardMaterial color="#2563eb" /></mesh>
    <Html position={[kiosk.xy[0], 2.6, -kiosk.xy[1]]} center><div className="whitespace-nowrap rounded-full bg-blue-700 px-3 py-1 text-sm font-bold text-white shadow">You are here</div></Html>
    <mesh position={[pinXY(destination)[0], 1.4, -pinXY(destination)[1]]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.9, 2.2, 24]} /><meshStandardMaterial color={BRAND} /></mesh>
    <Html position={[pinXY(destination)[0], 3.4, -pinXY(destination)[1]]} center><div className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm font-bold text-red-800 shadow">{destination.name}</div></Html>
    <OrbitControls makeDefault target={centre} enableDamping maxPolarAngle={Math.PI / 2.2} minDistance={10} maxDistance={160} />
  </Canvas>
}

function RouteView({ floor, destination, onBack }) {
  const [mapView, setMapView] = useState(() => new URLSearchParams(window.location.search).get('map') === '3d' ? '3d' : '2d')
  const route = useMemo(() => routeFromKiosk(floor, destination), [floor, destination])
  if (!route) return <div className="space-y-4"><button type="button" onClick={onBack} className="flex items-center gap-2 rounded-xl bg-slate-100 px-5 py-3 text-lg font-semibold"><ArrowLeft className="h-5 w-5" />Choose another place</button><p className="text-lg">Sorry, no walking route to {destination.name} was found.</p></div>
  const kiosk = floor.graph.kiosk
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" onClick={onBack} className="flex items-center gap-2 rounded-xl bg-slate-100 px-5 py-3 text-lg font-semibold text-slate-800 hover:bg-slate-200"><ArrowLeft className="h-5 w-5" />Choose another place</button>
      <div className="flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Map view">
        <button type="button" onClick={() => setMapView('2d')} className={`flex items-center gap-2 rounded-lg px-5 py-3 text-base font-semibold ${mapView === '2d' ? 'bg-white shadow' : 'text-slate-600'}`}><MapIcon className="h-5 w-5" />Map</button>
        <button type="button" onClick={() => setMapView('3d')} className={`flex items-center gap-2 rounded-lg px-5 py-3 text-base font-semibold ${mapView === '3d' ? 'bg-white shadow' : 'text-slate-600'}`}><Box className="h-5 w-5" />3D</button>
      </div>
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(300px,1fr)_2fr]">
      <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><p className="text-sm font-semibold uppercase tracking-widest text-slate-500">Going to</p><h2 className="text-3xl font-black leading-tight text-slate-900">{destination.name}</h2></div>
        <div className="flex gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-2xl bg-brand-100/70 px-4 py-3"><Footprints className="h-6 w-6 text-brand-500" /><span className="text-xl font-bold">{Math.round(route.distanceM)} m</span></div>
          <div className="flex flex-1 items-center gap-2 rounded-2xl bg-brand-100/70 px-4 py-3"><Clock className="h-6 w-6 text-brand-500" /><span className="text-xl font-bold">{formatDuration(route.durationS)}</span></div>
        </div>
        <ol className="space-y-3">
          {route.steps.map((step, index) => <li key={index} className="flex gap-3 text-lg leading-7">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base font-bold text-white ${index === route.steps.length - 1 ? 'bg-brand-500' : 'bg-slate-900'}`}>{index + 1}</span>
            <span>{step.text}</span>
          </li>)}
        </ol>
      </section>
      <section className="h-[62vh] min-h-[420px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {mapView === '2d'
          ? <RoutePlan2D walls={floor.walls} route={route} destination={destination} kiosk={kiosk} />
          : <RouteModel3D walls={floor.walls} route={route} destination={destination} kiosk={kiosk} />}
      </section>
    </div>
  </div>
}

export default function MGeorgeKioskNavigation() {
  const [floor, setFloor] = useState(null)
  const [error, setError] = useState('')
  const [destination, setDestination] = useState(null)
  useIdleReset(() => setDestination(null))

  useEffect(() => {
    loadKioskFloor(1).then((loaded) => {
      setFloor(loaded)
      // ?to=<destination id> opens a route directly (assistant hand-off, QR links).
      const requested = new URLSearchParams(window.location.search).get('to')
      setDestination(loaded.graph.destinations.find((place) => place.id === requested) || null)
    }).catch((reason) => setError(reason.message))
  }, [])

  if (error) return <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-lg text-red-800">{error}</div>
  if (!floor) return <div className="rounded-3xl border border-slate-200 bg-white p-8 text-lg text-slate-600">Loading the building map…</div>

  return <div className="space-y-5">
    <div className="flex items-center gap-3 rounded-2xl bg-blue-50 px-5 py-4 text-blue-900">
      <MapPin className="h-7 w-7 shrink-0 text-blue-700" />
      <p className="text-lg"><span className="font-bold">You are here:</span> Reception, M. George Block</p>
    </div>
    {destination
      ? <RouteView floor={floor} destination={destination} onBack={() => setDestination(null)} />
      : <DestinationPicker destinations={floor.graph.destinations} onPick={setDestination} />}
  </div>
}
