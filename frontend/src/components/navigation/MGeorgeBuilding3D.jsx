import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Billboard, Html, Line, OrbitControls, Text, useTexture } from '@react-three/drei'
import { NAV_BLUE, NAV_BLUE_EDGE, NAV_WALKED, cumulativeLengths, routeProgress } from './navigationStyle'
import { levelOf as levelOfFloor } from '../../services/mgeorgeRoute'

// Same look as the Ramanujan viewer (ramanujan-viewer/src/App.tsx): dark scene,
// extruded brick walls, room floors coloured by type, floating labels.
const BACKGROUND = '#202025'
const WALL_COLOUR = '#B86F70'
const WINDOW_COLOUR = '#79b7c4'
const STAIR_COLOUR = '#9b7bd1'
const WALL_HEIGHT = 2.8
const ROUTE_WALL_HEIGHT = 2.0 // lower walls while showing a route, so they hide less of it
const FLOOR_GAP = 9 // display spacing between stacked floors (exploded view, not real storey height)
const LABEL_HEIGHT = 3.4
const LABEL_FONT = '/fonts/NotoSans-Bold.ttf'
const BRAND = '#d8151c'

const GROUP_BY_CATEGORY = {
  lab: 'teaching', classroom: 'teaching', hall: 'teaching',
  office: 'office', department: 'office', library: 'office', service: 'office',
  facility: 'office', food: 'office',
  stairs: 'connector', lift: 'connector', exit: 'connector',
  toilet: 'toilet', circulation: 'corridor', entrance: 'corridor',
}

const xz = ([x, y], height = 0) => [x, height, -y]

function WallMeshes({ segments, color, height, thickness, opacity = 1 }) {
  const meshRef = useRef()
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    segments.forEach(([x1, y1, x2, y2], index) => {
      quaternion.setFromAxisAngle(up, Math.atan2(y2 - y1, x2 - x1))
      matrix.compose(new THREE.Vector3((x1 + x2) / 2, height / 2, -(y1 + y2) / 2), quaternion, new THREE.Vector3(Math.hypot(x2 - x1, y2 - y1), height, thickness))
      mesh.setMatrixAt(index, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [segments, height, thickness])
  return <instancedMesh ref={meshRef} args={[undefined, undefined, segments.length]}>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial color={color} roughness={1} transparent={opacity < 1} opacity={opacity} />
  </instancedMesh>
}

function RoomFloor({ rooms, base }) {
  const texture = useTexture(`${base}/${rooms.texture.file}`, (loaded) => {
    loaded.colorSpace = THREE.SRGBColorSpace
    loaded.anisotropy = 8
  })
  const { origin_xy: [x0, y0], width_m: width, height_m: height } = rooms.texture
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x0 + width / 2, 0.01, -(y0 + height / 2)]}>
    <planeGeometry args={[width, height]} />
    <meshStandardMaterial map={texture} transparent alphaTest={0.5} roughness={1} metalness={0} side={THREE.DoubleSide} />
  </mesh>
}

function RoomLabels({ destinations, rooms, highlightId, onPick, scale = 1 }) {
  // Label room = the detected room's width, split between the places sharing it.
  const roomSpace = useMemo(() => {
    const space = new Map()
    for (const region of rooms?.regions || []) {
      const share = Math.max(1, region.destinations.length)
      const width = region.bbox[2] - region.bbox[0]
      for (const id of region.destinations) space.set(id, { width: share > 1 ? Math.min(width / share, 8) : width, alone: share === 1 })
    }
    return space
  }, [rooms])
  return destinations.map((place) => {
    const highlighted = place.id === highlightId
    const space = roomSpace.get(place.id) ?? { width: 6, alone: false }
    const width = Math.max(3, Math.min(space.width, 14))
    // Enlarge labels only where a place has a large room to itself.
    const roomScale = space.alone && width >= 8 ? scale : 1
    const fontSize = highlighted ? 1.5 * scale : Math.max(0.6, Math.min(1.05, width / 9)) * roomScale
    const colour = highlighted ? '#ffffff' : rooms?.colours?.[GROUP_BY_CATEGORY[place.category]] ?? '#DEE2E6'
    // The destination's name floats above its map pin.
    return <Billboard key={place.id} position={xz(highlighted ? place.entrance_xy || place.xy : place.xy, highlighted ? LABEL_HEIGHT + 9 : LABEL_HEIGHT)}>
      <Text font={LABEL_FONT} fontSize={fontSize} color={colour} outlineWidth={highlighted ? 0.12 : 0.07} outlineColor={highlighted ? BRAND : BACKGROUND}
        maxWidth={width} textAlign="center" anchorX="center" anchorY="middle"
        onClick={onPick ? (event) => { event.stopPropagation(); onPick(place) } : undefined}
        onPointerOver={onPick ? () => { document.body.style.cursor = 'pointer' } : undefined}
        onPointerOut={onPick ? () => { document.body.style.cursor = '' } : undefined}>
        {place.name}
      </Text>
    </Billboard>
  })
}

const BRIDGE_WIDTH_M = 3.08

/** Walkway deck between two buildings' doors (link.points[1] to link.points[2]). */
function BridgeDeck({ link }) {
  const [, [x1, y1], [x2, y2]] = link.points
  const length = Math.hypot(x2 - x1, y2 - y1)
  return <mesh position={[(x1 + x2) / 2, -0.05, -(y1 + y2) / 2]} rotation={[0, Math.atan2(y2 - y1, x2 - x1), 0]}>
    <boxGeometry args={[length, 0.1, BRIDGE_WIDTH_M]} />
    <meshStandardMaterial color="#BDBDBD" roughness={1} />
  </mesh>
}

function FloorModel({ floor, wallHeight, showLabels, highlightId, onPick, labelScale }) {
  const { walls, rooms, graph } = floor
  // Floor name at the north-west corner, where it stays in view.
  const tag = rooms ? [rooms.texture.origin_xy[0] + 2, rooms.texture.origin_xy[1] + rooms.texture.height_m + 2] : [-60, 40]
  return <group>
    {rooms && <Suspense fallback={null}><RoomFloor rooms={rooms} base={floor.base ?? '/data/MGeorge_nav'} /></Suspense>}
    <WallMeshes segments={walls.segments.wall} color={WALL_COLOUR} height={wallHeight} thickness={0.14} />
    <WallMeshes segments={walls.segments.window} color={WINDOW_COLOUR} height={wallHeight} thickness={0.08} opacity={0.55} />
    <WallMeshes segments={walls.segments.stair} color={STAIR_COLOUR} height={0.3} thickness={0.06} />
    <Suspense fallback={null}>
      <Billboard position={xz(tag, 1.5)}>
        <Text font={LABEL_FONT} fontSize={2.2} color="#ffffff" outlineWidth={0.1} outlineColor={BACKGROUND} anchorX="left" anchorY="middle">{floor.name.toUpperCase()}</Text>
      </Billboard>
      {showLabels && <RoomLabels destinations={graph.destinations} rooms={rooms} highlightId={highlightId} onPick={onPick} scale={labelScale} />}
    </Suspense>
  </group>
}

// Always drawn on top so walls never hide the user's position or direction.
const onTop = { depthTest: false, depthWrite: false, transparent: true }

const PERSON_SCALE = 3.2 // about twice life size so the walker reads at whole-route zoom
const STRIDE_M = 1.4 // one full walk cycle, in scene metres
const SKIN = '#c68863'
const TROUSERS = '#1f2937'

function Limb({ limbRef, at, length, radius, color, order }) {
  // Pivot at the joint (hip or shoulder); the limb hangs down from it.
  return <group ref={limbRef} position={at}>
    <mesh position={[0, -length / 2, 0]} renderOrder={order}>
      <capsuleGeometry args={[radius, length - 2 * radius, 4, 10]} />
      <meshStandardMaterial color={color} roughness={0.7} {...onTop} />
    </mesh>
  </group>
}

/** Simple walking figure, facing -Z; `limbRef(name)` hands each limb group to the owner. */
function WalkingPerson({ personRef, limbRef }) {
  return <group ref={personRef}>
    <group scale={PERSON_SCALE}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={20}>
        <circleGeometry args={[0.45, 32]} />
        <meshBasicMaterial color="#000000" {...onTop} opacity={0.35} />
      </mesh>
      <Limb limbRef={limbRef("leftLeg")} at={[-0.11, 0.9, 0]} length={0.86} radius={0.075} color={TROUSERS} order={21} />
      <Limb limbRef={limbRef("rightLeg")} at={[0.11, 0.9, 0]} length={0.86} radius={0.075} color={TROUSERS} order={21} />
      <mesh position={[0, 1.22, 0]} renderOrder={22}>
        <capsuleGeometry args={[0.17, 0.42, 4, 12]} />
        <meshStandardMaterial color={NAV_BLUE} roughness={0.6} {...onTop} />
      </mesh>
      <Limb limbRef={limbRef("leftArm")} at={[-0.26, 1.48, 0]} length={0.66} radius={0.06} color={NAV_BLUE_EDGE} order={23} />
      <Limb limbRef={limbRef("rightArm")} at={[0.26, 1.48, 0]} length={0.66} radius={0.06} color={NAV_BLUE_EDGE} order={23} />
      <mesh position={[0, 1.72, 0]} renderOrder={24}>
        <sphereGeometry args={[0.14, 20, 20]} />
        <meshStandardMaterial color={SKIN} roughness={0.8} {...onTop} />
      </mesh>
    </group>
  </group>
}

/** Route through the stacked floors with a person walking it; `points` are 3D scene points. */
function WalkingRoute({ points }) {
  const walkedRef = useRef()
  const personRef = useRef()
  const limbs = useRef({})
  const limbRef = useCallback((name) => (node) => { limbs.current[name] = node }, [])
  const heading = useRef(0)
  const cumulative = useMemo(() => cumulativeLengths(points), [points])
  // Three copies stacked a few cm apart so the layers never z-fight.
  const { edge, main, walked } = useMemo(() => {
    const raised = (lift) => points.map(([x, y, z]) => [x, y + lift, z])
    return { edge: raised(0), main: raised(0.02), walked: raised(0.04) }
  }, [points])
  useFrame(({ clock }) => {
    const progress = routeProgress(points, cumulative, clock.getElapsedTime())
    // The grey line is one dash as long as the distance walked, then a gap.
    const material = walkedRef.current?.material
    if (material) {
      material.dashSize = Math.max(progress.travelled, 0.001)
      material.gapSize = progress.total + 1
    }
    if (!personRef.current) return
    const [dx, dy, dz] = progress.delta
    const horizontal = Math.hypot(dx, dz)
    // Riding a lift is straight up: keep facing the way we were walking.
    if (horizontal > 0.05) heading.current = Math.atan2(-dx, -dz)
    personRef.current.position.set(progress.point[0], progress.point[1], progress.point[2])
    personRef.current.rotation.y = heading.current
    // Swing arms and legs while walking (not in a lift, not once arrived).
    const walking = progress.travelled < progress.total && horizontal > Math.abs(dy) * 0.2
    const swing = walking ? Math.sin((progress.travelled / STRIDE_M) * 2 * Math.PI) * 0.6 : 0
    const { leftLeg, rightLeg, leftArm, rightArm } = limbs.current
    if (leftLeg && rightLeg && leftArm && rightArm) {
      leftLeg.rotation.x = swing
      rightLeg.rotation.x = -swing
      leftArm.rotation.x = -swing * 0.8
      rightArm.rotation.x = swing * 0.8
    }
  })
  return <>
    {/* Drawn over everything so floors above never hide the way. */}
    <Line points={edge} color={NAV_BLUE_EDGE} lineWidth={14} depthTest={false} transparent renderOrder={10} />
    <Line points={main} color={NAV_BLUE} lineWidth={8} depthTest={false} transparent renderOrder={11} />
    <Line ref={walkedRef} points={walked} color={NAV_WALKED} lineWidth={8} dashed dashSize={0.001} gapSize={1e6} depthTest={false} transparent renderOrder={12} />
    <WalkingPerson personRef={personRef} limbRef={limbRef} />
  </>
}

/** Campus paths as a texture: walkable cells light grey on a green ground. */
function SiteGround({ site, onPick, labelSize = 2.4 }) {
  const mask = site.mask
  const texture = useMemo(() => {
    const data = new Uint8Array(mask.rows * mask.cols * 4)
    for (let i = 0; i < mask.rows * mask.cols; i += 1) {
      const on = (mask.bytes[i >> 3] >> (7 - (i & 7))) & 1
      data.set(on ? [205, 211, 220, 255] : [0, 0, 0, 0], i * 4)
    }
    const tex = new THREE.DataTexture(data, mask.cols, mask.rows, THREE.RGBAFormat)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.magFilter = THREE.LinearFilter
    tex.needsUpdate = true
    return tex
  }, [mask])
  const width = mask.cols * mask.cell_m
  const depth = mask.rows * mask.cell_m
  const centre = [mask.origin_xy[0] + width / 2, mask.origin_xy[1] + depth / 2]
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={xz(centre, -0.08)}>
      <planeGeometry args={[width + 40, depth + 40]} />
      <meshStandardMaterial color="#2f4a36" roughness={1} />
    </mesh>
    {/* DataTexture rows run south to north, matching the plane's +Y = north. */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={xz(centre, -0.04)}>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial map={texture} transparent alphaTest={0.5} roughness={1} />
    </mesh>
    <Suspense fallback={null}>
      {site.graph.destinations.map((place) => <group key={place.id}>
        <mesh position={xz(place.xy, 1.5)}><cylinderGeometry args={[0.8, 0.8, 3, 16]} /><meshStandardMaterial color="#F6D878" /></mesh>
        <Billboard position={xz(place.xy, 4 + labelSize * 1.5)}>
          <Text font={LABEL_FONT} fontSize={labelSize} color="#ffffff" outlineWidth={labelSize * 0.06} outlineColor={BACKGROUND} maxWidth={labelSize * 12} textAlign="center" anchorX="center" anchorY="middle"
            onClick={onPick ? (event) => { event.stopPropagation(); onPick({ ...place, floor: 'site', floorName: 'Outside (campus)' }) } : undefined}>
            {/* Short form on the map: "Basketball Court", not the full arena name. */}
            {place.name.replace(/\s*\(.*\)$/, '')}
          </Text>
        </Billboard>
      </group>)}
    </Suspense>
  </group>
}

function LocationDot({ position }) {
  const haloRef = useRef()
  useFrame(({ clock }) => {
    if (!haloRef.current) return
    const phase = (clock.getElapsedTime() % 2) / 2
    haloRef.current.scale.setScalar(1 + phase * 1.6)
    haloRef.current.material.opacity = 0.35 * (1 - phase)
  })
  return <group position={position} rotation={[-Math.PI / 2, 0, 0]} scale={1.5}>
    <mesh ref={haloRef} renderOrder={17}><circleGeometry args={[1.2, 40]} /><meshBasicMaterial color={NAV_BLUE} {...onTop} opacity={0.35} /></mesh>
    <mesh renderOrder={18}><circleGeometry args={[0.95, 40]} /><meshBasicMaterial color="#ffffff" {...onTop} /></mesh>
    <mesh renderOrder={19}><circleGeometry args={[0.72, 40]} /><meshBasicMaterial color={NAV_BLUE} {...onTop} /></mesh>
  </group>
}

export function MapPinIcon({ size = 44 }) {
  return <svg width={size} height={size * 1.36} viewBox="0 0 44 60" aria-hidden="true" style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.45))' }}>
    <path d="M22 59C22 59 3 34.5 3 21.5a19 19 0 0 1 38 0C41 34.5 22 59 22 59Z" fill="#EA4335" stroke="#B31412" strokeWidth="2" />
    <circle cx="22" cy="21.5" r="7.5" fill="#B31412" />
  </svg>
}

// The framing below is tuned for a landscape view about this wide.
const DESIGN_ASPECT = 1.6

/**
 * On narrower screens (phones in portrait) move the camera back along its
 * view line so the whole width of the framed area still fits. Runs once on
 * mount so it never fights the visitor's own zooming.
 */
function FitToScreen({ centre, width, depth }) {
  const { camera, size } = useThree()
  useEffect(() => {
    const aspect = size.width / size.height
    if (aspect >= DESIGN_ASPECT) return
    const designed = Math.max(width, depth * DESIGN_ASPECT)
    const factor = Math.min(3, Math.max(width * DESIGN_ASPECT / aspect, depth * DESIGN_ASPECT) / designed)
    const target = new THREE.Vector3(...centre)
    camera.position.sub(target).multiplyScalar(factor).add(target)
    camera.updateProjectionMatrix()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

/**
 * 3D model of the M. George Block. Shows `floors` (floor numbers) stacked;
 * room labels on `labelFloors`. Pass `route` and `destination` to draw a
 * kiosk route through the floors, `onPick` to make labels tappable, and
 * `focus` ({ minX, maxX, minY, maxY } in metres) to frame the camera.
 */
export default function MGeorgeBuilding3D({ model, floors, labelFloors = floors, route = null, destination = null, onPick = null, focus = null, showSite = false }) {
  // Floors of both buildings, stacked by storey: M. George's Second Floor and
  // Ramanujan's ('R2') share a level, so the bridge between them is flat.
  const siteLevel = model.site?.level_floor ?? model.kiosk.floor
  const storey = (floor) => (floor === 'site' ? siteLevel : levelOfFloor(floor))
  const shown = useMemo(() => [...floors].sort((a, b) => levelOfFloor(a) - levelOfFloor(b)), [floors])
  const levels = useMemo(() => [...new Set(shown.map(levelOfFloor))], [shown])
  const levelY = (floor) => Math.max(0, levels.indexOf(storey(floor))) * FLOOR_GAP
  const { kiosk } = model
  const area = focus || (() => {
    const textures = shown.map((n) => model.byFloor.get(n).rooms?.texture).filter(Boolean)
    if (!textures.length) return { minX: -60, maxX: 70, minY: -20, maxY: 40 }
    return {
      minX: Math.min(...textures.map((t) => t.origin_xy[0])), maxX: Math.max(...textures.map((t) => t.origin_xy[0] + t.width_m)),
      minY: Math.min(...textures.map((t) => t.origin_xy[1])), maxY: Math.max(...textures.map((t) => t.origin_xy[1] + t.height_m)),
    }
  })()
  const height = (levels.length - 1) * FLOOR_GAP
  const centre = [(area.minX + area.maxX) / 2, height / 2, -(area.minY + area.maxY) / 2]
  const span = Math.max(area.maxX - area.minX, (area.maxY - area.minY) * 1.6) + height * 0.8
  const wallHeight = route ? ROUTE_WALL_HEIGHT : WALL_HEIGHT
  const routePoints = useMemo(() => route
    ? route.legs.flatMap((leg) => leg.points.map(([x, y]) => [x, Math.max(0, levels.indexOf(leg.floor === 'site' ? siteLevel : levelOfFloor(leg.floor))) * FLOOR_GAP + 0.2, -y]))
    : null, [route, levels, siteLevel])
  const pin = destination ? destination.entrance_xy || destination.xy : null
  // Whole building: an angled overview like the Ramanujan viewer. Route: straight on, centred.
  // The campus overview looks down more steeply so the paths fill the view.
  // A plan much deeper than wide (Ramanujan Block runs north-south) is viewed from the east instead.
  const deep = !route && !showSite && area.maxY - area.minY > (area.maxX - area.minX) * 1.3
  const camera = route
    ? [centre[0], centre[1] + span * 0.62, centre[2] + span * 0.72]
    : showSite
      ? [centre[0], centre[1] + span * 0.5, centre[2] + span * 0.3]
      : deep
        ? [centre[0] + span * 0.42, centre[1] + span * 0.42, centre[2]]
        : [centre[0], centre[1] + span * 0.42, centre[2] + span * 0.55]

  return <Canvas camera={{ position: camera, fov: 50 }} gl={{ antialias: true }}>
    <color attach="background" args={[BACKGROUND]} />
    <ambientLight intensity={0.9} />
    <directionalLight position={[centre[0] + 20, 80, centre[2] + 30]} intensity={1.25} />
    {!showSite && <gridHelper args={[180, 90, '#3b3b44', '#2c2c33']} position={[centre[0], -0.3, centre[2]]} />}
    {showSite && model.site && <group position={[0, levelY(siteLevel), 0]}><SiteGround site={model.site} onPick={onPick} labelSize={route ? 2.4 : 6} /></group>}

    {shown.map((number) => <group key={number} position={[0, levelY(number), 0]}>
      <FloorModel floor={model.byFloor.get(number)} wallHeight={wallHeight} showLabels={labelFloors.includes(number)}
        highlightId={destination?.floor === number ? destination.id : null} onPick={onPick} labelScale={route ? 1 : 1.6} />
    </group>)}

    {(model.bridges ?? []).filter((link) => shown.includes(link.from_floor) && shown.includes(link.to_floor)).map((link) =>
      <group key={link.from} position={[0, levelY(link.from_floor), 0]}><BridgeDeck link={link} /></group>)}

    {shown.includes(kiosk.floor) && <>
      <LocationDot position={xz(kiosk.xy, levelY(kiosk.floor) + 0.4)} />
      <Html position={xz(kiosk.xy, levelY(kiosk.floor) + 0.4)} center zIndexRange={[20, 0]}>
        <div className="mt-12 whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm font-bold text-[#1A57B8] shadow-md">You are here</div>
      </Html>
    </>}

    {routePoints && routePoints.length > 1 && <WalkingRoute points={routePoints} />}
    {pin && (shown.includes(destination.floor) || destination.floor === 'site') && <Html position={xz(pin, levelY(destination.floor) + 0.3)} center zIndexRange={[30, 0]}>
      {/* Lift the pin so its tip, not its middle, sits on the destination. */}
      <div style={{ transform: 'translateY(-50%)' }}><MapPinIcon /></div>
    </Html>}

    <FitToScreen centre={centre} width={area.maxX - area.minX + height * 0.8} depth={area.maxY - area.minY} />
    <OrbitControls makeDefault target={centre} enableDamping maxPolarAngle={Math.PI / 2.1} minDistance={8} maxDistance={showSite ? 700 : 260} />
  </Canvas>
}
