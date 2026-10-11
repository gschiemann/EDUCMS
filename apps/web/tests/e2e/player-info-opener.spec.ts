import { test, expect, type Page } from '@playwright/test';
import { bootMockPlayer, ok, playerIds, playerManifest } from './helpers/mock-player';

/**
 * INFORMATION-CARD OPENER — the 2026-10-10 Vision Core bug, pinned.
 *
 * A blue "Screen information" card (Sync / Resize / Stop) was photographed
 * over unattended, playing video on a screen nobody touched. The 30-second
 * idle dismissal (7abab895) fixed how long it stayed; the owner named the
 * UNEXPECTED OPENING as the bug. Every writer of that card is input-driven,
 * and the accidental paths were children rendered INSIDE the role=button
 * playback root whose clicks bubbled into its toggle, plus a global Home/i
 * shortcut with no phase/surface guard. One policy now governs every opener
 * (`infoOpenDecision`, infoOverlayEvidence.ts): content on the glass, not
 * BLANK, not stopped, not already open, unmodified key, not from a control /
 * typing / status / prompt surface.
 *
 * Each test below drives one accidental path and proves it does NOT open the
 * card — and then proves the DELIBERATE remote path still does (player rule
 * 15: the remote must still reach the card and its offline tools) and that
 * Back still closes it. Harness rules apply (CLAUDE.md player rule 14): the
 * realtime stub delegates non-/realtime sockets, mocks key on state, the
 * connecting hero is a real post-register phase so its heading proves mount.
 */

test.use({ serviceWorkers: 'block' });

const info = (page: Page) => page.getByRole('dialog', { name: 'Screen information' });
const root = (page: Page) => page.locator('[data-edu-player-root="media"]');
const resume = (page: Page) => page.getByRole('button', { name: /Resume/ });
const SLIDES = 'img[data-slide-id]';

type TestWindow = Window & {
  __eduTestRealtime?: { deliver(message: unknown): void };
  __eduTestWsSent?: string[];
};

const pressBack = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new CustomEvent('edu-show-stop-overlay')));

/** Let any discrete-event render flush before asserting "nothing opened". */
const settle = (page: Page) => page.waitForTimeout(300);

async function deliver(page: Page, message: unknown) {
  await expect
    .poll(() => page.evaluate(() => !!(window as unknown as TestWindow).__eduTestRealtime), { timeout: 20_000, message: 'realtime stub never opened' })
    .toBe(true);
  await page.evaluate((m) => (window as unknown as TestWindow).__eduTestRealtime!.deliver(m), message);
}

let seq = 0;
const push = (type: string, payload: Record<string, unknown>) => ({
  type, eventId: `evt-info-${type}-${++seq}`, timestamp: Date.now(), signature: 'test-signature', payload,
});

/** The accidental inputs a playback root can receive, all at once. */
async function strayInputs(page: Page) {
  await page.evaluate(() => (document.querySelector('[data-edu-player-root="media"]') as HTMLElement | null)?.focus());
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await page.keyboard.press('i');
  await page.keyboard.press('Home');
  await settle(page);
}

/**
 * The deliberate remote path: i from the canvas opens on playing content, Back
 * closes, nothing else is left behind. Focus is returned to the canvas first —
 * a key whose target is still a focused control (a toast button the operator
 * just pressed) is a control activation, not the canvas shortcut, by policy.
 */
async function deliberateOpenThenBack(page: Page) {
  await page.evaluate(() => (document.querySelector('[data-edu-player-root="media"]') as HTMLElement | null)?.focus());
  await page.keyboard.press('i');
  await expect(info(page)).toBeVisible();
  await pressBack(page);
  await expect(info(page)).toHaveCount(0);
  await expect(resume(page)).toHaveCount(0);
}

test('connecting hero: click / Enter / Space / i / Home never open the card; Back still escapes; the journal counts the refusals and the real opening rides the heartbeat', async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install();
  const tag = 'opener-connecting';
  const id = playerIds(tag);
  const state = { manifest: '401' as '401' | 'ok' };
  const manifest = playerManifest(id.screenId, 'images');
  await bootMockPlayer(page, { tag, kind: 'images', manifest, extraRoutes: async p => {
    await p.route(`**/api/v1/screens/${id.screenId}/manifest*`, route => state.manifest === '401'
      ? route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"expired"}' })
      : ok(route, manifest));
  } });
  // Paired instantly, manifest 401s → the post-pair connecting hero. It only
  // renders after a client-side register round-trip, so it proves mount.
  const hero = page.getByRole('heading', { name: 'Connecting to your CMS' });
  await expect(hero).toBeVisible({ timeout: 30_000 });
  // The hero lives INSIDE the role=button media root (the review's phase gap):
  // a click on its text used to bubble into the information toggle.
  await expect(root(page)).toBeAttached();
  await hero.click();
  await strayInputs(page);
  await expect(info(page)).toHaveCount(0);
  await expect(hero).toBeVisible();

  // Rule 15 — Back still reaches the escape surface on the hero, and toggles back.
  await pressBack(page);
  await expect(resume(page)).toBeVisible({ timeout: 5_000 });
  await expect(info(page)).toHaveCount(0);
  await pressBack(page);
  await expect(hero).toBeVisible({ timeout: 5_000 });

  // Content lands → the deliberate remote path works exactly as before.
  state.manifest = 'ok';
  await deliver(page, push('SYNC', {}));
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  await deliberateOpenThenBack(page);

  // The opener journal rides EVERY 15 s heartbeat: the refusals on the hero
  // and the one real opening, with no text, URLs or ids.
  await page.clock.fastForward(16_000);
  const playerInfo = await page.evaluate(() => {
    const frames = ((window as unknown as TestWindow).__eduTestWsSent ?? [])
      .map(f => { try { return JSON.parse(f); } catch { return null; } })
      .filter(f => f && f.event === 'HEARTBEAT');
    return frames.length ? frames[frames.length - 1].data?.metrics?.playerInfo ?? null : null;
  });
  expect(playerInfo).not.toBeNull();
  expect(playerInfo.refused.phase).toBeGreaterThanOrEqual(1);
  expect(playerInfo.events).toHaveLength(1);
  expect(playerInfo.events[0]).toMatchObject({ source: 'remote-key', key: 'i', type: 'keydown' });
  expect(playerInfo.open).toBe(false);
  const wire = JSON.stringify(playerInfo);
  expect(wire.length).toBeLessThan(2048);
  expect(wire).not.toMatch(/api\.invalid|slide-|asset-|fake\.device|Connecting/);
});

test('update prompt: its text, Not now (mouse and keyboard) and Update now never open the card', async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install();
  const tag = 'opener-update';
  const id = playerIds(tag);
  // The operator-confirmed prompt is raised by the SSE CHECK_FOR_UPDATES arm
  // (the WS arm shows OTA progress instead), and SSE opens only after the
  // WebSocket has failed three times — so this screen's socket is blocked.
  await bootMockPlayer(page, { tag, kind: 'images', wsMode: 'fail', nativeMethods: ['checkForUpdates', 'checkForUpdatesUserInitiated'] });
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  await expect.poll(async () => {
    await page.clock.fastForward(5_000);
    return page.evaluate(() => !!(window as unknown as { __eduTestSse?: unknown }).__eduTestSse);
  }, { timeout: 60_000, message: 'SSE fallback never opened' }).toBe(true);
  const prompt = page.locator('[data-edu-update-prompt]');
  const raise = async () => {
    const message = push('CHECK_FOR_UPDATES', { scope: 'screen', scopeId: id.screenId, corrId: `cfu-${seq}` });
    await page.evaluate((m) => (window as unknown as { __eduTestSse: { deliver(name: string, message: unknown): void } }).__eduTestSse.deliver('CHECK_FOR_UPDATES', m), message);
    await expect(prompt.getByText('Software update ready')).toBeVisible({ timeout: 5_000 });
  };

  await raise();
  await prompt.getByText('Software update ready').click();
  await prompt.click({ position: { x: 10, y: 10 } }); // the backdrop
  await settle(page);
  await expect(info(page)).toHaveCount(0);
  await prompt.getByRole('button', { name: 'Not now' }).click();
  await expect(prompt).toHaveCount(0);
  await settle(page);
  await expect(info(page)).toHaveCount(0);

  // Keyboard activation of the button produces a bubbling click too.
  await raise();
  await prompt.getByRole('button', { name: 'Not now' }).focus();
  await page.keyboard.press('Enter');
  await expect(prompt).toHaveCount(0);
  await settle(page);
  await expect(info(page)).toHaveCount(0);

  await raise();
  await prompt.getByRole('button', { name: 'Update now' }).click();
  await expect(prompt.getByText('Updating…')).toBeVisible();
  await settle(page);
  await expect(info(page)).toHaveCount(0);
});

test('reconnect toast: Retry now, Reset and its text never open the card; a deliberate key still does', async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install();
  const tag = 'opener-reconnect';
  const id = playerIds(tag);
  const state = { fail: false };
  const manifest = playerManifest(id.screenId, 'images');
  await bootMockPlayer(page, { tag, kind: 'images', manifest, extraRoutes: async p => {
    await p.route(`**/api/v1/screens/${id.screenId}/manifest*`, route => state.fail ? route.abort('failed') : ok(route, manifest));
  } });
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });

  // The network drops; a pushed SYNC makes the next fetch fail now rather
  // than on the poll timer, and the toast appears after its 15 s grace.
  state.fail = true;
  await deliver(page, push('SYNC', {}));
  const toast = page.locator('[data-edu-reconnect-toast]');
  await expect.poll(async () => {
    await page.clock.fastForward(5_000);
    return toast.count();
  }, { timeout: 30_000, message: 'reconnect toast never appeared' }).toBe(1);
  await expect(toast.getByRole('button', { name: 'Retry now' })).toBeVisible();

  await toast.getByText(/^Reconnecting/).first().click();
  await toast.getByRole('button', { name: 'Retry now' }).click();
  await settle(page);
  await expect(info(page)).toHaveCount(0);
  // Content is still on the glass behind the toast — the deliberate path works.
  await expect(page.locator(SLIDES)).toHaveCount(3);
  await deliberateOpenThenBack(page);

  // Reset re-registers the screen from scratch; it must not leave a card behind.
  await toast.getByRole('button', { name: 'Reset' }).click();
  await settle(page);
  await expect(info(page)).toHaveCount(0);
  state.fail = false;
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  await settle(page);
  await expect(info(page)).toHaveCount(0);
});

test('trust/status chip: clicking "Re-pair required" over live content never opens the card; i still does', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = 'opener-repair';
  const id = playerIds(tag);
  await bootMockPlayer(page, { tag, kind: 'images', extraRoutes: async p => {
    await p.route('**/api/v1/screens/register', route =>
      ok(route, { paired: true, screenId: id.screenId, name: `Proof ${tag}`, deviceToken: id.deviceToken, requiresRePair: true }));
  } });
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  const chip = page.locator('[data-edu-player-control-surface]', { hasText: 'Re-pair required' });
  await expect(chip).toBeVisible({ timeout: 10_000 });
  await chip.getByText('Re-pair required').click();
  // Its padding, inside the ~22px corner radius: a point OUTSIDE the rounded
  // corner is not the chip at all — hit-testing falls through to the canvas.
  await chip.click({ position: { x: 12, y: 20 } });
  await settle(page);
  await expect(info(page)).toHaveCount(0);
  await deliberateOpenThenBack(page);
});

test('BLANK: a click on the black layer or a key while blank never opens the card underneath; WAKE reveals content with no card', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = 'opener-blank';
  const id = playerIds(tag);
  await bootMockPlayer(page, { tag, kind: 'images' });
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });

  await deliver(page, push('DISPLAY_CONTROL', { screenId: id.screenId, action: 'BLANK', soft: true, actionId: 'blank-1' }));
  const blank = page.locator('[data-edu-soft-blank="1"]');
  await expect(blank).toBeVisible({ timeout: 5_000 });
  // A visitor pokes the dark panel; the operator's remote sends a stray key.
  await page.mouse.click(400, 300);
  await page.mouse.dblclick(600, 400);
  await strayInputs(page);
  await expect(info(page)).toHaveCount(0);

  await deliver(page, push('DISPLAY_CONTROL', { screenId: id.screenId, action: 'WAKE', soft: true, actionId: 'wake-1' }));
  await expect(blank).toHaveCount(0, { timeout: 5_000 });
  await settle(page);
  await expect(info(page)).toHaveCount(0);
  await expect(page.locator(SLIDES)).toHaveCount(3);
  await deliberateOpenThenBack(page);
});

test('paused surface: clicking the paused card or pressing Enter / i while stopped never opens the card over it; Back resumes', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = 'opener-paused';
  await bootMockPlayer(page, { tag, kind: 'images' });
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });
  await pressBack(page);
  const paused = page.getByRole('heading', { name: 'Playback Paused' });
  await expect(paused).toBeVisible({ timeout: 5_000 });
  await paused.click();
  await strayInputs(page);
  await expect(info(page)).toHaveCount(0);
  await expect(resume(page)).toBeVisible();
  await pressBack(page);
  await expect(paused).toHaveCount(0);
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 10_000 });
  await deliberateOpenThenBack(page);
});

test('a live emergency still retires the card and locks the remote; Ctrl+i and a key typed in the canvas editor never open it', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = 'opener-emergency';
  const id = playerIds(tag);
  const manifest = playerManifest(id.screenId, 'images');
  await bootMockPlayer(page, { tag, kind: 'images', manifest, extraRoutes: async p => {
    await p.route(`**/api/v1/screens/${id.screenId}/manifest*`, route => ok(route, manifest));
  } });
  await expect(page.locator(SLIDES)).toHaveCount(3, { timeout: 30_000 });

  // A modified shortcut is not the information key.
  await page.keyboard.press('Control+i');
  await page.keyboard.press('Alt+i');
  await settle(page);
  await expect(info(page)).toHaveCount(0);

  // Typing an `i` into the canvas editor's number field is typing, not a shortcut.
  await page.keyboard.press('i');
  await info(page).getByRole('button', { name: 'Resize for LED' }).click();
  const width = page.getByRole('spinbutton', { name: 'Canvas width in pixels' });
  await expect(width).toBeVisible();
  await width.focus();
  await page.keyboard.press('i');
  await page.keyboard.press('Home');
  await settle(page);
  await expect(width).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await info(page).getByRole('button', { name: 'Return to content' }).click();
  await expect(info(page)).toHaveCount(0);

  // Emergency retirement + lockout are untouched by the opener policy.
  await page.keyboard.press('i');
  await expect(info(page)).toBeVisible();
  Object.assign(manifest, { isEmergency: true, emergencyType: 'LOCKDOWN', emergencySeverity: 'CRITICAL' });
  await deliver(page, push('SYNC', {}));
  const emergencyLock = () => page.evaluate(() =>
    (window.history.state as { eduBackTrap?: boolean } | null)?.eduBackTrap === true);
  await expect.poll(emergencyLock, { timeout: 30_000 }).toBe(true);
  await expect(info(page)).toHaveCount(0);
  await page.keyboard.press('i');
  await pressBack(page);
  await settle(page);
  await expect(info(page)).toHaveCount(0);
  await expect(resume(page)).toHaveCount(0);
  expect(await emergencyLock()).toBe(true);
});
