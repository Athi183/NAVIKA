import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Accessibility, ArrowDown, ArrowLeft, ArrowUp, BookOpen, Box, Building2, Car, ClipboardList, Clock, Coffee, DoorOpen,
  Footprints, GraduationCap, Landmark, Layers, List, MapPin, Search, Toilet, UserRound, X,
} from 'lucide-react'
import MGeorgeBuilding3D from './MGeorgeBuilding3D'
import { CATEGORY_LABELS, SITE, floorName, formatDuration, loadBuilding, routeBounds, routeFromKiosk, searchDestinations } from '../../services/mgeorgeRoute'

const IDLE_RESET_MS = 90_000
// Individual stairs, lifts and exits are listed under their own categories
// only, so "All places" stays a list of rooms.
const CONNECTOR_CATEGORIES = new Set(['stairs', 'lift', 'exit'])
const NEAREST_TOILET = '__nearest_toilet__'

// What first-time visitors (parents, guests) usually look for. Each entry is
// matched to the first destination with one of these names; missing ones are skipped.
const POPULAR = [
  { names: ['Reception'], label: 'Reception', icon: UserRound },
  { names: ['Admission Cell'], label: 'Admissions', icon: ClipboardList },
  { names: ['Principal'], label: "Principal's office", icon: GraduationCap },
  { names: ['Administrative Office'], label: 'Administrative office', icon: Building2 },
  { names: ['Exam Cell A', 'Exam Cell'], label: 'Exam cell', icon: ClipboardList },
  { names: ['Tagore Library'], label: 'Library', icon: BookOpen },
  { id: NEAREST_TOILET, label: 'Nearest toilet', icon: Toilet },
  { names: ['Canteen'], label: 'Canteen', icon: Coffee },
  { names: ['Vikram Sarabhai Auditorium'], label: 'Auditorium', icon: Landmark },
  { names: ['Ramanujan Block'], label: 'Ramanujan Block', icon: Building2 },
  { names: ['Parking Ground'], label: 'Parking', icon: Car },
  { names: ['Main Entrance'], label: 'Way out', icon: DoorOpen },
]

const floorSortKey = (floor, kioskFloor) => (floor === kioskFloor ? -1 : floor === SITE ? 99 : floor)

function useIdleReset(onReset) {
  const callback = useRef(onReset)
  useEffect(() => {
    callback.current = onReset
  })
  useEffect(() => {
    let timer
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => callback.current(), IDLE_RESET_MS)
    }
    const events = ['pointerdown', 'keydown', 'wheel']
    events.forEach((name) => window.addEventListener(name, arm))
    arm()
    return () => {
      clearTimeout(timer)
      events.forEach((name) => window.removeEventListener(name, arm))
    }
  }, [])
}

function Chip({ active, onClick, children }) {
  return <button type="button" onClick={onClick}
    className={`rounded-full px-5 py-3 text-base font-semibold ${active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
    {children}
  </button>
}

function PlaceButton({ place, onPick }) {
  return <button type="button" onClick={() => onPick(place)}
    className="flex min-h-[76px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left shadow-sm hover:border-brand-400 hover:shadow">
    <span>
      <span className="block text-lg font-bold leading-6 text-slate-900">{place.name}</span>
      <span className="text-sm text-slate-500">{place.floorName} · {CATEGORY_LABELS[place.category] || place.category}</span>
    </span>
    <MapPin className="h-6 w-6 shrink-0 text-brand-500" />
  </button>
}

/** Every place, with floor and category filters, for visitors who want to look around. */
function BrowseAll({ model, onPick }) {
  const [category, setCategory] = useState('all')
  const [floor, setFloor] = useState('all')
  const categories = useMemo(() => [...new Set(model.destinations.map((place) => place.category))]
    .sort((a, b) => (CATEGORY_LABELS[a] || a).localeCompare(CATEGORY_LABELS[b] || b)), [model])
  const results = model.destinations
    .filter((place) => (category === 'all' ? !CONNECTOR_CATEGORIES.has(place.category) : place.category === category))
    .filter((place) => floor === 'all' || place.floor === floor)
    .sort((a, b) => floorSortKey(a.floor, model.kiosk.floor) - floorSortKey(b.floor, model.kiosk.floor) || a.name.localeCompare(b.name))
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by floor">
      <Chip active={floor === 'all'} onClick={() => setFloor('all')}><Layers className="mr-1 inline h-4 w-4" />Everywhere</Chip>
      {model.floors.map((item) => <Chip key={item.floor_number} active={floor === item.floor_number} onClick={() => setFloor(item.floor_number)}>
        {item.name}{item.floor_number === model.kiosk.floor ? ' · You are here' : ''}
      </Chip>)}
      {model.site && <Chip active={floor === SITE} onClick={() => setFloor(SITE)}>Outside (campus)</Chip>}
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
      <Chip active={category === 'all'} onClick={() => setCategory('all')}>All places</Chip>
      {categories.map((item) => <Chip key={item} active={category === item} onClick={() => setCategory(item)}>{CATEGORY_LABELS[item] || item}</Chip>)}
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {results.map((place) => <PlaceButton key={place.id} place={place} onPick={onPick} />)}
    </div>
  </div>
}

function DestinationPicker({ model, onPick, onExplore }) {
  const [query, setQuery] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const popular = useMemo(() => POPULAR.map((item) => {
    if (item.id === NEAREST_TOILET) return model.destinations.some((place) => place.category === 'toilet') ? { ...item, place: { id: NEAREST_TOILET } } : null
    const place = item.names.map((name) => model.destinations.find((d) => d.name === name)).find(Boolean)
    return place ? { ...item, place } : null
  }).filter(Boolean), [model])
  const results = query ? searchDestinations(model.destinations, query)
    .sort((a, b) => floorSortKey(a.floor, model.kiosk.floor) - floorSortKey(b.floor, model.kiosk.floor) || a.name.localeCompare(b.name)) : []

  return <div className="space-y-6">
    <h2 className="text-4xl font-black tracking-tight text-slate-900">Where would you like to go?</h2>
    <label className="flex items-center gap-3 rounded-2xl border-2 border-slate-300 bg-white px-5 py-4 focus-within:border-brand-500">
      <Search className="h-7 w-7 text-slate-400" />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a place, e.g. principal, library, canteen…" className="w-full bg-transparent text-xl outline-none" aria-label="Search places" />
      {query && <button type="button" onClick={() => setQuery('')} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Clear search"><X className="h-6 w-6" /></button>}
    </label>

    {query
      ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((place) => <PlaceButton key={place.id} place={place} onPick={onPick} />)}
        {!results.length && <p className="rounded-2xl bg-slate-50 p-6 text-lg text-slate-600 sm:col-span-2 lg:col-span-3">No place matches “{query}”. Try another word, or ask at reception.</p>}
      </div>
      : <>
        <section className="space-y-3">
          <h3 className="text-lg font-bold uppercase tracking-widest text-slate-500">Popular places</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {popular.map(({ label, icon: Icon, place }) => <button key={label} type="button" onClick={() => onPick(place)}
              className="flex min-h-[120px] flex-col items-start justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-brand-400 hover:shadow-md">
              <Icon className="h-9 w-9 text-brand-500" />
              <span>
                <span className="block text-xl font-bold leading-6 text-slate-900">{label}</span>
                <span className="text-sm text-slate-500">{place.id === NEAREST_TOILET ? 'Closest to you' : place.floorName}</span>
              </span>
            </button>)}
          </div>
        </section>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setBrowsing((value) => !value)} className="flex items-center gap-2 rounded-xl bg-slate-100 px-5 py-3 text-lg font-semibold text-slate-800 hover:bg-slate-200">
            <List className="h-5 w-5" />{browsing ? 'Hide the full list' : 'Browse all places'}
          </button>
          <button type="button" onClick={onExplore} className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-lg font-semibold text-white hover:bg-slate-800"><Box className="h-5 w-5" />Look around in 3D</button>
        </div>
        {browsing && <BrowseAll model={model} onPick={onPick} />}
      </>}
  </div>
}

/** One plain sentence: how to get there and how long it takes. */
function routeSummary(route, destination) {
  const parts = route.transitions.map((t) => {
    if (t.kind === 'entrance') return t.toFloor === SITE ? 'go out through the main entrance' : 'go back in through the main entrance'
    const way = t.kind === 'lift' ? `take the ${t.name.toLowerCase()}` : `take ${t.name}`
    return `${way} ${t.toFloor > t.fromFloor ? 'up' : 'down'} to the ${floorName(t.toFloor)}`
  })
  const time = formatDuration(route.durationS)
  if (!parts.length) return `${destination.name} is on this floor, about ${time} away. Follow the walking person.`
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
  return `${[first, ...parts.slice(1)].join(', then ')}. ${destination.name} is about ${time} away.`
}

function RouteView({ model, destination, onBack }) {
  const [stepFree, setStepFree] = useState(false)
  const route = useMemo(() => routeFromKiosk(model, destination, { stepFree }), [model, destination, stepFree])
  if (!route && stepFree) return <div className="space-y-4 rounded-3xl border border-amber-200 bg-amber-50 p-6">
    <p className="text-xl font-bold text-amber-900">No lift goes to {destination.name}.</p>
    <p className="text-lg text-amber-900">It can only be reached by stairs. Please ask at reception for help.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => setStepFree(false)} className="rounded-xl bg-slate-900 px-5 py-3 text-lg font-semibold text-white">Show the route with stairs</button>
      <button type="button" onClick={onBack} className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-lg font-semibold"><ArrowLeft className="h-5 w-5" />Choose another place</button>
    </div>
  </div>
  if (!route) return <div className="space-y-4"><button type="button" onClick={onBack} className="flex items-center gap-2 rounded-xl bg-slate-100 px-5 py-3 text-lg font-semibold"><ArrowLeft className="h-5 w-5" />Choose another place</button><p className="text-lg">Sorry, no walking route to {destination.name} was found.</p></div>

  const indoor = route.floors.filter((floor) => floor !== SITE)
  const outside = route.floors.includes(SITE)
  if (outside && model.site) indoor.push(model.site.level_floor)
  const low = Math.min(...indoor)
  const high = Math.max(...indoor)
  const stackedFloors = model.floors.map((floor) => floor.floor_number).filter((n) => n >= low && n <= high)

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" onClick={onBack} className="flex items-center gap-2 rounded-xl bg-slate-100 px-5 py-3 text-lg font-semibold text-slate-800 hover:bg-slate-200"><ArrowLeft className="h-5 w-5" />Choose another place</button>
      <button type="button" onClick={() => setStepFree((value) => !value)} aria-pressed={stepFree}
        className={`flex items-center gap-2 rounded-xl px-5 py-3 text-base font-semibold ${stepFree ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
        <Accessibility className="h-5 w-5" />Lifts only
      </button>
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(300px,1fr)_2fr]">
      <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">Going to</p>
          <h2 className="text-3xl font-black leading-tight text-slate-900">{destination.name}</h2>
          <p className="mt-1 text-lg font-semibold text-slate-600">{destination.floorName}</p>
        </div>
        <p className="rounded-2xl bg-blue-50 p-4 text-xl font-semibold leading-8 text-blue-950">{routeSummary(route, destination)}</p>
        <div className="flex gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-2xl bg-brand-100/70 px-4 py-3"><Footprints className="h-6 w-6 text-brand-500" /><span className="text-xl font-bold">{Math.round(route.distanceM)} m</span></div>
          <div className="flex flex-1 items-center gap-2 rounded-2xl bg-brand-100/70 px-4 py-3"><Clock className="h-6 w-6 text-brand-500" /><span className="text-xl font-bold">{formatDuration(route.durationS)}</span></div>
        </div>
        <details className="group" open>
          <summary className="cursor-pointer text-base font-semibold text-slate-600">Step-by-step directions</summary>
          <ol className="mt-3 space-y-3">
            {route.steps.map((step, index) => {
              const newFloor = index === 0 || step.floor !== route.steps[index - 1].floor
              const last = index === route.steps.length - 1
              return <li key={index}>
                {newFloor && route.legs.length > 1 && <p className="mb-2 mt-1 text-sm font-bold uppercase tracking-widest text-slate-500">{floorName(step.floor)}</p>}
                <div className="flex gap-3 text-lg leading-7">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base font-bold text-white ${last ? 'bg-brand-500' : step.transition ? 'bg-violet-600' : 'bg-slate-900'}`}>
                    {step.transition?.kind === 'entrance' ? <DoorOpen className="h-5 w-5" /> : step.transition ? (step.transition.toFloor > step.transition.fromFloor ? <ArrowUp className="h-5 w-5" /> : <ArrowDown className="h-5 w-5" />) : index + 1}
                  </span>
                  <span className={step.transition ? 'font-semibold text-violet-800' : ''}>{step.text}</span>
                </div>
              </li>
            })}
          </ol>
        </details>
      </section>
      <section className="h-[62vh] min-h-[420px] overflow-hidden rounded-3xl border border-slate-200 shadow-sm">
        <MGeorgeBuilding3D model={model} floors={stackedFloors} labelFloors={destination.floor === SITE ? [] : [destination.floor]} route={route} destination={destination}
          showSite={outside} focus={routeBounds([...route.legs.flatMap((item) => item.points), destination.entrance_xy || destination.xy], 30, outside ? 15 : 4)} />
      </section>
    </div>
  </div>
}

function BuildingExplorer({ model, onPick, onBack }) {
  const [floor, setFloor] = useState(() => {
    // ?floor=all, ?floor=site or ?floor=<n> picks the starting view.
    const requested = new URLSearchParams(window.location.search).get('floor')
    if (requested === 'all' || (requested === SITE && model.site)) return requested
    return requested !== null && model.byFloor.has(Number(requested)) ? Number(requested) : model.kiosk.floor
  })
  const all = floor === 'all'
  const campus = floor === SITE
  const floors = all ? model.floors.map((item) => item.floor_number) : campus ? [model.site.level_floor] : [floor]
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" onClick={onBack} className="flex items-center gap-2 rounded-xl bg-slate-100 px-5 py-3 text-lg font-semibold text-slate-800 hover:bg-slate-200"><ArrowLeft className="h-5 w-5" />Back</button>
      <p className="text-lg text-slate-600">Drag to turn, pinch or scroll to zoom. <span className="font-semibold text-slate-900">Tap a name to get directions.</span></p>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="What to show">
      {model.site && <Chip active={campus} onClick={() => setFloor(SITE)}>Whole campus</Chip>}
      {model.floors.map((item) => <Chip key={item.floor_number} active={floor === item.floor_number} onClick={() => setFloor(item.floor_number)}>
        {item.name}{item.floor_number === model.kiosk.floor ? ' · You are here' : ''}
      </Chip>)}
      <Chip active={all} onClick={() => setFloor('all')}><Layers className="mr-1 inline h-4 w-4" />All floors</Chip>
    </div>
    <section className="h-[68vh] min-h-[480px] overflow-hidden rounded-3xl border border-slate-200 shadow-sm">
      <MGeorgeBuilding3D key={String(floor)} model={model} floors={floors} labelFloors={all || campus ? [] : floors} onPick={onPick} showSite={campus}
        focus={campus ? siteBounds(model.site) : null} />
    </section>
  </div>
}

function siteBounds(site) {
  const xs = site.graph.nodes.map((node) => node.x)
  const ys = site.graph.nodes.map((node) => node.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

/** The toilet with the shortest walk from the kiosk. */
function nearestToilet(model) {
  let best = null
  for (const place of model.destinations) {
    if (place.category !== 'toilet') continue
    const route = routeFromKiosk(model, place)
    if (route && (!best || route.durationS < best.durationS)) best = { place, durationS: route.durationS }
  }
  return best?.place ?? null
}

export default function MGeorgeKioskNavigation() {
  const [model, setModel] = useState(null)
  const [error, setError] = useState('')
  const [destination, setDestination] = useState(null)
  const [exploring, setExploring] = useState(() => new URLSearchParams(window.location.search).has('explore'))
  useIdleReset(() => { setDestination(null); setExploring(false) })

  useEffect(() => {
    loadBuilding().then((loaded) => {
      setModel(loaded)
      // ?to=<destination id> opens a route directly (assistant hand-off, QR links).
      const requested = new URLSearchParams(window.location.search).get('to')
      setDestination(loaded.destinations.find((place) => place.id === requested) || null)
    }).catch((reason) => setError(reason.message))
  }, [])

  if (error) return <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-lg text-red-800">{error}</div>
  if (!model) return <div className="rounded-3xl border border-slate-200 bg-white p-8 text-lg text-slate-600">Loading the campus map…</div>

  const pick = (place) => setDestination(place.id === NEAREST_TOILET ? nearestToilet(model) : place)
  return <div className="space-y-5">
    <div className="flex items-center gap-3 rounded-2xl bg-blue-50 px-5 py-4 text-blue-900">
      <MapPin className="h-7 w-7 shrink-0 text-blue-700" />
      <p className="text-lg"><span className="font-bold">You are here:</span> Reception, M. George Block, {floorName(model.kiosk.floor)}</p>
    </div>
    {destination
      ? <RouteView key={destination.id} model={model} destination={destination} onBack={() => setDestination(null)} />
      : exploring
        ? <BuildingExplorer model={model} onPick={(place) => { setExploring(false); pick(place) }} onBack={() => setExploring(false)} />
        : <DestinationPicker model={model} onPick={pick} onExplore={() => setExploring(true)} />}
  </div>
}
