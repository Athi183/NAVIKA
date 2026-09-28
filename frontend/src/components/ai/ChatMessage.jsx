import { MessageSquareText, Mic, Square, User, Volume2 } from 'lucide-react'

export default function ChatMessage({ speaker, text, timestamp, isLoading = false, isSpeaking = false, onToggleSpeak }) {
  const isUser = speaker === 'USER'

  return (
    <div className={`mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="mr-3 mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg shadow-brand-500/20">
          <MessageSquareText className="h-4 w-4" />
        </div>
      )}

      <div className={`max-w-[80%] rounded-2xl border px-4 py-3 ${isUser ? 'border-brand-200 bg-brand-100 text-slate-900' : 'border-slate-200 bg-white text-slate-900'}`}>
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.2em] text-slate-400">
          <span>{isUser ? 'You' : 'NAVIKA'}</span>
          <div className="flex items-center gap-2">
            {isLoading ? <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" /> : <Mic className="h-3 w-3" />}
            <span>{timestamp}</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-1 text-sm text-slate-500">
            <span className="h-2 w-2 animate-bounce rounded-full bg-brand-500 [animation-delay:0ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-brand-500 [animation-delay:120ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-brand-500 [animation-delay:240ms]" />
          </div>
        ) : (
          <p className="text-sm leading-6 text-inherit">{text}</p>
        )}
      </div>

      {/* Functional speaker toggle for NAVIKA's own replies — replays
          (or, while playing, stops) this specific message, independent
          of any other message. Not shown for USER bubbles: replaying the
          user's own typed/spoken text back at them isn't a real feature,
          it was previously just a decorative, non-clickable icon here
          that looked like a button but did nothing. */}
      {!isUser && onToggleSpeak && !isLoading && (
        <button
          type="button"
          onClick={onToggleSpeak}
          aria-label={isSpeaking ? 'Stop speaking this message' : 'Speak this message'}
          title={isSpeaking ? 'Stop speaking this message' : 'Speak this message'}
          className={`ml-3 mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
            isSpeaking
              ? 'border-brand-500 bg-brand-500 text-white'
              : 'border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:text-brand-500'
          }`}
        >
          {isSpeaking ? <Square className="h-3.5 w-3.5 fill-current" /> : <Volume2 className="h-4 w-4" />}
        </button>
      )}

      {isUser && (
        <div className="ml-3 mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  )
}
