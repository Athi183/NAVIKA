import { useMemo, useState } from 'react'
import { Accessibility, MapPin, Navigation, Route, TriangleAlert } from 'lucide-react'
import building from '../data/ramanujan_floors_2_6.json'
import graph from '../data/ramanujan_navigation_graph_candidate.json'

const places = building.floors.flatMap((floor) => floor.labels.map((label, index) => ({
  id: `${floor.floor_number}:${index}`,
  floor: floor.floor_number,
  floorLabel: floor.label,
  name: label.text,
  xy: label.display_xy || label.xy,
})))
const assumptions = graph.routing_assumptions
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const duration = (seconds) => {
  const total = Math.max(0, Math.round(seconds))
  return total < 60 ? `${total} sec` : `${Math.floor(total / 60)} min ${total % 60} sec`
}

function getFloorRoute(source, destination, profile, selectedConnector) {
  const connectors = building.vertical_connectors
    .filter((item) => !selectedConnector || selectedConnector === 'auto' || item.id === selectedConnector)
    .filter((item) => profile !== 'step_free' || item.type === 'lift')
    .filter((item) => {
      const low = Math.min(source.floor, destination.floor)
      const high = Math.max(source.floor, destination.floor)
      return Array.from({ length: high - low + 1 }, (_, index) => String(low + index)).every((floor) => item.stops[floor])
    })
  if (source.floor === destination.floor) {
    const metres = distance(source.xy, destination.xy)
    return { connector: null, stops: [], distanceM: metres, durationS: metres / (profile === 'step_free' ? assumptions.accessible_walk_speed_mps : assumptions.walk_speed_mps) }
  }
  const candidates = connectors.map((connector) => {
    const direction = source.floor < destination.floor ? 1 : -1
    const stops = []
    for (let floor = source.floor; direction > 0 ? floor <= destination.floor : floor >= destination.floor; floor += direction) {
      stops.push({ floor, xy: connector.stops[String(floor)] })
    }
    const a = stops[0]
    const b = stops.at(-1)
    const walkDistance = distance(source.xy, a.xy) + distance(b.xy, destination.xy)
    const walkSpeed = profile === 'step_free' ? assumptions.accessible_walk_speed_mps : assumptions.walk_speed_mps
    const floors = Math.abs(destination.floor - source.floor)
    let connectorDistance
    let connectorTime
    if (connector.type === 'stair') {
      const incline = assumptions.floor_rise_m * floors / Math.sin(assumptions.stair_angle_degrees * Math.PI / 180)
      connectorDistance = incline
      connectorTime = incline / (direction > 0 ? assumptions.stair_up_speed_mps : assumptions.stair_down_speed_mps)
    } else {
      connectorDistance = assumptions.floor_rise_m * floors
      connectorTime = connectorDistance / assumptions.lift_speed_mps + assumptions.lift_door_seconds_per_floor * floors + assumptions.lift_wait_seconds_per_trip
    }
    const totalDistance = walkDistance + connectorDistance
    const totalTime = walkDistance / walkSpeed + connectorTime
    return { connector, stops, distanceM: totalDistance, durationS: totalTime }
  })
  const score = (item) => profile === 'shortest' ? item.distanceM : item.durationS
  return candidates.sort((a, b) => score(a) - score(b))[0] || null
}

function floorBounds(floor) {
  const segments = floor.segments.filter(([x1, y1, x2, y2]) => {
    const len = Math.hypot(x2 - x1, y2 - y1)
    const x = (x1 + x2) / 2
    const y = (y1 + y2) / 2
    return len >= 0.45 && len <= 50 && x >= 25 && x <= 123 && y >= 24 && y <= 64
  })
  const coords = segments.flatMap((line) => [[line[0], line[1]], [line[2], line[3]]])
  if (!coords.length) return null
  const minX = Math.min(...coords.map(([x]) => x)) - 2
  const maxX = Math.max(...coords.map(([x]) => x)) + 2
  const minY = Math.min(...coords.map(([, y]) => y)) - 2
  const maxY = Math.max(...coords.map(([, y]) => y)) + 2
  return { segments, minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY }
}

function FloorPlan({ floor, source, destination, stops }) {
  const bounds = useMemo(() => floorBounds(floor), [floor])
  if (!bounds) return null
  const from = source.floor === floor.floor_number ? source.xy : stops.find((item) => item.floor === floor.floor_number)?.xy
  const to = destination.floor === floor.floor_number ? destination.xy : stops.find((item) => item.floor === floor.floor_number)?.xy
  const sourceIsHere = source.floor === floor.floor_number
  const destinationIsHere = destination.floor === floor.floor_number
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><h2 className="font-bold">{floor.label}</h2><span className="text-xs text-slate-500">DXF plan · route candidate</span></div>
    <div className="p-2">
      <svg viewBox={`${bounds.minX} ${-bounds.maxY} ${bounds.width} ${bounds.height}`} className="max-h-[48vh] min-h-[240px] w-full rounded-xl bg-slate-50" role="img" aria-label={`${floor.label} floor plan with candidate route`}>
        <g fill="none" stroke="#64748b" strokeWidth="0.13" vectorEffect="non-scaling-stroke">
          {bounds.segments.map(([x1, y1, x2, y2], index) => <line key={index} x1={x1} y1={-y1} x2={x2} y2={-y2} />)}
        </g>
        {from && to && <line x1={from[0]} y1={-from[1]} x2={to[0]} y2={-to[1]} stroke="#dc2626" strokeWidth="0.45" strokeDasharray="1.3 0.8" vectorEffect="non-scaling-stroke" />}
        {from && <g><circle cx={from[0]} cy={-from[1]} r="0.85" fill="#16a34a" stroke="white" strokeWidth="0.2" /><text x={from[0]} y={-from[1] - 1.4} fontSize="1.4" textAnchor="middle" fill="#166534" stroke="white" strokeWidth="0.12" paintOrder="stroke">{sourceIsHere ? `FROM · ${source.name}` : stops.find((item) => item.floor === floor.floor_number)?.floorLabel}</text></g>}
        {to && <g><circle cx={to[0]} cy={-to[1]} r="0.85" fill={destinationIsHere ? '#dc2626' : '#0284c7'} stroke="white" strokeWidth="0.2" /><text x={to[0]} y={-to[1] + 2.4} fontSize="1.4" textAnchor="middle" fill={destinationIsHere ? '#991b1b' : '#075985'} stroke="white" strokeWidth="0.12" paintOrder="stroke">{destinationIsHere ? `TO · ${destination.name}` : stops.find((item) => item.floor === floor.floor_number)?.floorLabel}</text></g>}
      </svg>
    </div>
  </section>
}

export default function MobileRoute() {
  const params = new URLSearchParams(window.location.search)
  const source = places.find((item) => item.id === params.get('from'))
  const destination = places.find((item) => item.id === params.get('to'))
  const profile = ['fastest', 'shortest', 'step_free'].includes(params.get('profile')) ? params.get('profile') : 'fastest'
  const [selectedFloor, setSelectedFloor] = useState(null)
  const route = useMemo(() => source && destination ? getFloorRoute(source, destination, profile, params.get('connector') || 'auto') : null, [source, destination, profile])
  if (!source || !destination || !route) return <main className="mx-auto min-h-screen max-w-lg p-6"><h1 className="text-2xl font-bold">NAVIKA route unavailable</h1><p className="mt-3 text-slate-600">This QR link is missing a valid source or destination. Please create a new route QR from the navigation screen.</p></main>

  const floors = building.floors.filter((floor) => floor.floor_number === source.floor || floor.floor_number === destination.floor)
  const steps = source.floor === destination.floor
    ? [
      { floor: source.floor, text: `Start at ${source.name} on ${source.floorLabel}.` },
      { floor: source.floor, text: `Follow the highlighted candidate line toward ${destination.name}.` },
      { floor: destination.floor, text: `Arrive at ${destination.name}.` },
    ]
    : [
      { floor: source.floor, text: `Start at ${source.name} on ${source.floorLabel}.` },
      { floor: source.floor, text: `Proceed toward the ${route.connector.label} landing. The room-to-connector approach is estimated as a straight line.` },
      ...route.stops.slice(1).map((stop, index) => ({
        floor: stop.floor,
        text: `${route.connector.type === 'lift' ? 'Ride' : 'Take'} the ${route.connector.label} from ${route.stops[index].floorLabel} to ${stop.floorLabel}.`,
      })),
      { floor: destination.floor, text: `Leave the connector and proceed toward ${destination.name}. The connector-to-room approach is estimated as a straight line.` },
      { floor: destination.floor, text: `Arrive at ${destination.name}.` },
    ]
  const profileLabel = profile === 'step_free' ? 'Step-free lift candidate' : profile === 'shortest' ? 'Shortest distance candidate' : 'Fastest time candidate'
  const activeFloor = selectedFloor ?? steps[currentStep]?.floor ?? source.floor
  const focused = floors.filter((floor) => floor.floor_number === activeFloor)
  return <main className="min-h-screen bg-slate-100 px-3 py-4 text-slate-900 sm:px-5">
    <div className="mx-auto max-w-lg space-y-4">
      <header className="rounded-3xl bg-slate-900 p-5 text-white shadow-lg"><div className="text-2xl font-black tracking-tight">NAVIKA</div><div className="mt-1 text-xs uppercase tracking-[0.25em] text-cyan-300">Indoor route · Ramanujan Block</div>
        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2"><div><div className="text-[10px] uppercase tracking-widest text-slate-400">From</div><div className="mt-1 font-semibold">{source.name}</div><div className="text-xs text-slate-400">{source.floorLabel}</div></div><Route className="text-cyan-300" size={20} /><div className="text-right"><div className="text-[10px] uppercase tracking-widest text-slate-400">To</div><div className="mt-1 font-semibold">{destination.name}</div><div className="text-xs text-slate-400">{destination.floorLabel}</div></div></div>
      </header>

      <section className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-white p-3 shadow-sm"><div className="text-[10px] uppercase text-slate-500">Distance</div><div className="mt-1 font-bold">~{route.distanceM.toFixed(0)} m</div></div>
        <div className="rounded-2xl bg-white p-3 shadow-sm"><div className="text-[10px] uppercase text-slate-500">Time</div><div className="mt-1 font-bold">~{duration(route.durationS)}</div></div>
        <div className="rounded-2xl bg-white p-3 shadow-sm"><div className="text-[10px] uppercase text-slate-500">Route type</div><div className="mt-1 flex items-center gap-1 text-xs font-bold">{profile === 'step_free' && <Accessibility size={14} />}{profileLabel}</div></div>
      </section>

      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><div className="flex gap-2 font-bold"><TriangleAlert size={18} className="shrink-0" />Planning estimate only</div><p className="mt-2 text-xs leading-5">The DXF graph still has no verified room-to-corridor links. The red segment and room-to-connector approaches are straight-line guesses. Do not rely on these as live turn-by-turn directions until the route is reviewed on site.</p></section>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><h1 className="flex items-center gap-2 font-bold"><Navigation size={18} className="text-cyan-700" /> Route steps</h1><span className="text-xs text-slate-500">{currentStep + 1} / {steps.length}</span></div><div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3"><div className="text-[10px] font-bold uppercase tracking-widest text-cyan-800">{building.floors.find((floor) => floor.floor_number === steps[currentStep].floor)?.label}</div><div className="mt-1 text-sm font-semibold leading-5">{steps[currentStep].text}</div></div><div className="flex gap-2"><button type="button" disabled={currentStep === 0} onClick={() => setCurrentStep((step) => Math.max(0, step - 1))} className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-40">Previous</button><button type="button" disabled={currentStep === steps.length - 1} onClick={() => setCurrentStep((step) => Math.min(steps.length - 1, step + 1))} className="flex-1 rounded-xl bg-cyan-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Next step</button></div><details className="text-xs text-slate-500"><summary className="cursor-pointer font-semibold">Show all steps</summary><ol className="mt-2 space-y-2">{steps.map((step, index) => <li key={`${step.floor}-${index}`} className="flex gap-2"><span className="font-semibold">{index + 1}.</span><span>{step.text}</span></li>)}</ol></details></section>

      <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="font-bold">Route map · {building.floors.find((floor) => floor.floor_number === activeFloor)?.label}</h2>{floors.length > 1 && <span className="text-xs text-slate-500">Map follows the current step</span>}</div>{floors.length > 1 && <div className="flex gap-2">{floors.map((floor) => <button key={floor.floor_number} onClick={() => setSelectedFloor(floor.floor_number)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${activeFloor === floor.floor_number ? 'bg-cyan-800 text-white' : 'bg-white text-slate-700'}`}>{floor.label}</button>)}</div>}{focused.map((floor) => <FloorPlan key={floor.floor_number} floor={floor} source={source} destination={destination} stops={route.stops} />)}</section>

      <section className="rounded-2xl bg-white p-4 text-xs text-slate-600 shadow-sm"><div className="flex items-center justify-between"><span>Selected connector</span><span className="font-semibold text-slate-900">{route.connector?.label || 'Same floor'}</span></div><div className="mt-2 flex items-center justify-between"><span>Floor transitions</span><span className="font-semibold text-slate-900">{route.stops.length ? route.stops.length - 1 : 0}</span></div><div className="mt-2 flex items-center justify-between"><span>Time model</span><span className="font-semibold text-slate-900">DXF candidate assumptions</span></div></section>
      <footer className="pb-5 text-center text-[11px] text-slate-500"><MapPin size={13} className="mr-1 inline" />Use the floor buttons to focus the map while travelling.</footer>
    </div>
  </main>
}
