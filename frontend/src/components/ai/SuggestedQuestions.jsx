export default function SuggestedQuestions({ suggestions = [], onSelect }) {
  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((text) => (
        <button
          key={text}
          type="button"
          className="rounded-full border border-brand-200 bg-brand-100 px-3 py-2 text-left text-sm text-brand-500 transition hover:border-brand-300 hover:bg-brand-200"
          onClick={() => onSelect(text)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
