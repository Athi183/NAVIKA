import { Suspense, useMemo } from 'react'
import * as THREE from 'three'
import { Billboard, Edges, Text } from '@react-three/drei'

// The whole campus at a glance: each building as solid storeys at real height
// (scripts/build_campus_massing.py), like the 3D buildings on a street map.
// A tap on a building opens it.

const LABEL_FONT = '/fonts/NotoSans-Bold.ttf'
const SLAB_M = 0.45 // darker band at each floor level, so the storeys can be counted
const TAP_SLOP_PX = 8
const LOOK = {
  'M. George Block': { wall: '#E2BE96', band: '#9E4A4C', roof: '#F3E6D6', edge: '#6e3335' },
  'Ramanujan Block': { wall: '#9FBDDA', band: '#3E5A78', roof: '#E3ECF5', edge: '#2c4058' },
}
const DEFAULT_LOOK = { wall: '#DDDDDD', band: '#777777', roof: '#F2F2F2', edge: '#555555' }
const BRIDGE_WIDTH_M = 3.08

function shapeOf({ outer, holes }) {
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)))
  shape.holes = holes.map((ring) => new THREE.Path(ring.map(([x, y]) => new THREE.Vector2(x, y))))
  return shape
}

/** One storey: a wall-coloured block with a darker floor band under it. */
function Storey({ parts, base, height, look }) {
  const [body, band] = useMemo(() => {
    const shapes = parts.map(shapeOf)
    return [
      new THREE.ExtrudeGeometry(shapes, { depth: height - SLAB_M, bevelEnabled: false }),
      new THREE.ExtrudeGeometry(shapes, { depth: SLAB_M, bevelEnabled: false }),
    ]
  }, [parts, height])
  // Shapes are drawn on the plan (x, y); turned flat, plan y becomes -z and depth goes up.
  return <group position={[0, base, 0]} rotation={[-Math.PI / 2, 0, 0]}>
    <mesh geometry={band}>
      <meshStandardMaterial color={look.band} roughness={0.9} />
    </mesh>
    <mesh geometry={body} position={[0, 0, SLAB_M]}>
      {/* Group 0 = top and bottom faces (the roof), group 1 = the walls. */}
      <meshStandardMaterial attach="material-0" color={look.roof} roughness={0.9} />
      <meshStandardMaterial attach="material-1" color={look.wall} roughness={0.8} />
      <Edges threshold={40} color={look.edge} />
    </mesh>
  </group>
}

/** Enclosed walkway between the buildings' doors (link.points[1] to link.points[2]). */
function Bridge({ link, base, height }) {
  const [, [x1, y1], [x2, y2]] = link.points
  const length = Math.hypot(x2 - x1, y2 - y1)
  return <group position={[(x1 + x2) / 2, base, -(y1 + y2) / 2]} rotation={[0, Math.atan2(y2 - y1, x2 - x1), 0]}>
    <mesh position={[0, height / 2, 0]}>
      <boxGeometry args={[length, height, BRIDGE_WIDTH_M]} />
      <meshStandardMaterial color="#d7d2c9" roughness={0.8} />
      <Edges color="#6b6b6b" />
    </mesh>
  </group>
}

/**
 * `massing` as loaded from campus_massing.json; storeys stand on the campus
 * ground (y = 0) from `siteLevel` up. `onPickBuilding(name)` on a tap.
 */
export default function CampusBlocks({ massing, siteLevel, bridges = [], onPickBuilding = null }) {
  const storeyHeight = massing.storey_height_m
  const y = (level) => (level - siteLevel) * storeyHeight
  const pick = onPickBuilding ? (name) => (event) => {
    if (event.delta > TAP_SLOP_PX) return
    event.stopPropagation()
    onPickBuilding(name)
  } : () => undefined
  const hover = onPickBuilding ? {
    onPointerOver: () => { document.body.style.cursor = 'pointer' },
    onPointerOut: () => { document.body.style.cursor = '' },
  } : {}
  const tags = useMemo(() => massing.buildings.map((building) => {
    const top = building.storeys.at(-1)
    const points = top.parts.flatMap((part) => part.outer)
    const box = new THREE.Box2().setFromPoints(points.map(([x, py]) => new THREE.Vector2(x, py)))
    const centre = box.getCenter(new THREE.Vector2())
    return { name: building.name, xy: [centre.x, centre.y], top: top.stack_level + 1 }
  }), [massing])

  return <group>
    {massing.buildings.map((building) => <group key={building.name} onClick={pick(building.name)} {...hover}>
      {building.storeys.map((storey) => <Storey key={storey.floor} parts={storey.parts} base={y(storey.stack_level)}
        height={storeyHeight} look={LOOK[building.name] ?? DEFAULT_LOOK} />)}
    </group>)}
    {bridges.map((link) => <Bridge key={link.from} link={link} base={y(link.from_floor)} height={storeyHeight * 0.9} />)}
    <Suspense fallback={null}>
      {tags.map((tag) => <Billboard key={tag.name} position={[tag.xy[0], y(tag.top) + 9, -tag.xy[1]]}>
        <Text font={LABEL_FONT} fontSize={6} color="#ffffff" outlineWidth={0.35} outlineColor="#202025" anchorX="center" anchorY="middle"
          onClick={pick(tag.name)} {...hover}>{tag.name}</Text>
        {onPickBuilding && <Text font={LABEL_FONT} position={[0, -5.6, 0]} fontSize={3.4} color="#fde68a" outlineWidth={0.2} outlineColor="#202025"
          anchorX="center" anchorY="middle" onClick={pick(tag.name)} {...hover}>Tap to look inside</Text>}
      </Billboard>)}
    </Suspense>
  </group>
}
