import { useMemo } from 'react'
import * as THREE from 'three'
import { terrainHeight } from '../../services/mgeorgeRoute'
import { TREE_KINDS, treeKind, treeSize } from './campusTrees'

// The campus ground as one surface: the campus paths and, with the OpenStreetMap
// layer, grass, sports pitches with their lines, parking, ponds and the campus
// boundary, painted onto one canvas and laid over the ground heights
// (campus_terrain.json; flat without them). For the whole-campus view
// (`surroundings`), soft shadows of the buildings and trees are painted in too,
// and the ground carries on past the campus so it can fade into the haze.

const MARGIN_M = 40
const MAX_TEXTURE_PX = 4096
const MAX_PX_PER_M = 3
const SEGMENT_M = 5 // one surface square per terrain cell
const COLOURS = {
  ground: '#2f4a36', path: [205, 211, 220], grass: '#4E7B47', parking: '#5B606A', water: '#3E86BC',
  pitch: '#6F9B55', // a playing field, unless OSM names a court sport
  line: '#F4F1EA', boundary: '#F1E4C8',
}
const STOREY_M = 3.3
const APRON_M = 6000 // the ground beyond the campus, lost in the haze long before its edge
// In the whole-campus view the open ground is a lighter, sunlit green, so shadows read on it.
const SUNLIT_GROUND = '#6A8C52'
const PITCH_COLOURS = { basketball: '#B5563B', volleyball: '#CF9A5A', tennis: '#4F86A6', cricket: '#7FA75A', football: '#5E9A4E' }
const AREA_ORDER = ['grass', 'parking', 'water', 'pitch']

/** The area the ground covers: the campus paths and everything OpenStreetMap has here, with a margin. */
function extentOf(site, osm) {
  const { origin_xy: [mx, my], cols, rows, cell_m: cell } = site.mask
  const xs = [mx, mx + cols * cell]
  const ys = [my, my + rows * cell]
  for (const [x, y] of osm ? [...osm.boundary, ...osm.buildings.flatMap((b) => b.outline), ...osm.areas.flatMap((a) => a.outline)] : []) {
    xs.push(x)
    ys.push(y)
  }
  return { x0: Math.min(...xs) - MARGIN_M, x1: Math.max(...xs) + MARGIN_M, y0: Math.min(...ys) - MARGIN_M, y1: Math.max(...ys) + MARGIN_M }
}


/**
 * What casts a shadow in the whole-campus view: every building (OSM blocks, and
 * M. George and Ramanujan from their storey outlines) with its height above the
 * campus ground, and the trees.
 */
function shadowCasters(osm, massing, siteLevel) {
  const buildings = (osm?.buildings ?? []).map((building) => ({ outline: building.outline, height: building.roof_only ? 6 : building.levels * STOREY_M }))
  for (const building of massing?.buildings ?? []) {
    const above = building.storeys.filter((storey) => storey.stack_level >= siteLevel)
    if (!above.length) continue
    const height = (Math.max(...above.map((storey) => storey.stack_level)) - siteLevel + 1) * massing.storey_height_m
    // The footprint at ground level, outer rings only (a courtyard still lies in shadow).
    for (const part of above[0].parts) buildings.push({ outline: part.outer, height })
  }
  return { buildings, trees: osm?.trees ?? [] }
}

/**
 * Soft shadows on the ground: each building's footprint swept along the sun's
 * offset for its height, then blurred, plus a darker rim right at its foot.
 * Drawn on a separate mask first so overlapping shadows do not darken each other.
 */
function paintShadows(ctx, toPx, ppm, { buildings, trees }, sun) {
  // The map offset of a shadow per metre of height, away from the sun
  // (`sun` = the light's [x, y, z] offset in the scene, z pointing south).
  const SHADOW_PER_M = [-sun[0] / sun[1], sun[2] / sun[1]]
  const { width, height } = ctx.canvas
  const mask = document.createElement('canvas')
  mask.width = width
  mask.height = height
  const m = mask.getContext('2d')
  // Blur by shrinking the mask and stretching it back with smoothing: works in
  // every browser (ctx.filter does not everywhere) and costs one paint.
  const blurred = (alpha, blurM) => {
    const factor = Math.max(1, Math.round((blurM * ppm) / 2))
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.ceil(width / factor))
    small.height = Math.max(1, Math.ceil(height / factor))
    const s = small.getContext('2d')
    s.imageSmoothingEnabled = true
    s.drawImage(mask, 0, 0, small.width, small.height)
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.globalAlpha = alpha
    ctx.drawImage(small, 0, 0, width, height)
    ctx.restore()
    m.clearRect(0, 0, width, height)
  }
  const outlinePath = (outline, [dx, dy]) => {
    m.beginPath()
    outline.forEach(([x, y], index) => {
      const [px, py] = toPx([x + dx, y + dy])
      if (index) m.lineTo(px, py)
      else m.moveTo(px, py)
    })
    m.closePath()
    m.fill()
  }
  m.fillStyle = 'rgb(6, 18, 10)'
  // Cast shadows: the footprint at several points along the offset fills the swept shape.
  for (const { outline, height: h } of buildings) {
    const steps = Math.max(2, Math.ceil(h / 2))
    for (let i = 0; i <= steps; i += 1) outlinePath(outline, SHADOW_PER_M.map((value) => value * h * (i / steps)))
  }
  // Each tree's crown, cast from its height (palms high and small, rain trees wide).
  for (const { xy } of trees) {
    const kind = TREE_KINDS[treeKind(xy)]
    const size = treeSize(xy)
    const lift = (kind.height - kind.crown * 0.3) * size
    const [px, py] = toPx([xy[0] + SHADOW_PER_M[0] * lift, xy[1] + SHADOW_PER_M[1] * lift])
    m.beginPath()
    m.ellipse(px, py, kind.crown * size * ppm, kind.crown * size * 0.75 * ppm, 0, 0, Math.PI * 2)
    m.fill()
  }
  blurred(0.5, 2.5)
  // Contact shadow: a tight, darker rim where each building meets the ground.
  for (const { outline } of buildings) outlinePath(outline, [0, 0])
  blurred(0.35, 0.9)
}

// Fixed "random" number in [0, 1) for a number, so the ground looks the same on every visit.
const hash = (n) => ((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1

/** Soft patches of lighter and darker green over the open ground, so it is not one flat colour. */
function paintGrassPatches(ctx, ppm) {
  const { width, height } = ctx.canvas
  const count = Math.round((width * height) / (ppm * ppm * 350))
  for (let i = 0; i < count; i += 1) {
    const radius = (4 + hash(i * 3 + 2) * 10) * ppm
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
    const tone = hash(i * 3 + 1) < 0.5 ? '20, 45, 18' : '170, 190, 120'
    gradient.addColorStop(0, `rgba(${tone}, 0.10)`)
    gradient.addColorStop(1, `rgba(${tone}, 0)`)
    ctx.save()
    ctx.translate(hash(i * 3) * width, hash(i * 3 + 7) * height)
    ctx.fillStyle = gradient
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2)
    ctx.restore()
  }
}

const BAY_M = 2.5
const ROW_M = 5
const AISLE_M = 6

/**
 * White bay lines in a parking area: rows of 2.5 m bays, 5 m deep, along its
 * longest side, back to back in pairs with a 6 m aisle between pairs.
 * Typical layout, not surveyed.
 */
function paintParkingBays(ctx, toPx, ppm, outline) {
  let longest = null
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (!longest || length > longest.length) longest = { a, b, length }
  })
  if (!longest || longest.length < BAY_M * 2) return
  const u = [(longest.b[0] - longest.a[0]) / longest.length, (longest.b[1] - longest.a[1]) / longest.length]
  const v = [-u[1], u[0]]
  const along = outline.map(([x, y]) => (x - longest.a[0]) * u[0] + (y - longest.a[1]) * u[1])
  const across = outline.map(([x, y]) => (x - longest.a[0]) * v[0] + (y - longest.a[1]) * v[1])
  const [u0, u1, v0, v1] = [Math.min(...along), Math.max(...along), Math.min(...across), Math.max(...across)]
  const at = (s, t) => toPx([longest.a[0] + u[0] * s + v[0] * t, longest.a[1] + u[1] * s + v[1] * t])
  const line = (from, to) => {
    ctx.moveTo(...from)
    ctx.lineTo(...to)
  }
  ctx.save()
  ctx.beginPath()
  outline.forEach((point, index) => (index ? ctx.lineTo(...toPx(point)) : ctx.moveTo(...toPx(point))))
  ctx.closePath()
  ctx.clip()
  ctx.beginPath()
  let t = v0 + 0.5
  for (let row = 0; t + ROW_M <= v1 + 0.01; row += 1) {
    for (let s = u0 + 0.5; s <= u1 - 0.5; s += BAY_M) line(at(s, t), at(s, t + ROW_M))
    line(at(u0, row % 2 ? t : t + ROW_M), at(u1, row % 2 ? t : t + ROW_M)) // the line the bays back onto
    t += ROW_M + (row % 2 ? AISLE_M : 0)
  }
  ctx.strokeStyle = 'rgba(244, 241, 234, 0.85)'
  ctx.lineWidth = Math.max(1, 0.12 * ppm)
  ctx.stroke()
  ctx.restore()
}

function paint(site, osm, { x0, x1, y0, y1 }, casters = null, sun = null) {
  const groundColour = casters ? SUNLIT_GROUND : COLOURS.ground
  const ppm = Math.min(MAX_PX_PER_M, MAX_TEXTURE_PX / (x1 - x0), MAX_TEXTURE_PX / (y1 - y0))
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil((x1 - x0) * ppm)
  canvas.height = Math.ceil((y1 - y0) * ppm)
  const ctx = canvas.getContext('2d')
  // Canvas rows run north to south (top = north).
  const toPx = ([x, y]) => [(x - x0) * ppm, (y1 - y) * ppm]
  const trace = (outline) => {
    ctx.beginPath()
    outline.forEach((point, index) => (index ? ctx.lineTo(...toPx(point)) : ctx.moveTo(...toPx(point))))
    ctx.closePath()
  }
  ctx.fillStyle = groundColour
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // The whole-campus view (with shadows) gets the finer ground detail.
  const detailed = Boolean(casters)
  if (detailed) paintGrassPatches(ctx, ppm)

  for (const kind of AREA_ORDER) {
    for (const area of osm?.areas.filter((item) => item.kind === kind) ?? []) {
      trace(area.outline)
      ctx.fillStyle = kind === 'pitch' ? PITCH_COLOURS[area.sport] ?? COLOURS.pitch : COLOURS[kind]
      ctx.fill()
      if (kind === 'parking' && detailed) paintParkingBays(ctx, toPx, ppm, area.outline)
      if (kind === 'pitch') {
        ctx.strokeStyle = COLOURS.line
        ctx.lineWidth = Math.max(1.5, 0.25 * ppm)
        ctx.stroke()
      }
    }
  }

  // The walkable campus paths, from the routing mask (rows run south to north there).
  const { mask } = site
  const image = new ImageData(mask.cols, mask.rows)
  for (let row = 0; row < mask.rows; row += 1) {
    for (let col = 0; col < mask.cols; col += 1) {
      const bit = row * mask.cols + col
      if (!((mask.bytes[bit >> 3] >> (7 - (bit & 7))) & 1)) continue
      const at = ((mask.rows - 1 - row) * mask.cols + col) * 4
      // A slight grain, like paving, in the detailed view.
      const grain = detailed ? Math.round((hash(bit) - 0.5) * 14) : 0
      image.data.set([COLOURS.path[0] + grain, COLOURS.path[1] + grain, COLOURS.path[2] + grain, 255], at)
    }
  }
  const paths = document.createElement('canvas')
  paths.width = mask.cols
  paths.height = mask.rows
  paths.getContext('2d').putImageData(image, 0, 0)
  const [left, top] = toPx([mask.origin_xy[0], mask.origin_xy[1] + mask.rows * mask.cell_m])
  ctx.imageSmoothingEnabled = true
  if (detailed) {
    // A kerb: the paths' own outline in a darker grey, just showing round their edges.
    ctx.save()
    ctx.shadowColor = 'rgba(95, 98, 104, 0.95)'
    ctx.shadowBlur = Math.max(1.5, 0.35 * ppm)
    ctx.drawImage(paths, left, top, mask.cols * mask.cell_m * ppm, mask.rows * mask.cell_m * ppm)
    ctx.restore()
  }
  ctx.drawImage(paths, left, top, mask.cols * mask.cell_m * ppm, mask.rows * mask.cell_m * ppm)

  if (casters) paintShadows(ctx, toPx, ppm, casters, sun)

  if (osm) {
    trace(osm.boundary)
    ctx.setLineDash([3 * ppm, 2 * ppm])
    ctx.strokeStyle = COLOURS.boundary
    ctx.lineWidth = Math.max(2, 0.6 * ppm)
    ctx.stroke()
    ctx.setLineDash([])
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/**
 * `site` (campus paths), `osm` (optional OpenStreetMap layer) and `terrain`
 * (optional ground heights) as in the model; `onClick` for taps on the ground.
 * `surroundings` ({ massing, siteLevel, sun }, whole-campus view only) adds the
 * building and tree shadows (away from `sun`, the light's offset) and the ground beyond the campus.
 */
export default function CampusGround({ site, osm = null, terrain = null, onClick, surroundings = null }) {
  const extent = useMemo(() => extentOf(site, osm), [site, osm])
  const casters = useMemo(() => surroundings && shadowCasters(osm, surroundings.massing, surroundings.siteLevel), [osm, surroundings])
  const texture = useMemo(() => paint(site, osm, extent, casters, surroundings?.sun), [site, osm, extent, casters, surroundings])
  const { centre, geometry } = useMemo(() => {
    const w = extent.x1 - extent.x0
    const d = extent.y1 - extent.y0
    const middle = [(extent.x0 + extent.x1) / 2, (extent.y0 + extent.y1) / 2]
    const plane = terrain
      ? new THREE.PlaneGeometry(w, d, Math.min(300, Math.ceil(w / SEGMENT_M)), Math.min(300, Math.ceil(d / SEGMENT_M)))
      : new THREE.PlaneGeometry(w, d)
    if (terrain) {
      // Plane x/y are map east/north from the middle; its z becomes height once laid flat.
      const position = plane.attributes.position
      for (let i = 0; i < position.count; i += 1) {
        position.setZ(i, terrainHeight(terrain, [middle[0] + position.getX(i), middle[1] + position.getY(i)]))
      }
      plane.computeVertexNormals()
    }
    return { centre: middle, geometry: plane }
  }, [extent, terrain])
  // The ground beyond the campus sits just under its lowest edge, so it never shows through.
  const apronY = useMemo(() => {
    if (!surroundings || !terrain) return -0.6
    const { x0, x1, y0, y1 } = extent
    const edge = [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]]
    return Math.min(...edge.map((point) => terrainHeight(terrain, point))) - 0.6
  }, [surroundings, terrain, extent])
  return <>
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[centre[0], -0.05, -centre[1]]} onClick={onClick}>
      <meshStandardMaterial map={texture} roughness={1} metalness={0} />
    </mesh>
    {surroundings && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centre[0], apronY, -centre[1]]}>
      <circleGeometry args={[APRON_M, 64]} />
      <meshStandardMaterial color={SUNLIT_GROUND} roughness={1} metalness={0} />
    </mesh>}
  </>
}
