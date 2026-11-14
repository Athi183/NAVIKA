import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Billboard, Text } from '@react-three/drei'
import { Storey } from './CampusBlocks'

// The rest of the campus around M. George and Ramanujan, from OpenStreetMap
// (scripts/build_campus_osm.py): hostels, labs, the canteen, trees and their
// names, standing on the campus ground (the grass, pitches, parking, ponds and
// boundary are painted on it by CampusGround). Wherever this is drawn the map
// must credit "© OpenStreetMap contributors" (MGeorgeBuilding3D does).

const LABEL_FONT = '/fonts/NotoSans-Bold.ttf'
const TAP_SLOP_PX = 8
const STOREY_M = 3.3
const CANOPY_M = 4.2 // open-air roofs (the open auditorium) stand on posts at this height
const LOOKS = {
  hostel: { wall: '#EBD5B3', band: '#8C6A45', roof: '#F6EDDF', edge: '#5f4630' },
  lab: { wall: '#C5CFD9', band: '#56687A', roof: '#EDF1F5', edge: '#3b4a59' },
  canteen: { wall: '#EDB98E', band: '#9B5536', roof: '#F8E5D3', edge: '#6b3a24' },
  cafe: { wall: '#EDB98E', band: '#9B5536', roof: '#F8E5D3', edge: '#6b3a24' },
  college: { wall: '#D9CDBF', band: '#7A6A5B', roof: '#F1EBE3', edge: '#54483d' },
  other: { wall: '#D3CCC2', band: '#7d746a', roof: '#EEEAE4', edge: '#58514a' },
  neighbour: { wall: '#8E959C', band: '#666d74', roof: '#A9B0B6', edge: '#4d5359' },
}
const TREE_GREENS = ['#3F7A3A', '#4C8C3F', '#356B34', '#5A9446']

const toWorld = ([x, y], height) => [x, height, -y]
const centreOf = (outline) => [0, 1].map((axis) => outline.reduce((sum, point) => sum + point[axis], 0) / outline.length)
// Fixed per-position "random" number in [0, 1), so trees keep their look between visits.
const jitter = (x, y) => ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1

/** Every tree as two instanced meshes (trunks, crowns), varied in size and shade. */
function Trees({ trees, ground }) {
  const trunkRef = useRef()
  const crownRef = useRef()
  useEffect(() => {
    const matrix = new THREE.Matrix4()
    const turn = new THREE.Quaternion()
    const colour = new THREE.Color()
    trees.forEach(({ xy: [x, y] }, index) => {
      const size = 0.75 + jitter(x, y) * 0.65
      const base = ground([x, y])
      turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), jitter(y, x) * Math.PI)
      matrix.compose(new THREE.Vector3(x, base + 1.2 * size, -y), turn, new THREE.Vector3(size, size, size))
      trunkRef.current.setMatrixAt(index, matrix)
      matrix.compose(new THREE.Vector3(x, base + 3.5 * size, -y), turn, new THREE.Vector3(size, size * (0.9 + jitter(x + 1, y) * 0.35), size))
      crownRef.current.setMatrixAt(index, matrix)
      crownRef.current.setColorAt(index, colour.set(TREE_GREENS[Math.floor(jitter(x, y + 1) * TREE_GREENS.length)]))
    })
    for (const mesh of [trunkRef.current, crownRef.current]) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    crownRef.current.instanceColor.needsUpdate = true
  }, [trees, ground])
  return <group>
    <instancedMesh ref={trunkRef} args={[undefined, undefined, trees.length]}>
      <cylinderGeometry args={[0.2, 0.3, 2.4, 6]} />
      <meshStandardMaterial color="#6B4A2F" roughness={1} />
    </instancedMesh>
    <instancedMesh ref={crownRef} args={[undefined, undefined, trees.length]}>
      <icosahedronGeometry args={[2.3, 1]} />
      <meshStandardMaterial flatShading roughness={0.9} />
    </instancedMesh>
  </group>
}

/** An open-air roof on posts (OSM building=roof), such as the open auditorium. */
function Canopy({ outline, look }) {
  const posts = outline.filter((_, index) => index % 2 === 0)
  return <group>
    <Storey parts={[{ outer: outline, holes: [] }]} base={CANOPY_M} height={0.8} look={look} />
    {posts.map(([x, y], index) => <mesh key={index} position={[x, CANOPY_M / 2, -y]}>
      <cylinderGeometry args={[0.18, 0.18, CANOPY_M, 8]} />
      <meshStandardMaterial color={look.band} roughness={0.8} />
    </mesh>)}
  </group>
}

function OsmBuilding({ building, onPickPlace, ground }) {
  const look = LOOKS[building.kind] ?? LOOKS.other
  const parts = useMemo(() => [{ outer: building.outline, holes: [] }], [building])
  // On a slope, the lowest corner: the building is dug into the higher side, never floating.
  const base = useMemo(() => Math.min(...building.outline.map((point) => ground(point))), [building, ground])
  const pickable = Boolean(onPickPlace && building.place_id)
  const events = pickable ? {
    onClick: (event) => {
      if (event.delta > TAP_SLOP_PX) return
      event.stopPropagation()
      onPickPlace(building.place_id)
    },
    onPointerOver: () => { document.body.style.cursor = 'pointer' },
    onPointerOut: () => { document.body.style.cursor = '' },
  } : {}
  return <group position={[0, base, 0]} {...events}>
    {building.roof_only
      ? <Canopy outline={building.outline} look={look} />
      : Array.from({ length: building.levels }, (_, level) => <Storey key={level} parts={parts} base={level * STOREY_M} height={STOREY_M} look={look} />)}
  </group>
}

/**
 * `osm` as loaded from campus_osm.json, standing on the campus ground
 * (`ground(xy)` = its height). `onPickPlace(id)` when a building that is also a campus place is tapped.
 */
export default function CampusOsmLayer({ osm, ground, onPickPlace = null }) {
  // Buildings that are also campus places already carry that place's label.
  const labels = useMemo(() => [
    ...osm.buildings.filter((building) => building.name && !building.place_id).map((building) => ({
      name: building.name,
      xy: centreOf(building.outline),
      height: Math.min(...building.outline.map((point) => ground(point))) + (building.roof_only ? CANOPY_M + 0.8 : building.levels * STOREY_M),
    })),
    ...osm.areas.filter((area) => area.show_label).map((area) => ({ name: area.name, xy: centreOf(area.outline), height: ground(centreOf(area.outline)) })),
  ], [osm, ground])
  return <group>
    {osm.buildings.map((building) => <OsmBuilding key={building.id} building={building} onPickPlace={onPickPlace} ground={ground} />)}
    {osm.trees.length > 0 && <Trees trees={osm.trees} ground={ground} />}
    <Suspense fallback={null}>
      {labels.map((label) => <Billboard key={label.name} position={toWorld(label.xy, label.height + 5)}>
        <Text font={LABEL_FONT} fontSize={3.2} color="#ffffff" outlineWidth={0.2} outlineColor="#202025" anchorX="center" anchorY="middle">{label.name}</Text>
      </Billboard>)}
    </Suspense>
  </group>
}
