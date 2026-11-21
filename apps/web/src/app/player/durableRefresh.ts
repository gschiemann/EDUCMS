/**
 * The durable REFRESH_WEB — the reload command that rides the manifest as
 * `refreshRequestedAt` (2026-08-30, reliability W1-11). Moved here from
 * `page.tsx` `maybeExecuteDurableRefresh` (2026-11-21, launch audit FLT-09)
 * so the order of its steps is unit-tested; the steps are unchanged except
 * the one marked NEW below.
 *
 * The wedge detector used to publish REFRESH_WEB over the push channel only —
 * the exact channel that is dead on a wedged screen (35 AUTO_RECOVERY_PUSH_
 * DEAD audit rows in the week before this fix). The command now ALSO rides
 * the manifest as `refreshRequestedAt`. Semantics are VALUE-IDENTITY, never
 * clock comparison (Android boxes run minutes of skew and a timestamp
 * inequality would reload-loop them): reload once per distinct value, persist
 * the acknowledged value BEFORE acting, echo it on render-proof so the server
 * clears the flag. Unreadable storage → do nothing (fail-safe: no ack means
 * a reload could loop, so we refuse to start one).
 *
 * NEW (FLT-09): an alert on the glass DEFERS the command. The pushed WS and
 * SSE REFRESH_WEB arms already wait while an emergency or a pushed message is
 * displayed; this path did not, and for a screen showing a typed broadcast,
 * an SOS or a media alert the never-interrupt admission answers `reload`
 * (an emergency is never "provably healthy playing"), so the page navigated
 * the alert off the glass. A deferred command is NOT acknowledged — the ack
 * is the server's "it ran" — so the manifest keeps offering it, and the page
 * runs it again on the first live manifest answer after the alert has left
 * the glass (`page.tsx`, the 200 and 304 branches; ending a pushed or polled
 * message already asks the manifest at once). Deferred, never dropped, never
 * acknowledged before it runs (player rule 6). An alert that reaches the
 * glass inside the 250 ms between the decision and the reload holds the
 * reload too: it waits, re-checking every 30 s (the WS arm's cadence, a local
 * check, no request), and runs once the glass is clear.
 *
 * PURE apart from the injected dependencies.
 */

import { manifestRefreshOrigin, type RefreshAdmission, type RefreshOrigin } from './refreshAdmission';

/** localStorage key: the `refreshRequestedAt` VALUE this screen last acted on. */
export const LS_REFRESH_ACK = 'edu_refresh_ack';

/** A reload held by an alert that reached the glass after the decision re-checks this often (the WS arm's cadence). */
export const DURABLE_REFRESH_ALERT_RECHECK_MS = 30_000;

/** What the page knows is on the glass when a reload would land. */
export interface AlertOnGlass {
  /** A manifest (tenant / per-screen) alert, including one raised from a signed push. */
  manifestAlert: boolean;
  /** A WS / SSE pushed SOS, broadcast or media alert (a banner too). */
  pushedMessage: boolean;
  /** A message the overlay's own `/emergency/messages` poll is showing. */
  polledMessage: boolean;
  /** A signed OVERRIDE still waiting for its manifest confirmation. */
  pendingOverride: boolean;
}

/**
 * Must a reload wait? Any alert on the glass, in any form. A superset of the
 * pushed arms' test (`activeEmergencyRef || pushedEmergencyMessageRef`): the
 * durable command mostly reaches PUSH-DEAD screens (the wedge detector), and
 * there a broadcast is on the glass through the overlay's poll, not a push.
 */
export function refreshWaitsForAlert(on: AlertOnGlass): boolean {
  return on.manifestAlert || on.pushedMessage || on.polledMessage || on.pendingOverride;
}

export type DurableRefreshOutcome =
  /** No command, a preview tab, or this exact value was already acted on. */
  | 'none'
  /** An alert is on the glass: nothing written, nothing reloaded — re-run after it ends. */
  | 'deferred'
  /** Storage cannot hold the ack durably: no reload (it could loop). */
  | 'refused'
  /** Acknowledged; a provably healthy screen declined a SYSTEM refresh (never-interrupt). */
  | 'declined'
  /** Acknowledged; the reload is scheduled. */
  | 'reload';

export interface DurableRefreshDeps {
  /** An admin's "Open in Browser" preview — the command targets the SCREEN. */
  isPreview: () => boolean;
  /** The ack store (localStorage). May throw. */
  storage: () => Pick<Storage, 'getItem' | 'setItem'>;
  /** The page's never-interrupt admission for the command's origin. */
  admit: (origin: RefreshOrigin) => RefreshAdmission;
  /** Is an alert on the glass right now? (`refreshWaitsForAlert`) */
  alertOnGlass: () => boolean;
  /** The strongest reload available (`reloadUnderCover('refresh-durable')`). */
  reload: () => void;
  schedule: (fn: () => void, ms: number) => void;
  log?: (line: string) => void;
}

export function runDurableRefresh(manifest: unknown, deps: DurableRefreshDeps): DurableRefreshOutcome {
  // The command targets the SCREEN. An admin's "Open in Browser" preview
  // fetches the same manifest — reloading their tab (and consuming the ack
  // into the wrong localStorage) would be both baffling and wrong.
  if (deps.isPreview()) return 'none';
  const m = (manifest && typeof manifest === 'object' ? manifest : {}) as { refreshRequestedAt?: unknown; refreshRequestedBy?: unknown };
  const req = m.refreshRequestedAt;
  if (typeof req !== 'number' || !Number.isFinite(req)) return 'none';
  let storage: Pick<Storage, 'getItem' | 'setItem'>;
  let acked: number | null = null;
  try {
    storage = deps.storage();
    const v = storage.getItem(LS_REFRESH_ACK);
    acked = v ? Number(v) : null;
  } catch {
    return 'refused'; // storage unreadable → cannot guarantee once-only → refuse
  }
  if (acked === req) return 'none';
  // NEW (FLT-09): never navigate an alert off the glass. Checked BEFORE the
  // ack is written, so the command is still pending when the alert ends.
  // (The page logs the deferral once per command; this runs on every answer.)
  if (deps.alertOnGlass()) return 'deferred';
  try {
    storage.setItem(LS_REFRESH_ACK, String(req));
    // B-P2-12 (2026-08-30): some stores ACCEPT the write and don't persist
    // it (ephemeral/partitioned storage). If the read-back disagrees, the
    // once-only guarantee is gone — refuse to reload rather than loop.
    if (storage.getItem(LS_REFRESH_ACK) !== String(req)) return 'refused';
  } catch {
    return 'refused'; // ack MUST be durable before we act
  }
  // Never-interrupt (2026-10-10): who asked? The wedge detector's durable
  // ride reaches push-dead screens — exactly the fleet's problem boxes — so
  // this is where a SYSTEM reload most often lands on content a customer is
  // watching. A manifest just arrived (the fetch loop is alive by
  // construction), so a painting screen declines it; an operator's Resync,
  // or a manifest from an API that does not say, reloads as it always has.
  // The ack above is persisted regardless — a declined command is still
  // CONSUMED (value identity), so the server clears the flag on the next
  // telemetry post instead of re-offering it.
  const origin = manifestRefreshOrigin(m.refreshRequestedBy);
  if (deps.admit(origin).action === 'decline') {
    deps.log?.(`[Player] durable REFRESH_WEB (${origin}) declined — content is playing and provably healthy; acknowledged without a reload (never-interrupt)`);
    return 'declined';
  }
  deps.log?.('[Player] durable REFRESH_WEB arrived via manifest — reloading once');
  let waitLogged = false;
  const fire = () => {
    // FLT-09: an alert that reached the glass after the decision holds the
    // reload until it ends (the ack is already written, so this is the only
    // run this command gets — it must not be spent on an alert).
    if (deps.alertOnGlass()) {
      if (!waitLogged) deps.log?.('[Player] durable REFRESH_WEB waiting — an alert reached the glass before the reload; it runs once the alert ends');
      waitLogged = true;
      deps.schedule(fire, DURABLE_REFRESH_ALERT_RECHECK_MS);
      return;
    }
    // Deep-audit C-P1-7 (2026-08-30): this path exists precisely for
    // screens whose push channel is dead — and it burns its once-only ack
    // on the way in, so it must use the STRONGEST reload available, not a
    // bare location.reload() (which the Taurus WebView serves from cache,
    // spending the escape hatch without escaping). Same ladder as the WS
    // REFRESH_WEB arm: native reload first, cache-busting web reload as
    // the fallback. This helper only runs on live (non-cached) manifests.
    try {
      deps.reload();
    } catch { /* swallow */ }
  };
  deps.schedule(fire, 250);
  return 'reload';
}
