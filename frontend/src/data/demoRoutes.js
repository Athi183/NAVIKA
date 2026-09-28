export const demoRoutes = {
  'Main Entrance': {
    'CSE Department': {
      source: 'Main Entrance',
      destination: 'CSE Department',
      algorithm: 'astar',
      distance: 52.4,
      floor_changes: 1,
      estimatedTime: '~ 2 min',
      path: ['Main Entrance', 'Corridor', 'Staircase', 'First Floor', 'CSE Department'],
    },
  },
  default: {
    source: 'Main Entrance',
    destination: 'CSE Department',
    algorithm: 'astar',
    distance: 52.4,
    floor_changes: 1,
    estimatedTime: '~ 2 min',
    path: ['Main Entrance', 'Corridor', 'Staircase', 'First Floor', 'CSE Department'],
  },
}
