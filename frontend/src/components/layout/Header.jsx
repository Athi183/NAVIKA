import { Compass, House, MessageSquareText, Map, Info } from 'lucide-react'

const navItems = [
  { label: 'Home', icon: House },
  { label: 'Ask NAVIKA', icon: MessageSquareText },
  { label: 'Navigation', icon: Map },
  { label: 'About', icon: Info },
]

export default function Header({ activeTab, onSelect }) {
  return (
    <header className="sticky top-0 z-30 border-b-[3px] border-ink-900 bg-cream-50">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border-[3px] border-ink-900 bg-brand-500 text-white shadow-[3px_3px_0_0_#160f0f]">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <div className="text-2xl font-black tracking-tight text-ink-900">NAVIKA</div>
            <div className="text-xs font-bold uppercase tracking-[0.24em] text-brand-600">
              Smart Campus Assistance System
            </div>
          </div>
        </div>

        <nav className="hidden items-center gap-1.5 rounded-xl border-[3px] border-ink-900 bg-white p-1.5 md:flex">
          {navItems.map(({ label, icon: Icon }) => {
            const isActive = activeTab === label
            return (
              <button
                key={label}
                type="button"
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition ${
                  isActive ? 'bg-ink-900 text-white' : 'text-ink-900 hover:bg-brand-100'
                }`}
                onClick={() => onSelect(label)}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
