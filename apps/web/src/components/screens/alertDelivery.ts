/**
 * Alert delivery, in the operator's words (2026-11-02).
 *
 * During the SECURE drill the owner's dashboard read "alert raised, no
 * on-glass proof" — engineer-speak for a state the operator has to act on in
 * seconds. The grade stays what the evidence proves (player rule 10); the
 * WORDS are three plain states over the whole fleet the alert reached:
 *
 *   • "Alert showing on N of M screens"
 *   • "Waiting for N screens to confirm"            (sent < WAIT_MS ago)
 *   • "N screens didn't confirm — check them: …"    (sent ≥ WAIT_MS ago)
 *
 * Pure — the caller passes each screen's render-trust grade (from
 * `deriveRenderTrustGrade`) and name; the i18n keys live under
 * `screens.trust.alertShowingOn / alertWaitingFor / alertNotConfirmed`.
 */

/** How long a screen may take to confirm before it is one to go and check. */
export const ALERT_CONFIRM_WAIT_MS = 60_000;

export interface AlertDeliveryScreen {
  name: string;
  /** `deriveRenderTrustGrade(...)` for the screen; anything else is "unknown". */
  grade: string | null | undefined;
  /** The screen's render-proof signature, when the grade alone cannot say. */
  lastRenderedHash?: string | null;
}

export interface AlertDeliverySummary {
  total: number;
  confirmed: number;
  /** Screens that have not confirmed, in list order. */
  unconfirmedNames: string[];
  /** The one line to show: which key and its values. */
  line: { key: 'alertShowingOn'; values: { confirmed: number; total: number } }
      | { key: 'alertWaitingFor'; values: { count: number } }
      | { key: 'alertNotConfirmed'; values: { count: number; names: string } };
}

/** A screen counts as confirmed when its render proof is an accepted emergency paint. */
export function screenConfirmedAlert(screen: AlertDeliveryScreen): boolean {
  if (screen.grade === 'alert-not-painted') return false;
  const hash = screen.lastRenderedHash ?? '';
  if (hash.startsWith('pending|em:')) return false;
  return /^(?:unconfirmed\|)?em:/.test(hash) || screen.grade === 'alert-unconfirmed';
}

export function summarizeAlertDelivery(
  screens: readonly AlertDeliveryScreen[],
  sentAtMs: number,
  nowMs = Date.now(),
  maxNames = 6,
): AlertDeliverySummary {
  const total = screens.length;
  const unconfirmed = screens.filter(s => !screenConfirmedAlert(s));
  const confirmed = total - unconfirmed.length;
  const unconfirmedNames = unconfirmed.map(s => s.name);
  if (unconfirmed.length === 0 || nowMs - sentAtMs < ALERT_CONFIRM_WAIT_MS) {
    const line = unconfirmed.length === 0
      ? { key: 'alertShowingOn' as const, values: { confirmed, total } }
      : { key: 'alertWaitingFor' as const, values: { count: unconfirmed.length } };
    return { total, confirmed, unconfirmedNames, line };
  }
  const shown = unconfirmedNames.slice(0, maxNames);
  const names = unconfirmedNames.length > maxNames ? `${shown.join(', ')} +${unconfirmedNames.length - maxNames}` : shown.join(', ');
  return { total, confirmed, unconfirmedNames, line: { key: 'alertNotConfirmed', values: { count: unconfirmed.length, names } } };
}
