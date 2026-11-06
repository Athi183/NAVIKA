import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Accessibility, ArrowDown, ArrowLeft, ArrowUp, BookOpen, Building2, Car, ClipboardList, Clock, Coffee, DoorOpen, Footprints,
  GraduationCap, Landmark, Layers, List, LocateFixed, MapPin, Minus, Navigation, Plus, Pointer, QrCode, Search, Smile, Toilet,
  UserRound, X,
} from 'lucide-react'
import MGeorgeBuilding3D from './MGeorgeBuilding3D'
import { QRCodeSVG } from 'qrcode.react'
import {
  CATEGORY_LABELS, PHONE_LINK_MINUTES, SITE, floorName, formatDuration, goesUp, levelOf, loadBuilding, phoneRouteUrl, placeAt, routeFromKiosk,
  routeScene, routeSummary, searchDestinations,
} from '../../services/mgeorgeRoute'

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
  { names: ['Ramanujan Block (bridge entrance)', 'Ramanujan Block'], label: 'Ramanujan Block', icon: Building2 },
  { names: ['Parking Ground'], label: 'Parking', icon: Car },
  { names: ['Main Entrance'], label: 'Way out', icon: DoorOpen },
]

// Kiosk floor first, then the rest of M. George, Ramanujan Block, outside.
const floorSortKey = (floor, kioskFloor) => (floor === kioskFloor ? -1 : floor === SITE ? 99 : typeof floor === 'string' ? 50 + levelOf(floor) : floor)
// Floors walked through but with no places of their own (the Ramanujan bridge floor) get no chip.
const floorsWithPlaces = (model) => model.floors.filter((floor) => !floor.transit_only)

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
    className={`rounded-full border-[3px] border-ink-900 px-5 py-3 text-base font-bold ${active ? 'bg-ink-900 text-white' : 'bg-white text-ink-900 hover:bg-brand-100'}`}>
    {children}
  </button>
}

function PlaceButton({ place, onPick }) {
  return <button type="button" onClick={() => onPick(place)}
    className="flex min-h-[76px] items-center justify-between gap-3 rounded-xl border-[3px] border-ink-900 bg-white px-5 py-4 text-left shadow-[3px_3px_0_0_#160f0f] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_#160f0f]">
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
      {floorsWithPlaces(model).map((item) => <Chip key={item.floor_number} active={floor === item.floor_number} onClick={() => setFloor(item.floor_number)}>
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

const BUILDINGS = [
  { id: 'campus', label: 'Whole campus' },
  { id: 'mgeorge', label: 'M. George Block' },
  { id: 'ramanujan', label: 'Ramanujan Block' },
]
const ALL_FLOORS = 'all'

const buildingOf = (floor) => (floor === SITE ? 'campus' : typeof floor === 'string' ? 'ramanujan' : 'mgeorge')

/** Map view that shows a place: its building, on its own floor. */
const viewOf = (place) => ({ building: buildingOf(place.floor), floor: place.floor === SITE ? null : place.floor })

/** A building's floors with places, top floor first, like a lift panel. */
function liftPanelFloors(model, building) {
  return floorsWithPlaces(model)
    .filter((floor) => buildingOf(floor.floor_number) === building)
    .sort((a, b) => levelOf(b.floor_number) - levelOf(a.floor_number))
}

function initialView(model) {
  // ?floor=site, ?floor=R5, ?floor=2 or ?floor=all opens that view (handy for demos).
  const requested = new URLSearchParams(window.location.search).get('floor')
  if (requested === SITE && model.site) return { building: 'campus', floor: null }
  if (requested === ALL_FLOORS) return { building: 'mgeorge', floor: ALL_FLOORS }
  if (model.byFloor.has(requested)) return { building: 'ramanujan', floor: requested }
  if (requested !== null && model.byFloor.has(Number(requested))) return { building: 'mgeorge', floor: Number(requested) }
  return { building: 'mgeorge', floor: model.kiosk.floor }
}

/** What the 3D map shows for a view. */
function mapScene(model, { building, floor }) {
  // Campus: every building as solid storeys at real height on the campus paths.
  if (building === 'campus') return { floors: [], labelFloors: [], showSite: true, focus: campusBounds(model), massing: true }
  const floors = floor === ALL_FLOORS ? liftPanelFloors(model, building).map((item) => item.floor_number) : [floor]
  return { floors, labelFloors: floor === ALL_FLOORS ? [] : floors, showSite: false, focus: null }
}

function PlaceCard({ model, place, onRoute, onClose }) {
  const route = useMemo(() => routeFromKiosk(model, place), [model, place])
  return <div className="space-y-3 rounded-xl border-[3px] border-ink-900 bg-white p-4 shadow-[4px_4px_0_0_#d8151c]">
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-2xl font-black leading-tight text-slate-900">{place.name}</p>
        <p className="mt-1 text-base font-semibold text-slate-600">{place.floorName} · {CATEGORY_LABELS[place.category] || place.category}</p>
      </div>
      <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Not this place"><X className="h-6 w-6" /></button>
    </div>
    {route && <p className="flex flex-wrap gap-x-4 text-lg font-semibold text-slate-700">
      <span className="flex items-center gap-1"><Clock className="h-5 w-5 text-brand-500" />{formatDuration(route.durationS)}</span>
      <span className="flex items-center gap-1"><Footprints className="h-5 w-5 text-brand-500" />{Math.round(route.distanceM)} m</span>
      {place.floor === model.kiosk.floor && <span className="text-blue-700">Same floor as you</span>}
    </p>}
    <button type="button" onClick={() => onRoute(place)} className="flex w-full items-center justify-center gap-2 rounded-xl border-[3px] border-ink-900 bg-brand-500 px-5 py-4 text-xl font-bold text-white shadow-[4px_4px_0_0_#160f0f] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_#160f0f] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
      <Navigation className="h-6 w-6" />Show me the way
    </button>
  </div>
}

/**
 * The kiosk's first screen: the 3D map opens on the visitor's own floor with
 * "You are here"; they look around by building and floor (a lift-style
 * panel), tap a room on the map or search, then get the route.
 */
function KioskHome({ model, lastPlace, onRoute, onThanks }) {
  const [view, setView] = useState(() => (lastPlace ? viewOf(lastPlace) : initialView(model)))
  const [selected, setSelected] = useState(lastPlace)
  const [query, setQuery] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [zoom, setZoom] = useState(null)
  const [mapKey, setMapKey] = useState(0)
  const popular = useMemo(() => POPULAR.map((item) => {
    if (item.id === NEAREST_TOILET) return model.destinations.some((place) => place.category === 'toilet') ? { ...item, place: { id: NEAREST_TOILET } } : null
    const place = item.names.map((name) => model.destinations.find((d) => d.name === name)).find(Boolean)
    return place ? { ...item, place } : null
  }).filter(Boolean), [model])
  const results = query ? searchDestinations(model.destinations, query)
    .sort((a, b) => floorSortKey(a.floor, model.kiosk.floor) - floorSortKey(b.floor, model.kiosk.floor) || a.name.localeCompare(b.name)).slice(0, 12) : []

  // Choosing a place shows it on the map (its building and floor) with its card.
  const choose = (place) => {
    const chosen = place.id === NEAREST_TOILET ? nearestToilet(model) : model.destinations.find((item) => item.id === place.id)
    if (!chosen) return
    setSelected(chosen)
    setView(viewOf(chosen))
    setQuery('')
    setBrowsing(false)
  }
  const showBuilding = (building) => {
    const floors = liftPanelFloors(model, building)
    const floor = building === 'campus' ? null : building === 'mgeorge' ? model.kiosk.floor : floors.at(-1)?.floor_number
    setView({ building, floor })
  }
  const backToMe = () => {
    setView({ building: 'mgeorge', floor: model.kiosk.floor })
    setMapKey((key) => key + 1)
  }
  const scene = mapScene(model, view)
  const panel = view.building === 'campus' ? [] : liftPanelFloors(model, view.building)

  return <div className="flex h-[calc(100dvh-10rem)] min-h-[560px] flex-col gap-3">
    <div className="relative flex gap-3">
      <label className="flex flex-1 items-center gap-3 rounded-xl border-[3px] border-ink-900 bg-white px-5 py-3 shadow-[3px_3px_0_0_#160f0f] focus-within:shadow-[5px_5px_0_0_#160f0f]">
        <Search className="h-7 w-7 text-slate-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Where do you want to go? e.g. library, principal, canteen…" className="w-full bg-transparent text-xl outline-none" aria-label="Search places" />
        {query && <button type="button" onClick={() => setQuery('')} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Clear search"><X className="h-6 w-6" /></button>}
      </label>
      <ThankYouButton onClick={onThanks} />
      {query && <div className="absolute inset-x-0 top-full z-20 mt-2 max-h-[55vh] overflow-y-auto rounded-xl border-[3px] border-ink-900 bg-white p-3 shadow-[5px_5px_0_0_#160f0f]">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((place) => <PlaceButton key={place.id} place={place} onPick={choose} />)}
        </div>
        {!results.length && <p className="p-4 text-lg text-slate-600">No place matches “{query}”. Try another word, or ask at reception.</p>}
      </div>}
    </div>
    <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Popular places">
      {popular.map(({ label, icon: Icon, place }) => <button key={label} type="button" onClick={() => choose(place)}
        className="flex shrink-0 items-center gap-2 rounded-full border-[3px] border-ink-900 bg-white px-4 py-2.5 text-base font-bold text-ink-900 hover:bg-brand-100">
        <Icon className="h-5 w-5 text-brand-500" />{label}
      </button>)}
      <button type="button" onClick={() => setBrowsing(true)} className="flex shrink-0 items-center gap-2 rounded-full border-[3px] border-ink-900 bg-ink-900 px-4 py-2.5 text-base font-bold text-white">
        <List className="h-5 w-5" />All places
      </button>
    </div>

    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_340px]">
      <section className="relative min-h-[360px] overflow-hidden rounded-2xl border-[3px] border-ink-900 shadow-[5px_5px_0_0_#160f0f]">
        <MGeorgeBuilding3D key={`${view.building}-${view.floor}-${mapKey}`} model={model} floors={scene.floors} labelFloors={scene.labelFloors}
          showSite={scene.showSite} focus={scene.focus} massing={scene.massing} destination={selected && scene.floors.concat(scene.showSite ? [SITE] : []).includes(selected.floor) ? selected : null}
          onPick={choose} onPickPoint={(floor, xy) => { const place = placeAt(model, floor, xy); if (place) choose(place) }} zoom={zoom}
          onPickBuilding={(name) => showBuilding(name === 'Ramanujan Block' ? 'ramanujan' : 'mgeorge')} />
        <div className="absolute bottom-3 left-3 flex gap-2">
          <button type="button" onClick={() => setZoom({ kind: 'in' })} className="flex h-14 w-14 items-center justify-center rounded-xl border-[3px] border-ink-900 bg-white text-ink-900 shadow-[3px_3px_0_0_#160f0f]" aria-label="Zoom in"><Plus className="h-7 w-7" /></button>
          <button type="button" onClick={() => setZoom({ kind: 'out' })} className="flex h-14 w-14 items-center justify-center rounded-xl border-[3px] border-ink-900 bg-white text-ink-900 shadow-[3px_3px_0_0_#160f0f]" aria-label="Zoom out"><Minus className="h-7 w-7" /></button>
          <button type="button" onClick={backToMe} className="flex h-14 items-center gap-2 rounded-xl border-[3px] border-ink-900 bg-white px-4 text-base font-bold text-ink-900 shadow-[3px_3px_0_0_#160f0f]"><LocateFixed className="h-6 w-6" />Back to me</button>
        </div>
        <p className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1.5 text-sm font-medium text-white">Drag to turn · pinch to zoom</p>
      </section>

      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <div className="flex items-center gap-2 rounded-xl border-[3px] border-ink-900 bg-blue-50 px-4 py-3 text-blue-900">
          <MapPin className="h-6 w-6 shrink-0 text-blue-700" />
          <p className="text-base leading-5"><span className="font-bold">You are here:</span> Reception, M. George Block, {floorName(model.kiosk.floor)}</p>
        </div>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Building">
          {BUILDINGS.filter((item) => item.id !== 'campus' || model.site).filter((item) => item.id === 'campus' || liftPanelFloors(model, item.id).length).map((item) =>
            <button key={item.id} type="button" onClick={() => showBuilding(item.id)} aria-pressed={view.building === item.id}
              className={`rounded-xl border-[3px] border-ink-900 px-2 py-3 text-sm font-bold leading-4 ${view.building === item.id ? 'bg-ink-900 text-white' : 'bg-white text-ink-900 hover:bg-brand-100'}`}>{item.label}</button>)}
        </div>
        {panel.length > 0 && <div className="rounded-xl border-[3px] border-ink-900 bg-cream-50 p-3" role="group" aria-label="Floor">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">Floor</p>
          <div className="grid grid-cols-3 gap-2">
            {panel.map((item) => {
              const active = view.floor === item.floor_number
              const here = item.floor_number === model.kiosk.floor
              return <button key={item.floor_number} type="button" onClick={() => setView({ building: view.building, floor: item.floor_number })} aria-pressed={active}
                className={`flex h-16 flex-col items-center justify-center rounded-xl border-[3px] border-ink-900 text-3xl font-black leading-8 ${active ? 'bg-ink-900 text-white' : 'bg-white text-ink-900'}`}>
                {levelOf(item.floor_number) === 0 ? 'G' : levelOf(item.floor_number)}
                {here && <span className={`text-[11px] font-bold leading-3 ${active ? 'text-blue-200' : 'text-blue-700'}`}>● You</span>}
              </button>
            })}
            <button type="button" onClick={() => setView({ building: view.building, floor: ALL_FLOORS })} aria-pressed={view.floor === ALL_FLOORS}
              className={`flex h-16 flex-col items-center justify-center rounded-xl border-[3px] border-ink-900 text-sm font-bold ${view.floor === ALL_FLOORS ? 'bg-ink-900 text-white' : 'bg-white text-ink-900'}`}>
              <Layers className="h-5 w-5" />All
            </button>
          </div>
        </div>}
        {selected
          ? <PlaceCard model={model} place={selected} onRoute={onRoute} onClose={() => setSelected(null)} />
          : <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border-[3px] border-dashed border-ink-900/40 p-5 text-center">
            <Pointer className="h-10 w-10 text-brand-500" />
            <p className="text-lg font-bold text-slate-800">Tap any room on the map</p>
            <p className="text-base text-slate-600">or search above, to see how to get there.</p>
          </div>}
      </aside>
    </div>

    {browsing && <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-6" onClick={() => setBrowsing(false)} role="presentation">
      <div role="dialog" aria-modal="true" aria-label="All places" onClick={(event) => event.stopPropagation()} className="w-full max-w-6xl space-y-4 rounded-2xl border-[3px] border-ink-900 bg-white p-6 shadow-[8px_8px_0_0_#160f0f]">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-black text-ink-900">All places</h2>
          <button type="button" onClick={() => setBrowsing(false)} className="rounded-xl border-[3px] border-ink-900 bg-white px-5 py-3 text-lg font-bold">Close</button>
        </div>
        <BrowseAll model={model} onPick={choose} />
      </div>
    </div>}
  </div>
}

/** Full-screen QR code that opens this one route on a visitor's phone, valid for a limited time. */
function PhoneQrDialog({ destination, stepFree, openedAt, onClose }) {
  const url = phoneRouteUrl(destination, { stepFree, now: openedAt })
  useEffect(() => {
    const close = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose} role="presentation">
    <div role="dialog" aria-modal="true" aria-label="Scan to take this route on your phone" onClick={(event) => event.stopPropagation()}
      className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border-[3px] border-ink-900 bg-white p-8 text-center shadow-[8px_8px_0_0_#160f0f]">
      <p className="text-2xl font-black text-ink-900">Scan with your phone camera</p>
      <div className="rounded-xl border-[3px] border-ink-900 bg-white p-3"><QRCodeSVG value={url} size={280} marginSize={1} title={`Route to ${destination.name}`} /></div>
      <p className="text-lg leading-7 text-slate-600">Your phone will show the route from here to <span className="font-bold text-ink-900">{destination.name}</span>. It works for {PHONE_LINK_MINUTES} minutes.</p>
      {/^(localhost|127\.)/.test(new URL(url).hostname) && <p className="text-sm font-semibold text-amber-700">Setup: phones cannot open “localhost”. Set VITE_NAVIKA_BASE_URL to this computer's network address.</p>}
      <button type="button" onClick={onClose} className="w-full rounded-xl border-[3px] border-ink-900 bg-ink-900 px-5 py-4 text-xl font-bold text-white">Done</button>
    </div>
  </div>
}

function RouteView({ model, destination, onBack, onThanks }) {
  const [stepFree, setStepFree] = useState(false)
  // When the QR dialog was opened; the phone link's time limit starts then.
  const [qrOpenedAt, setQrOpenedAt] = useState(null)
  const route = useMemo(() => routeFromKiosk(model, destination, { stepFree }), [model, destination, stepFree])
  if (!route && stepFree) return <div className="space-y-4 rounded-2xl border-[3px] border-ink-900 bg-amber-50 p-6">
    <p className="text-xl font-bold text-amber-900">No lift goes to {destination.name}.</p>
    <p className="text-lg text-amber-900">It can only be reached by stairs. Please ask at reception for help.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => setStepFree(false)} className="rounded-xl border-[3px] border-ink-900 bg-ink-900 px-5 py-3 text-lg font-bold text-white">Show the route with stairs</button>
      <button type="button" onClick={onBack} className="flex items-center gap-2 rounded-xl border-[3px] border-ink-900 bg-white px-5 py-3 text-lg font-bold"><ArrowLeft className="h-5 w-5" />Choose another place</button>
    </div>
  </div>
  if (!route) return <div className="space-y-4"><button type="button" onClick={onBack} className="flex items-center gap-2 rounded-xl border-[3px] border-ink-900 bg-white px-5 py-3 text-lg font-bold"><ArrowLeft className="h-5 w-5" />Choose another place</button><p className="text-lg">Sorry, no walking route to {destination.name} was found.</p></div>

  const scene = routeScene(model, route, destination)

  // Sized to the screen so the kiosk never needs scrolling: only the step list scrolls.
  return <div className="flex h-[calc(100dvh-10rem)] min-h-[520px] flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" onClick={onBack} className="mr-auto flex items-center gap-2 rounded-xl border-[3px] border-ink-900 bg-white px-5 py-3 text-lg font-bold text-ink-900 hover:bg-brand-100"><ArrowLeft className="h-5 w-5" />Choose another place</button>
      <button type="button" onClick={() => setStepFree((value) => !value)} aria-pressed={stepFree}
        className={`flex items-center gap-2 rounded-xl border-[3px] border-ink-900 px-5 py-3 text-base font-bold ${stepFree ? 'bg-blue-600 text-white' : 'bg-white text-ink-900 hover:bg-brand-100'}`}>
        <Accessibility className="h-5 w-5" />Lifts only
      </button>
      <ThankYouButton onClick={onThanks} />
    </div>
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(320px,1fr)_2fr]">
      <section className="flex min-h-0 flex-col gap-3 rounded-2xl border-[3px] border-ink-900 bg-white p-5 shadow-[5px_5px_0_0_#160f0f]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">From reception to</p>
          <h2 className="text-3xl font-black leading-tight text-ink-900">{destination.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 text-lg font-semibold text-slate-600">
            <span>{destination.floorName}</span>
            <span className="flex items-center gap-1 whitespace-nowrap"><Footprints className="h-5 w-5 text-brand-500" />{Math.round(route.distanceM)} m</span>
            <span className="flex items-center gap-1 whitespace-nowrap"><Clock className="h-5 w-5 text-brand-500" />{formatDuration(route.durationS)}</span>
          </p>
        </div>
        <p className="rounded-xl border-[3px] border-ink-900 bg-blue-50 p-4 text-lg font-semibold leading-7 text-blue-950">{routeSummary(route, destination)}</p>
        <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-label="Step-by-step directions">
          {route.steps.map((step, index) => {
            const newFloor = index === 0 || step.floor !== route.steps[index - 1].floor
            const last = index === route.steps.length - 1
            return <li key={index}>
              {newFloor && route.legs.length > 1 && <p className="mb-2 mt-1 text-sm font-bold uppercase tracking-widest text-slate-500">{floorName(step.floor)}</p>}
              <div className="flex gap-3 text-lg leading-7">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base font-bold text-white ${last ? 'bg-brand-500' : step.transition ? 'bg-violet-600' : 'bg-ink-900'}`}>
                  {step.transition?.kind === 'entrance' || step.transition?.kind === 'bridge' ? <DoorOpen className="h-5 w-5" /> : step.transition ? (goesUp(step.transition) ? <ArrowUp className="h-5 w-5" /> : <ArrowDown className="h-5 w-5" />) : index + 1}
                </span>
                <span className={step.transition ? 'font-semibold text-violet-800' : ''}>{step.text}</span>
              </div>
            </li>
          })}
        </ol>
        <button type="button" onClick={() => setQrOpenedAt(Date.now())}
          className="flex items-center justify-center gap-3 rounded-xl border-[3px] border-ink-900 bg-brand-500 px-5 py-4 text-xl font-bold text-white shadow-[4px_4px_0_0_#160f0f] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_#160f0f] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
          <QrCode className="h-7 w-7" />Send to my phone
        </button>
      </section>
      <section className="min-h-[360px] overflow-hidden rounded-2xl border-[3px] border-ink-900 shadow-[5px_5px_0_0_#160f0f]">
        <MGeorgeBuilding3D model={model} floors={scene.floors} labelFloors={destination.floor === SITE ? [] : [destination.floor]} route={route} destination={destination}
          showSite={scene.outside} focus={scene.focus} />
      </section>
    </div>
    {qrOpenedAt !== null && <PhoneQrDialog destination={destination} stepFree={stepFree} openedAt={qrOpenedAt} onClose={() => setQrOpenedAt(null)} />}
  </div>
}

/** The buildings with some of the campus around them; all the paths when there are no buildings. */
function campusBounds(model, margin = 45) {
  const points = (model.massing?.buildings ?? []).flatMap((building) => building.storeys.flatMap((storey) => storey.parts.flatMap((part) => part.outer)))
  if (!points.length) return siteBounds(model.site)
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  return { minX: Math.min(...xs) - margin, maxX: Math.max(...xs) + margin, minY: Math.min(...ys) - margin, maxY: Math.max(...ys) + margin }
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

const THANKS_MS = 2500

/** Ends this visitor's turn: the kiosk thanks them and resets for the next person. */
function ThankYouButton({ onClick }) {
  return <button type="button" onClick={onClick}
    className="flex shrink-0 items-center gap-2 rounded-xl border-[3px] border-ink-900 bg-emerald-500 px-6 py-3 text-xl font-bold text-white shadow-[3px_3px_0_0_#160f0f] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_#160f0f]">
    <Smile className="h-7 w-7" />Thank you
  </button>
}

export default function MGeorgeKioskNavigation() {
  const [model, setModel] = useState(null)
  const [error, setError] = useState('')
  const [destination, setDestination] = useState(null)
  // The place last looked at, so "Choose another place" returns to it on the map.
  const [lastPlace, setLastPlace] = useState(null)
  // A new visitor (Thank you, or the idle timeout) starts a new session: everything resets.
  const [session, setSession] = useState(0)
  const [thanks, setThanks] = useState(false)
  const reset = () => {
    setDestination(null)
    setLastPlace(null)
    setSession((value) => value + 1)
  }
  useIdleReset(reset)

  useEffect(() => {
    if (!thanks) return undefined
    const timer = setTimeout(() => {
      setThanks(false)
      reset()
    }, THANKS_MS)
    return () => clearTimeout(timer)
  }, [thanks])

  useEffect(() => {
    loadBuilding().then((loaded) => {
      setModel(loaded)
      // ?to=<destination id> opens a route directly (assistant hand-off, QR links).
      const requested = new URLSearchParams(window.location.search).get('to')
      setDestination(loaded.destinations.find((place) => place.id === requested) || null)
    }).catch((reason) => setError(reason.message))
  }, [])

  if (error) return <div className="rounded-2xl border-[3px] border-ink-900 bg-red-50 p-8 text-lg text-red-800">{error}</div>
  if (!model) return <div className="rounded-2xl border-[3px] border-ink-900 bg-white p-8 text-lg text-slate-600">Loading the campus map…</div>

  const route = (place) => {
    setLastPlace(place)
    setDestination(place)
  }
  return <div className="relative space-y-3">
    {destination
      ? <RouteView key={destination.id} model={model} destination={destination} onBack={() => setDestination(null)} onThanks={() => setThanks(true)} />
      : <KioskHome key={session} model={model} lastPlace={lastPlace} onRoute={route} onThanks={() => setThanks(true)} />}
    {thanks && <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white/95 text-center">
      <Smile className="h-20 w-20 text-emerald-600" />
      <p className="text-5xl font-black text-ink-900">Thank you for visiting MITS!</p>
      <p className="text-2xl text-slate-600">Have a wonderful day.</p>
    </div>}
  </div>
}
