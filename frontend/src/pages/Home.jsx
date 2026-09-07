import { ArrowRight, MapPinned, MessageSquareText, Mic, Navigation } from 'lucide-react'
import Card from '../components/common/Card'
import Button from '../components/common/Button'

const featureCards = [
  {
    title: 'AI ASSISTANT',
    icon: MessageSquareText,
    headline: 'Ask NAVIKA',
    description: 'Ask questions about departments, faculty, facilities and campus information.',
    action: 'Start Conversation',
    accent: 'from-emerald-400/15 to-sky-500/15',
  },
  {
    title: 'INDOOR NAVIGATION',
    icon: Navigation,
    headline: 'Find Your Way',
    description: 'Navigate through buildings and floors with an interactive route.',
    action: 'Find a Route',
    accent: 'from-amber-400/10 to-rose-500/10',
  },
]

export default function Home({ onNavigate }) {
  return (
    <div className="space-y-8">
      <div className="rounded-[28px] border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(52,211,153,0.16),transparent_35%),radial-gradient(circle_at_right,_rgba(59,130,246,0.18),transparent_30%),linear-gradient(180deg,#020817_0%,#0f172a_100%)] p-6 md:p-10">
        <div className="mb-5 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-emerald-300">
          <Mic className="h-4 w-4" />
          PHASE-I DEMO MODE
        </div>

        <div className="max-w-3xl">
          <h1 className="text-4xl font-black tracking-tight text-white md:text-6xl">
            How can I help you today?
          </h1>
          <p className="mt-4 max-w-xl text-lg text-slate-300">
            Ask about the campus or find your destination.
          </p>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {featureCards.map(({ title, icon: Icon, headline, description, action, accent }) => (
            <Card key={title} className={`overflow-hidden bg-gradient-to-br ${accent} p-6`}>
              <div className="mb-5 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700/80 bg-slate-950/60 text-emerald-300">
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-[10px] uppercase tracking-[0.28em] text-slate-400">{title}</span>
              </div>

              <h2 className="text-2xl font-semibold text-white">{headline}</h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">{description}</p>

              <div className="mt-6">
                <Button
                  className="w-full justify-between gap-3 rounded-2xl px-5 py-3 text-base"
                  onClick={() => onNavigate(title.includes('AI') ? 'Ask NAVIKA' : 'Navigation')}
                >
                  {action}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-3 flex items-center gap-3 text-emerald-300"><MessageSquareText className="h-5 w-5" /> Conversational AI</div>
          <p className="text-sm text-slate-300">Campus Q&A and info retrieval with demo responses ready for API integration.</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-3 flex items-center gap-3 text-amber-300"><Navigation className="h-5 w-5" /> Indoor Navigation</div>
          <p className="text-sm text-slate-300">Route planning with a reusable map layer for future MITS campus data.</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-3 flex items-center gap-3 text-sky-300"><MapPinned className="h-5 w-5" /> Demo Map</div>
          <p className="text-sm text-slate-300">Apartment-inspired floor plan adapted for a clear Phase-I prototype experience.</p>
        </div>
      </div>
    </div>
  )
}
