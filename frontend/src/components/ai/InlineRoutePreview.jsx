import { useEffect, useMemo, useState } from 'react'
import MGeorgeBuilding3D from '../navigation/MGeorgeBuilding3D'
import { floorName, formatDuration, loadBuilding, routeFromKiosk, routeScene, routeSummary, SITE } from '../../services/mgeorgeRoute'

export default function InlineRoutePreview({ placeId, onOpenFullRoute }) {
  const [model, setModel] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    loadBuilding()
      .then((loaded) => { if (active) setModel(loaded) })
      .catch((reason) => { if (active) setError(reason.message || 'The campus map could not be loaded.') })
    return () => { active = false }
  }, [])

  const destination = model?.destinations.find((place) => place.id === placeId)
  const route = useMemo(() => model && destination ? routeFromKiosk(model, destination) : null, [model, destination])
  const scene = useMemo(() => model && route && destination ? routeScene(model, route, destination) : null, [model, route, destination])

  if (error) return <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">The location matched, but the route map could not be loaded. Open Navigation to try the full map.</p>
  if (!model) return <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-600">Loading the route…</p>
  if (!destination || !route || !scene) return <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">No verified walking route is available for this destination yet.</p>

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label={`Route to ${destination.name}`}>
      <div className="p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-bold text-slate-900">Route to {destination.name}</h3>
          <span className="text-xs font-semibold text-slate-500">{floorName(destination.floor)} · {Math.round(route.distanceM)} m · {formatDuration(route.durationS)}</span>
        </div>
        <p className="mt-1 text-sm leading-5 text-slate-700">{routeSummary(route, destination)}</p>
      </div>
      <div className="h-56 border-y border-slate-200 bg-[#202025]">
        <MGeorgeBuilding3D
          model={model}
          floors={scene.floors}
          labelFloors={destination.floor === SITE ? [] : [destination.floor]}
          route={route}
          destination={destination}
          showSite={scene.outside}
          focus={scene.focus}
        />
      </div>
      <details className="border-b border-slate-200 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">Step-by-step directions</summary>
        <ol className="mt-2 max-h-36 list-decimal space-y-1 overflow-y-auto pl-5 text-sm text-slate-700">
          {route.steps.map((step, index) => <li key={`${index}-${step.floor}`}>{step.text}</li>)}
        </ol>
      </details>
      <button type="button" onClick={() => onOpenFullRoute?.(destination.id)} className="w-full px-3 py-2 text-left text-sm font-semibold text-brand-600 hover:bg-brand-50">
        Open full navigation view
      </button>
    </section>
  )
}
