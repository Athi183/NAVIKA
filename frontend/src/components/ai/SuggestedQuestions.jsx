export default function SuggestedQuestions({ suggestions = [], onSelect }) {
  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((text) => (
        <button
          key={text}
          type="button"
          className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-left text-sm text-emerald-100 transition hover:border-emerald-400/40 hover:bg-emerald-400/20"
          onClick={() => onSelect(text)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
