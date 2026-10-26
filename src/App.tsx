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

const FLOOR4_LABEL_LAYOUTS: Record<
  string,
  { roomWidth: number; roomHeight: number; maxWidth: number }
> = {
  room_501: { roomWidth: 17, roomHeight: 10.8, maxWidth: 16.2 },
  room_502: { roomWidth: 10.5, roomHeight: 10.8, maxWidth: 9.8 },
  room_503: { roomWidth: 6, roomHeight: 10.8, maxWidth: 5.2 },
  room_504: { roomWidth: 10.5, roomHeight: 11.7, maxWidth: 9.6 },
  room_505: { roomWidth: 8.2, roomHeight: 11.7, maxWidth: 7.4 },
  room_506: { roomWidth: 10.6, roomHeight: 11.8, maxWidth: 9.7 },
  room_507: { roomWidth: 10.6, roomHeight: 11.8, maxWidth: 9.6 },
  room_508: { roomWidth: 11, roomHeight: 10.9, maxWidth: 10 },
  room_509: { roomWidth: 6.5, roomHeight: 10.9, maxWidth: 5.8 },
  room_510: { roomWidth: 9, roomHeight: 10.8, maxWidth: 8.2 },
  room_511: { roomWidth: 3, roomHeight: 10.8, maxWidth: 2.5 },
  room_512: { roomWidth: 10.5, roomHeight: 10.8, maxWidth: 10 },
  ladies_toilet: { roomWidth: 3, roomHeight: 5.5, maxWidth: 2.7 },
  gents_toilet: { roomWidth: 4.8, roomHeight: 6, maxWidth: 4.2 },
  electrical_room: { roomWidth: 10, roomHeight: 2.5, maxWidth: 8.5 },
  lift_west: { roomWidth: 3.5, roomHeight: 4.2, maxWidth: 3 },
  engine_room: { roomWidth: 3.5, roomHeight: 4.2, maxWidth: 3 },
  lift_east: { roomWidth: 4.8, roomHeight: 4.5, maxWidth: 4 },
  staircase_west: { roomWidth: 3, roomHeight: 8, maxWidth: 2.7 },
  staircase_central: { roomWidth: 9, roomHeight: 5, maxWidth: 4 },
  staircase_east: { roomWidth: 5, roomHeight: 7.5, maxWidth: 4 },
};

const FLOOR4_DISPLAY_NAMES: Record<string, string> = {
  room_502: "S3/S4 CSE-A(AI)\nClass Room",
  room_504: "Div. of CSE & AIDS\nDepartment",
  room_505: "Elective/Tutorial\nRoom/IDP Room",
  room_506: "S5/S6 AI&DS\nClass Room",
  room_508: "S7/S8 AI&DS\nClass Room",
  room_511: "AIDS Dept.\nLibrary",
  room_512: "S3/S4 AI&DS\nClass Room",
};

const FLOOR5_LABEL_LAYOUTS: Record<
  string,
  { roomWidth: number; roomHeight: number; maxWidth: number }
> = {
  room_601: { roomWidth: 12, roomHeight: 10.8, maxWidth: 11 },
  room_603: { roomWidth: 11.8, roomHeight: 10.8, maxWidth: 10.8 },
  room_604: { roomWidth: 9.9, roomHeight: 10.8, maxWidth: 9 },
  room_605: { roomWidth: 9.7, roomHeight: 11.7, maxWidth: 8.7 },
  room_606: { roomWidth: 7.9, roomHeight: 11.7, maxWidth: 7 },
  room_607: { roomWidth: 10.2, roomHeight: 11.8, maxWidth: 9.2 },
  room_608: { roomWidth: 10.3, roomHeight: 11.8, maxWidth: 9.3 },
  room_609: { roomWidth: 5.6, roomHeight: 9.2, maxWidth: 4.8 },
  room_610: { roomWidth: 9.6, roomHeight: 10.9, maxWidth: 8.8 },
  room_611_612: { roomWidth: 12.8, roomHeight: 10.9, maxWidth: 12 },
  room_613: { roomWidth: 11.5, roomHeight: 10.8, maxWidth: 10.5 },
  ladies_toilet: { roomWidth: 3, roomHeight: 5, maxWidth: 2.7 },
  toilet: { roomWidth: 4, roomHeight: 1.6, maxWidth: 3.5 },
  gents_toilet: { roomWidth: 4.8, roomHeight: 9, maxWidth: 4.2 },
  lift: { roomWidth: 2.8, roomHeight: 3, maxWidth: 2.5 },
  electrical_room: { roomWidth: 8, roomHeight: 3, maxWidth: 7 },
  staircase_west: { roomWidth: 3.3, roomHeight: 8.3, maxWidth: 3 },
  staircase_central: { roomWidth: 6, roomHeight: 5, maxWidth: 5 },
  staircase_east: { roomWidth: 5, roomHeight: 9.7, maxWidth: 4.5 },
};

const FLOOR5_DISPLAY_NAMES: Record<string, string> = {
  room_601: "S5/S6 CSE-A\nCLASS ROOM",
  room_603: "S5/S6 CSE-B\nCLASS ROOM",
  room_604: "S5/S6 CS AI\nCLASS ROOM",
  room_605: "DIV OF CSE & AIDS\nDEPARTMENT",
  room_606: "ELECTIVE / TUTORIAL/\nIDP ROOM",
  room_607: "S3/S4 CSE-A\nCLASS ROOM",
  room_609: "FILE ASSOCIATION\nROOM",
  room_610: "S7/S8 CS-AI\nCLASS ROOM",
  room_611_612: "S7/S8 CSE-B\nCLASS ROOM",
  room_613: "S3/S4 CSE-B\nCLASS ROOM",
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
  const isFloor4 = data.floor === "4";
  const isFloor5 = data.floor === "5";
  const showsRoomNumber = isFloor4 || isFloor5;
  return (
    <>
      {data.places.map((place) => {
        // These two source annotations share the same small elevator core.
        // Stack their names in one rendered label, while preserving both places.
        if (isFloor4 && place.id === "engine_room") return null;
        const displayName =
          isFloor4 && place.id === "lift_west"
            ? "LIFT\nEngine Room"
            : isFloor4
              ? FLOOR4_DISPLAY_NAMES[place.id] ?? place.name
              : isFloor5
                ? FLOOR5_DISPLAY_NAMES[place.id] ?? place.name
                : place.name;
        const numberAlreadyInName =
          showsRoomNumber &&
          place.roomNumber !== undefined &&
          new RegExp(`(^|\\D)${place.roomNumber}(\\D|$)`).test(place.name);
        const displayText =
          showsRoomNumber && place.roomNumber && !numberAlreadyInName
            ? `${place.roomNumber}\n${displayName}`
            : displayName;
        const roomLayout = isFloor4
          ? FLOOR4_LABEL_LAYOUTS[place.id]
          : isFloor5
            ? FLOOR5_LABEL_LAYOUTS[place.id]
            : undefined;
        const fontSize = roomLayout
          ? Math.max(
              0.34,
              Math.min(0.44, roomLayout.roomWidth / 12, roomLayout.roomHeight / 24),
            )
          : showsRoomNumber
            ? 0.36
            : 0.65;
        const displayLineCount = displayText.split("\n").length;
        const labelY =
          showsRoomNumber && place.roomNumber
            ? 3.1 + ((displayLineCount - 1) * fontSize * 1.2) / 2
            : 3.1;

        return (
          <Text
            key={place.id}
            position={[
              place.cadX - minX,
              labelY,
              -(place.cadY - minY),
            ]}
            fontSize={fontSize}
            color="#ffe082"
            anchorX="center"
            anchorY="middle"
            outlineWidth={showsRoomNumber ? 0.02 : 0.035}
            outlineColor="#202025"
            maxWidth={roomLayout?.maxWidth ?? (showsRoomNumber ? 4 : 8)}
            textAlign="center"
          >
            {displayText}
          </Text>
        );
      })}
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
  const requestedFloor = new URLSearchParams(window.location.search).get("floor");
  const floorId = requestedFloor === "5" || requestedFloor === "6" ? requestedFloor : "4";
  useEffect(() => {
  Promise.all([
    fetch(`/data/Ramanujan_F${floorId}/walls.json`).then((response) => {
      if (!response.ok) throw new Error(`Could not load floor ${floorId} walls`);
      return response.json() as Promise<WallData>;
    }),
    fetch(`/data/Ramanujan_F${floorId}/semantics.json`).then((response) => {
      if (!response.ok) throw new Error(`Could not load floor ${floorId} semantics`);
      return response.json() as Promise<SemanticData>;
    }),
  ])
    .then(([wallData, semanticData]) => {
      setData(wallData);
      setSemantics(semanticData);
    })
    .catch((err: Error) => setError(err.message));
}, [floorId]);

  if (error) {
    return <div>{error}</div>;
  }

  if (!data || !semantics) {
  return <div>Loading floor {floorId} model...</div>;
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
