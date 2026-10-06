// Playtest Data: the designer's balancing view over recorded sessions.
// Army table (win rate per composition) is the core view; the rest answers
// "what do people buy", "how do games end" and "do players improve".

import { BALANCE_VERSION, LEVELS, PIECE_NAMES } from '../../config.js';
import { byArmy, endReasons, filterSessions, learningCurve, pieceStats, summarize, toCSV } from '../../telemetry/stats.js';
import { telemetryOnline } from '../../online.js';
import { fill, downloadText, formatDuration, h, pieceImg } from '../dom.js';

const pct = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);
const REASONS = ['checkmate', 'resign', 'stalemate', 'threefold', 'fifty-move', 'insufficient', 'abandoned'];

export function mount(root, ctx) {
  let filter = { scope: 'L1', balance: BALANCE_VERSION };
  let confirmClear = false;
  let openId = null;
  let sortKey = 'plays';
  const el = h('section', { class: 'dashboard' });
  root.append(el);

  const scoped = () => {
    const all = ctx.store.sessions();
    const byScope =
      filter.scope === 'all'
        ? all
        : filter.scope === 'free'
          ? filterSessions(all, { mode: 'free' })
          : filterSessions(all, { mode: 'level', levelId: filter.scope });
    return filterSessions(byScope, { balanceVersion: filter.balance });
  };

  function kpi(label, value, sub) {
    return h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, label), h('b', { class: 'kpi-value num' }, value), sub ? h('span', { class: 'kpi-sub' }, sub) : null);
  }

  function hbar(label, value, max, text, cls = '') {
    return h(
      'div',
      { class: 'hbar' },
      h('span', { class: 'hbar-label' }, label),
      h('span', { class: 'hbar-track' }, h('span', { class: `hbar-fill ${cls}`, style: { width: `${max ? (value / max) * 100 : 0}%` } })),
      h('span', { class: 'hbar-value num' }, text),
    );
  }

  function armyTable(sessions) {
    const rows = byArmy(sessions, 'w').sort((a, b) =>
      sortKey === 'winRate' ? (b.winRate ?? -1) - (a.winRate ?? -1) || b.plays - a.plays : sortKey === 'avgPlies' ? (b.avgPlies ?? 0) - (a.avgPlies ?? 0) : b.plays - a.plays,
    );
    if (!rows.length) return h('p', { class: 'dim' }, 'No battles in this selection yet.');
    const th = (key, label) =>
      h('th', {}, key ? h('button', { class: `sort${sortKey === key ? ' on' : ''}`, type: 'button', onclick: () => ((sortKey = key), paint()) }, label) : label);
    return h(
      'table',
      { class: 'army-table' },
      h('thead', {}, h('tr', {}, th(null, 'White army'), th('plays', 'Games'), th(null, 'Win / draw / loss'), th('winRate', 'Win rate'), th('avgPlies', 'Avg plies'))),
      h(
        'tbody',
        {},
        rows.map((r) => {
          const n = r.plays;
          const seg = (count, cls) => (count ? h('span', { class: `seg ${cls}`, style: { flexGrow: count }, title: `${count}` }, count) : null);
          return h(
            'tr',
            {},
            h('td', {}, h('b', {}, r.label), h('span', { class: 'dim num' }, ` · ${r.spend}g`)),
            h('td', { class: 'num' }, n),
            h('td', {}, h('div', { class: 'stack' }, seg(r.wins, 'win'), seg(r.draws, 'draw'), seg(r.losses, 'loss'), seg(r.abandoned, 'left'))),
            h('td', { class: 'num' }, pct(r.winRate), h('span', { class: 'dim' }, ` n=${r.wins + r.losses + r.draws}`)),
            h('td', { class: 'num' }, r.avgPlies === null ? '–' : Math.round(r.avgPlies)),
          );
        }),
      ),
    );
  }

  function curve(sessions) {
    const pts = learningCurve(sessions).slice(0, 12);
    if (pts.length < 2) return h('p', { class: 'dim' }, 'Needs games from at least two attempts.');
    const W = 320;
    const H = 120;
    const x = (i) => 24 + (i * (W - 40)) / (pts.length - 1);
    const y = (v) => 10 + (1 - v) * (H - 34);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.winRate).toFixed(1)}`).join(' ');
    return h('div', {
      class: 'curve',
      html: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Win rate by attempt number">
        <line x1="24" x2="${W - 16}" y1="${y(0.5)}" y2="${y(0.5)}" class="grid"/>
        <text x="2" y="${y(1) + 4}" class="axis">100%</text><text x="2" y="${y(0) + 4}" class="axis">0%</text>
        <path d="${path}" class="line"/>
        ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.winRate)}" r="3.5" class="pt"><title>Attempt ${p.attempt}: ${pct(p.winRate)} of ${p.plays}</title></circle><text x="${x(i)}" y="${H - 4}" class="axis" text-anchor="middle">#${p.attempt}</text>`).join('')}
      </svg>`,
    });
  }

  function sessionList(sessions) {
    const recent = sessions.slice(-12).reverse();
    if (!recent.length) return null;
    return h(
      'ul',
      { class: 'session-list' },
      recent.map((s) => {
        const open = openId === s.id;
        return h(
          'li',
          { class: `session ${s.result ?? ''}` },
          h(
            'button',
            { class: 'session-row', type: 'button', 'aria-expanded': String(open), onclick: () => ((openId = open ? null : s.id), paint()) },
            h('span', { class: 'num dim' }, new Date(s.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
            h('span', {}, s.white?.label ?? '—', h('span', { class: 'dim' }, ' vs '), s.black?.label ?? '—'),
            h('span', { class: `badge ${s.result}` }, s.result),
            h('span', { class: 'num dim' }, s.plies ? `${s.plies} plies` : s.phaseReached),
          ),
          open
            ? h(
                'div',
                { class: 'session-detail' },
                h('div', { class: 'mini-slot', dataset: { fen: s.finalFen ?? s.startFen ?? '' } }),
                h(
                  'div',
                  {},
                  h('p', { class: 'dim' }, `${s.mode}${s.levelId ? ` · ${s.levelId}` : ''} · ${s.opponent}${s.aiPreset ? ` (${s.aiPreset})` : ''} · attempt ${s.attempt} · buy ${formatDuration(s.buyMs)} · battle ${formatDuration(s.battleMs)} · ${s.endReason ?? ''}`),
                  h('pre', { class: 'pgn' }, s.pgn || '(no moves)'),
                ),
              )
            : null,
        );
      }),
    );
  }

  async function fillMiniBoards() {
    const slots = el.querySelectorAll('.mini-slot');
    if (!slots.length) return;
    try {
      const { renderMiniBoard } = await import('../board.js');
      for (const slot of slots) if (slot.dataset.fen) fill(slot, renderMiniBoard(slot.dataset.fen, { size: 150 }));
    } catch {
      for (const slot of slots) slot.textContent = slot.dataset.fen;
    }
  }

  function importFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const r = ctx.store.importJSON(text);
      ctx.toast(r.error ? `Import failed: ${r.error}` : `Imported ${r.added} session(s) · ${r.skipped} duplicate · ${r.invalid} invalid`, r.error ? 'warn' : 'info');
      paint();
    });
  }

  function paint() {
    const sessions = scoped();
    const all = ctx.store.sessions();
    const sum = summarize(sessions);
    const pieces = pieceStats(sessions, 'w');
    const reasons = endReasons(sessions);
    const reasonMax = Math.max(1, ...Object.values(reasons));
    const versions = [...new Set(all.map((s) => s.balanceVersion).filter(Boolean))];
    if (!versions.includes(BALANCE_VERSION)) versions.push(BALANCE_VERSION);
    const date = new Date().toISOString().slice(0, 10);

    const scopeChip = (value, label) =>
      h('button', { class: `choice${filter.scope === value ? ' on' : ''}`, type: 'button', onclick: () => ((filter.scope = value), paint()) }, label);

    fill(el, 
      h(
        'header',
        { class: 'dash-head' },
        h('div', {}, h('p', { class: 'kicker' }, 'Designer view'), h('h2', {}, 'Playtest data')),
        h(
          'div',
          { class: 'dash-actions' },
          h('button', { class: 'btn', type: 'button', dataset: { testid: 'dash-export-json' }, onclick: () => downloadText(`cbs-playtest-${date}.json`, ctx.store.exportJSON()) }, 'Export JSON'),
          h('button', { class: 'btn', type: 'button', dataset: { testid: 'dash-export-csv' }, onclick: () => downloadText(`cbs-playtest-${date}.csv`, toCSV(all), 'text/csv') }, 'Export CSV'),
          h('label', { class: 'btn' }, 'Import JSON', h('input', { type: 'file', accept: '.json,application/json', hidden: true, dataset: { testid: 'dash-import' }, onchange: importFile })),
          confirmClear
            ? h('button', { class: 'btn danger', type: 'button', dataset: { testid: 'dash-clear-confirm' }, onclick: () => (ctx.store.clear(), (confirmClear = false), paint()) }, `Delete ${all.length} sessions`)
            : h('button', { class: 'btn ghost', type: 'button', dataset: { testid: 'dash-clear' }, disabled: !all.length, onclick: () => ((confirmClear = true), paint()) }, 'Clear'),
        ),
      ),
      h(
        'div',
        { class: 'filters' },
        ...LEVELS.map((l) => scopeChip(l.id, `Level 1 · ${l.name}`)),
        scopeChip('free', 'Free mode'),
        scopeChip('all', 'Everything'),
        h(
          'label',
          { class: 'select' },
          'Balance ',
          h(
            'select',
            { onchange: (e) => ((filter.balance = e.target.value), paint()) },
            h('option', { value: 'all', selected: filter.balance === 'all' }, 'all versions'),
            versions.map((v) => h('option', { value: v, selected: filter.balance === v }, v)),
          ),
        ),
      ),
      ctx.store.available ? null : h('p', { class: 'notice' }, 'Storage is blocked in this browser — data lasts only until this tab closes. Use Export JSON.'),
      (() => {
        if (!telemetryOnline()) return null;
        const consent = ctx.settings.get().telemetryConsent;
        const text =
          consent === 'granted'
            ? 'Sharing is on: your finished sessions are sent to the collector automatically.'
            : consent === 'denied'
              ? 'Sharing is off: everything below stays on this device. Turn it on in Settings → Privacy.'
              : 'You have not decided whether to share data yet — see the card on the menu, or Settings → Privacy.';
        return h('p', { class: 'notice', dataset: { testid: 'dash-consent-note' } }, text);
      })(),
      all.length === 0
        ? h(
            'div',
            { class: 'box empty' },
            h('h3', {}, 'No playtest data yet'),
            h('p', {}, 'Every game played in this browser is recorded here automatically (nothing leaves the device). To collect data from testers on other machines, ask them to click “Download your play data” on the result screen and send you the file, then Import it here.'),
          )
        : [
            h(
              'div',
              { class: 'kpis' },
              kpi('Sessions', sum.sessions, `${sum.abandoned} abandoned`),
              kpi('Win rate', pct(sum.winRate), `${sum.wins}W ${sum.draws}D ${sum.losses}L`),
              kpi('Avg length', sum.avgPlies === null ? '–' : Math.round(sum.avgPlies), 'plies'),
              kpi('Avg buy time', formatDuration(sum.avgBuyMs), 'recruit + deploy'),
            ),
            h(
              'div',
              { class: 'dash-grid' },
              h('div', { class: 'box span2' }, h('h3', {}, 'Armies — the balance view'), armyTable(sessions)),
              h(
                'div',
                { class: 'box' },
                h('h3', {}, 'What players buy'),
                pieces.map((p) => hbar(h('span', { class: 'with-icon' }, pieceImg('w', p.type), PIECE_NAMES[p.type]), p.pickRate, 1, `${pct(p.pickRate)} · ${p.avgCount.toFixed(1)}`, 'ally')),
              ),
              h(
                'div',
                { class: 'box' },
                h('h3', {}, 'How games end'),
                REASONS.filter((r) => reasons[r]).map((r) => hbar(r, reasons[r], reasonMax, reasons[r], r === 'checkmate' ? 'ok' : r === 'abandoned' ? 'muted' : 'warn')),
                Object.keys(reasons).length ? null : h('p', { class: 'dim' }, '–'),
              ),
              h('div', { class: 'box span2' }, h('h3', {}, 'Learning curve'), h('p', { class: 'dim small' }, 'Win rate by attempt number'), curve(sessions)),
              h('div', { class: 'box span3' }, h('h3', {}, 'Recent sessions'), sessionList(sessions) ?? h('p', { class: 'dim' }, 'None in this selection.')),
            ),
          ],
    );
    fillMiniBoards();
  }

  paint();
  return () => {};
}
