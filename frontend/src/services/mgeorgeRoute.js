// Walkable-graph routing for the whole M. George Block.
// Data comes from scripts/build_mgeorge_nav_graph.py: one corridor centreline
// graph per floor (all in floor 1's frame, metres) plus building.json, which
// joins the floors through stair and lift shafts. The kiosk is the fixed source.

const DATA_BASE = '/data/MGeorge_nav'
const WALK_SPEED_MPS = 1.2
// Assumed vertical travel times; keep in step with building.json "assumptions".
const STAIR_SECONDS_PER_FLOOR = 15
const LIFT_WAIT_SECONDS = 30
const LIFT_SECONDS_PER_FLOOR = 3
const ORDINAL = ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth']

export const CATEGORY_LABELS = {
  lab: 'Labs',
  classroom: 'Classrooms',
  hall: 'Halls',
  department: 'Departments',
  office: 'Offices',
  library: 'Library',
  toilet: 'Toilets',
  stairs: 'Stairs',
  lift: 'Lifts',
  exit: 'Exits',
  entrance: 'Entrance',
  circulation: 'Lobby',
  service: 'Service rooms',
  facility: 'Facilities',
  food: 'Food & dining',
  building: 'Other buildings',
  sports: 'Sports',
  parking: 'Parking',
  gate: 'Gates',
}

const LANDMARK_CATEGORIES = new Set(['stairs', 'lift', 'toilet', 'entrance', 'library'])

/** "Second Floor" for floor 2; "Outside" for the campus paths. */
export function floorName(floor) {
  if (floor === SITE) return 'Outside'
  return `${ORDINAL[floor] ?? `Level ${floor}`} Floor`
}

/** The campus paths are routed like one more "floor" with this key. */
export const SITE = 'site'

async function fetchJson(file) {
  const response = await fetch(`${DATA_BASE}/${file}`)
  if (!response.ok) throw new Error(`Could not load ${file}.`)
  return response.json()
}

export async function loadBuilding() {
  const building = await fetchJson('building.json')
  const floors = await Promise.all(building.floors.map(async (spec) => {
    const [graph, walls, rooms] = await Promise.all([
      fetchJson(spec.graph),
      fetchJson(spec.walls),
      // Room colours for the 3D model; routing works without them.
      fetchJson(spec.rooms).catch(() => null),
    ])
    return { ...spec, name: floorName(spec.floor_number), graph, walls, rooms }
  }))
  // Outdoor campus paths (scripts/build_campus_nav_graph.py); optional.
  const site = await fetchJson('site_graph.json').catch(() => null)
  return prepareBuilding(building, floors, site)
}

/**
 * Combine the floors (and, when given, the outdoor campus paths) into one
 * routable model. `floors` and `site` as loaded by loadBuilding().
 */
export function prepareBuilding(building, floors, site = null) {
  const prepared = floors.map((floor) => ({ ...floor, name: floor.name ?? floorName(floor.floor_number), mask: decodeMask(floor.graph.walkable_mask) }))
  const byFloor = new Map(prepared.map((floor) => [floor.floor_number, floor]))
  const outside = site && {
    floor_number: SITE, name: floorName(SITE), graph: site, walls: null, rooms: null,
    mask: decodeMask(site.walkable_mask), level_floor: site.level_floor,
  }
  if (outside) byFloor.set(SITE, outside)
  const nodes = new Map()
  for (const floor of outside ? [...prepared, outside] : prepared) {
    for (const node of floor.graph.nodes) nodes.set(node.id, { floor: floor.floor_number, xy: [node.x, node.y] })
  }
  // Doors between the building and the campus paths (the main entrance).
  const linkEdge = new Map()
  for (const entrance of site?.links ?? []) {
    linkEdge.set(`${entrance.indoor_node}|${entrance.site_node}`, entrance)
    linkEdge.set(`${entrance.site_node}|${entrance.indoor_node}`, entrance)
  }
  for (const node of building.vertical_nodes) nodes.set(node.id, { floor: node.floor, xy: [node.x, node.y], shaft: node.shaft })
  const shafts = new Map(building.shafts.map((shaft) => [shaft.id, shaft]))
  const verticalEdge = new Map()
  for (const edge of building.vertical_edges) {
    verticalEdge.set(`${edge.from}|${edge.to}`, edge)
    verticalEdge.set(`${edge.to}|${edge.from}`, edge)
  }

  const link = (adjacency, from, to, weight) => {
    adjacency.get(from).push({ to, weight })
    adjacency.get(to).push({ to: from, weight })
  }
  const makeAdjacency = (stepFree) => {
    const adjacency = new Map([...nodes.keys()].map((id) => [id, []]))
    for (const floor of outside ? [...prepared, outside] : prepared) for (const edge of floor.graph.edges) link(adjacency, edge.from, edge.to, edge.weight_m)
    for (const entrance of site?.links ?? []) link(adjacency, entrance.indoor_node, entrance.site_node, entrance.weight_m)
    for (const edge of building.vertical_edges) {
      const shaft = shafts.get(edge.shaft)
      // Fire escape stairs are never used; stairs are skipped for step-free routes.
      if (!shaft?.routable || (stepFree && shaft.kind !== 'lift')) continue
      link(adjacency, edge.from, edge.to, edge.weight_m)
    }
    return adjacency
  }

  // Not offered: stairs/lifts not in normal use, and places the stairs/lifts
  // in use cannot reach (both flagged by the build script).
  const destinations = prepared.flatMap((floor) => floor.graph.destinations
    .filter((place) => place.in_use !== false && place.reachable !== false)
    .map((place) => ({ ...place, floor: floor.floor_number, floorName: floor.name })))
  if (outside) destinations.push(...site.destinations.map((place) => ({ ...place, floor: SITE, floorName: 'Outside (campus)' })))
  const kioskFloor = byFloor.get(building.kiosk_floor)
  return {
    building,
    floors: prepared,
    byFloor,
    nodes,
    shafts,
    verticalEdge,
    linkEdge,
    site: outside,
    destinations,
    kiosk: { ...kioskFloor.graph.kiosk, floor: building.kiosk_floor },
    adjacency: makeAdjacency(false),
    stepFreeAdjacency: makeAdjacency(true),
  }
}

function decodeMask(spec) {
  if (!spec) return null
  const bytes = Uint8Array.from(atob(spec.bits_base64), (char) => char.charCodeAt(0))
  return { ...spec, bytes }
}

function isWalkable(mask, [x, y]) {
  const col = Math.floor((x - mask.origin_xy[0]) / mask.cell_m)
  const row = Math.floor((y - mask.origin_xy[1]) / mask.cell_m)
  if (row < 0 || col < 0 || row >= mask.rows || col >= mask.cols) return false
  const bit = row * mask.cols + col
  return (mask.bytes[bit >> 3] >> (7 - (bit & 7))) & 1
}

function visible(mask, a, b) {
  const steps = Math.ceil(dist(a, b) / (mask.cell_m / 2))
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps
    if (!isWalkable(mask, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) return false
  }
  return true
}

// Greedy string-pulling: from each point jump to the farthest later point that
// is visible across walkable cells. Removes the centreline's zigzags without
// letting the line cut through a wall.
function smoothPath(mask, points) {
  if (!mask || points.length < 3) return points
  const result = [points[0]]
  let i = 0
  while (i < points.length - 1) {
    let next = i + 1
    for (let j = points.length - 1; j > i + 1; j -= 1) {
      if (visible(mask, points[i], points[j])) { next = j; break }
    }
    result.push(points[next])
    i = next
  }
  return result
}

/** Bounding box of the points, grown to at least minSize metres on each axis. */
export function routeBounds(points, minSize = 30, pad = 6) {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  let minX = Math.min(...xs) - pad
  let maxX = Math.max(...xs) + pad
  let minY = Math.min(...ys) - pad
  let maxY = Math.max(...ys) + pad
  const growX = Math.max(0, minSize - (maxX - minX)) / 2
  const growY = Math.max(0, minSize * 0.6 - (maxY - minY)) / 2
  minX -= growX; maxX += growX; minY -= growY; maxY += growY
  return { minX, maxX, minY, maxY }
}

class MinHeap {
  constructor() { this.items = [] }
  get size() { return this.items.length }
  push(item) {
    const items = this.items
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent].cost <= items[i].cost) break
      ;[items[parent], items[i]] = [items[i], items[parent]]
      i = parent
    }
  }
  pop() {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (items.length) {
      items[0] = last
      let i = 0
      for (;;) {
        const left = 2 * i + 1
        const right = left + 1
        let smallest = i
        if (left < items.length && items[left].cost < items[smallest].cost) smallest = left
        if (right < items.length && items[right].cost < items[smallest].cost) smallest = right
        if (smallest === i) break
        ;[items[smallest], items[i]] = [items[i], items[smallest]]
        i = smallest
      }
    }
    return top
  }
}

/** Dijkstra shortest path over the walkable graph; returns node ids or null. */
export function dijkstra(adjacency, start, goal) {
  const costs = new Map([[start, 0]])
  const previous = new Map()
  const heap = new MinHeap()
  heap.push({ id: start, cost: 0 })
  while (heap.size) {
    const { id, cost } = heap.pop()
    if (cost > costs.get(id)) continue
    if (id === goal) break
    for (const { to, weight } of adjacency.get(id) || []) {
      const next = cost + weight
      if (next < (costs.get(to) ?? Infinity)) {
        costs.set(to, next)
        previous.set(to, id)
        heap.push({ id: to, cost: next })
      }
    }
  }
  if (!costs.has(goal)) return null
  const path = [goal]
  while (path[0] !== start) path.unshift(previous.get(path[0]))
  return { path, cost: costs.get(goal) }
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

function dedupe(points) {
  return points.filter((point, index) => index === 0 || dist(point, points[index - 1]) > 0.05)
}

function simplify(points, tolerance) {
  if (points.length < 3) return points
  const [x0, y0] = points[0]
  const [x1, y1] = points.at(-1)
  const length = Math.hypot(x1 - x0, y1 - y0) || 1
  let worst = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = Math.abs((x1 - x0) * (points[i][1] - y0) - (y1 - y0) * (points[i][0] - x0)) / length
    if (d > worst) { worst = d; index = i }
  }
  if (worst <= tolerance) return [points[0], points.at(-1)]
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)]
}

const heading = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0])

function turnAngle(from, to) {
  const angle = (to - from) * 180 / Math.PI
  return ((angle + 540) % 360) - 180
}

function turnText(angle) {
  const side = angle > 0 ? 'left' : 'right'
  if (Math.abs(angle) > 150) return 'Turn around'
  return Math.abs(angle) < 70 ? `Bear ${side}` : `Turn ${side}`
}

function nearestLandmark(point, destinations, excludeId) {
  let best = null
  for (const place of destinations) {
    if (place.id === excludeId || !LANDMARK_CATEGORIES.has(place.category)) continue
    const d = dist(point, place.entrance_xy || place.xy)
    if (d < 5 && (!best || d < best.d)) best = { place, d }
  }
  return best?.place || null
}

// The centreline wiggles around columns, so only announce a turn when the new
// direction differs from the current one by >= 50 degrees over a leg of at
// least 2 m; everything else is folded into "walk straight".
function walkInstructions(points) {
  const legs = simplify(points, 1.5)
  const instructions = []
  let current = null
  for (let i = 0; i < legs.length - 1; i += 1) {
    const length = dist(legs[i], legs[i + 1])
    const direction = heading(legs[i], legs[i + 1])
    const angle = current ? turnAngle(current.direction, direction) : 0
    if (!current || (Math.abs(angle) >= 50 && length >= 2)) {
      current = { start: legs[i], direction, length, longest: length, angle: current ? angle : null }
      instructions.push(current)
    } else {
      current.length += length
      if (length > current.longest) { current.longest = length; current.direction = direction }
    }
  }
  return { instructions, legs }
}

/** Steps for one floor's leg. `opening(metres)` words the first instruction. */
function legSteps(points, floor, opening, landmarks, excludeId) {
  const { instructions, legs } = walkInstructions(points)
  const steps = instructions.map((item, index) => {
    const metres = Math.max(1, Math.round(item.length))
    if (index === 0) return { text: opening(metres), point: item.start, floor }
    const landmark = nearestLandmark(item.start, landmarks, excludeId)
    return { text: `${turnText(item.angle)}${landmark ? ` at ${landmark.name}` : ''} and walk about ${metres} m`, point: item.start, floor }
  })
  return { steps, legs }
}

function sideOf(legs, target) {
  const last = legs.at(-1)
  const before = legs.at(-2) || last
  const cross = (last[0] - before[0]) * (target[1] - last[1]) - (last[1] - before[1]) * (target[0] - last[0])
  return dist(last, target) < 1.5 ? 'ahead of you' : cross > 0 ? 'on your left' : 'on your right'
}

function project(point, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / ((dx * dx + dy * dy) || 1)))
  return [a[0] + dx * t, a[1] + dy * t]
}

// Cut the path where it passes closest to `point`, so the route does not run
// on to the snapped node and double back. Only the last few edges are tried.
function trimTail(path, point) {
  let best = { index: path.length - 1, at: path.at(-1), d: dist(path.at(-1), point) }
  for (let i = Math.max(0, path.length - 6); i < path.length - 1; i += 1) {
    const at = project(point, path[i], path[i + 1])
    const d = dist(at, point)
    if (d < best.d - 0.05) best = { index: i, at, d }
  }
  return [...path.slice(0, best.index + 1), best.at]
}

/** Split a node path into per-floor legs joined by stair/lift transitions. */
function splitByFloor(model, path) {
  const legs = []
  const transitions = []
  let liftShaft = null
  for (let i = 0; i < path.length; i += 1) {
    const node = model.nodes.get(path[i])
    if (node.shaft) { liftShaft = node.shaft; continue }  // inside a lift car
    const leg = legs.at(-1)
    if (leg && leg.floor === node.floor && !liftShaft) { leg.nodes.push(path[i]); continue }
    if (leg) {
      const entrance = model.linkEdge.get(`${path[i - 1]}|${path[i]}`)
      const shaftId = liftShaft ?? model.verticalEdge.get(`${path[i - 1]}|${path[i]}`)?.shaft
      const shaft = model.shafts.get(shaftId)
      const previous = transitions.at(-1)
      if (entrance) {
        transitions.push({ kind: 'entrance', name: entrance.name, fromFloor: leg.floor, toFloor: node.floor })
      // Climbing several storeys of the same stair passes intermediate floors
      // with a one-node leg; fold those into a single transition.
      } else if (shaftId && previous && previous.shaft === shaftId && leg.nodes.length === 1 && previous.toFloor === leg.floor) {
        legs.pop()
        previous.toFloor = node.floor
      } else {
        transitions.push({ shaft: shaftId, kind: shaft?.kind ?? 'stairs', name: shaft?.name ?? 'the stairs', fromFloor: leg.floor, toFloor: node.floor })
      }
    }
    legs.push({ floor: node.floor, nodes: [path[i]] })
    liftShaft = null
  }
  return { legs, transitions }
}

function transitionText(transition) {
  if (transition.kind === 'entrance') {
    const door = transition.name.toLowerCase()
    return transition.toFloor === SITE ? `Go out through the ${door}` : `Go into the M. George Block through the ${door}`
  }
  const direction = transition.toFloor > transition.fromFloor ? 'up' : 'down'
  // "Take the main lift (centre) up…", "Take Staircase 1 (central) up…"
  const name = transition.name
  const way = transition.kind !== 'lift' ? name : /lift/i.test(name) ? `the ${name.charAt(0).toLowerCase()}${name.slice(1)}` : `the lift (${name})`
  return `Take ${way} ${direction} to the ${floorName(transition.toFloor)}`
}

function transitionSeconds(transition) {
  if (transition.kind === 'entrance') return 0
  const storeys = Math.abs(transition.toFloor - transition.fromFloor)
  return transition.kind === 'lift' ? LIFT_WAIT_SECONDS + LIFT_SECONDS_PER_FLOOR * storeys : STAIR_SECONDS_PER_FLOOR * storeys
}

/**
 * Route from the fixed kiosk to any destination in the building.
 * `stepFree` uses lifts only. Returns per-floor legs (points in metres),
 * the stair/lift transitions between them, steps, distance and time.
 */
export function routeFromKiosk(model, destination, { stepFree = false } = {}) {
  const { kiosk } = model
  const result = dijkstra(stepFree ? model.stepFreeAdjacency : model.adjacency, kiosk.node, destination.node)
  if (!result) return null
  const { legs: nodeLegs, transitions } = splitByFloor(model, result.path)

  const legs = nodeLegs.map((leg, index) => {
    const floor = model.byFloor.get(leg.floor)
    let points = leg.nodes.map((id) => model.nodes.get(id).xy)
    const first = index === 0
    const last = index === nodeLegs.length - 1
    if (first) points = [kiosk.xy, kiosk.approach_xy, ...trimTail([...points].reverse(), kiosk.approach_xy).reverse()]
    if (last) {
      points = [...trimTail(points, destination.approach_xy), destination.approach_xy]
      // Only draw into the room when the label itself is reachable in a straight line.
      if (!destination.entrance_xy && destination.anchor_walkable && destination.line_of_sight) points.push(destination.xy)
    }
    points = smoothPath(floor.mask, dedupe(points))
    const distanceM = points.slice(1).reduce((sum, point, i) => sum + dist(points[i], point), 0)
    return { floor: leg.floor, floorName: floor.name, points, distanceM }
  })

  const steps = []
  legs.forEach((leg, index) => {
    const floor = model.byFloor.get(leg.floor)
    const arriving = transitions[index - 1]
    const opening = index === 0
      ? (m) => `From the kiosk, follow the line for about ${m} m`
      : arriving.kind === 'entrance'
        ? (m) => (leg.floor === SITE ? `Outside, follow the path for about ${m} m` : `Inside, follow the line for about ${m} m`)
        : (m) => `On the ${leg.floorName}, leave the ${arriving.kind === 'lift' ? 'lift' : 'stairs'} and follow the line for about ${m} m`
    const { steps: walk, legs: simplified } = legSteps(leg.points, leg.floor, opening, floor.graph.destinations, destination.id)
    steps.push(...walk)
    if (index < legs.length - 1) {
      steps.push({ text: transitionText(transitions[index]), point: leg.points.at(-1), floor: leg.floor, transition: transitions[index] })
    } else {
      steps.push({ text: `${destination.name} is ${sideOf(simplified, destination.entrance_xy || destination.xy)}`, point: leg.points.at(-1), floor: leg.floor })
    }
  })

  const distanceM = legs.reduce((sum, leg) => sum + leg.distanceM, 0)
  return {
    algorithm: 'dijkstra',
    stepFree,
    legs,
    transitions,
    floors: legs.map((leg) => leg.floor),
    distanceM,
    durationS: distanceM / WALK_SPEED_MPS + transitions.reduce((sum, t) => sum + transitionSeconds(t), 0),
    steps,
  }
}

/** Case-insensitive match on every typed word, against name, category and room number. */
export function searchDestinations(destinations, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return destinations
  return destinations.filter((place) => {
    const haystack = `${place.name} ${CATEGORY_LABELS[place.category] || place.category} ${place.floorName ?? ''} ${place.pdf_no ?? ''}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

export function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return seconds < 45 ? 'under 1 min' : `${minutes} min`
}

/** One plain sentence: how to get there and how long it takes. */
export function routeSummary(route, destination) {
  const parts = route.transitions.map((t) => {
    if (t.kind === 'entrance') return t.toFloor === SITE ? 'go out through the main entrance' : 'go back in through the main entrance'
    const way = t.kind === 'lift' ? `take the ${t.name.toLowerCase()}` : `take ${t.name}`
    return `${way} ${t.toFloor > t.fromFloor ? 'up' : 'down'} to the ${floorName(t.toFloor)}`
  })
  const time = formatDuration(route.durationS)
  if (!parts.length) return `${destination.name} is on this floor, about ${time} away. Follow the walking person.`
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
  return `${[first, ...parts.slice(1)].join(', then ')}. ${destination.name} is about ${time} away.`
}

/** Floors to stack, camera focus and campus flag for showing a route in 3D. */
export function routeScene(model, route, destination) {
  const outside = route.floors.includes(SITE)
  const indoor = route.floors.filter((floor) => floor !== SITE)
  if (outside && model.site) indoor.push(model.site.level_floor)
  const low = Math.min(...indoor)
  const high = Math.max(...indoor)
  return {
    outside,
    floors: model.floors.map((floor) => floor.floor_number).filter((n) => n >= low && n <= high),
    focus: routeBounds([...route.legs.flatMap((leg) => leg.points), destination.entrance_xy || destination.xy], 30, outside ? 15 : 4),
  }
}

// Phone hand-off: the kiosk shows a QR code for one route. The link carries
// only the destination, the lifts-only choice and an expiry time; the source
// is always the kiosk.
export const PHONE_LINK_MINUTES = 45
export const PHONE_ROUTE_PATH = '/route'

export function phoneRouteUrl(destination, { stepFree = false, now = Date.now() } = {}) {
  const base = import.meta.env.VITE_NAVIKA_BASE_URL?.trim() || window.location.origin
  const url = new URL(PHONE_ROUTE_PATH, base)
  url.search = new URLSearchParams({
    to: destination.id,
    ...(stepFree ? { lifts: '1' } : {}),
    until: String(Math.floor(now / 1000) + PHONE_LINK_MINUTES * 60),
  }).toString()
  return url.toString()
}

/** `{ to, stepFree, expiresAt }` from a phone link, or null when it is malformed. */
export function readPhoneLink(search) {
  const params = new URLSearchParams(search)
  const to = params.get('to')
  const until = Number(params.get('until'))
  if (!to || !Number.isFinite(until) || until <= 0) return null
  return { to, stepFree: params.get('lifts') === '1', expiresAt: until * 1000 }
}
