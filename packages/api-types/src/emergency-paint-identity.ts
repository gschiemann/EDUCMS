/**
 * The emergency PAINT IDENTITY rule, shared with the API (2026-11-01, the
 * synthetic emergency drill — `apps/api/src/emergency/drill/`).
 *
 * The player decides which alert it is proving on the glass with
 * `emergencyPaintIdentity` (apps/web/src/app/player/emergencyPaintProof.ts)
 * and reports it inside `Screen.lastRenderedHash` (`em:<identity>`,
 * `pending|em:<identity>`, `unconfirmed|em:<identity>`). The synthetic drill
 * grades a run by comparing that hash with the identity the alert it sent
 * MUST paint, so the server needs the same rule.
 *
 * THIS IS A COPY, NOT A MOVE. The player keeps its own functions (the page
 * bundle and the APK-hosted page must not grow a dependency on the API's
 * package for the life-safety surface), and a web parity test
 * (`apps/web/src/app/player/__tests__/paint-identity-parity.test.ts`) holds
 * the two identical across every incident type, severity, drill / live and
 * letter case. Change one and the test fails until the other matches.
 *
 * PURE — no DOM, no clock of its own.
 */

/** Paint and live server confirmation are independent emergency facts (copy of the player's). */
export interface EmergencyPaintProofLike {
  identity: string;
  painted: boolean;
}

/** Copy of the player's `emergencyRenderHash` — the hash the page posts for a proof. */
export function emergencyRenderHash(proof: EmergencyPaintProofLike, manifestOkAtMs: number, nowMs = Date.now()): string {
  const identity = `em:${proof.identity}`;
  if (!proof.painted) return `pending|${identity}`;
  return manifestOkAtMs === 0 || nowMs - manifestOkAtMs > 120_000 ? `unconfirmed|${identity}` : identity;
}

/**
 * Copy of the player's `emergencyPaintIdentityInput`: an OVERRIDE alert is
 * judged on the facts that change the picture (type, severity, drill, the
 * words), case-insensitively for type and severity; a pushed message (it
 * carries its own row `id`) is hashed whole.
 */
export function emergencyPaintIdentityInput(alert: unknown): unknown {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) return alert;
  const a = alert as Record<string, unknown>;
  if (typeof a.id === 'string' || typeof a.type !== 'string' || a.type.trim().length === 0) return alert;
  const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  const upper = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim().toUpperCase() : null);
  return {
    kind: 'override',
    type: upper(a.type),
    severity: upper(a.severity),
    isDrill: a.isDrill === true,
    scopeNote: text(a.scopeNote),
    textBlob: text(a.textBlob),
    title: text(a.title),
  };
}

/** Copy of the player's `emergencyPaintIdentity` — bounded, opaque (FNV-1a, 8 hex chars). */
export function emergencyPaintIdentity(alert: unknown): string {
  const text = JSON.stringify(emergencyPaintIdentityInput(alert)) || '';
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The identity a device-scoped OVERRIDE with no operator text and no scope
 * note paints — the shape both the manifest (`isEmergency` flat fields) and
 * the signed push (`alertFromOverridePush`) raise on the page: type,
 * severity, drill, `scopeNote: null`, and no words or title.
 */
export function overrideAlertPaintIdentity(alert: { type: string; severity: string; isDrill: boolean }): string {
  return emergencyPaintIdentity({
    type: alert.type,
    severity: alert.severity,
    isDrill: alert.isDrill === true,
    scopeNote: null,
  });
}

/** A hash in any emergency form: `em:`, `pending|em:`, `unconfirmed|em:`. */
export function isEmergencyRenderHash(hash: string | null | undefined): boolean {
  return typeof hash === 'string' && /^(?:pending\||unconfirmed\|)?em:/.test(hash);
}
