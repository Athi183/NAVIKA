import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleCheck, Clock, DoorOpen, Download, Flag, Footprints, LocateFixed, LocateOff, MapPin, Navigation, Route, TimerOff } from 'lucide-react'
import MGeorgeBuilding3D from '../components/navigation/MGeorgeBuilding3D'
import { useIndoorTracking } from '../hooks/useIndoorTracking'
import { SITE, floorName, formatDuration, goesUp, latLonToMap, loadBuilding, locateOnRoute, readPhoneLink, routeBounds, routeFrom, routeFromKiosk, routeScene, routeSummary, siteStart, stepStretch, storeyName } from '../services/mgeorgeRoute'

// Phone view of one route handed off from the kiosk by QR code. There is no
// place picker and no other source: only the scanned route, until it expires
// or the visitor stops it.

const endedKey = (link) => `navika-route-ended:${link.to}:${link.expiresAt}`

function readEnded(link) {
  try {
    return localStorage.getItem(endedKey(link)) === '1'
  } catch {
    return false
  }
}

function saveEnded(link) {
  try {
    localStorage.setItem(endedKey(link), '1')
  } catch {
    // Private mode or blocked storage: the stop still applies to this visit.
  }
}

/** Current time, refreshed every 15 s, for the expiry countdown. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** Keeps the phone screen on while the visitor is walking. */
function useWakeLock(active) {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return undefined
    let lock = null
    let released = false
    navigator.wakeLock.request('screen').then((sentinel) => {
      if (released) sentinel.release()
      else lock = sentinel
    }).catch(() => {})
    return () => {
      released = true
      lock?.release().catch(() => {})
    }
  }, [active])
}

// Outdoors only: inside buildings phone GPS is tens of metres off and has no floor.
const GOOD_FIX_M = 25   // fixes less precise than this never move the steps on
const ON_ROUTE_M = 15   // this close to a later step's path, the visitor has reached it
const OFF_ROUTE_M = 25  // further than this from the path (and the fix's own error), they have left it

/** Live GPS while `active`, in map metres: { status, xy, accuracy }. Needs https. */
function useLiveLocation(active, osm) {
  const [fix, setFix] = useState({ status: 'waiting' })
  useEffect(() => {
    if (!active || !window.isSecureContext || !navigator.geolocation || !osm) return undefined
    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => setFix({ status: 'ok', lat: coords.latitude, lon: coords.longitude, xy: latLonToMap(osm, coords.latitude, coords.longitude), accuracy: coords.accuracy }),
      // A timeout only means no fix yet; the watch keeps trying.
      (error) => setFix((current) => (error.code === error.TIMEOUT ? current : { status: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable' })),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 })
    return () => navigator.geolocation.clearWatch(watch)
  }, [active, osm])
  if (!active) return { status: 'off' }
  if (!window.isSecureContext) return { status: 'insecure' }
  if (!navigator.geolocation || !osm) return { status: 'unavailable' }
  return fix
}

function LocationStatus({ fix }) {
  const text = {
    waiting: 'Finding your location…',
    ok: fix.accuracy > GOOD_FIX_M ? `Weak GPS signal (±${Math.round(fix.accuracy)} m). Tap Next step as you walk.` : `Live location on (±${Math.round(fix.accuracy)} m). Steps move on as you walk.`,
    denied: 'Location is off. Tap Next step as you walk.',
    unavailable: 'Live location is not available. Tap Next step as you walk.',
    insecure: 'Live location needs the https link. Tap Next step as you walk.',
  }[fix.status]
  if (!text) return null
  const live = fix.status === 'ok' && fix.accuracy <= GOOD_FIX_M
  return <p className={`flex items-center gap-2 text-sm font-semibold ${live ? 'text-blue-700' : 'text-slate-500'}`}>
    {live ? <LocateFixed className="h-4 w-4" /> : <LocateOff className="h-4 w-4" />}{text}
  </p>
}

function MotionStatus({ status, stats }) {
  const text = {
    on: `Tracking your steps (stride ${stats.stride.toFixed(2)} m${stats.learned ? ', learned outside' : ''}). Steps move on as you walk.`,
    nodata: 'This phone has no motion sensors. Tap Next step as you walk.',
    unavailable: 'Motion sensors are not available. Tap Next step as you walk.',
    denied: 'Motion sensors are off. Tap Next step as you walk.',
    insecure: 'Step tracking needs the https link. Tap Next step as you walk.',
  }[status]
  if (!text) return null
  return <p className={`flex items-center gap-2 text-sm font-semibold ${status === 'on' ? 'text-blue-700' : 'text-slate-500'}`}>
    <Footprints className="h-4 w-4" />{text}
  </p>
}

/** On stairs, lifts, the bridge and the entrance, the visitor confirms they are through. */
function nextLabel(step) {
  const transition = step.transition
  if (!transition) return 'Next step'
  if (transition.kind === 'entrance') return transition.toFloor === SITE ? "I'm outside" : "I'm inside"
  if (transition.kind === 'bridge') return "I've crossed the bridge"
  return `I'm on the ${storeyName(transition.toFloor)}`
}

/** Research mode: what is being recorded, numbered spot marks, and saving the walk. */
function ResearchPanel({ tracking }) {
  const { stats } = tracking
  return <div className="space-y-2 rounded-xl border-[3px] border-dashed border-violet-700 bg-violet-50 p-3">
    <p className="text-sm font-bold text-violet-900">Research mode · recording · {stats.steps} steps · {stats.turns} turns · {stats.marks} spots marked</p>
    <div className="flex gap-2">
      <button type="button" onClick={tracking.mark} className="flex flex-1 items-center justify-center gap-2 rounded-lg border-[2px] border-ink-900 bg-white px-3 py-2 font-bold">
        <Flag className="h-4 w-4" />Mark spot {stats.marks + 1}
      </button>
      <button type="button" onClick={tracking.save} className="flex flex-1 items-center justify-center gap-2 rounded-lg border-[2px] border-ink-900 bg-white px-3 py-2 font-bold">
        <Download className="h-4 w-4" />Save log
      </button>
    </div>
  </div>
}

function Notice({ icon: Icon, title, children }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cream-50 px-6 text-center">
    <Icon className="h-14 w-14 text-brand-500" />
    <h1 className="text-2xl font-black text-ink-900">{title}</h1>
    <div className="max-w-sm text-lg leading-7 text-slate-600">{children}</div>
  </div>
}

function StepIcon({ step, last }) {
  if (last) return <MapPin className="h-6 w-6" />
  if (step.transition?.kind === 'entrance' || step.transition?.kind === 'bridge') return <DoorOpen className="h-6 w-6" />
  if (step.transition) return goesUp(step.transition) ? <ArrowUp className="h-6 w-6" /> : <ArrowDown className="h-6 w-6" />
  return <Footprints className="h-6 w-6" />
}

/** What the 3D view shows for one step: its floors and the stretch to follow. */
function stepScene(model, route, index) {
  const follow = stepStretch(route, index)
  const outside = follow.some((point) => point.floor === SITE)
  const indoor = [...new Set(follow.map((point) => point.floor).filter((floor) => floor !== SITE))]
  // Outside, the campus paths sit at the entrance floor's level.
  if (outside && !indoor.length) indoor.push(model.site.level_floor)
  return { floors: indoor, outside, follow, focus: routeBounds(follow.map((point) => point.xy), 20, 4) }
}

export default function PhoneRoute() {
  const link = useMemo(() => readPhoneLink(window.location.search), [])
  // `&research=1` on the link records the walk for the indoor tracking study.
  const research = useMemo(() => new URLSearchParams(window.location.search).get('research') === '1', [])
  const now = useNow()
  const [model, setModel] = useState(null)
  const [error, setError] = useState('')
  const [stepIndex, setStepIndex] = useState(null) // null until the visitor taps Start
  const [ended, setEnded] = useState(() => (link ? readEnded(link) : false))
  const expired = link ? now >= link.expiresAt : false
  const walking = stepIndex !== null && !ended && !expired
  useWakeLock(walking)

  useEffect(() => {
    if (!link || ended || expired) return
    loadBuilding().then(setModel).catch((reason) => setError(reason.message))
  }, [link, ended, expired])

  const destination = model?.destinations.find((place) => place.id === link?.to)
  // null: from the kiosk; else where the visitor asked to re-route from (siteStart).
  const [start, setStart] = useState(null)
  const route = useMemo(() => {
    if (!model || !destination) return null
    return start ? routeFrom(model, start, destination, { stepFree: link.stepFree }) : routeFromKiosk(model, destination, { stepFree: link.stepFree })
  }, [model, destination, link, start])

  // Live location on the route's outdoor parts: moves the steps on, and notices a wrong turn.
  const outdoors = Boolean(route?.legs.some((leg) => leg.floor === SITE))
  const fix = useLiveLocation(walking && outdoors, model?.osm)
  const goodFix = fix.status === 'ok' && fix.accuracy <= GOOD_FIX_M
  const here = useMemo(() => (goodFix && route ? locateOnRoute(route, fix.xy) : null), [goodFix, route, fix.xy])
  // Reaching a later step's path moves the steps on, once per step reached, so
  // Previous still works afterwards.
  const reachedStep = here && here.offM <= Math.max(ON_ROUTE_M, fix.accuracy) ? here.stepIndex : null
  const [lastReached, setLastReached] = useState(null)
  if (reachedStep !== lastReached) {
    setLastReached(reachedStep)
    if (reachedStep !== null && stepIndex !== null && reachedStep > stepIndex) setStepIndex(reachedStep)
  }
  const offRoute = Boolean(here && walking && route.steps[stepIndex]?.floor === SITE && here.offM > Math.max(OFF_ROUTE_M, fix.accuracy * 1.5))
  // Outside, the dot sits on the path while the visitor follows it, and where GPS puts them once they leave it.
  const gpsDot = fix.status === 'ok' ? { floor: SITE, xy: here && !offRoute ? here.xy : fix.xy, accuracy: fix.accuracy } : null
  // Inside, the phone's steps and turns move the visitor along the route; outside, GPS teaches the stride.
  const tracking = useIndoorTracking({ active: walking, route, stepIndex, onReachStep: setStepIndex, research, destination, geo: model?.osm?.geo })
  const { observeOutdoor, logGps } = tracking
  const onOutdoorPath = Boolean(here && !offRoute && route?.steps[stepIndex]?.floor === SITE)
  useEffect(() => { observeOutdoor(onOutdoorPath ? here.xy : null) }, [observeOutdoor, onOutdoorPath, here])
  useEffect(() => {
    if (fix.status === 'ok') logGps({ t: performance.now(), lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy })
  }, [logGps, fix.status, fix.lat, fix.lon, fix.accuracy])
  const rerouteFromHere = () => {
    const from = siteStart(model, fix.xy)
    if (!from) return
    setStart(from)
    setStepIndex(0)
  }

  if (!link) return <Notice icon={TimerOff} title="This link is not complete">Please scan the QR code on the NAVIKA kiosk again.</Notice>
  if (ended) return <Notice icon={CircleCheck} title="You have arrived">Navigation has ended. For another place, scan a new QR code at the NAVIKA kiosk.</Notice>
  if (expired) return <Notice icon={TimerOff} title="This route has expired">Routes stay open for a limited time. Please scan the QR code at the NAVIKA kiosk again.</Notice>
  if (error) return <Notice icon={TimerOff} title="Could not load the map">{error}</Notice>
  if (!model) return <Notice icon={Navigation} title="Loading your route…" />
  if (!destination || !route) return <Notice icon={TimerOff} title="Route not found">This place is no longer on the map. Please ask at reception.</Notice>

  // Overview: the whole route. Walking: only the floors of the current step, the camera following it.
  const stepView = walking ? stepScene(model, route, stepIndex) : routeScene(model, route, destination)
  // Off the path: stop following and frame both the step and the visitor, so they can see the way back.
  const scene = offRoute ? { ...stepView, follow: null, focus: routeBounds([...stepView.follow.map((point) => point.xy), gpsDot.xy], 20, 8) } : stepView
  const minutesLeft = Math.max(1, Math.ceil((link.expiresAt - now) / 60_000))
  const step = walking ? route.steps[stepIndex] : null
  const lastStep = walking && stepIndex === route.steps.length - 1
  const stop = () => {
    saveEnded(link)
    setEnded(true)
  }

  return <div className="flex min-h-screen flex-col bg-cream-50 text-ink-900">
    <header className="space-y-1 border-b-[3px] border-ink-900 bg-white px-4 pb-3 pt-4">
      <p className="text-sm text-slate-500">From <span className="font-semibold text-slate-700">{start ? 'where you re-routed' : 'Reception kiosk, M. George Block'}</span></p>
      <h1 className="text-2xl font-black leading-tight">{destination.name}</h1>
      <p className="flex flex-wrap items-center gap-x-3 text-base text-slate-600">
        <span>{destination.floorName}</span>
        <span className="flex items-center gap-1"><Footprints className="h-4 w-4" />{Math.round(route.distanceM)} m</span>
        <span className="flex items-center gap-1"><Clock className="h-4 w-4" />{formatDuration(route.durationS)}</span>
      </p>
    </header>

    <section className="h-[46vh] min-h-[300px] border-b-[3px] border-ink-900">
      <MGeorgeBuilding3D key={offRoute ? 'off-route' : 'on-route'} model={model} floors={scene.floors} labelFloors={walking ? scene.floors : destination.floor === SITE ? [] : [destination.floor]} route={route}
        destination={destination} showSite={scene.outside} focus={scene.focus} follow={scene.follow} live={tracking.position ?? gpsDot} />
    </section>

    <main className="flex flex-1 flex-col gap-4 px-4 py-4">
      {!walking
        ? <>
          <p className="rounded-xl border-[3px] border-ink-900 bg-blue-50 p-4 text-lg font-semibold leading-7 text-blue-950">{routeSummary(route, destination)}</p>
          <ol className="space-y-2 text-base leading-6">
            {route.steps.map((item, index) => <li key={index} className="flex gap-3">
              <span className="w-6 shrink-0 text-right font-bold text-slate-400">{index + 1}</span>
              <span className={item.transition ? 'font-semibold text-violet-800' : ''}>{item.text}</span>
            </li>)}
          </ol>
          <button type="button" onClick={async () => { await tracking.requestAccess(); setStepIndex(0) }} className="mt-auto flex items-center justify-center gap-2 rounded-xl border-[3px] border-ink-900 bg-brand-500 px-5 py-4 text-xl font-bold text-white shadow-[4px_4px_0_0_#160f0f] transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
            <Navigation className="h-6 w-6" />Start
          </button>
        </>
        : <>
          <p className="text-sm font-bold uppercase tracking-widest text-slate-500">Step {stepIndex + 1} of {route.steps.length} · {floorName(step.floor)}</p>
          <div className="flex gap-4 rounded-xl border-[3px] border-ink-900 bg-white p-4">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${lastStep ? 'bg-brand-500' : step.transition ? 'bg-violet-600' : 'bg-ink-900'}`}>
              <StepIcon step={step} last={lastStep} />
            </span>
            <p className="text-xl font-semibold leading-8">{step.text}</p>
          </div>
          {step.floor === SITE ? outdoors && <LocationStatus fix={fix} /> : !step.transition && <MotionStatus status={tracking.status} stats={tracking.stats} />}
          {research && <ResearchPanel tracking={tracking} />}
          {offRoute && <div role="alert" className="space-y-3 rounded-xl border-[3px] border-ink-900 bg-amber-50 p-4">
            <p className="text-lg font-bold text-amber-900">You seem to be off the path (about {Math.round(here.offM)} m away).</p>
            <button type="button" onClick={rerouteFromHere} className="flex w-full items-center justify-center gap-2 rounded-xl border-[3px] border-ink-900 bg-white px-4 py-3 text-lg font-bold text-ink-900">
              <Route className="h-5 w-5" />Re-route from here
            </button>
          </div>}
          <div className="mt-auto space-y-3">
            {lastStep
              ? <button type="button" onClick={stop} className="flex w-full items-center justify-center gap-2 rounded-xl border-[3px] border-ink-900 bg-red-500 px-5 py-4 text-xl font-bold text-white shadow-[4px_4px_0_0_#160f0f] transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
                <CircleCheck className="h-6 w-6" />I have arrived · Stop
              </button>
              : <button type="button" onClick={() => setStepIndex(stepIndex + 1)} className="flex w-full items-center justify-center gap-2 rounded-xl border-[3px] border-ink-900 bg-ink-900 px-5 py-4 text-xl font-bold text-white shadow-[4px_4px_0_0_#160f0f] transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
                {nextLabel(step)}<ArrowRight className="h-6 w-6" />
              </button>}
            <button type="button" onClick={() => setStepIndex(stepIndex === 0 ? null : stepIndex - 1)} className="flex w-full items-center justify-center gap-2 rounded-xl border-[3px] border-ink-900 bg-white px-5 py-3 text-lg font-bold text-ink-900">
              <ArrowLeft className="h-5 w-5" />{stepIndex === 0 ? 'Back to overview' : 'Previous step'}
            </button>
          </div>
        </>}
      <p className="text-center text-sm text-slate-500">This route link works for about {minutesLeft} more min.</p>
    </main>
  </div>
}
