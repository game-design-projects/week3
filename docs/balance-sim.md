# Level 1 balance (AI vs AI), rules `b5`

> **This is simulated, not human, data.** An AI plays the player's side and shops by the same rules, so read these numbers as a starting point to check against real playtest telemetry.

**Rules `b5`:** no setup phase. White starts with a lone king on e1 and *N* gold. Black is the Keep garrison (K g8, R d8, B e7, P f7 g7 h7) with *M* gold of its own, plus capture bounties. Each turn a side moves or buys one piece into its back two ranks. Enemy AI `normal` (Captain), games capped at 160 plies (a game that hits the cap counts as a draw).

**Chosen: player 16 gold, garrison 5 gold.** (`b4` was 12 vs 0.)

```bash
pnpm sim -- --gold 12,14,16,18 --enemy-gold 0,3,5,8 --games 30
pnpm sim -- --gold 16 --enemy-gold 5 --games 60 --seed 11
pnpm sim -- --gold 16 --enemy-gold 5 --games 40 --player-preset easy   # or hard
```

Why the change: at 12 vs 0 the garrison could only spend bounties, so the enemy almost never used the shop (in the author's playtest it bought exactly one pawn, a check-blocking drop on h7), and a human won comfortably. Giving the garrison a purse makes enemy purchases a real part of every game; the player's purse goes up to compensate.

## Sweep 1: player gold × garrison gold (30 games each, player = Captain)

```
gold  enemy   W   D   L   win%  avg plies  enemy buys/game  enemy first buy
  12      0  17   8   5    57%         96              2.5  P×12 B×7 R×2 N×1
  12      3  10   7  13    33%        106              4.2  B×26 N×4
  12      5   7   1  22    23%         96              4.8  R×15 B×15
  12      8   4   2  24    13%         71              4.8  B×17 R×13
  14      0  19   6   5    63%         78              2.1  P×7 B×6 N×2 R×1
  14      3  11   9  10    37%        105              4.0  B×26 N×4
  14      5  10   4  16    33%         93              4.4  R×16 B×14
  14      8   5   1  24    17%         68              4.5  R×22 B×8
  16      0  22   5   3    73%         80              1.7  B×7 P×6 R×2
  16      3  20   4   6    67%         77              3.2  B×25 N×5
  16      5  13   4  13    43%         82              4.5  B×16 R×14
  16      8  10   2  18    33%         68              4.4  R×16 B×14
  18      0  21   8   1    70%         78              1.6  P×11 B×7 R×1
  18      3  20   3   7    67%         84              3.6  B×26 N×4
  18      5   6   8  16    20%        108              5.9  R×20 B×10
  18      8   7   5  18    23%         85              5.1  R×17 B×13
```

The simulated player bought the queen first in every game.

## Sweep 2: candidates (60 games each, player = Captain, seed 11)

```
gold  enemy   W   D   L   win%  avg plies  enemy buys/game  enemy first buy
  14      4  24  13  23    40%        103              4.6  B×51 N×9
  15      4  29  16  15    48%         92              4.0  B×52 N×8
  16      3  35  11  14    58%         92              3.7  B×55 N×5
  16      4  23  10  27    38%         92              4.9  B×52 N×8
  16      5  30  11  19    50%         83              4.2  R×33 B×27
  17      4  40  11   9    67%         79              3.8  B×54 N×6
```

16 vs 5 over both sweeps: 43 wins in 90 games (**≈48%**) for a Captain stand-in.

## Strategy ladder at 16 vs 5 (enemy always Captain)

```
player stand-in        games   W   D   L   win%
Recruit (1 ply)           40   0   0  40     0%
Captain (2 ply)           90  43  15  32    48%
Warlord (4 ply)           40  36   2   2    90%
```

This is the property the assignment asks for: the more the player thinks ahead, the better they do. The same purse goes from a certain loss to a near-certain win as search depth grows.

## Observations

- **The garrison's purse matters more than the player's.** Each gold for the garrison costs the player roughly as much win rate as 1–2 gold of their own, because the garrison is already developed and can drop a defender exactly where it's needed. 3 gold buys a bishop, 5 buys a rook; the enemy's first buy flips from bishops to rooks at 5.
- **More gold is not always better for the player.** At 18 vs 5 the stand-in did *worse* than at 16 vs 5: it spends more turns buying while the garrison attacks. Tempo is the real price.
- **Noise:** with 30–60 games per cell the standard error is about ±6–9 points, so neighbouring cells (e.g. 16 vs 3/4/5) aren't cleanly ordered. The choice rests on the pooled 90 games plus the ladder, not on any single cell.
- **Humans should do better than the Captain stand-in.** The AI's search doesn't consider the *opponent's* possible purchases, so a human who uses drops tactically (blocking a check, dropping a rook onto an open file) gains an edge the stand-in doesn't have. If real telemetry shows humans winning far more than ~50–60%, raise `enemyGold` to 6–8 before touching the player's gold.
- **Levers:** `LEVELS[0].gold`, `LEVELS[0].enemyGold`, the enemy AI preset, `CAPTURE_BOUNTY`, and `AI_GOLD_VALUE_CP` (how eagerly the AI spends), all in `src/config.js`. Bump `BALANCE_VERSION` when you change any of them.
