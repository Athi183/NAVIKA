import { demoMap, demoDestinations, demoRoute } from '../data/demoMap'

const baseUrl = import.meta.env.VITE_API_BASE_URL || ''
const demoMode = !baseUrl || import.meta.env.VITE_ENABLE_DEMO_MODE !== 'false'

export const isDemoMode = demoMode

export async function getDestinations() {
  if (demoMode) {
    return demoDestinations
  }

  if (!baseUrl) {
    return demoDestinations
  }

  const response = await fetch(`${baseUrl}/destinations`)
  if (!response.ok) {
    throw new Error('Unable to load destinations.')
  }

  return response.json()
}

export async function findRoute(source, destination, algorithm = 'astar') {
  if (!source || !destination) {
    return {
      error: 'No destination found.',
    }
  }

  if (demoMode) {
    return {
      ...demoRoute,
      source,
      destination,
      algorithm: algorithm === 'dijkstra' ? 'dijkstra' : 'astar',
      path: demoRoute.path,
      steps: demoRoute.steps,
      distance: 52.4,
      floor_changes: 1,
    }
  }

  if (!baseUrl) {
    return {
      error: 'NAVIKA is currently running in Demo Mode.',
    }
  }

  const response = await fetch(`${baseUrl}/route?source=${encodeURIComponent(source)}&destination=${encodeURIComponent(destination)}&algorithm=${encodeURIComponent(algorithm)}`)
  if (!response.ok) {
    return {
      error: 'No walkable route could be found between these locations.',
    }
  }

  return response.json()
}

export async function generateRouteSession(route) {
  const source = route.source || 'Main Entrance'
  const destination = route.destination || 'CSE Department'
  const sessionId = `navika-${Date.now()}`
  const routePath = `/mobile-route?source=${encodeURIComponent(source)}&destination=${encodeURIComponent(destination)}`

  return {
    sessionId,
    url: `${window.location.origin}${routePath}`,
    source,
    destination,
    validFor: '59:42',
  }
}

export function getDemoMap() {
  return demoMap
}
