import { Compass, House, MessageSquareText, Map, Info } from 'lucide-react'

const navItems = [
  { label: 'Home', icon: House },
  { label: 'Ask NAVIKA', icon: MessageSquareText },
  { label: 'Navigation', icon: Map },
  { label: 'About', icon: Info },
]

export default function Header({ activeTab, onSelect }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-slate-950/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/20">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-white">NAVIKA</div>
            <div className="text-xs uppercase tracking-[0.24em] text-slate-400">
              Smart Campus Assistance System
            </div>
          </div>
        </div>

        <nav className="hidden items-center gap-2 rounded-full border border-slate-800 bg-slate-900/70 p-1 md:flex">
          {navItems.map(({ label, icon: Icon }) => {
            const isActive = activeTab === label
            return (
              <button
                key={label}
                type="button"
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-emerald-400 text-slate-950' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
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
