import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { NAV_BLUE } from './navigationStyle'

// Lifts and stairs running between the stacked floors, drawn the way Mehrin's
// Ramanujan viewer does (ramanujan-viewer/src/LiftShaft.tsx and Staircase.tsx):
// a see-through metal shaft with doors at every stop, and switchback flights
// with handrails. Sizes are typical, not surveyed; positions come from the
// stair/lift connectors of each floor.

const LIFT = { width: 2.6, depth: 2.6, wall: 0.12, edge: 0.075, doorWidth: 1.4, doorHeight: 2.1, door: 0.07, frame: 0.1, top: 2.8 }
const STAIR = { width: 1.2, run: 3.6, steps: 12, tread: 0.08, landing: 1.2, slab: 0.14, rail: 0.9, railThickness: 0.055, stringer: 0.16 }
const COLOURS = {
  shaft: '#D8DDE2', steel: '#687783', door: '#F5F5F5',
  tread: '#b8b1a5', landing: '#a9a39a', stringer: '#77777b', rail: '#50545a',
}

/**
 * Boxes drawn as one instanced mesh. Each box: { at: [x, y, z], size: [sx, sy, sz], yaw, pitch },
 * its length along local x, turned by `pitch` (about local z) and then `yaw` (about y).
 */
function Boxes({ boxes, color, opacity = 1, metalness = 0, roughness = 0.9 }) {
  const meshRef = useRef()
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const euler = new THREE.Euler(0, 0, 0, 'YZX')
    boxes.forEach(({ at, size, yaw = 0, pitch = 0 }, index) => {
      quaternion.setFromEuler(euler.set(0, yaw, pitch, 'YZX'))
      matrix.compose(new THREE.Vector3(...at), quaternion, new THREE.Vector3(...size))
      mesh.setMatrixAt(index, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [boxes])
  if (!boxes.length) return null
  return <instancedMesh ref={meshRef} args={[undefined, undefined, boxes.length]}>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color={color} roughness={roughness} metalness={metalness}
      transparent={opacity < 1} opacity={opacity} depthWrite={opacity === 1} />
  </instancedMesh>
}

/** A local frame on the plan: origin `[x, y]` (plan metres), local x along plan angle `yaw`. */
function frame([x, y], yaw) {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  // Plan (x, y) is world (x, -z); local (u, v) is along / across the frame.
  return (u, height, v) => [x + u * cos - v * sin, height, -(y + u * sin + v * cos)]
}

const mean = (points) => [0, 1].map((axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length)

/** Plan angle from the core towards the corridor, averaged over its floors. */
function doorAngle(stops) {
  const [dx, dy] = stops.reduce(([sx, sy], { xy, door }) => {
    const length = Math.hypot(door[0] - xy[0], door[1] - xy[1])
    return length < 0.2 ? [sx, sy] : [sx + (door[0] - xy[0]) / length, sy + (door[1] - xy[1]) / length]
  }, [0, 0])
  return Math.hypot(dx, dy) < 0.1 ? 0 : Math.atan2(dy, dx)
}

function liftBoxes(stops) {
  const yaw = doorAngle(stops)
  const at = frame(mean(stops.map((stop) => stop.xy)), yaw)
  const { width, depth, wall, edge, doorWidth, doorHeight, door, frame: jamb, top } = LIFT
  const bottom = stops[0].y
  const height = stops.at(-1).y - bottom + top
  const middle = bottom + height / 2
  // Back and side walls; the door side (local +u) is left open for the doors.
  const walls = [
    { at: at(-width / 2, middle, 0), size: [wall, height, depth], yaw },
    { at: at(0, middle, -depth / 2), size: [width, height, wall], yaw },
    { at: at(0, middle, depth / 2), size: [width, height, wall], yaw },
  ]
  const rails = [-1, 1].flatMap((su) => [-1, 1].map((sv) => ({ at: at(su * (width / 2 - edge / 2), middle, sv * (depth / 2 - edge / 2)), size: [edge, height, edge], yaw })))
  const doors = []
  for (const { y } of stops) {
    const face = width / 2
    for (const side of [-1, 1]) {
      doors.push({ at: at(face, y + doorHeight / 2, side * doorWidth / 4), size: [door, doorHeight - 0.04, doorWidth / 2 - 0.025], yaw })
      rails.push({ at: at(face, y + doorHeight / 2, side * (doorWidth / 2 + jamb / 2)), size: [jamb, doorHeight + jamb, jamb], yaw })
    }
    rails.push({ at: at(face, y + doorHeight + jamb / 2, 0), size: [jamb, jamb, doorWidth + jamb * 2], yaw })
  }
  return { walls, rails, doors }
}

/** Two flights and three landings from `lower` up to `upper` (each { xy, door, y }). */
function stairBoxes(lower, upper) {
  // Walk in from the corridor: the first flight runs away from the door.
  const yaw = doorAngle([lower, upper]) + Math.PI
  const { width, run, steps, tread, landing, slab, rail, railThickness, stringer } = STAIR
  const at = frame(mean([lower.xy, upper.xy]), yaw)
  const rise = (upper.y - lower.y) / 2
  const pitch = Math.atan2(rise, run)
  const slope = Math.hypot(run, rise)
  const treads = []
  const supports = []
  const rails = []
  const landings = [
    { at: at(-run / 2 - landing / 2, lower.y - slab / 2, -width / 2), size: [landing, slab, width], yaw },
    { at: at(run / 2 + landing / 2, lower.y + rise - slab / 2, 0), size: [landing, slab, width * 2], yaw },
    { at: at(-run / 2 - landing / 2, upper.y - slab / 2, width / 2), size: [landing, slab, width], yaw },
  ]
  // Flight 1 climbs along +u on one side, flight 2 back along -u on the other.
  for (const [direction, side, base] of [[1, -width / 2, lower.y], [-1, width / 2, lower.y + rise]]) {
    for (let index = 0; index < steps; index += 1) {
      const u = direction * (-run / 2 + (index + 0.5) * run / steps)
      treads.push({ at: at(u, base + (index + 1) * rise / steps - tread / 2, side), size: [run / steps, tread, width], yaw })
    }
    const flightPitch = direction * pitch
    for (const edge of [-1, 1]) {
      const v = side + edge * (width / 2 - stringer / 2)
      supports.push({ at: at(0, base + rise / 2 - stringer / 2, v), size: [slope, stringer, stringer], yaw, pitch: flightPitch })
      rails.push({ at: at(0, base + rise / 2 + rail, side + edge * width / 2), size: [slope, railThickness, railThickness], yaw, pitch: flightPitch })
    }
  }
  return { treads, supports, rails, landings }
}

/**
 * Every lift and stair in use that joins two or more of the floors in view.
 * `levelY(floor)` is the height a floor is drawn at; `highlight` holds the shaft ids the route uses.
 */
export default function VerticalCores({ model, floors, levelY, highlight = new Set() }) {
  const cores = useMemo(() => {
    const shown = new Set(floors)
    const result = []
    for (const shaft of model.shafts.values()) {
      if (shaft.routable === false || shaft.in_normal_use === false) continue
      const stops = shaft.floors.filter((floor) => shown.has(floor)).map((floor) => {
        const graph = model.byFloor.get(floor).graph
        const connector = graph.connectors.find((item) => item.id === shaft.connectors[floor])
        if (!connector) return null
        const node = model.nodes.get(connector.node)
        return { xy: connector.xy, door: node?.xy ?? connector.approach_xy ?? connector.xy, y: levelY(floor) }
      }).filter(Boolean).sort((a, b) => a.y - b.y)
      if (stops.length < 2) continue
      result.push({ id: shaft.id, kind: shaft.kind, stops })
    }
    return result
  }, [model, floors, levelY])

  const parts = useMemo(() => {
    const group = (used) => {
      const lifts = cores.filter((core) => core.kind === 'lift' && highlight.has(core.id) === used).map((core) => liftBoxes(core.stops))
      const stairs = cores.filter((core) => core.kind !== 'lift' && highlight.has(core.id) === used)
        .flatMap((core) => core.stops.slice(1).map((upper, index) => stairBoxes(core.stops[index], upper)))
      const all = (list, key) => list.flatMap((item) => item[key])
      return {
        shaftWalls: all(lifts, 'walls'), steel: [...all(lifts, 'rails'), ...all(stairs, 'supports')], doors: all(lifts, 'doors'),
        treads: all(stairs, 'treads'), landings: all(stairs, 'landings'), rails: all(stairs, 'rails'),
      }
    }
    return { normal: group(false), used: group(true) }
  }, [cores, highlight])

  const { normal, used } = parts
  return <group>
    <Boxes boxes={normal.steel} color={COLOURS.steel} metalness={0.5} roughness={0.35} />
    <Boxes boxes={normal.doors} color={COLOURS.door} metalness={0.22} roughness={0.32} />
    <Boxes boxes={normal.treads} color={COLOURS.tread} />
    <Boxes boxes={normal.landings} color={COLOURS.landing} />
    <Boxes boxes={normal.rails} color={COLOURS.rail} />
    {/* The stairs and lift the route takes, in the route's blue. */}
    <Boxes boxes={used.steel} color={NAV_BLUE} metalness={0.3} roughness={0.4} />
    <Boxes boxes={used.doors} color={COLOURS.door} metalness={0.22} roughness={0.32} />
    <Boxes boxes={used.treads} color={NAV_BLUE} />
    <Boxes boxes={used.landings} color={NAV_BLUE} />
    <Boxes boxes={used.rails} color={COLOURS.rail} />
    {/* See-through shaft walls last, so what is inside still shows. */}
    <Boxes boxes={normal.shaftWalls} color={COLOURS.shaft} opacity={0.5} metalness={0.38} roughness={0.3} />
    <Boxes boxes={used.shaftWalls} color={NAV_BLUE} opacity={0.4} metalness={0.3} roughness={0.3} />
  </group>
}
