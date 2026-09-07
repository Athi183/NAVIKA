export default function AlgorithmSelector({ value, onChange }) {
  return (
    <div className="flex gap-2 rounded-xl border border-slate-700 bg-slate-950 p-1.5">
      {['A*', 'Dijkstra'].map((algorithm) => {
        const isSelected = value === algorithm.toLowerCase()

        return (
          <button
            key={algorithm}
            type="button"
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              isSelected ? 'bg-emerald-400 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
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
