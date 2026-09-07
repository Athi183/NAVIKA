export default function Modal({ open, onClose, children, title }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg animate-[fadeIn_0.2s_ease-out] rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button
            type="button"
            className="rounded-full border border-slate-700 px-2 py-1 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
