# Level 1 balance baseline (AI vs AI)

> **This is simulated, not human, data.** An AI (the *Captain* preset, depth 2) stands in for the player, so read it as a first rough guess to check against real playtest telemetry, not as a verdict.

**Setup:** Level 1 "The Keep" (12 gold vs K g8, R d8, B e7, P f7 g7 h7), balance version `b1`. Enemy AI `normal` (Captain), player AI `normal`. Every army that spends 11–12 gold (31 armies), 4 games each with different auto-placements and seeds. Games were capped at 160 plies; a game that hit the cap counts as a draw.

```bash
pnpm sim -- --games 4 --min-spend 11          # reproduce (≈4 min on an M-series Mac)
pnpm sim -- --armies "Q+3P,2R+2P" --games 20  # dig into specific armies
```

**Totals:** 124 games. White (the player side) won 48 (39%), drew 47 (38%), lost 29 (23%). Endings: 77 checkmates, 40 hit the ply cap, 4 insufficient material, 3 by the fifty-move rule.

```
army            gold  games   W   D   L   win%  avg plies
Q+B               12      4   3   0   1    75%         48
Q+3P              12      4   3   0   1    75%         58
R+7P              12      4   3   1   0    75%        101
R+6P              11      4   3   1   0    75%        115
R+2N              11      4   2   1   1    50%         45
R+2B+P            12      4   2   0   2    50%         89
2R+P              11      4   2   2   0    50%         89
R+B+4P            12      4   2   0   2    50%         94
2R+2P             12      4   2   2   0    50%         94
2B+N+2P           11      4   2   1   1    50%         95
2B+N+3P           12      4   2   1   1    50%         95
2N+6P             12      4   2   2   0    50%        111
R+B+N             11      4   2   1   1    50%        114
R+N+3P            11      4   2   1   1    50%        120
B+8P              11      4   2   1   1    50%        121
R+N+4P            12      4   2   1   1    50%        123
R+2B              11      4   2   1   1    50%        125
2B+5P             11      4   2   2   0    50%        135
R+2N+P            12      4   1   2   1    25%        114
2N+5P             11      4   1   1   2    25%        116
R+B+3P            11      4   1   2   1    25%        120
R+B+N+P           12      4   1   2   1    25%        122
2B+6P             12      4   1   2   1    25%        126
N+8P              11      4   1   2   1    25%        131
B+N+6P            12      4   1   3   0    25%        143
B+2N+2P           11      4   1   3   0    25%        146
Q+2P              11      4   0   1   3     0%         99
B+2N+3P           12      4   0   2   2     0%        127
2B+2N             12      4   0   3   1     0%        140
B+N+5P            11      4   0   3   1     0%        144
Q+N               12      4   0   3   1     0%        154
```

## Observations

- **No single dominant army.** The best results are 3/4 wins (Q+B, Q+3P, R+7P, R+6P), and with n=4 per army the ±25-point swings are mostly noise. Rerun the leaders with `--games 20` before changing prices.
- **The queen is all-or-nothing.** Q+3P and Q+B win quickly (≈50 plies), but Q+2P and Q+N went 0/4. Without a pawn shield or a second attacker, the queen alone doesn't convert against R+B. That matches heuristic #5 in the README (quantity vs quality).
- **Minor-piece armies stall.** 2B+2N, B+N+5P and B+2N+2P draw a lot, often at the ply cap. With a shallow search they can't organise a mate, and a human with a plan should do better. That makes "can this army actually mate?" a real heuristic, not just flavour.
- **Pawn-heavy rook armies do well but slowly** (R+7P, R+6P: 75%, 100+ plies). Promotion is their plan.
- **For a Captain-strength stand-in, the level is winnable but not free** (39% win, 23% loss). A thoughtful human should sit higher, which is the target for a first level. Human telemetry decides from here.
- **Levers if humans find it too easy or too hard:** budget (11–13), the enemy AI preset (`easy` / `hard`), or the enemy layout (e.g. move the rook off d8 to weaken the back-rank defence). All are in `src/config.js`. Bump `BALANCE_VERSION` when you change them.
