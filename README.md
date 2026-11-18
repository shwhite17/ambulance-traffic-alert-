# 🚑 Ambulance Traffic Alert

Every traffic officer on an ambulance's route gets a loud, glanceable alert about **60 seconds or 500 m before** the ambulance reaches their junction, so the lane is clear before it arrives. If an officer doesn't acknowledge within 10 seconds, a backup officer and the control room are alerted.

It needs only phones and browsers. No signal hardware, so it is affordable for cities without "smart" signals.

> **Honest limits:** this alerts humans; it does not control traffic signals. GPS drifts. "Time saved" figures come from the simulator and are labeled as estimates.

GoDaddy Inclusive Innovation Hackathon 2026.

## What's real vs mocked

| | |
|---|---|
| ✅ Real | Route-distance + ETA alert engine, per-junction state machine, 10 s escalation, live officer / driver / hospital / control-room views over WebSockets, real phone GPS, route simulator through the same pipeline, trip summary and audit log |
| 🟡 Seeded | Routes are real roads from OpenStreetMap/OSRM (Bengaluru: Marathahalli → Manipal Hospital Old Airport Rd, 5.8 km; Pune: Hadapsar → Ruby Hall Clinic, 8.9 km). Junctions are real intersections on those routes, but names are generic and officer assignments, accounts and ambulances are seeded. "Time saved" is an estimate. |
| 🔵 Planned | Signal-controller integration, SMS/WhatsApp fallback, ad-hoc corridors for any route, auto-detecting signals from map data, multi-ambulance coordination, native app with background GPS |

## How it works

```
Driver phone ─GPS every 2 s─▶ Location pipeline ─▶ Alert engine ─▶ Socket.IO ─▶ Officer phones
 (or simulator)               reject bad fixes      per junction:                Hospital desk
                              snap to route         PENDING → ALERTED            Control room
                              rolling speed           → ACKNOWLEDGED → PASSED
                                                      ↘ ESCALATED (no ack in 10 s)
```

- **Distance is measured along the route, not straight-line**, so a parallel road or a U-turn can't trigger a false alert.
- **Trigger: distance ≤ 500 m OR ETA ≤ 60 s.** A fast ambulance alerts earlier (about 1.5 km out at 90 km/h) and a slow one at 500 m.
- **Speed is trusted only over a window of 3 s or more.** Shorter windows let GPS jitter inflate speed and fire alerts too early.
- **Idempotent:** one alert per junction per trip. Duplicate acks are ignored. Reconnecting clients get a full state snapshot.
- **No AI in the alert path.** It is a rules and state-machine problem, and it is safety-critical.

## Run locally

Requires Node.js 22.13+ (uses the built-in `node:sqlite`).

```bash
npm install
npm run dev          # API on :4000, web app on :5173
```

Open http://localhost:5173 and press **Run live demo**.

| Command | |
|---|---|
| `npm test` | Geometry, pipeline, state machine, and a scripted full-route simulator run |
| `npm run typecheck` | Server + client |
| `npm run build && npm start` | Production: one process serves API + web app on `PORT` (default 4000) |

**Demo accounts** (password `demo1234`; the login screens also offer one-tap demo sign-in):
`control@demo.in` · `driver.blr@demo.in` · `driver.pune@demo.in` · `hospital.blr@demo.in` · `hospital.pune@demo.in` · `officer.blr-j1@demo.in` … `officer.blr-j5@demo.in` · `officer.pun-j1@demo.in` … `officer.pun-j6@demo.in` · `backup.blr@demo.in` · `backup.pune@demo.in`

**Testing on a real phone:** browsers only allow GPS on HTTPS (or localhost). Deploy, or tunnel the dev server (for example `cloudflared tunnel --url http://localhost:5173`). Live-GPS alerts fire only on the seeded routes for now.

## Demo script (~3 min)

1. **Problem:** "Officers hear the siren too late." Press **Launch live demo**. The command centre opens with the map, the junction corridor and the officer app live in a phone frame. Turn **Sound** on.
2. **Dispatch simulated ambulance** (40 km/h). The amber alert zone runs ahead of the ambulance; Junction 1 enters it, the phone turns red with a siren → **Acknowledge** → "Clear the lane".
3. **Escalation:** press **Next junction**, and *don't* acknowledge. After 10 s the corridor shows ESCALATED and **Acknowledge as backup** appears; the escalations counter goes up.
4. **ETA logic:** switch to 90 km/h. The alert zone stretches to about 1.5 km and the HUD switches to "ETA rule". The event feed names the rule that fired.
5. Show the **hospital** view (ETA, "Team ready") and an officer's **phone** view at `/officer`.
6. **Stop** → trip summary: response times, escalations, zero stops, and the clearly labeled *simulated* time saved.
7. **Close honestly:** we alert humans and don't control signals. Next steps: official integration, SMS fallback, signal detection from map data.

## Deploy

The one hard hosting requirement is **long-lived connections** (WebSockets; Socket.IO falls back to long-polling). Any Node host or a VPS works:

- **Node host:** build command `npm ci && npm run build`, start command `npm start`, and set `JWT_SECRET`, `NODE_ENV=production`, and `DB_PATH` on a persistent disk.
- **Docker:** `docker build -t ambulance-alert . && docker run -p 8080:8080 -e JWT_SECRET=… -v ata-data:/data ambulance-alert`. *The Dockerfile has not been test-built yet.*

See `.env.example` for all settings. Active-trip state is in memory, so run **one instance** (Redis would be needed to scale out, 🔵).

## Project layout

```
server/src/domain/    geo.ts · pipeline.ts · alertEngine.ts   (pure, unit-tested)
server/src/services/  catalog.ts · tripService.ts · simulator.ts
server/src/http/      app.ts (REST + validation)      server/src/realtime.ts (Socket.IO)
server/data/          routes.json (regenerate: node scripts/fetch-routes.mjs)
client/src/           pages/ · components/ · lib/
```

Route data © OpenStreetMap contributors, routed with OSRM.
