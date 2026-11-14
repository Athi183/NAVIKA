// The phone's motion sensors for indoor tracking (see indoorTracker.js).
// Browsers give them only to https pages (and localhost); iPhones also ask the
// visitor, and only in answer to a tap.

/**
 * Ask for motion sensors. Call straight from a tap (iPhone requires it).
 * Resolves to 'granted', 'denied', 'insecure' or 'unavailable'.
 */
export async function requestMotionAccess() {
  if (!window.isSecureContext) return 'insecure'
  const Motion = window.DeviceMotionEvent
  if (!Motion) return 'unavailable'
  if (typeof Motion.requestPermission === 'function') {
    try {
      return (await Motion.requestPermission()) === 'granted' ? 'granted' : 'denied'
    } catch {
      return 'denied'
    }
  }
  return 'granted'
}

/**
 * Call `onSample({ t, ax, ay, az, ra, rb, rg })` for every motion reading (see
 * createMotionDetector). Returns a function that stops listening.
 */
export function watchMotion(onSample) {
  const handler = (event) => {
    const a = event.accelerationIncludingGravity
    if (!a || a.x === null) return
    const r = event.rotationRate ?? {}
    onSample({ t: event.timeStamp, ax: a.x, ay: a.y, az: a.z, ra: r.alpha ?? 0, rb: r.beta ?? 0, rg: r.gamma ?? 0 })
  }
  window.addEventListener('devicemotion', handler)
  return () => window.removeEventListener('devicemotion', handler)
}
