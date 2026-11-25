import { Suspense, useMemo } from 'react'
import * as THREE from 'three'
import { Billboard, Edges, Text } from '@react-three/drei'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { litAtNight } from './campusLamps'

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
// Windows: a band of glass on every storey, from sill to lintel height.
const SILL_M = 0.9
const WINDOW_M = 1.4
const PARAPET_M = 0.9
const PARAPET_THICK_M = 0.22
const TANK_COLOUR = '#1f2328' // the black plastic water tanks on Kerala roofs

/**
 * A sky to reflect in the glass (an equirectangular gradient: blue overhead,
 * haze at the horizon, green below), made once and shared by every window.
 */
let reflection = null
function skyReflection() {
  if (reflection) return reflection
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 0, 0, 128)
  gradient.addColorStop(0, '#4F84BE')
  gradient.addColorStop(0.47, '#CFDDE6')
  gradient.addColorStop(0.53, '#7E9567')
  gradient.addColorStop(1, '#4A6B3C')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 8, 128)
  reflection = new THREE.CanvasTexture(canvas)
  reflection.mapping = THREE.EquirectangularReflectionMapping
  reflection.colorSpace = THREE.SRGBColorSpace
  return reflection
}

/**
 * Window glass. `light`: undefined by day; at night true (a lit room, warm
 * glow) or false (a dark room).
 */
function GlassMaterial({ light, ...props }) {
  const night = light !== undefined
  // Drawn over the wall it shares a face with (polygon offset), never fighting it.
  return <meshStandardMaterial color={night ? '#26303D' : '#8FB2CC'} metalness={night ? 0.2 : 0.35} roughness={0.15}
    envMap={night ? null : skyReflection()} envMapIntensity={1.2}
    emissive={light ? '#FFC873' : '#000000'} emissiveIntensity={light ? 0.95 : 0}
    polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} {...props} />
}


function shapeOf({ outer, holes }) {
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)))
  shape.holes = holes.map((ring) => new THREE.Path(ring.map(([x, y]) => new THREE.Vector2(x, y))))
  return shape
}

/** One storey: a wall-coloured block with a darker floor band under it and, with `windows`, a band of glass. */
export function Storey({ parts, base, height, look, windows = false, windowLight }) {
  const [body, band, glass] = useMemo(() => {
    const shapes = parts.map(shapeOf)
    return [
      new THREE.ExtrudeGeometry(shapes, { depth: height - SLAB_M, bevelEnabled: false }),
      new THREE.ExtrudeGeometry(shapes, { depth: SLAB_M, bevelEnabled: false }),
      windows && height > SILL_M + WINDOW_M + SLAB_M ? new THREE.ExtrudeGeometry(shapes, { depth: WINDOW_M, bevelEnabled: false }) : null,
    ]
  }, [parts, height, windows])
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
    {glass && <mesh geometry={glass} position={[0, 0, SLAB_M + SILL_M]}>
      {/* Only the sides show: the caps lie inside the storey. */}
      <meshBasicMaterial attach="material-0" visible={false} />
      <GlassMaterial attach="material-1" light={windowLight} />
    </mesh>}
  </group>
}

const inside = ([x, y], ring) => {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}
const distanceToRing = ([x, y], ring) => Math.min(...ring.map(([ax, ay], i) => {
  const [bx, by] = ring[(i + 1) % ring.length]
  const [dx, dy] = [bx - ax, by - ay]
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / ((dx * dx + dy * dy) || 1)))
  return Math.hypot(x - ax - dx * t, y - ay - dy * t)
}))

/**
 * What stands on a flat roof: a low wall around every edge, and on larger
 * roofs a stair room and a pair of black water tanks, set well inside the edge.
 * `top` is the roof's height.
 */
export function RoofDetails({ parts, top, look }) {
  const { parapet, fixtures } = useMemo(() => {
    const walls = []
    const fixtures = []
    for (const part of parts) {
      for (const ring of [part.outer, ...part.holes]) {
        ring.forEach(([ax, ay], i) => {
          const [bx, by] = ring[(i + 1) % ring.length]
          const length = Math.hypot(bx - ax, by - ay)
          if (length < 0.3) return
          walls.push(new THREE.BoxGeometry(length + PARAPET_THICK_M, PARAPET_M, PARAPET_THICK_M)
            .rotateY(Math.atan2(by - ay, bx - ax))
            .translate((ax + bx) / 2, top + PARAPET_M / 2, -(ay + by) / 2))
        })
      }
      // Roof fixtures on roofs big enough to carry them: spots at least 3 m inside
      // every edge, spread across the roof (each next one as far as possible from those chosen).
      const xs = part.outer.map(([x]) => x)
      const ys = part.outer.map(([, y]) => y)
      const area = Math.abs(part.outer.reduce((sum, [x, y], i) => {
        const [nx, ny] = part.outer[(i + 1) % part.outer.length]
        return sum + x * ny - nx * y
      }, 0)) / 2
      if (area < 120) continue
      const candidates = []
      for (let x = Math.min(...xs) + 3; x < Math.max(...xs) - 3; x += 3) {
        for (let y = Math.min(...ys) + 3; y < Math.max(...ys) - 3; y += 3) {
          const point = [x, y]
          if (inside(point, part.outer) && !part.holes.some((hole) => inside(point, hole))
            && [part.outer, ...part.holes].every((ring) => distanceToRing(point, ring) >= 3)) candidates.push(point)
        }
      }
      const spots = candidates.length ? [candidates[Math.floor(candidates.length / 2)]] : []
      while (spots.length < 6 && spots.length < candidates.length) {
        const gap = (point) => Math.min(...spots.map((other) => Math.hypot(other[0] - point[0], other[1] - point[1])))
        const next = candidates.reduce((best, point) => (gap(point) > gap(best) ? point : best))
        if (gap(next) < 9) break
        spots.push(next)
      }
      const count = Math.min(spots.length, Math.max(1, Math.round(area / 900)))
      spots.slice(0, count).forEach(([x, y], index) => {
        if (index % 2 === 0) fixtures.push({ kind: 'room', xy: [x, y] })
        fixtures.push({ kind: 'tanks', xy: [x + (index % 2 ? 0 : 3.2), y] })
      })
    }
    return { parapet: walls.length ? mergeGeometries(walls) : null, fixtures }
  }, [parts, top])
  return <group>
    {parapet && <mesh geometry={parapet}><meshStandardMaterial color={look.wall} roughness={0.85} /></mesh>}
    {fixtures.map(({ kind, xy: [x, y] }, index) => kind === 'room'
      ? <mesh key={index} position={[x, top + 1.3, -y]}>
        <boxGeometry args={[3, 2.6, 3.4]} />
        <meshStandardMaterial color={look.wall} roughness={0.85} />
      </mesh>
      : <group key={index} position={[x, top, -y]}>
        {[-0.95, 0.95].map((offset) => <mesh key={offset} position={[offset, 0.75, 0]}>
          <cylinderGeometry args={[0.8, 0.8, 1.5, 14]} />
          <meshStandardMaterial color={TANK_COLOUR} roughness={0.6} />
        </mesh>)}
      </group>)}
  </group>
}

/**
 * The bridge between the buildings' doors (link.points[1] to link.points[2]):
 * a deck and a roof on steel posts, with glass sides, so it reads clearly
 * from across the campus.
 */
function Bridge({ link, base, height }) {
  const [, [x1, y1], [x2, y2]] = link.points
  const length = Math.hypot(x2 - x1, y2 - y1)
  const posts = Math.max(2, Math.round(length / 2.5) + 1)
  const steel = <meshStandardMaterial color="#5B6470" metalness={0.6} roughness={0.35} />
  return <group position={[(x1 + x2) / 2, base, -(y1 + y2) / 2]} rotation={[0, Math.atan2(y2 - y1, x2 - x1), 0]}>
    <mesh position={[0, 0.15, 0]}><boxGeometry args={[length, 0.3, BRIDGE_WIDTH_M]} />{steel}</mesh>
    <mesh position={[0, height - 0.12, 0]}><boxGeometry args={[length, 0.24, BRIDGE_WIDTH_M + 0.3]} />{steel}</mesh>
    {[-1, 1].map((side) => <group key={side}>
      <mesh position={[0, height / 2, side * (BRIDGE_WIDTH_M / 2 - 0.04)]}>
        <boxGeometry args={[length, height - 0.5, 0.06]} />
        <GlassMaterial transparent opacity={0.55} polygonOffset={false} />
      </mesh>
      {Array.from({ length: posts }, (_, i) => <mesh key={i} position={[-length / 2 + (i * length) / (posts - 1), height / 2, side * (BRIDGE_WIDTH_M / 2)]}>
        <boxGeometry args={[0.16, height, 0.16]} />{steel}
      </mesh>)}
      <mesh position={[0, 1.05, side * (BRIDGE_WIDTH_M / 2)]}><boxGeometry args={[length, 0.08, 0.1]} />{steel}</mesh>
    </group>)}
  </group>
}

/**
 * `massing` as loaded from campus_massing.json; storeys stand on the campus
 * ground (y = 0) from `siteLevel` up. `onPickBuilding(name)` on a tap.
 */
export default function CampusBlocks({ massing, siteLevel, bridges = [], onPickBuilding = null, night = false }) {
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
    {massing.buildings.map((building, index) => <group key={building.name} onClick={pick(building.name)} {...hover}>
      {building.storeys.map((storey) => <Storey key={storey.floor} parts={storey.parts} base={y(storey.stack_level)}
        height={storeyHeight} look={LOOK[building.name] ?? DEFAULT_LOOK} windows
        windowLight={night ? litAtNight(index * 17 + storey.stack_level) : undefined} />)}
      <RoofDetails parts={building.storeys.at(-1).parts} top={y(building.storeys.at(-1).stack_level + 1)} look={LOOK[building.name] ?? DEFAULT_LOOK} />
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
