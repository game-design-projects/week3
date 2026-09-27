# Level 1 balance (AI vs AI), rules `b4`

> **This is simulated, not human, data.** An AI (the *Captain* preset, 2-ply search) plays the player's side and shops by the same rules, so read these numbers as a rough starting point to check against real playtest telemetry.

**Rules `b4`:** no setup phase. White starts with a lone king on e1 and *N* gold. Black is the Keep garrison (K g8, R d8, B e7, P f7 g7 h7) with 0 gold, and earns only through capture bounties. Each turn a side moves or buys one piece into its back two ranks. Enemy AI `normal`, player AI `normal`, games capped at 160 plies (a game that hits the cap counts as a draw).

```bash
pnpm sim -- --gold 10,12,14,16 --games 6
pnpm sim -- --gold 12 --games 20
```

## Starting gold sweep (6 games each)

```
gold  games   W   D   L   win%  avg plies  first buy
  10      6   2   1   3    33%        123  Q×6
  12      6   5   0   1    83%         49  Q×6
  14      6   2   2   2    33%         85  Q×6
  16      6   3   1   2    50%         69  Q×6
```

## Chosen value: 12 gold (20 games)

```
gold  games   W   D   L   win%  avg plies  first buy
  12     20  13   4   3    65%         91  Q×20
```

End reasons at 12 gold: 16 checkmates, 4 hit the ply cap.

## Observations

- **12 gold gives a winnable but not free first level** for a Captain-strength stand-in: 65% win, 20% draw, 15% loss over 20 games. The 6-game sweep is too noisy to rank 10/14/16 gold (the win rate is not even monotonic in gold), so treat 12 as a starting point for human playtests, not a proven optimum.
- **The simulated player always buys the queen first.** This is the AI's greedy valuation (a 9-gold queen immediately creates threats), not proof that it's right for humans. Whether players discover "threat first, shield second", or get punished for a lone queen, is exactly what the per-purchase telemetry (`drops`, `bought`) should show.
- **Known AI limitation:** the search does not consider the *opponent's* possible purchases. It can leave a piece where a freshly bought enemy rook could take it next turn. The deeper preset still wins the demo series more often, but a human who uses drops tactically can exploit this. Levers if the AI feels too naive: model the opponent's best drop at the first reply ply (costly), or add a small "hanging to a drop" penalty to the evaluation.
- **Levers:** `LEVELS[0].gold`, the enemy AI preset, `CAPTURE_BOUNTY` (bigger bounties make trades snowball faster), `AI_GOLD_VALUE_CP` (how eagerly the AI spends), all in `src/config.js`. Bump `BALANCE_VERSION` when you change any of them.
