export default function RouteSummary({ route, source, destination }) {
  if (!route) return null

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <div className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Route Information</div>
      </div>

      <div className="space-y-3 text-sm text-slate-600">
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Source</span>
          <span className="text-right text-slate-900">{source}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Destination</span>
          <span className="text-right text-slate-900">{destination}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Algorithm</span>
          <span className="text-right text-slate-900">{route.algorithm === 'astar' ? 'A*' : 'Dijkstra'}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Distance</span>
          <span className="text-right text-slate-900">{route.distance} map units</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Floor Changes</span>
          <span className="text-right text-slate-900">{route.floor_changes}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Estimated Walking</span>
          <span className="text-right text-slate-900">{route.estimatedTime || '~ 2 min'}</span>
        </div>
      </div>
    </div>
  )
}
