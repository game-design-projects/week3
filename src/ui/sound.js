// Synthesized sound effects (WebAudio, no asset files). The AudioContext is
// created lazily on the first play(), because browsers only allow audio after a
// user gesture, and every play() here follows one.
//
// Lecture 2 ("sound"): every event the player should *feel* has its own voice.
// A move is a wooden thock, a capture is a heavier thud that deepens with the
// value of the piece taken, coins clink upward as they are counted out, a
// purchase lands like a stamp, and mate is the biggest thud in the game.
// recipe() is pure (unit-tested); play() is the only part that touches WebAudio.

import { createLogger } from '../lib/log.js';

const log = createLogger('sound');

/**
 * A voice: { wave, f, f2?, t, d, g, filter? }
 *   wave   'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise'
 *   f, f2  start / end frequency in Hz (f2 → a pitch drop, e.g. a thud)
 *   t, d   start and duration in seconds; g peak gain (0..1)
 *   filter { type: BiquadFilterType, freq, q? } — mostly for shaping noise
 */
const thock = (g = 0.5, f = 190) => [
  { wave: 'noise', t: 0, d: 0.045, g: g * 0.9, filter: { type: 'bandpass', freq: 1700, q: 1.4 } },
  { wave: 'sine', f, f2: f * 0.6, t: 0, d: 0.09, g },
];

const RECIPES = {
  move: () => thock(0.5),
  capture: ({ value = 1 } = {}) => {
    const k = Math.min(Math.max(value, 1), 12) / 9; // pawn ≈ 0.11 … queen 1, mate 1.33
    return [
      { wave: 'noise', t: 0, d: 0.05 + 0.05 * k, g: Math.min(0.55 + 0.25 * k, 0.95), filter: { type: 'bandpass', freq: 1300 - 400 * k, q: 1 } },
      { wave: 'square', f: 170 - 50 * k, t: 0, d: 0.03, g: 0.12 },
      { wave: 'sine', f: 150 - 55 * k, f2: 90 - 40 * k, t: 0.005, d: 0.12 + 0.18 * k, g: Math.min(0.5 + 0.3 * k, 0.9) },
    ];
  },
  // one coin; index = how many were counted before it (pitch climbs a semitone each, up to an octave)
  coin: ({ index = 0 } = {}) => {
    const f = 1976 * 2 ** (Math.min(index, 12) / 12);
    return [
      { wave: 'sine', f, t: 0, d: 0.09, g: 0.14 },
      { wave: 'sine', f: f * 2.76, t: 0, d: 0.05, g: 0.05 },
    ];
  },
  // a bought piece landing: the stamp
  buy: () => [
    { wave: 'noise', t: 0, d: 0.07, g: 0.6, filter: { type: 'lowpass', freq: 700 } },
    { wave: 'sine', f: 110, f2: 55, t: 0, d: 0.16, g: 0.65 },
    { wave: 'triangle', f: 230, t: 0, d: 0.04, g: 0.18 },
  ],
  check: () => [
    ...thock(0.45),
    { wave: 'triangle', f: 880, t: 0.02, d: 0.08, g: 0.2 },
    { wave: 'triangle', f: 660, t: 0.11, d: 0.12, g: 0.18 },
  ],
  mate: () => [
    { wave: 'noise', t: 0, d: 0.22, g: 0.75, filter: { type: 'lowpass', freq: 500 } },
    { wave: 'sine', f: 90, f2: 38, t: 0, d: 0.55, g: 0.85 },
    { wave: 'triangle', f: 196, t: 0.02, d: 0.35, g: 0.18 },
  ],
  illegal: () => [
    { wave: 'sawtooth', f: 110, t: 0, d: 0.13, g: 0.09, filter: { type: 'lowpass', freq: 900 } },
    { wave: 'sawtooth', f: 104, t: 0, d: 0.13, g: 0.09, filter: { type: 'lowpass', freq: 900 } },
  ],
  win: () => [
    { wave: 'triangle', f: 523, t: 0, d: 0.14, g: 0.2 },
    { wave: 'triangle', f: 659, t: 0.12, d: 0.14, g: 0.2 },
    { wave: 'triangle', f: 784, t: 0.24, d: 0.3, g: 0.22 },
    { wave: 'triangle', f: 1047, t: 0.36, d: 0.45, g: 0.16 },
  ],
  lose: () => [
    { wave: 'triangle', f: 392, t: 0, d: 0.18, g: 0.2 },
    { wave: 'triangle', f: 311, t: 0.16, d: 0.18, g: 0.2 },
    { wave: 'triangle', f: 262, t: 0.32, d: 0.35, g: 0.2 },
  ],
};

export const SOUND_NAMES = Object.keys(RECIPES);

/** The voices for an effect (pure). opts: { value } for capture, { index } for coin. */
export function recipe(name, opts = {}) {
  return RECIPES[name]?.(opts) ?? [];
}

/** @param {{ enabled: () => boolean }} opts sound on/off comes from Settings */
export function createSound({ enabled = () => true } = {}) {
  let ctx = null;
  let master = null;
  let noise = null;

  function noiseBuffer() {
    if (noise) return noise;
    noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.6), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return noise;
  }

  function play(name, opts) {
    if (!enabled()) return;
    const voices = recipe(name, opts);
    if (!voices.length) return;
    try {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.7; // headroom: several voices can overlap (coins + capture)
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime + 0.005;
      for (const v of voices) {
        const start = t0 + v.t;
        const end = start + v.d;
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0.0001, start);
        amp.gain.exponentialRampToValueAtTime(v.g, start + 0.006);
        amp.gain.exponentialRampToValueAtTime(0.0001, end);
        let src;
        if (v.wave === 'noise') {
          src = ctx.createBufferSource();
          src.buffer = noiseBuffer();
        } else {
          src = ctx.createOscillator();
          src.type = v.wave;
          src.frequency.setValueAtTime(v.f, start);
          if (v.f2) src.frequency.exponentialRampToValueAtTime(v.f2, end);
        }
        let node = src;
        if (v.filter) {
          const bq = ctx.createBiquadFilter();
          bq.type = v.filter.type;
          bq.frequency.value = v.filter.freq;
          if (v.filter.q) bq.Q.value = v.filter.q;
          node = node.connect(bq);
        }
        node.connect(amp).connect(master);
        src.start(start);
        src.stop(end + 0.02);
      }
    } catch (e) {
      log.debug('audio unavailable', e?.message ?? e);
    }
  }

  return { play };
}
