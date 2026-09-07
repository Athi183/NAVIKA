export default function LocationSelector({ label, value, options = [], onChange }) {
  return (
    <label className="block w-full">
      <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-base text-white outline-none transition focus:border-emerald-400"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}
