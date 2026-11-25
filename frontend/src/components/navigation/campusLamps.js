// Street lamps for the campus view: one every ~24 m along the campus paths
// (the outdoor walkable graph), set just off the path, alternating sides.
// Typical spacing, not surveyed: the real lamp posts are not mapped.

const SPACING_M = 24
const SIDE_M = 2.4
const MIN_GAP_M = 14

/** Lamp positions [x, y] in map metres along `graph` (nodes with x, y; edges with from, to). */
export function lampSpots(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, [node.x, node.y]]))
  const candidates = []
  let side = 1
  for (const edge of graph.edges) {
    const a = nodes.get(edge.from)
    const b = nodes.get(edge.to)
    if (!a || !b) continue
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length < 0.5) continue
    const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
    for (let d = SPACING_M / 2; d < length; d += SPACING_M) {
      candidates.push([a[0] + u[0] * d - u[1] * SIDE_M * side, a[1] + u[1] * d + u[0] * SIDE_M * side])
      side = -side
    }
  }
  // Keep lamps apart where paths meet or run side by side (a grid makes the check quick).
  const cells = new Map()
  const key = (x, y) => `${Math.floor(x / MIN_GAP_M)},${Math.floor(y / MIN_GAP_M)}`
  const spots = []
  for (const [x, y] of candidates) {
    const cx = Math.floor(x / MIN_GAP_M)
    const cy = Math.floor(y / MIN_GAP_M)
    let near = false
    for (let i = -1; i <= 1 && !near; i += 1) {
      for (let j = -1; j <= 1 && !near; j += 1) {
        near = (cells.get(`${cx + i},${cy + j}`) ?? []).some(([px, py]) => Math.hypot(px - x, py - y) < MIN_GAP_M)
      }
    }
    if (near) continue
    spots.push([x, y])
    cells.set(key(x, y), [...(cells.get(key(x, y)) ?? []), [x, y]])
  }
  return spots
}

/** Whether a storey has its lights on at night: a fixed pick per `seed`, about two in three. */
export const litAtNight = (seed) => ((Math.sin(seed * 91.7 + 13.1) * 43758.5453) % 1 + 1) % 1 < 0.65
