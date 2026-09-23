/**
 * Start a real renderer server in-process on an ephemeral loopback port.
 */
import type { AddressInfo } from 'node:net';
import { BrowserManager } from '../../src/browser.js';
import { loadConfig, type RendererConfig } from '../../src/config.js';
import { loadFontCatalog, type FontCatalog } from '../../src/fonts/catalog.js';
import { substituteFaces } from '../../src/fonts/google-css.js';
import { toPreloadFaces } from '../../src/page/preload.js';
import { createRendererServer, type RendererServer } from '../../src/server.js';
import { silentLogger, type Logger } from '../../src/log.js';

let catalogCache: FontCatalog | null = null;
export function testCatalog(): FontCatalog {
  catalogCache ??= loadFontCatalog();
  return catalogCache;
}

export interface TestServer {
  url: string;
  renderer: RendererServer;
  browsers: BrowserManager;
  close(): Promise<void>;
}

export async function startTestServer(opts: {
  executablePath: string | null;
  config?: Partial<RendererConfig>;
  logger?: Logger;
  memoryLimitBytes?: number | null;
  readMemory?: () => number | null;
}): Promise<TestServer> {
  const base = loadConfig({}).config;
  const config: RendererConfig = { ...base, host: '127.0.0.1', port: 0, executablePath: opts.executablePath, ...opts.config };
  const catalog = testCatalog();
  const logger = opts.logger ?? silentLogger;
  const browsers = new BrowserManager({
    executablePath: config.executablePath,
    recycleAfter: config.recycleAfter,
    protocolTimeoutMs: config.renderTimeoutMs + 5000,
    logger,
  });
  const renderer = createRendererServer({
    config,
    browsers,
    deps: { catalog, preloadFaces: toPreloadFaces(substituteFaces(catalog)) },
    logger,
    memoryLimitBytes: opts.memoryLimitBytes ?? null,
    readMemory: opts.readMemory,
  });
  await new Promise<void>((resolve) => renderer.server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = renderer.server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    renderer,
    browsers,
    close: () => renderer.shutdown(2000),
  };
}

export async function postRender(url: string, body: unknown): Promise<{ status: number; json: any; headers: Headers }> {
  const res = await fetch(`${url}/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, headers: res.headers };
}
