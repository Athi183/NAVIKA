import { Mic, Volume2 } from 'lucide-react'

export default function VoiceButton({ label, onClick, active = false, variant = 'input' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={active ? { animation: 'wiggle 0.5s ease-in-out infinite' } : undefined}
      className={`flex h-12 w-12 items-center justify-center rounded-xl border-[3px] border-ink-900 transition-all duration-150 ${
        active
          ? 'translate-x-0.5 translate-y-0.5 bg-accent-400 text-ink-900 shadow-none'
          : variant === 'output'
            ? 'bg-brand-100 text-brand-600 shadow-[3px_3px_0_0_#160f0f] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_#160f0f]'
            : 'bg-white text-ink-900 shadow-[3px_3px_0_0_#160f0f] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_#160f0f]'
      }`}
      aria-label={label}
      title={label}
    >
      {variant === 'output' ? <Volume2 className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
    </button>
  )
}
