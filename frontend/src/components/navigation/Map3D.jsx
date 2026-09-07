import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'

function FloorGrid() {
  const cells = []

  for (let i = 0; i <= 10; i += 1) {
    const position = -5 + i
    cells.push(
      <mesh key={`x-${i}`} position={[position, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.15, 10]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>,
    )
    cells.push(
      <mesh key={`z-${i}`} position={[0, 0, position]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[10, 0.15]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>,
    )
  }

  return <>{cells}</>
}

function RouteMarkers({ route, source, destination }) {
  const routePoints = route?.path || []

  return (
    <group>
      <mesh position={[-4.2, 0.3, 3.2]}>
        <sphereGeometry args={[0.22, 32, 32]} />
        <meshStandardMaterial color="#34d399" emissive="#10b981" emissiveIntensity={0.4} />
      </mesh>

      <mesh position={[4.2, 0.3, -2.8]}>
        <sphereGeometry args={[0.22, 32, 32]} />
        <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={0.5} />
      </mesh>

      {routePoints.map((point, index) => (
        <mesh key={`${point.id || index}-route`} position={[((point.x || 0) / 90) - 4.5, 0.15, ((point.y || 0) / 90) - 2.8]}>
          <sphereGeometry args={[0.08, 18, 18]} />
          <meshStandardMaterial color="#86efac" emissive="#86efac" emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  )
}

function RouteLine({ route }) {
  const points = route?.path || []

  if (!points.length) return null

  const linePoints = points.map((point) => [((point.x || 0) / 90) - 4.5, 0.2, ((point.y || 0) / 90) - 2.8])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, 0]}>
        <tubeGeometry args={[null, 40, 0.04, 8, false]} />
        <meshStandardMaterial color="#34d399" emissive="#34d399" emissiveIntensity={0.6} />
      </mesh>
      {linePoints.map(([x, y, z], index) => (
        <mesh key={`route-node-${index}`} position={[x, y, z]}>
          <sphereGeometry args={[0.08, 18, 18]} />
          <meshStandardMaterial color="#34d399" emissive="#34d399" emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  )
}

export default function Map3D({ route, source, destination }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-950/80 shadow-2xl">
      <div className="h-[360px] w-full">
        <Canvas>
          <color attach="background" args={['#020817']} />
          <PerspectiveCamera makeDefault position={[0, 6, 8]} fov={46} />
          <ambientLight intensity={1.1} />
          <directionalLight position={[5, 7, 5]} intensity={1.3} color="#e2e8f0" />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
            <planeGeometry args={[12, 10]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
          <FloorGrid />
          <mesh position={[0, 0.22, 0]}>
            <boxGeometry args={[9, 0.08, 7]} />
            <meshStandardMaterial color="#18212f" />
          </mesh>
          <RouteMarkers route={route} source={source} destination={destination} />
          <RouteLine route={route} />
          <OrbitControls enablePan enableZoom enableRotate />
        </Canvas>
      </div>
    </div>
  )
}
