// Simulated phone sensor data for walking a known polyline: a vertical bounce
// per step, a yaw rate while turning at each corner, sensor noise and a slow
// gyroscope drift. For testing the indoor tracker without walking on campus.
// These are not measurements and must never be reported as results.

const G = 9.81

/** Small deterministic random generator, so tests repeat exactly. */
function random(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

/**
 * Samples for walking `points` (metres) with the given stride and cadence.
 * Returns { samples, steps, truthAt(t) -> metres walked, length }.
 */
export function syntheticWalk(points, { strideM = 0.75, stepMs = 520, hz = 50, noise = 0.35, gyroDriftDegPerS = 0.6, turnMs = 1200, seed = 7 } = {}) {
  const rand = random(seed)
  const gauss = () => (rand() + rand() + rand() - 1.5) * 2 * noise
  const lengths = [0]
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
  const length = lengths.at(-1)
  // Turns: at each vertex, the change of direction (+ = left), spread over turnMs.
  const turns = []
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = Math.atan2(points[i][1] - points[i - 1][1], points[i][0] - points[i - 1][0])
    const b = Math.atan2(points[i + 1][1] - points[i][1], points[i + 1][0] - points[i][0])
    const angle = (Math.atan2(Math.sin(b - a), Math.cos(b - a)) * 180) / Math.PI
    if (Math.abs(angle) > 5) turns.push({ s: lengths[i], angle })
  }
  const speed = strideM / stepMs // metres per ms
  const duration = length / speed
  const samples = []
  for (let t = 0; t <= duration; t += 1000 / hz) {
    const phase = (t % stepMs) / stepMs
    let yaw = gyroDriftDegPerS
    for (const turn of turns) {
      const start = turn.s / speed - turnMs / 2
      if (t >= start && t < start + turnMs) yaw += turn.angle / (turnMs / 1000)
    }
    samples.push({
      t,
      ax: gauss(),
      ay: gauss(),
      az: G + 2.6 * Math.sin(2 * Math.PI * phase) + gauss(),
      ra: yaw + gauss() * 2,
      rb: gauss() * 2,
      rg: gauss() * 2,
    })
  }
  return { samples, steps: Math.floor(duration / stepMs), truthAt: (t) => Math.min(length, t * speed), length, turns }
}
