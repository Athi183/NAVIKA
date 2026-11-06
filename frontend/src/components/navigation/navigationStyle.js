// Route styling: blue route with a darker edge, the walked part turning grey
// behind a walking person, a pulsing blue dot for "you are here".
export const NAV_BLUE = '#4285F4'
export const NAV_BLUE_EDGE = '#1A57B8'
export const NAV_WALKED = '#7A7F85'
export const NAV_SPEED_MPS = 5 // preview speed, faster than walking so a loop stays short
export const NAV_PAUSE_S = 1.5 // rest at the destination before the preview repeats

const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]))

/** Running length along a polyline of 2D or 3D points. */
export function cumulativeLengths(points) {
  const cumulative = [0]
  for (let i = 1; i < points.length; i += 1) cumulative.push(cumulative[i - 1] + distance(points[i], points[i - 1]))
  return cumulative
}

/**
 * Distance travelled and position at `seconds` into the preview loop, plus the
 * direction of the current segment (`delta`, same dimensions as the points).
 */
export function routeProgress(points, cumulative, seconds) {
  const total = cumulative.at(-1)
  const cycle = total / NAV_SPEED_MPS + NAV_PAUSE_S
  const travelled = Math.min((seconds % cycle) * NAV_SPEED_MPS, total)
  let i = 1
  while (i < cumulative.length - 1 && cumulative[i] < travelled) i += 1
  const t = (travelled - cumulative[i - 1]) / ((cumulative[i] - cumulative[i - 1]) || 1)
  const a = points[i - 1]
  const b = points[i]
  return { travelled, total, point: a.map((value, k) => value + (b[k] - value) * t), delta: a.map((value, k) => b[k] - value) }
}
