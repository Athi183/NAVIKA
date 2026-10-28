/** Physical elevations are estimates; inspection spacing is visual only. */
export const STACKED_FLOOR_CONFIG = {
  // Estimated building elevations. Replace these with verified storey heights.
  floors: [
    { id: "4", elevation: 0, offsetX: 0, offsetZ: 0 },
    // Mean semantic-anchor corrections; CAD alignment remains unverified.
    { id: "5", elevation: 3, offsetX: -0.024855, offsetZ: 0.002161 },
    // Cumulative Floor 5→6 mean correction, relative to the Floor 4 preview origin.
    { id: "6", elevation: 6, offsetX: -0.572493, offsetZ: -1.527466 },
  ],
  // Inspection-only separation between adjacent rendered floor models.
  // The extra display offset must never be used to size staircase geometry.
  visualFloorGap: 10,
  // Shared slab appearance; thickness is along world Y.
  floorSlab: { thickness: 0.16, color: "#D9D9D9" },
  stairs: {
    flightsPerStorey: 2,
    stepsPerFlight: 10,
    // Riser height is derived from physical floor elevations / total risers.
    // At the defaults (3 m rise / 20 risers), each riser is 0.15 model units.
    treadDepth: 0.28,
    treadThickness: 0.08,
    width: 1.2,
    landingLength: 1.2,
    landingThickness: 0.14,
    handrailHeight: 0.9,
    handrailThickness: 0.055,
    structuralThickness: 0.16,
    visible: { treads: true, supports: true, handrails: true },
    // Local semantic anchors plus connector-to-landing corrections. The
    // corrections place the upper landing on the opposite side of the switchback
    // within each approximate stair core; review them against surveyed plans.
    // Rotation follows the long axis of the nearby stair enclosure.
    connectors: [
      { id: "a", lowerFloor: "4", upperFloor: "5", lowerRecord: "staircase_west", upperRecord: "staircase_west", x: 1.464367, z: -22.732926, upperX: 1.574922, upperZ: -22.752487, upperLandingOffsetX: 1.1143, upperLandingOffsetZ: 0.0174, rotation: Math.PI / 2 },
      { id: "b", lowerFloor: "4", upperFloor: "5", lowerRecord: "staircase_central", upperRecord: "staircase_central", x: 26.464367, z: -14.532926, upperX: 26.174922, upperZ: -14.452487, upperLandingOffsetX: 0.3143, upperLandingOffsetZ: 1.1174, rotation: 0 },
      { id: "c", lowerFloor: "4", upperFloor: "5", lowerRecord: "staircase_east", upperRecord: "staircase_east", x: 82.164367, z: -7.782926, upperX: 82.074922, upperZ: -8.852487, upperLandingOffsetX: 1.3143, upperLandingOffsetZ: 1.0674, rotation: Math.PI / 2 },
      { id: "a", lowerFloor: "5", upperFloor: "6", lowerRecord: "staircase_west", upperRecord: "staircase_left", x: 1.574922, z: -22.752487, upperX: 0.7158, upperZ: -19.7735, upperLandingOffsetX: 2.60676, upperLandingOffsetZ: -1.44936, rotation: Math.PI / 2 },
      { id: "b", lowerFloor: "5", upperFloor: "6", lowerRecord: "staircase_central", upperRecord: "staircase_middle", x: 26.174922, z: -14.452487, upperX: 28.4054, upperZ: -12.2441, upperLandingOffsetX: -1.68284, upperLandingOffsetZ: 0.52124, rotation: 0 },
      { id: "c", lowerFloor: "5", upperFloor: "6", lowerRecord: "staircase_east", upperRecord: "staircase_right", x: 82.074922, z: -8.852487, upperX: 83.3358, upperZ: -8.9996, upperLandingOffsetX: 0.48676, upperLandingOffsetZ: 1.67674, rotation: Math.PI / 2 },
    ],
  },
} as const;
