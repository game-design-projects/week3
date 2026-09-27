// Promise wrapper around the AI worker. Falls back to running the search on
// the main thread (after a setTimeout yield) when Workers are unavailable —
// e.g. in Node tests or odd embedding contexts.
import { createLogger } from '../lib/log.js';

const log = createLogger('ai');

export function createAIClient({ workerUrl = new URL('./worker.js', import.meta.url) } = {}) {
  let worker = null;
  let nextId = 1;
  const pending = new Map();

  if (typeof Worker !== 'undefined') {
    try {
      worker = new Worker(workerUrl, { type: 'module' });
      worker.onmessage = ({ data }) => {
        const job = pending.get(data.id);
        if (!job) return;
        pending.delete(data.id);
        if (data.error) job.reject(new Error(data.error));
        else job.resolve(data.result);
      };
      worker.onerror = (e) => {
        log.error('AI worker crashed — falling back to main thread', e.message ?? e);
        worker = null;
        for (const [id, job] of pending) {
          pending.delete(id);
          inline(job.request).then(job.resolve, job.reject);
        }
      };
      log.info('AI running in a Web Worker');
    } catch (e) {
      log.warn('Web Worker unavailable, AI runs on the main thread:', e?.message ?? e);
      worker = null;
    }
  }

  async function inline(request) {
    await new Promise((r) => setTimeout(r, 0));
    const { chooseMove } = await import('./search.js');
    return chooseMove(request);
  }

  return {
    get mode() {
      return worker ? 'worker' : 'inline';
    },
    async chooseMove(request) {
      const t0 = performance.now();
      let result;
      if (worker) {
        const id = nextId++;
        result = await new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject, request });
          worker.postMessage({ id, request });
        });
      } else {
        result = await inline(request);
      }
      log.debug(`AI ${result.uci} depth ${result.depth} nodes ${result.nodes} in ${Math.round(performance.now() - t0)}ms`);
      return result;
    },
    dispose() {
      worker?.terminate();
      worker = null;
      for (const job of pending.values()) job.reject(new Error('AI client disposed'));
      pending.clear();
    },
  };
}
