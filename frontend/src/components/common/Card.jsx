export default function Card({ children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-slate-700/80 bg-slate-900/70 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.45)] backdrop-blur-sm ${className}`}>
      {children}
    </div>
  )
}
