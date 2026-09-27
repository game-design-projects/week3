// Tiny synthesized sound effects (WebAudio, no asset files). The AudioContext
// is created lazily on the first play() — browsers only allow audio after a
// user gesture, and every play() here follows a click.

import { createLogger } from '../lib/log.js';

const log = createLogger('sound');

// Each effect: list of [frequency Hz, start s, duration s, type, gain]
const EFFECTS = {
  move: [[220, 0, 0.06, 'triangle', 0.35], [140, 0.005, 0.05, 'sine', 0.25]],
  capture: [[180, 0, 0.09, 'square', 0.18], [90, 0.01, 0.12, 'triangle', 0.35]],
  check: [[880, 0, 0.08, 'triangle', 0.2], [660, 0.09, 0.12, 'triangle', 0.18]],
  buy: [[1320, 0, 0.05, 'triangle', 0.18], [1760, 0.05, 0.09, 'triangle', 0.16]],
  sell: [[990, 0, 0.05, 'triangle', 0.14], [660, 0.05, 0.08, 'triangle', 0.12]],
  illegal: [[120, 0, 0.12, 'sawtooth', 0.08]],
  win: [[523, 0, 0.14, 'triangle', 0.2], [659, 0.12, 0.14, 'triangle', 0.2], [784, 0.24, 0.3, 'triangle', 0.22]],
  lose: [[392, 0, 0.18, 'triangle', 0.2], [311, 0.16, 0.18, 'triangle', 0.2], [262, 0.32, 0.35, 'triangle', 0.2]],
};

/** @param {{ enabled: () => boolean }} opts sound on/off comes from Settings */
export function createSound({ enabled = () => true } = {}) {
  let ctx = null;

  function play(name) {
    if (!enabled() || !EFFECTS[name]) return;
    try {
      ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime;
      for (const [freq, start, dur, type, gain] of EFFECTS[name]) {
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        amp.gain.setValueAtTime(0.0001, t0 + start);
        amp.gain.exponentialRampToValueAtTime(gain, t0 + start + 0.008);
        amp.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
        osc.connect(amp).connect(ctx.destination);
        osc.start(t0 + start);
        osc.stop(t0 + start + dur + 0.02);
      }
    } catch (e) {
      log.debug('audio unavailable', e?.message ?? e);
    }
  }

  return { play };
}
