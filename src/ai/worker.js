// Module Web Worker: runs the search off the main thread so the UI never freezes.
// Protocol: postMessage({ id, request }) → { id, result } | { id, error }.
import { chooseMove } from './search.js';

self.onmessage = ({ data }) => {
  const { id, request } = data ?? {};
  try {
    self.postMessage({ id, result: chooseMove(request) });
  } catch (e) {
    self.postMessage({ id, error: e?.message ?? String(e) });
  }
};
