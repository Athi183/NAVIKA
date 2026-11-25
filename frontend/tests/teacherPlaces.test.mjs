import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const publicDir = fileURLToPath(new URL('../public', import.meta.url))
globalThis.window = { location: { search: '' } }
globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(readFileSync(publicDir + url, 'utf8')) })
const nav = await import('../src/services/mgeorgeRoute.js')
const { DEPARTMENT_OFFICES, searchTeachers, teacherOffice } = await import('../src/services/teacherPlaces.js')
const model = await nav.loadBuilding()

const faculty = [
  { name: 'Dr. Anu Mary Thomas', department: 'Computer Science & Engineering' },
  { name: 'Prof. Rajesh K', department: 'Mechanical Engineering' },
  { name: 'Ms. Meera Nair', department: 'Unknown Department' },
]

test('every department office is a reachable place on the map', () => {
  for (const [department, id] of Object.entries(DEPARTMENT_OFFICES)) {
    const place = model.destinations.find((item) => item.id === id)
    assert.ok(place, `${department}: ${id} missing`)
    assert.ok(nav.routeFromKiosk(model, place), `${department}: no route`)
  }
})

test('names match without titles, by any part, from three letters', () => {
  assert.deepEqual(searchTeachers(faculty, 'dr anu').map((p) => p.name), ['Dr. Anu Mary Thomas'])
  assert.deepEqual(searchTeachers(faculty, 'thom').map((p) => p.name), ['Dr. Anu Mary Thomas'])
  assert.deepEqual(searchTeachers(faculty, 'raj').map((p) => p.name), ['Prof. Rajesh K'])
  assert.deepEqual(searchTeachers(faculty, 'an'), [])
})

test('a teacher leads to their department office, or nowhere when unmapped', () => {
  assert.equal(teacherOffice(model, faculty[0]).id, 'rb2_room_301')
  assert.equal(teacherOffice(model, faculty[2]), null)
})
