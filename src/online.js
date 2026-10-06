// Which server-backed features exist in this build. Both live on the collector
// Worker (see COLLECTOR in config.js); with no endpoint the UI hides them
// instead of offering buttons that can only fail.
import { LEADERBOARD, TELEMETRY } from './config.js';

const has = (cfg) => typeof cfg?.endpoint === 'string' && cfg.endpoint.length > 0;

/** True when finished sessions can be uploaded (consent card, Settings → Privacy). */
export const telemetryOnline = (cfg = TELEMETRY) => has(cfg);

/** True when the leaderboard exists (menu entry, screen, result-card submit block). */
export const leaderboardOnline = (cfg = LEADERBOARD) => has(cfg);
