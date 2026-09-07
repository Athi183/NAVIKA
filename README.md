# NAVIKA

NAVIKA is a smart campus assistance and indoor navigation project. It combines a React/Vite frontend demo, Python navigation algorithms, a voice interaction pipeline, and a FAISS-based RAG assistant.

The repository currently contains a complete, runnable Phase-I frontend demo. The Python modules are foundations for production integration; they are not connected to the frontend through a running HTTP API yet.

## Repository Layout

```text
NAVIKA_MAIN_PROJECT/
├── backend/                         # Python navigation foundation
│   └── navigation/                  # Graph, A*, Dijkstra, tests, fixtures
├── data/
│   ├── campus_demo/                 # Demo map JSON and floor-plan image
│   └── college/                     # College source data
├── docs/PROJECT_GUIDE.md            # Detailed architecture and operations guide
├── frontend/                        # React/Vite demo application
│   ├── public/demo_floorplan.png    # Bundled floor-plan image
│   ├── src/pages/                   # Home, assistant, navigation, mobile route
│   ├── src/components/              # UI, map, QR, and layout components
│   ├── src/data/                    # Demo map and chat data
│   └── src/services/                # Chat and navigation service boundaries
├── interaction/                     # STT, preprocessing, NLU, context, TTS
├── rag/                             # FAISS ingestion and RAG assistant
└── README.md
```

## Requirements

- Node.js 18 or newer and npm
- Python 3.10 or newer for Python modules
- Chrome or Edge for browser speech recognition
- Optional microphone and speaker
- Optional WebGL-enabled browser/GPU for experimental 3D view

## Run the Frontend Demo

The frontend has its own `package.json`. Commands must run from `frontend`, or use npm's `--prefix` option.

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL, normally `http://localhost:5173/`.

For phone and QR testing, expose Vite to the local network:

```bash
npm --prefix /home/athira-v/NAVIKA_MAIN_PROJECT/frontend run dev -- --host 0.0.0.0
```

Use the network URL printed by Vite, such as `http://192.168.x.x:5173/`. The phone and computer must share a network. A QR generated from `localhost` cannot be opened by a separate phone.

Build and preview:

```bash
cd frontend
npm run build
npm run preview
```

Lint:

```bash
cd frontend
npm run lint
```

## Frontend Features

### Assistant

The assistant is available at `/assistant`. Demo answers are defined in `frontend/src/data/demoChat.js` and `frontend/src/services/chatApi.js`. Typed questions can be submitted with the button or Enter.

Browser voice input uses `SpeechRecognition` or `webkitSpeechRecognition`. A recognized transcript is automatically submitted through the same handler as typed text. Browser speech synthesis reads NAVIKA responses aloud. If the browser does not expose speech recognition, text chat remains available. Production voice support should use Whisper or another backend STT service.

### Indoor Navigation

The navigation page at `/navigation` provides source and destination selectors, A* and Dijkstra selection, route summary, route steps, a 2D floor-plan map, an optional 3D view, and QR route sharing.

The 2D map renders `demo_floorplan.png` with an SVG route overlay. The existing `x` and `y` route coordinates use the image coordinate system in `frontend/src/data/demoMap.js`.

The 3D view is experimental. If WebGL is disabled by the browser, GPU driver, remote session, or sandbox, it falls back to the same floor-plan image.

### QR and Mobile Route

QR generation encodes an absolute URL such as:

```text
http://192.168.x.x:5173/mobile-route?source=Main%20Entrance&destination=CSE%20Department
```

The mobile route page reads the query parameters and shows route details plus the same floor-plan image and route overlay.

## Demo Navigation Data

The frontend demo is data-driven, but not connected to live campus data. The main source is `frontend/src/data/demoMap.js`, which defines:

- `coordinate_system`: image width and height;
- `nodes`: walkable points with IDs, names, floors, and pixel coordinates;
- `edges`: graph connections;
- `locations`: named destinations mapped to nodes; and
- `demoRoute`: sample path, distance, floor changes, and instructions.

The source image is `data/campus_demo/demo_floorplan.png` and the frontend copy is `frontend/public/demo_floorplan.png`. The image is not automatically analyzed. To use a real campus floor plan, create matching nodes and edges and update the coordinate system.

`frontend/src/services/navigationApi.js` is the replacement point for a real API. Demo mode returns the authored route; live mode can call compatible `/destinations` and `/route` endpoints.

## Python Navigation

`backend/navigation/graph.py` stores nodes and weighted edges. Edge weights default to Euclidean distance from node coordinates. `build_graph()` adds both directions because indoor walking is normally bidirectional. A* and Dijkstra implementations are covered by the navigation tests.

Run tests using the repository environment:

```bash
source .venv/bin/activate
python -m pytest backend/navigation
```

If needed:

```bash
python -m pip install pytest
```

`backend/app.py` and `backend/navigation/navigation_engine.py` are currently empty integration surfaces. They should become the HTTP/API layer for live frontend routing.

## Interaction Pipeline

The `interaction/` directory contains the intended voice-to-answer pipeline:

1. `stt.py` captures microphone speech with SpeechRecognition/PyAudio.
2. `preprocess.py` cleans the text.
3. `nlu.py` identifies intent, confidence, and entities.
4. `context.py` resolves conversational follow-ups.
5. `interaction/main.py` builds a structured query and hands it to RAG.
6. `tts.py` speaks the answer with pyttsx3.

Install dependencies with:

```bash
python -m pip install -r interaction/requirements.txt
```

Python microphone support may require operating-system audio packages. This path is separate from browser microphone input.

## RAG Assistant

`rag/ingest.py` loads source content, `build_vectorstore.py` builds the FAISS index, and `rag/app.py` retrieves relevant documents and calls the Groq model. The generated index is stored in `rag/vectorstore/`.

Install dependencies:

```bash
python -m pip install -r rag/requirements.txt
```

Configure provider credentials in an untracked `.env` file, for example:

```env
GROQ_API_KEY=your_key_here
```

Never commit secrets. Rebuild the vector store when college source content changes. RAG is separate from the frontend until an HTTP endpoint is added.

## Frontend API Configuration

Optional `.env` values:

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_ENABLE_DEMO_MODE=false
```

Without `VITE_API_BASE_URL`, demo mode remains enabled. With an API URL and `VITE_ENABLE_DEMO_MODE=false`, navigation services call the backend. Do not put private keys in `VITE_*` variables because Vite exposes them to the browser bundle.

## Troubleshooting

### npm cannot find package.json

Run from `frontend`, or use:

```bash
npm --prefix /home/athira-v/NAVIKA_MAIN_PROJECT/frontend run dev -- --host 0.0.0.0
```

### Voice input unavailable

Use Chrome or Edge, grant microphone permission, and use `localhost` or HTTPS. Browser speech recognition is not universal; typed assistant input remains available.

### WebGL errors

The app detects unavailable WebGL and shows the image-backed 2D fallback. Enable hardware acceleration only when the experimental 3D tab is needed.

### QR does not open on a phone

Use the Vite network URL, not `localhost`. Keep the phone and computer on the same network and allow the port through the firewall if needed.

### Route is not derived from the image

The image is currently a visual floor-plan layer. Routing uses authored nodes and edges. A production map-import workflow must create graph data from verified campus plans before algorithms can route through it.

## Current Scope and Next Steps

Implemented: runnable React frontend, demo assistant, browser voice input/output, image-backed 2D navigation, WebGL-safe 3D fallback, QR/mobile route flow, and reusable Python graph/RAG foundations.

Still required for production: verified campus floor plans and graph coordinates, a backend HTTP API, live destination data, production STT/TTS, authentication, monitoring, and deployment configuration.

See [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md) for the detailed architecture and modification guide.
