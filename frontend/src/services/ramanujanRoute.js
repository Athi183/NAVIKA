const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

function connectorStops(sourceFloor, destinationFloor, connector, floorLabels) {
  const direction = sourceFloor <= destinationFloor ? 1 : -1
  const stops = []
  for (let floor = sourceFloor; direction > 0 ? floor <= destinationFloor : floor >= destinationFloor; floor += direction) {
    const xy = connector.stops[String(floor)]
    if (!xy) return null
    stops.push({ floor, floorLabel: floorLabels.get(floor), xy })
  }
  return stops
}

/**
 * Creates the shared DXF-derived route preview used by the kiosk and QR page.
 * All room-to-connector approaches remain candidates until reviewed in the
 * source plan and on site; this must not be presented as verified wayfinding.
 */
export function findRamanujanRoute(source, destination, connectors, profile, assumptions, connectorChoice = 'auto', floorLabels = new Map()) {
  if (!source || !destination) return null
  const walkSpeed = profile === 'step_free' ? assumptions.accessible_walk_speed_mps : assumptions.walk_speed_mps
  const start = 'route:source'
  const goal = 'route:destination'
  const adjacency = new Map()
  const addEdge = (edge) => {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, [])
    adjacency.get(edge.from).push(edge)
  }
  const metric = (edge) => profile === 'shortest' ? edge.distanceM : edge.durationS

  if (source.floor === destination.floor) {
    const distanceM = distance(source.xy, destination.xy)
    addEdge({
      from: start,
      to: goal,
      distanceM,
      durationS: distanceM / walkSpeed,
      points: [{ floor: source.floor, floorLabel: source.floorLabel, xy: source.xy }, { floor: destination.floor, floorLabel: destination.floorLabel, xy: destination.xy }],
      kind: 'unverified_room_to_room_approach',
    })
  } else {
    const eligible = connectors
      .filter((connector) => connectorChoice === 'auto' || connector.id === connectorChoice)
      .filter((connector) => profile !== 'step_free' || connector.type === 'lift')

    for (const connector of eligible) {
      const stops = connectorStops(source.floor, destination.floor, connector, floorLabels)
      if (!stops) continue
      const landingId = (floor) => `${connector.id}:${floor}`
      const first = stops[0]
      const last = stops.at(-1)
      const firstLegM = distance(source.xy, first.xy)
      const lastLegM = distance(last.xy, destination.xy)
      addEdge({
        from: start,
        to: landingId(first.floor),
        connectorId: connector.id,
        distanceM: firstLegM,
        durationS: firstLegM / walkSpeed + (connector.type === 'lift' ? assumptions.lift_wait_seconds_per_trip : 0),
        points: [{ floor: source.floor, floorLabel: source.floorLabel, xy: source.xy }, first],
        kind: 'unverified_room_to_connector_approach',
      })
      addEdge({
        from: landingId(last.floor),
        to: goal,
        connectorId: connector.id,
        distanceM: lastLegM,
        durationS: lastLegM / walkSpeed,
        points: [last, { floor: destination.floor, floorLabel: destination.floorLabel, xy: destination.xy }],
        kind: 'unverified_connector_to_room_approach',
      })

      for (const [index, fromStop] of stops.slice(0, -1).entries()) {
        const toStop = stops[index + 1]
        const floorCount = Math.abs(toStop.floor - fromStop.floor)
        const riseM = assumptions.floor_rise_m * floorCount
        const planOffsetM = distance(fromStop.xy, toStop.xy)
        if (connector.type === 'stair') {
          const stairLengthM = riseM / Math.sin(assumptions.stair_angle_degrees * Math.PI / 180)
          const up = toStop.floor > fromStop.floor
          addEdge({
            from: landingId(fromStop.floor), to: landingId(toStop.floor), connectorId: connector.id,
            distanceM: stairLengthM + planOffsetM,
            durationS: stairLengthM / (up ? assumptions.stair_up_speed_mps : assumptions.stair_down_speed_mps),
            points: [fromStop, toStop], kind: 'candidate_stair_transition',
          })
          addEdge({
            from: landingId(toStop.floor), to: landingId(fromStop.floor), connectorId: connector.id,
            distanceM: stairLengthM + planOffsetM,
            durationS: stairLengthM / (up ? assumptions.stair_down_speed_mps : assumptions.stair_up_speed_mps),
            points: [toStop, fromStop], kind: 'candidate_stair_transition',
          })
        } else {
          const liftSeconds = riseM / assumptions.lift_speed_mps + assumptions.lift_door_seconds_per_floor * floorCount
          addEdge({
            from: landingId(fromStop.floor), to: landingId(toStop.floor), connectorId: connector.id,
            distanceM: riseM + planOffsetM, durationS: liftSeconds,
            points: [fromStop, toStop], kind: 'candidate_lift_transition',
          })
          addEdge({
            from: landingId(toStop.floor), to: landingId(fromStop.floor), connectorId: connector.id,
            distanceM: riseM + planOffsetM, durationS: liftSeconds,
            points: [toStop, fromStop], kind: 'candidate_lift_transition',
          })
        }
      }
    }
  }

  // Dijkstra over non-negative preview costs, keeping the selected edges so
  // both frontends render the same connector, distance, time and steps.
  const costs = new Map([[start, 0]])
  const previous = new Map()
  const queue = [{ id: start, cost: 0 }]
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost)
    const current = queue.shift()
    if (current.cost !== costs.get(current.id)) continue
    if (current.id === goal) break
    for (const edge of adjacency.get(current.id) || []) {
      const cost = current.cost + metric(edge)
      if (cost < (costs.get(edge.to) ?? Infinity)) {
        costs.set(edge.to, cost)
        previous.set(edge.to, { id: current.id, edge })
        queue.push({ id: edge.to, cost })
      }
    }
  }
  if (!costs.has(goal)) return null

  const pathEdges = []
  let cursor = goal
  while (cursor !== start) {
    const step = previous.get(cursor)
    if (!step) return null
    pathEdges.unshift(step.edge)
    cursor = step.id
  }
  const points = pathEdges.flatMap((edge, index) => index === 0 ? edge.points : edge.points.slice(1))
  const uniquePoints = points.filter((point, index) => index === 0 || point.floor !== points[index - 1].floor || distance(point.xy, points[index - 1].xy) > 0.001)
  const connectorId = pathEdges.find((edge) => edge.connectorId)?.connectorId || null
  const sourceLanding = pathEdges.find((edge) => edge.kind === 'unverified_room_to_connector_approach')?.points.at(-1)
  const transitionLandings = pathEdges.filter((edge) => edge.kind === 'candidate_stair_transition' || edge.kind === 'candidate_lift_transition').map((edge) => edge.points.at(-1))
  const stops = connectorId ? [sourceLanding, ...transitionLandings].filter(Boolean) : []
  return {
    algorithm: 'dijkstra',
    profile,
    connectorId,
    connector: connectors.find((item) => item.id === connectorId) || null,
    points: uniquePoints,
    stops,
    edges: pathEdges,
    distanceM: pathEdges.reduce((sum, edge) => sum + edge.distanceM, 0),
    durationS: pathEdges.reduce((sum, edge) => sum + edge.durationS, 0),
    floorTransitions: pathEdges.filter((edge) => edge.kind === 'candidate_stair_transition' || edge.kind === 'candidate_lift_transition').length,
    candidateOnly: true,
  }
}

export function buildCandidateRouteSteps(source, destination, route) {
  if (!source || !destination || !route) return []
  if (source.floor === destination.floor) {
    return [
      { floor: source.floor, text: `Start at ${source.name || source.label} on ${source.floorLabel}.` },
      { floor: source.floor, text: `Preview approach toward ${destination.name || destination.label}. This is a straight-line estimate and is not checked against doors or corridor walls.` },
      { floor: destination.floor, text: `Destination: ${destination.name || destination.label}. Confirm the room entrance and corridor route on the floor plan.` },
    ]
  }
  const steps = [
    { floor: source.floor, text: `Start at ${source.name || source.label} on ${source.floorLabel}.` },
    { floor: source.floor, text: `Candidate approach to the ${route.connector?.label || 'selected vertical connector'} landing. Door and corridor access are not verified.` },
  ]
  for (const [index, stop] of route.stops.slice(1).entries()) {
    const from = index === 0 ? route.stops[0].floorLabel : route.stops[index].floorLabel
    steps.push({
      floor: stop.floor,
      text: `${route.connector?.type === 'lift' ? 'Candidate lift ride' : 'Candidate stair transition'}: ${from} to ${stop.floorLabel}. Confirm this connector serves both floors.`,
    })
  }
  steps.push({ floor: destination.floor, text: `Candidate approach from the connector to ${destination.name || destination.label}. Confirm the exit, corridor and room doorway before using this route.` })
  steps.push({ floor: destination.floor, text: `Destination: ${destination.name || destination.label}.` })
  return steps
}
