// Battle screen: plays one Match.
//   level / free : human(s) vs AI or hotseat; every ply is recorded to telemetry.
//   demo         : AI vs AI, with a commentary column and an evaluation bar, and
//                  auto-continues a series (not recorded — it isn't a playtest).
// The shop is the game: each side starts with its king and a purse, and on its
// turn either moves or buys one piece and drops it into its back two ranks.
// Captures pay a bounty (house rule, on by default).
//
// Game feel (Lecture 2) is layered on top without touching the rules: the Match
// state changes first, synchronously, and the effects (fx.js / board.js) only
// *show* it: coins counted between board and purse, ink, stamps, shake. The
// purse display lags the true total by `pendingGold` until the last coin lands.

import { AI_MIN_THINK_MS, AI_PRESETS, FEEL, LEVELS, MATE_VALUE, PIECE_NAMES, PIECE_TYPES, PRICES } from '../../config.js';
import { armyLabel } from '../../core/army.js';
import { Match } from '../../core/game.js';
import { buildFen } from '../../core/placement.js';
import { cleanNickname, NICKNAME_MAX } from '../../core/scores.js';
import { buildSubmission, loadNickname, saveNickname, submitScore } from '../../leaderboard.js';
import { randomSeed } from '../../lib/rng.js';
import { createBoard, piecesFromBoard } from '../board.js';
import { downloadText, fill, formatDuration, h, pieceImg } from '../dom.js';
import { coinPlan, hitStopMs, pieceValue } from '../feel.js';
import { createFx, currentFeel, liftGhost, moveGhost, returnGhost } from '../fx.js';

const REASON_TEXT = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  threefold: 'Threefold repetition',
  'fifty-move': 'Fifty-move rule',
  insufficient: 'Insufficient material',
  resign: 'Resignation',
};
const SIDE = { w: 'White', b: 'Black' };
const STAMP_TEXT = { checkmate: 'Checkmate', stalemate: 'Stalemate', resign: 'Resigns' };
const other = (side) => (side === 'w' ? 'b' : 'w');
const inkOf = (side) => (side === 'w' ? 'ally' : 'enemy'); // White is always the blue side at the bottom
const NO_RECORD = { begin() {}, startBattle() {}, ply() {}, drop() {}, end() {}, abandon() {} };

export function mount(root, ctx, params) {
  const demo = params.mode === 'demo';
  const hotseat = params.opponent === 'hotseat';
  const human = { w: !demo, b: hotseat };
  const presetKey = (side) => (demo ? params.demo.presets[side] : params.aiPreset ?? 'normal');
  const presetOf = (side) => AI_PRESETS[presetKey(side)] ?? AI_PRESETS.normal;
  const level = params.levelId ? LEVELS.find((l) => l.id === params.levelId) : null;
  const settings = ctx.settings.get();
  const rules = params.rules ?? ctx.settings.rules();
  const rec = demo ? NO_RECORD : ctx.recorder;
  const feel = () => currentFeel(ctx.settings);

  rec.begin({
    mode: params.mode,
    levelId: params.levelId ?? null,
    opponent: params.opponent,
    aiPreset: params.aiPreset ?? null,
    budget: params.gold, // starting gold
    playerSide: params.playerSide,
    reusedArmy: !!params.rematch,
    rules,
    // The feel level this session was played at, so playtests can compare Full / Subtle / Off.
    feel: { effects: settings.effects, effective: feel(), sound: settings.sound },
  });
  const startFen = buildFen(params.white.placement, params.black.placement);
  const startReserve = { w: params.white.reserve ?? 0, b: params.black.reserve ?? 0 }; // Match.reserve changes; the leaderboard needs the start
  const match = new Match({
    startFen,
    reserve: startReserve,
    rules: rules.captureBounty ? {} : { bounty: null },
  });
  rec.startBattle({ white: params.white, black: params.black, startFen });
  window.__cbs.match = match;
  const startedAt = performance.now();

  let selected = null;
  let targets = [];
  let thinking = false;
  let ended = false;
  let alive = true;
  let confirmResign = false;
  let promo = null; // { from, to }
  let dropType = null; // shop piece being placed
  let evalWhite = 0; // last AI evaluation, centipawns from White's view (demo)
  let evalShown = 50; // eval bar fill (% White) currently displayed
  const notes = []; // demo commentary, newest first
  // Leaderboard submission (Level 1 wins only): 'idle' | 'sending' | 'done' | 'error'.
  const lb = { state: 'idle', nickname: loadNickname(), error: null, result: null };
  // Gold still "in flight" as coins: the purse shows reserve − pending until the coins land.
  const pendingGold = { w: 0, b: 0 };

  // ---------------------------------------------------------------- layout
  const left = h('aside', { class: 'side-col' });
  const boardWrap = h('div', { class: 'board-wrap' });
  const promoEl = h('div', { class: 'overlay', hidden: true });
  const evalBar = demo ? h('div', { class: 'eval-bar', 'aria-hidden': 'true' }, h('div', { class: 'eval-ghost' }), h('div', { class: 'eval-fill' })) : null;
  const right = h('aside', { class: 'side-col log-col' });
  const modal = h('div', { class: 'modal-backdrop', hidden: true });
  // The economy frames the board: Black's war chest above, White's below.
  const topBank = h('div', { class: 'bank top', dataset: { testid: 'bank-b' } });
  const bottomBank = h('div', { class: 'bank bottom', dataset: { testid: 'bank-w' } });
  const boardCol = h('div', { class: 'board-col' }, topBank, boardWrap, bottomBank, promoEl);
  root.append(
    h('section', { class: `stage battle${demo ? ' demo' : ''}` }, left, h('div', { class: 'center' }, evalBar, boardCol), right),
    modal,
  );
  const plyMeta = []; // per ply: { earned, cost } — shown in the move list
  const bought = { w: [], b: [] }; // purchases made during this battle, per side

  const board = createBoard(boardWrap, {
    orientation: 'w',
    feel,
    canDrag: (sq) => canAct() && match.chess.get(sq)?.color === match.turn(),
    onDragStart: (sq) => select(sq),
    onSquareClick: clickSquare,
    onDrop: (from, to) => attempt(from, to, { dragged: true }),
  });
  const fx = createFx(boardCol, { level: feel });
  const bankOf = (side) => (side === 'w' ? bottomBank : topBank);
  const goldEl = (side) => bankOf(side).querySelector('.bank-gold');

  /** Re-print one purse's number in place (coins land between full repaints). */
  function showGold(side) {
    const el = goldEl(side);
    const v = el?.querySelector('.gv');
    if (!v) return;
    v.textContent = `${match.reserve[side] - pendingGold[side]}`;
    fx.bump(el);
  }

  const canAct = () => !ended && !thinking && !promo && human[match.turn()];

  // ---------------------------------------------------------------- human input
  function select(sq) {
    dropType = null;
    selected = sq;
    targets = match.legalMovesFrom(sq).map((m) => ({ square: m.to, capture: !!m.captured }));
    paintBoard();
    paintPanels();
  }

  function clickSquare(sq) {
    if (!canAct()) return;
    if (dropType) {
      if (targets.some((t) => t.square === sq)) return buyAndDrop(dropType, sq);
      dropType = null;
      targets = [];
    }
    const piece = match.chess.get(sq);
    if (selected && targets.some((t) => t.square === sq)) return attempt(selected, sq);
    if (piece && piece.color === match.turn() && sq !== selected) return select(sq);
    selected = null;
    targets = [];
    paintBoard();
    paintPanels();
  }

  /** @returns {boolean} whether the move was accepted (a rejected drag snaps back) */
  function attempt(from, to, { dragged = false } = {}) {
    if (!canAct()) return false;
    if (!match.legalMovesFrom(from).some((m) => m.to === to)) {
      if (from !== to) {
        ctx.sound.play('illegal');
        board.buzz(to);
      }
      selected = null;
      targets = [];
      paintBoard();
      return false;
    }
    if (match.needsPromotion(from, to)) {
      promo = { from, to };
      paintPromo();
      return true;
    }
    play({ from, to }, { dragged });
    return true;
  }

  function chooseShopPiece(type) {
    if (!canAct()) return;
    if (dropType === type) {
      dropType = null;
      targets = [];
    } else {
      dropType = type;
      selected = null;
      targets = match.legalDropSquares(type).map((square) => ({ square, capture: false }));
    }
    paintBoard();
    paintPanels();
  }

  // ---------------------------------------------------------------- turns
  function buyAndDrop(type, square, { dragged = false } = {}) {
    const lvl = feel();
    const r = match.drop(type, square);
    dropType = null;
    selected = null;
    targets = [];
    plyMeta.push({ cost: r.cost });
    bought[r.color].push({ type, square, cost: r.cost });
    rec.drop({ side: r.color, type, square, cost: r.cost, san: r.san, materialDiff: match.material().diff });
    if (!human[r.color] && !demo) ctx.toast(`The enemy bought a ${PIECE_NAMES[type].toLowerCase()} for ${r.cost} g and dropped it on ${square}.`);
    // The price is counted out of the purse, coin by coin, onto the square.
    const plan = coinPlan(r.cost, lvl);
    if (plan.length) pendingGold[r.color] -= r.cost;
    const kingSq = r.check ? match.kingSquare(match.turn()) : null;
    afterTurn({ drop: square, dragged, onImpact: () => dropImpact(r, kingSq) });
    fx.coins(() => goldEl(r.color), board.squareEl(square), plan, {
      tick: 'leave',
      onCoin: (c) => {
        pendingGold[r.color] += c.value;
        showGold(r.color);
        ctx.sound.play('coin', { index: plan.length - 1 - c.index }); // counting down
      },
    });
    return r;
  }

  /** The bought piece hits the board: stamp thud, ink ring with a printer's mark, the price. */
  function dropImpact(r, kingSq) {
    if (!alive) return;
    if (!r.mate) ctx.sound.play(r.check ? 'check' : 'buy');
    fx.ink(board.squareEl(r.square), inkOf(r.color), { reg: true, big: true });
    board.flash(r.square, `−${r.cost} g`, 'spend');
    if (kingSq && !r.mate) checkStamp(r.color, kingSq);
  }

  function play(move, { dragged = false } = {}) {
    const lvl = feel();
    const r = match.move(move);
    selected = null;
    targets = [];
    plyMeta.push({ earned: r.earned });
    rec.ply({ san: r.san, materialDiff: match.material().diff });
    const value = r.captured ? pieceValue(r.captured) : 0;
    // The bounty is counted into the purse when the coins land, not before.
    const plan = r.earned ? coinPlan(r.earned, lvl) : [];
    if (plan.length) pendingGold[r.color] += r.earned;
    const kingSq = r.check ? match.kingSquare(match.turn()) : null;
    afterTurn({
      from: r.from,
      to: r.to,
      dragged,
      captured: r.captured ? { color: other(r.color), type: r.captured } : null,
      hitStop: hitStopMs(value, r.mate, lvl),
      onImpact: () => moveImpact(r, value, plan, kingSq),
    });
    return r;
  }

  /** The moved piece lands: thock / capture thud, shake by value, ink, coins to the purse, check stamp. */
  function moveImpact(r, value, plan, kingSq) {
    if (!alive) return;
    if (!r.mate) ctx.sound.play(r.check ? 'check' : r.captured ? 'capture' : 'move', { value });
    if (r.captured) {
      fx.shake(value);
      fx.ink(board.squareEl(r.to), inkOf(r.color), { big: value >= FEEL.hitStop.minValue });
    }
    if (r.earned) {
      board.flash(r.to, `+${r.earned} g`, 'gain');
      fx.coins(board.squareEl(r.to), () => goldEl(r.color), plan, {
        tick: 'land',
        onCoin: (c) => {
          pendingGold[r.color] -= c.value;
          showGold(r.color);
          ctx.sound.play('coin', { index: c.index });
        },
      });
    }
    if (kingSq && !r.mate) checkStamp(r.color, kingSq);
  }

  /** "Check" stamped next to the threatened king, in the attacker's ink (full effects only). */
  function checkStamp(attacker, kingSq) {
    if (feel() !== 'full') return;
    fx.stamp('Check', { at: board.squareEl(kingSq), kind: inkOf(attacker), size: 'small', ttl: 900 });
  }

  function afterTurn(animate) {
    const impactMs = paintBoard(animate);
    paintPanels();
    const status = match.status();
    if (status.over) return finish(status, impactMs);
    if (!human[match.turn()]) aiTurn();
  }

  async function aiTurn() {
    thinking = true;
    paintPanels();
    const side = match.turn();
    const preset = presetOf(side);
    const t0 = performance.now();
    const minThink = demo ? params.demo.speedMs : AI_MIN_THINK_MS;
    try {
      const result = await ctx.ai.chooseMove({
        ...match.aiRequest(),
        preset,
        seed: randomSeed(),
        shop: match.reserve[side] > 0 ? { reserve: match.reserve[side] } : null,
      });
      const wait = minThink - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (!alive || ended) return;
      thinking = false;
      evalWhite = side === 'w' ? result.score : -result.score;
      const moveNo = Math.floor(match.plies() / 2) + 1;
      const r = result.drop ? buyAndDrop(result.drop.type, result.drop.square) : play({ from: result.from, to: result.to, promotion: result.promotion });
      if (demo) comment(side, moveNo, result, r);
    } catch (e) {
      ctx.log.error('AI failed', e);
      thinking = false;
      if (alive) ctx.toast('The AI failed to move — resign or go back to the menu.', 'warn');
      paintPanels();
    }
  }

  /** Demo commentary: what the AI saw and why this move is interesting. */
  function comment(side, moveNo, result, r) {
    const bits = [];
    if (result.drop) bits.push(`bought a ${PIECE_NAMES[result.drop.type].toLowerCase()} for ${result.drop.cost} g`);
    if (r.captured) bits.push(`wins a ${PIECE_NAMES[r.captured].toLowerCase()}`);
    if (r.earned) bits.push(`+${r.earned} g bounty`);
    if (result.mate > 0) bits.push(`sees mate in ${result.mate}`);
    if (result.mate < 0) bits.push(`sees it is lost (mate in ${-result.mate})`);
    notes.unshift({
      side,
      text: `${moveNo}${side === 'w' ? '.' : '…'} ${r.san}`,
      who: presetOf(side).label,
      detail: `${result.depth} ply · ${result.nodes.toLocaleString()} positions · ${result.candidates} option${result.candidates === 1 ? '' : 's'} kept${bits.length ? ' — ' + bits.join(', ') : ''}`,
    });
    notes.length = Math.min(notes.length, 40);
    paintPanels();
  }

  function resign() {
    if (ended) return;
    if (!confirmResign) {
      confirmResign = true;
      return paintPanels();
    }
    match.resign(hotseat ? match.turn() : 'w');
    finish(match.status());
  }

  /** @param {number} impactMs when the final move lands (the finale waits for it) */
  function finish(status, impactMs = 0) {
    ended = true;
    thinking = false;
    rec.end({ winner: status.winner, reason: status.reason, pgn: match.pgn(), finalFen: match.fen() });
    paintBoard();
    paintPanels();
    const lvl = feel();
    const at = lvl === 'off' ? 0 : impactMs;
    fx.later(at, () => finale(status));
    if (demo) return demoNext(status);
    setTimeout(() => alive && showResult(status), at + (lvl === 'off' ? 650 : FEEL.finale.resultDelayMs));
  }

  /** End of game: mate thud, the loser's king tips over, a big stamp, the page shakes; paper confetti for a win. */
  function finale(status) {
    const lvl = feel();
    const mate = status.reason === 'checkmate';
    const decisive = status.winner !== null;
    const youWon = decisive && (demo || hotseat || status.winner === 'w');
    if (mate) ctx.sound.play('mate');
    if (!demo) setTimeout(() => alive && ctx.sound.play(youWon ? 'win' : 'lose'), mate && lvl !== 'off' ? 320 : 0);
    if (lvl === 'off') return;
    if (decisive && (mate || status.reason === 'resign')) fx.topple(board.squareEl(match.kingSquare(other(status.winner)))?.querySelector('.piece'));
    fx.stamp(STAMP_TEXT[status.reason] ?? 'Draw', { at: boardWrap, kind: decisive ? inkOf(status.winner) : 'ink', size: 'big' });
    if (mate) fx.shake(MATE_VALUE);
    if (youWon) fx.later(FEEL.finale.stampMs * 0.5, () => fx.confetti());
  }

  function demoNext(status) {
    const series = { ...params.demo.series };
    series.games += 1;
    if (status.winner === 'w') series.w += 1;
    else if (status.winner === 'b') series.b += 1;
    else series.d += 1;
    params.demo.series = series;
    notes.unshift({ side: null, text: `Game ${series.games}: ${status.winner ? `${SIDE[status.winner]} wins` : 'draw'} (${REASON_TEXT[status.reason] ?? status.reason})`, who: '', detail: '' });
    paintPanels();
    if (params.demo.autoNext) setTimeout(() => alive && ctx.go('demo', { continue: { ...params.demo, series } }), 2600);
  }

  // ---------------------------------------------------------------- render
  /** @returns {number} ms until an animated piece lands (0 if none) */
  function paintBoard(animate) {
    // The animation always goes to the board: at feel 'off' it just fires onImpact at once.
    const impactMs = board.render(piecesFromBoard(match.board()), animate);
    board.el.classList.toggle('drop-mode', !!dropType);
    const st = match.status();
    board.highlight({
      selected,
      targets: dropType || settings.showHints ? targets : [],
      zone: dropType ? targets.map((t) => t.square) : [],
      lastMove: match.lastMove(),
      check: st.inCheck && st.reason !== 'resign' ? match.kingSquare(match.turn()) : null,
    });
    if (evalBar) {
      const cp = Math.max(-1000, Math.min(1000, evalWhite)); // ±10 pawns (or mate) fills the bar
      const pct = 50 + cp / 20;
      // A hatched "ghost" marks how far the evaluation just swung, then catches up (a damage-bar trail).
      const [ghost, fillEl] = evalBar.children;
      const up = pct > evalShown;
      const slow = feel() === 'off' ? 'none' : 'height 700ms ease 350ms';
      const fast = feel() === 'off' ? 'none' : 'height 160ms ease-out';
      fillEl.style.transition = up ? slow : fast;
      ghost.style.transition = up ? fast : slow;
      fillEl.style.height = `${pct}%`;
      ghost.style.height = `${pct}%`;
      evalShown = pct;
      evalBar.title = `Evaluation ${(evalWhite / 100).toFixed(1)} for White`;
    }
    return impactMs;
  }

  function paintPromo() {
    promoEl.hidden = !promo;
    if (!promo) return fill(promoEl);
    const color = match.turn();
    fill(
      promoEl,
      h(
        'div',
        { class: 'dialog small' },
        h('h3', {}, 'Promote to'),
        h(
          'div',
          { class: 'promo-row' },
          ['q', 'r', 'b', 'n'].map((t) =>
            h(
              'button',
              {
                class: 'promo-btn',
                type: 'button',
                'aria-label': PIECE_NAMES[t],
                dataset: { testid: `promo-${t}` },
                onclick: () => {
                  const move = { ...promo, promotion: t };
                  promo = null;
                  paintPromo();
                  play(move);
                },
              },
              pieceImg(color, t),
            ),
          ),
        ),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => ((promo = null), paintPromo(), paintBoard()) }, 'Cancel'),
      ),
    );
  }

  /** "Garrison R+B+3P · bought N" / "Bought Q+2P" / "King only, 12 g to spend". */
  function onBoardLabel(side, p) {
    const counts = { q: 0, r: 0, b: 0, n: 0, p: 0 };
    for (const b of bought[side]) counts[b.type] += 1;
    const start = armyLabel(p.army);
    const buys = bought[side].length ? armyLabel(counts) : null;
    if (start !== 'King only') return buys ? `Garrison ${start} · bought ${buys}` : `Garrison ${start}`;
    return buys ? `Bought ${buys}` : 'King only so far';
  }

  function sideBlock(side) {
    const p = side === 'w' ? params.white : params.black;
    const who = demo ? `${SIDE[side]} · ${presetOf(side).label}` : hotseat ? SIDE[side] : side === 'w' ? 'You · White' : `Enemy · ${presetOf('b').label}`;
    const caps = match.captured()[side];
    const mat = match.material();
    const lead = side === 'w' ? mat.diff : -mat.diff;
    const toMove = !ended && match.turn() === side;
    return h(
      'div',
      { class: `side-block ${side === 'w' ? 'ally' : 'enemy'}${toMove ? ' to-move' : ''}` },
      h('div', { class: 'side-head' }, h('span', { class: 'side-name' }, who), lead > 0 ? h('span', { class: 'lead num' }, `+${lead}`) : null),
      h('div', { class: 'side-meta' }, h('span', {}, onBoardLabel(side, p))),
      caps.length ? h('div', { class: 'captures' }, caps.map((t) => pieceImg(side === 'w' ? 'b' : 'w', t, 'cap'))) : null,
    );
  }

  /** Start dragging a shop card; a short click just selects it. */
  function cardPointerDown(e, type) {
    if (!canAct() || e.button > 0) return;
    const start = { x: e.clientX, y: e.clientY };
    const home = e.currentTarget.getBoundingClientRect();
    const lvl = feel();
    const tilt = { x: e.clientX, tilt: 0 };
    let ghost = null;
    // Where would it land? A legal square under the pointer, or (just off the board edge) the nearest one.
    const landing = (x, y) => {
      const sq = board.squareAt(x, y);
      if (sq) return targets.some((t) => t.square === sq) ? sq : null;
      return board.nearestSquare(x, y, targets.map((t) => t.square));
    };
    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      if (!ghost) {
        if (dropType !== type) chooseShopPiece(type);
        const size = boardWrap.getBoundingClientRect().width / 8;
        ghost = h('img', { class: 'drag-ghost', src: `assets/pieces/${match.turn()}${type.toUpperCase()}.svg`, alt: '', style: { width: `${size}px`, height: `${size}px` } });
        liftGhost(ghost, lvl);
        document.body.append(ghost);
      }
      moveGhost(ghost, ev.clientX, ev.clientY, tilt, lvl);
      board.hover(landing(ev.clientX, ev.clientY));
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!ghost) return chooseShopPiece(type); // plain click
      board.hover(null);
      const sq = landing(ev.clientX, ev.clientY);
      if (sq) {
        ghost.remove();
        buyAndDrop(type, sq, { dragged: true });
      } else {
        const onBoard = board.squareAt(ev.clientX, ev.clientY);
        if (onBoard) {
          ctx.sound.play('illegal');
          board.buzz(onBoard);
        }
        returnGhost(ghost, home, lvl); // it goes back in the chest
        dropType = null;
        targets = [];
        paintBoard();
        paintPanels();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** One side's war chest: gold, what it earned and bought, and (for a human on turn) the shop. */
  function bank(side) {
    const gold = match.reserve[side];
    const earned = match.earned()[side];
    const isHuman = human[side];
    const myTurn = canAct() && match.turn() === side;
    const who = demo ? `${SIDE[side]} · ${presetOf(side).label}` : hotseat ? SIDE[side] : side === 'w' ? 'Your war chest' : `Enemy war chest · ${presetOf(side).label}`;
    const head = h(
      'div',
      { class: 'bank-head' },
      h('span', { class: 'bank-who' }, who),
      h('span', { class: `bank-gold num${myTurn && gold > 0 ? ' ready' : ''}` }, h('i', { class: 'coin' }), h('span', { class: 'gv' }, `${gold - pendingGold[side]}`), h('small', {}, ' g')),
      h('span', { class: 'bank-log' }, earned ? `+${earned} g from captures` : rules.captureBounty ? 'captures pay gold' : '', bought[side].length ? ` · bought ${bought[side].map((b) => `${b.type.toUpperCase()}@${b.square}`).join(' ')}` : ''),
    );
    // Cards only for a human side — and in hotseat only for the side to move.
    if (!isHuman || demo || (hotseat && match.turn() !== side)) return [head];
    const droppable = myTurn ? new Set(match.droppableTypes()) : new Set();
    const cards = PIECE_TYPES.map((t) =>
      h(
        'button',
        {
          class: `card${dropType === t ? ' on' : ''}${droppable.has(t) ? '' : ' off'}`,
          type: 'button',
          disabled: !droppable.has(t),
          'aria-pressed': String(dropType === t),
          'aria-label': `Buy a ${PIECE_NAMES[t]} for ${PRICES[t]} gold and drop it into your back two ranks`,
          title: `${PIECE_NAMES[t]}: ${PRICES[t]} gold. Drag onto your back two ranks, or click then click a square.`,
          dataset: { testid: `reinforce-${t}` },
          onpointerdown: (e) => droppable.has(t) && cardPointerDown(e, t),
          onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), chooseShopPiece(t)),
        },
        pieceImg(side, t),
        h('span', { class: 'card-price num' }, `${PRICES[t]} g`),
      ),
    );
    const hint = !myTurn
      ? 'You can buy on your turn.'
      : dropType
        ? `Put the ${PIECE_NAMES[dropType].toLowerCase()} on a gold square. It costs your turn.`
        : gold > 0
          ? 'Drag a piece onto your back two ranks. It costs your turn.'
          : 'Capture pieces to earn gold.';
    return [head, h('div', { class: 'cards', dataset: { testid: 'reinforcements' } }, cards, h('p', { class: 'card-hint' }, hint))];
  }

  function statusText() {
    const st = match.status();
    if (st.over) {
      if (st.winner === null) return `Draw. ${REASON_TEXT[st.reason]}.`;
      const head = demo || hotseat ? `${SIDE[st.winner]} wins` : st.winner === 'w' ? 'You win' : 'You lose';
      return `${head}. ${REASON_TEXT[st.reason]}.`;
    }
    if (thinking) return demo ? `${SIDE[st.turn]} is thinking…` : 'Enemy is thinking…';
    const who = hotseat ? `${SIDE[st.turn]} to move` : 'Your move';
    const canShop = match.droppableTypes().length > 0;
    const verb = canShop ? `${who}: move or buy` : who;
    return st.inCheck ? `${verb}. Check!` : verb;
  }

  function paintPanels() {
    const actions = demo
      ? h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', dataset: { testid: 'demo-stop' }, onclick: () => ctx.go('demo', {}) }, 'Stop demo'))
      : h(
          'div',
          { class: 'actions' },
          ended
            ? h('button', { class: 'btn', type: 'button', onclick: () => showResult(match.status()) }, 'Show result')
            : confirmResign
              ? [
                  h('button', { class: 'btn danger', type: 'button', dataset: { testid: 'resign-confirm' }, onclick: resign }, 'Confirm resign'),
                  h('button', { class: 'btn quiet', type: 'button', onclick: () => ((confirmResign = false), paintPanels()) }, 'Keep playing'),
                ]
              : h('button', { class: 'btn quiet', type: 'button', dataset: { testid: 'resign' }, onclick: resign }, hotseat ? `${SIDE[match.turn()]} resigns` : 'Resign'),
        );
    fill(
      left,
      sideBlock('b'),
      h('div', { class: `status${thinking ? ' thinking' : ''}`, dataset: { testid: 'battle-status' }, role: 'status' }, statusText()),
      sideBlock('w'),
      actions,
    );
    fill(topBank, bank('b'));
    fill(bottomBank, bank('w'));
    topBank.classList.toggle('turn', !ended && match.turn() === 'b');
    bottomBank.classList.toggle('turn', !ended && match.turn() === 'w');
    topBank.classList.toggle('thinking', thinking && match.turn() === 'b');
    bottomBank.classList.toggle('thinking', thinking && match.turn() === 'w');
    bottomBank.classList.toggle('shopping', !!dropType);

    const sans = match.history();
    const rows = [];
    const cell = (i) => {
      if (sans[i] === undefined) return h('span', { class: 'mv' });
      const m = plyMeta[i] ?? {};
      return h(
        'span',
        { class: `mv num${m.cost ? ' buy' : ''}` },
        sans[i],
        m.cost ? h('small', {}, ` −${m.cost}g`) : m.earned ? h('small', { class: 'earn' }, ` +${m.earned}g`) : null,
      );
    };
    for (let i = 0; i < sans.length; i += 2) {
      rows.push(h('li', {}, h('span', { class: 'mv-n num' }, `${i / 2 + 1}`), cell(i), cell(i + 1)));
    }
    const list = h('ol', { class: 'moves' }, rows);
    const title = level ? `Level 1: ${level.name}` : demo ? 'Demo: AI vs AI' : hotseat ? 'Free mode, hotseat' : `Free mode vs ${presetOf('b').label}`;
    if (demo) {
      const s = params.demo.series;
      fill(
        right,
        h('div', { class: 'section-head' }, h('span', {}, title)),
        h(
          'p',
          { class: 'fine' },
          `Both start with a lone king and ${params.gold} gold, and build their armies as they go. ${presetOf('w').label} looks ${presetOf('w').depth} ply ahead and ${presetOf('b').label} looks ${presetOf('b').depth}. The running score shows how much the extra thinking is worth.`,
        ),
        h(
          'table',
          { class: 'series', dataset: { testid: 'demo-series' } },
          h('tr', {}, h('th', {}, `White · ${presetOf('w').label}`), h('th', {}, 'Draws'), h('th', {}, `Black · ${presetOf('b').label}`)),
          h('tr', {}, h('td', { class: 'num' }, s.w), h('td', { class: 'num' }, s.d), h('td', { class: 'num' }, s.b)),
        ),
        h('div', { class: 'section-head sub' }, h('span', {}, 'Commentary')),
        h(
          'ol',
          { class: 'notes' },
          notes.map((n) =>
            h('li', { class: n.side === 'w' ? 'ally' : n.side === 'b' ? 'enemy' : 'result' }, h('b', { class: 'num' }, n.text), n.who ? h('span', { class: 'who' }, ` ${n.who}`) : null, n.detail ? h('span', { class: 'fine' }, n.detail) : null),
          ),
        ),
      );
    } else {
      fill(right, h('div', { class: 'section-head' }, h('span', {}, title)), sans.length ? list : h('p', { class: 'fine' }, 'White moves first.'));
      list.scrollTop = list.scrollHeight;
    }
  }

  // ---------------------------------------------------------------- leaderboard (Level 1 wins)
  /** Only a Level 1 checkmate by the player (not free, demo or hotseat) can go on the leaderboard. */
  const leaderboardEligible = (status) =>
    params.mode === 'level' && !!level && !hotseat && !demo && status.winner === level.playerSide && status.reason === 'checkmate';

  /** Paint the "Submit to the leaderboard" block into `el` from the `lb` state. */
  function paintLeaderboard(el) {
    const moves = Math.ceil(match.plies() / 2);
    const goldLeft = match.reserve[level.playerSide];
    const boardName = presetOf('b').label;
    const head = h(
      'div',
      { class: 'lb-head' },
      h('span', {}, 'Leaderboard'),
      h('span', { class: 'lb-score num', dataset: { testid: 'lb-score' } }, `${moves} moves · ${goldLeft} g left`),
    );
    if (!rules.captureBounty) {
      return fill(el, head, h('p', { class: 'fine', dataset: { testid: 'lb-house-rules' } }, 'Only games with the standard rules are ranked. Turn Capture bounty back on in Settings to post a score.'));
    }
    if (lb.state === 'done' && lb.result) {
      const r = lb.result;
      const line = r.improved
        ? [h('b', { class: 'num' }, `You're #${r.rank} of ${r.total}`), ` on the ${boardName} board.`]
        : [`Your best still stands: `, h('b', { class: 'num' }, `#${r.rank} of ${r.total}`), ` with ${r.best.moves} moves and ${r.best.goldLeft} g.`];
      return fill(
        el,
        head,
        h('p', { class: 'lb-done', role: 'status', dataset: { testid: 'lb-result' } }, line),
        h('button', { class: 'link', type: 'button', dataset: { testid: 'lb-open' }, onclick: () => ctx.go('leaderboard', { ai: params.aiPreset }) }, 'See the leaderboard'),
      );
    }
    const sending = lb.state === 'sending';
    const input = h('input', {
      class: 'lb-name',
      type: 'text',
      name: 'nickname',
      value: lb.nickname,
      maxlength: String(NICKNAME_MAX * 2), // code points vs UTF-16; the real check is cleanNickname
      placeholder: 'Nickname',
      autocomplete: 'nickname',
      spellcheck: 'false',
      'aria-label': 'Nickname for the leaderboard',
      'aria-invalid': lb.error && lb.state !== 'error' ? 'true' : null,
      disabled: sending,
      dataset: { testid: 'lb-nickname' },
      oninput: (e) => (lb.nickname = e.target.value),
    });
    const label = sending ? 'Sending…' : lb.state === 'error' ? 'Retry' : 'Submit';
    return fill(
      el,
      head,
      h(
        'form',
        { class: 'lb-form', onsubmit: (e) => (e.preventDefault(), submitToLeaderboard(el)) },
        input,
        h('button', { class: 'btn', type: 'submit', disabled: sending, dataset: { testid: 'lb-submit' } }, label),
      ),
      lb.error ? h('p', { class: 'lb-error', role: 'alert', dataset: { testid: 'lb-error' } }, lb.error) : null,
      h('p', { class: 'fine' }, `Submitting publishes your nickname and this game's moves on the ${boardName} board.`),
    );
  }

  async function submitToLeaderboard(el) {
    if (lb.state === 'sending') return;
    const check = cleanNickname(lb.nickname);
    if (!check.ok) {
      lb.state = 'idle';
      lb.error = check.error;
      paintLeaderboard(el);
      el.querySelector('input')?.focus();
      return;
    }
    lb.nickname = check.nickname;
    saveNickname(check.nickname);
    lb.state = 'sending';
    lb.error = null;
    paintLeaderboard(el);
    const submission = buildSubmission({ match, reserve: startReserve, levelId: level.id, aiPreset: params.aiPreset ?? 'normal', rules, playerId: ctx.store.playerId, nickname: check.nickname });
    try {
      lb.result = await submitScore(submission);
      lb.state = 'done';
      ctx.sound.play('buy');
    } catch (e) {
      ctx.log.warn('leaderboard submit failed', e?.kind, e?.message);
      // 4xx: the server refused this game or name; say why and let them edit. Otherwise: retry.
      lb.state = e?.kind === 'rejected' ? 'idle' : 'error';
      lb.error = e?.message ?? 'Something went wrong.';
      ctx.toast(e?.kind === 'rejected' ? `Not submitted: ${lb.error}` : lb.error, 'warn');
    }
    if (alive && el.isConnected) paintLeaderboard(el);
  }

  function showResult(status) {
    const s = ctx.store.sessions().at(-1);
    const lbEl = leaderboardEligible(status) ? h('section', { class: 'lb-submit', 'aria-label': 'Submit to the leaderboard', dataset: { testid: 'lb-section' } }) : null;
    if (lbEl) paintLeaderboard(lbEl);
    const win = !hotseat && status.winner === 'w';
    const draw = status.winner === null;
    const title = hotseat ? (draw ? 'Draw' : `${SIDE[status.winner]} wins`) : draw ? 'Draw' : win ? 'Victory' : 'Defeat';
    const ms = performance.now() - startedAt;
    const again = () => ctx.go('battle', { ...params, rematch: true });
    const drops = match.drops();
    modal.hidden = false;
    fill(
      modal,
      h(
        'div',
        { class: `dialog result ${draw ? 'draw' : hotseat || win ? 'win' : 'loss'}`, role: 'dialog', 'aria-modal': 'true', dataset: { testid: 'result-modal' } },
        h('p', { class: 'kicker' }, REASON_TEXT[status.reason] ?? ''),
        h('h2', {}, title),
        h(
          'dl',
          { class: 'facts' },
          h('dt', {}, 'Moves'),
          h('dd', { class: 'num' }, Math.ceil(match.plies() / 2)),
          h('dt', {}, 'Time'),
          h('dd', { class: 'num' }, formatDuration(ms)),
          h('dt', {}, hotseat ? 'White bought' : 'You bought'),
          h('dd', { class: 'num' }, drops.filter((d) => d.color === 'w').map((d) => `${d.type.toUpperCase()}@${d.square}`).join(' ') || 'nothing'),
          h('dt', {}, hotseat ? 'Black bought' : 'Enemy bought'),
          h('dd', { class: 'num' }, drops.filter((d) => d.color === 'b').map((d) => `${d.type.toUpperCase()}@${d.square}`).join(' ') || 'nothing'),
          h('dt', {}, 'Gold earned'),
          h('dd', { class: 'num' }, `${match.earned().w} g / ${match.earned().b} g`),
          s?.attempt ? [h('dt', {}, 'Attempt'), h('dd', { class: 'num' }, `#${s.attempt}`)] : null,
        ),
        lbEl,
        h(
          'div',
          { class: lbEl ? 'actions' : 'actions column' },
          h('button', { class: 'btn primary', type: 'button', dataset: { testid: 'result-rematch' }, onclick: again }, 'Play again'),
          params.mode === 'free' ? h('button', { class: 'btn', type: 'button', dataset: { testid: 'result-change' }, onclick: () => ctx.go('free', {}) }, 'Change purse or opponent') : null,
          h('button', { class: 'btn quiet', type: 'button', dataset: { testid: 'result-menu' }, onclick: () => ctx.go('menu') }, 'Menu'),
        ),
        h(
          'button',
          {
            class: 'link',
            type: 'button',
            dataset: { testid: 'download-data' },
            onclick: () => downloadText(`cbs-playtest-${new Date().toISOString().slice(0, 10)}.json`, ctx.store.exportJSON()),
          },
          'Playtesting for us? Download your play data and send us the file.',
        ),
      ),
    );
    modal.querySelector('[data-testid="result-rematch"]')?.focus();
  }

  paintBoard();
  paintPanels();
  if (!human[match.turn()]) aiTurn();

  return () => {
    alive = false;
    if (!ended) rec.abandon();
    if (window.__cbs.match === match) window.__cbs.match = null;
    fx.destroy();
    board.destroy();
  };
}
