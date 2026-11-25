import { useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { treeGeometries } from '../navigation/campusTrees'

// The splash screen's little world, filling the whole screen: Navi, NAVIKA's
// guide, a red cartoon baby elephant (after Kerala's temple elephants, with a
// golden forehead ornament and a cream-and-gold kasavu cloth), walks along a
// long strip of campus (coconut palms, a block in the college colours, a
// bouncing map pin) under a red silk ribbon with a gold border, while
// marigold and jasmine petals drift down. Cartoon look: flat "toon" shading
// and black outlines, like the app's bold borders. Built from simple shapes,
// animated every frame, and it answers the visitor: Navi wanders, stops to
// wave, and walks over to a moving finger; the petals blow the way it moves
// and the ribbon sways towards it; a tap on Navi gets a hop, a happy squint, a
// trunk wave and a burst of petals.

const C = {
  skin: '#E8474F', skinShade: '#C93139', ear: '#FFC4CB', cheek: '#FF8FA3', tuft: '#9E1F27',
  red: '#D8151C', gold: '#FFB703', goldDeep: '#FB8500', ink: '#160F0F', cream: '#FFF6E8',
  grass: '#7FB069', grassDark: '#5E8F4E', soil: '#A86B45', path: '#F3E3C8', wall: '#E2BE96', band: '#9E4A4C', glass: '#8FB2CC',
}
const VERTICAL_FOV = 34
const VIEW_HALF_WIDTH = 9 // world units the camera tries to show either side of the middle
const LANE_Z = 1.1 // where Navi walks, along the front of the strip
const STAGE_DEPTH = 6
const TRUNK_SEGMENTS = 6
const WAVE_S = 1.4
const HAPPY_S = 1.3
const WALK_SPEED = 2.1

/** 0 -> 1 with a little overshoot: a springy pop-in. */
const springIn = (t) => (t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(9 * t))

/** Camera distance and the visible half-width (at the middle) for a screen shape. */
function fitView(aspect) {
  const tanV = Math.tan(THREE.MathUtils.degToRad(VERTICAL_FOV / 2))
  const tanH = tanV * aspect
  const distance = THREE.MathUtils.clamp(VIEW_HALF_WIDTH / tanH, 12, 30)
  return { distance, halfWidth: distance * tanH }
}

/** Three flat tones for the cartoon shading. */
function useToonSteps() {
  return useMemo(() => {
    const texture = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat)
    texture.minFilter = THREE.NearestFilter
    texture.magFilter = THREE.NearestFilter
    texture.needsUpdate = true
    return texture
  }, [])
}

/**
 * What the visitor is doing, shared by everything in the scene: the finger's
 * sideways speed (`wind`), how fast it moves (`speed`), when it last moved
 * (`movedAt`), where it is across the stage (`fingerX`), when Navi was last
 * tapped (`poke`; -1 while a tap waits for the next frame), and where the
 * trunk tip is (`tip`, for the petal burst).
 */
function useVisitor() {
  return useRef({ wind: 0, speed: 0, last: null, movedAt: -10, fingerX: 0, halfWidth: VIEW_HALF_WIDTH, poke: 0, tip: new THREE.Vector3(0, 1, 2) })
}

/** Follows the pointer each frame and keeps the camera fitted to the screen, drifting gently. */
function Director({ visitorRef, reduced }) {
  const size = useThree((state) => state.size)
  useFrame(({ pointer, clock, camera }, delta) => {
    const v = visitorRef.current
    const t = clock.getElapsedTime()
    if (v.poke === -1) v.poke = t
    if (v.last) {
      const dx = (pointer.x - v.last[0]) / Math.max(delta, 1e-3)
      const dy = (pointer.y - v.last[1]) / Math.max(delta, 1e-3)
      v.wind += (THREE.MathUtils.clamp(dx, -6, 6) - v.wind) * 0.08
      v.speed += (Math.min(8, Math.hypot(dx, dy)) - v.speed) * 0.1
      if (Math.hypot(dx, dy) > 0.4) v.movedAt = t
    }
    v.last = [pointer.x, pointer.y]
    v.wind *= 0.97
    const { distance, halfWidth } = fitView(size.width / Math.max(1, size.height))
    v.halfWidth = halfWidth
    v.fingerX = pointer.x * halfWidth
    const drift = Math.sin(t * 0.2) * (reduced ? 0.2 : 0.9) + pointer.x * 0.6
    camera.position.x += (drift - camera.position.x) * 0.05
    camera.position.y += (distance * 0.36 + pointer.y * 0.5 - camera.position.y) * 0.05
    camera.position.z += (distance - camera.position.z) * 0.08
    camera.lookAt(0, 1.3, 0)
  })
  return null
}

// Shapes shared by every part that uses them, made once.
const shapes = new Map()
function shape(kind, ...args) {
  const key = `${kind}:${args.join(',')}`
  if (!shapes.has(key)) shapes.set(key, new THREE[kind](...args))
  return shapes.get(key)
}

/**
 * A mesh with a cartoon outline: a slightly bigger black copy of it, seen
 * from the inside, so only a dark rim shows round the edge. `ink` is how much
 * bigger (0.05 = 5%).
 */
function Inked({ geometry, ink = 0.06, children, ...props }) {
  return <mesh geometry={geometry} {...props}>
    {children}
    <mesh geometry={geometry} scale={1 + ink}><meshBasicMaterial color={C.ink} side={THREE.BackSide} /></mesh>
  </mesh>
}

function Toon({ color, steps, ...props }) {
  return <meshToonMaterial color={color} gradientMap={steps} {...props} />
}

function Elephant({ visitorRef, steps, reduced }) {
  const root = useRef()
  const body = useRef()
  const head = useRef()
  const legs = useRef([])
  const ears = [useRef(), useRef()]
  const trunk = useRef([])
  const eyes = [useRef(), useRef()]
  const tail = useRef()
  const walk = useRef({ x: -30, target: -3, facing: Math.PI / 2, phase: 0, pauseUntil: 0, entered: false, waveUntil: 0, blinkNext: 2.2, blinkUntil: 0 })
  const keepSegment = useCallback((index, node) => { trunk.current[index] = node }, [])
  const keepLeg = useCallback((index, node) => { legs.current[index] = node }, [])

  useFrame(({ clock, pointer }, rawDelta) => {
    // Real time, so Navi walks at the same speed on a slow PC; only a long stall (a hidden tab) is capped.
    const delta = Math.min(rawDelta, 0.25)
    const t = clock.getElapsedTime()
    const v = visitorRef.current
    const w = walk.current
    const calm = reduced ? 0.3 : 1
    const lane = Math.max(3, v.halfWidth - 2.5) // how far either way Navi may walk
    if (!w.entered) {
      // Walk in from just off the left edge of the screen.
      w.x = -v.halfWidth - 2.5
      w.target = -lane * 0.25
      w.entered = true
    }
    const sincePoke = v.poke > 0 ? t - v.poke : Infinity
    const happy = sincePoke < HAPPY_S
    if (sincePoke < 0.05) {
      w.waveUntil = t + WAVE_S
      w.pauseUntil = t + 1.6
    }
    // A moving finger calls Navi over; otherwise Navi wanders and stops to wave now and then.
    const fingerActive = t - v.movedAt < 1.2 && t > 2
    if (fingerActive) w.target = THREE.MathUtils.clamp(v.fingerX, -lane, lane)
    const gap = w.target - w.x
    const walking = Math.abs(gap) > 0.2 && t > w.pauseUntil
    if (walking) {
      w.x += Math.sign(gap) * Math.min(Math.abs(gap), WALK_SPEED * delta * (reduced ? 0.6 : 1))
      w.phase += delta * WALK_SPEED * 3.2
    } else if (!fingerActive && t > w.pauseUntil) {
      // Arrived: a pause facing the visitor (with a wave every other time), then somewhere new.
      w.pauseUntil = t + 1.8 + ((t * 3.7) % 1.6)
      if (Math.floor(t) % 2 === 0) w.waveUntil = t + WAVE_S
      let next = ((Math.sin(t * 12.9898) * 43758.5453) % 1 + 1) % 1
      next = (next * 2 - 1) * lane
      w.target = Math.abs(next - w.x) < 2 ? -w.x * 0.8 : next
    }
    const facingGoal = walking ? (gap > 0 ? Math.PI / 2 : -Math.PI / 2) : 0
    w.facing += (facingGoal - w.facing) * Math.min(1, delta * 6)
    const stride = walking ? Math.sin(w.phase) : 0
    const hop = sincePoke < 0.6 ? Math.sin((sincePoke / 0.6) * Math.PI) * 0.6 : 0
    if (root.current) {
      root.current.position.set(w.x, Math.abs(stride) * 0.08 + hop + Math.sin(t * 2) * 0.03 * calm, LANE_Z)
      root.current.rotation.y = w.facing
    }
    if (body.current) body.current.rotation.z = stride * 0.05
    legs.current.forEach((leg, i) => {
      // Diagonal pairs step together.
      if (leg) leg.rotation.x += ((i === 0 || i === 3 ? stride : -stride) * 0.55 - leg.rotation.x) * 0.4
    })
    // The head looks at the finger when Navi stands facing the visitor.
    if (head.current) {
      const look = walking ? 0 : pointer.x * 0.4
      head.current.rotation.y += (look - head.current.rotation.y) * 0.08
      head.current.rotation.x += ((walking ? 0.05 : -pointer.y * 0.2) - head.current.rotation.x) * 0.08
      head.current.rotation.z = stride * 0.06
    }
    const flap = (walking ? 6 : 3) + Math.min(5, v.speed * 1.2)
    ears.forEach((ear, side) => {
      if (ear.current) ear.current.rotation.y = (side ? -1 : 1) * (0.3 + Math.sin(t * flap + side) * 0.25 * calm)
    })
    const wave = w.waveUntil > t ? Math.sin(((w.waveUntil - t) / WAVE_S) * Math.PI) : 0
    const reach = walking ? 0 : Math.max(0, pointer.y) * 0.15
    trunk.current.forEach((segment, i) => {
      if (!segment) return
      const swing = Math.sin(t * (walking ? 5 : 1.8) - i * 0.55) * (walking ? 0.16 : 0.1) * calm
      segment.rotation.x = (i < 2 ? 0.1 : -0.36) + swing - wave * (0.4 + i * 0.06) - reach
    })
    trunk.current.at(-1)?.getWorldPosition(v.tip)
    if (t > w.blinkNext) {
      w.blinkUntil = t + 0.14
      w.blinkNext = t + 2.4 + ((t * 7.31) % 3)
    }
    const open = happy ? 0.28 : t < w.blinkUntil ? 0.12 : 1
    eyes.forEach((eye) => { if (eye.current) eye.current.scale.y += (open - eye.current.scale.y) * 0.35 })
    if (tail.current) tail.current.rotation.z = Math.sin(t * (happy || walking ? 9 : 4)) * (happy ? 0.6 : 0.35) * calm
  })

  const skin = <Toon color={C.skin} steps={steps} />
  return <group ref={root} position={[-30, 0, LANE_Z]}>
    <group ref={body}>
      {/* a round little body */}
      <Inked geometry={shape('SphereGeometry', 0.8, 32, 24)} ink={0.05} position={[0, 0.98, 0]} scale={[0.95, 0.82, 1.05]} castShadow>{skin}</Inked>
      {/* cream kasavu cloth with a gold border */}
      <Inked geometry={shape('SphereGeometry', 0.58, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)} position={[0, 1.55, -0.05]} scale={[1, 0.35, 1.1]}><Toon color={C.cream} steps={steps} /></Inked>
      <mesh position={[0, 1.55, -0.05]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1.1, 1]}><torusGeometry args={[0.58, 0.05, 8, 32]} /><Toon color={C.gold} steps={steps} /></mesh>
      {/* stubby legs, swinging from the hip */}
      {[[-0.4, 0.42], [0.4, 0.42], [-0.4, -0.42], [0.4, -0.42]].map(([x, z], i) => <group key={i} ref={(node) => keepLeg(i, node)} position={[x, 0.62, z]}>
        <Inked geometry={shape('CylinderGeometry', 0.2, 0.22, 0.62, 18)} ink={0.12} position={[0, -0.32, 0]} castShadow>{skin}</Inked>
        {[-0.08, 0.08].map((nx) => <mesh key={nx} position={[nx, -0.58, 0.18]}><sphereGeometry args={[0.055, 10, 8]} /><Toon color={C.cream} steps={steps} /></mesh>)}
      </group>)}
      <group ref={tail} position={[0, 0.98, -0.85]}>
        <mesh position={[0, -0.18, -0.06]} rotation={[0.4, 0, 0]}><cylinderGeometry args={[0.035, 0.045, 0.4, 8]} />{skin}</mesh>
        <mesh position={[0, -0.38, -0.14]}><sphereGeometry args={[0.07, 10, 8]} /><Toon color={C.tuft} steps={steps} /></mesh>
      </group>
    </group>

    {/* a big round head: the chibi part */}
    <group ref={head} position={[0, 1.95, 0.6]}>
      <Inked geometry={shape('SphereGeometry', 0.85, 36, 28)} ink={0.045} castShadow>{skin}</Inked>
      {/* a little tuft of hair */}
      {[-0.12, 0, 0.12].map((x, i) => <mesh key={x} position={[x, 0.86, -0.05]} rotation={[0, 0, -x * 2.2]}>
        <coneGeometry args={[0.06, 0.24 + (i === 1 ? 0.06 : 0), 8]} /><Toon color={C.tuft} steps={steps} />
      </mesh>)}
      {/* ears, flapping from their front edge */}
      {[1, -1].map((side, i) => <group key={side} ref={ears[i]} position={[side * 0.62, 0.08, -0.1]}>
        <Inked geometry={shape('SphereGeometry', 0.62, 28, 18)} position={[side * 0.48, 0, -0.08]} scale={[1, 1, 0.2]}><Toon color={C.skinShade} steps={steps} /></Inked>
        <mesh position={[side * 0.48, 0, 0.05]} scale={[0.74, 0.74, 0.08]}><sphereGeometry args={[0.62, 28, 18]} /><Toon color={C.ear} steps={steps} /></mesh>
      </group>)}
      {/* huge shiny eyes and pink cheeks */}
      {[1, -1].map((side, i) => <group key={side} position={[side * 0.3, 0.12, 0.74]}>
        <group ref={eyes[i]}>
          <mesh scale={[1, 1.2, 0.7]}><sphereGeometry args={[0.17, 24, 16]} /><meshBasicMaterial color={C.ink} /></mesh>
          <mesh position={[side * 0.05, 0.08, 0.1]}><sphereGeometry args={[0.055, 12, 8]} /><meshBasicMaterial color="#ffffff" /></mesh>
          <mesh position={[-side * 0.04, -0.06, 0.11]}><sphereGeometry args={[0.025, 8, 6]} /><meshBasicMaterial color="#ffffff" /></mesh>
        </group>
        <mesh position={[side * 0.16, -0.26, -0.04]} scale={[1, 0.6, 0.4]}><sphereGeometry args={[0.13, 14, 10]} /><meshBasicMaterial color={C.cheek} /></mesh>
      </group>)}
      {/* golden forehead ornament with a red jewel */}
      <Inked geometry={shape('ConeGeometry', 0.24, 0.42, 5)} ink={0.1} position={[0, 0.45, 0.66]} rotation={[-0.6, 0, Math.PI]} scale={[1, 1, 0.35]}>
        <Toon color={C.gold} steps={steps} />
      </Inked>
      <mesh position={[0, 0.39, 0.79]}><sphereGeometry args={[0.07, 12, 10]} /><meshBasicMaterial color={C.red} /></mesh>
      {/* the trunk: a chain of tapering pieces, each turning a little more than the last */}
      <group position={[0, -0.25, 0.7]}>
        <TrunkChain onSegment={keepSegment} index={0} skin={skin} />
      </group>
    </group>
  </group>
}

function TrunkChain({ onSegment, index, skin }) {
  if (index >= TRUNK_SEGMENTS) return null
  const radius = 0.17 - index * 0.015
  const length = 0.19
  return <group ref={(node) => onSegment(index, node)}>
    <Inked geometry={shape('CylinderGeometry', radius - 0.015, radius, length + 0.03, 16)} ink={0.12} position={[0, -length / 2, 0]} castShadow>{skin}</Inked>
    <group position={[0, -length, 0]}>
      <TrunkChain onSegment={onSegment} index={index + 1} skin={skin} />
    </group>
  </group>
}

/** A long, rounded strip of campus right across the screen, with a path along the front. */
function Stage({ width, steps, reduced }) {
  const pin = useRef()
  const palm = useMemo(() => treeGeometries().palm, [])
  const platform = useMemo(() => {
    const r = STAGE_DEPTH / 2
    const half = width / 2 - r
    const shape = new THREE.Shape()
    shape.moveTo(-half, -r)
    shape.lineTo(half, -r)
    shape.absarc(half, 0, r, -Math.PI / 2, Math.PI / 2, false)
    shape.lineTo(-half, r)
    shape.absarc(-half, 0, r, Math.PI / 2, Math.PI * 1.5, false)
    return new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2, curveSegments: 24 })
  }, [width])
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    if (pin.current) {
      pin.current.position.y = 3.6 + Math.abs(Math.sin(t * 2.2)) * (reduced ? 0.05 : 0.35)
      pin.current.rotation.y = t * 1.2
    }
  })
  const buildingX = -width * 0.27
  const palms = [[-width * 0.42, -1.2, 0.32], [-width * 0.12, -1.9, 0.27], [width * 0.18, -1.6, 0.3], [width * 0.4, -1.1, 0.34], [width * 0.3, -2.2, 0.25]]
  return <group>
    {/* turned flat: the shape's plan y becomes depth (z) */}
    <mesh geometry={platform} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <Toon attach="material-0" color={C.grass} steps={steps} />
      <Toon attach="material-1" color={C.soil} steps={steps} />
    </mesh>
    {/* the path Navi walks */}
    <mesh position={[0, 0.13, LANE_Z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[width - STAGE_DEPTH * 0.6, 1.5]} /><Toon color={C.path} steps={steps} /></mesh>
    {/* a block in the college colours */}
    <group position={[buildingX, 0.12, -1.6]} rotation={[0, 0.35, 0]}>
      {[0, 1, 2].map((level) => <group key={level} position={[0, level * 0.66, 0]}>
        <mesh position={[0, 0.07, 0]}><boxGeometry args={[2, 0.14, 1.2]} /><Toon color={C.band} steps={steps} /></mesh>
        <Inked geometry={shape('BoxGeometry', 2, 0.52, 1.2)} ink={0.04} position={[0, 0.4, 0]} castShadow><Toon color={C.wall} steps={steps} /></Inked>
        <mesh position={[0, 0.4, 0.605]}><planeGeometry args={[1.8, 0.24]} /><Toon color={C.glass} steps={steps} /></mesh>
      </group>)}
      <Inked geometry={shape('BoxGeometry', 2.08, 0.12, 1.28)} ink={0.04} position={[0, 2.05, 0]}><Toon color={C.cream} steps={steps} /></Inked>
    </group>
    <group ref={pin} position={[buildingX, 3.6, -1.6]}>
      <Inked geometry={shape('SphereGeometry', 0.34, 24, 16)} ink={0.1}><Toon color={C.red} steps={steps} /></Inked>
      <mesh position={[0, -0.4, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.27, 0.55, 24]} /><Toon color={C.red} steps={steps} /></mesh>
      <mesh position={[0, 0, 0.26]}><sphereGeometry args={[0.12, 16, 12]} /><meshBasicMaterial color="#ffffff" /></mesh>
    </group>
    {palms.map(([x, z, s], i) => <group key={i} position={[x, 0.12, z]} scale={s} rotation={[0.05, i * 1.3, 0.04]}>
      <mesh geometry={palm.trunk} castShadow><Toon color="#8A7458" steps={steps} /></mesh>
      <mesh geometry={palm.crown} castShadow><Toon color={C.grassDark} steps={steps} side={THREE.DoubleSide} /></mesh>
    </group>)}
    {/* round bushes */}
    {[[-width * 0.36, 1.9], [-width * 0.05, -2.3], [width * 0.1, 2.1], [width * 0.34, 1.95]].map(([x, z], i) => <Inked key={i} geometry={shape('SphereGeometry', 0.45, 16, 12)} ink={0.08} position={[x, 0.42, z]} scale={[1, 0.8, 1]}>
      <Toon color={C.grassDark} steps={steps} />
    </Inked>)}
  </group>
}

const PETALS = 220
const PETAL_COLOURS = ['#FB8500', '#FFB703', '#FFC93C', '#FFF6E5', '#FFFDF8'] // marigold and jasmine
const BURST = 40

function makePetals(spread) {
  const random = (seed) => ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1
  return {
    petals: Array.from({ length: PETALS }, (_, i) => ({
      p: new THREE.Vector3((random(i + 1) - 0.5) * spread, random(i + 2) * 10, (random(i + 3) - 0.5) * 10),
      v: new THREE.Vector3(0, -0.6 - random(i + 4) * 0.5, 0),
      spin: new THREE.Vector3(random(i + 5) * 3, random(i + 6) * 3, random(i + 7) * 3),
      phase: random(i + 8) * Math.PI * 2,
      colour: PETAL_COLOURS[Math.floor(random(i + 9) * PETAL_COLOURS.length)],
    })),
    next: 0,
    lastPoke: 0,
    dummy: new THREE.Object3D(),
    coloured: false,
  }
}

/** Marigold and jasmine petals drifting across the whole screen, blown by the finger; a tap on Navi throws a burst. */
function Petals({ visitorRef, reduced }) {
  const meshRef = useRef()
  const fieldRef = useRef(null)
  const geometry = useMemo(() => new THREE.SphereGeometry(0.1, 8, 4).scale(1, 0.22, 0.6), [])

  useFrame(({ clock }, rawDelta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const v = visitorRef.current
    const spread = v.halfWidth * 2 + 4
    if (!fieldRef.current) fieldRef.current = makePetals(spread)
    const field = fieldRef.current
    if (!field.coloured) {
      const colour = new THREE.Color()
      field.petals.forEach((petal, i) => mesh.setColorAt(i, colour.set(petal.colour)))
      mesh.instanceColor.needsUpdate = true
      field.coloured = true
    }
    const delta = Math.min(rawDelta, 0.05)
    const t = clock.getElapsedTime()
    if (v.poke > 0 && v.poke !== field.lastPoke) {
      field.lastPoke = v.poke
      for (let k = 0; k < BURST; k += 1) {
        const petal = field.petals[(field.next + k) % PETALS]
        const angle = (k / BURST) * Math.PI * 2
        petal.p.copy(v.tip)
        petal.v.set(Math.cos(angle) * (1 + (k % 3) * 0.6), 3.5 + (k % 5) * 0.5, Math.sin(angle) * (1 + (k % 4) * 0.4) + 1)
      }
      field.next = (field.next + BURST) % PETALS
    }
    field.petals.forEach((petal, i) => {
      petal.v.y = Math.max(petal.v.y - 4 * delta, -0.7)
      petal.v.x += ((v.wind * 1.6 + Math.sin(t * 1.3 + petal.phase) * 0.35) - petal.v.x) * 2 * delta
      petal.v.z += ((Math.cos(t * 1.1 + petal.phase) * 0.25) - petal.v.z) * 1.5 * delta
      petal.p.addScaledVector(petal.v, delta * (reduced ? 0.4 : 1))
      if (petal.p.y < -2 || Math.abs(petal.p.x) > spread / 2 + 1) {
        petal.p.set((((i * 7.31) % 1000) / 1000 - 0.5) * spread, 9 + (i % 5) * 0.4, ((i * 3.17) % 10) - 5)
        petal.v.set(0, -0.6, 0)
      }
      field.dummy.position.copy(petal.p)
      field.dummy.rotation.set(t * petal.spin.x + petal.phase, t * petal.spin.y, t * petal.spin.z)
      field.dummy.updateMatrix()
      mesh.setMatrixAt(i, field.dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={meshRef} args={[geometry, undefined, PETALS]} frustumCulled={false}>
    <meshStandardMaterial roughness={0.7} side={THREE.DoubleSide} />
    {/* per-petal colours are filled in on the first frame */}
    <instancedBufferAttribute attach="instanceColor" args={[new Float32Array(PETALS * 3).fill(1), 3]} />
  </instancedMesh>
}

const RIBBON_WIDTH = 1.1

/** A red silk ribbon with a gold border, like a kasavu saree: sweeps in, then ripples right across the back. */
function SilkRibbon({ visitorRef, length, reduced }) {
  const meshRef = useRef()
  const flatRef = useRef(null)

  useFrame(({ clock, pointer }) => {
    const geometry = meshRef.current?.geometry
    if (!geometry) return
    const position = geometry.attributes.position
    if (!flatRef.current || flatRef.current.length !== position.array.length) {
      flatRef.current = Float32Array.from(position.array)
      const colours = []
      const red = new THREE.Color(C.red)
      const gold = new THREE.Color(C.gold)
      for (let i = 0; i < position.count; i += 1) {
        const colour = Math.abs(position.getY(i)) / (RIBBON_WIDTH / 2) > 0.72 ? gold : red
        colours.push(colour.r, colour.g, colour.b)
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
    }
    const flat = flatRef.current
    const t = clock.getElapsedTime()
    const calm = reduced ? 0.3 : 1
    const sweep = (1 - springIn(Math.min(1, t / 1.6))) * -length
    const pull = pointer.x * 0.8 + visitorRef.current.wind * 0.15
    for (let i = 0; i < position.count; i += 1) {
      const x = flat[i * 3] + sweep
      const y = flat[i * 3 + 1]
      const ripple = (Math.sin(x * 0.5 - t * 1.7) * 0.6 + Math.sin(x * 0.2 + t * 0.8) * 0.4) * calm
      const lift = Math.sin(x * 0.28 - t * 1.05) * 0.55 * calm + y * (1 + Math.sin(x * 0.4 + t) * 0.15)
      position.setXYZ(i, x, 5 + lift, -3.6 + ripple + pull * Math.cos(x * 0.15))
    }
    position.needsUpdate = true
    geometry.computeVertexNormals()
  })

  return <mesh ref={meshRef} frustumCulled={false}>
    <planeGeometry args={[length, RIBBON_WIDTH, Math.round(length * 8), 8]} />
    <meshPhysicalMaterial vertexColors side={THREE.DoubleSide} roughness={0.45} sheen={1} sheenColor="#FFD28A" sheenRoughness={0.35} />
  </mesh>
}

/** The scene, sized to the screen: a wider screen gets a longer strip of campus. */
function World({ reduced }) {
  const visitorRef = useVisitor()
  const steps = useToonSteps()
  const size = useThree((state) => state.size)
  const { halfWidth } = fitView(size.width / Math.max(1, size.height))
  const width = THREE.MathUtils.clamp(halfWidth * 2 - 1.5, 11, 40)
  return <>
    <Director visitorRef={visitorRef} reduced={reduced} />
    <SilkRibbon visitorRef={visitorRef} length={width + 10} reduced={reduced} />
    <Petals visitorRef={visitorRef} reduced={reduced} />
    <Stage width={width} steps={steps} reduced={reduced} />
    <group onPointerDown={(event) => {
      event.stopPropagation()
      visitorRef.current.poke = -1 // set to the scene time on the next frame
    }}>
      <Elephant visitorRef={visitorRef} steps={steps} reduced={reduced} />
    </group>
    <ContactShadows position={[0, 0.14, 0]} opacity={0.3} scale={[width + 4, STAGE_DEPTH + 2]} blur={2.2} far={3} />
  </>
}

/** The splash scene, filling its container (the whole screen). */
export default function SplashScene() {
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])
  return <Canvas shadows camera={{ position: [0, 6, 18], fov: VERTICAL_FOV }} gl={{ antialias: true, alpha: true }} dpr={[1, 2]}>
    <hemisphereLight args={['#FFF4E0', '#7FB069', 1.1]} />
    <directionalLight position={[5, 10, 7]} intensity={1.8} color="#FFF1DA" castShadow shadow-mapSize={[1024, 1024]} />
    <World reduced={reduced} />
  </Canvas>
}
