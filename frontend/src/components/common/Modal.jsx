export default function Modal({ open, onClose, children, title }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg animate-[fadeIn_0.2s_ease-out] rounded-2xl border-[3px] border-ink-900 bg-white shadow-[8px_8px_0_0_#160f0f]">
        <div className="flex items-center justify-between border-b-[3px] border-ink-900 px-5 py-4">
          <h3 className="text-lg font-black text-ink-900">{title}</h3>
          <button
            type="button"
            className="rounded-lg border-[3px] border-ink-900 bg-white px-2 py-1 text-sm font-bold text-ink-900 transition hover:bg-brand-100"
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
