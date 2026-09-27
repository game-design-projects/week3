// Battle screen: plays one Match. Humans move by click or drag; the AI moves
// through ctx.ai (Web Worker). Every ply is recorded to telemetry; the result
// modal offers rematch / change army / menu and a playtest-data download.

import { AI_MIN_THINK_MS, AI_PRESETS, BATTLE_PURCHASES, LEVELS, PIECE_NAMES, PIECE_TYPES, PRICES } from '../../config.js';
import { armyLabel } from '../../core/army.js';
import { Match } from '../../core/game.js';
import { buildFen } from '../../core/placement.js';
import { randomSeed } from '../../lib/rng.js';
import { createBoard, piecesFromBoard } from '../board.js';
import { fill, downloadText, formatDuration, h, pieceImg } from '../dom.js';

const REASON_TEXT = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  threefold: 'Threefold repetition',
  'fifty-move': 'Fifty-move rule',
  insufficient: 'Insufficient material',
  resign: 'Resignation',
};
const SIDE = { w: 'White', b: 'Black' };

export function mount(root, ctx, params) {
  const hotseat = params.opponent === 'hotseat';
  const human = { w: true, b: hotseat };
  const preset = AI_PRESETS[params.aiPreset] ?? AI_PRESETS.normal;
  const level = params.levelId ? LEVELS.find((l) => l.id === params.levelId) : null;

  if (params.reusedArmy) {
    ctx.recorder.begin({
      mode: params.mode,
      levelId: params.levelId ?? null,
      opponent: params.opponent,
      aiPreset: params.aiPreset ?? null,
      budget: params.budget,
      playerSide: params.playerSide,
      reusedArmy: true,
    });
  }
  const startFen = buildFen(params.white.placement, params.black.placement);
  // Unspent gold becomes each HUMAN side's reinforcement reserve (the AI never keeps any).
  const reserveOf = (side) => (BATTLE_PURCHASES && human[side] ? params[side === 'w' ? 'white' : 'black'].reserve ?? 0 : 0);
  const match = new Match({ startFen, reserve: { w: reserveOf('w'), b: reserveOf('b') } });
  ctx.recorder.startBattle({ white: params.white, black: params.black, startFen });
  window.__cbs.match = match;
  const startedAt = performance.now();

  let selected = null;
  let targets = [];
  let thinking = false;
  let ended = false;
  let alive = true;
  let confirmResign = false;
  let promo = null; // { from, to }
  let dropType = null; // reinforcement being placed

  // ---------------------------------------------------------------- layout
  const left = h('aside', { class: 'panel battle-side' });
  const boardWrap = h('div', { class: 'board-wrap' });
  const promoEl = h('div', { class: 'promo', hidden: true });
  const right = h('aside', { class: 'panel battle-log' });
  const modal = h('div', { class: 'modal-backdrop', hidden: true });
  root.append(h('section', { class: 'stage battle' }, left, h('div', { class: 'center' }, boardWrap, promoEl), right), modal);

  const board = createBoard(boardWrap, {
    orientation: 'w',
    canDrag: (sq) => canAct() && match.chess.get(sq)?.color === match.turn(),
    onDragStart: (sq) => select(sq),
    onSquareClick: clickSquare,
    onDrop: (from, to) => attempt(from, to),
  });

  const canAct = () => !ended && !thinking && !promo && human[match.turn()];

  function select(sq) {
    dropType = null;
    selected = sq;
    targets = match.legalMovesFrom(sq).map((m) => ({ square: m.to, capture: !!m.captured }));
    paintBoard();
  }

  function clickSquare(sq) {
    if (!canAct()) return;
    if (dropType) {
      if (targets.some((t) => t.square === sq)) return reinforce(dropType, sq);
      dropType = null;
      targets = [];
    }
    const piece = match.chess.get(sq);
    if (selected && targets.some((t) => t.square === sq)) return attempt(selected, sq);
    if (piece && piece.color === match.turn() && sq !== selected) return select(sq);
    selected = null;
    targets = [];
    paintBoard();
  }

  function attempt(from, to) {
    if (!canAct()) return;
    if (!match.legalMovesFrom(from).some((m) => m.to === to)) {
      if (from !== to) ctx.sound.play('illegal');
      selected = null;
      targets = [];
      return paintBoard();
    }
    if (match.needsPromotion(from, to)) {
      promo = { from, to };
      return paintPromo();
    }
    play({ from, to });
  }

  function chooseReinforcement(type) {
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

  function reinforce(type, square) {
    const r = match.drop(type, square);
    dropType = null;
    selected = null;
    targets = [];
    ctx.recorder.drop({ side: r.color, type, square, cost: r.cost, san: r.san, materialDiff: match.material().diff });
    ctx.sound.play(r.check ? 'check' : 'buy');
    afterTurn(r, null);
  }

  function play(move) {
    const r = match.move(move);
    selected = null;
    targets = [];
    ctx.recorder.ply({ san: r.san, materialDiff: match.material().diff });
    ctx.sound.play(r.check ? 'check' : r.captured ? 'capture' : 'move');
    afterTurn(r, { from: r.from, to: r.to });
  }

  function afterTurn(r, animate) {
    paintBoard(animate);
    paintPanels();
    const status = match.status();
    if (status.over) return finish(status);
    if (!human[match.turn()]) aiTurn();
  }

  async function aiTurn() {
    thinking = true;
    paintPanels();
    const t0 = performance.now();
    try {
      const result = await ctx.ai.chooseMove({ ...match.aiRequest(), preset, seed: randomSeed() });
      const wait = AI_MIN_THINK_MS - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (!alive || ended) return;
      thinking = false;
      play({ from: result.from, to: result.to, promotion: result.promotion });
    } catch (e) {
      ctx.log.error('AI failed', e);
      thinking = false;
      if (alive) ctx.toast('The enemy AI failed to move — you may resign or return to the menu.', 'warn');
      paintPanels();
    }
  }

  function resign() {
    if (ended) return;
    if (!confirmResign) {
      confirmResign = true;
      return paintPanels();
    }
    const side = hotseat ? match.turn() : 'w';
    match.resign(side);
    finish(match.status());
  }

  function finish(status) {
    ended = true;
    thinking = false;
    ctx.recorder.end({ winner: status.winner, reason: status.reason, pgn: match.pgn(), finalFen: match.fen() });
    const youWon = hotseat ? null : status.winner === 'w';
    ctx.sound.play(status.winner === null ? 'lose' : hotseat || youWon ? 'win' : 'lose');
    paintBoard();
    paintPanels();
    setTimeout(() => alive && showResult(status), 650);
  }

  // ---------------------------------------------------------------- render
  function paintBoard(animate) {
    board.render(piecesFromBoard(match.board()), animate);
    board.el.classList.toggle('drop-mode', !!dropType);
    const st = match.status();
    board.highlight({
      selected,
      targets,
      zone: dropType ? targets.map((t) => t.square) : [],
      lastMove: match.lastMove(),
      check: st.inCheck && st.reason !== 'resign' ? match.kingSquare(match.turn()) : null,
    });
  }

  function paintPromo() {
    promoEl.hidden = !promo;
    if (!promo) return fill(promoEl);
    const color = match.turn();
    fill(promoEl, 
      h(
        'div',
        { class: 'promo-card' },
        h('p', {}, 'Promote to'),
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
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => ((promo = null), paintPromo(), paintBoard()) }, 'Cancel'),
      ),
    );
  }

  function armyCard(side) {
    const p = side === 'w' ? params.white : params.black;
    const who = hotseat ? SIDE[side] : side === 'w' ? 'You' : `Enemy · ${preset.label}`;
    const caps = match.captured()[side];
    const mat = match.material();
    const lead = side === 'w' ? mat.diff : -mat.diff;
    const toMove = !ended && match.turn() === side;
    return h(
      'div',
      { class: `army-card ${side === 'w' ? 'ally' : 'enemy'}${toMove ? ' to-move' : ''}` },
      h('div', { class: 'army-head' }, h('span', { class: 'dot' }), h('b', {}, who), lead > 0 ? h('span', { class: 'lead num' }, `+${lead}`) : null),
      h('div', { class: 'army-label' }, armyLabel(p.army)),
      h('div', { class: 'captures' }, caps.length ? caps.map((t) => pieceImg(side === 'w' ? 'b' : 'w', t, 'cap')) : h('span', { class: 'dim' }, 'No captures yet')),
    );
  }

  /** Reinforcement shop for the human side to move (or the player's side while waiting). */
  function reinforcements() {
    const side = hotseat ? match.turn() : 'w';
    if (!BATTLE_PURCHASES || !human[side]) return null;
    const gold = match.reserve[side];
    const myTurn = canAct() && match.turn() === side;
    const droppable = myTurn ? new Set(match.droppableTypes()) : new Set();
    return h(
      'div',
      { class: `reinforce${dropType ? ' active' : ''}`, dataset: { testid: 'reinforcements' } },
      h('div', { class: 'reinforce-head' }, h('b', {}, hotseat ? `${SIDE[side]} reserve` : 'War chest'), h('span', { class: 'purse-value small' }, h('i', { class: 'coin sm' }), h('b', { class: 'num' }, gold))),
      gold > 0
        ? h(
            'div',
            { class: 'reinforce-row' },
            PIECE_TYPES.map((t) =>
              h(
                'button',
                {
                  class: `reinforce-btn${dropType === t ? ' on' : ''}`,
                  type: 'button',
                  disabled: !droppable.has(t),
                  'aria-pressed': String(dropType === t),
                  'aria-label': `Reinforce with a ${PIECE_NAMES[t]} for ${PRICES[t]} gold`,
                  title: `${PIECE_NAMES[t]} · ${PRICES[t]} gold`,
                  dataset: { testid: `reinforce-${t}` },
                  onclick: () => chooseReinforcement(t),
                },
                pieceImg(side, t),
                h('span', { class: 'num' }, PRICES[t]),
              ),
            ),
          )
        : h('p', { class: 'dim small' }, 'Spent. Keep gold unspent when recruiting to call reinforcements mid-battle.'),
      dropType ? h('p', { class: 'small reinforce-hint' }, `Place the ${PIECE_NAMES[dropType].toLowerCase()} on a highlighted square — this uses your turn.`) : null,
    );
  }

  function statusText() {
    const st = match.status();
    if (st.over) {
      if (st.winner === null) return `Draw — ${REASON_TEXT[st.reason]}`;
      return `${hotseat ? SIDE[st.winner] : st.winner === 'w' ? 'Victory' : 'Defeat'} — ${REASON_TEXT[st.reason]}`;
    }
    if (thinking) return 'Enemy is thinking…';
    const who = hotseat ? `${SIDE[st.turn]} to move` : 'Your move';
    return st.inCheck ? `${who} — check!` : who;
  }

  function paintPanels() {
    fill(left, 
      armyCard('b'),
      h('div', { class: `status${thinking ? ' thinking' : ''}`, dataset: { testid: 'battle-status' }, role: 'status' }, statusText()),
      armyCard('w'),
      reinforcements(),
      h(
        'div',
        { class: 'battle-actions' },
        ended
          ? h('button', { class: 'btn', type: 'button', onclick: () => showResult(match.status()) }, 'Show result')
          : confirmResign
            ? [
                h('button', { class: 'btn danger', type: 'button', dataset: { testid: 'resign-confirm' }, onclick: resign }, 'Confirm resign'),
                h('button', { class: 'btn ghost', type: 'button', onclick: () => ((confirmResign = false), paintPanels()) }, 'Keep playing'),
              ]
            : h('button', { class: 'btn ghost', type: 'button', dataset: { testid: 'resign' }, onclick: resign }, hotseat ? `${SIDE[match.turn()]} resigns` : 'Resign'),
      ),
    );
    const sans = match.history();
    const rows = [];
    for (let i = 0; i < sans.length; i += 2) {
      rows.push(h('li', {}, h('span', { class: 'mv-n num' }, `${i / 2 + 1}.`), h('span', { class: 'mv num' }, sans[i]), h('span', { class: 'mv num' }, sans[i + 1] ?? '')));
    }
    const list = h('ol', { class: 'moves' }, rows);
    fill(right, 
      h('p', { class: 'eyebrow' }, level ? `Level 1 · ${level.name}` : hotseat ? 'Free mode · hotseat' : `Free mode · vs ${preset.label}`),
      h('h3', {}, 'Moves'),
      sans.length ? list : h('p', { class: 'dim' }, 'White moves first.'),
    );
    list.scrollTop = list.scrollHeight;
  }

  function showResult(status) {
    const s = ctx.store.sessions().at(-1);
    const win = !hotseat && status.winner === 'w';
    const draw = status.winner === null;
    const title = hotseat ? (draw ? 'Draw' : `${SIDE[status.winner]} wins`) : draw ? 'Draw' : win ? 'Victory' : 'Defeat';
    const ms = performance.now() - startedAt;
    const again = () => ctx.go('battle', { ...params, reusedArmy: true });
    const change = () => (params.mode === 'level' ? ctx.go('setup', { mode: 'level', levelId: params.levelId }) : ctx.go('draft', {}));
    modal.hidden = false;
    fill(modal, 
      h(
        'div',
        { class: `modal result ${draw ? 'draw' : hotseat || win ? 'win' : 'loss'}`, role: 'dialog', 'aria-modal': 'true', dataset: { testid: 'result-modal' } },
        h('p', { class: 'eyebrow' }, REASON_TEXT[status.reason] ?? ''),
        h('h2', {}, title),
        h(
          'dl',
          { class: 'result-stats' },
          h('div', {}, h('dt', {}, 'Moves'), h('dd', { class: 'num' }, Math.ceil(match.plies() / 2))),
          h('div', {}, h('dt', {}, 'Time'), h('dd', { class: 'num' }, formatDuration(ms))),
          h('div', {}, h('dt', {}, hotseat ? 'White' : 'Your army'), h('dd', {}, armyLabel(params.white.army))),
          h('div', {}, h('dt', {}, hotseat ? 'Black' : 'Enemy'), h('dd', {}, armyLabel(params.black.army))),
          s?.attempt ? h('div', {}, h('dt', {}, 'Attempt'), h('dd', { class: 'num' }, `#${s.attempt}`)) : null,
        ),
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { class: 'btn primary', type: 'button', dataset: { testid: 'result-rematch' }, onclick: again }, 'Rematch (same army)'),
          h('button', { class: 'btn', type: 'button', dataset: { testid: 'result-change-army' }, onclick: change }, params.mode === 'level' ? 'Change army' : 'New draft'),
          h('button', { class: 'btn ghost', type: 'button', dataset: { testid: 'result-menu' }, onclick: () => ctx.go('menu') }, 'Menu'),
        ),
        h(
          'button',
          {
            class: 'link-btn',
            type: 'button',
            dataset: { testid: 'download-data' },
            onclick: () => downloadText(`cbs-playtest-${new Date().toISOString().slice(0, 10)}.json`, ctx.store.exportJSON()),
          },
          'Playtesting? Download your play data (JSON) and send it to the designers.',
        ),
      ),
    );
    modal.querySelector('.btn.primary')?.focus();
  }

  paintBoard();
  paintPanels();

  return () => {
    alive = false;
    if (!ended) ctx.recorder.abandon();
    if (window.__cbs.match === match) window.__cbs.match = null;
    board.destroy();
  };
}
