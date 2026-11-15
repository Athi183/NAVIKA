import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Tree kinds on the campus view, as on a Kerala campus: tall coconut palms,
// wide umbrella-shaped rain trees and dense, dark mango trees. Each tree keeps
// its kind, size and turn from its position, so it looks the same on every visit.

// Fixed per-position "random" number in [0, 1).
export const jitter = (x, y) => ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1

// height: top of the crown; crown: its radius (both in metres, before the per-tree size).
export const TREE_KINDS = {
  palm: { share: 0.35, height: 10, crown: 2.6, trunk: '#8A7458', greens: ['#5E9440', '#6FA14A', '#557F38'] },
  rain: { share: 0.3, height: 6.3, crown: 4, trunk: '#5E4632', greens: ['#4F8A3C', '#5C9844', '#46803A'] },
  mango: { share: 0.35, height: 6, crown: 2.8, trunk: '#5A3F2A', greens: ['#2F6B2E', '#3A7634', '#285F28'] },
}

/** Which kind of tree stands at [x, y]. */
export function treeKind([x, y]) {
  const pick = jitter(x * 0.37 + 5, y * 0.53 + 11)
  return pick < TREE_KINDS.palm.share ? 'palm' : pick < TREE_KINDS.palm.share + TREE_KINDS.rain.share ? 'rain' : 'mango'
}

/** Size multiplier of the tree at [x, y], 0.8-1.3. */
export const treeSize = ([x, y]) => 0.8 + jitter(x, y) * 0.5

// mergeGeometries needs every part alike: all without an index.
const flat = (geometry) => (geometry.index ? geometry.toNonIndexed() : geometry)

/** Low-poly trunk and crown geometries per kind, with the base of the trunk at y = 0. */
export function treeGeometries() {
  // Coconut palm: a tall, thin trunk and a ring of drooping fronds.
  const palmTrunk = new THREE.CylinderGeometry(0.14, 0.24, 9, 6).translate(0, 4.5, 0)
  const fronds = []
  for (let i = 0; i < 9; i += 1) {
    const frond = new THREE.ConeGeometry(0.5, 4.2, 4).scale(0.18, 1, 1) // a long blade, lying flat once turned outwards
    frond.translate(0, 2.1, 0) // from its base outwards
    frond.rotateZ(-Math.PI / 2 - 0.35 - (i % 3) * 0.12) // out sideways, drooping
    frond.rotateY((i / 9) * Math.PI * 2 + (i % 2) * 0.2)
    frond.translate(0, 9, 0)
    fronds.push(flat(frond))
  }
  fronds.push(flat(new THREE.IcosahedronGeometry(0.45, 0).translate(0, 8.9, 0))) // the coconuts
  // Rain tree: a short trunk under a wide, flat umbrella of foliage in three lobes.
  const rainTrunk = new THREE.CylinderGeometry(0.28, 0.45, 4, 6).translate(0, 2, 0)
  const rainCrown = [[0, 0, 0, 1], [2.2, -0.3, 1.2, 0.7], [-1.8, -0.2, -1.5, 0.75]].map(([x, y, z, s]) =>
    flat(new THREE.IcosahedronGeometry(1, 1).scale(3.6 * s, 1.3 * s, 3.6 * s).translate(x * 0.7, 5 + y, z * 0.7)))
  // Mango: a sturdy trunk under a dense, rounded dome.
  const mangoTrunk = new THREE.CylinderGeometry(0.25, 0.38, 2.4, 6).translate(0, 1.2, 0)
  const mangoCrown = [[0, 0, 0, 1], [0.9, 0.5, -0.6, 0.7]].map(([x, y, z, s]) =>
    flat(new THREE.IcosahedronGeometry(2.6 * s, 1).scale(1, 0.85, 1).translate(x, 3.7 + y, z)))
  return {
    palm: { trunk: palmTrunk, crown: mergeGeometries(fronds) },
    rain: { trunk: rainTrunk, crown: mergeGeometries(rainCrown) },
    mango: { trunk: mangoTrunk, crown: mergeGeometries(mangoCrown) },
  }
}
