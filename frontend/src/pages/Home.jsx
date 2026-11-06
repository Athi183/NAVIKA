import { useNavigate } from 'react-router-dom'
import { Briefcase, Building2, GraduationCap, MapPin, MessageCircle, Users } from 'lucide-react'

// This is the kiosk home screen -- the thing a parent or visitor sees
// first, often with no idea this is a "chatbot" at all. Each tile is a
// concrete question a real visitor actually has, not an abstract feature
// name ("AI Assistant", "Indoor Navigation") -- someone standing in front
// of a kiosk thinks "where's the admissions office", not "let me engage
// the conversational AI module". Tapping one should feel like pointing
// at a signboard, not opening an app: big targets, one short answer to
// "what do I tap for X", and for the ones with an obvious single
// question (admissions, departments, placements), landing directly on
// the answer instead of an empty chat box the visitor then has to figure
// out how to use.
const TILES = [
  {
    title: 'Find a Teacher',
    subtitle: 'Search any teacher or staff member',
    icon: Users,
    action: (navigate) => navigate('/assistant', { state: { focusFacultySearch: true } }),
  },
  {
    title: 'Find a Place',
    subtitle: 'Get directions to any room or building',
    icon: MapPin,
    action: (navigate) => navigate('/navigation'),
  },
  {
    title: 'Admissions',
    subtitle: 'Check if you’re eligible to apply',
    icon: GraduationCap,
    // The dedicated page lets a visitor enter their own marks and get an
    // honest, instant eligibility check -- no LLM round trip, and no
    // risk of the model phrasing a real eligibility question loosely.
    action: (navigate) => navigate('/admissions'),
  },
  {
    title: 'Departments',
    subtitle: 'See what we teach here',
    icon: Building2,
    action: (navigate) => navigate('/departments'),
  },
  {
    title: 'Placements',
    subtitle: 'See where our students work',
    icon: Briefcase,
    // Goes straight to the dedicated placements screen instead of
    // asking NAVIKA through the chat/LLM pipeline -- a batch-placement
    // answer was the single heaviest prompt in the app (a full recruiter
    // table) and the slowest, most failure-prone preset button as a
    // result. The structured page is both faster (no LLM round trip at
    // all) and the better format for this data anyway (tables and bars,
    // not prose).
    action: (navigate) => navigate('/placements'),
  },
  {
    title: 'Ask Anything',
    subtitle: 'Type or speak any other question',
    icon: MessageCircle,
    action: (navigate) => navigate('/assistant'),
  },
]

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="space-y-10">
      <div className="text-center">
        <h1 className="text-4xl font-black tracking-tight text-ink-900 md:text-6xl">
          How can we help you today?
        </h1>
        <p className="mt-4 text-lg font-semibold text-slate-600">Tap a button below to get started.</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map(({ title, subtitle, icon: Icon, action }) => (
          <button
            key={title}
            type="button"
            onClick={() => action(navigate)}
            className="group flex flex-col items-center gap-4 rounded-2xl border-[3px] border-ink-900 bg-white px-6 py-10 text-center shadow-[6px_6px_0_0_#160f0f] transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-brand-50 hover:shadow-[9px_9px_0_0_#160f0f] focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 active:translate-x-0.5 active:translate-y-0.5 active:shadow-[3px_3px_0_0_#160f0f]"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-xl border-[3px] border-ink-900 bg-accent-300 text-ink-900 transition-colors group-hover:bg-brand-500 group-hover:text-white">
              <Icon className="h-10 w-10" strokeWidth={2} />
            </div>
            <div>
              <div className="text-2xl font-black text-ink-900">{title}</div>
              <p className="mt-2 text-base font-semibold text-slate-500">{subtitle}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
