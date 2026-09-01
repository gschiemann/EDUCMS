/**
 * Remote Back trap — ONE press reaches the stop/escape surface, on every APK
 * already in the field. (2026-09-01 — GUQ55 / GUQ65 / G65 / TC22 field find.)
 *
 * THE BUG. The APK's Back handler (MainActivity `handleOnBackPressed`) runs
 * `if (webView.canGoBack()) { webView.goBack(); return }` BEFORE it dispatches
 * `edu-show-stop-overlay` to this page. So Back only reaches the web player
 * when the WebView has no back-history — and on a real screen it always has
 * some. Every native reload (`loadPlayer()` → `WebView.loadUrl`) re-loads the
 * player URL with `?token=` re-attached while the page had scrubbed it from
 * the address, so each REFRESH_WEB, wedge auto-refresh, Manager-install
 * reload and watchdog reload leaves one more CROSS-DOCUMENT entry behind.
 * Back then walks DOWN that stack one full page load per press — the
 * operator's "connecting… then the content plays again, so I hit Back again".
 * The emergency history sentinel released earlier today was only one
 * contributor; the reload stack is the one that never went away.
 *
 * THE FIX. This page cannot stop the APK from calling goBack(). What it CAN
 * do is own the entry goBack lands on. While armed there is always exactly
 * ONE same-document entry — this trap — on top of the stack, so every Back is
 * a same-document traversal → `popstate` on THIS page → we re-arm and hand the
 * press to the existing stop-overlay toggle (`edu-show-stop-overlay`, the same
 * event the APK dispatches when it has no history to walk). The junk below the
 * trap is never reached. The emergency lockout is unchanged: the toggle
 * handler refuses remote input while an alert is displayed, and the trap
 * re-arms on every traversal, so Back still cannot leave a live alert.
 *
 * NEXT.JS. The App Router listens to `popstate` too and answers a same-URL
 * traversal with an ACTION_RESTORE — that soft restore is the "resync" the
 * operator saw on the sentinel release. Our listener is registered at module
 * evaluation (before the router's mount effect can register its own), in the
 * capture phase, and stops immediate propagation — the router never sees a
 * trap traversal. Nothing else on the player page listens to popstate.
 *
 * MARKER SURVIVAL. Next's HistoryUpdater rewrites the CURRENT entry's state on
 * router-state changes (`replaceState({...maybeCustom, __NA, tree})`), which
 * can drop our marker from the trap entry. Detection never depends on the
 * landed entry's marker (armed + not-on-trap ⇒ a Back traversal); the marker
 * only guards `armBackTrap()` idempotency, and a missing marker while armed is
 * re-stamped IN PLACE (replaceState) — never pushed again. One trap, never two.
 *
 * SCOPE. Pure browser-history code: no React, no network, no bridge. The page
 * decides WHEN to arm (permanently on the APK shell; only while an emergency
 * is displayed elsewhere, released on all-clear — see page.tsx).
 */

export const BACK_TRAP_STATE_KEY = 'eduBackTrap';
/** The event the APK dispatches for a Back press when it has no history to walk. */
export const BACK_TRAP_EVENT = 'edu-show-stop-overlay';

let installed = false;
let armed = false;
let releasing = false;
let rearmAfterRelease = false;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

function onTrap(): boolean {
  try {
    const st = window.history.state as Record<string, unknown> | null | undefined;
    return !!st && st[BACK_TRAP_STATE_KEY] === true;
  } catch {
    return false;
  }
}

/** Push the trap entry. `url` is null on purpose: the patched Next pushState
 *  skips its ACTION_RESTORE bookkeeping when no URL is given. */
function pushTrap(): void {
  try {
    window.history.pushState({ [BACK_TRAP_STATE_KEY]: true }, '', null);
  } catch {
    /* history may be unavailable in odd webviews — non-fatal */
  }
}

function clearReleaseTimer(): void {
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
}

function onPopState(e: PopStateEvent): void {
  if (!armed) return;
  // Landed ON the trap (a forward traversal, or someone else's back onto our
  // entry) — the stack is already in the shape we want.
  if (onTrap()) return;
  // A traversal off the trap = the APK's goBack() for a Back press (or our
  // own release). Keep the Next router from "restoring" the route.
  e.stopImmediatePropagation();
  if (releasing) {
    releasing = false;
    armed = false;
    clearReleaseTimer();
    if (rearmAfterRelease) {
      rearmAfterRelease = false;
      pushTrap();
      armed = true;
    }
    return;
  }
  pushTrap();
  try {
    window.dispatchEvent(new CustomEvent(BACK_TRAP_EVENT));
  } catch {
    /* CustomEvent unavailable — nothing to hand the press to */
  }
}

/**
 * Register the capture-phase popstate listener. Idempotent. Call at MODULE
 * evaluation of the player page so it is registered before the App Router's
 * own listener (an effect) — on Chromium ≤ 88 at-target listeners run in
 * registration order, on modern engines capture listeners run first either way.
 */
export function installBackTrapListener(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('popstate', onPopState, true);
}

/**
 * Arm the trap: guarantee exactly one same-document entry sits on top of the
 * session history. Idempotent — re-stamps a wiped marker in place, never
 * stacks. Safe to call before hydration and from any effect.
 */
export function armBackTrap(): void {
  if (typeof window === 'undefined') return;
  // SUBFRAMES NEVER TRAP. A ribbon tile (`/player?tile=K`) or a dashboard
  // preview iframe pushing an entry lands it in the JOINT session history —
  // the APK's goBack() would then traverse the tile instead of the top
  // document (and a dashboard's Back would traverse the preview). The top
  // window owns the remote; a frame that isn't it stays out of the history.
  try {
    if (window.top !== window) return;
  } catch {
    return; // cross-origin top — we are framed, so stay out
  }
  if (releasing) {
    // A release is in flight (history.back() queued). Let it land, then
    // re-push — pushing now would be swallowed by the pending traversal.
    rearmAfterRelease = true;
    return;
  }
  if (onTrap()) {
    armed = true;
    return;
  }
  if (armed) {
    // Still on the trap entry but its marker was rewritten (Next
    // HistoryUpdater / a URL scrub that dropped state) — restore the marker
    // IN PLACE so the next arm stays idempotent.
    try {
      const st = (window.history.state as Record<string, unknown> | null) || {};
      window.history.replaceState({ ...st, [BACK_TRAP_STATE_KEY]: true }, '', null);
    } catch {
      /* non-fatal */
    }
    return;
  }
  pushTrap();
  armed = true;
}

/**
 * Release the trap: pop our own entry (and nothing else). Used only where the
 * trap is NOT permanent — a browser/Taurus player after an emergency clears —
 * so a browser Back can leave /player again. The traversal's popstate is
 * swallowed (no overlay toggle, no Next restore). If no popstate ever arrives
 * (history unavailable), the flags self-heal after a short timeout.
 */
export function releaseBackTrap(): void {
  if (typeof window === 'undefined' || !armed || releasing) return;
  if (!onTrap()) {
    // Not on our entry — nothing of ours to pop.
    armed = false;
    return;
  }
  releasing = true;
  clearReleaseTimer();
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (releasing) {
      releasing = false;
      armed = false;
      rearmAfterRelease = false;
    }
  }, 1500);
  try {
    window.history.back();
  } catch {
    releasing = false;
    armed = false;
    clearReleaseTimer();
  }
}

/** Test/diagnostic view of the module state. */
export function isBackTrapArmed(): boolean {
  return armed;
}

/** Tests only — forget module state between cases (the listener stays). */
export function __resetBackTrapForTests(): void {
  armed = false;
  releasing = false;
  rearmAfterRelease = false;
  clearReleaseTimer();
}
