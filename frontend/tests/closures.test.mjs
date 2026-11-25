// Closures and the way out, on the real campus data (public/data).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const publicDir = fileURLToPath(new URL('../public', import.meta.url))
globalThis.window = { location: { search: '' } }
globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(readFileSync(publicDir + url, 'utf8')) })
const nav = await import('../src/services/mgeorgeRoute.js')
const model = await nav.loadBuilding()
const place = (name) => model.destinations.find((item) => item.name === name)
const cafeteria = place('Cafeteria')

test('a closed staircase is routed around and named', () => {
  const usual = nav.routeFromKiosk(model, cafeteria)
  const stairs = usual.transitions.find((item) => item.kind === 'stairs')
  const closed = nav.applyClosures(model, [{ id: 'a', type: 'shaft', shaft: stairs.shaft, reason: 'Cleaning' }])
  const route = nav.routeFromKiosk(closed, cafeteria)
  assert.ok(route)
  assert.ok(!route.transitions.some((item) => item.shaft === stairs.shaft))
  assert.deepEqual(nav.closuresAvoided(closed, nav.kioskStart(closed), cafeteria).map((item) => item.id), ['a'])
  assert.ok(closed.closures[0].marks.length >= 2, 'a mark on each floor the stairs serve')
})

test('a closed corridor is routed around', () => {
  const library = place('Tagore Library')
  const leg = nav.routeFromKiosk(model, library).legs[0]
  const middle = leg.points[Math.floor(leg.points.length / 2)]
  const closed = nav.applyClosures(model, [{ id: 'b', type: 'area', floor: leg.floor, xy: middle, radius_m: 3 }])
  const route = nav.routeFromKiosk(closed, library)
  assert.ok(route)
  for (const item of route.legs.filter((each) => each.floor === leg.floor)) {
    for (const point of item.points) assert.ok(Math.hypot(point[0] - middle[0], point[1] - middle[1]) > 1, 'keeps out of the closed stretch')
  }
})

test('closing the bridge cuts Ramanujan Block off; malformed closures are ignored', () => {
  const closed = nav.applyClosures(model, [{ id: 'c', type: 'link', name: 'bridge to Ramanujan Block' }, { type: 'door' }, { id: 'd', type: 'shaft', shaft: 'nope' }])
  assert.equal(closed.closures.length, 1)
  assert.equal(nav.routeFromKiosk(closed, cafeteria), null)
  assert.equal(nav.applyClosures(model, []), model)
})

test('the way out uses stairs only and avoids a closed exit', () => {
  const room = model.destinations.find((item) => item.floor === 4 && item.category !== 'exit')
  const start = nav.startAt(model, 4, room.approach_xy ?? room.xy)
  const out = nav.routeToNearestExit(model, start)
  assert.ok(out.route && out.exit)
  assert.ok(out.route.evacuate)
  assert.ok(!out.route.transitions.some((item) => item.kind === 'lift'))
  assert.ok(nav.exitsOf(model).some((item) => item.id === out.exit.id))
  const exitPoint = out.exit.approach_xy ?? out.exit.xy
  const blocked = nav.applyClosures(model, [{ id: 'e', type: 'area', floor: out.exit.floor, xy: exitPoint, radius_m: 2 }])
  const other = nav.routeToNearestExit(blocked, start)
  assert.ok(other.route)
  assert.notEqual(other.exit.id, out.exit.id)
})

test('no way out that climbs first (Ramanujan Ground Floor has no mapped door yet)', () => {
  const out = nav.routeToNearestExit(model, nav.startAt(model, 'R0', cafeteria.approach_xy ?? cafeteria.xy))
  assert.equal(out.route, null)
  assert.equal(out.unmapped, true)
})

test('QR links use the page address, and the configured one only on localhost', () => {
  assert.equal(nav.phoneBaseUrl('http://localhost:5173', 'http://10.61.168.187:5173'), 'http://10.61.168.187:5173')
  assert.equal(nav.phoneBaseUrl('http://10.61.168.187:5173', 'http://10.85.254.187:5173'), 'http://10.61.168.187:5173')
  assert.equal(nav.phoneBaseUrl('https://navika.example.app', undefined), 'https://navika.example.app')
})
