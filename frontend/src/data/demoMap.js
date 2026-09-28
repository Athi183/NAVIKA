export const demoMap = {
  building: 'Demo Apartment',
  label: 'PHASE-I DEMO MAP',
  floor: 0,
  coordinate_system: {
    type: 'image_pixel',
    width: 560,
    height: 400,
  },
  locations: [
    { id: 'main-entrance', name: 'Main Entrance', node_id: 'N01' },
    { id: 'foyer', name: 'Foyer', node_id: 'N02' },
    { id: 'dining', name: 'Dining Area', node_id: 'N03' },
    { id: 'kitchen', name: 'Kitchen', node_id: 'N08' },
    { id: 'bedroom-1', name: 'Bedroom 1', node_id: 'N05' },
    { id: 'bedroom-2', name: 'Bedroom 2', node_id: 'N07' },
    { id: 'bedroom-3', name: 'Bedroom 3', node_id: 'N09' },
    { id: 'cse-department', name: 'CSE Department', node_id: 'N05' },
  ],
  nodes: [
    { id: 'N01', name: 'Main Entrance', x: 475, y: 170, floor: 0, type: 'entrance' },
    { id: 'N02', name: 'Foyer', x: 425, y: 185, floor: 0, type: 'junction' },
    { id: 'N03', name: 'Central Dining', x: 305, y: 185, floor: 0, type: 'junction' },
    { id: 'N04', name: 'Left Passage', x: 225, y: 185, floor: 0, type: 'junction' },
    { id: 'N05', name: 'CSE Department', x: 125, y: 100, floor: 0, type: 'destination' },
    { id: 'N06', name: 'Upper Passage', x: 225, y: 100, floor: 0, type: 'junction' },
    { id: 'N07', name: 'Bedroom 2 Entrance', x: 125, y: 275, floor: 0, type: 'destination' },
    { id: 'N08', name: 'Kitchen Entrance', x: 365, y: 115, floor: 0, type: 'destination' },
    { id: 'N09', name: 'Bedroom 3 Entrance', x: 455, y: 275, floor: 0, type: 'destination' },
    { id: 'N10', name: 'Right Passage', x: 400, y: 210, floor: 0, type: 'junction' },
    { id: 'N11', name: 'Kitchen Junction', x: 350, y: 165, floor: 0, type: 'junction' },
    { id: 'N12', name: 'Lower Dining Junction', x: 300, y: 250, floor: 0, type: 'junction' },
  ],
  edges: [
    { from: 'N01', to: 'N02' },
    { from: 'N02', to: 'N03' },
    { from: 'N02', to: 'N10' },
    { from: 'N03', to: 'N04' },
    { from: 'N03', to: 'N11' },
    { from: 'N03', to: 'N12' },
    { from: 'N04', to: 'N05' },
    { from: 'N04', to: 'N07' },
    { from: 'N04', to: 'N06' },
    { from: 'N06', to: 'N05' },
    { from: 'N11', to: 'N08' },
    { from: 'N12', to: 'N10' },
    { from: 'N10', to: 'N09' },
  ],
}

export const demoDestinations = [
  'Main Entrance',
  'CSE Department',
  'Library',
  'Laboratory Block',
  'Auditorium',
  'Administration Office',
  'Sports Complex',
]

export const demoRouteNodes = ['N01', 'N02', 'N03', 'N04', 'N05']

export const demoRoute = {
  source: 'Main Entrance',
  destination: 'CSE Department',
  algorithm: 'astar',
  distance: 52.4,
  floor_changes: 1,
  path: [
    { id: 'N01', x: 475, y: 170, floor: 0, label: 'Main Entrance' },
    { id: 'N02', x: 425, y: 185, floor: 0, label: 'Foyer' },
    { id: 'N03', x: 305, y: 185, floor: 0, label: 'Central Dining' },
    { id: 'N04', x: 225, y: 185, floor: 0, label: 'Left Passage' },
    { id: 'N05', x: 125, y: 100, floor: 0, label: 'CSE Department' },
  ],
  steps: [
    'Start at Main Entrance',
    'Continue through corridor',
    'Turn at junction',
    'Take staircase',
    'Continue to destination',
    'Arrive at CSE Department',
  ],
}
