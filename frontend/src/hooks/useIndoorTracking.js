import { useCallback, useEffect, useRef, useState } from 'react'
import { SITE } from '../services/mgeorgeRoute'
import { DEFAULT_STRIDE_M, createMotionDetector, createRoutePositioner, createStrideLearner } from '../services/indoorTracker'
import { requestMotionAccess, watchMotion } from '../services/motionSensors'
import { createResearchLog, downloadLog } from '../services/researchLog'

const NO_DATA_MS = 3000 // a phone without motion sensors never sends a reading

/** The indoor walking leg a step belongs to, or null outside and on stairs/lifts. */
const indoorLeg = (step) => (step && step.floor !== SITE && !step.transition ? step.leg : null)

/**
 * Route-anchored indoor tracking for the phone route (see indoorTracker.js).
 * While `active`, motion readings move the visitor along the current indoor
 * leg and `onReachStep(index)` moves the steps on. A step the visitor taps
 * re-anchors the position at that step's start. `observeOutdoor(xy)` (GPS
 * snapped to the route, or null) teaches the stride. With `research`, the walk
 * is recorded for scripts/replay-walk.mjs.
 *
 * Returns { status, position, stats, requestAccess, observeOutdoor, logGps, mark, save }.
 * `requestAccess` must be called straight from a tap (iPhone asks permission then).
 */
export function useIndoorTracking({ active, route, stepIndex, onReachStep, research = false, destination = null, geo = null }) {
  const [status, setStatus] = useState('off') // off | on | nodata | denied | insecure | unavailable
  const [position, setPosition] = useState(null)
  const [stats, setStats] = useState({ steps: 0, turns: 0, stride: DEFAULT_STRIDE_M, learned: false, marks: 0, seconds: 0 })
  const detector = useRef(null)
  const learner = useRef(createStrideLearner())
  const positioner = useRef(null)
  const leg = useRef(null)
  const current = useRef({ route, stepIndex })
  const movedByTracker = useRef(false)
  const log = useRef(null)
  const counts = useRef({ steps: 0, turns: 0, marks: 0 })

  // Re-anchor on every step change the tracker did not cause itself (a tap, GPS, a new route).
  useEffect(() => {
    current.current = { route, stepIndex }
    const step = active && route ? route.steps[stepIndex] : null
    log.current?.stepChange({ t: performance.now(), index: stepIndex, by: movedByTracker.current ? 'motion' : 'tap-or-gps' })
    const legIndex = indoorLeg(step)
    if (legIndex === null) {
      positioner.current = null
      leg.current = null
    } else if (!movedByTracker.current || leg.current !== legIndex) {
      const points = route.legs[legIndex].points
      if (leg.current !== legIndex || !positioner.current) positioner.current = createRoutePositioner(points, { stride: learner.current.stride })
      positioner.current.setStride(learner.current.stride)
      positioner.current.moveTo(positioner.current.distanceAlong(step.point))
      leg.current = legIndex
    }
    movedByTracker.current = false
  }, [active, route, stepIndex])

  // Motion readings → steps and turns → position and step changes.
  useEffect(() => {
    if (!active || status !== 'on') return undefined
    let received = false
    const silence = setTimeout(() => { if (!received) setStatus('nodata') }, NO_DATA_MS)
    const stop = watchMotion((sample) => {
      received = true
      log.current?.motion(sample)
      const events = detector.current.feed(sample)
      if (!events.length) return
      const tracker = positioner.current
      for (const event of events) {
        if (event.type === 'step') {
          counts.current.steps += 1
          learner.current.step()
          tracker?.step()
        } else {
          counts.current.turns += 1
          tracker?.turn()
        }
      }
      setStats((previous) => ({ ...previous, steps: counts.current.steps, turns: counts.current.turns, stride: learner.current.stride, learned: learner.current.learned }))
      if (!tracker) return
      const { route: activeRoute, stepIndex: activeStep } = current.current
      setPosition({ route: activeRoute, leg: leg.current, xy: tracker.position(), accuracy: tracker.uncertainty })
      // The furthest step of this leg the visitor has reached; at the leg's end, the stairs/lift/arrival step after it.
      let reached = activeStep
      activeRoute.steps.forEach((step, index) => {
        if (step.leg !== leg.current) return
        if (!step.transition && tracker.distanceAlong(step.point) <= tracker.progress + 1) reached = Math.max(reached, index)
        if (step.transition && tracker.progress >= tracker.length - 1.5) reached = Math.max(reached, index)
      })
      if (tracker.progress >= tracker.length - 1.5) reached = Math.max(reached, activeRoute.steps.findLastIndex((step) => step.leg === leg.current))
      if (reached > activeStep) {
        movedByTracker.current = true
        onReachStep(reached)
      }
    })
    return () => {
      clearTimeout(silence)
      stop()
    }
  }, [active, status, onReachStep])

  const requestAccess = useCallback(async () => {
    const access = await requestMotionAccess()
    detector.current = createMotionDetector()
    if (research && route && destination) log.current = createResearchLog({ route, destination, geo, stride: learner.current.stride })
    setStatus(access === 'granted' ? 'on' : access)
  }, [research, route, destination, geo])

  const observeOutdoor = useCallback((xy) => {
    if (xy) learner.current.observe(xy)
    else learner.current.pause()
  }, [])

  const logGps = useCallback((fix) => { log.current?.gps(fix) }, [])

  const mark = useCallback(() => {
    if (!log.current) return
    counts.current.marks += 1
    const tracker = positioner.current
    const { route: activeRoute, stepIndex: activeStep } = current.current
    log.current.mark({
      t: performance.now(), spot: counts.current.marks, stepIndex: activeStep, floor: activeRoute?.steps[activeStep]?.floor ?? null,
      leg: leg.current, progress: tracker?.progress ?? null, xy: tracker?.position() ?? null, stride: learner.current.stride,
    })
    setStats((previous) => ({ ...previous, marks: counts.current.marks, seconds: log.current.seconds() }))
  }, [])

  const save = useCallback(() => { if (log.current) downloadLog(log.current.log) }, [])

  // Only a position on the leg being walked now, on this route.
  const step = route?.steps[stepIndex]
  const shown = position && position.route === route && position.leg === indoorLeg(step) ? { floor: step.floor, xy: position.xy, accuracy: position.accuracy } : null
  return { status: active ? status : 'off', position: shown, stats, requestAccess, observeOutdoor, logGps, mark, save, recording: Boolean(research) }
}
