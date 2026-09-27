![Chess Battle Simulator — Level 1 recruit & deploy screen](docs/screenshot.png)

# Chess Battle Simulator

**Recruit an army with a fixed purse of gold. Deploy it. Then play real chess until one king falls.**

A week-3 prototype for NYU Game Design: a point-buy chess game. Each level gives you a budget and shows you the enemy's army; you buy pieces (Queen 9, Rook 5, Bishop 3, Knight 3, Pawn 1, King free), place them in your back two ranks, and then play standard chess against an AI until someone is checkmated. **The shop stays open during the battle.** Your war chest sits right under the board, and you drag pieces from it straight onto your back ranks. Gold you didn't spend is kept, capturing enemy pieces earns bounty gold, and on any turn you can buy a piece and drop it into your deployment zone instead of moving. The AI shops too.

- **Play online:** https://stevenli-phoenix-work.itch.io/chass
- **Play locally:** `pnpm install && pnpm dev`, then open http://localhost:5173 (designed for a 1280×720 desktop window; also works on phones).

## Modes

| Mode | What happens |
|---|---|
| **Campaign · Level 1 "The Keep"** | 12 gold vs a fixed, visible garrison: K g8, R d8, B e7, P f7 g7 h7 (11 gold). Enemy AI plays at *Captain* strength. Checkmate it to win. |
| **Free mode · The Draft** | Both sides get the same budget (8 / 12 / 20 / 39) and alternate buying one piece at a time; passing locks your army. Black drafts first (White moves first). Play the AI (Recruit / Captain / Warlord) or a friend on the same device. |
| **Demo: AI vs AI** | Two AIs get the *same* army in a mirrored position; only their search depth differs (e.g. Warlord, 4 plies, vs Recruit, 1 ply). It plays itself with a running score, commentary for each move (depth, positions searched, purchases, mates seen) and an evaluation bar. It shows the strategy ladder directly: thinking further ahead wins. |
| **Settings** | Sound, legal-move dots, coordinates, animations, campaign AI strength, and two house rules (*buy during the battle*, *capture bounty*). Rule settings are recorded with every session. |
| **Playtest data** | Every session is recorded locally: win rate per army, what players buy, how games end, a learning curve, and the full PGN of each game. Export JSON/CSV, import files from other testers. |

**Rules:** normal chess (via chess.js) with no castling, plus **the battle shop**: unspent gold carries into the battle, captures earn a bounty (pawn/knight/bishop 1, rook 2, queen 4), and on your turn you may spend gold to drop a new piece on an empty square of your deployment zone. The drop is your move for that turn, must respect the per-type caps (counted on the board), and can block a check, so being "mated" while you still have a legal blocking drop is not mate. Deploy in ranks 1–2, pawns on rank 2 only (they can still double-step). Neither king may start in check. Max copies per side = one standard set (1 Q, 2 R, 2 B, 2 N, 8 P). Checkmate wins; stalemate, threefold repetition, the 50-move rule and insufficient material are draws.

## Strategic depth: characteristics used (Lecture 3)

| Characteristic | In this game |
|---|---|
| **Stochasticity** | Deterministic rules, no dice. The only randomness is the AI choosing among near-equal moves, so games vary without luck deciding them. |
| **Observability** | Perfect information. The enemy army is shown *before* you spend, and in the draft every pick is public, so you can plan against what you see. |
| **Time granularity** | Turn-based with no clock. You can think as long as you like, which is where the depth is. |
| **Length of playtime** | A *round* is one battle. A *session* is several attempts at the level, adjusting your army after each one (Rematch or Change army). The *full game* would be a campaign of levels; this prototype has one. |
| **Systems** | *Resources*: gold turns into pieces, now or later. Holding gold trades tempo and board presence for flexibility. Capture bounties turn material into more gold, which is a positive feedback loop the losing side can blunt with well-timed drops. *Combination*: pieces work together (two rooks ladder-mate, the bishop pair, a rook behind a passed pawn). *Conditional*: deployment rules ("if it's a pawn, then rank 2"; "if a king starts in check, you can't begin"). *Feedback loops*: a material lead snowballs through trades. The telemetry → rebalance loop sits on the designer's side. |
| **Single vs multiplayer** | *One-and-a-half player* in the campaign (you vs a non-trivial AI). Competitive local multiplayer in the free-mode hotseat draft. |
| **Dexterity vs strategy** | Zero dexterity, all strategy: thinking ahead, managing resources, and taking risks with your purchases. |
| **Depth vs entropy** | Chess alone is deep but learned by rote. The buy phase adds a structured decision where point values are a useful compression but not a solution, so there is a *strategy ladder* to climb. |

## Heuristics players learn

These are the rules of thumb we expect players to discover. The telemetry exists to check whether they actually do (see the learning curve and the per-army win rates in *Playtest data*).

1. **"Can this army actually checkmate?"** You only win by mate. A lone knight or bishop can't force it, so buy a rook or queen, a minor-piece pair, or pawns that can promote. Leftover gold is wasted gold.
2. **A piece's price is not its worth.** Its value depends on the matchup. The Keep's only bishop is dark-squared (e7), so your pieces on light squares are safe from it. Knights like crowded boards; bishops like open ones.
3. **Aim at the weakness you can see.** The enemy king sits behind f7-g7-h7 with no escape square, which is a back-rank target. Its rook on d8 is the only defender, so overload it with heavy pieces.
4. **Don't deploy where the enemy is already aiming.** Keep your king off the d-file (rook d8) and away from the e7 bishop's diagonals. Put two bishops on opposite colours; the game lets you put them on the same colour, and that is a trap.
5. **Quantity vs quality.** Q+3P has the most concentrated power, but the queen can be chased and traded. Cheaper pieces spread threats and shield the king.
6. **When ahead, simplify, and don't stalemate the lone king.**
7. **Gold in reserve is an answer, not an army. Trades pay.** Every capture refills your purse, so an even trade still earns gold. A war chest lets you plug a hole or block a mate after you've seen the AI's plan, but every drop costs a tempo, and pieces left in the chest don't defend anything. Recruit what the opening needs and bank the rest.
8. *(Draft)* **Counter-pick.** Black picks first, so taking the queen early denies it. Once the other side locks, spend every remaining coin.

A good heuristic, per the lecture, applies at every stage, sits between gut feeling and brute force, and compresses the game state. "Can this army mate?" and "aim at their visible weakness" do that for buying, placing and playing alike.

## Balancing & telemetry

Balancing is the hard part, so the prototype ships with two tools for it:

- **Playtest telemetry (in the game).** Each session records: mode, level, AI level, budget, attempt number, buy time and purchase order (including sells), both armies (label, cost, placement), the draft log, start and final FEN, full PGN, a per-ply material timeline, and the result and end reason (checkmate, resign, stalemate, threefold, 50-move, insufficient, abandoned). Records carry `balanceVersion` so data from different tunings can be separated.
  - **Where it goes:** local-first. Data lives in the browser's localStorage, with nothing sent anywhere. Remote testers (e.g. on itch.io) click **"Download your play data"** on the result screen and send you the JSON; you **Import** it on the Playtest data screen, which dedupes by session id. To collect automatically, set `TELEMETRY.endpoint` in `src/config.js` to a URL that accepts POSTed JSON (sent with `sendBeacon`).
- Mid-battle purchases are recorded too: each side's reserve at the start of the battle, and every drop (ply, piece, square, cost). They also appear as `N@b1` in the PGN.
- **AI-vs-AI simulator:** `pnpm sim -- --games 4 --min-spend 11` plays every affordable army against the Level 1 garrison, with an AI standing in for the player, and prints win/draw/loss per army. See [docs/balance-sim.md](docs/balance-sim.md) for the first baseline.

**Everything tunable lives in [`src/config.js`](src/config.js):** prices, caps, deployment zones, AI presets (search depth, quiescence, randomness window, time cap), the level (budget, enemy army and placement, AI preset) and free-mode budgets. Bump `BALANCE_VERSION` when you change any of them.

## Look and feel

The interface is designed like a printed chess book: warm paper, black ink, hairline rules, IBM Plex Serif/Sans/Mono, one vermilion for the enemy and a deep ink-blue for you. There are no gradients, glows or rounded cards, and the menu is a contents page. All colours and fonts live in `styles/tokens.css`.

## Project layout

```
index.html              entry (static; no build step needed to play)
src/config.js           ← all balance knobs
src/core/               rules: army (prices/caps), placement (zones, FEN, no-start-check),
                        autoplace (placement heuristic), draft + draftAI, game (Match wrapper)
src/ai/                 search.js (alpha-beta + quiescence), evaluate.js, worker.js (Web Worker),
                        client.js, fastchess.js (the only file touching chess.js internals)
src/telemetry/          store (localStorage + export/import), session recorder, stats
src/settings.js         player settings + house rules (persisted per browser)
src/ui/                 board component, sounds, screens (menu, setup, battle, draft, demo, settings, dashboard, howto)
styles/                 tokens.css (design tokens) + main.css
vendor/chess.js         chess.js 1.4.0 (BSD-2), vendored
assets/pieces/          Cburnett SVG pieces (BSD-3)
tools/                  serve.mjs (dev server), build.mjs (dist/ for itch), simulate.mjs (balance sim)
tests/, e2e/            node:test unit tests; Chrome smoke test via playwright-core
```

## Development

```bash
pnpm install         # dev deps only (chess.js pin for the vendor check, playwright-core)
pnpm dev             # http://localhost:5173  (add ?debug=1 for verbose console logs)
pnpm test            # unit tests (node:test)
pnpm test:e2e        # drives your installed Google Chrome headlessly; screenshots → e2e/artifacts/
pnpm sim -- --games 4 --min-spend 11   # balance simulator (flags documented at the top of tools/simulate.mjs)
pnpm build           # dist/ = the folder uploaded to itch.io
```

### CI

Every push to `main` runs `pnpm test` and `pnpm build`, then publishes `dist/` to [itch.io](https://stevenli-phoenix-work.itch.io/chass) via [butler](https://itch.io/docs/butler/) tagged with the commit SHA (`.github/workflows/publish-itch.yml`). Can also be triggered manually from the Actions tab (`workflow_dispatch`).

The AI is a small alpha-beta search written for this game, not Stockfish. That way its strength can be tuned precisely, it handles any army (two queens, no pawns, …), and the simulator runs fast. It uses chess.js's internal move generator (about 40× faster than the public API); those internals are pinned by `tests/fastchess.test.js`.

## Credits

- Rules engine: [chess.js](https://github.com/jhlywa/chess.js) 1.4.0, BSD-2-Clause (`vendor/LICENSE-chess.js.txt`)
- Piece art: Colin M.L. Burnett ("Cburnett"), used under BSD-3-Clause (`assets/pieces/LICENSE.md`)
- Fonts: Cinzel, Inter, JetBrains Mono (Google Fonts, OFL)

---

## Assignment brief & original team notes

This Week’s Prototype
For next class: make a prototype that exhibits strategic depth.
In other words, the more you think about the game the better
you should do. Explain which characteristics you use and which
heuristics are learned.
Don’t go overboard on mechanics or scope!
This is difficult! Playtests with people outside your group
will help.
Use of AI: optionally, yet judiciously. Don’t lose control.

Genre: deck-building game

Issues:
Balancing will be very hard,
Need to have a working game, need to implement enemy AI - question do we want the enemy pieces set or do we want it to randomize each time?
limit where pieces can be placed
limit how many pieces can be bought
1 level to make
can have a free mode where both sides can purchase pieces
you wil generate the game using claude first, I will make edits after

Game Idea:
Chess Battle Simulator
Set levels where you can buy pieces on a chess board, you are given set amount of money to choose which pieces to buy
You are going against an enemy AI who has their ownpieces
You play chess regularly given the pices that you bought and try to checkmate that way

**How the prototype answers the open questions:** the Level 1 enemy army is **fixed and shown** during recruiting, so the level can be learned and the thinking pays off; free mode supplies the variety because the AI drafts a different army each time. Placement is limited to your back two ranks (pawns on rank 2). Buying is limited by the budget and by a standard set's counts.
