/**
 * Remote Back trap — the history mechanics, pinned in jsdom.
 *
 * The stake (2026-09-01 field find, GUQ55 / GUQ65 / G65 / TC22): the APK's
 * Back handler calls `WebView.goBack()` whenever the WebView has back-history,
 * and every native reload leaves a cross-document entry behind — so Back
 * walked the reload stack one page load per press and never reached the stop
 * overlay. The trap keeps exactly ONE same-document entry on top so every
 * goBack() is a traversal onto this page. What must hold:
 *   (a) arming is idempotent — one entry, never two, even when the marker on
 *       the entry is rewritten by something else (Next's HistoryUpdater);
 *   (b) a traversal off the trap re-arms it and hands the press to the
 *       existing `edu-show-stop-overlay` toggle — exactly once;
 *   (c) the traversal never reaches a later-registered popstate listener (the
 *       Next App Router's, whose ACTION_RESTORE was the "resync" symptom);
 *   (d) release pops our own entry, swallows its popstate, toggles nothing.
 */

import {
  installBackTrapListener,
  armBackTrap,
  releaseBackTrap,
  isBackTrapArmed,
  BACK_TRAP_STATE_KEY,
  BACK_TRAP_EVENT,
  __resetBackTrapForTests,
} from '../backTrap';

/** jsdom fires popstate for same-document traversals on a later task. */
const settle = () => new Promise<void>((r) => setTimeout(r, 20));

const onTrap = () =>
  (window.history.state as Record<string, unknown> | null)?.[BACK_TRAP_STATE_KEY] === true;

describe('backTrap', () => {
  let toggles = 0;
  let routerSaw = 0;
  const onToggle = () => { toggles += 1; };
  // Registered AFTER install, in the bubble phase — the shape of Next's
  // App Router listener.
  const routerListener = () => { routerSaw += 1; };

  beforeAll(() => {
    installBackTrapListener();
    window.addEventListener(BACK_TRAP_EVENT, onToggle);
    window.addEventListener('popstate', routerListener);
  });

  beforeEach(async () => {
    __resetBackTrapForTests();
    toggles = 0;
    routerSaw = 0;
    // Fresh, marker-free current entry.
    window.history.replaceState({ base: true }, '', window.location.href);
    await settle();
  });

  test('arm pushes exactly one marked entry; re-arming is a no-op', () => {
    const len = window.history.length;
    armBackTrap();
    expect(isBackTrapArmed()).toBe(true);
    expect(onTrap()).toBe(true);
    expect(window.history.length).toBe(len + 1);
    armBackTrap();
    armBackTrap();
    expect(window.history.length).toBe(len + 1);
  });

  test('a wiped marker is re-stamped IN PLACE, never stacked (Next HistoryUpdater shape)', () => {
    armBackTrap();
    const len = window.history.length;
    // What HistoryUpdater does on a router-state change: rewrite the current
    // entry's state without our key.
    window.history.replaceState({ __NA: true }, '', window.location.href);
    expect(onTrap()).toBe(false);
    armBackTrap();
    expect(onTrap()).toBe(true);
    expect(window.history.length).toBe(len);
    expect((window.history.state as Record<string, unknown>).__NA).toBe(true);
  });

  test('a traversal off the trap (the APK goBack) re-arms and toggles the stop overlay once; the router never sees it', async () => {
    armBackTrap();
    window.history.back();
    await settle();
    expect(toggles).toBe(1);
    expect(routerSaw).toBe(0);
    expect(onTrap()).toBe(true);
    expect(isBackTrapArmed()).toBe(true);

    // Second press — same shape, still one toggle per press.
    window.history.back();
    await settle();
    expect(toggles).toBe(2);
    expect(routerSaw).toBe(0);
    expect(onTrap()).toBe(true);
  });

  test('not armed → a traversal is left alone (browser player, no emergency)', async () => {
    window.history.pushState({ someoneElse: true }, '', window.location.href);
    window.history.back();
    await settle();
    expect(toggles).toBe(0);
    expect(routerSaw).toBe(1);
    expect(isBackTrapArmed()).toBe(false);
  });

  test('release pops our own entry, swallows its popstate, toggles nothing', async () => {
    armBackTrap();
    const len = window.history.length;
    releaseBackTrap();
    await settle();
    expect(toggles).toBe(0);
    expect(routerSaw).toBe(0);
    expect(isBackTrapArmed()).toBe(false);
    expect(onTrap()).toBe(false);
    // The forward entry is still there (history.length counts it) but the
    // pointer sits below it — exactly what a browser Back needs.
    expect(window.history.length).toBe(len);
    // Releasing again is a no-op.
    releaseBackTrap();
    await settle();
    expect(routerSaw).toBe(0);
  });

  test('arm during an in-flight release lands, then re-pushes silently', async () => {
    armBackTrap();
    releaseBackTrap();
    armBackTrap(); // e.g. the alert flapped back on before the traversal landed
    await settle();
    expect(toggles).toBe(0);
    expect(routerSaw).toBe(0);
    expect(isBackTrapArmed()).toBe(true);
    expect(onTrap()).toBe(true);
  });

  test('release when the current entry is not ours only disarms', () => {
    armBackTrap();
    window.history.pushState({ other: true }, '', window.location.href);
    releaseBackTrap();
    expect(isBackTrapArmed()).toBe(false);
  });
});
