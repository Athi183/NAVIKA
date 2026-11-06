// Alternating tilt + a hard offset shadow that flattens on press reads as
// hand-placed stickers rather than a uniform grid of form chips -- that
// uniformity was a big part of what made this look machine-generated.
const TILTS = ['-rotate-1', 'rotate-1']

export default function SuggestedQuestions({ suggestions = [], onSelect }) {
  return (
    <div className="flex flex-wrap gap-3 py-1">
      {suggestions.map((text, index) => (
        <button
          key={text}
          type="button"
          className={`${TILTS[index % 2]} rounded-xl border-[3px] border-ink-900 bg-accent-300 px-3.5 py-2 text-left text-sm font-bold text-ink-900 shadow-[3px_3px_0_0_#160f0f] transition-all duration-150 hover:rotate-0 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-brand-500 hover:text-white hover:shadow-[5px_5px_0_0_#160f0f] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none`}
          onClick={() => onSelect(text)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
