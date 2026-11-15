import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Ban, KeyRound, Plus, Save, Siren, Trash2 } from 'lucide-react'
import MGeorgeBuilding3D from '../components/navigation/MGeorgeBuilding3D'
import { applyClosures, floorName, levelOf, loadBuilding } from '../services/mgeorgeRoute'
import { canSaveClosures, fetchClosures, rememberStaffKey, rememberedStaffKey, saveClosures } from '../services/closuresApi'

// Staff page (/staff/closures): close a corridor, a staircase or lift, or the
// bridge, and switch the emergency mode on or off. Kiosks and phones pick the
// change up within half a minute. Saving needs the staff key set on the server
// (NAVIKA_STAFF_KEY); anyone can see what is closed, as visitors can.

const RADII = [2, 3, 5, 8, 12]
const button = 'flex items-center justify-center gap-2 rounded-xl border-[3px] border-ink-900 px-4 py-2.5 text-base font-bold'
const field = 'w-full rounded-lg border-[3px] border-ink-900 bg-white px-3 py-2 text-base'

const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const describe = (closure) => `${closure.label}${closure.reason ? ` · ${closure.reason}` : ''}`

/** Stairs and lifts in use, by building, for the "close a staircase or lift" list. */
function shaftChoices(model) {
  return [...model.shafts.values()]
    .filter((shaft) => shaft.routable || shaft.kind !== 'lift')
    .map((shaft) => ({ id: shaft.id, name: `${shaft.id.startsWith('rb_') ? 'Ramanujan' : 'M. George'} · ${shaft.name}` }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export default function StaffClosures() {
  const [base, setBase] = useState(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(null) // { closures, emergency } being edited
  const [saved, setSaved] = useState(null)
  const [key, setKey] = useState(rememberedStaffKey)
  const [message, setMessage] = useState(null) // { ok, text }
  const [floor, setFloor] = useState(1)
  const [pending, setPending] = useState(null) // a corridor point tapped on the map
  const [radius, setRadius] = useState(3)
  const [reason, setReason] = useState('')
  const [shaft, setShaft] = useState('')

  useEffect(() => {
    Promise.all([loadBuilding(), fetchClosures()]).then(([model, state]) => {
      setBase(model)
      const current = { closures: state.closures, emergency: state.emergency }
      setDraft(current)
      setSaved(current)
    }).catch((reason) => setError(reason.message))
  }, [])

  const preview = useMemo(() => {
    if (!base || !draft) return null
    const closures = pending ? [...draft.closures, { id: 'pending', type: 'area', floor, xy: pending, radius_m: radius }] : draft.closures
    return applyClosures(base, closures)
  }, [base, draft, pending, floor, radius])

  if (error) return <p className="p-8 text-lg text-red-800">{error}</p>
  if (!base || !draft) return <p className="p-8 text-lg text-slate-600">Loading…</p>

  const floors = base.floors.map((item) => item.floor_number)
    .sort((a, b) => (typeof a === typeof b ? levelOf(a) - levelOf(b) : typeof a === 'string' ? 1 : -1))
  const add = (closure) => {
    setDraft({ ...draft, closures: [...draft.closures, { id: newId(), ...closure, ...(reason.trim() ? { reason: reason.trim() } : {}) }] })
    setReason('')
    setPending(null)
    setMessage(null)
  }
  const remove = (id) => setDraft({ ...draft, closures: draft.closures.filter((item) => item.id !== id) })
  const unsaved = JSON.stringify(draft) !== JSON.stringify(saved)
  const save = async () => {
    try {
      rememberStaffKey(key)
      const state = await saveClosures({ closures: draft.closures, emergency: draft.emergency }, key)
      const current = { closures: state.closures, emergency: state.emergency }
      setDraft(current)
      setSaved(current)
      setMessage({ ok: true, text: 'Saved. Kiosks and phones update within half a minute.' })
    } catch (problem) {
      setMessage({ ok: false, text: problem.message })
    }
  }
  // Labels as the kiosk will show them (applyClosures fills them in).
  const shown = new Map(applyClosures(base, draft.closures).closures.map((item) => [item.id, item]))
  const bridge = base.links.find((item) => item.kind === 'bridge')

  return <div className="mx-auto max-w-6xl space-y-5 p-4 text-ink-900 md:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-3xl font-black">Closures and emergency</h1>
      <a href="/navigation" className={`${button} bg-white`}><ArrowLeft className="h-5 w-5" />Kiosk</a>
    </div>

    <section className={`space-y-3 rounded-2xl border-[3px] border-ink-900 p-5 ${draft.emergency ? 'bg-red-600 text-white' : 'bg-white'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Siren className="h-7 w-7" />
        <p className="mr-auto text-xl font-black">{draft.emergency ? 'Emergency mode is ON' : 'Emergency mode is off'}</p>
        <button type="button" onClick={() => setDraft({ ...draft, emergency: draft.emergency ? null : { message: 'Please leave the building by the nearest exit.' } })}
          className={`${button} ${draft.emergency ? 'bg-white text-red-700' : 'bg-red-600 text-white'}`}>
          {draft.emergency ? 'Switch off' : 'Switch on'}
        </button>
      </div>
      {draft.emergency && <label className="block space-y-1">
        <span className="text-sm font-bold">Message on every kiosk and phone</span>
        <input value={draft.emergency.message} maxLength={120} onChange={(event) => setDraft({ ...draft, emergency: { message: event.target.value } })} className={`${field} text-ink-900`} />
      </label>}
      <p className="text-sm">When on, every kiosk shows the way to the nearest exit (stairs only, around closures) and phones offer it.</p>
    </section>

    <section className="space-y-3 rounded-2xl border-[3px] border-ink-900 bg-white p-5">
      <h2 className="text-xl font-black">Closed now ({draft.closures.length})</h2>
      {!draft.closures.length && <p className="text-slate-600">Nothing is closed.</p>}
      <ul className="space-y-2">
        {draft.closures.map((item) => <li key={item.id} className="flex items-center gap-3 rounded-xl border-[2px] border-ink-900 bg-amber-50 px-4 py-2">
          <Ban className="h-5 w-5 shrink-0 text-red-600" />
          <span className="mr-auto">{shown.has(item.id) ? describe(shown.get(item.id)) : `${item.type} (not found on the map; it has no effect)`}{item.type === 'area' ? ` · ${floorName(item.floor)}` : ''}</span>
          <button type="button" onClick={() => remove(item.id)} className={`${button} bg-white py-1.5`}><Trash2 className="h-4 w-4" />Open again</button>
        </li>)}
      </ul>
    </section>

    <section className="space-y-4 rounded-2xl border-[3px] border-ink-900 bg-white p-5">
      <h2 className="text-xl font-black">Close something</h2>
      <label className="block space-y-1">
        <span className="text-sm font-bold">Reason (optional, shown to visitors)</span>
        <input value={reason} maxLength={120} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Cleaning, Repairs, Exam in progress" className={field} />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex gap-2">
          <select value={shaft} onChange={(event) => setShaft(event.target.value)} className={field} aria-label="Staircase or lift">
            <option value="">A staircase or lift…</option>
            {shaftChoices(base).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button type="button" disabled={!shaft} onClick={() => { add({ type: 'shaft', shaft }); setShaft('') }} className={`${button} bg-ink-900 text-white disabled:opacity-40`}><Plus className="h-5 w-5" />Close</button>
        </div>
        {bridge && <button type="button" onClick={() => add({ type: 'link', name: bridge.name })} className={`${button} bg-white`}><Plus className="h-5 w-5" />Close the bridge to Ramanujan Block</button>}
      </div>
      <div className="space-y-2">
        <p className="font-bold">A stretch of corridor: pick the floor, then tap the corridor on the map.</p>
        <div className="flex flex-wrap gap-2">
          {floors.map((item) => <button key={item} type="button" onClick={() => { setFloor(item); setPending(null) }} aria-pressed={floor === item}
            className={`${button} py-1.5 ${floor === item ? 'bg-ink-900 text-white' : 'bg-white'}`}>{floorName(item)}</button>)}
        </div>
        <div className="h-[460px] overflow-hidden rounded-2xl border-[3px] border-ink-900">
          <MGeorgeBuilding3D key={String(floor)} model={preview} floors={[floor]} labelFloors={[floor]} onPickPoint={(picked, xy) => picked === floor && setPending(xy)} />
        </div>
        {pending && <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Width closed:</span>
          {RADII.map((value) => <button key={value} type="button" onClick={() => setRadius(value)} aria-pressed={radius === value}
            className={`${button} py-1.5 ${radius === value ? 'bg-ink-900 text-white' : 'bg-white'}`}>{value * 2} m</button>)}
          <button type="button" onClick={() => add({ type: 'area', floor, xy: pending.map((value) => Math.round(value * 10) / 10), radius_m: radius })} className={`${button} bg-red-600 text-white`}><Plus className="h-5 w-5" />Close this part</button>
          <button type="button" onClick={() => setPending(null)} className={`${button} bg-white`}>Cancel</button>
        </div>}
      </div>
    </section>

    <section className="flex flex-wrap items-end gap-3 rounded-2xl border-[3px] border-ink-900 bg-cream-50 p-5">
      <label className="min-w-[240px] flex-1 space-y-1">
        <span className="flex items-center gap-1 text-sm font-bold"><KeyRound className="h-4 w-4" />Staff key</span>
        <input type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="current-password" className={field} />
      </label>
      <button type="button" onClick={save} disabled={!unsaved || !key || !canSaveClosures} className={`${button} bg-brand-500 py-3 text-lg text-white disabled:opacity-40`}><Save className="h-5 w-5" />Save for all kiosks</button>
      {!canSaveClosures && <p className="w-full text-sm font-semibold text-amber-800">No backend is set (VITE_API_BASE_URL), so changes cannot be saved from here.</p>}
      {unsaved && canSaveClosures && <p className="w-full text-sm font-semibold text-amber-800">Not saved yet.</p>}
      {message && <p className={`w-full text-base font-semibold ${message.ok ? 'text-green-700' : 'text-red-700'}`}>{message.text}</p>}
    </section>
  </div>
}
