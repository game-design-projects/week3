// End-to-end smoke test: drives the real game in the system Google Chrome
// (playwright-core, no browser download). Run with `pnpm test:e2e`.
// Screenshots land in e2e/artifacts/ (gitignored); docs/screenshot.png is
// refreshed by the first test.
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

// Every fresh browser context starts with telemetryConsent 'unset', so the
// consent card is up over the menu. Default to declining so the rest of the
// suite (written before consent existed) sees the menu as before; pass
// `consent: 'accept'` to opt in, or `consent: 'none'` to leave the card up
// for a test that wants to interact with it itself.
async function open(viewport = { width: 1280, height: 720 }, { consent = 'decline' } = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(base);
  await page.waitForSelector('[data-testid="menu-level-L1"]');
  if (consent === 'decline') await page.click(tid('consent-decline'));
  else if (consent === 'accept') await page.click(tid('consent-accept'));
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

/** Drag a war-chest card onto a board square with the mouse. */
async function dragCard(page, type, square) {
  const card = await page.locator(tid(`reinforce-${type}`)).boundingBox();
  const target = await page.locator(`[data-square="${square}"]`).boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(card.x + 20, card.y - 40, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
}

/** Buy a piece by clicking its card, then a legal drop square. */
async function clickBuy(page, type) {
  await page.waitForFunction((t) => !document.querySelector(`[data-testid="reinforce-${t}"]`)?.disabled, type, { timeout: 15000 });
  await page.click(tid(`reinforce-${type}`));
  const sq = await page.evaluate((t) => window.__cbs.match.legalDropSquares(t)[0], type);
  await page.click(`[data-square="${sq}"]`);
  return sq;
}

/** Play one legal piece move for the side to move by clicking squares. */
async function clickLegalMove(page) {
  const mv = await page.evaluate(() => {
    const m = window.__cbs.match;
    for (const row of m.board()) {
      for (const p of row) {
        if (p && p.color === m.turn()) {
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

const waitPlies = (page, n) => page.waitForFunction((k) => window.__cbs.match?.plies() >= k, n, { timeout: 15000 });

test('level 1: straight into battle with a lone king; buy by drag and by click; AI answers; resign; telemetry; play again', async () => {
  const { context, page, errors } = await open();
  await page.screenshot({ path: `${ART}menu-1280.png` });
  await page.click(tid('menu-level-L1'));
  await page.waitForSelector(tid('reinforce-r'));
  const start = await page.evaluate(() => ({ fen: window.__cbs.match.fen(), gold: window.__cbs.match.reserve.w }));
  assert.match(start.fen, /^3r2k1\/4bppp\/8\/8\/8\/8\/8\/4K3 w/, 'white has only the king');
  assert.ok(start.gold > 0);
  assert.equal(await page.textContent(tid('battle-status')), 'Your move: move or buy');

  await dragCard(page, 'r', 'a1');
  assert.equal(await page.evaluate(() => window.__cbs.match.chess.get('a1')?.type), 'r');
  await page.screenshot({ path: `${ART}battle-drop-1280.png` });
  await waitPlies(page, 2);
  assert.deepEqual(await noPageScroll(page), { v: true, h: true }, 'battle fits 1280x720');

  await clickBuy(page, 'p');
  await waitPlies(page, 4);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/screenshot.png' });
  await clickLegalMove(page);
  await waitPlies(page, 6);
  await page.screenshot({ path: `${ART}battle-1280.png` });

  await page.click(tid('resign'));
  await page.click(tid('resign-confirm'));
  await page.waitForSelector(tid('result-modal'));
  await page.screenshot({ path: `${ART}result-1280.png` });
  let s = await sessions(page);
  assert.equal(s.length, 1);
  assert.equal(s[0].result, 'loss');
  assert.equal(s[0].endReason, 'resign');
  assert.equal(s[0].white.label, 'King only');
  assert.equal(s[0].white.bought, 'R+P');
  assert.equal(s[0].drops.filter((d) => d.side === 'w').length, 2);
  assert.equal(s[0].attempt, 1);
  assert.equal(s[0].plies, 6);
  assert.equal(s[0].materialTimeline.length, 6);

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

test('free battle vs AI: two lone kings with purses; both sides buy', async () => {
  const { context, page, errors } = await open();
  await page.click(tid('menu-free'));
  await page.click(tid('free-gold-12'));
  await page.click(tid('free-preset-easy'));
  await page.screenshot({ path: `${ART}free-options-1280.png` });
  await page.click(tid('free-start'));
  await page.waitForSelector(tid('reinforce-q'));
  assert.equal(await page.evaluate(() => window.__cbs.match.fen().split(' ')[0]), '4k3/8/8/8/8/8/8/4K3');
  await clickBuy(page, 'q');
  await waitPlies(page, 2);
  const drops = await page.evaluate(() => window.__cbs.match.drops().map((d) => d.color));
  assert.equal(drops[0], 'w');
  const active = await page.evaluate(() => window.__cbs.ctx.recorder.active());
  assert.equal(active.mode, 'free');
  assert.equal(active.budget, 12);
  assert.deepEqual(errors, []);
  await context.close();
});

test('free battle hotseat: both humans buy and move', async () => {
  const { context, page, errors } = await open();
  await page.click(tid('menu-free'));
  await page.click(tid('free-gold-8'));
  await page.click(tid('free-opponent-hotseat'));
  await page.click(tid('free-start'));
  await page.waitForSelector(tid('reinforce-r'));
  await clickBuy(page, 'r'); // White
  await clickBuy(page, 'r'); // Black — its war chest is on top
  await clickLegalMove(page);
  assert.equal(await page.evaluate(() => window.__cbs.match.plies()), 3);
  await page.screenshot({ path: `${ART}hotseat-1280.png` });
  assert.deepEqual(errors, []);
  await context.close();
});

test('dashboard: shows sessions keyed by what was bought; export JSON; re-import adds nothing', async () => {
  const { context, page, errors } = await open();
  await page.click(tid('menu-level-L1'));
  await clickBuy(page, 'q');
  await waitPlies(page, 2);
  await page.click(tid('resign'));
  await page.click(tid('resign-confirm'));
  await page.waitForSelector(tid('result-modal'));
  const dl = page.waitForEvent('download');
  await page.click(tid('download-data'));
  const file = await (await dl).path();
  await page.click(tid('result-menu'));
  await page.click(tid('menu-dashboard'));
  await page.waitForSelector('.army-table');
  assert.match(await page.textContent('.army-table'), /Q · 9g/);
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

test('phone width 390x844: no horizontal scroll in battle', async () => {
  const { context, page, errors } = await open({ width: 390, height: 844 });
  await page.screenshot({ path: `${ART}menu-390.png`, fullPage: true });
  await page.click(tid('menu-level-L1'));
  await page.waitForSelector(tid('reinforce-r'));
  assert.equal((await noPageScroll(page)).h, true);
  await page.screenshot({ path: `${ART}battle-390.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
});

test('settings: hide hints, bounty off; persisted across reload and recorded', async () => {
  const { context, page, errors } = await open();
  await page.click(tid('menu-settings'));
  await page.screenshot({ path: `${ART}settings-1280.png` });
  await page.click(tid('setting-showHints'));
  await page.click(tid('setting-captureBounty'));
  await page.reload();
  await page.waitForSelector(tid('menu-level-L1'));
  const s = await page.evaluate(() => window.__cbs.ctx.settings.get());
  assert.equal(s.showHints, false);
  assert.equal(s.captureBounty, false);
  await page.click(tid('menu-level-L1'));
  await page.waitForSelector(tid('reinforce-r'));
  await page.click('[data-square="e1"]');
  assert.equal(await page.$$eval('.sq.target, .sq.capture-target', (els) => els.length), 0, 'hints hidden');
  const active = await page.evaluate(() => window.__cbs.ctx.recorder.active());
  assert.deepEqual(active.rules, { captureBounty: false });
  assert.deepEqual(errors, []);
  await context.close();
});

test('demo: AI vs AI builds armies from lone kings, with commentary, and records nothing', async () => {
  const { context, page, errors } = await open();
  await page.click(tid('menu-demo'));
  await page.screenshot({ path: `${ART}demo-options-1280.png` });
  await page.click(tid('demo-speed-fast'));
  await page.click(tid('demo-start'));
  await waitPlies(page, 8);
  const drops = await page.evaluate(() => window.__cbs.match.drops().map((d) => d.color));
  assert.ok(drops.includes('w') && drops.includes('b'), 'both AIs bought pieces');
  assert.ok((await page.$$('.notes li')).length >= 5, 'commentary lines');
  assert.match(await page.textContent('.notes'), /bought a/);
  assert.deepEqual(await noPageScroll(page), { v: true, h: true }, 'demo fits 1280x720');
  await page.screenshot({ path: `${ART}demo-1280.png` });
  await page.click(tid('demo-stop'));
  assert.equal((await sessions(page)).length, 0, 'demo games are not playtest data');
  assert.deepEqual(errors, []);
  await context.close();
});

test('consent card: shown over the menu on first launch, keyboard accessible, no scroll; declining sets denied', async () => {
  const { context, page, errors } = await open({ width: 1280, height: 720 }, { consent: 'none' });
  await page.waitForSelector(tid('consent-accept'));
  await page.screenshot({ path: `${ART}consent-1280.png` });
  assert.deepEqual(await noPageScroll(page), { v: true, h: true }, 'consent card fits 1280x720');
  // Both options are real, equally reachable buttons (no dark pattern of one being disabled/hidden).
  const [acceptTag, declineTag] = await Promise.all([
    page.evaluate((s) => document.querySelector(s)?.tagName, tid('consent-accept')),
    page.evaluate((s) => document.querySelector(s)?.tagName, tid('consent-decline')),
  ]);
  assert.equal(acceptTag, 'BUTTON');
  assert.equal(declineTag, 'BUTTON');
  await page.locator(tid('consent-decline')).focus();
  await page.keyboard.press('Enter');
  const consent = await page.evaluate(() => window.__cbs.ctx.settings.get().telemetryConsent);
  assert.equal(consent, 'denied');
  await page.waitForSelector(tid('consent-accept'), { state: 'hidden' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('consent accepted: a finished session is POSTed to the telemetry endpoint', async () => {
  const { context, page, errors } = await open({ width: 1280, height: 720 }, { consent: 'none' });
  const posts = [];
  await page.route('**/v1/sessions', async (route) => {
    posts.push(route.request().postData());
    await route.fulfill({ status: 204 });
  });
  await page.click(tid('consent-accept'));
  assert.equal(await page.evaluate(() => window.__cbs.ctx.settings.get().telemetryConsent), 'granted');

  await page.click(tid('menu-level-L1'));
  await page.waitForSelector(tid('reinforce-r'));
  await page.click(tid('resign'));
  await page.click(tid('resign-confirm'));
  await page.waitForSelector(tid('result-modal'));
  await page.waitForTimeout(200); // sendBeacon fires synchronously, but give the route handler a tick

  assert.equal(posts.length, 1, 'exactly one session was posted to the collector');
  const body = JSON.parse(posts[0]);
  assert.equal(body.schema, 1);
  assert.equal(body.mode, 'level');
  assert.equal(body.result, 'loss');
  assert.match(body.playerId, /^p_[0-9a-f]{16}$/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('consent declined: no request ever reaches the telemetry endpoint', async () => {
  const { context, page, errors } = await open({ width: 1280, height: 720 }, { consent: 'none' });
  let called = false;
  await page.route('**/v1/sessions', async (route) => {
    called = true;
    await route.fulfill({ status: 204 });
  });
  await page.click(tid('consent-decline'));
  assert.equal(await page.evaluate(() => window.__cbs.ctx.settings.get().telemetryConsent), 'denied');

  await page.click(tid('menu-level-L1'));
  await page.waitForSelector(tid('reinforce-r'));
  await page.click(tid('resign'));
  await page.click(tid('resign-confirm'));
  await page.waitForSelector(tid('result-modal'));
  await page.waitForTimeout(200);

  assert.equal(called, false, 'declining consent must never call the endpoint');
  const s = await sessions(page);
  assert.equal(s.length, 1, 'the session is still recorded locally');
  await context.close();
});

test('settings: Privacy switch changes consent any time, and the dashboard reflects it', async () => {
  const { context, page, errors } = await open(); // declines on the first-run card
  await page.click(tid('menu-settings'));
  assert.equal(await page.getAttribute(tid('setting-telemetryConsent'), 'aria-checked'), 'false');
  await page.click(tid('setting-telemetryConsent'));
  assert.equal(await page.evaluate(() => window.__cbs.ctx.settings.get().telemetryConsent), 'granted');
  await page.click(tid('nav-menu'));
  await page.click(tid('menu-dashboard'));
  assert.match(await page.textContent(tid('dash-consent-note')), /Sharing is on/);
  await page.click(tid('nav-settings'));
  await page.click(tid('setting-telemetryConsent'));
  assert.equal(await page.evaluate(() => window.__cbs.ctx.settings.get().telemetryConsent), 'denied');
  assert.deepEqual(errors, []);
  await context.close();
});
