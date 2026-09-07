# NAVIKA Project Guide

This guide explains how the project pieces fit together and how to modify the demo safely.

## System Overview

```text
Browser kiosk
  ├── React assistant -> demo chat service or future backend chat API
  ├── React navigation -> demo map service or future route API
  │       ├── floor-plan image + SVG route overlay
  │       ├── optional Three.js visualization
  │       └── QR URL -> mobile route page
  └── browser SpeechRecognition/SpeechSynthesis

Python services
  ├── interaction: microphone -> preprocessing -> NLU -> context -> RAG -> TTS
  ├── rag: source documents -> embeddings -> FAISS -> Groq answer
  └── backend/navigation: map graph -> A*/Dijkstra route calculation
```

## Frontend Request Flow

### Assistant

1. `Assistant.jsx` receives typed or recognized text.
2. `handleAsk()` appends the user message.
3. `chatApi.askNavika()` returns a demo answer.
4. The answer is appended to the conversation.
5. `voiceControls.startVoiceResponse()` optionally speaks it.

Voice recognition is isolated in `chatApi.js`, so the UI can later switch to Whisper or another speech service without rewriting the chat components.

### Navigation

1. `Navigation.jsx` stores source, destination, algorithm, and route state.
2. `navigationApi.findRoute()` returns demo data or calls a future backend.
3. `RouteSummary` and `RouteSteps` display metadata.
4. `Map2D` renders `demo_floorplan.png` and overlays the path using image pixels.
5. `generateRouteSession()` creates an absolute mobile URL.
6. `QRModal` encodes the URL.
7. `MobileRoute` reads the URL parameters and renders the same map experience.

## Map Data Contract

The image and graph must share the same coordinate system:

```js
{
  coordinate_system: { type: 'image_pixel', width: 560, height: 400 },
  nodes: [
    { id: 'N01', name: 'Main Entrance', x: 475, y: 170, floor: 0 }
  ],
  edges: [
    { from: 'N01', to: 'N02' }
  ]
}
```

When replacing the demo image:

1. record the image pixel width and height;
2. update `coordinate_system`;
3. place nodes on corridors, entrances, stairs, lifts, and destinations;
4. connect walkable nodes in `edges`;
5. update `locations` and labels; and
6. verify the route overlay visually in the 2D map.

The image alone is not a routing graph. It supplies visual context; nodes and edges supply the walkable network.

## Route Response Contract

The frontend expects a response shaped approximately like:

```js
{
  source: 'Main Entrance',
  destination: 'CSE Department',
  algorithm: 'astar',
  distance: 52.4,
  floor_changes: 0,
  path: [
    { id: 'N01', x: 475, y: 170, floor: 0, label: 'Main Entrance' }
  ],
  steps: ['Start at Main Entrance', 'Arrive at CSE Department']
}
```

Keep this contract stable so the frontend can switch from demo responses to a backend without rewriting map, QR, or mobile components.

## Demo Mode Rules

Demo mode is the default so the frontend works without a backend. Demo services do not calculate arbitrary routes from the image; they return authored data from `demoMap.js`.

For live integration, implement the backend HTTP surface first, then set `VITE_API_BASE_URL` and disable demo mode. Keep graph algorithms in backend/service modules rather than React components.

## Safe Development Checklist

Before changing map behavior:

- keep image dimensions and node coordinates aligned;
- test the 2D map first;
- test `/mobile-route` directly with query parameters;
- test QR URLs using a LAN address;
- preserve route response fields; and
- run `npm run build` after frontend changes.

Before changing Python services:

- activate the intended virtual environment;
- run navigation tests;
- avoid importing modules that start interactive loops; and
- keep secrets in environment variables, never source files.

## Known Boundaries

- `backend/app.py` is not yet an HTTP server.
- `backend/navigation/navigation_engine.py` is reserved for integration.
- Frontend destinations and instructions are authored sample data.
- Browser speech recognition is not universal.
- Python and browser microphone input are separate implementations.
- RAG requires a built FAISS store and provider credentials.
- 3D visualization requires WebGL; image-backed 2D navigation is the reliable fallback.
