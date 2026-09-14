/**
 * Run the browser e2e specs against an ALREADY-RUNNING web server — the local
 * sandbox stack (web dev on 3100 → API on 8081 → `venueos_sandbox`) — instead
 * of the prebuilt `next start` on 3000 that playwright.config.ts boots.
 *
 * Why: the default config's webServer runs `next build`, which rewrites
 * `.next` under a dev server that is using it, and costs minutes of CPU. For a
 * spec that mocks the API with page.route (the builder specs), the dev server
 * is all it needs.
 *
 *   E2E_BASE=http://localhost:3100 pnpm exec playwright test -c playwright.sandbox.config.ts tests/e2e/builder-tile-click-adds-widget.spec.ts
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const BASE = process.env.E2E_BASE || 'http://localhost:3100';

export default defineConfig({
  ...base,
  webServer: undefined,
  // The base config's global setup warms /player and /board on the PREBUILT
  // server and waits 45 s per route when nothing answers on :3000 — pure delay
  // here, where the dev server compiles a route on first request anyway.
  globalSetup: undefined,
  globalTeardown: undefined,
  use: { ...(base.use || {}), baseURL: BASE },
});
