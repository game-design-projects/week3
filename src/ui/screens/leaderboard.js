// Leaderboard: Level 1's results table, one board per AI difficulty, set like
// the results page of a tournament book. Read-only: it fetches the public
// board (no player ids come back) and marks your own row by its rank.

import { AI_PRESETS, BALANCE_VERSION, LEADERBOARD, LEVELS } from '../../config.js';
import { levelStart } from '../../core/start.js';
import { fetchScores } from '../../leaderboard.js';
import { fill, h } from '../dom.js';

const DIFFICULTIES = ['easy', 'normal', 'hard'];

const shortDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '–' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export function mount(root, ctx, params = {}) {
  const level = LEVELS[0];
  let ai = DIFFICULTIES.includes(params.ai) ? params.ai : ctx.settings.get().campaignAI;
  let state = { status: 'loading', data: null, error: null };
  let alive = true;
  let requestNo = 0;

  const standing = h('div', { class: 'lb-you', dataset: { testid: 'lb-you' } });
  const tabs = h('div', { class: 'lb-tabs', role: 'tablist', 'aria-label': 'AI difficulty' });
  const table = h('div', { class: 'lb-table-wrap', dataset: { testid: 'lb-table' } });
  const actions = h('div', { class: 'actions' });

  const playLevel = () =>
    ctx.go('battle', { mode: 'level', levelId: level.id, opponent: 'ai', aiPreset: ai, playerSide: 'w', gold: level.gold, rules: ctx.settings.rules(), ...levelStart(level) });

  root.append(
    h(
      'section',
      { class: 'lb-page' },
      h(
        'aside',
        { class: 'lb-intro' },
        h('p', { class: 'kicker' }, 'Results table'),
        h('h2', {}, 'Leaderboard'),
        h('p', { class: 'lb-sub' }, `Level 1: ${level.name}. The fewest moves to checkmate.`),
        h(
          'ol',
          { class: 'lb-rules' },
          h('li', {}, h('b', {}, 'Fewest moves wins. '), 'Gold left in your purse breaks a tie, then whoever got there first.'),
          h('li', {}, h('b', {}, 'Replayed, not reported. '), 'The server plays every submitted game again with the game’s own rules. Only legal games that end in your checkmate count.'),
          h('li', {}, h('b', {}, 'Your best only. '), 'One line per player and difficulty. Win Level 1, then submit from the result card.'),
        ),
        standing,
        actions,
      ),
      h('div', { class: 'lb-main' }, tabs, table, h('p', { class: 'lb-foot fine' }, `Rules ${BALANCE_VERSION} · standard house rules · nicknames are public`)),
    ),
  );

  function paintTabs() {
    fill(
      tabs,
      DIFFICULTIES.map((key) =>
        h(
          'button',
          {
            class: `lb-tab${key === ai ? ' on' : ''}`,
            type: 'button',
            role: 'tab',
            'aria-selected': String(key === ai),
            dataset: { testid: `lb-tab-${key}` },
            onclick: () => key !== ai && ((ai = key), load()),
          },
          h('span', { class: 'lb-tab-name' }, AI_PRESETS[key].label),
          h('span', { class: 'lb-tab-note' }, key),
        ),
      ),
    );
  }

  function row(e, you) {
    return h(
      'tr',
      { class: you ? 'you' : '', dataset: { testid: you ? 'lb-row-you' : 'lb-row' } },
      h('td', { class: 'rank num' }, e.rank),
      h('td', { class: 'who' }, h('span', { class: 'who-in' }, h('span', { class: 'nick' }, e.nickname), you ? h('span', { class: 'you-tag' }, 'you') : null, h('span', { class: 'leader', 'aria-hidden': 'true' }))),
      h('td', { class: 'num' }, e.moves),
      h('td', { class: 'num' }, `${e.goldLeft} g`),
      h('td', { class: 'num date' }, shortDate(e.createdAt)),
    );
  }

  const thead = () =>
    h('thead', {}, h('tr', {}, h('th', { class: 'rank' }, 'No.'), h('th', {}, 'Player'), h('th', { class: 'num' }, 'Moves'), h('th', { class: 'num' }, 'Gold left'), h('th', { class: 'date' }, 'Date')));

  function paintTable() {
    const label = AI_PRESETS[ai].label;
    if (state.status === 'loading') {
      return fill(
        table,
        h('table', { class: 'results-table loading', 'aria-busy': 'true' }, thead(), h('tbody', {}, Array.from({ length: 6 }, () => h('tr', { class: 'ghost-row' }, h('td', { colspan: '5' }, h('span', { class: 'ghost-line' })))))),
        h('p', { class: 'lb-state', role: 'status', dataset: { testid: 'lb-loading' } }, `Setting the ${label} table…`),
      );
    }
    if (state.status === 'error') {
      return fill(
        table,
        h(
          'div',
          { class: 'lb-empty', dataset: { testid: 'lb-error' } },
          h('h3', {}, 'The results did not arrive'),
          h('p', {}, state.error),
          h('button', { class: 'btn', type: 'button', dataset: { testid: 'lb-retry' }, onclick: load }, 'Try again'),
        ),
      );
    }
    const { entries, player, total } = state.data;
    if (!entries.length) {
      return fill(
        table,
        h(
          'div',
          { class: 'lb-empty', dataset: { testid: 'lb-empty' } },
          h('h3', {}, 'No names on this page yet'),
          h('p', {}, `Nobody has taken the Keep against the ${label} yet. Win Level 1 at this difficulty and submit your game to be first in the book.`),
          h('button', { class: 'btn primary', type: 'button', onclick: playLevel }, `Play at ${label}`),
        ),
      );
    }
    const youRank = player?.rank ?? null;
    const shown = entries.some((e) => e.rank === youRank);
    return fill(
      table,
      h(
        'table',
        { class: 'results-table' },
        h('caption', {}, `${label} · ${total} ${total === 1 ? 'player' : 'players'}`),
        thead(),
        h(
          'tbody',
          {},
          entries.map((e) => row(e, e.rank === youRank)),
          player && !shown ? [h('tr', { class: 'gap', 'aria-hidden': 'true' }, h('td', { colspan: '5' }, '⋯')), row(player, true)] : null,
        ),
      ),
    );
  }

  function paintStanding() {
    if (state.status !== 'ready') return fill(standing);
    const { player, total } = state.data;
    const label = AI_PRESETS[ai].label;
    fill(
      standing,
      player
        ? [h('span', { class: 'lb-you-label' }, `Your best vs ${label}`), h('b', { class: 'lb-you-rank num' }, `#${player.rank}`), h('span', { class: 'lb-you-of' }, `of ${total} · ${player.moves} moves · ${player.goldLeft} g left`)]
        : [h('span', { class: 'lb-you-label' }, `Your best vs ${label}`), h('span', { class: 'lb-you-of' }, 'Not on this board yet.')],
    );
  }

  function paint() {
    fill(
      actions,
      h('button', { class: 'btn primary', type: 'button', dataset: { testid: 'lb-play' }, onclick: playLevel }, `Play Level 1 vs ${AI_PRESETS[ai].label}`),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => ctx.go('menu') }, 'Menu'),
    );
    paintTabs();
    paintTable();
    paintStanding();
  }

  async function load() {
    const my = ++requestNo;
    state = { status: 'loading', data: null, error: null };
    paint();
    try {
      const data = await fetchScores({ level: level.id, balance: BALANCE_VERSION, ai, limit: LEADERBOARD.limit, player: ctx.store.playerId });
      if (!alive || my !== requestNo) return;
      state = { status: 'ready', data, error: null };
      ctx.log.info(`leaderboard ${ai}: ${data.entries.length} of ${data.total}${data.player ? `, you #${data.player.rank}` : ''}`);
    } catch (e) {
      if (!alive || my !== requestNo) return;
      state = { status: 'error', data: null, error: e?.message ?? 'Something went wrong.' };
    }
    paint();
  }

  load();
  return () => {
    alive = false;
  };
}
