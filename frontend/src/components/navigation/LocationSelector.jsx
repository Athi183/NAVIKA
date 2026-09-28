export default function LocationSelector({ label, value, options = [], onChange }) {
  return (
    <label className="block w-full">
      <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-brand-500"
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
