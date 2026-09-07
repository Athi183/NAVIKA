export default function Map2D({ route, nodes = [], source, destination }) {
  const viewBox = '0 0 560 400'
  const routePoints = route?.path?.filter((node) => node?.x && node?.y) || []

  const startNode = source ? nodes.find((node) => node.name === source) : routePoints[0]
  const endNode = destination ? nodes.find((node) => node.name === destination) : routePoints[routePoints.length - 1]

  const polyline = routePoints
    .map((point) => `${point.x},${point.y}`)
    .join(' ')

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-950/80 shadow-2xl">
      <svg viewBox={viewBox} className="h-[360px] w-full bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_30%),linear-gradient(180deg,#0f172a_0%,#111827_100%)]">
        <image href="/demo_floorplan.png" x="0" y="0" width="560" height="400" preserveAspectRatio="none" opacity="0.9" />
        <rect x="0" y="0" width="560" height="400" fill="rgba(2,6,23,0.2)" />

        {nodes.map((node) => (
          <g key={node.id}>
            <circle cx={node.x} cy={node.y} r="10" fill="rgba(59,130,246,0.28)" stroke="rgba(148,163,184,0.4)" />
            <circle cx={node.x} cy={node.y} r="4" fill="rgba(148,163,184,0.9)" />
          </g>
        ))}

        {polyline && (
          <polyline
            points={polyline}
            fill="none"
            stroke="#34d399"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="0 0"
            opacity="0.95"
          />
        )}

        {startNode && (
          <g>
            <circle cx={startNode.x} cy={startNode.y} r="16" fill="rgba(16,185,129,0.2)" />
            <circle cx={startNode.x} cy={startNode.y} r="7" fill="#34d399" />
          </g>
        )}

        {endNode && (
          <g>
            <circle cx={endNode.x} cy={endNode.y} r="16" fill="rgba(245,158,11,0.2)" />
            <circle cx={endNode.x} cy={endNode.y} r="7" fill="#fbbf24" />
          </g>
        )}
      </svg>
    </div>
  )
}
