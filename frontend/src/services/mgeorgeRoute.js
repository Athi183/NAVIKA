// Walkable-graph routing for the M. George kiosk floor.
// Data comes from scripts/build_mgeorge_nav_graph.py (DXF -> walkable area ->
// corridor centreline graph). Distances are metres; the kiosk is the fixed source.

const DATA_BASE = '/data/MGeorge_nav'
const WALK_SPEED_MPS = 1.2

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
}

const LANDMARK_CATEGORIES = new Set(['stairs', 'lift', 'toilet', 'entrance', 'library'])

export async function loadKioskFloor(floor = 1) {
  const suffix = String(floor).padStart(2, '0')
  const [graph, walls] = await Promise.all([
    fetch(`${DATA_BASE}/floor_${suffix}_walkable_graph.json`).then((response) => {
      if (!response.ok) throw new Error('Could not load the navigation graph.')
      return response.json()
    }),
    fetch(`${DATA_BASE}/floor_${suffix}_walls.json`).then((response) => {
      if (!response.ok) throw new Error('Could not load the floor walls.')
      return response.json()
    }),
  ])
  return prepareFloor(graph, walls)
}

export function prepareFloor(graph, walls = null) {
  return { graph, walls, adjacency: buildAdjacency(graph), mask: decodeMask(graph.walkable_mask) }
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

function buildAdjacency(graph) {
  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]))
  for (const edge of graph.edges) {
    adjacency.get(edge.from).push({ to: edge.to, weight: edge.weight_m })
    adjacency.get(edge.to).push({ to: edge.from, weight: edge.weight_m })
  }
  return adjacency
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

function buildSteps(points, destination, destinations) {
  // The centreline wiggles around columns, so only announce a turn when the
  // new direction differs from the current one by >= 50 degrees over a leg of
  // at least 2 m; everything else is folded into "walk straight".
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
  const steps = instructions.map((item, index) => {
    const metres = Math.max(1, Math.round(item.length))
    if (index === 0) return { text: `From the kiosk, follow the red line for about ${metres} m`, point: item.start }
    const landmark = nearestLandmark(item.start, destinations, destination.id)
    return { text: `${turnText(item.angle)}${landmark ? ` at ${landmark.name}` : ''} and walk about ${metres} m`, point: item.start }
  })
  const last = legs.at(-1)
  const before = legs.at(-2) || last
  const target = destination.entrance_xy || destination.xy
  const cross = (last[0] - before[0]) * (target[1] - last[1]) - (last[1] - before[1]) * (target[0] - last[0])
  const side = dist(last, target) < 1.5 ? 'ahead of you' : cross > 0 ? 'on your left' : 'on your right'
  steps.push({ text: `${destination.name} is ${side}`, point: last })
  return steps
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

/** Route from the fixed kiosk to a destination from graph.destinations. */
export function routeFromKiosk({ graph, adjacency, mask }, destination) {
  const kiosk = graph.kiosk
  const result = dijkstra(adjacency, kiosk.node, destination.node)
  if (!result) return null
  const nodeXY = new Map(graph.nodes.map((node) => [node.id, [node.x, node.y]]))
  const tail = [destination.approach_xy]
  // Only draw into the room when the label itself is reachable in a straight line.
  if (!destination.entrance_xy && destination.anchor_walkable && destination.line_of_sight) tail.push(destination.xy)
  let middle = result.path.map((id) => nodeXY.get(id))
  middle = trimTail(middle.reverse(), kiosk.approach_xy).reverse()
  middle = trimTail(middle, destination.approach_xy)
  const points = smoothPath(mask, dedupe([kiosk.xy, kiosk.approach_xy, ...middle, ...tail]))
  const distanceM = points.slice(1).reduce((sum, point, index) => sum + dist(points[index], point), 0)
  return {
    algorithm: 'dijkstra',
    nodes: result.path,
    points,
    distanceM,
    durationS: distanceM / WALK_SPEED_MPS,
    steps: buildSteps(points, destination, graph.destinations),
  }
}

/** Case-insensitive match on every typed word, against name, category and room number. */
export function searchDestinations(destinations, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return destinations
  return destinations.filter((place) => {
    const haystack = `${place.name} ${CATEGORY_LABELS[place.category] || place.category} ${place.pdf_no ?? ''}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

export function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return seconds < 45 ? 'under 1 min' : `${minutes} min`
}
