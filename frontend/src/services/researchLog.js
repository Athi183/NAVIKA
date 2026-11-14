// Research mode (`&research=1` on a phone route link): records a walk for the
// indoor tracking study, to be replayed by scripts/replay-walk.mjs. It holds the
// route, raw motion samples, GPS fixes, step changes and the numbered spots the
// walker marks, and nothing about the person. It stays on the phone until the
// walker saves it as a file.

export const LOG_VERSION = 1

/** A new log for one walk of `route` (as from routeFrom) to `destination`. */
export function createResearchLog({ route, destination, geo, stride }) {
  const started = Date.now()
  const log = {
    version: LOG_VERSION,
    started: new Date(started).toISOString(),
    device: { userAgent: navigator.userAgent, screen: [window.screen.width, window.screen.height] },
    destination: { id: destination.id, name: destination.name, floor: destination.floor },
    route: {
      legs: route.legs.map((leg) => ({ floor: leg.floor, points: leg.points })),
      steps: route.steps.map((step) => ({ text: step.text, floor: step.floor, leg: step.leg, point: step.point, transition: step.transition?.kind ?? null })),
    },
    geo: geo ?? null,
    initialStride: stride,
    // Compact rows: motion [t, ax, ay, az, ra, rb, rg]; the rest are objects with t.
    motion: [],
    gps: [],
    stepChanges: [],
    marks: [],
  }
  return {
    log,
    motion(sample) {
      log.motion.push([sample.t, sample.ax, sample.ay, sample.az, sample.ra, sample.rb, sample.rg].map((v) => Math.round(v * 1000) / 1000))
    },
    gps(fix) { log.gps.push(fix) },
    stepChange(change) { log.stepChanges.push(change) },
    mark(mark) { log.marks.push(mark) },
    seconds() { return Math.round((Date.now() - started) / 1000) },
  }
}

/** Save the log as a JSON file on the phone. */
export function downloadLog(log) {
  const blob = new Blob([JSON.stringify(log)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `navika-walk-${log.started.replace(/[:.]/g, '-')}.json`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
