export default function Button({ children, variant = 'primary', className = '', onClick, disabled = false, type = 'button' }) {
  const styles = {
    primary: 'bg-brand-500 text-white hover:bg-brand-400 border-brand-500',
    secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200 border-slate-200',
    ghost: 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100 border-red-200',
  }

  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
