import { Square, User, Volume2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// NAVIKA's answers come back as markdown from the LLM -- including, for
// RAG answers built from tabular source data (e.g. placement/recruiter
// statistics), actual GitHub-flavored-markdown tables. Rendering `text`
// as a plain string left every "**bold**", bullet, and especially every
// "| col | col |" table row showing up as literal, unreadable pipe-
// delimited text instead of an actual table -- remark-gfm specifically
// is required for table support, since table syntax isn't part of
// standard markdown. Each element gets its own small Tailwind override
// here rather than a global "prose" wrapper, since this project doesn't
// have the @tailwindcss/typography plugin installed and adding it just
// for this would be a much bigger dependency than this one component
// needs.
const MARKDOWN_COMPONENTS = {
  p: ({ children }) => <p className="mb-2 last:mb-0 text-sm leading-6">{children}</p>,
  strong: ({ children }) => <strong className="font-extrabold text-brand-600">{children}</strong>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 text-sm leading-6">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 text-sm leading-6">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="font-bold text-brand-600 underline decoration-2 underline-offset-2 hover:text-brand-500">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto rounded-lg border-[3px] border-ink-900">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-accent-300">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b-[3px] border-ink-900 px-3 py-2 font-extrabold text-ink-900">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-slate-200 px-3 py-2 align-top">{children}</td>,
  // Covers any image a RAG answer's markdown embeds directly in the chat
  // (the faculty lookup itself now renders its photo in its own
  // FacultyFlashcard, not a chat bubble) -- a bare markdown image with no
  // size rule here would render at its native resolution, which can be
  // huge inside a chat bubble.
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt || 'Photo'}
      className="mb-3 h-28 w-28 rounded-xl border-[3px] border-ink-900 object-cover"
      loading="lazy"
    />
  ),
}

export default function ChatMessage({ speaker, text, timestamp, isLoading = false, isSpeaking = false, onToggleSpeak }) {
  const isUser = speaker === 'USER'

  return (
    <div className={`mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="mr-3 mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-[3px] border-ink-900 bg-accent-400 text-sm font-black text-ink-900">
          N
        </div>
      )}

      <div
        className={`max-w-[80%] rounded-xl border-[3px] border-ink-900 px-4 py-3 ${
          isUser
            ? 'rounded-tr-sm bg-brand-500 text-white shadow-[3px_3px_0_0_#160f0f]'
            : 'rounded-tl-sm bg-white text-ink-900 shadow-[3px_3px_0_0_#160f0f]'
        }`}
      >
        <div className={`mb-1 flex items-center justify-between gap-2 text-[10px] font-extrabold uppercase tracking-[0.2em] ${isUser ? 'text-white/70' : 'text-brand-500'}`}>
          <span>{isUser ? 'You' : 'NAVIKA'}</span>
          <span>{timestamp}</span>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-1 text-sm font-bold text-ink-900">
            <span className="h-2.5 w-2.5 animate-bounce rounded-sm border-2 border-ink-900 bg-accent-400 [animation-delay:0ms]" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-sm border-2 border-ink-900 bg-accent-400 [animation-delay:120ms]" />
            <span className="h-2.5 w-2.5 animate-bounce rounded-sm border-2 border-ink-900 bg-accent-400 [animation-delay:240ms]" />
            <span className="ml-1">thinking...</span>
          </div>
        ) : isUser ? (
          <p className="text-sm leading-6 text-inherit">{text}</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
            {text}
          </ReactMarkdown>
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
          className={`ml-3 mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-[3px] border-ink-900 transition-all duration-150 ${
            isSpeaking
              ? 'translate-x-0.5 translate-y-0.5 bg-accent-400 text-ink-900 shadow-none'
              : 'bg-white text-ink-900 shadow-[3px_3px_0_0_#160f0f] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_0_#160f0f]'
          }`}
        >
          {isSpeaking ? <Square className="h-3.5 w-3.5 fill-current" /> : <Volume2 className="h-4 w-4" />}
        </button>
      )}

      {isUser && (
        <div className="ml-3 mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-[3px] border-ink-900 bg-ink-900 text-white">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  )
}
