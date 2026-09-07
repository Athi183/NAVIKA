export default function RouteSteps({ steps = [] }) {
  if (!steps?.length) return null

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">Route</div>
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={`${step}-${index}`} className="flex items-start gap-3 text-sm text-slate-200">
            <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-semibold text-emerald-300">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
