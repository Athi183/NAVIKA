import { lazy, Suspense, useState } from 'react'
import { Building2, Layers3 } from 'lucide-react'
import MultiFloorNavigation3D from '../components/navigation/MultiFloorNavigation3D'

const CampusSite3D = lazy(() => import('../components/navigation/CampusSite3D'))

export default function NavigationPage() {
  const [view, setView] = useState(() => new URLSearchParams(window.location.search).get('view') === 'campus' ? 'campus' : 'indoor')
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div><p className="text-sm font-bold text-slate-900">Navigation map</p><p className="text-xs text-slate-500">Switch between the available Ramanujan indoor floors and the Varnam campus site plan.</p></div>
      <div className="flex gap-2" role="group" aria-label="Navigation map scope">
        <button type="button" onClick={() => setView('indoor')} className={`rounded-xl px-4 py-2 text-sm font-semibold ${view === 'indoor' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}><Layers3 className="mr-2 inline h-4 w-4" />Ramanujan indoor</button>
        <button type="button" onClick={() => setView('campus')} className={`rounded-xl px-4 py-2 text-sm font-semibold ${view === 'campus' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}><Building2 className="mr-2 inline h-4 w-4" />Campus outdoor</button>
      </div>
    </div>
    {view === 'indoor' ? <MultiFloorNavigation3D /> : <Suspense fallback={<div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">Loading campus DXF visualization…</div>}><CampusSite3D onOpenRamanujan={() => setView('indoor')} /></Suspense>}
  </div>
}
