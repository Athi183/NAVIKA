import { Box } from "@react-three/drei";
import { STACKED_FLOOR_CONFIG } from "./stackedFloorConfig";

type LiftConnector = (typeof STACKED_FLOOR_CONFIG.lifts.connectors)[number];
type FloorPlacement = (typeof STACKED_FLOOR_CONFIG.floors)[number];

type Props = {
  lift: LiftConnector;
  floors: readonly FloorPlacement[];
  floorY: (floorIndex: number) => number;
};

function LiftDoor({ lift, level, x, z }: {
  lift: LiftConnector; level: number; x: number; z: number;
}) {
  const cfg = STACKED_FLOOR_CONFIG.lifts;
  const width = cfg.doorWidth;
  const height = cfg.doorHeight;
  const thickness = cfg.doorThickness;
  const frame = cfg.doorFrameThickness;
  const doorY = level + height / 2;
  const leafWidth = width / 2 - 0.025;

  if (lift.doorFacing === "north") {
    const faceZ = z - thickness / 2;
    return <group>
      {[-1, 1].map((side) => <Box key={`leaf-${side}`} args={[leafWidth, height - 0.04, thickness]} position={[x + side * width / 4, doorY, faceZ]}>
        <meshStandardMaterial color={cfg.doorColor} metalness={0.22} roughness={0.32} />
      </Box>)}
      <Box args={[0.025, height - 0.04, 0.025]} position={[x, doorY, faceZ]}>
        <meshStandardMaterial color={cfg.frameColor} metalness={0.55} roughness={0.3} />
      </Box>
      {[-1, 1].map((side) => <Box key={`jamb-${side}`} args={[frame, height + frame, frame]} position={[x + side * (width / 2 + frame / 2), level + height / 2, z]}>
        <meshStandardMaterial color={cfg.frameColor} metalness={0.25} roughness={0.55} />
      </Box>)}
      <Box args={[width + frame * 2, frame, frame]} position={[x, level + height + frame / 2, z]}>
        <meshStandardMaterial color={cfg.frameColor} metalness={0.25} roughness={0.55} />
      </Box>
    </group>;
  }

  const faceX = x - thickness / 2;
  return <group>
    {[-1, 1].map((side) => <Box key={`leaf-${side}`} args={[thickness, height - 0.04, leafWidth]} position={[faceX, doorY, z + side * width / 4]}>
      <meshStandardMaterial color={cfg.doorColor} metalness={0.22} roughness={0.32} />
    </Box>)}
    <Box args={[0.025, height - 0.04, 0.025]} position={[faceX, doorY, z]}>
      <meshStandardMaterial color={cfg.frameColor} metalness={0.55} roughness={0.3} />
    </Box>
    {[-1, 1].map((side) => <Box key={`jamb-${side}`} args={[frame, height + frame, frame]} position={[x, level + height / 2, z + side * (width / 2 + frame / 2)]}>
      <meshStandardMaterial color={cfg.frameColor} metalness={0.25} roughness={0.55} />
    </Box>)}
    <Box args={[frame, frame, width + frame * 2]} position={[x, level + height + frame / 2, z]}>
      <meshStandardMaterial color={cfg.frameColor} metalness={0.25} roughness={0.55} />
    </Box>
  </group>;
}

/** One continuous, lightly translucent metallic shaft with CAD-derived doors at each stop. */
export function LiftShaft({ lift, floors, floorY }: Props) {
  const cfg = STACKED_FLOOR_CONFIG.lifts;
  const bottomY = floorY(0);
  const topY = floorY(floors.length - 1);
  const shaftHeight = topY - bottomY + cfg.doorHeight;
  const centerY = bottomY + shaftHeight / 2;
  const x = lift.centerX;
  const z = lift.centerZ;
  const wall = cfg.shaftWallThickness;
  const materialProps = {
    color: cfg.shaftColor,
    transparent: true,
    opacity: cfg.shaftOpacity,
    depthWrite: false,
    roughness: cfg.shaftRoughness,
    metalness: cfg.shaftMetalness,
  };
  const edge = cfg.shaftEdgeThickness;
  const edgeMaterialProps = {
    color: cfg.frameColor,
    metalness: 0.55,
    roughness: 0.3,
  };

  return <group>
    {lift.doorFacing !== "west" && <Box args={[wall, shaftHeight, lift.depth]} position={[x - lift.width / 2 + wall / 2, centerY, z]}>
      <meshStandardMaterial {...materialProps} />
    </Box>}
    <Box args={[wall, shaftHeight, lift.depth]} position={[x + lift.width / 2 - wall / 2, centerY, z]}>
      <meshStandardMaterial {...materialProps} />
    </Box>
    <Box args={[lift.width, shaftHeight, wall]} position={[x, centerY, z + lift.depth / 2 - wall / 2]}>
      <meshStandardMaterial {...materialProps} />
    </Box>
    {lift.doorFacing !== "north" && <Box args={[lift.width, shaftHeight, wall]} position={[x, centerY, z - lift.depth / 2 + wall / 2]}>
      <meshStandardMaterial {...materialProps} />
    </Box>}

    {/* Dark steel corner rails make the full shaft height legible from any angle. */}
    {[-1, 1].flatMap((sideX) => [-1, 1].map((sideZ) => <Box
      key={`shaft-edge-${sideX}-${sideZ}`}
      args={[edge, shaftHeight, edge]}
      position={[x + sideX * (lift.width / 2 - edge / 2), centerY, z + sideZ * (lift.depth / 2 - edge / 2)]}
    >
      <meshStandardMaterial {...edgeMaterialProps} />
    </Box>))}

    {lift.floors.map((entry) => {
      const floorIndex = floors.findIndex((floor) => floor.id === entry.floor);
      if (floorIndex < 0) return null;
      const floor = floors[floorIndex];
      const level = floorY(floorIndex);
      const doorX = entry.connectorX + entry.doorOffsetX + floor.offsetX;
      const doorZ = entry.connectorZ + entry.doorOffsetZ + floor.offsetZ;
      return <LiftDoor key={`${lift.id}-${entry.floor}`} lift={lift} level={level} x={doorX} z={doorZ} />;
    })}
  </group>;
}
