import { Mic, Volume2 } from 'lucide-react'

export default function VoiceButton({ label, onClick, active = false, variant = 'input' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-12 w-12 items-center justify-center rounded-xl border transition ${
        active
          ? 'border-brand-500 bg-brand-500 text-white'
          : variant === 'output'
            ? 'border-brand-200 bg-brand-100 text-brand-500 hover:border-brand-300 hover:bg-brand-200'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
      }`}
      aria-label={label}
      title={label}
    >
      {variant === 'output' ? <Volume2 className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
    </button>
  )
}
