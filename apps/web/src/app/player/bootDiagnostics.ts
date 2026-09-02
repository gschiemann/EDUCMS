/**
 * BOOT + REGISTRATION PROOF — the web half (2026-09-02, P0-2).
 *
 * ============================================================
 * THE FAILURE THIS CLOSES
 * ============================================================
 *
 * On real OEM Android-9 Goodview panels the APK treated "HTTP 200 +
 * `onPageFinished`" as "the player is healthy". Both were TRUE while the
 * unit was dead: the WebView had loaded the SERVER-RENDERED shell — whose
 * splash literally reads "Connecting to your CMS…" — and the client
 * bundle never ran, so registration never started. The native side had no
 * way to know, the installer had no diagnostic, and the screen sat on a
 * sentence that was a lie.
 *
 * `data-edu-booted` (page.tsx) and the 25 s inline boot-proof line
 * (layout.tsx) already tell a HUMAN standing at the glass. This module
 * tells the APK, so the native side can raise a real diagnostic screen
 * with reachability facts and an escape — the things a dead JS runtime
 * can never render for itself.
 *
 * ============================================================
 * THREE FACTS, NEVER COLLAPSED INTO ONE (player rule 5)
 * ============================================================
 *
 *   1. `bootProof`       — this bundle's client JS actually ran.
 *   2. `registerAttempt` — a registration request was STARTED.
 *   3. `registerResult`  — how it ended: ok, or a CLASSIFIED failure.
 *
 * Fact 1 does not imply fact 2 (a boot that never reaches the register
 * effect is exactly the G43 shape), and fact 2 does not imply fact 3 (a
 * stalled socket produces an attempt and no result for as long as the
 * body hangs). The native deadlines are per-fact for that reason.
 *
 * ============================================================
 * TOTAL, SILENT, AND FREE IN A BROWSER
 * ============================================================
 *
 * Every export here is fire-and-forget through `nativeFire`, which
 * returns false and does nothing when there is no APK. Nothing in this
 * module may throw into a caller: the register loop's catch is the retry
 * engine and a diagnostics error must never be mistaken for a
 * registration error.
 *
 * ⚠️ The three bridge methods are NEW IN v1.1.13 and are deliberately
 * EXCLUDED from `KNOWN_METHODS` in nativeBridge.ts until the fleet floor
 * includes that APK (player rule 9) — posting an unknown method to an
 * older channel is a silently dropped call. `nativeHas` therefore answers
 * false on a manifest-less 1.1.12 channel and we simply skip the report.
 */

import { nativeFire, nativeHas } from './nativeBridge';

/** Bridge method names. Must match NativeBridgeChannel.METHODS. */
export const BOOT_PROOF_METHOD = 'bootProof';
export const REGISTER_ATTEMPT_METHOD = 'registerAttempt';
export const REGISTER_RESULT_METHOD = 'registerResult';

/**
 * How a registration failed, in the vocabulary the native diagnostic
 * screen speaks.
 *
 * ⚠️ HONESTY LIMIT (player rule 10). A browser `fetch` rejection does NOT
 * distinguish a DNS failure from a TLS failure from a refused connection —
 * it is one opaque `TypeError`. So this classifier NEVER claims `dns` or
 * `tls`; it says `network`, and the NATIVE probe (which uses
 * HttpURLConnection and sees the real exception type) is what splits those
 * apart on the diagnostic screen. Reporting a guess here would put a
 * confident wrong cause in front of an installer.
 */
export type RegisterFailureClass =
  | 'dns'
  | 'tls'
  | 'http'
  | 'timeout'
  | 'network'
  | 'storage'
  | 'unknown';

export interface RegisterFailure {
  cls: RegisterFailureClass;
  status?: number;
  message?: string;
}

/** Matches the `Registration HTTP <status>…` throw in the register loop. */
const HTTP_RE = /\bHTTP\s+(\d{3})\b/;

/**
 * Classify a thrown registration error. PURE — unit-tested without a DOM.
 *
 * Order matters: an HTTP status is the most specific thing we can know and
 * an abort is the next, because both are OUR OWN throws with a known shape.
 * Everything vaguer degrades toward `network`, and only a genuinely
 * unrecognisable error becomes `unknown`.
 */
export function classifyRegisterFailure(err: unknown): RegisterFailure {
  const anyErr = err as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof anyErr?.name === 'string' ? anyErr.name : '';
  const rawMessage = typeof anyErr?.message === 'string' ? anyErr.message : '';
  const message = rawMessage.slice(0, 300);
  const lower = rawMessage.toLowerCase();

  const httpMatch = HTTP_RE.exec(rawMessage);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    return { cls: 'http', status: Number.isFinite(status) ? status : undefined, message };
  }
  if (name === 'AbortError' || lower.includes('timeout') || lower.includes('timed out')) {
    return { cls: 'timeout', message };
  }
  if (
    name === 'QuotaExceededError' ||
    name === 'SecurityError' ||
    lower.includes('localstorage') ||
    lower.includes('quota')
  ) {
    // A screen whose storage is unwritable cannot keep a device token
    // across a reload, which looks exactly like a credential failure.
    return { cls: 'storage', message };
  }
  if (
    name === 'TypeError' ||
    lower.includes('failed to fetch') ||
    lower.includes('load failed') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('cannot reach')
  ) {
    return { cls: 'network', message };
  }
  return { cls: 'unknown', message: message || String(err ?? '') };
}

/** Never let a diagnostics call escape into a caller's control flow. */
function fireSafely(method: string, ...args: unknown[]): boolean {
  try {
    // Feature-detect: on a pre-1.1.13 APK these methods do not exist and
    // the channel would drop the post on the floor.
    if (!nativeHas(method)) return false;
    return nativeFire(method, ...args);
  } catch {
    return false;
  }
}

/**
 * FACT 1 — the client bundle's own code is running. Called from the SAME
 * mount effect that stamps `data-edu-booted="1"`, so the native ack and
 * the on-glass attribute can never disagree about what booted.
 */
export function reportClientBooted(): void {
  fireSafely(BOOT_PROOF_METHOD);
}

/**
 * FACT 2 — a registration request is being issued RIGHT NOW. Called
 * immediately before the `POST /screens/register` fetch, never after: the
 * point of the fact is that the deadline for fact 3 starts when the
 * request leaves, not when it returns.
 */
export function reportRegisterAttempt(): void {
  fireSafely(REGISTER_ATTEMPT_METHOD);
}

/** FACT 3a — registration succeeded. */
export function reportRegisterSuccess(): void {
  fireSafely(REGISTER_RESULT_METHOD, JSON.stringify({ ok: true }));
}

/** FACT 3b — registration failed, with the classification above. */
export function reportRegisterFailure(err: unknown): RegisterFailure {
  const failure = classifyRegisterFailure(err);
  fireSafely(
    REGISTER_RESULT_METHOD,
    JSON.stringify({
      ok: false,
      class: failure.cls,
      ...(failure.status !== undefined ? { status: failure.status } : {}),
      ...(failure.message ? { message: failure.message } : {}),
    }),
  );
  return failure;
}
