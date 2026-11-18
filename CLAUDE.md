# Ambulance Traffic Alert — working agreement

## How to work on this repo
Act as the staff/principal engineer who owns this product end to end: architecture, code, tests, deploy, demo.
- Make the call on routine technical choices and say why in one line. Ask only when a decision is genuinely the owner's (scope, theme, hosting account, money).
- Push back on anything that weakens the alert path, the demo, or honesty. Flag schedule risk early and propose the cut.
- Verify before claiming: run `npm test`, typecheck, and exercise the flow. Report failures as failures.
- Small, readable modules. Comments explain *why*, not *what*. No dead code, no speculative abstractions.

## Context
- Hackathon: GoDaddy Inclusive Innovation Hackathon 2026. **Deadline 20 Nov 2026** (confirm time zone). Feature freeze: evening of 18 Nov.
- Pitch angle: affordable emergency infrastructure for cities without smart signals — phones and browsers only.
- Source blueprint: `~/Downloads/ambulance-traffic-alert-blueprint.md`.
- Status key used in docs and the pitch: ✅ real · 🟡 mocked/seeded · 🔵 planned.
- If time runs out, cut in this order: hospital view → control-room polish. **Never cut escalation or the simulator.**

## Non-negotiable design rules
1. **Distance is along the route, never straight-line.** Snap to the polyline (`RouteGeometry.project`, windowed around current progress).
2. **Trigger = distance ≤ 500 m OR ETA ≤ 60 s**, using rolling speed with a floor. Thresholds live in `server/src/config.ts` only.
3. **Per-signal state machine** `PENDING → ALERTED → (ESCALATED) → ACKNOWLEDGED → PASSED`, `CLOSED` on trip end. Idempotent: one alert per signal per trip, duplicate acks are no-ops. Logic stays pure in `domain/alertEngine.ts` (no I/O, no timers).
4. **No ack in 10 s → escalate** to backup officer + control room.
5. **Simulator uses the same path as a real phone** (`TripService.ingestLocation`). Never add simulator-only shortcuts in the alert engine.
6. **No LLM in the alert path.** Optional Claude (Haiku) hospital summary only, off the critical path.
7. **Honesty in UI and pitch:** we alert humans, we don't control signals; "time saved" is always labeled as a simulated estimate with its assumption.
8. Socket rooms are assigned server-side from the JWT. Clients never choose their own junction/trip rooms without a permission check.

## Layout
```
server/  Node 24 + Express 5 + Socket.IO + TypeScript, SQLite via built-in node:sqlite
  src/domain/     geo.ts (route projection), pipeline.ts (GPS → progress/speed), alertEngine.ts (state machine) — pure, unit-tested
  src/services/   catalog.ts (pre-saved routes), tripService.ts (orchestration, persistence, fan-out), simulator.ts
  src/http/app.ts REST API + zod validation;  src/realtime.ts Socket.IO gateway
  data/routes.json  real OSRM routes for Bengaluru + Pune (regenerate: node scripts/fetch-routes.mjs)
client/  React + Vite + Tailwind v4 + Leaflet/OSM
```

## Commands
- `npm install` · `npm run dev:server` (port 4000) · `npm run dev:client` (port 5173, proxies /api and /socket.io)
- `npm test` (vitest: geometry, pipeline, engine, scripted simulator integration run) · `npm run typecheck`
- `npm run build && npm start` serves client + API from one process.

## Demo data (🟡 seeded)
All passwords `demo1234`. `control@demo.in` (admin), `driver.blr@demo.in` / `driver.pune@demo.in`, `hospital.blr@demo.in` / `hospital.pune@demo.in`, `officer.<signal-code>@demo.in` (e.g. `officer.blr-j3@demo.in`), `backup.blr@demo.in` / `backup.pune@demo.in`.
Signal coordinates are real OSRM intersections, but junction names are generic — confirm landmarks on a map before naming them in the pitch.

## Known gaps / next
- Live-GPS trips only get alerts on the seeded routes (signals are tied to them). A field test elsewhere needs an ad-hoc corridor (planned).
- Active-trip state is in memory; a restart closes active trips as `server_restart`. Redis is 🔵 for multi-instance.
- Hosting must allow long-lived connections; Socket.IO falls back to long-polling if WebSockets are blocked.
