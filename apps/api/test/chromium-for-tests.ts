/**
 * Find a Chromium the raster suites can actually drive, or say why not.
 *
 * The rasterizer's interesting assertions are about PIXELS — did the
 * artwork-only page come back as artwork, did the aspect survive, did the
 * bound truncate. None of that can be faked with a stub browser, so the suites
 * that make those claims need a real binary.
 *
 * When there is none, the suite SKIPS with a named reason rather than passing.
 * A green run that silently exercised nothing is worse than a skipped one: it
 * is the "green CI is not proof" failure this repo has already paid for twice.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where a Playwright install puts the browser, per platform. */
const PLAYWRIGHT_SUFFIXES = [
  join(
    'chrome-mac-arm64',
    'Google Chrome for Testing.app',
    'Contents',
    'MacOS',
    'Google Chrome for Testing',
  ),
  join(
    'chrome-mac',
    'Google Chrome for Testing.app',
    'Contents',
    'MacOS',
    'Google Chrome for Testing',
  ),
  join('chrome-linux', 'chrome'),
  join('chrome-win', 'chrome.exe'),
];

function playwrightCacheRoot(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH)
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32')
    return join(homedir(), 'AppData', 'Local', 'ms-playwright');
  return join(homedir(), '.cache', 'ms-playwright');
}

/**
 * Absolute path to a usable Chromium, or null.
 *
 * Order matters: an explicitly configured binary wins, then the container's
 * (which is what production actually runs), then whatever a developer machine
 * happens to have from Playwright.
 */
export function findChromium(): string | null {
  const explicit = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (explicit && existsSync(explicit)) return explicit;

  for (const path of [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ]) {
    if (existsSync(path)) return path;
  }

  const root = playwrightCacheRoot();
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  // Newest build first, so a machine with several installs uses the current one.
  const builds = entries
    .filter((name) => name.startsWith('chromium-'))
    .sort(
      (a, b) => Number(b.split('-')[1] ?? 0) - Number(a.split('-')[1] ?? 0),
    );
  for (const build of builds) {
    for (const suffix of PLAYWRIGHT_SUFFIXES) {
      const candidate = join(root, build, suffix);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Can this Jest process `import()` an ESM-only package?
 *
 * `puppeteer-core` 25 is ESM-only and the API is CommonJS — which is why the
 * shipped worker loads it with a dynamic `import()`. Jest's CJS registry
 * refuses that unless Node is started with `--experimental-vm-modules`, and on
 * Node 20 `require(esm)` is still flagged too. So the flag is a hard
 * precondition for any suite that drives a real browser, and its absence has
 * to read as SKIPPED, never as passed.
 */
export function canImportEsm(): boolean {
  const flags = `${process.execArgv.join(' ')} ${process.env.NODE_OPTIONS ?? ''}`;
  return flags.includes('--experimental-vm-modules');
}

/** Load the real puppeteer. Only call this inside `describeWithChromium`. */
export async function loadPuppeteerForTests(): Promise<{
  launch(options: any): Promise<any>;
}> {
  const mod: any = await import('puppeteer-core');
  return mod.default ?? mod;
}

/** The exact command that makes the skipped suites run. */
export const RASTER_SUITE_COMMAND =
  'NODE_OPTIONS=--experimental-vm-modules pnpm --filter api exec jest --runInBand ' +
  '--watchman=false --testPathPatterns raster';

/**
 * `describe` when a real browser can be driven, `describe.skip` with a loud
 * reason when it cannot. Use it, never a bare `describe`, for anything that
 * paints.
 */
export function describeWithChromium(
  name: string,
  body: (executablePath: string) => void,
): void {
  const executablePath = findChromium();
  const missing: string[] = [];
  if (!executablePath) {
    missing.push(
      'no Chromium binary (set PUPPETEER_EXECUTABLE_PATH, install one at ' +
        '/usr/bin/chromium-browser, or run `pnpm --filter web exec playwright install chromium`)',
    );
  }
  if (!canImportEsm()) {
    missing.push(
      `Node was not started with --experimental-vm-modules (run: ${RASTER_SUITE_COMMAND})`,
    );
  }
  if (missing.length > 0) {
    console.warn(
      `[skip] "${name}" did NOT run — ${missing.join('; and ')}. ` +
        'These are the assertions that prove pages actually rasterize.',
    );
    // The reason goes in the TEST NAME as well as the log line: a console
    // warning is easy to lose in a full CI run, but a skipped test that reads
    // "SKIPPED — no Chromium binary" is visible in the summary.
    describe.skip(name, () => {
      it(`SKIPPED — ${missing.join('; and ')}`, () => undefined);
    });
    return;
  }
  describe(name, () => body(executablePath as string));
}
