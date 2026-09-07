import { MessageSquareText, Mic, Volume2 } from 'lucide-react'

export default function ChatMessage({ speaker, text, timestamp, isLoading = false }) {
  const isUser = speaker === 'USER'

  return (
    <div className={`mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="mr-3 mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 text-slate-950 shadow-lg shadow-emerald-500/20">
          <MessageSquareText className="h-4 w-4" />
        </div>
      )}

      <div className={`max-w-[80%] rounded-2xl border px-4 py-3 ${isUser ? 'border-sky-500/30 bg-sky-500/10 text-sky-50' : 'border-slate-700 bg-slate-900/80 text-slate-100'}`}>
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.2em] text-slate-400">
          <span>{isUser ? 'You' : 'NAVIKA'}</span>
          <div className="flex items-center gap-2">
            {isLoading ? <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> : <Mic className="h-3 w-3" />}
            <span>{timestamp}</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-1 text-sm text-slate-300">
            <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:0ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:120ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:240ms]" />
          </div>
        ) : (
          <p className="text-sm leading-6 text-inherit">{text}</p>
        )}
      </div>

      {isUser && (
        <div className="ml-3 mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-slate-200">
          <Volume2 className="h-4 w-4" />
        </div>
      )}
    </div>
  )
}
