import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Billboard, Text } from '@react-three/drei'
import { RoofDetails, Storey } from './CampusBlocks'
import { TREE_KINDS, jitter, treeGeometries, treeKind, treeSize } from './campusTrees'

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
const toWorld = ([x, y], height) => [x, height, -y]
const centreOf = (outline) => [0, 1].map((axis) => outline.reduce((sum, point) => sum + point[axis], 0) / outline.length)

/** One kind of tree (campusTrees.js), every one of them as two instanced meshes: trunks and crowns. */
function TreeKind({ kind, trees, ground, geometry }) {
  const trunkRef = useRef()
  const crownRef = useRef()
  useEffect(() => {
    const look = TREE_KINDS[kind]
    const matrix = new THREE.Matrix4()
    const turn = new THREE.Quaternion()
    const lean = new THREE.Quaternion()
    const colour = new THREE.Color()
    trees.forEach(({ xy }, index) => {
      const [x, y] = xy
      const size = treeSize(xy)
      turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), jitter(y, x) * Math.PI * 2)
      // Palms lean a little, each its own way.
      if (kind === 'palm') turn.multiply(lean.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (jitter(x + 3, y) - 0.5) * 0.25))
      matrix.compose(new THREE.Vector3(x, ground(xy), -y), turn, new THREE.Vector3(size, size, size))
      trunkRef.current.setMatrixAt(index, matrix)
      crownRef.current.setMatrixAt(index, matrix)
      crownRef.current.setColorAt(index, colour.set(look.greens[Math.floor(jitter(x, y + 1) * look.greens.length)]))
    })
    for (const mesh of [trunkRef.current, crownRef.current]) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    crownRef.current.instanceColor.needsUpdate = true
  }, [kind, trees, ground])
  return <group>
    <instancedMesh ref={trunkRef} args={[geometry.trunk, undefined, trees.length]}>
      <meshStandardMaterial color={TREE_KINDS[kind].trunk} roughness={1} flatShading />
    </instancedMesh>
    <instancedMesh ref={crownRef} args={[geometry.crown, undefined, trees.length]}>
      <meshStandardMaterial flatShading roughness={0.9} side={kind === 'palm' ? THREE.DoubleSide : THREE.FrontSide} />
    </instancedMesh>
  </group>
}

/** The campus trees as coconut palms, rain trees and mango trees, varied in size, turn and shade. */
function Trees({ trees, ground }) {
  const geometries = useMemo(() => treeGeometries(), [])
  const byKind = useMemo(() => {
    const groups = Object.fromEntries(Object.keys(TREE_KINDS).map((kind) => [kind, []]))
    for (const tree of trees) groups[treeKind(tree.xy)].push(tree)
    return groups
  }, [trees])
  return Object.entries(byKind).filter(([, list]) => list.length).map(([kind, list]) =>
    <TreeKind key={kind} kind={kind} trees={list} ground={ground} geometry={geometries[kind]} />)
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
      : <>
        {Array.from({ length: building.levels }, (_, level) => <Storey key={level} parts={parts} base={level * STOREY_M} height={STOREY_M} look={look}
          windows={building.kind !== 'neighbour'} />)}
        {building.kind !== 'neighbour' && <RoofDetails parts={parts} top={building.levels * STOREY_M} look={look} />}
      </>}
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
