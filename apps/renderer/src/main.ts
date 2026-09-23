/**
 * Entry point: `node dist/main.js`.
 *
 * Reads PORT and the tuning knobs (src/config.ts) — nothing else from the
 * environment — loads the font bundle, starts Chromium warm, and serves.
 */
import { loadConfig } from './config.js';
import { BrowserManager } from './browser.js';
import { loadFontCatalog } from './fonts/catalog.js';
import { substituteFaces } from './fonts/google-css.js';
import { toPreloadFaces } from './page/preload.js';
import { createRendererServer } from './server.js';
import { createLogger, clean } from './log.js';
import { resolveMemoryLimit } from './memory.js';

const logger = createLogger();
const { config, warnings } = loadConfig();
for (const w of warnings) logger.warn('ignoring an invalid setting', { ...w });

const catalog = loadFontCatalog();
const preloadFaces = toPreloadFaces(substituteFaces(catalog));
const browsers = new BrowserManager({
  executablePath: config.executablePath,
  recycleAfter: config.recycleAfter,
  protocolTimeoutMs: config.renderTimeoutMs + 5_000,
  logger,
});
const memoryLimitBytes = resolveMemoryLimit(config.memoryLimitBytes);
const renderer = createRendererServer({
  config,
  browsers,
  deps: { catalog, preloadFaces },
  logger,
  memoryLimitBytes,
});

renderer.server.listen(config.port, config.host, () => {
  logger.info('renderer listening', {
    host: config.host,
    port: config.port,
    fonts: catalog.families.size,
    substitutes: catalog.substitutes.size,
    memoryLimitMb: memoryLimitBytes === null ? null : Math.round(memoryLimitBytes / 1048576),
    queueMax: config.queueMax,
    renderTimeoutMs: config.renderTimeoutMs,
  });
  // Warm start: /health reports the Chromium version once this lands, and
  // answers 503 until then (so a deploy whose browser cannot start never
  // goes live).
  browsers.acquire().catch((e: unknown) => logger.error('warm launch failed', { error: clean(e) }));
});

let stopping = false;
const stop = (signal: string) => {
  if (stopping) return;
  stopping = true;
  logger.info('shutting down', { signal });
  renderer
    .shutdown()
    .catch((e: unknown) => logger.error('shutdown error', { error: clean(e) }))
    .finally(() => process.exit(0));
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
process.on('unhandledRejection', (e) => logger.error('unhandled rejection', { error: clean(e) }));
