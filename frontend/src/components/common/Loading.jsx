export default function Loading({ label = 'Loading...' }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-300">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
      <span>{label}</span>
    </div>
  )
}
