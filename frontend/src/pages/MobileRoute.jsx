import { MapPinned, Navigation, Route } from 'lucide-react'
import Map2D from '../components/navigation/Map2D'
import { demoMap, demoRoute } from '../data/demoMap'
import Button from '../components/common/Button'

export default function MobileRoute() {
  const params = new URLSearchParams(window.location.search)
  const route = {
    ...demoRoute,
    source: params.get('source') || demoRoute.source,
    destination: params.get('destination') || demoRoute.destination,
  }

  return (
    <div className="min-h-screen bg-white px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-md rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="mb-4 text-center">
          <div className="text-3xl font-black tracking-tight text-slate-900">NAVIKA</div>
          <div className="mt-2 text-xs uppercase tracking-[0.28em] text-brand-500">Indoor Route</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400"><MapPinned className="h-4 w-4" /> FROM</div>
          <div className="mt-2 text-xl font-semibold text-slate-900">{route.source || 'Main Entrance'}</div>
          <div className="mt-5 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400"><Navigation className="h-4 w-4" /> TO</div>
          <div className="mt-2 text-xl font-semibold text-slate-900">{route.destination || 'CSE Department'}</div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-brand-500"><Route className="h-4 w-4" /> Route</div>
          <Map2D route={route} nodes={demoMap.nodes} source={route.source} destination={route.destination} />
          <ol className="space-y-3 text-sm text-slate-700">
            {route.steps.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-500">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Distance</span>
            <span className="text-slate-900">{route.distance} map units</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Floor changes</span>
            <span className="text-slate-900">{route.floor_changes}</span>
          </div>
        </div>

        <div className="mt-6">
          <Button className="w-full rounded-2xl py-3 text-base">VIEW MAP</Button>
        </div>
      </div>
    </div>
  )
}
