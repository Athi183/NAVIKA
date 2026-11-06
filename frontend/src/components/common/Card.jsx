export default function Card({ children, className = '' }) {
  return (
    <div className={`rounded-2xl border-[3px] border-ink-900 bg-white p-5 shadow-[5px_5px_0_0_#160f0f] ${className}`}>
      {children}
    </div>
  )
}
