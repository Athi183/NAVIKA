import { Box } from "@react-three/drei";
import { Quaternion, Vector3 } from "three";
import { STACKED_FLOOR_CONFIG } from "./stackedFloorConfig";

type FlightProps = {
  start: [number, number];
  end: [number, number];
  baseY: number;
  rise: number;
  width: number;
  steps: number;
  treadThickness: number;
  structuralThickness: number;
  railThickness: number;
  railHeight: number;
  treadDepth: number;
  visible: { treads: boolean; supports: boolean; handrails: boolean };
};

function Beam({ start, end, thickness, color }: {
  start: Vector3; end: Vector3; thickness: number; color: string;
}) {
  const direction = end.clone().sub(start);
  const quaternion = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), direction.clone().normalize());
  const center = start.clone().add(end).multiplyScalar(0.5);
  return <Box args={[direction.length(), thickness, thickness]} position={[center.x, center.y, center.z]} quaternion={quaternion}>
    <meshStandardMaterial color={color} roughness={0.75} />
  </Box>;
}

function StairFlight({
  start, end, baseY, rise, width, steps, treadThickness, structuralThickness,
  railThickness, railHeight, treadDepth, visible,
}: FlightProps) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const run = Math.hypot(dx, dz);
  const stepRun = run / steps;
  const riser = rise / steps;
  const dirX = dx / run;
  const dirZ = dz / run;
  const yaw = Math.atan2(dirX, dirZ);
  const sideX = Math.cos(yaw);
  const sideZ = -Math.sin(yaw);
  const pointAt = (distance: number, side: number, y: number) => new Vector3(
    start[0] + dirX * distance + sideX * side,
    y,
    start[1] + dirZ * distance + sideZ * side,
  );
  const materialColor = "#b8b1a5";
  return <group>
    {visible.supports && [-width / 2 + structuralThickness / 2, width / 2 - structuralThickness / 2].map((side) => (
      <Beam key={`stringer-${side}`} start={pointAt(0, side, baseY - structuralThickness / 2)}
        end={pointAt(run, side, baseY + rise - structuralThickness / 2)} thickness={structuralThickness} color="#77777b" />
    ))}
    {Array.from({ length: steps }, (_, index) => {
      const distance = (index + 0.5) * stepRun;
      const topY = baseY + (index + 1) * riser;
      const treadCenter = pointAt(distance, 0, topY - treadThickness / 2);
      const riserCenter = pointAt((index + 1) * stepRun - treadThickness / 2, 0, baseY + (index + 0.5) * riser);
      return <group key={index}>
        {visible.treads && <>
          <Box args={[width, treadThickness, treadDepth]} position={[treadCenter.x, treadCenter.y, treadCenter.z]} rotation={[0, yaw, 0]}>
            <meshStandardMaterial color={materialColor} roughness={0.9} />
          </Box>
          <Box args={[width, riser, treadThickness]} position={[riserCenter.x, riserCenter.y, riserCenter.z]} rotation={[0, yaw, 0]}>
            <meshStandardMaterial color="#aaa397" roughness={0.9} />
          </Box>
        </>}
      </group>;
    })}
    {visible.handrails && [-width / 2, width / 2].map((side) => {
      const handrailStart = pointAt(0, side, baseY + railHeight);
      const handrailEnd = pointAt(run, side, baseY + rise + railHeight);
      return <group key={`rail-${side}`}>
        <Beam start={handrailStart} end={handrailEnd} thickness={railThickness} color="#50545a" />
        {Array.from({ length: Math.ceil(steps / 2) }, (_, postIndex) => {
          const stepIndex = Math.min((postIndex + 1) * 2, steps);
          const fraction = stepIndex / steps;
          const postBaseY = baseY + fraction * rise;
          const post = pointAt(fraction * run, side, postBaseY + railHeight / 2);
          return <Box key={postIndex} args={[railThickness, railHeight, railThickness]} position={[post.x, post.y, post.z]}>
            <meshStandardMaterial color="#686b70" metalness={0.2} roughness={0.65} />
          </Box>;
        })}
      </group>;
    })}
  </group>;
}

type Props = {
  x: number;
  y: number;
  z: number;
  rotation: number;
  storeyRise: number;
  upperOffsetX: number;
  upperOffsetZ: number;
};

/** Two-flight switchback staircase; storeyRise comes from the selected view mode. */
export function Staircase({ x, y, z, rotation, storeyRise, upperOffsetX, upperOffsetZ }: Props) {
  const cfg = STACKED_FLOOR_CONFIG.stairs;
  const flightRise = storeyRise / cfg.flightsPerStorey;
  const run = cfg.stepsPerFlight * cfg.treadDepth;
  const width = cfg.width;
  const treadThickness = cfg.treadThickness;
  const upper = [upperOffsetX, upperOffsetZ] as [number, number];
  const common = {
    width,
    steps: cfg.stepsPerFlight,
    treadThickness,
    structuralThickness: cfg.structuralThickness,
    railThickness: cfg.handrailThickness,
    railHeight: cfg.handrailHeight,
    treadDepth: cfg.treadDepth,
    visible: cfg.visible,
  };

  return <group position={[x, y, z]} rotation={[0, rotation, 0]}>
    <Box args={[cfg.landingLength, cfg.landingThickness, width]} position={[0, -cfg.landingThickness / 2, 0]}>
      <meshStandardMaterial color="#a9a39a" roughness={0.9} />
    </Box>
    <StairFlight {...common} start={[0, 0]} end={[run, 0]} baseY={0} rise={flightRise} />
    <Box args={[cfg.landingLength, cfg.landingThickness, width * 2]} position={[run, flightRise - cfg.landingThickness / 2, width / 2]}>
      <meshStandardMaterial color="#a9a39a" roughness={0.9} />
    </Box>
    <StairFlight {...common} start={[run, width]} end={upper} baseY={flightRise} rise={flightRise} />
    <Box args={[cfg.landingLength, cfg.landingThickness, width]} position={[upper[0], storeyRise - cfg.landingThickness / 2, upper[1]]}>
      <meshStandardMaterial color="#a9a39a" roughness={0.9} />
    </Box>
  </group>;
}
