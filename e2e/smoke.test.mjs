// End-to-end smoke test: drives the real game in the system Google Chrome
// (playwright-core, no browser download). Run with `pnpm test:e2e`.
// Screenshots land in e2e/artifacts/ (gitignored).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createStaticServer } from '../tools/serve.mjs';

const ART = new URL('./artifacts/', import.meta.url).pathname;
let server;
let base;
let browser;

before(async () => {
  await mkdir(ART, { recursive: true });
  server = createStaticServer('.');
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

async function open(viewport = { width: 1280, height: 720 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(base);
  await page.waitForSelector('[data-testid="menu-level-L1"]');
  return { context, page, errors };
}

const tid = (id) => `[data-testid="${id}"]`;
const sessions = (page) => page.evaluate(() => window.__cbs.ctx.store.sessions());

async function noPageScroll(page) {
  return page.evaluate(() => {
    const s = document.getElementById('screen');
    return {
      v: s.scrollHeight <= s.clientHeight + 1 && document.documentElement.scrollHeight <= innerHeight + 1,
      h: document.documentElement.scrollWidth <= innerWidth + 1 && s.scrollWidth <= s.clientWidth + 1,
    };
  });
}

/** Play one legal move for the side to move by clicking squares. */
async function clickLegalMove(page) {
  const mv = await page.evaluate(() => {
    const m = window.__cbs.match;
    const turn = m.turn();
    for (const row of m.board()) {
      for (const p of row) {
        if (p && p.color === turn) {
          const moves = m.legalMovesFrom(p.square).filter((x) => !x.promotion);
          if (moves.length) return { from: p.square, to: moves[0].to };
        }
      }
    }
    return null;
  });
  assert.ok(mv, 'a legal move exists');
  await page.click(`[data-square="${mv.from}"]`);
  await page.click(`[data-square="${mv.to}"]`);
  return mv;
}

test('level 1: buy, deploy, battle vs AI in a Worker, resign, telemetry, rematch', async () => {
  const { context, page, errors } = await open();
  await page.screenshot({ path: `${ART}menu-1280.png` });
  await page.click(tid('menu-level-L1'));
  for (const t of ['r', 'b', 'n', 'p']) await page.click(tid(`buy-${t}`));
  assert.equal(await page.isDisabled(tid('buy-q')), true, 'queen unaffordable after spending 12');
  const scroll = await noPageScroll(page);
  assert.deepEqual(scroll, { v: true, h: true }, 'setup fits 1280x720');
  await page.screenshot({ path: `${ART}setup-1280.png` });
  await page.screenshot({ path: 'docs/screenshot.png', clip: { x: 0, y: 0, width: 1280, height: 720 } });

  await page.click(tid('start-battle'));
  await page.waitForSelector(tid('board'));
  assert.equal(await page.evaluate(() => window.__cbs.ctx.ai.mode), 'worker');
  await clickLegalMove(page);
  await page.waitForFunction(() => window.__cbs.match?.plies() >= 2, null, { timeout: 15000 });
  await clickLegalMove(page);
  await page.waitForFunction(() => window.__cbs.match?.plies() >= 4, null, { timeout: 15000 });
  assert.deepEqual(await noPageScroll(page), { v: true, h: true }, 'battle fits 1280x720');
  await page.screenshot({ path: `${ART}battle-1280.png` });

  await page.click(tid('resign'));
  await page.click(tid('resign-confirm'));
  await page.waitForSelector(tid('result-modal'));
  await page.screenshot({ path: `${ART}result-1280.png` });
  let s = await sessions(page);
  assert.equal(s.length, 1);
  assert.equal(s[0].result, 'loss');
  assert.equal(s[0].endReason, 'resign');
  assert.equal(s[0].white.label, 'R+B+N+P');
  assert.equal(s[0].attempt, 1);
  assert.equal(s[0].plies, 4);
  assert.equal(s[0].materialTimeline.length, 4);

  await page.click(tid('result-rematch'));
  await page.waitForFunction(() => window.__cbs.match?.plies() === 0);
  await page.click(tid('nav-menu')); // leave mid-battle → abandoned
  s = await sessions(page);
  assert.equal(s.length, 2);
  assert.equal(s[1].reusedArmy, true);
  assert.equal(s[1].result, 'abandoned');
  assert.equal(s[1].attempt, 2);
  assert.deepEqual(errors, []);
  await context.close();
});

test('mid-battle purchase: keep gold, drop a knight as a move, AI replies, telemetry records it', async () => {
  const { context, page, errors } = await open();
  await page.click(tid('menu-level-L1'));
  await page.click(tid('buy-r')); // 7 gold left → war chest
  await page.click(tid('start-battle'));
  await page.waitForSelector(tid('reinforcements'));
  await page.click(tid('reinforce-n'));
  const target = await page.evaluate(() => window.__cbs.match.legalDropSquares('n')[0]);
  assert.ok(target);
  await page.screenshot({ path: `${ART}reinforce-1280.png` });
  await page.click(`[data-square="${target}"]`);
  assert.equal(await page.evaluate(() => window.__cbs.match.reserve.w), 4);
  assert.equal(await page.evaluate((sq) => window.__cbs.match.chess.get(sq)?.type, target), 'n');
  await page.waitForFunction(() => window.__cbs.match?.plies() >= 2, null, { timeout: 15000 });
  assert.deepEqual(await noPageScroll(page), { v: true, h: true }, 'battle with reinforcements fits 1280x720');
  const active = await page.evaluate(() => window.__cbs.ctx.recorder.active());
  assert.equal(active.white.reserve, 7);
  assert.deepEqual(active.drops.map((d) => [d.side, d.type, d.square, d.cost]), [['w', 'n', target, 3]]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('free mode vs AI: draft to completion, deploy, battle', async () => {
  const { context, page, errors } = await open();
  await page.click(tid('menu-free'));
  await page.click(tid('free-budget-12'));
  await page.click(tid('free-preset-easy'));
  await page.screenshot({ path: `${ART}draft-options-1280.png` });
  await page.click(tid('free-start'));
  for (let i = 0; i < 40; i++) {
    if (await page.$(tid('draft-deploy'))) break;
    const buy = await page.$(`${tid('draft-buy-r')}:not([disabled]), ${tid('draft-buy-p')}:not([disabled])`);
    if (buy) await buy.click();
    else if (await page.$(tid('draft-pass'))) await page.click(tid('draft-pass'));
    await page.waitForTimeout(700);
  }
  await page.screenshot({ path: `${ART}draft-1280.png` });
  await page.click(tid('draft-deploy'));
  await page.waitForSelector(tid('start-battle'));
  await page.click(tid('start-battle'));
  await page.waitForFunction(() => !!window.__cbs.match);
  await clickLegalMove(page);
  await page.waitForFunction(() => window.__cbs.match?.plies() >= 2, null, { timeout: 15000 });
  const s = await page.evaluate(() => window.__cbs.ctx.recorder.active());
  assert.equal(s.mode, 'free');
  assert.ok(s.draft.length >= 2);
  assert.deepEqual(errors, []);
  await context.close();
});

test('free mode hotseat: draft, White deploys, hand-off, Black deploys, both move', async () => {
  const { context, page, errors } = await open();
  await page.click(tid('menu-free'));
  await page.click(tid('free-budget-8'));
  await page.click(tid('free-opponent-hotseat'));
  await page.click(tid('free-start'));
  for (let i = 0; i < 30 && !(await page.$(tid('draft-deploy'))); i++) {
    const buy = await page.$(`${tid('draft-buy-r')}:not([disabled]), ${tid('draft-buy-n')}:not([disabled]), ${tid('draft-buy-p')}:not([disabled])`);
    if (buy) await buy.click();
    else await page.click(tid('draft-pass'));
  }
  await page.click(tid('draft-deploy'));
  await page.click(tid('start-battle')); // "Lock in White"
  await page.click(tid('handoff-continue'));
  await page.screenshot({ path: `${ART}hotseat-black-deploy-1280.png` });
  await page.click(tid('start-battle'));
  await page.waitForFunction(() => !!window.__cbs.match);
  await clickLegalMove(page);
  await clickLegalMove(page);
  assert.equal(await page.evaluate(() => window.__cbs.match.plies()), 2);
  assert.deepEqual(errors, []);
  await context.close();
});

test('dashboard: shows sessions, export JSON downloads, re-import adds nothing', async () => {
  const { context, page, errors } = await open();
  // Seed a finished game via the UI quickly: level → resign.
  await page.click(tid('menu-level-L1'));
  await page.click(tid('buy-q'));
  await page.click(tid('start-battle'));
  await page.click(tid('resign'));
  await page.click(tid('resign-confirm'));
  await page.waitForSelector(tid('result-modal'));
  const dl = page.waitForEvent('download');
  await page.click(tid('download-data'));
  const file = await (await dl).path();
  await page.click(tid('result-menu'));
  await page.click(tid('menu-dashboard'));
  await page.waitForSelector('.army-table');
  assert.match(await page.textContent('.army-table'), /Q/);
  await page.screenshot({ path: `${ART}dashboard-1280.png`, fullPage: true });
  const dl2 = page.waitForEvent('download');
  await page.click(tid('dash-export-json'));
  const exported = JSON.parse(await readFile(await (await dl2).path(), 'utf8'));
  assert.equal(exported.sessions.length, 1);
  await page.setInputFiles(tid('dash-import'), file);
  await page.waitForFunction(() => /Imported 0/.test(document.getElementById('toast').textContent));
  assert.deepEqual(errors, []);
  await context.close();
});

test('phone width 390x844: no horizontal scroll on setup and battle', async () => {
  const { context, page, errors } = await open({ width: 390, height: 844 });
  await page.screenshot({ path: `${ART}menu-390.png`, fullPage: true });
  await page.click(tid('menu-level-L1'));
  await page.click(tid('buy-r'));
  assert.equal((await noPageScroll(page)).h, true);
  await page.screenshot({ path: `${ART}setup-390.png`, fullPage: true });
  await page.click(tid('start-battle'));
  await page.waitForFunction(() => !!window.__cbs.match);
  assert.equal((await noPageScroll(page)).h, true);
  await page.screenshot({ path: `${ART}battle-390.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
});

test('settings: hide hints, close the battle shop; persisted across reload', async () => {
  const { context, page, errors } = await open();
  await page.click(tid('menu-settings'));
  await page.screenshot({ path: `${ART}settings-1280.png` });
  await page.click(tid('setting-showHints'));
  await page.click(tid('setting-battleShop'));
  await page.reload();
  await page.waitForSelector(tid('menu-level-L1'));
  const s = await page.evaluate(() => window.__cbs.ctx.settings.get());
  assert.equal(s.showHints, false);
  assert.equal(s.battleShop, false);
  await page.click(tid('menu-level-L1'));
  await page.click(tid('buy-r'));
  await page.click(tid('start-battle'));
  await page.waitForFunction(() => !!window.__cbs.match);
  assert.equal(await page.$(tid('reinforcements')), null, 'no shop when the house rule is off');
  const from = await page.evaluate(() => window.__cbs.match.board().flat().find((p) => p && p.color === 'w' && window.__cbs.match.legalMovesFrom(p.square).length).square);
  await page.click(`[data-square="${from}"]`);
  assert.equal(await page.$$eval('.sq.target, .sq.capture-target', (els) => els.length), 0, 'hints hidden');
  const active = await page.evaluate(() => window.__cbs.ctx.recorder.active());
  assert.deepEqual(active.rules, { battleShop: false, captureBounty: true });
  assert.deepEqual(errors, []);
  await context.close();
});

test('demo: AI vs AI plays on its own with commentary, and records nothing', async () => {
  const { context, page, errors } = await open();
  await page.click(tid('menu-demo'));
  await page.screenshot({ path: `${ART}demo-options-1280.png` });
  await page.click(tid('demo-speed-fast'));
  await page.click(tid('demo-start'));
  await page.waitForFunction(() => window.__cbs.match?.plies() >= 6, null, { timeout: 30000 });
  assert.ok((await page.$$('.notes li')).length >= 5, 'commentary lines');
  assert.match(await page.textContent(tid('demo-series')), /Warlord/);
  assert.deepEqual(await noPageScroll(page), { v: true, h: true }, 'demo fits 1280x720');
  await page.screenshot({ path: `${ART}demo-1280.png` });
  await page.click(tid('demo-stop'));
  assert.equal((await sessions(page)).length, 0, 'demo games are not playtest data');
  assert.equal(await page.evaluate(() => window.__cbs.ctx.recorder.active()), null);
  assert.deepEqual(errors, []);
  await context.close();
});
