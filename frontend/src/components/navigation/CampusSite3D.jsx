import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { Building2, MapPin, RotateCcw, TriangleAlert } from 'lucide-react'
import site from '../../data/varnam_college_site_candidate.json'

const LANDMARKS = site.features.filter((item) => item.category === 'building')
const COLORS = {
  PDF_0: '#9aa6ad',
  PDF_BOUNDARY: '#64748b',
  PDF_Lines: '#7c8a91',
  PDF_Wall: '#334155',
  'PDF_INTERNAL ROAD': '#b68a59',
  PDF_ROAD: '#c4a77d',
  'PDF_foot path': '#0f766e',
  PDF_STAIR: '#d97706',
  PDF_PAVING: '#94a3b8',
}
const PLAN_SCALE = 1000
const PLAN_BOUNDS = site.scope.bounds_xy

function toWorld(x, y, lift = 0.12) {
  return [(x - PLAN_BOUNDS[0]) / PLAN_SCALE, lift, -(y - PLAN_BOUNDS[2]) / PLAN_SCALE]
}

function SiteLinework() {
  const geometries = useMemo(() => Object.entries(site.layer_segments).map(([layer, segments]) => {
    const points = new Float32Array(segments.length * 6)
    segments.forEach(([x1, y1, x2, y2], index) => {
      const a = toWorld(x1, y1)
      const b = toWorld(x2, y2)
      points.set([a[0], a[1], a[2], b[0], b[1], b[2]], index * 6)
    })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(points, 3))
    return { layer, geometry }
  }), [])
  return <group>{geometries.map(({ layer, geometry }) => <lineSegments key={layer} geometry={geometry}>
    <lineBasicMaterial color={COLORS[layer] || '#94a3b8'} transparent opacity={layer === 'PDF_0' ? 0.38 : 0.78} />
  </lineSegments>)}</group>
}

function DiagrammaticWalls() {
  const meshRef = useRef(null)
  const segments = site.layer_segments.PDF_Wall || []
  const matrices = useMemo(() => segments.map(([x1, y1, x2, y2]) => {
    const a = toWorld(x1, y1, 0)
    const b = toWorld(x2, y2, 0)
    const dx = b[0] - a[0]
    const dz = b[2] - a[2]
    const length = Math.hypot(dx, dz)
    const position = new THREE.Vector3((a[0] + b[0]) / 2, 0.06, (a[2] + b[2]) / 2)
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(dz, dx), 0))
    return new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(length, 0.12, 0.006))
  }), [segments])
  useEffect(() => {
    if (!meshRef.current) return
    matrices.forEach((matrix, index) => meshRef.current.setMatrixAt(index, matrix))
    meshRef.current.instanceMatrix.needsUpdate = true
    meshRef.current.computeBoundingSphere()
  }, [matrices])
  return <instancedMesh ref={meshRef} args={[undefined, undefined, segments.length]}>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color="#64727b" roughness={0.88} />
  </instancedMesh>
}

function LandmarkMarkers({ onSelect, selectedId }) {
  return <group>{LANDMARKS.map((item) => {
    const position = toWorld(item.x, item.y, 0.28)
    const active = item.label.toUpperCase() === 'RAMANUJAN BLOCK'
    return <group key={item.id} position={position} onClick={(event) => { event.stopPropagation(); onSelect(item) }}>
      <mesh position={[0, 0.18, 0]}><cylinderGeometry args={[0.055, 0.055, 0.36, 8]} /><meshStandardMaterial color={active ? '#0891b2' : '#475569'} emissive={active ? '#0e7490' : '#334155'} emissiveIntensity={0.2} /></mesh>
      <mesh><sphereGeometry args={[active ? 0.15 : 0.1, 14, 12]} /><meshStandardMaterial color={active ? '#06b6d4' : '#64748b'} emissive={active ? '#0e7490' : '#334155'} emissiveIntensity={0.26} /></mesh>
      <Html position={[0, 0.48, 0]} center distanceFactor={48} zIndexRange={[25, 0]}>
        <button type="button" onClick={(event) => { event.stopPropagation(); onSelect(item) }} className={`whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-bold shadow ${active ? 'border-cyan-600 bg-cyan-50 text-cyan-900' : 'border-slate-300 bg-white/95 text-slate-700'} ${selectedId === item.id ? 'ring-2 ring-cyan-400' : ''}`}>{item.label}</button>
      </Html>
    </group>
  })}</group>
}

function CampusScene({ selectedId, onSelect, controlsRef }) {
  const centerX = (PLAN_BOUNDS[0] + PLAN_BOUNDS[1]) / 2
  const centerY = (PLAN_BOUNDS[2] + PLAN_BOUNDS[3]) / 2
  const target = toWorld(centerX, centerY, 0)
  const width = (PLAN_BOUNDS[1] - PLAN_BOUNDS[0]) / PLAN_SCALE
  const depth = (PLAN_BOUNDS[3] - PLAN_BOUNDS[2]) / PLAN_SCALE
  return <>
    <color attach="background" args={['#edf2f5']} />
    <ambientLight intensity={1.3} />
    <directionalLight position={[20, 35, 20]} intensity={1.8} />
    <mesh position={[target[0], -0.12, target[2]]} receiveShadow><boxGeometry args={[width, 0.22, depth]} /><meshStandardMaterial color="#f4f7f7" roughness={0.96} /></mesh>
    <gridHelper args={[Math.max(width, depth) * 1.2, 40, '#94a3b8', '#d6dee2']} position={[target[0], -0.005, target[2]]} />
    <SiteLinework />
    <DiagrammaticWalls />
    <LandmarkMarkers selectedId={selectedId} onSelect={onSelect} />
    <OrbitControls ref={controlsRef} makeDefault target={target} enableDamping dampingFactor={0.08} minDistance={8} maxDistance={130} />
  </>
}

export default function CampusSite3D({ onOpenRamanujan }) {
  const [selected, setSelected] = useState(LANDMARKS.find((item) => item.label.toUpperCase() === 'RAMANUJAN BLOCK') || LANDMARKS[0])
  const controlsRef = useRef(null)
  const floors = site.floor_labels
  return <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 md:px-7">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Varnam college layout · DXF site layer</p><h1 className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl">Campus outdoor overview</h1><p className="mt-1 text-sm text-slate-500">3D plan view with raised building markers · orbit, pan and zoom</p></div>
      <button type="button" onClick={onOpenRamanujan} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"><Building2 className="mr-2 inline h-4 w-4" />Open Ramanujan indoor floors</button>
    </header>
    <div className="grid gap-4 p-4 lg:grid-cols-[300px_minmax(0,1fr)] md:p-6">
      <aside className="space-y-4">
        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4"><h2 className="flex items-center gap-2 text-sm font-bold text-cyan-950"><MapPin size={16} />Selected landmark</h2><div className="mt-2 text-lg font-bold text-slate-900">{selected?.label || 'Campus site'}</div><p className="mt-2 text-xs leading-5 text-slate-600">The marker uses the DXF text anchor. It does not define the building footprint or an entrance point.</p>{selected?.label.toUpperCase() === 'RAMANUJAN BLOCK' && <button onClick={onOpenRamanujan} className="mt-3 w-full rounded-lg bg-cyan-800 px-3 py-2 text-sm font-semibold text-white">View its available indoor floors</button>}</div>
        <div className="rounded-2xl border border-slate-200 p-4"><h2 className="text-sm font-bold text-slate-900">Floor labels found in this file</h2><div className="mt-3 space-y-2">{floors.map((item, index) => <div key={`${item.text}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs"><span className="font-semibold text-slate-800">{item.text}</span><span className="ml-2 text-amber-700">building not identified</span></div>)}</div><p className="mt-2 text-[11px] leading-4 text-slate-500">These labels cannot yet be linked safely to the Ramanujan second-to-sixth-floor model.</p></div>
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs leading-5 text-amber-950"><h2 className="flex items-center gap-2 font-bold"><TriangleAlert size={15} />Registration and routes need review</h2><p className="mt-2">The file declares inches and appears PDF-derived. Its scale and placement are not field-verified. No outdoor walking graph, vertical links, or outdoor-to-indoor connection is confirmed; the lines and raised markers are for visual context only.</p></div>
        <p className="text-[11px] leading-4 text-slate-500">Wall-layer lines are raised to a diagrammatic 3 m for depth. This is not a measured building height or complete exterior model.</p>
      </aside>
      <div className="relative min-h-[620px] overflow-hidden rounded-2xl border border-slate-200 bg-[#edf2f5]">
        <button type="button" onClick={() => controlsRef.current?.reset()} title="Reset camera" className="absolute right-3 top-3 z-10 rounded-xl border border-slate-300 bg-white p-2 text-slate-700 shadow"><RotateCcw size={17} /></button>
        <Canvas camera={{ position: [42, 58, 44], fov: 42 }} gl={{ antialias: true }}><CampusScene selectedId={selected?.id} onSelect={setSelected} controlsRef={controlsRef} /></Canvas>
      </div>
    </div>
    <footer className="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500 md:px-7">{Object.entries(COLORS).map(([layer, color]) => <span key={layer} className="inline-flex items-center gap-1.5"><i className="h-2 w-4 rounded" style={{ background: color }} />{layer.replace('PDF_', '')}</span>)}<span className="ml-auto">Site layers on ground plane · PDF_Wall extruded 3 m diagrammatically · physical dimensions unverified</span></footer>
  </section>
}
