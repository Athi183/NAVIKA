import { test } from 'node:test'
import assert from 'node:assert/strict'
globalThis.window = { location: { search: '' } }
const { sunPosition, sceneSun, sunMoment } = await import('../src/services/campusSun.js')

const MITS = { lat: 9.964, lon: 76.409 }
const ist = (iso) => new Date(`${iso}+05:30`)

test('noon in November: high in the southern sky', () => {
  const { azimuth, elevation } = sunPosition(ist('2026-11-15T12:20:00'), MITS.lat, MITS.lon)
  assert.ok(elevation > 55 && elevation < 65, `elevation ${elevation}`)
  assert.ok(azimuth > 160 && azimuth < 200, `azimuth ${azimuth}`)
})

test('morning in the east, afternoon in the west', () => {
  assert.ok(Math.abs(sunPosition(ist('2026-11-15T08:00:00'), MITS.lat, MITS.lon).azimuth - 120) < 20)
  assert.ok(Math.abs(sunPosition(ist('2026-11-15T16:00:00'), MITS.lat, MITS.lon).azimuth - 235) < 20)
})

test('the March equinox sun at noon is near overhead', () => {
  const { elevation } = sunPosition(ist('2026-03-20T12:30:00'), MITS.lat, MITS.lon)
  assert.ok(elevation > 75, `elevation ${elevation}`)
})

test('at night a fixed daytime sun is used; the map turn is applied', () => {
  const geo = { lat0: MITS.lat, lon0: MITS.lon, matrix: [[-1, 0], [0, -1]] }
  const night = sceneSun(geo, ist('2026-11-15T22:00:00'))
  assert.equal(night.daylight, false)
  assert.ok(night.offset[1] > 0)
  // Afternoon sun in the true south-west; on a map turned 180 degrees it lies to map north-east: +x, map +y (scene -z).
  const afternoon = sceneSun(geo, ist('2026-11-15T15:30:00'))
  assert.ok(afternoon.daylight && afternoon.offset[0] > 0 && afternoon.offset[2] < 0, JSON.stringify(afternoon.offset))
})

test('?sun=HH:MM picks that Indian time today', () => {
  const moment = sunMoment('?sun=16:30', ist('2026-11-15T09:00:00'))
  assert.equal(moment.toISOString(), '2026-11-15T11:00:00.000Z')
  assert.equal(sunMoment('?sun=bad', new Date(0)).getTime(), 0)
})
