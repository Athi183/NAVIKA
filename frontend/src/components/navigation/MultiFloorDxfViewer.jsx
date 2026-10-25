import { useMemo, useState } from 'react'
import { Layers3, Map, Maximize2 } from 'lucide-react'
import building from '../../data/ramanujan_floors_2_6.json'

const colors = ['#2563eb', '#059669', '#7c3aed', '#d97706', '#db2777']
const SCALE = 6.2
const PLANE_X = 46
const PLANE_Y = 36

function projected(point, index) {
  return [point[0] * SCALE + index * PLANE_X, -point[1] * SCALE - index * PLANE_Y]
}

function Marker({ connector, index, isStacked }) {
  const [x, y] = projected(connector.xy, isStacked ? index : 0)
  const isLift = connector.type === 'lift'
  return (
    <g transform={`translate(${x} ${y})`}>
      {isLift
        ? <rect x="-5" y="-5" width="10" height="10" rx="1.5" fill="#0891b2" stroke="white" strokeWidth="1.5" />
        : <path d="M0,-6 L6,5 L-6,5 Z" fill="#ea580c" stroke="white" strokeWidth="1.5" />}
      {!isStacked && <text x="8" y="-5" className="dxf-marker-label">{isLift ? 'LIFT' : 'UP'}</text>}
    </g>
  )
}

export default function MultiFloorDxfViewer() {
  const [mode, setMode] = useState('stacked')
  const [selectedFloor, setSelectedFloor] = useState(5)
  const [showLabels, setShowLabels] = useState(false)
  const floors = building.floors
  const activeFloors = mode === 'stacked' ? floors : floors.filter((floor) => floor.floor_number === selectedFloor)
  const isStacked = mode === 'stacked'
  const svgBounds = useMemo(() => {
    const minX = 21 * SCALE
    const maxX = 125 * SCALE + (isStacked ? 4 * PLANE_X : 0)
    const minY = -58 * SCALE - (isStacked ? 4 * PLANE_Y : 0)
    const maxY = 51 * SCALE
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`
  }, [isStacked])

  const connectorLinks = isStacked ? building.vertical_connectors.flatMap((connector) => {
    const ordered = Object.entries(connector.stops).sort(([a], [b]) => Number(a) - Number(b))
    return ordered.slice(0, -1).map(([from, fromPoint], i) => {
      const [to, toPoint] = ordered[i + 1]
      if (Number(to) !== Number(from) + 1) return null
      const fromIndex = Number(from) - 2
      const toIndex = Number(to) - 2
      const a = projected(fromPoint, fromIndex)
      const b = projected(toPoint, toIndex)
      return { id: `${connector.id}-${from}-${to}`, a, b, kind: connector.type }
    }).filter(Boolean)
  }) : []

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 md:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">{building.building.building_label} · DXF only</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl">Multi-floor visualization</h1>
            <p className="mt-1 text-sm text-slate-500">Second through sixth floors · source geometry and labels from the supplied DXF</p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Visualization mode">
            <button onClick={() => setMode('stacked')} className={`rounded-xl px-4 py-2 text-sm font-semibold ${isStacked ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}><Layers3 className="mr-2 inline h-4 w-4" />Stacked</button>
            <button onClick={() => setMode('single')} className={`rounded-xl px-4 py-2 text-sm font-semibold ${!isStacked ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}><Map className="mr-2 inline h-4 w-4" />Single floor</button>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 px-5 pt-4 md:px-7">
          {floors.map((floor, index) => (
            <button key={floor.floor_number} onClick={() => { setSelectedFloor(floor.floor_number); setMode('single') }} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${selectedFloor === floor.floor_number ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: colors[index] }} />{floor.label}
            </button>
          ))}
          <button onClick={() => setShowLabels((value) => !value)} className="ml-auto rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600"><Maximize2 className="mr-1.5 inline h-3.5 w-3.5" />{showLabels ? 'Hide room labels' : 'Show room labels'}</button>
        </div>

        <div className="m-4 overflow-hidden rounded-2xl bg-[#f4f7f8] md:m-6">
          <svg className="block h-[58vh] min-h-[420px] w-full" viewBox={svgBounds} role="img" aria-label={isStacked ? 'Stacked line drawing of floors two through six with candidate vertical stairs and lifts' : `${floors.find((floor) => floor.floor_number === selectedFloor)?.label} DXF plan`}>
            <defs>
              <pattern id="dxf-grid" width="38.44" height="38.44" patternUnits="userSpaceOnUse"><path d="M 38.44 0 L 0 0 0 38.44" fill="none" stroke="#dce4e8" strokeWidth="0.45" /></pattern>
            </defs>
            <rect x="0" y="-600" width="1200" height="1200" fill="url(#dxf-grid)" />
            {connectorLinks.map((link) => <line key={link.id} x1={link.a[0]} y1={link.a[1]} x2={link.b[0]} y2={link.b[1]} stroke={link.kind === 'lift' ? '#0891b2' : '#ea580c'} strokeWidth="2.4" strokeDasharray="5 4" opacity="0.72" />)}
            {activeFloors.map((floor) => {
              const index = floor.floor_number - 2
              const [shiftX, shiftY] = isStacked ? [index * PLANE_X, -index * PLANE_Y] : [0, 0]
              return (
                <g key={floor.floor_number}>
                  <rect x={25 * SCALE + shiftX} y={-54 * SCALE + shiftY} width={98 * SCALE} height={75 * SCALE} rx="5" fill={colors[index]} fillOpacity={isStacked ? 0.045 : 0.018} stroke={colors[index]} strokeOpacity={isStacked ? 0.3 : 0.18} strokeWidth="1.1" />
                  {floor.segments.map(([x1, y1, x2, y2], segmentIndex) => <line key={`${floor.floor_number}-${segmentIndex}`} x1={x1 * SCALE + shiftX} y1={-y1 * SCALE + shiftY} x2={x2 * SCALE + shiftX} y2={-y2 * SCALE + shiftY} stroke="#37474f" strokeWidth={isStacked ? 0.62 : 0.78} strokeOpacity={isStacked ? 0.28 : 0.52} vectorEffect="non-scaling-stroke" />)}
                  {showLabels && floor.labels.map((label, labelIndex) => {
                    const [x, y] = projected(label.xy, index)
                    return <text key={`${floor.floor_number}-label-${labelIndex}`} x={isStacked ? x : label.xy[0] * SCALE} y={isStacked ? y : -label.xy[1] * SCALE} textAnchor="middle" className="dxf-room-label" opacity={isStacked ? 0.58 : 0.9}>{label.text}</text>
                  })}
                  {floor.connectors.map((connector, markerIndex) => <Marker key={`${floor.floor_number}-${markerIndex}`} connector={connector} index={index} isStacked={isStacked} />)}
                  <g transform={`translate(${31 * SCALE + shiftX} ${-47 * SCALE + shiftY})`}>
                    <rect x="0" y="-18" width="122" height="22" rx="11" fill={colors[index]} />
                    <text x="61" y="-3" textAnchor="middle" className="dxf-floor-chip">{floor.label.toUpperCase()}</text>
                  </g>
                </g>
              )
            })}
          </svg>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 pb-5 text-xs text-slate-600 md:px-7">
          <span><i className="mr-2 inline-block h-2.5 w-2.5 rotate-45 bg-cyan-600" />Lift label</span>
          <span><i className="mr-2 inline-block h-0 w-0 border-x-[6px] border-b-[10px] border-x-transparent border-b-orange-600" />UP stair marker</span>
          {isStacked && <span><i className="mr-2 inline-block w-7 border-t-2 border-dashed border-slate-500" />Candidate floor-to-floor continuation</span>}
          <span className="ml-auto">DXF units: {building.building.units}</span>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <article className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-bold text-amber-950">Drawing-based interpretation</h2>
          <p className="mt-2 text-sm leading-6 text-amber-900">Vertical links are inferred from repeated <b>UP</b> and <b>LIFT</b> labels. Dashed links are candidates for review; the DXF does not confirm continuous shafts, landings, or accessible routing. Floors 5 and 6 contain no separately labelled center lift, so no center-lift link is drawn there.</p>
          <p className="mt-2 text-xs leading-5 text-amber-800">The vertical separation and slight plan offsets in the stacked view are illustrative. The DXF provides no verified floor elevations or survey registration.</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold text-slate-900">Candidate vertical connections</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {building.vertical_connectors.map((connector) => {
              const stops = Object.keys(connector.stops).map(Number).sort((a, b) => a - b)
              return <div key={connector.id} className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700"><span className="font-semibold">{connector.label}</span><span className="ml-2 text-slate-500">Floors {stops.join(' · ')}</span><span className="ml-2 text-amber-700">candidate</span></div>
            })}
          </div>
          <p className="mt-3 text-xs text-slate-500"><Maximize2 className="mr-1 inline h-3.5 w-3.5" />This view visualizes floor plans; it does not claim verified cross-floor navigation routes.</p>
        </article>
      </section>
      <style>{`.dxf-room-label{font:2.4px sans-serif; fill:#25323a; pointer-events:none}.dxf-marker-label{font:3.2px sans-serif;font-weight:700;fill:#263238}.dxf-floor-chip{font:5px sans-serif;font-weight:700;letter-spacing:.35px;fill:white}`}</style>
    </div>
  )
}
