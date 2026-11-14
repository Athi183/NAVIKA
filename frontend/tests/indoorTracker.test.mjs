// Run with: npm test (node --test). Uses simulated walks (scripts/synthetic-walk.mjs);
// the numbers here check the code, they are not field results.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createFreePositioner, createMotionDetector, createRoutePositioner, createStrideLearner,
  cumulative, distanceAlong, pointAt, routeCorners,
} from '../src/services/indoorTracker.js'
import { syntheticWalk } from '../scripts/synthetic-walk.mjs'

// A corridor walk with three corners, about 87 m.
const ROUTE = [[0, 0], [30, 0], [30, 20], [5, 20], [5, 32]]

function replay(walk, points, { variant, stride }) {
  const detector = createMotionDetector()
  const lengths = cumulative(points)
  const route = createRoutePositioner(points, { stride, snapCorners: variant !== 'route' })
  const free = createFreePositioner(points[0], { stride })
  const heading0 = (Math.atan2(points[1][1] - points[0][1], points[1][0] - points[0][0]) * 180) / Math.PI
  let steps = 0
  let turns = 0
  const errors = []
  for (const sample of walk.samples) {
    for (const event of detector.feed(sample)) {
      if (event.type === 'step') {
        steps += 1
        route.step()
        free.step(heading0 + detector.heading)
      } else {
        turns += 1
        route.turn()
      }
    }
    if (Math.round(sample.t) % 2000 === 0) {
      const truth = pointAt(points, lengths, walk.truthAt(sample.t))
      const estimate = variant === 'free' ? free.position() : route.position()
      errors.push(Math.hypot(estimate[0] - truth[0], estimate[1] - truth[1]))
    }
  }
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length
  return { steps, turns, mean, end: errors.at(-1) }
}

test('corners are found where the route bends', () => {
  const corners = routeCorners(ROUTE)
  assert.deepEqual(corners.map((c) => Math.round(c.s)), [30, 50, 75])
  assert.deepEqual(corners.map((c) => Math.round(c.angle)), [90, 90, -90])
})

test('points along the route and back', () => {
  const lengths = cumulative(ROUTE)
  const p = pointAt(ROUTE, lengths, 40)
  assert.deepEqual(p.map(Math.round), [30, 10])
  assert.equal(Math.round(distanceAlong(ROUTE, lengths, [31, 10])), 40)
})

test('steps and turns are detected from the motion data', () => {
  const walk = syntheticWalk(ROUTE)
  const result = replay(walk, ROUTE, { variant: 'route+corners', stride: 0.7 })
  assert.ok(Math.abs(result.steps - walk.steps) <= walk.steps * 0.03, `${result.steps} steps detected, ${walk.steps} walked`)
  assert.equal(result.turns, 3)
})

test('each method is more accurate than the one before it', () => {
  const walk = syntheticWalk(ROUTE, { strideM: 0.78 })
  // The stride a visitor's outdoor walk would teach: 40 steps over 31.2 m.
  const learner = createStrideLearner()
  for (let i = 0; i <= 40; i += 1) {
    if (i) learner.step()
    learner.observe([i * 0.78, 0])
  }
  assert.ok(learner.learned && Math.abs(learner.stride - 0.78) < 0.01)
  const free = replay(walk, ROUTE, { variant: 'free', stride: 0.7 })
  const route = replay(walk, ROUTE, { variant: 'route', stride: 0.7 })
  const corners = replay(walk, ROUTE, { variant: 'route+corners', stride: 0.7 })
  const learned = replay(walk, ROUTE, { variant: 'route+corners', stride: learner.stride })
  assert.ok(free.mean > route.mean && route.mean > corners.mean && corners.mean > learned.mean,
    `mean error: free ${free.mean.toFixed(2)}, route ${route.mean.toFixed(2)}, +corners ${corners.mean.toFixed(2)}, +stride ${learned.mean.toFixed(2)}`)
  assert.ok(learned.mean < 1.5, `learned stride mean error ${learned.mean.toFixed(2)} m`)
})

test('implausible strides are not learned', () => {
  const learner = createStrideLearner()
  for (let i = 0; i <= 30; i += 1) {
    if (i) learner.step()
    learner.observe([i * 2.5, 0]) // GPS jumping 2.5 m per step
  }
  assert.equal(learner.learned, false)
  assert.equal(learner.stride, 0.7)
})
