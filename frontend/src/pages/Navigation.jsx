import { lazy, Suspense, useState } from 'react'
import { Building2, Layers3 } from 'lucide-react'
import MultiFloorNavigation3D from '../components/navigation/MultiFloorNavigation3D'
import MGeorgeKioskNavigation from '../components/navigation/MGeorgeKioskNavigation'

const CampusSite3D = lazy(() => import('../components/navigation/CampusSite3D'))
const MGeorgeBlock3D = lazy(() => import('../components/navigation/MGeorgeBlock3D'))

// The kiosk route finder is the default. The earlier visualisations stay
// reachable for development with ?view=indoor|mgeorge|campus.
const DEV_VIEWS = ['indoor', 'mgeorge', 'campus']

export default function NavigationPage() {
  const [view, setView] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('view')
    return DEV_VIEWS.includes(requested) ? requested : 'kiosk'
  })
  if (view === 'kiosk') return <MGeorgeKioskNavigation />
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-[3px] border-ink-900 bg-white p-3 shadow-[4px_4px_0_0_#160f0f]">
      <div><p className="text-sm font-bold text-ink-900">Navigation map</p><p className="text-xs text-slate-500">Switch between Ramanujan, M. George Block, and the campus site plan.</p></div>
      <div className="flex gap-2" role="group" aria-label="Navigation map scope">
        <button type="button" onClick={() => setView('indoor')} className={`rounded-lg border-[3px] border-ink-900 px-4 py-2 text-sm font-bold ${view === 'indoor' ? 'bg-ink-900 text-white' : 'bg-white text-ink-900 hover:bg-brand-100'}`}><Layers3 className="mr-2 inline h-4 w-4" />Ramanujan indoor</button>
        <button type="button" onClick={() => setView('mgeorge')} className={`rounded-lg border-[3px] border-ink-900 px-4 py-2 text-sm font-bold ${view === 'mgeorge' ? 'bg-ink-900 text-white' : 'bg-white text-ink-900 hover:bg-brand-100'}`}><Building2 className="mr-2 inline h-4 w-4" />M. George indoor</button>
        <button type="button" onClick={() => setView('campus')} className={`rounded-lg border-[3px] border-ink-900 px-4 py-2 text-sm font-bold ${view === 'campus' ? 'bg-ink-900 text-white' : 'bg-white text-ink-900 hover:bg-brand-100'}`}><Building2 className="mr-2 inline h-4 w-4" />Campus outdoor</button>
      </div>
    </div>
    {view === 'indoor' ? <MultiFloorNavigation3D /> : view === 'mgeorge' ? <Suspense fallback={<div className="rounded-xl border-[3px] border-ink-900 bg-white p-8 text-sm text-slate-600">Loading M. George Block DXF visualization…</div>}><MGeorgeBlock3D /></Suspense> : <Suspense fallback={<div className="rounded-xl border-[3px] border-ink-900 bg-white p-8 text-sm text-slate-600">Loading campus DXF visualization…</div>}><CampusSite3D onOpenRamanujan={() => setView('indoor')} /></Suspense>}
  </div>
}
