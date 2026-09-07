# NAVIKA

Smart Campus Assistance & Indoor Navigation System

## Frontend demo

This project now includes a React + Vite frontend focused on the Phase-I demo experience.

### Run locally

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

Then open the local Vite URL shown in the terminal.

### Build verification

```bash
cd frontend
npm run build
```

### Demo mode

The interface is configured to run in demo mode by default, with sample AI responses, route data, QR generation, and 2D/3D navigation views. The frontend is structured so the demo layer can later be replaced with real backend APIs via the service layer.

### Main screens

- Home dashboard
- AI assistant conversation UI
- Indoor navigation dashboard
- 2D floor-plan map
- 3D route view
- QR route sharing modal
- Mobile route page
