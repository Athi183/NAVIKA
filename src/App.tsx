import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";

type Wall = {
  id: string;
  type: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type WallData = {
  floor: string;
  walls: Wall[];
};
type SemanticPlace = {
  id: string;
  name: string;
  type: string;
  cadX: number;
  cadY: number;
  roomNumber?: string;
};

type SemanticData = {
  floor: string;
  coordinate_system: string;
  places: SemanticPlace[];
};

function SemanticLabels({
  data,
  minX,
  minY,
}: {
  data: SemanticData;
  minX: number;
  minY: number;
}) {
  return (
    <>
      {data.places.map((place) => (
        <Text
          key={place.id}
          position={[
            place.cadX - minX,
            3.1,
            -(place.cadY - minY),
          ]}
          fontSize={0.65}
          color="#ffe082"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.035}
          outlineColor="#202025"
          maxWidth={8}
          textAlign="center"
        >
          {place.name}
        </Text>
      ))}
    </>
  );
}
function WallSegment({
  wall,
  minX,
  minY,
}: {
  wall: Wall;
  minX: number;
  minY: number;
}) {
  // Convert CAD coordinates into local coordinates.
  const x1 = wall.x1 - minX;
  const z1 = -(wall.y1 - minY);

  const x2 = wall.x2 - minX;
  const z2 = -(wall.y2 - minY);

  // Wall length
  const length = Math.sqrt(
    (x2 - x1) ** 2 +
    (z2 - z1) ** 2
  );

  // Position at the midpoint of the wall
  const centerX = (x1 + x2) / 2;
  const centerZ = (z1 + z2) / 2;

  // Rotation of the wall in the X-Z plane
  const angle = Math.atan2(z2 - z1, x2 - x1);

  // Wall dimensions
  const thickness = 0.24;
  const height = 2.8;

  return (
    <mesh
      position={[centerX, height / 2, centerZ]}
      rotation={[0, -angle, 0]}
    >
      <boxGeometry args={[length, height, thickness]} />
      <meshStandardMaterial color="#d9d9d9" />
    </mesh>
  );
}

function FloorWalls({ data }: { data: WallData }) {
  const minX = Math.min(
    ...data.walls.flatMap((wall) => [wall.x1, wall.x2])
  );

  const minY = Math.min(
    ...data.walls.flatMap((wall) => [wall.y1, wall.y2])
  );

  return (
    <>
      {data.walls.map((wall) => (
        <WallSegment
          key={wall.id}
          wall={wall}
          minX={minX}
          minY={minY}
        />
      ))}
    </>
  );
}

function FloorSlab({ data }: { data: WallData }) {
  const minX = Math.min(
    ...data.walls.flatMap((wall) => [wall.x1, wall.x2])
  );

  const maxX = Math.max(
    ...data.walls.flatMap((wall) => [wall.x1, wall.x2])
  );

  const minY = Math.min(
    ...data.walls.flatMap((wall) => [wall.y1, wall.y2])
  );

  const maxY = Math.max(
    ...data.walls.flatMap((wall) => [wall.y1, wall.y2])
  );

  const width = maxX - minX;
  const depth = maxY - minY;

  const centerX = width / 2;
  const centerZ = -depth / 2;

  return (
    <mesh position={[centerX, -0.08, centerZ]}>
      <boxGeometry args={[width, 0.16, depth]} />
      <meshStandardMaterial color="#b8b8b8" />
    </mesh>
  );
}

function App() {
  const [data, setData] = useState<WallData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [semantics, setSemantics] = useState<SemanticData | null>(null);
  useEffect(() => {
  Promise.all([
    fetch("/data/Ramanjuan_F6/walls.json").then((response) => {
      if (!response.ok) throw new Error("Could not load sixth-floor walls");
      return response.json() as Promise<WallData>;
    }),
    fetch("/data/Ramanjuan_F6/semantics.json").then((response) => {
      if (!response.ok) throw new Error("Could not load sixth-floor semantics");
      return response.json() as Promise<SemanticData>;
    }),
  ])
    .then(([wallData, semanticData]) => {
      setData(wallData);
      setSemantics(semanticData);
    })
    .catch((err: Error) => setError(err.message));
}, []);

  if (error) {
    return <div>{error}</div>;
  }

  if (!data || !semantics) {
  return <div>Loading sixth-floor model...</div>;
}

  // Calculate CAD bounds
  const minX = Math.min(
    ...data.walls.flatMap((wall) => [wall.x1, wall.x2])
  );

  const maxX = Math.max(
    ...data.walls.flatMap((wall) => [wall.x1, wall.x2])
  );

  const minY = Math.min(
    ...data.walls.flatMap((wall) => [wall.y1, wall.y2])
  );

  const maxY = Math.max(
    ...data.walls.flatMap((wall) => [wall.y1, wall.y2])
  );

  const width = maxX - minX;
  const depth = maxY - minY;

  // Orbit reference point
  // +10 shifts the reference point slightly to the right
  const centerX = width / 2 + 10;
  const centerZ = -depth / 2;

  return (
    <Canvas
      camera={{
        position: [centerX + 45, 35, centerZ + 45],
        fov: 50,
      }}
    >
      <color attach="background" args={["#202025"]} />

      <ambientLight intensity={1.5} />

      <directionalLight
        position={[20, 40, 20]}
        intensity={2}
      />

      <FloorSlab data={data} />

      <FloorWalls data={data} />
      <SemanticLabels
        data={semantics}
        minX={minX}
        minY={minY}
      />
      <gridHelper
        args={[100, 100]}
        position={[centerX, 0, centerZ]}
      />

      <OrbitControls
        target={[centerX, 0, centerZ]}
      />
    </Canvas>
  );
}

export default App;
