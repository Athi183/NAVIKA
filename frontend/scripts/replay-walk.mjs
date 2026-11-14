#!/usr/bin/env node
// Replays walks recorded in research mode (phone route link with &research=1,
// "Save log") through each tracking method, and reports how far each method's
// position was from the true position at every spot the walker marked.
//
//   node scripts/replay-walk.mjs spots.json walk1.json [walk2.json ...] [--turn-sign=-1] [--json]
//
// spots.json gives the true position of each numbered spot, as map metres or as
// a place or graph node from the map data:
//   { "1": { "floor": 1, "xy": [12.3, -4.5] },
//     "2": { "place": "mg1_tagore_library" },
//     "3": { "node": "MG01_N0123" } }
//
// Methods compared (all re-anchored only where the visitor changed floor or
// building, as on the stairs/lift/entrance steps):
//   gps          the phone's GPS fix nearest before the mark (map metres)
//   steps        free step-and-heading dead reckoning (--turn-sign flips the gyro sign)
//   route        steps moved along the route, typical stride
//   route+corner + snapping to the route's corners on a sensed turn
//   full         + stride learned from GPS on the walk's outdoor parts
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_STRIDE_M, createFreePositioner, createMotionDetector, createRoutePositioner, createStrideLearner, cumulative, distanceAlong,
} from '../src/services/indoorTracker.js'

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../public/data')
const METHODS = ['gps', 'steps', 'route', 'route+corner', 'full']
const SITE = 'site'

const args = process.argv.slice(2)
const options = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')).map(([k, v]) => [k, v ?? true]))
const [spotsFile, ...walkFiles] = args.filter((a) => !a.startsWith('--'))
if (!spotsFile || !walkFiles.length) {
  console.error('usage: node scripts/replay-walk.mjs spots.json walk1.json [walk2.json ...] [--turn-sign=-1] [--json]')
  process.exit(1)
}
const turnSign = Number(options['turn-sign'] ?? 1)

/** Places and graph nodes from the map data, for spots given by name. */
function mapIndex() {
  const places = new Map()
  const nodes = new Map()
  for (const dir of ['MGeorge_nav', 'Ramanujan_nav']) {
    for (const file of readdirSync(join(DATA, dir)).filter((f) => f.endsWith('_walkable_graph.json') || f === 'site_graph.json')) {
      const graph = JSON.parse(readFileSync(join(DATA, dir, file), 'utf8'))
      const floor = graph.floor_number ?? SITE
      for (const node of graph.nodes) nodes.set(node.id, { floor: node.floor ?? floor, xy: [node.x, node.y] })
      for (const place of graph.destinations) places.set(place.id, { floor, xy: place.entrance_xy ?? place.approach_xy ?? place.xy })
    }
  }
  return { places, nodes }
}

function readSpots(file) {
  const index = mapIndex()
  return Object.fromEntries(Object.entries(JSON.parse(readFileSync(file, 'utf8'))).map(([spot, value]) => {
    const resolved = value.place ? index.places.get(value.place) : value.node ? index.nodes.get(value.node) : value
    if (!resolved) throw new Error(`spot ${spot}: unknown ${value.place ?? value.node}`)
    return [spot, { floor: resolved.floor, xy: resolved.xy }]
  }))
}

function latLonToMap(geo, lat, lon) {
  const { lat0, lon0, matrix: [[a, b], [c, d]], shift: [sx, sy] } = geo
  const east = (lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180)
  const north = (lat - lat0) * 110574
  return [a * east + b * north + sx, c * east + d * north + sy]
}

const indoorLeg = (step) => (step && step.floor !== SITE && !step.transition ? step.leg : null)

/** One walk → [{ spot, floor, errors: { method: metres | null } }]. */
function replay(log, spots) {
  const { legs, steps } = log.route
  const events = [
    ...log.motion.map(([t, ax, ay, az, ra, rb, rg]) => ({ t, kind: 'motion', sample: { t, ax, ay, az, ra, rb, rg } })),
    ...log.stepChanges.map((change) => ({ t: change.t, kind: 'step', change })),
    ...log.gps.map((fix) => ({ t: fix.t, kind: 'gps', fix })),
    ...log.marks.map((mark) => ({ t: mark.t, kind: 'mark', mark })),
  ].sort((a, b) => a.t - b.t || (a.kind === 'motion') - (b.kind === 'motion'))

  const detector = createMotionDetector()
  const learner = createStrideLearner()
  const outdoorLegs = legs.map((leg, index) => ({ ...leg, index })).filter((leg) => leg.floor === SITE)
  let stepIndex = 0
  let legIndex = null
  let tracker = {}
  let headingAtAnchor = 0
  let heading0 = 0
  let lastGps = null
  const results = []

  const anchor = (step) => {
    const points = legs[step.leg].points
    const lengths = cumulative(points)
    const start = distanceAlong(points, lengths, step.point)
    tracker = {
      route: createRoutePositioner(points, { stride: DEFAULT_STRIDE_M, snapCorners: false, start }),
      'route+corner': createRoutePositioner(points, { stride: DEFAULT_STRIDE_M, start }),
      full: createRoutePositioner(points, { stride: learner.stride, start }),
    }
    const from = tracker.route.position()
    const ahead = createRoutePositioner(points, { start: start + 1 }).position()
    heading0 = (Math.atan2(ahead[1] - from[1], ahead[0] - from[0]) * 180) / Math.PI
    headingAtAnchor = detector.heading
    tracker.steps = createFreePositioner(from, { stride: DEFAULT_STRIDE_M })
  }

  for (const event of events) {
    if (event.kind === 'step') {
      stepIndex = event.change.index ?? stepIndex
      const step = steps[stepIndex]
      const next = indoorLeg(step)
      // Every method is re-anchored only on entering a new indoor leg (after stairs, a lift, the bridge or the entrance).
      if (next !== null && next !== legIndex) anchor(step)
      legIndex = next
    } else if (event.kind === 'gps') {
      lastGps = event.fix
      if (log.geo && steps[stepIndex]?.floor === SITE && event.fix.accuracy <= 25) {
        const xy = latLonToMap(log.geo, event.fix.lat, event.fix.lon)
        const snapped = outdoorLegs.map((leg) => {
          const lengths = cumulative(leg.points)
          const s = distanceAlong(leg.points, lengths, xy)
          const p = createRoutePositioner(leg.points, { start: s }).position()
          return { p, gap: Math.hypot(p[0] - xy[0], p[1] - xy[1]) }
        }).sort((a, b) => a.gap - b.gap)[0]
        if (snapped && snapped.gap <= 15) learner.observe(snapped.p)
        else learner.pause()
      }
    } else if (event.kind === 'motion') {
      for (const detected of detector.feed(event.sample)) {
        if (detected.type === 'step') {
          learner.step()
          if (legIndex === null) continue
          tracker.route.step(); tracker['route+corner'].step(); tracker.full.step()
          tracker.steps.step(heading0 + turnSign * (detector.heading - headingAtAnchor))
        } else if (legIndex !== null) {
          tracker['route+corner'].turn(); tracker.full.turn()
        }
      }
    } else {
      const truth = spots[event.mark.spot]
      if (!truth) continue
      const floor = steps[stepIndex]?.floor
      const errors = {}
      for (const method of METHODS) {
        let estimate = null
        if (method === 'gps') estimate = lastGps && log.geo ? latLonToMap(log.geo, lastGps.lat, lastGps.lon) : null
        else if (legIndex !== null && String(floor) === String(truth.floor)) estimate = tracker[method].position()
        errors[method] = estimate ? Math.hypot(estimate[0] - truth.xy[0], estimate[1] - truth.xy[1]) : null
      }
      results.push({ spot: event.mark.spot, floor, errors })
    }
  }
  return { results, stride: learner.stride, strideLearned: learner.learned }
}

function summary(values) {
  const sorted = values.filter((v) => v !== null).sort((a, b) => a - b)
  if (!sorted.length) return { n: 0 }
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return { n: sorted.length, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length, median: at(0.5), p90: at(0.9), max: sorted.at(-1) }
}

const spots = readSpots(spotsFile)
const all = []
for (const file of walkFiles) {
  const log = JSON.parse(readFileSync(file, 'utf8'))
  const { results, stride, strideLearned } = replay(log, spots)
  all.push(...results)
  if (!options.json) console.log(`${file}: ${results.length} spots, stride ${stride.toFixed(2)} m${strideLearned ? ' (learned outdoors)' : ' (typical, not learned)'}`)
}
const table = Object.fromEntries(METHODS.map((method) => [method, summary(all.map((r) => r.errors[method]))]))
if (options.json) {
  console.log(JSON.stringify({ spots: all, summary: table }, null, 1))
} else {
  console.log('\nmethod         spots   mean  median    p90    max   (metres from the true spot)')
  for (const [method, s] of Object.entries(table)) {
    console.log(s.n ? `${method.padEnd(14)} ${String(s.n).padStart(5)} ${s.mean.toFixed(2).padStart(6)} ${s.median.toFixed(2).padStart(7)} ${s.p90.toFixed(2).padStart(6)} ${s.max.toFixed(2).padStart(6)}` : `${method.padEnd(14)}     0   (no estimates)`)
  }
}
