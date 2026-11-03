import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleCheck, Clock, DoorOpen, Footprints, MapPin, Navigation, TimerOff } from 'lucide-react'
import MGeorgeBuilding3D from '../components/navigation/MGeorgeBuilding3D'
import { SITE, floorName, formatDuration, goesUp, loadBuilding, readPhoneLink, routeBounds, routeFromKiosk, routeScene, routeSummary, stepStretch } from '../services/mgeorgeRoute'

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

function Notice({ icon: Icon, title, children }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
    <Icon className="h-14 w-14 text-brand-500" />
    <h1 className="text-2xl font-black text-slate-900">{title}</h1>
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
  const route = useMemo(() => (model && destination ? routeFromKiosk(model, destination, { stepFree: link.stepFree }) : null), [model, destination, link])

  if (!link) return <Notice icon={TimerOff} title="This link is not complete">Please scan the QR code on the NAVIKA kiosk again.</Notice>
  if (ended) return <Notice icon={CircleCheck} title="You have arrived">Navigation has ended. For another place, scan a new QR code at the NAVIKA kiosk.</Notice>
  if (expired) return <Notice icon={TimerOff} title="This route has expired">Routes stay open for a limited time. Please scan the QR code at the NAVIKA kiosk again.</Notice>
  if (error) return <Notice icon={TimerOff} title="Could not load the map">{error}</Notice>
  if (!model) return <Notice icon={Navigation} title="Loading your route…" />
  if (!destination || !route) return <Notice icon={TimerOff} title="Route not found">This place is no longer on the map. Please ask at reception.</Notice>

  // Overview: the whole route. Walking: only the floors of the current step, the camera following it.
  const scene = walking ? stepScene(model, route, stepIndex) : routeScene(model, route, destination)
  const minutesLeft = Math.max(1, Math.ceil((link.expiresAt - now) / 60_000))
  const step = walking ? route.steps[stepIndex] : null
  const lastStep = walking && stepIndex === route.steps.length - 1
  const stop = () => {
    saveEnded(link)
    setEnded(true)
  }

  return <div className="flex min-h-screen flex-col bg-white text-slate-900">
    <header className="space-y-1 border-b border-slate-200 px-4 pb-3 pt-4">
      <p className="text-sm text-slate-500">From <span className="font-semibold text-slate-700">Reception kiosk, M. George Block</span></p>
      <h1 className="text-2xl font-black leading-tight">{destination.name}</h1>
      <p className="flex flex-wrap items-center gap-x-3 text-base text-slate-600">
        <span>{destination.floorName}</span>
        <span className="flex items-center gap-1"><Footprints className="h-4 w-4" />{Math.round(route.distanceM)} m</span>
        <span className="flex items-center gap-1"><Clock className="h-4 w-4" />{formatDuration(route.durationS)}</span>
      </p>
    </header>

    <section className="h-[46vh] min-h-[300px] border-b border-slate-200">
      <MGeorgeBuilding3D model={model} floors={scene.floors} labelFloors={walking ? scene.floors : destination.floor === SITE ? [] : [destination.floor]} route={route}
        destination={destination} showSite={scene.outside} focus={scene.focus} follow={scene.follow} />
    </section>

    <main className="flex flex-1 flex-col gap-4 px-4 py-4">
      {!walking
        ? <>
          <p className="rounded-2xl bg-blue-50 p-4 text-lg font-semibold leading-7 text-blue-950">{routeSummary(route, destination)}</p>
          <ol className="space-y-2 text-base leading-6">
            {route.steps.map((item, index) => <li key={index} className="flex gap-3">
              <span className="w-6 shrink-0 text-right font-bold text-slate-400">{index + 1}</span>
              <span className={item.transition ? 'font-semibold text-violet-800' : ''}>{item.text}</span>
            </li>)}
          </ol>
          <button type="button" onClick={() => setStepIndex(0)} className="mt-auto flex items-center justify-center gap-2 rounded-2xl bg-brand-500 px-5 py-4 text-xl font-bold text-white">
            <Navigation className="h-6 w-6" />Start
          </button>
        </>
        : <>
          <p className="text-sm font-bold uppercase tracking-widest text-slate-500">Step {stepIndex + 1} of {route.steps.length} · {floorName(step.floor)}</p>
          <div className="flex gap-4 rounded-2xl bg-slate-50 p-4">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${lastStep ? 'bg-brand-500' : step.transition ? 'bg-violet-600' : 'bg-slate-900'}`}>
              <StepIcon step={step} last={lastStep} />
            </span>
            <p className="text-xl font-semibold leading-8">{step.text}</p>
          </div>
          <div className="mt-auto space-y-3">
            {lastStep
              ? <button type="button" onClick={stop} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-4 text-xl font-bold text-white">
                <CircleCheck className="h-6 w-6" />I have arrived · Stop
              </button>
              : <button type="button" onClick={() => setStepIndex(stepIndex + 1)} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-4 text-xl font-bold text-white">
                Next step<ArrowRight className="h-6 w-6" />
              </button>}
            <button type="button" onClick={() => setStepIndex(stepIndex === 0 ? null : stepIndex - 1)} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 px-5 py-3 text-lg font-semibold text-slate-700">
              <ArrowLeft className="h-5 w-5" />{stepIndex === 0 ? 'Back to overview' : 'Previous step'}
            </button>
          </div>
        </>}
      <p className="text-center text-sm text-slate-500">This route link works for about {minutesLeft} more min.</p>
    </main>
  </div>
}
