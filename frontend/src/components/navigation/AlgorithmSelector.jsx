export default function AlgorithmSelector({ value, onChange }) {
  return (
    <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5">
      {['A*', 'Dijkstra'].map((algorithm) => {
        const isSelected = value === algorithm.toLowerCase()

        return (
          <button
            key={algorithm}
            type="button"
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              isSelected ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-white'
            }`}
            onClick={() => onChange(algorithm.toLowerCase())}
          >
            {algorithm}
          </button>
        )
      })}
    </div>
  )
}
