export default function Card({ children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_30px_rgba(216,21,28,0.08)] ${className}`}>
      {children}
    </div>
  )
}
