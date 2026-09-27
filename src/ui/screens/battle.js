// Battle screen: plays one Match.
//   level / free : human(s) vs AI or hotseat; every ply is recorded to telemetry.
//   demo         : AI vs AI, with a commentary column and an evaluation bar, and
//                  auto-continues a series (not recorded — it isn't a playtest).
// The shop: on your turn you may buy a piece with your gold (unspent recruit
// money + capture bounties) and drop it into your zone instead of moving.

import { AI_MIN_THINK_MS, AI_PRESETS, LEVELS, PIECE_NAMES, PIECE_TYPES, PRICES } from '../../config.js';
import { armyLabel } from '../../core/army.js';
import { Match } from '../../core/game.js';
import { buildFen } from '../../core/placement.js';
import { randomSeed } from '../../lib/rng.js';
import { createBoard, piecesFromBoard } from '../board.js';
import { downloadText, fill, formatDuration, h, pieceImg } from '../dom.js';

const REASON_TEXT = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  threefold: 'Threefold repetition',
  'fifty-move': 'Fifty-move rule',
  insufficient: 'Insufficient material',
  resign: 'Resignation',
};
const SIDE = { w: 'White', b: 'Black' };
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

  if (params.reusedArmy) {
    rec.begin({
      mode: params.mode,
      levelId: params.levelId ?? null,
      opponent: params.opponent,
      aiPreset: params.aiPreset ?? null,
      budget: params.budget,
      playerSide: params.playerSide,
      reusedArmy: true,
      rules,
    });
  }
  const startFen = buildFen(params.white.placement, params.black.placement);
  const reserveOf = (side) => (rules.battleShop ? params[side === 'w' ? 'white' : 'black'].reserve ?? 0 : 0);
  const match = new Match({
    startFen,
    reserve: { w: reserveOf('w'), b: reserveOf('b') },
    rules: { shop: rules.battleShop, ...(rules.captureBounty ? {} : { bounty: null }) },
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
  const notes = []; // demo commentary, newest first

  // ---------------------------------------------------------------- layout
  const left = h('aside', { class: 'side-col' });
  const boardWrap = h('div', { class: 'board-wrap' });
  const promoEl = h('div', { class: 'overlay', hidden: true });
  const evalBar = demo ? h('div', { class: 'eval-bar', 'aria-hidden': 'true' }, h('div', { class: 'eval-fill' })) : null;
  const right = h('aside', { class: 'side-col log-col' });
  const modal = h('div', { class: 'modal-backdrop', hidden: true });
  // The economy frames the board: Black's war chest above, White's below.
  const topBank = h('div', { class: 'bank top', dataset: { testid: 'bank-b' } });
  const bottomBank = h('div', { class: 'bank bottom', dataset: { testid: 'bank-w' } });
  root.append(
    h(
      'section',
      { class: `stage battle${demo ? ' demo' : ''}` },
      left,
      h('div', { class: 'center' }, evalBar, h('div', { class: 'board-col' }, topBank, boardWrap, bottomBank, promoEl)),
      right,
    ),
    modal,
  );
  const plyMeta = []; // per ply: { earned, cost } — shown in the move list
  const bought = { w: [], b: [] }; // purchases made during this battle, per side

  const board = createBoard(boardWrap, {
    orientation: 'w',
    canDrag: (sq) => canAct() && match.chess.get(sq)?.color === match.turn(),
    onDragStart: (sq) => select(sq),
    onSquareClick: clickSquare,
    onDrop: (from, to) => attempt(from, to),
  });

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
  function buyAndDrop(type, square) {
    const r = match.drop(type, square);
    dropType = null;
    selected = null;
    targets = [];
    plyMeta.push({ cost: r.cost });
    bought[r.color].push({ type, square, cost: r.cost });
    rec.drop({ side: r.color, type, square, cost: r.cost, san: r.san, materialDiff: match.material().diff });
    ctx.sound.play(r.check ? 'check' : 'buy');
    if (!human[r.color] && !demo) ctx.toast(`The enemy bought a ${PIECE_NAMES[type].toLowerCase()} for ${r.cost} g and dropped it on ${square}.`);
    afterTurn(null);
    board.land(square);
    board.flash(square, `−${r.cost} g`, 'spend');
    return r;
  }

  function play(move) {
    const r = match.move(move);
    selected = null;
    targets = [];
    plyMeta.push({ earned: r.earned });
    rec.ply({ san: r.san, materialDiff: match.material().diff });
    ctx.sound.play(r.check ? 'check' : r.captured ? 'capture' : 'move');
    afterTurn({ from: r.from, to: r.to });
    if (r.earned) board.flash(r.to, `+${r.earned} g`, 'gain');
    return r;
  }

  function afterTurn(animate) {
    paintBoard(animate);
    paintPanels();
    const status = match.status();
    if (status.over) return finish(status);
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
        shop: rules.battleShop && match.reserve[side] > 0 ? { reserve: match.reserve[side] } : null,
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

  function finish(status) {
    ended = true;
    thinking = false;
    rec.end({ winner: status.winner, reason: status.reason, pgn: match.pgn(), finalFen: match.fen() });
    if (!demo) ctx.sound.play(status.winner === null ? 'lose' : hotseat || status.winner === 'w' ? 'win' : 'lose');
    paintBoard();
    paintPanels();
    if (demo) return demoNext(status);
    setTimeout(() => alive && showResult(status), 650);
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
  function paintBoard(animate) {
    board.render(piecesFromBoard(match.board()), animate && settings.animations ? animate : undefined);
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
      evalBar.firstChild.style.height = `${50 + cp / 20}%`;
      evalBar.title = `Evaluation ${(evalWhite / 100).toFixed(1)} for White`;
    }
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
      h('div', { class: 'side-meta' }, h('span', {}, `Recruited ${armyLabel(p.army)}`)),
      caps.length ? h('div', { class: 'captures' }, caps.map((t) => pieceImg(side === 'w' ? 'b' : 'w', t, 'cap'))) : null,
    );
  }

  /** Start dragging a shop card; a short click just selects it. */
  function cardPointerDown(e, type) {
    if (!canAct() || e.button > 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let ghost = null;
    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      if (!ghost) {
        if (dropType !== type) chooseShopPiece(type);
        const size = boardWrap.getBoundingClientRect().width / 8;
        ghost = h('img', { class: 'drag-ghost', src: `assets/pieces/${match.turn()}${type.toUpperCase()}.svg`, alt: '', style: { width: `${size}px`, height: `${size}px` } });
        document.body.append(ghost);
      }
      ghost.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px) translate(-50%, -50%)`;
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!ghost) return chooseShopPiece(type); // plain click
      ghost.remove();
      const sq = board.squareAt(ev.clientX, ev.clientY);
      if (sq && targets.some((t) => t.square === sq)) buyAndDrop(type, sq);
      else {
        if (sq) ctx.sound.play('illegal');
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
      h('span', { class: `bank-gold num${myTurn && gold > 0 ? ' ready' : ''}` }, h('i', { class: 'coin' }), `${gold}`, h('small', {}, ' g')),
      h('span', { class: 'bank-log' }, earned ? `+${earned} g from captures` : rules.captureBounty ? 'captures pay gold' : '', bought[side].length ? ` · bought ${bought[side].map((b) => `${b.type.toUpperCase()}@${b.square}`).join(' ')}` : ''),
    );
    if (!rules.battleShop || !isHuman || demo) return [head];
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
    const canShop = rules.battleShop && match.droppableTypes().length > 0;
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
          `Both sides get the same army. ${presetOf('w').label} looks ${presetOf('w').depth} ply ahead and ${presetOf('b').label} looks ${presetOf('b').depth}. The running score shows how much the extra thinking is worth.`,
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

  function showResult(status) {
    const s = ctx.store.sessions().at(-1);
    const win = !hotseat && status.winner === 'w';
    const draw = status.winner === null;
    const title = hotseat ? (draw ? 'Draw' : `${SIDE[status.winner]} wins`) : draw ? 'Draw' : win ? 'Victory' : 'Defeat';
    const ms = performance.now() - startedAt;
    const again = () => ctx.go('battle', { ...params, reusedArmy: true });
    const change = () => (params.mode === 'level' ? ctx.go('setup', { mode: 'level', levelId: params.levelId }) : ctx.go('draft', {}));
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
          h('dt', {}, hotseat ? 'White' : 'Your army'),
          h('dd', {}, armyLabel(params.white.army)),
          h('dt', {}, hotseat ? 'Black' : 'Enemy'),
          h('dd', {}, armyLabel(params.black.army)),
          drops.length ? [h('dt', {}, 'Bought mid-battle'), h('dd', { class: 'num' }, drops.map((d) => `${d.type.toUpperCase()}@${d.square}`).join(' '))] : null,
          s?.attempt ? [h('dt', {}, 'Attempt'), h('dd', { class: 'num' }, `#${s.attempt}`)] : null,
        ),
        h(
          'div',
          { class: 'actions column' },
          h('button', { class: 'btn primary', type: 'button', dataset: { testid: 'result-rematch' }, onclick: again }, 'Rematch with the same army'),
          h('button', { class: 'btn', type: 'button', dataset: { testid: 'result-change-army' }, onclick: change }, params.mode === 'level' ? 'Change army' : 'New draft'),
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
    modal.querySelector('.btn.primary')?.focus();
  }

  paintBoard();
  paintPanels();
  if (!human[match.turn()]) aiTurn();

  return () => {
    alive = false;
    if (!ended) rec.abandon();
    if (window.__cbs.match === match) window.__cbs.match = null;
    board.destroy();
  };
}
