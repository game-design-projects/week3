# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- GitHub Actions workflow (`.github/workflows/publish-itch.yml`): every push to `main` runs the unit tests, builds `dist/`, and publishes it to itch.io (`stevenli-phoenix-work/chass:html5`) via butler, tagged with the commit SHA. Also runnable manually via `workflow_dispatch`.

## [0.1.0] - 2026-09-26

### Added
- Playable browser prototype **Chess Battle Simulator**: recruit an army with a fixed gold budget, deploy it in your back two ranks, then play standard chess (no castling) against an AI to checkmate.
- Campaign **Level 1 "The Keep"**: 12 gold vs a fixed, visible garrison (K g8, R d8, B e7, P f7 g7 h7); prices Q9 R5 B3 N3 P1, king free; caps = one standard set; pawns deploy on rank 2 only; neither king may start in check.
- **Free mode draft**: alternating one-piece-per-turn draft with pass-to-lock, Black drafts first; vs AI (Recruit / Captain / Warlord) or local hotseat with a hand-off screen between deployments.
- Custom alpha-beta AI with quiescence, iterative deepening, time caps, mate-distance scoring, repetition/50-move draws, mop-up endgame evaluation and a seeded "good-enough move" window per difficulty; runs in a module Web Worker with a main-thread fallback.
- Local-first **playtest telemetry**: per-session records (armies, placements, purchase order, draft log, PGN, material timeline, result and end reason, attempt number, balance version), resilient to blocked or full localStorage; optional `TELEMETRY.endpoint` upload via `sendBeacon`.
- **Playtest data** dashboard: win rate per army composition, piece pick rates, end reasons, learning curve, recent sessions with PGN and final position, JSON/CSV export, JSON import with dedupe.
- "Download your play data" on the result screen for remote (itch.io) testers.
- `tools/simulate.mjs` AI-vs-AI balance simulator and first Level 1 baseline (`docs/balance-sim.md`).
- `tools/serve.mjs` zero-dependency dev server and `tools/build.mjs` (`dist/` for itch.io).
- Unit tests (node:test) for rules, placement, drafting, AI and telemetry; Chrome end-to-end smoke test via playwright-core.
- Cburnett SVG piece set (BSD-3) and vendored chess.js 1.4.0 (BSD-2) with license files.
