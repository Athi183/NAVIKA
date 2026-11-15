// Closures (closed corridors, stairs, lifts) and the emergency switch, set by
// staff on the backend (backend/closures.py). Without a backend the kiosk
// reads the static /data/closures.json instead (normally empty).

const baseUrl = import.meta.env.VITE_API_BASE_URL || ''
const EMPTY = { emergency: null, closures: [], updated_at: null, source: 'none' }
const STAFF_KEY_STORE = 'navika-staff-key'

/** The current closures: from the backend, else the static file, else none. */
export async function fetchClosures() {
  for (const [url, source] of [[baseUrl && `${baseUrl}/api/closures`, 'backend'], ['/data/closures.json', 'file']]) {
    if (!url) continue
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) continue
      const state = await response.json()
      return { ...EMPTY, ...state, closures: Array.isArray(state.closures) ? state.closures : [], source }
    } catch {
      // try the next source
    }
  }
  return EMPTY
}

/** Saves `{ closures, emergency }` with the staff key; returns the saved state or throws with the server's reason. */
export async function saveClosures(state, staffKey) {
  if (!baseUrl) throw new Error('No backend is set (VITE_API_BASE_URL), so closures cannot be saved.')
  const response = await fetch(`${baseUrl}/api/closures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Staff-Key': staffKey },
    body: JSON.stringify(state),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Saving failed (${response.status}).`)
  return body
}

export const canSaveClosures = Boolean(baseUrl)

// The staff key stays only for this browser tab.
export function rememberedStaffKey() {
  try { return window.sessionStorage.getItem(STAFF_KEY_STORE) || '' } catch { return '' }
}
export function rememberStaffKey(key) {
  try { window.sessionStorage.setItem(STAFF_KEY_STORE, key) } catch { /* private mode: ask again next time */ }
}
