# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.1] - 2026-09-26

### Changed
- The economy now frames the battle: your **war chest** sits under the board (gold, bounty earned, what you bought, and shop cards you can **drag onto your back two ranks**), and the enemy's war chest sits above it, so enemy purchases are visible.
- Economy events show on the board: `+2 g` floats up from a capture square, a bought piece lands with a gold flash and `−3 g`; the move list marks purchases (`B@c1 −3g`) and bounties (`+2g`); the status line says "Your move: move or buy".
- Title page and Level 1 briefing lead with the buy-your-army loop (Recruit → Deploy → Fight and buy) instead of "ordinary chess".

## [0.3.0] - 2026-09-26

### Added
- **Capture bounty:** capturing an enemy piece earns gold (P/N/B 1, R 2, Q 4 — `CAPTURE_BOUNTY` in `src/config.js`), so the battle shop is usable all game, not only with unspent recruit gold.
- **The AI shops too:** its search also scores buying and dropping a piece (e.g. blocking a mate), charging `AI_GOLD_VALUE_CP` per gold so it only spends when it helps.
- **Demo mode (AI vs AI):** identical mirrored armies, different search depths, auto-continuing series with a running score, per-move commentary (depth, positions, purchases, mates seen) and an evaluation bar. Demo games are not recorded.
- **Settings screen:** sound, legal-move dots, coordinates, animations, campaign AI strength, and house rules *buy during the battle* / *capture bounty*; persisted per browser. Sessions record the rules in force (`rules`), and CSV has `battleShop` / `captureBounty` columns.
- E2E tests for settings persistence and demo mode; unit tests for bounty, shop toggle, AI drops and settings.

### Changed
- New visual design: a printed-chess-book style (paper, ink, hairline rules, IBM Plex Serif/Sans/Mono, contents-page menu, square-cornered controls, offset print shadow on dialogs). It replaces the dark gradient/glow theme.
- The battle shop is always visible (when the house rule is on) and shows your gold; bounty gold is announced when you capture.
- Balance version `b3`.

### Fixed
- Result dialog buttons overlapped because a layout class collided with the dashboard's stacked-bar class.

## [0.2.0] - 2026-09-26

### Added
- **Mid-battle purchases (reinforcements):** unspent gold carries into the battle as a war chest; on your turn you may buy a piece and drop it on an empty square of your deployment zone instead of moving (caps counted on the board; a drop can block check, so it can prevent mate or stalemate). Toggle with `BATTLE_PURCHASES` in `src/config.js`.
- Reinforcement panel on the battle screen, gold drop-zone highlight, drops shown as `N@b1` in the move list and PGN.
- Telemetry: each side's `reserve` at battle start, a `drops` list per session, `action: 'drop'` purchase entries; CSV columns `whiteReserve`, `blackReserve`, `drops`.
- `Match.aiRequest()` so the AI replays only the segment since the last drop.
- GitHub Actions workflow (`.github/workflows/publish-itch.yml`): every push to `main` runs the unit tests, builds `dist/`, and publishes it to itch.io (`stevenli-phoenix-work/chass:html5`) via butler, tagged with the commit SHA. Also runnable manually via `workflow_dispatch`.

### Changed
- Balance version bumped to `b2` (new rules); the AI never keeps a reserve (level enemy has none; the draft AI spends its purse).

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
