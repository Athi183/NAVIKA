import { useMemo } from 'react'
import * as THREE from 'three'
import { terrainHeight } from '../../services/mgeorgeRoute'

// The campus ground as one surface: the campus paths and, with the OpenStreetMap
// layer, grass, sports pitches with their lines, parking, ponds and the campus
// boundary, painted onto one canvas and laid over the ground heights
// (campus_terrain.json; flat without them).

const MARGIN_M = 40
const MAX_TEXTURE_PX = 4096
const MAX_PX_PER_M = 3
const SEGMENT_M = 5 // one surface square per terrain cell
const COLOURS = {
  ground: '#2f4a36', path: [205, 211, 220], grass: '#4E7B47', parking: '#5B606A', water: '#3E86BC',
  pitch: '#6F9B55', // a playing field, unless OSM names a court sport
  line: '#F4F1EA', boundary: '#F1E4C8',
}
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

function paint(site, osm, { x0, x1, y0, y1 }) {
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
  ctx.fillStyle = COLOURS.ground
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (const kind of AREA_ORDER) {
    for (const area of osm?.areas.filter((item) => item.kind === kind) ?? []) {
      trace(area.outline)
      ctx.fillStyle = kind === 'pitch' ? PITCH_COLOURS[area.sport] ?? COLOURS.pitch : COLOURS[kind]
      ctx.fill()
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
      image.data.set([...COLOURS.path, 255], at)
    }
  }
  const paths = document.createElement('canvas')
  paths.width = mask.cols
  paths.height = mask.rows
  paths.getContext('2d').putImageData(image, 0, 0)
  const [left, top] = toPx([mask.origin_xy[0], mask.origin_xy[1] + mask.rows * mask.cell_m])
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(paths, left, top, mask.cols * mask.cell_m * ppm, mask.rows * mask.cell_m * ppm)

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
 */
export default function CampusGround({ site, osm = null, terrain = null, onClick }) {
  const extent = useMemo(() => extentOf(site, osm), [site, osm])
  const texture = useMemo(() => paint(site, osm, extent), [site, osm, extent])
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
  return <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[centre[0], -0.05, -centre[1]]} onClick={onClick}>
    <meshStandardMaterial map={texture} roughness={1} metalness={0} />
  </mesh>
}
