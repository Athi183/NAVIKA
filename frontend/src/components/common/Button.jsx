export default function Button({ children, variant = 'primary', className = '', onClick, disabled = false, type = 'button' }) {
  const styles = {
    primary: 'bg-emerald-400 text-slate-950 hover:bg-emerald-300',
    secondary: 'bg-slate-800 text-slate-100 hover:bg-slate-700',
    ghost: 'bg-slate-900/40 text-slate-100 hover:bg-slate-800/80',
    danger: 'bg-red-500/15 text-red-200 hover:bg-red-500/25',
  }

  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
