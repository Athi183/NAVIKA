import { useEffect, useState } from 'react'
import { fetchClosures } from '../services/closuresApi'

const POLL_MS = 30_000

/**
 * Closures and the emergency switch, refreshed every half minute so a change
 * by staff reaches the kiosk and phones without a reload. `?drill=1` turns on
 * an emergency drill on this screen only (for practice and demos).
 */
export default function useClosures() {
  const [state, setState] = useState({ emergency: null, closures: [], updated_at: null, source: 'none' })
  useEffect(() => {
    let alive = true
    const drill = new URLSearchParams(window.location.search).get('drill') === '1'
    const refresh = () => fetchClosures().then((next) => {
      if (!alive) return
      const emergency = next.emergency ?? (drill ? { message: 'Emergency drill: please leave the building by the nearest exit.', drill: true } : null)
      setState((previous) => (JSON.stringify(previous) === JSON.stringify({ ...next, emergency }) ? previous : { ...next, emergency }))
    })
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  return state
}
