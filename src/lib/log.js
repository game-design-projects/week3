// Tiny namespaced logger.
//
// Level comes from (first match wins):
//   1. URL query  ?debug=1  (debug) / ?debug=0 (warn)
//   2. localStorage 'cbs.log'  -> 'debug' | 'info' | 'warn' | 'error' | 'silent'
//   3. process.env.CBS_LOG in Node (tests/tools)
//   4. default: 'info' in the browser, 'warn' in Node
//
// Usage: const log = createLogger('ai'); log.debug('searched', { nodes });

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function detectLevel() {
  try {
    if (typeof location !== 'undefined' && location.search) {
      const q = new URLSearchParams(location.search).get('debug');
      if (q === '1' || q === 'true') return 'debug';
      if (q === '0' || q === 'false') return 'warn';
    }
  } catch {
    /* ignore */
  }
  try {
    const stored = globalThis.localStorage?.getItem('cbs.log');
    if (stored && stored in LEVELS) return stored;
  } catch {
    /* storage may be blocked (private mode, sandboxed iframe) */
  }
  const env = globalThis.process?.env?.CBS_LOG;
  if (env && env in LEVELS) return env;
  return typeof window === 'undefined' ? 'warn' : 'info';
}

let threshold = LEVELS[detectLevel()];

export function setLogLevel(level) {
  if (!(level in LEVELS)) throw new Error(`unknown log level: ${level}`);
  threshold = LEVELS[level];
}

export function createLogger(namespace) {
  const prefix = `[CBS:${namespace}]`;
  const emit = (level, method) => (...args) => {
    if (LEVELS[level] < threshold) return;
    // eslint-disable-next-line no-console
    console[method](prefix, ...args);
  };
  return {
    debug: emit('debug', 'debug'),
    info: emit('info', 'info'),
    warn: emit('warn', 'warn'),
    error: emit('error', 'error'),
  };
}
