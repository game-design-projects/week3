// First-run consent card for anonymous playtest telemetry.
//
// Shown over the menu the first time the game runs (settings.telemetryConsent
// === 'unset') and stays up — nothing is sent anywhere until the player picks
// one of the two equally-weighted options below. The choice can be changed
// any time from Settings → Privacy (src/ui/screens/settings.js).
import { fill, h } from './dom.js';

const SHARED = ['Moves and purchases', 'Results and timings', 'Your settings and house rules', 'A random player id (no account)'];
const NOT_SHARED = ['Your name or account', 'Your IP address', 'Cookies or cross-site tracking'];

/**
 * @param {HTMLElement} el fixed-position container (see #consent-overlay in index.html)
 * @param {{ settings: ReturnType<import('../settings.js').createSettings> }} ctx
 */
export function mountConsent(el, ctx) {
  function list(title, items) {
    return h('div', { class: 'consent-col' }, h('h4', {}, title), h('ul', {}, items.map((t) => h('li', {}, t))));
  }

  function paint() {
    const show = ctx.settings.get().telemetryConsent === 'unset';
    el.hidden = !show;
    if (!show) return fill(el);
    fill(
      el,
      h(
        'div',
        { class: 'dialog consent', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'consent-title' },
        h('p', { class: 'kicker' }, 'Before you start'),
        h('h2', { id: 'consent-title' }, 'Share anonymous playtest data?'),
        h('p', {}, 'It helps us balance the game for our NYU Game Design class.'),
        h('div', { class: 'consent-lists' }, list('We share', SHARED), list("We don't share", NOT_SHARED)),
        h(
          'div',
          { class: 'consent-actions' },
          h(
            'button',
            { class: 'btn', type: 'button', dataset: { testid: 'consent-accept' }, onclick: () => ctx.settings.set({ telemetryConsent: 'granted' }) },
            'Share anonymous data',
          ),
          h(
            'button',
            { class: 'btn', type: 'button', dataset: { testid: 'consent-decline' }, onclick: () => ctx.settings.set({ telemetryConsent: 'denied' }) },
            'Keep it on this device',
          ),
        ),
        h('p', { class: 'fine' }, 'Change this any time in Settings → Privacy.'),
      ),
    );
    el.querySelector('.btn')?.focus();
  }

  ctx.settings.onChange(paint);
  paint();
}
