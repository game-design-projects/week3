// Boot + router. One store/recorder/AI client for the whole page, passed to
// every screen through `ctx`. Each screen module exports
//   mount(root, ctx, params) → unmount()

import { APP_VERSION, BALANCE_VERSION } from './config.js';
import { createLogger } from './lib/log.js';
import { createAIClient } from './ai/client.js';
import { createStore } from './telemetry/store.js';
import { createRecorder } from './telemetry/session.js';
import { createSettings } from './settings.js';
import { createSound } from './ui/sound.js';
import { mountConsent } from './ui/consent.js';
import * as menu from './ui/screens/menu.js';
import * as battle from './ui/screens/battle.js';
import * as free from './ui/screens/free.js';
import * as dashboard from './ui/screens/dashboard.js';
import * as howto from './ui/screens/howto.js';
import * as demo from './ui/screens/demo.js';
import * as settingsScreen from './ui/screens/settings.js';

const log = createLogger('app');
const SCREENS = { menu, battle, free, dashboard, howto, demo, settings: settingsScreen };

const root = document.getElementById('screen');
const toastEl = document.getElementById('toast');
let unmount = null;
let toastTimer = null;

const settings = createSettings();
const store = createStore({ canSend: () => settings.get().telemetryConsent === 'granted' });
const ctx = {
  store,
  settings,
  recorder: createRecorder({ store }),
  ai: createAIClient(),
  sound: createSound({ enabled: () => settings.get().sound }),
  log,
  go,
  toast(message, kind = 'info') {
    toastEl.textContent = message;
    toastEl.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.className = ''), 3200);
  },
};

function go(name, params = {}) {
  const screen = SCREENS[name];
  if (!screen) throw new Error(`unknown screen: ${name}`);
  log.info('screen →', name, params.mode ?? '');
  try {
    unmount?.();
  } catch (e) {
    log.error('unmount failed', e);
  }
  unmount = null;
  root.replaceChildren();
  root.dataset.screen = name;
  root.scrollTop = 0;
  unmount = screen.mount(root, ctx, params) ?? null;
  root.focus({ preventScroll: true });
}

// ---- settings that are pure presentation: body classes read by the CSS
const soundBtn = document.querySelector('[data-testid="sound-toggle"]');
function applySettings(v) {
  document.body.classList.toggle('no-coords', !v.showCoords);
  document.body.classList.toggle('no-anim', !v.animations);
  soundBtn.textContent = v.sound ? 'Sound on' : 'Sound off';
  soundBtn.setAttribute('aria-pressed', String(v.sound));
}
settings.onChange(applySettings);
applySettings(settings.get());
soundBtn.addEventListener('click', () => settings.set({ sound: !settings.get().sound }));
document.querySelector('[data-testid="nav-settings"]').addEventListener('click', () => go('settings'));

const fsBtn = document.querySelector('[data-testid="fullscreen-toggle"]');
if (!document.fullscreenEnabled) fsBtn.hidden = true;
fsBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch((e) => log.warn('fullscreen refused', e?.message));
});

document.querySelector('[data-testid="nav-menu"]').addEventListener('click', () => go('menu'));

// ---- telemetry consent: a small card over the menu until the player decides
mountConsent(document.getElementById('consent-overlay'), ctx);

// ---- lifecycle + diagnostics
window.addEventListener('pagehide', () => ctx.recorder.abandon());
window.addEventListener('error', (e) => log.error('uncaught', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => log.error('unhandled rejection', e.reason));

window.__cbs = { ctx, version: APP_VERSION, balance: BALANCE_VERSION, match: null };
log.info(`Chess Battle Simulator ${APP_VERSION} (balance ${BALANCE_VERSION}); telemetry storage ${store.available ? 'on' : 'memory-only'}`);
go('menu');
