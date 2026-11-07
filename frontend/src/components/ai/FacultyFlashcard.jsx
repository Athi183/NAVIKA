import { MapPin, Square, Volume2, X } from 'lucide-react'

// A centered overlay rather than another bubble in the scrolling chat --
// a faculty lookup is a single, self-contained answer (photo, name,
// designation, department, location, interests), and a flashcard someone
// can glance at and dismiss reads better for that than one more message
// stacked into a transcript.
export default function FacultyFlashcard({ person, onClose, isSpeaking, onToggleSpeak }) {
  if (!person) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={person.name}
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-sm animate-[fadeIn_0.2s_ease-out] rounded-2xl border-[3px] border-ink-900 bg-white p-6 text-center shadow-[8px_8px_0_0_#160f0f]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg border-[3px] border-ink-900 bg-white text-ink-900 transition hover:bg-brand-100"
        >
          <X className="h-5 w-5" />
        </button>

        {person.photo ? (
          <img
            src={person.photo}
            alt=""
            className="mx-auto h-28 w-28 rounded-xl border-[3px] border-ink-900 object-cover"
          />
        ) : (
          <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-xl border-[3px] border-ink-900 bg-accent-300 text-3xl font-black text-ink-900">
            {person.name.charAt(0)}
          </div>
        )}

        <h2 className="mt-4 text-2xl font-black leading-tight text-ink-900">{person.name}</h2>
        <p className="mt-1 text-sm font-bold text-brand-600">{person.designation}</p>
        <p className="text-sm font-semibold text-slate-600">{person.department}</p>

        {/* Only the departments covered by the reviewed DXF floor-plan
            data have a real location -- for the rest, person.location is
            null, and saying nothing here is more honest than guessing. */}
        {person.location && (
          <p className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border-[2px] border-ink-900 bg-cream-50 px-3 py-1.5 text-sm font-bold text-ink-900">
            <MapPin className="h-4 w-4 shrink-0 text-brand-500" />
            {person.location}
          </p>
        )}

        {person.interests.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {person.interests.map((item) => (
              <span
                key={item}
                className="rounded-full border-[2px] border-ink-900 bg-accent-100 px-2.5 py-1 text-xs font-bold text-ink-900"
              >
                {item}
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onToggleSpeak}
          className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl border-[3px] border-ink-900 px-4 py-2.5 text-sm font-bold transition-all duration-150 ${
            isSpeaking
              ? 'translate-x-0.5 translate-y-0.5 bg-accent-400 text-ink-900 shadow-none'
              : 'bg-white text-ink-900 shadow-[3px_3px_0_0_#160f0f] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_#160f0f]'
          }`}
        >
          {isSpeaking ? <Square className="h-4 w-4 fill-current" /> : <Volume2 className="h-4 w-4" />}
          {isSpeaking ? 'Stop' : 'Listen'}
        </button>
      </div>
    </div>
  )
}
