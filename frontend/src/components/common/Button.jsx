// Flat fill + thick border + a hard, unblurred offset shadow that collapses
// to nothing on press, like a real button being pushed in -- not a soft
// gradient/glow, which reads as generic "AI dashboard" output. Every
// variant shares that same shape language; only the fill color changes.
export default function Button({ children, variant = 'primary', className = '', onClick, disabled = false, type = 'button' }) {
  const styles = {
    primary: 'bg-brand-500 text-white shadow-[4px_4px_0_0_#160f0f] hover:bg-brand-400',
    secondary: 'bg-accent-300 text-ink-900 shadow-[4px_4px_0_0_#160f0f] hover:bg-accent-400',
    ghost: 'bg-white text-ink-900 shadow-[4px_4px_0_0_#160f0f] hover:bg-brand-100',
    danger: 'bg-red-500 text-white shadow-[4px_4px_0_0_#160f0f] hover:bg-red-600',
    brutal: 'bg-brand-500 text-white shadow-[4px_4px_0_0_#160f0f] hover:bg-brand-400',
  }

  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-xl border-[3px] border-ink-900 px-4 py-2.5 text-sm font-bold transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_#160f0f] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_0_#160f0f] disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
