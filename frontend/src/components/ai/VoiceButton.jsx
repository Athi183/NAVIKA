import { Mic, Volume2 } from 'lucide-react'

export default function VoiceButton({ label, onClick, active = false, variant = 'input' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-12 w-12 items-center justify-center rounded-xl border transition ${
        active
          ? 'border-emerald-400 bg-emerald-400 text-slate-950'
          : variant === 'output'
            ? 'border-amber-400/50 bg-amber-400/10 text-amber-200 hover:border-amber-400 hover:bg-amber-400/20'
            : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 hover:bg-slate-800'
      }`}
      aria-label={label}
      title={label}
    >
      {variant === 'output' ? <Volume2 className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
    </button>
  )
}
