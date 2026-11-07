/** Physical elevations are estimates; inspection spacing is visual only. */
export const STACKED_FLOOR_CONFIG = {
  // Estimated building elevations. Replace these with verified storey heights.
  floors: [
    // Ground Floor markers align closely with Floor 1; placement remains a candidate.
    { id: "G", elevation: -12, offsetX: -2.223, offsetZ: 0.318 },
    // Floor 1 markers align closely with Floor 2; placement remains a candidate.
    { id: "1", elevation: -9, offsetX: -2.223, offsetZ: 0.318 },
    // Floor 2 aligns to Floor 3 through repeated stair/lift markers; candidate only.
    { id: "2", elevation: -6, offsetX: -2.223, offsetZ: 0.318 },
    // Candidate Floor 3 alignment from the repeated stair/lift labels; this is not survey verified.
    { id: "3", elevation: -3, offsetX: -2.24, offsetZ: 0.31 },
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
  lifts: {
    shaftWallThickness: 0.12,
    shaftOpacity: 0.56,
    shaftColor: "#D8DDE2",
    shaftMetalness: 0.38,
    shaftRoughness: 0.3,
    shaftEdgeThickness: 0.075,
    doorWidth: 1.4,
    doorHeight: 2.1,
    doorThickness: 0.07,
    doorFrameThickness: 0.1,
    doorColor: "#F5F5F5",
    frameColor: "#687783",
    // Shared-building centers are means of CAD-derived enclosure centers after
    // floor alignment. Shaft sizes follow the traced CAD cores. Door offsets
    // and north/west facings are estimates from nearby wall/corridor geometry.
    connectors: [
      {
        id: "a",
        name: "Lift A",
        centerX: 32.5561,
        centerZ: -12.2974,
        width: 3.15,
        depth: 2.95,
        doorFacing: "north",
        floors: [
          // Marker alignment and doorway offsets on Floors 2–3 are candidates pending landing review.
          { floor: "G", record: "lift_a", connectorX: 33.140993, connectorZ: -12.908028, doorOffsetX: 1.856, doorOffsetZ: -0.855 },
          { floor: "1", record: "lift_a", connectorX: 33.275059, connectorZ: -12.751862, doorOffsetX: 1.717, doorOffsetZ: -1.011 },
          { floor: "2", record: "lift_a", connectorX: 33.132382, connectorZ: -12.733258, doorOffsetX: 1.86, doorOffsetZ: -1.03 },
          { floor: "3", record: "lift_a", connectorX: 33.175841, connectorZ: -12.819489, doorOffsetX: 1.833, doorOffsetZ: -0.932 },
          { floor: "4", record: "lift_west", connectorX: 32.964367, connectorZ: -12.832926, doorOffsetX: -0.195, doorOffsetZ: -0.608 },
          { floor: "5", record: "lift_b", connectorX: 32.746422, connectorZ: -12.215487, doorOffsetX: 0.12, doorOffsetZ: -1.464 },
          { floor: "6", record: "lift_middle", connectorX: 32.7498, connectorZ: -10.9426, doorOffsetX: -0.001, doorOffsetZ: -1.519 },
        ],
      },
      {
        id: "b",
        name: "Lift B",
        centerX: 83.5104,
        centerZ: -15.7936,
        width: 1.8,
        depth: 2.15,
        doorFacing: "west",
        floors: [
          { floor: "G", record: "lift_b", connectorX: 86.200993, connectorZ: -16.496428, doorOffsetX: -1.177, doorOffsetZ: 0.470 },
          { floor: "1", record: "lift_b", connectorX: 86.118459, connectorZ: -16.417662, doorOffsetX: -1.089, doorOffsetZ: 0.394 },
          { floor: "2", record: "lift_b", connectorX: 86.310082, connectorZ: -16.289458, doorOffsetX: -1.281, doorOffsetZ: 0.266 },
          { floor: "3", record: "lift_b", connectorX: 86.322841, connectorZ: -16.460889, doorOffsetX: -1.277, doorOffsetZ: 0.447 },
          { floor: "4", record: "lift_east", connectorX: 82.464367, connectorZ: -15.782926, doorOffsetX: 0.342, doorOffsetZ: 0.0785 },
          { floor: "5", record: "lift", connectorX: 83.074922, connectorZ: -15.402487, doorOffsetX: -0.27, doorOffsetZ: -0.305 },
          { floor: "6", record: "lift", connectorX: 83.1775, connectorZ: -14.0675, doorOffsetX: -0.3792, doorOffsetZ: -0.3761 },
        ],
      },
    ],
  },
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
      // Ground–Floor 1 marker alignment is close; landings remain unverified.
      { id: "a", lowerFloor: "G", upperFloor: "1", lowerRecord: "staircase_a", upperRecord: "staircase_a", x: 0.744193, z: -21.918428, upperX: 0.744259, upperZ: -21.865162, upperLandingOffsetX: 1.1143, upperLandingOffsetZ: 0.0174, rotation: Math.PI / 2 },
      { id: "b", lowerFloor: "G", upperFloor: "1", lowerRecord: "staircase_b", upperRecord: "staircase_b", x: 29.535193, z: -14.089628, upperX: 29.535159, upperZ: -14.036362, upperLandingOffsetX: 0.3143, upperLandingOffsetZ: 1.1174, rotation: 0 },
      { id: "c", lowerFloor: "G", upperFloor: "1", lowerRecord: "staircase_c", upperRecord: "staircase_c", x: 86.650393, z: -10.716128, upperX: 86.650359, upperZ: -10.662862, upperLandingOffsetX: 1.3143, upperLandingOffsetZ: 1.0674, rotation: Math.PI / 2 },
      // Floor 1–2 core markers repeat; landing model follows the same candidate configuration.
      { id: "a", lowerFloor: "1", upperFloor: "2", lowerRecord: "staircase_a", upperRecord: "staircase_a", x: 0.744259, z: -21.865162, upperX: 0.744282, upperZ: -21.881058, upperLandingOffsetX: 1.1143, upperLandingOffsetZ: 0.0174, rotation: Math.PI / 2 },
      { id: "b", lowerFloor: "1", upperFloor: "2", lowerRecord: "staircase_b", upperRecord: "staircase_b", x: 29.535159, z: -14.036362, upperX: 29.775982, upperZ: -13.655558, upperLandingOffsetX: 0.3143, upperLandingOffsetZ: 1.1174, rotation: 0 },
      { id: "c", lowerFloor: "1", upperFloor: "2", lowerRecord: "staircase_c", upperRecord: "staircase_c", x: 86.650359, z: -10.662862, upperX: 86.650382, upperZ: -10.678758, upperLandingOffsetX: 1.3143, upperLandingOffsetZ: 1.0674, rotation: Math.PI / 2 },
      // Floor 2–3 core markers repeat in the DXFs; landing shape is inferred from the adjacent stack model.
      { id: "a", lowerFloor: "2", upperFloor: "3", lowerRecord: "staircase_a", upperRecord: "staircase_a", x: 0.744282, z: -21.881058, upperX: 0.744241, upperZ: -21.448289, upperLandingOffsetX: 1.1143, upperLandingOffsetZ: 0.0174, rotation: Math.PI / 2 },
      { id: "b", lowerFloor: "2", upperFloor: "3", lowerRecord: "staircase_b", upperRecord: "staircase_b", x: 29.775982, z: -13.655558, upperX: 29.806141, upperZ: -13.675189, upperLandingOffsetX: 0.3143, upperLandingOffsetZ: 1.1174, rotation: 0 },
      { id: "c", lowerFloor: "2", upperFloor: "3", lowerRecord: "staircase_c", upperRecord: "staircase_c", x: 86.650382, z: -10.678758, upperX: 86.650341, upperZ: -10.794389, upperLandingOffsetX: 1.3143, upperLandingOffsetZ: 1.0674, rotation: Math.PI / 2 },
      // Floor 3–4 stair correspondence is based on left-to-right UP labels; geometry is provisional.
      { id: "a", lowerFloor: "3", upperFloor: "4", lowerRecord: "staircase_a", upperRecord: "staircase_west", x: 0.744241, z: -21.448289, upperX: 1.464367, upperZ: -22.732926, upperLandingOffsetX: 1.1143, upperLandingOffsetZ: 0.0174, rotation: Math.PI / 2 },
      { id: "b", lowerFloor: "3", upperFloor: "4", lowerRecord: "staircase_b", upperRecord: "staircase_central", x: 29.806141, z: -13.675189, upperX: 26.464367, upperZ: -14.532926, upperLandingOffsetX: 0.3143, upperLandingOffsetZ: 1.1174, rotation: 0 },
      { id: "c", lowerFloor: "3", upperFloor: "4", lowerRecord: "staircase_c", upperRecord: "staircase_east", x: 86.650341, z: -10.794389, upperX: 82.164367, upperZ: -7.782926, upperLandingOffsetX: 1.3143, upperLandingOffsetZ: 1.0674, rotation: Math.PI / 2 },
      { id: "a", lowerFloor: "4", upperFloor: "5", lowerRecord: "staircase_west", upperRecord: "staircase_west", x: 1.464367, z: -22.732926, upperX: 1.574922, upperZ: -22.752487, upperLandingOffsetX: 1.1143, upperLandingOffsetZ: 0.0174, rotation: Math.PI / 2 },
      { id: "b", lowerFloor: "4", upperFloor: "5", lowerRecord: "staircase_central", upperRecord: "staircase_central", x: 26.464367, z: -14.532926, upperX: 26.174922, upperZ: -14.452487, upperLandingOffsetX: 0.3143, upperLandingOffsetZ: 1.1174, rotation: 0 },
      { id: "c", lowerFloor: "4", upperFloor: "5", lowerRecord: "staircase_east", upperRecord: "staircase_east", x: 82.164367, z: -7.782926, upperX: 82.074922, upperZ: -8.852487, upperLandingOffsetX: 1.3143, upperLandingOffsetZ: 1.0674, rotation: Math.PI / 2 },
      { id: "a", lowerFloor: "5", upperFloor: "6", lowerRecord: "staircase_west", upperRecord: "staircase_left", x: 1.574922, z: -22.752487, upperX: 0.7158, upperZ: -19.7735, upperLandingOffsetX: 2.60676, upperLandingOffsetZ: -1.44936, rotation: Math.PI / 2 },
      { id: "b", lowerFloor: "5", upperFloor: "6", lowerRecord: "staircase_central", upperRecord: "staircase_middle", x: 26.174922, z: -14.452487, upperX: 28.4054, upperZ: -12.2441, upperLandingOffsetX: -1.68284, upperLandingOffsetZ: 0.52124, rotation: 0 },
      { id: "c", lowerFloor: "5", upperFloor: "6", lowerRecord: "staircase_east", upperRecord: "staircase_right", x: 82.074922, z: -8.852487, upperX: 83.3358, upperZ: -8.9996, upperLandingOffsetX: 0.48676, upperLandingOffsetZ: 1.67674, rotation: Math.PI / 2 },
    ],
  },
} as const;
