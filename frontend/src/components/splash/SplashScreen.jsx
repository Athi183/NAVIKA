import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

// The opening animation when NAVIKA starts: Navi the elephant hops onto its
// patch of campus and waves, a silk ribbon sweeps in, petals drift down, and
// the name pops in letter by letter. Visitors can play with it (Navi follows
// a finger, petals blow with it, a tap on Navi gets a hop and a burst of
// petals). "Let's go" or Enter opens the app; on its own it moves on once
// nobody has touched it for a few seconds. It plays once per browser session
// (not on every page change), and never on the phone route page (QR
// hand-off) or the staff page.

const SplashScene = lazy(() => import('./SplashScene'))

const SEEN_KEY = 'navika-splash-seen'
const MIN_SHOW_MS = 5500 // always long enough for the whole intro
const IDLE_MS = 6000 // then it moves on after this long without a touch...
const MAX_SHOW_MS = 30000 // ...and never stays longer than this
const FADE_MS = 650
const SKIP_PATHS = new Set(['/route', '/mobile-route', '/staff/closures'])
const LETTERS = ['N', 'A', 'V', 'I', 'K', 'A']

function alreadySeen() {
  try { return window.sessionStorage.getItem(SEEN_KEY) === '1' } catch { return false }
}

function markSeen() {
  try { window.sessionStorage.setItem(SEEN_KEY, '1') } catch { /* private mode: it may play again next load */ }
}

export default function SplashScreen() {
  const { pathname } = useLocation()
  const [phase, setPhase] = useState(() => (SKIP_PATHS.has(pathname) || alreadySeen() ? 'gone' : 'show'))
  // When the splash opened and when it was last touched (performance.now()).
  const times = useRef({ opened: 0, touched: 0 })
  const touch = () => { times.current.touched = performance.now() }

  useEffect(() => {
    if (phase === 'show') {
      markSeen()
      times.current = { opened: performance.now(), touched: performance.now() }
      const check = setInterval(() => {
        const now = performance.now()
        const { opened, touched } = times.current
        if ((now - opened > MIN_SHOW_MS && now - touched > IDLE_MS) || now - opened > MAX_SHOW_MS) setPhase('leaving')
      }, 400)
      const onKey = (event) => { if (event.key === 'Enter' || event.key === 'Escape') setPhase('leaving') }
      window.addEventListener('keydown', onKey)
      return () => {
        clearInterval(check)
        window.removeEventListener('keydown', onKey)
      }
    }
    if (phase === 'leaving') {
      const timer = setTimeout(() => setPhase('gone'), FADE_MS)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [phase])

  if (phase === 'gone') return null
  return <div role="dialog" aria-label="Welcome to NAVIKA" onPointerDown={touch} onPointerMove={touch}
    style={{ transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease` }}
    className={`fixed inset-0 z-[100] touch-none select-none overflow-hidden bg-cream-50 ${phase === 'leaving' ? 'pointer-events-none scale-105 opacity-0' : 'opacity-100'}`}>
    <style>{`
      @keyframes navika-pop { 0% { opacity: 0; transform: translateY(40px) scale(0.6); } 70% { opacity: 1; transform: translateY(-6px) scale(1.08); } 100% { opacity: 1; transform: none; } }
      @keyframes navika-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
      @keyframes navika-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    `}</style>
    {/* soft warm glows */}
    <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-[30rem] w-[30rem] rounded-full bg-accent-300/40 blur-3xl" />
    <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-20 h-[34rem] w-[34rem] rounded-full bg-brand-200/50 blur-3xl" />

    {/* the 3D world fills the whole screen, whatever its width */}
    <div className="absolute inset-0">
      <Suspense fallback={null}><SplashScene /></Suspense>
    </div>

    {/* the name across the top */}
    <div className="pointer-events-none absolute inset-x-0 top-[6vh] flex flex-col items-center text-center">
      <h1 className="flex text-7xl font-black leading-none tracking-tight text-ink-900 md:text-8xl lg:text-9xl" aria-label="NAVIKA">
        {LETTERS.map((letter, index) => <span key={index} aria-hidden
          className={index >= 4 ? 'text-brand-500' : ''}
          style={{ display: 'inline-block', animation: `navika-pop 0.55s cubic-bezier(.2,.8,.3,1.2) ${1.2 + index * 0.09}s both` }}>{letter}</span>)}
      </h1>
      <div aria-hidden className="mt-3 h-1.5 w-40 origin-left rounded-full bg-brand-500" style={{ animation: 'navika-grow 0.6s ease-out 1.9s both' }} />
      {/* on a soft cream backing, so they stay readable over the ribbon */}
      <p className="mt-4 rounded-full bg-cream-50/85 px-4 py-0.5 text-2xl font-bold text-slate-700" style={{ animation: 'navika-rise 0.6s ease-out 2.1s both' }}>Your smart campus guide</p>
      <p className="mx-4 mt-2 rounded-full bg-cream-50/85 px-4 py-1 text-sm font-bold uppercase tracking-widest text-brand-600" style={{ animation: 'navika-rise 0.6s ease-out 2.35s both' }}>Muthoot Institute of Technology and Science</p>
    </div>

    {/* and the way in along the bottom */}
    <div className="absolute inset-x-0 bottom-[5vh] flex flex-col items-center gap-3 px-4 text-center" style={{ animation: 'navika-rise 0.6s ease-out 2.7s both' }}>
      <button type="button" onClick={() => setPhase('leaving')}
        className="flex items-center gap-3 rounded-2xl border-[3px] border-ink-900 bg-brand-500 px-8 py-4 text-2xl font-black text-white shadow-[6px_6px_0_0_#160f0f] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[9px_9px_0_0_#160f0f] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
        Let’s go<ArrowRight className="h-7 w-7" />
      </button>
      <p className="rounded-full bg-white/80 px-3 py-1 text-sm font-semibold text-slate-600">Tap Navi to say hello · move your finger and Navi will follow</p>
    </div>
  </div>
}
