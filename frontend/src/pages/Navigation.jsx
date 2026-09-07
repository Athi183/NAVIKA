import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Compass, Map, Navigation as RouteIcon, QrCode, RotateCcw, Sparkles } from 'lucide-react'
import Button from '../components/common/Button'
import Card from '../components/common/Card'
import LocationSelector from '../components/navigation/LocationSelector'
import AlgorithmSelector from '../components/navigation/AlgorithmSelector'
import RouteSummary from '../components/navigation/RouteSummary'
import RouteSteps from '../components/navigation/RouteSteps'
import Map2D from '../components/navigation/Map2D'
import Map3D from '../components/navigation/Map3D'
import QRModal from '../components/qr/QRModal'
import { demoMap, demoRoute } from '../data/demoMap'
import { findRoute, generateRouteSession, getDestinations, isDemoMode } from '../services/navigationApi'

const tabs = ['2D Map', '3D View']

export default function NavigationPage() {
  const [source, setSource] = useState('Main Entrance')
  const [destination, setDestination] = useState('CSE Department')
  const [algorithm, setAlgorithm] = useState('astar')
  const [route, setRoute] = useState(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState('2D Map')
  const [qrOpen, setQrOpen] = useState(false)
  const [qrData, setQrData] = useState(null)

  const destinations = useMemo(() => [
    'Main Entrance',
    'CSE Department',
    'Library',
    'Laboratory Block',
    'Auditorium',
    'Administration Office',
    'Sports Complex',
  ], [])

  useEffect(() => {
    const loadDestinations = async () => {
      try {
        const result = await getDestinations()
        if (Array.isArray(result) && result.length) {
          const options = result.filter((item) => typeof item === 'string')
          if (options.length) {
            setSource((current) => current || options[0])
            setDestination((current) => current || options[1] || options[0])
          }
        }
      } catch (error) {
        console.info('Demo mode active', error)
      }
    }

    loadDestinations()
  }, [])

  const handleFindRoute = async () => {
    setLoading(true)
    const result = await findRoute(source, destination, algorithm)
    setLoading(false)

    if (result.error) {
      setRoute({ error: result.error })
      return
    }

    setRoute({
      ...result,
      steps: result.steps || demoRoute.steps,
      estimatedTime: result.estimatedTime || '~ 2 min',
      algorithm: result.algorithm || algorithm,
    })

    const session = await generateRouteSession({
      source: source || 'Main Entrance',
      destination: destination || 'CSE Department',
      validFor: '59:42',
      url: `/mobile-route?source=${encodeURIComponent(source)}&destination=${encodeURIComponent(destination)}`,
    })

    setQrData(session)
  }

  const routeSummary = route && !route.error ? route : null

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-emerald-300">NAVIKA INDOOR NAVIGATION</div>
            <h2 className="mt-2 text-3xl font-semibold text-white">Phase-I Demo Map</h2>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-amber-300">
            <Sparkles className="h-3.5 w-3.5" />
            {isDemoMode ? 'PHASE-I DEMO MODE' : 'LIVE MODE'}
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
          <LocationSelector label="From" value={source} options={destinations} onChange={setSource} />
          <LocationSelector label="To" value={destination} options={destinations} onChange={setDestination} />
          <Button className="h-[52px] rounded-xl px-5 text-base" onClick={handleFindRoute} disabled={loading}>
            {loading ? 'Finding...' : 'FIND ROUTE'}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-slate-400">
              <Compass className="h-4 w-4" />
              Route Configuration
            </div>
            <AlgorithmSelector value={algorithm} onChange={setAlgorithm} />
          </Card>

          {route && route.error ? (
            <Card className="p-4">
              <div className="text-sm text-rose-200">{route.error}</div>
            </Card>
          ) : routeSummary ? (
            <>
              <RouteSummary route={routeSummary} source={source} destination={destination} />
              <RouteSteps steps={routeSummary.steps || demoRoute.steps} />
            </>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
            <div className="flex gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                    view === tab ? 'bg-emerald-400 text-slate-950' : 'bg-slate-950 text-slate-300 hover:bg-slate-800'
                  }`}
                  onClick={() => setView(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="secondary" className="gap-2 rounded-xl px-3 py-2 text-xs" onClick={() => setQrOpen(true)}>
                <QrCode className="h-4 w-4" />
                GENERATE QR
              </Button>
            </div>
          </div>

          {view === '2D Map' ? (
            <Map2D route={routeSummary || demoRoute} nodes={demoMap.nodes} source={source} destination={destination} />
          ) : (
            <Map3D route={routeSummary || demoRoute} source={source} destination={destination} />
          )}
        </div>
      </div>

      <QRModal isOpen={qrOpen} onClose={() => setQrOpen(false)} route={qrData || { source, destination, validFor: '59:42', url: `/mobile-route?source=${encodeURIComponent(source)}&destination=${encodeURIComponent(destination)}` }} />
    </div>
  )
}
