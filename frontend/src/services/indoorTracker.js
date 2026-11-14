// Indoor tracking from the phone's motion sensors, anchored to the planned route
// (no app, no beacons): each step moves the visitor along the route, a turn the
// phone senses snaps them to the route's nearest corner, and the stride length is
// learned from GPS while they walk outside. Plain functions with no browser or
// React parts, so recorded walks can be replayed in Node (scripts/replay-walk.mjs)
// to compare tracking methods.

export const DEFAULT_STRIDE_M = 0.7
const STEP_THRESHOLD = 1.1      // m/s² of bounce above the walking baseline that counts as a step
const STEP_MIN_GAP_MS = 280     // faster than this is one step's double peak, not two steps
const TURN_MIN_DEG = 50         // a heading change this large within TURN_WINDOW_MS is a turn
const TURN_WINDOW_MS = 2500
const TURN_GAP_MS = 2000        // at most one turn per corner
const CORNER_MIN_DEG = 40       // route bends at least this sharp are corners to snap to
const MIN_STRIDE_M = 0.45
const MAX_STRIDE_M = 0.95

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

/**
 * Steps and turns from motion samples ({ t ms, ax, ay, az: acceleration with
 * gravity, m/s²; ra, rb, rg: rotation rate about z, x, y, deg/s }, as in
 * DeviceMotionEvent). `feed` returns the events each sample completes.
 */
export function createMotionDetector() {
  let smooth = null
  let baseline = null
  let armed = true
  let lastStep = -Infinity
  let gravity = null
  let heading = 0
  let lastT = null
  let lastTurn = -Infinity
  let history = []
  return {
    /** Heading change since the start, degrees (sign depends on how the phone is held). */
    get heading() { return heading },
    feed({ t, ax, ay, az, ra = 0, rb = 0, rg = 0 }) {
      const events = []
      const magnitude = Math.hypot(ax, ay, az)
      smooth = smooth === null ? magnitude : smooth + 0.3 * (magnitude - smooth)
      baseline = baseline === null ? magnitude : baseline + 0.02 * (magnitude - baseline)
      const bounce = smooth - baseline
      if (bounce < 0) armed = true
      if (armed && bounce > STEP_THRESHOLD && t - lastStep >= STEP_MIN_GAP_MS) {
        armed = false
        lastStep = t
        events.push({ type: 'step', t })
      }
      const raw = [ax, ay, az]
      gravity = gravity ? gravity.map((g, i) => g + 0.05 * (raw[i] - g)) : raw
      if (lastT !== null) {
        const dt = Math.min(0.2, (t - lastT) / 1000)
        // Turning about the vertical, however the phone is held: the rotation rate projected on gravity.
        heading += ((rb * gravity[0] + rg * gravity[1] + ra * gravity[2]) / (Math.hypot(...gravity) || 1)) * dt
      }
      lastT = t
      history.push([t, heading])
      while (history[0][0] < t - TURN_WINDOW_MS) history.shift()
      const change = heading - history[0][1]
      if (Math.abs(change) >= TURN_MIN_DEG && t - lastTurn >= TURN_GAP_MS) {
        lastTurn = t
        history = [[t, heading]]
        events.push({ type: 'turn', t, angle: change })
      }
      return events
    },
  }
}

/** Running length along a polyline of [x, y] points. */
export function cumulative(points) {
  const lengths = [0]
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1] + dist(points[i - 1], points[i]))
  return lengths
}

/** The point `s` metres along the polyline. */
export function pointAt(points, lengths, s) {
  if (points.length === 1) return points[0]
  const target = clamp(s, 0, lengths.at(-1))
  let i = 1
  while (i < lengths.length - 1 && lengths[i] < target) i += 1
  const t = (target - lengths[i - 1]) / ((lengths[i] - lengths[i - 1]) || 1)
  return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t]
}

/** How far along the polyline the point nearest to `xy` is. */
export function distanceAlong(points, lengths, xy) {
  let best = { gap: Infinity, s: 0 }
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1], points[i]]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const t = clamp(((xy[0] - a[0]) * dx + (xy[1] - a[1]) * dy) / ((dx * dx + dy * dy) || 1), 0, 1)
    const gap = dist([a[0] + dx * t, a[1] + dy * t], xy)
    if (gap < best.gap) best = { gap, s: lengths[i - 1] + t * (lengths[i] - lengths[i - 1]) }
  }
  return best.s
}

/** Indices of the points Ramer-Douglas-Peucker keeps at `tolerance` metres. */
function keptIndices(points, tolerance, first = 0, last = points.length - 1) {
  let worst = { gap: 0, index: -1 }
  const [a, b] = [points[first], points[last]]
  const length = dist(a, b) || 1
  for (let i = first + 1; i < last; i += 1) {
    const gap = Math.abs((b[0] - a[0]) * (a[1] - points[i][1]) - (a[0] - points[i][0]) * (b[1] - a[1])) / length
    if (gap > worst.gap) worst = { gap, index: i }
  }
  if (worst.gap <= tolerance) return [first, last]
  return [...keptIndices(points, tolerance, first, worst.index).slice(0, -1), ...keptIndices(points, tolerance, worst.index, last)]
}

/** The route's corners: { s (metres along), angle (degrees, + = left) } where it bends at least `minDeg`. */
export function routeCorners(points, minDeg = CORNER_MIN_DEG) {
  if (points.length < 3) return []
  const lengths = cumulative(points)
  const kept = keptIndices(points, 1.0)
  const corners = []
  for (let k = 1; k < kept.length - 1; k += 1) {
    const [a, b, c] = [points[kept[k - 1]], points[kept[k]], points[kept[k + 1]]]
    const turn = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])
    const angle = (Math.atan2(Math.sin(turn), Math.cos(turn)) * 180) / Math.PI
    if (Math.abs(angle) >= minDeg) corners.push({ s: lengths[kept[k]], angle })
  }
  return corners
}

/**
 * Position as progress along one leg of the route (`points`, one floor). Each
 * step adds a stride; with `snapCorners` a sensed turn moves the visitor to the
 * nearest corner not yet used, which resets the error that steps build up.
 */
export function createRoutePositioner(points, { stride = DEFAULT_STRIDE_M, snapCorners = true, start = 0 } = {}) {
  const lengths = cumulative(points)
  const length = lengths.at(-1)
  const corners = routeCorners(points)
  let s = clamp(start, 0, length)
  let anchor = s
  return {
    length,
    corners,
    get progress() { return s },
    /** Rough error in metres: small just after a corner, growing with every step since. */
    get uncertainty() { return 1.5 + 0.12 * (s - anchor) },
    setStride(metres) { stride = metres },
    step() { s = Math.min(length, s + stride) },
    turn() {
      if (!snapCorners) return false
      const reach = Math.max(6, 0.35 * (s - anchor) + 3)
      const candidates = corners.filter((corner) => corner.s > anchor + 0.5 && Math.abs(corner.s - s) <= reach)
      if (!candidates.length) return false
      const nearest = candidates.reduce((best, corner) => (Math.abs(corner.s - s) < Math.abs(best.s - s) ? corner : best))
      s = nearest.s
      anchor = s
      return true
    },
    /** Put the visitor at `metres` along the leg (a step they tapped, or a known landmark). */
    moveTo(metres) {
      s = clamp(metres, 0, length)
      anchor = s
    },
    position() { return pointAt(points, lengths, s) },
    distanceAlong(xy) { return distanceAlong(points, lengths, xy) },
  }
}

/**
 * Baseline for comparison: plain step-and-heading dead reckoning, not tied to
 * the route. `step(headingDeg)` moves one stride in that map direction.
 */
export function createFreePositioner(start, { stride = DEFAULT_STRIDE_M } = {}) {
  let xy = [...start]
  return {
    step(headingDeg) {
      const rad = (headingDeg * Math.PI) / 180
      xy = [xy[0] + stride * Math.cos(rad), xy[1] + stride * Math.sin(rad)]
    },
    moveTo(point) { xy = [...point] },
    position() { return xy },
  }
}

/**
 * Stride length learned outside: GPS positions already snapped to the route
 * (`observe`) against the steps counted meanwhile (`step`). Updates after at
 * least 20 steps and 15 m, and ignores implausible values.
 */
export function createStrideLearner({ initial = DEFAULT_STRIDE_M } = {}) {
  let stride = initial
  let learned = false
  let steps = 0
  let distance = 0
  let last = null
  return {
    get stride() { return stride },
    get learned() { return learned },
    step() { steps += 1 },
    observe(xy) {
      if (last) distance += dist(last, xy)
      last = xy
      if (steps < 20 || distance < 15) return
      const estimate = distance / steps
      if (estimate >= MIN_STRIDE_M && estimate <= MAX_STRIDE_M) {
        stride = learned ? 0.5 * stride + 0.5 * estimate : estimate
        learned = true
      }
      steps = 0
      distance = 0
    },
    /** Off the route or no fix: start a fresh measurement from the next fix. */
    pause() {
      last = null
      steps = 0
      distance = 0
    },
  }
}
