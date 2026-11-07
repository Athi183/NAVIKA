# NAVIKA

NAVIKA is a smart campus assistant and indoor-navigation kiosk for MITS. It is
installed at reception in the M. George Block. Visitors can either **ask about
the campus** (a RAG assistant with voice) or **find a place** (shortest walking
route from the kiosk, shown in 3D with a person walking it).

## Repository map

```text
NAVIKA_MAIN_PROJECT/
├── frontend/                React kiosk app: Home, Ask NAVIKA, Navigation, phone route page
│   ├── public/data/         Data the app loads at runtime (MGeorge_nav/, MGeorge_DXF/;
│   │                        Ramanujan_F*/ is copied in from ramanujan-viewer/ on dev/build)
│   └── src/                 pages/, components/, services/ (mgeorgeRoute.js = kiosk routing)
├── backend/                 Flask API (backend/app.py → /api/chat) and navigation algorithms
│   └── navigation/          graph.py, dijkstra.py, tests, DXF tools
├── interaction/             Voice pipeline: speech-to-text, NLU, context, text-to-speech
├── rag/                     RAG assistant: crawl + ingest → FAISS vector store → Groq answers
├── ramanujan-viewer/        Ramanujan Block 3D floor viewer (separate Vite + TypeScript app);
│                            public/data/ is the source of the Ramanujan floor data
├── scripts/                 Data pipelines (DXF/IFC → JSON); scripts/inspection/ = one-off checks
├── data/
│   ├── original_sources/    Original CAD/BIM/PDF drawings (DXF, IFC, RVT, RFA, PDF)
│   ├── navigation/          Hand-reviewed kiosk destinations (names, positions, confidence)
│   ├── college/             core_facts.json (used by rag/)
│   └── campus_demo/         Early demo map
├── inspection_navigation/   Review images and audit JSON for the generated geometry
├── knowledge_base/          Source inventory for the assistant
└── docs/                    Guides (see below)
```

| Area | Maintainers |
|---|---|
| `frontend/`, `backend/`, kiosk navigation | Athira |
| `rag/` | Anna, Esha |
| `interaction/` | Esha |
| `ramanujan-viewer/`, `scripts/`, `inspection_navigation/` | Fathima |

`rag/` and `interaction/` locate their files relative to their own folder
(`rag/` also reads `data/college/core_facts.json`), so keep these folders where
they are.

## Requirements

- Node.js 18+ and npm
- Python 3.10+
- Chrome or Edge, for browser speech recognition and WebGL (3D)

## Python environment (one for everything)

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt     # backend + rag + interaction + drawing pipelines
```

`requirements.txt` combines `backend/`, `rag/` and `interaction/` requirements
with the DXF/IFC pipeline packages. Never commit `.venv/`.

## Run the kiosk app

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173 (also reachable on the LAN)
```

- `/navigation` is the kiosk route finder. The kiosk is the fixed start point.
- `/navigation?to=mg1_tagore_library` opens a route directly.
- `/navigation?view=indoor|mgeorge|campus` shows the earlier Ramanujan, M. George and campus visualisations.
- `npm run build` builds for production and `npm run lint` checks the code.

For phone and QR testing, open the LAN URL that Vite prints
(`http://192.168.x.x:5173/`), not `localhost`. The phone must be on the same
network.

## Run the backend (chat API)

`backend/app.py` serves `/api/health`, `/api/chat` and `/api/reset` on port 8000.
Each chat goes through `interaction/` (cleaning, intent, follow-ups) and then
`rag/app.py` (answer):

```bash
.venv/bin/python backend/app.py
```

For the kiosk to use the real assistant instead of demo answers, create
`frontend/.env.local` (git-ignored) containing `VITE_API_BASE_URL=http://localhost:8000`.
The kiosk dev server also proxies `/api` to `http://127.0.0.1:8000`; set
`NAVIKA_BACKEND_URL` to point it somewhere else.

## RAG assistant

`rag/ingest.py` crawls and loads the college sources and builds the FAISS index
in `rag/vectorstore/`. `rag/app.py` retrieves matching passages and asks the
Groq model. Put the key in an untracked `.env`:

```env
GROQ_API_KEY=your_key_here
```

Rebuild the vector store whenever the college content changes:

```bash
python rag/ingest.py --recrawl
```

(omit `--recrawl` to rebuild from the cached crawl instead of re-fetching the
site). `rag/vectorstore/` is not committed, and `rag/crawl_cache.pkl` stores
the raw crawl so the index can be rebuilt without crawling again. Never
commit secrets.

`backend/app.py` wires the RAG assistant to the kiosk: it serves
`/api/chat` (through `interaction/`), plus instant, LLM-free
`/api/faculty`, `/api/placements` and `/api/departments` endpoints that
parse the crawled source data directly for the kiosk's structured Find a
Teacher, Placements and Departments pages.

The chat's route buttons use a SQLite destination catalog generated from the
kiosk's navigation JSON:

```bash
python rag/build_place_index.py
```

`rag/ingest.py` rebuilds this catalog before embedding its destination records.
Rebuild it after regenerating navigation data, then rebuild the RAG index so
retrieval also reflects the current destinations. The chat returns matching
destination IDs; `/navigation?to=<place_id>` remains responsible for routing.

## Interaction (voice) pipeline

1. `stt.py` records microphone speech.
2. `preprocess.py` cleans the text.
3. `nlu.py` finds the intent and entities.
4. `context.py` resolves follow-up questions.
5. `main.py` sends the structured query to RAG.
6. `tts.py` speaks the answer.

The Python microphone path is separate from the browser's microphone input.

## Ramanujan 3D viewer

```bash
cd ramanujan-viewer
npm install
npm run dev
```

Its data in `ramanujan-viewer/public/data/` comes from `scripts/extract_floor_walls.py`,
`scripts/generate_floor_regions.py` and related scripts. The kiosk app copies
`Ramanujan_F*` and `floor_slab_footprints.json` from there automatically
(`npm run sync:ramanujan`, run before `dev` and `build`). Edit the viewer's
copy, never the kiosk's.

## Kiosk navigation data

```bash
.venv/bin/python scripts/build_mgeorge_nav_graph.py --preview inspection_navigation/mgeorge_floor01_walkable_preview.png
cd backend/navigation && ../../.venv/bin/python test_mgeorge_graph.py
```

See [docs/MGEORGE_KIOSK_NAVIGATION.md](docs/MGEORGE_KIOSK_NAVIGATION.md) for how
the walkable graph is built from the DXF and how to review destinations.

## Configuration

`frontend/.env` (optional). Never put private keys in `VITE_*` variables,
because Vite includes them in the browser bundle.

```env
VITE_API_BASE_URL=http://localhost:8000     # real chat backend; omit for demo answers
VITE_ENABLE_CHAT_DEMO_MODE=true             # force demo answers even with a backend URL
```

## Troubleshooting

- **npm cannot find package.json:** run npm inside `frontend/` (kiosk) or
  `ramanujan-viewer/` (viewer). The repo root has no `package.json`.
- **Assistant gives demo answers:** start the backend and add
  `frontend/.env.local` as described above.
- **Voice input unavailable:** use Chrome or Edge, allow the microphone, and
  open the app on `localhost` or HTTPS. Typed input always works.
- **3D view blank:** the browser or GPU has WebGL disabled. Enable hardware
  acceleration; the route steps still show as text.
- **QR code does not open on a phone:** use the LAN URL, keep the phone on the
  same network, and allow the port through the firewall.

## Docs

- [docs/MGEORGE_KIOSK_NAVIGATION.md](docs/MGEORGE_KIOSK_NAVIGATION.md): kiosk routing pipeline and review steps
- [docs/RAMANUJAN_DXF_MULTIFLOOR.md](docs/RAMANUJAN_DXF_MULTIFLOOR.md): Ramanujan multi-floor DXF processing
- [docs/CODEX_HANDOFF_REPORT.md](docs/CODEX_HANDOFF_REPORT.md): CAD-to-3D methodology and data caveats
- [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md): original architecture guide (Phase-I demo)
- [data/original_sources/README.md](data/original_sources/README.md): what the source drawings are
