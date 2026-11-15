// Where the sun is over MITS at a given moment, for the whole-campus view's
// light and ground shadows. A standard low-precision solar position (about
// 1 degree), plenty for shading a map.

const RAD = Math.PI / 180
const MIN_ELEVATION_DEG = 12 // below this (dawn, dusk, night) the map keeps a fixed daytime sun

/** Sun azimuth (degrees clockwise from true north) and elevation (degrees) at `date` for `lat`, `lon`. */
export function sunPosition(date, lat, lon) {
  const d = date.getTime() / 86_400_000 - 10_957.5 // days since 2000-01-01 12:00 UTC
  const g = (357.529 + 0.98560028 * d) * RAD // mean anomaly
  const q = 280.459 + 0.98564736 * d // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * RAD // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))
  const dec = Math.asin(Math.sin(e) * Math.sin(L))
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24
  const hourAngle = (gmst * 15 + lon) * RAD - ra
  const phi = lat * RAD
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle))
  const azimuth = Math.atan2(-Math.sin(hourAngle), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(hourAngle))
  return { azimuth: ((azimuth / RAD) + 360) % 360, elevation: elevation / RAD }
}

/**
 * The light's offset for the 3D scene ([x east-on-the-map, y up, z], z = -map y),
 * `distance` metres from the campus, for the sun at `date`. `geo` is the
 * OpenStreetMap fit (campus_osm.json): its matrix turns true east/north into
 * map axes (the map is turned about 180 degrees from north). With the sun
 * low or down, a fixed mid-afternoon sun is used so the map stays readable;
 * `daylight` says which.
 */
export function sceneSun(geo, date = new Date(), distance = 80) {
  const { azimuth, elevation } = geo ? sunPosition(date, geo.lat0, geo.lon0) : { azimuth: 240, elevation: 40 }
  const daylight = elevation >= MIN_ELEVATION_DEG
  const az = (daylight ? azimuth : 240) * RAD
  const el = (daylight ? elevation : 40) * RAD
  const [east, north] = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el)]
  const [[a, b], [c, d]] = geo?.matrix ?? [[1, 0], [0, 1]]
  const scale = Math.hypot(a, c) || 1
  const [mapX, mapY] = [(a * east + b * north) / scale, (c * east + d * north) / scale]
  return { offset: [mapX * distance, Math.sin(el) * distance, -mapY * distance], azimuth, elevation, daylight }
}

/**
 * The moment to light the campus for: now, or `?sun=HH:MM` (Indian time,
 * today) to show another time of day, e.g. for demos.
 */
export function sunMoment(search = window.location.search, now = new Date()) {
  const asked = new URLSearchParams(search).get('sun')
  const match = asked && /^(\d{1,2}):(\d{2})$/.exec(asked)
  if (!match) return now
  // IST is UTC+05:30 all year.
  const ist = new Date(now.getTime() + 330 * 60_000)
  ist.setUTCHours(Number(match[1]), Number(match[2]), 0, 0)
  return new Date(ist.getTime() - 330 * 60_000)
}
