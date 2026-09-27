// Recruit + deploy screen.
//   level mode: shop (buy/sell within the level budget) + board with the fixed
//               enemy army; buying drops the piece on a sensible square.
//   free mode : armies come from the draft; deploy only. vs AI the AI deploys
//               first; hotseat: White deploys, hand-off, Black deploys.

import { AI_PRESETS, CAPS, CAPTURE_BOUNTY, LEVELS, PIECE_NAMES, PIECE_TYPES, PRICES } from '../../config.js';
import { armyCost, armyFromPlacement, armyLabel, canBuy, emptyArmy } from '../../core/army.js';
import { addPieceAuto, autoPlace } from '../../core/autoplace.js';
import { isAllowedSquare, movePiece, pieceAt, removeAt, validateMatch } from '../../core/placement.js';
import { createRng, randomSeed } from '../../lib/rng.js';
import { createBoard, piecesFromPlacements } from '../board.js';
import { fill, h, pieceImg } from '../dom.js';

const KING_START = { w: [{ type: 'k', square: 'e1' }], b: [{ type: 'k', square: 'e8' }] };
const REASON = { cap: 'Maximum owned', budget: 'Not enough gold', 'unknown-type': '' };

export function mount(root, ctx, params) {
  const level = params.mode === 'level' ? LEVELS.find((l) => l.id === params.levelId) : null;
  const rng = createRng(randomSeed());
  const budget = level ? level.budget : params.budget;
  const hotseat = params.opponent === 'hotseat';
  const rules = ctx.settings.rules(); // house rules in force for this game
  const aiPreset = level ? ctx.settings.get().campaignAI : params.aiPreset;

  // `side` = whose army is being deployed right now; `placements` = both sides.
  let side = 'w';
  let placements = { w: KING_START.w, b: [] };
  let selected = null;
  let handoff = false;
  let launched = false; // true once we hand over to the battle screen

  if (level) {
    ctx.recorder.begin({ mode: 'level', levelId: level.id, opponent: 'ai', aiPreset, budget, playerSide: 'w', rules });
    placements.b = level.enemy.map((p) => ({ ...p }));
  } else if (!hotseat) {
    placements.b = autoPlace('b', params.armies.b, { rng });
    placements.w = autoPlace('w', params.armies.w, { rng, opponent: placements.b });
  } else {
    placements.w = autoPlace('w', params.armies.w, { rng });
  }

  const army = () => armyFromPlacement(placements[side]);
  const opponentOf = (s) => placements[s === 'w' ? 'b' : 'w'];

  // ---------------------------------------------------------------- layout
  const shop = h('aside', { class: 'side-col shop' });
  const boardWrap = h('div', { class: 'board-wrap' });
  const intel = h('aside', { class: 'side-col intel' });
  const handoffEl = h('div', { class: 'handoff', hidden: true });
  root.append(h('section', { class: 'stage setup' }, shop, h('div', { class: 'center' }, boardWrap, handoffEl), intel));

  const board = createBoard(boardWrap, {
    orientation: side,
    canDrag: (sq) => !!pieceAt(placements[side], sq),
    onDragStart: (sq) => {
      selected = sq;
      paint();
    },
    onSquareClick: clickSquare,
    onDrop: (from, to) => {
      selected = from;
      tryMove(from, to);
    },
  });

  function clickSquare(sq) {
    const mine = pieceAt(placements[side], sq);
    if (selected && selected !== sq) {
      if (tryMove(selected, sq)) return;
    }
    selected = mine && selected !== sq ? sq : null;
    paint();
  }

  function tryMove(from, to) {
    const piece = pieceAt(placements[side], from);
    const target = pieceAt(placements[side], to);
    if (!piece) return false;
    const fits = isAllowedSquare(side, piece.type, to) && (!target || isAllowedSquare(side, target.type, from));
    if (!fits || pieceAt(opponentOf(side), to)) {
      ctx.sound.play('illegal');
      selected = null;
      paint();
      return false;
    }
    placements[side] = movePiece(placements[side], from, to);
    selected = null;
    ctx.sound.play('move');
    paint();
    return true;
  }

  function buyPiece(type) {
    const check = canBuy(army(), type, budget);
    if (!check.ok) return ctx.sound.play('illegal');
    const next = addPieceAuto(side, placements[side], type, { opponent: opponentOf(side) });
    if (!next) {
      ctx.toast(type === 'p' ? 'No free square on rank 2 — move a piece to rank 1 first.' : 'No free square in your zone.', 'warn');
      return ctx.sound.play('illegal');
    }
    placements[side] = next;
    ctx.recorder.purchase(side, 'buy', type);
    ctx.sound.play('buy');
    paint(type);
  }

  function sellPiece(type) {
    const mine = placements[side].filter((p) => p.type === type);
    if (!mine.length) return;
    // Sell the selected piece if it is of this type, else the most recently placed one.
    const victim = mine.find((p) => p.square === selected) ?? mine[mine.length - 1];
    placements[side] = removeAt(placements[side], victim.square);
    if (selected === victim.square) selected = null;
    ctx.recorder.purchase(side, 'sell', type);
    ctx.sound.play('sell');
    paint();
  }

  function autoArrange() {
    placements[side] = autoPlace(side, army(), { rng, opponent: opponentOf(side) });
    selected = null;
    ctx.sound.play('move');
    paint();
  }

  function clearArmy() {
    for (const p of placements[side]) if (p.type !== 'k') ctx.recorder.purchase(side, 'sell', p.type);
    placements[side] = KING_START[side].map((p) => ({ ...p }));
    selected = null;
    ctx.sound.play('sell');
    paint();
  }

  function start() {
    if (hotseat && side === 'w') {
      handoff = true;
      paint();
      return;
    }
    const res = validateMatch(placements.w, placements.b);
    if (!res.ok) return ctx.sound.play('illegal');
    launched = true;
    ctx.go('battle', {
      mode: params.mode,
      levelId: level?.id ?? null,
      opponent: level ? 'ai' : params.opponent,
      aiPreset,
      rules,
      playerSide: hotseat ? null : 'w',
      budget,
      white: sideParams('w'),
      black: sideParams('b'),
    });
  }

  /** Army + placement + unspent gold (the battle reserve) for one side. */
  function sideParams(s) {
    const a = armyFromPlacement(placements[s]);
    const reserve = level ? (s === 'w' ? budget - armyCost(a) : 0) : budget - armyCost(params.armies[s]);
    return { army: a, placement: placements[s], reserve: Math.max(0, reserve) };
  }

  function continueHandoff() {
    handoff = false;
    side = 'b';
    placements.b = autoPlace('b', params.armies.b, { rng, opponent: placements.w });
    board.setOrientation('b');
    selected = null;
    paint();
  }

  // ---------------------------------------------------------------- render
  function paint(justBought) {
    const res = validateMatch(placements.w, placements.b.length ? placements.b : KING_START.b);
    const sideErrors = res.errors.filter((e) => !(hotseat && side === 'w' && placements.b.length === 0 && e.side === 'b'));
    const zoneType = selected ? pieceAt(placements[side], selected)?.type : null;
    const zone = zoneType
      ? [...boardSquares()].filter((sq) => isAllowedSquare(side, zoneType, sq) && !pieceAt(opponentOf(side), sq))
      : [];
    const pieces = piecesFromPlacements(placements.w, hotseat && side === 'w' ? [] : placements.b);
    board.render(pieces);
    board.highlight({
      selected,
      zone: zone.length ? zone : [...boardSquares()].filter((sq) => isAllowedSquare(side, 'k', sq) && !pieceAt(opponentOf(side), sq)),
      bad: sideErrors.flatMap((e) => (e.code.endsWith('king-attacked') ? [e.square, ...(e.attackers ?? [])] : e.square ? [e.square] : [])),
    });
    board.el.classList.toggle('zone-soft', !zoneType);
    paintShop(justBought);
    paintIntel(sideErrors);
    handoffEl.hidden = !handoff;
    fill(handoffEl, 
      h(
        'div',
        { class: 'dialog small' },
        h('p', { class: 'kicker' }, 'White is deployed'),
        h('h2', {}, 'Pass the device to Black'),
        h('p', {}, 'Black deploys next and can see White’s setup. White still moves first.'),
        h('button', { class: 'btn primary', type: 'button', dataset: { testid: 'handoff-continue' }, onclick: continueHandoff }, 'I am Black — deploy'),
      ),
    );
  }

  function* boardSquares() {
    for (const f of 'abcdefgh') for (let r = 1; r <= 8; r++) yield `${f}${r}`;
  }

  function paintShop(justBought) {
    const spent = armyCost(army());
    const left = budget - spent;
    const header = h(
      'div',
      { class: 'purse' },
      h('div', { class: 'section-head' }, h('span', {}, level ? 'Recruit' : `${side === 'w' ? 'White' : 'Black'} army`), h('span', { class: `num gold${justBought ? ' pop' : ''}` }, `${left} of ${budget} g left`)),
      h('div', { class: 'meter', role: 'presentation' }, h('div', { class: 'meter-fill', style: { width: `${budget ? (spent / budget) * 100 : 0}%` } })),
    );
    if (!level) {
      fill(
        shop,
        header,
        h('p', { class: 'fine' }, 'Your army was drafted. Drag pieces to arrange them, or use Auto-arrange.'),
        h('ul', { class: 'owned' }, PIECE_TYPES.filter((t) => army()[t]).map((t) => h('li', {}, pieceImg(side, t), h('span', { class: 'num' }, `× ${army()[t]}`)))),
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', dataset: { testid: 'auto-arrange' }, onclick: autoArrange }, 'Auto-arrange')),
      );
      return;
    }
    const rows = PIECE_TYPES.map((t) => {
      const check = canBuy(army(), t, budget);
      const owned = army()[t];
      return h(
        'tr',
        { class: `${check.ok ? '' : 'off'}${justBought === t ? ' bought' : ''}` },
        h('td', { class: 'pc' }, pieceImg(side, t, 'shop-piece')),
        h('td', {}, PIECE_NAMES[t]),
        h('td', { class: 'num price' }, `${PRICES[t]} g`),
        h('td', { class: 'num owned-n' }, `${owned}/${CAPS[t]}`),
        h(
          'td',
          { class: 'buy-btns' },
          h('button', { class: 'step', type: 'button', disabled: !owned, 'aria-label': `Dismiss a ${PIECE_NAMES[t]}`, dataset: { testid: `sell-${t}` }, onclick: () => sellPiece(t) }, '−'),
          h(
            'button',
            { class: 'step add', type: 'button', disabled: !check.ok, title: check.ok ? `Recruit a ${PIECE_NAMES[t]}` : REASON[check.reason], 'aria-label': `Recruit a ${PIECE_NAMES[t]} for ${PRICES[t]} gold`, dataset: { testid: `buy-${t}` }, onclick: () => buyPiece(t) },
            '+',
          ),
        ),
      );
    });
    fill(
      shop,
      header,
      h('table', { class: 'price-list' }, h('tbody', {}, rows)),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', type: 'button', dataset: { testid: 'auto-arrange' }, onclick: autoArrange }, 'Auto-arrange'),
        h('button', { class: 'btn quiet', type: 'button', dataset: { testid: 'clear-army' }, onclick: clearArmy }, 'Clear'),
      ),
    );
  }

  function paintIntel(errors) {
    const enemySide = side === 'w' ? 'b' : 'w';
    const enemyArmy = level ? armyFromPlacement(level.enemy) : params.armies[enemySide];
    const myArmy = army();
    const mine = armyCost(myArmy);
    const theirs = armyCost(enemyArmy);
    const total = Math.max(1, mine + theirs);
    const blocking = errors.filter((e) => e.side === side || !e.side || e.code.endsWith('king-attacked'));
    const ready = blocking.length === 0 && !(hotseat && side === 'b' && handoff);
    const past = level
      ? ctx.store
          .sessions()
          .filter((s) => s.mode === 'level' && s.levelId === level.id && s.white)
          .slice(-5)
          .reverse()
      : [];
    const unspent = budget - mine;
    const bounty = rules.captureBounty ? ` Captures earn ${Object.entries(CAPTURE_BOUNTY).map(([t, g]) => `${g} for a ${PIECE_NAMES[t].toLowerCase()}`).join(', ')}.` : '';
    fill(
      intel,
      h('div', { class: 'section-head' }, h('span', {}, level ? `Level 1: ${level.name}` : hotseat ? `Hotseat: ${side === 'w' ? 'White' : 'Black'} deploys` : `Free mode vs ${AI_PRESETS[aiPreset]?.label ?? 'AI'}`)),
      level ? h('p', { class: 'brief' }, level.blurb) : null,
      h(
        'table',
        { class: 'versus' },
        h('tr', { class: 'ally' }, h('th', {}, hotseat ? (side === 'w' ? 'White' : 'Black') : 'You'), h('td', {}, armyLabel(myArmy)), h('td', { class: 'num' }, mine)),
        h('tr', { class: 'enemy' }, h('th', {}, hotseat ? (side === 'w' ? 'Black' : 'White') : 'Enemy'), h('td', {}, armyLabel(enemyArmy)), h('td', { class: 'num' }, theirs)),
      ),
      h('div', { class: 'vs-bar', role: 'presentation' }, h('div', { class: 'vs-ally', style: { width: `${(mine / total) * 100}%` } }), h('div', { class: 'vs-enemy', style: { width: `${(theirs / total) * 100}%` } })),
      h(
        'ol',
        { class: 'rules' },
        h('li', {}, 'Deploy in your back two ranks.'),
        h('li', {}, 'Pawns start on the second rank.'),
        h('li', {}, 'Neither king may start in check.'),
        rules.battleShop ? h('li', {}, `Gold you don't spend can buy pieces during the battle.${bounty}`) : null,
      ),
      blocking.length
        ? h('div', { class: 'problems', role: 'alert' }, blocking.map((e) => h('p', {}, e.message)))
        : h('p', { class: 'ready-note' }, unspent > 0 ? (rules.battleShop ? `${unspent} g carried into battle for the shop.` : `${unspent} g unspent.`) : 'Ready.'),
      h(
        'button',
        { class: 'btn primary wide', type: 'button', disabled: !ready, dataset: { testid: 'start-battle' }, onclick: start },
        hotseat && side === 'w' ? 'Lock in White' : 'Start the battle',
      ),
      past.length
        ? h(
            'div',
            { class: 'past' },
            h('div', { class: 'section-head sub' }, h('span', {}, 'Your last attempts')),
            h(
              'table',
              {},
              past.map((s) => h('tr', { class: s.result }, h('td', {}, s.white.label), h('td', { class: 'res' }, s.result === 'abandoned' ? 'left' : s.result), h('td', { class: 'num fine' }, s.plies ? `${s.plies} plies` : ''))),
            ),
          )
        : null,
    );
  }

  paint();
  return () => {
    // Leaving before the battle (menu, refresh) ends the session as abandoned.
    if (!launched) ctx.recorder.abandon();
    board.destroy();
  };
}
