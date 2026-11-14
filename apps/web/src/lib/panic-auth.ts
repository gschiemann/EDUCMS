/**
 * panic-auth.ts — how /panic finds the credential an alert is sent with
 * (2026-11-14).
 *
 * THE DEFECT THIS CLOSES (docs/handoffs/2026-11-10-mobile-remember-me-logout.md):
 * `/panic` — the start_url of the EMERGENCY home-screen app — redirected to
 * `/login` the moment it found no access token, or on a 401, without waiting
 * for, or trying, the remembered-session restore. A teacher who ticked "Keep
 * me signed in" opened the panic app and met a password form. The owner, on
 * 2026-11-10: "last thing we need is a login holding back an emergency
 * trigger for a teacher".
 *
 * THE RULES, all enforced here and pinned by `panic-auth.test.ts`:
 *
 *   1. The page is shown at once; this resolves in the background. Nothing
 *      here navigates — the page decides what to render from the state.
 *   2. A remembered session is ALWAYS tried before sign-in, whether or not the
 *      page can see a remember marker (the marker has disagreed with the
 *      cookie jar before — candidate 2 of the 2026-11-10 investigation). The
 *      try is the shared single-flight refresh, so it can never be a second
 *      spend racing `SessionRestorer` or a dashboard 401.
 *   3. `signin` means the browser HAS no remembered session (no cookie, or the
 *      API's own 401/403). "Could not find out" (offline, 5xx) is
 *      `unreachable`, never `signin`: no signal in a stairwell must not look
 *      like "you were signed out".
 *   4. A press waits for a check still in flight — bounded — and then sends.
 *      It is never dropped, and nothing here ever reports a send.
 *   5. A 401 on a real request gets ONE restore (`recover`), single-flight.
 *
 * Framework-free on purpose: the page is 1,000 lines of UI, and the order of
 * these decisions is the part that must be provable without rendering it.
 */
import type { RefreshAttempt } from './session-client';

/** The fields /panic reads off the person signed in. */
export interface PanicUser {
  id: string;
  email?: string | null;
  role?: string | null;
  tenantId: string;
  canTriggerPanic?: boolean | null;
  [key: string]: unknown;
}

/** What an alert is sent with. */
export type PanicCredential = { kind: 'session'; token: string; user: PanicUser };

export type PanicAuthState =
  /** A check is in flight. The page is usable; a press waits for this. */
  | { status: 'resolving' }
  /** `checked` = the server confirmed it now; false = the cached copy the server could not confirm. */
  | { status: 'ready'; credential: PanicCredential; checked: boolean }
  /** This browser has no remembered session. Only sign-in will help. */
  | { status: 'signin' }
  /** A credential may exist but the server could not be reached to find out. */
  | { status: 'unreachable' };

export type PressCredential =
  | { credential: PanicCredential }
  | { credential: null; reason: 'signin' | 'unreachable' | 'timeout' };

export interface PanicAuthDeps {
  /** The tab's own session, as the store holds it. */
  readSession(): { token: string | null; user: PanicUser | null };
  /** Put a restored session into the store (remembered). */
  adoptSession(token: string, user: PanicUser): void;
  /** `GET /users/me` with this bearer. Rejects on a network error or timeout. */
  verify(token: string): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  /** The shared single-flight remembered-session refresh. */
  refresh(): Promise<RefreshAttempt>;
  /** Every state change, in order. */
  onChange(state: PanicAuthState): void;
  /** Timer seam (tests). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface PanicAuth {
  readonly state: PanicAuthState;
  /** Find a credential. Single-flight: concurrent callers share one pass. */
  resolve(): Promise<PanicAuthState>;
  /** After a 401: one remembered-session restore. Resolves the new credential, or null. */
  recover(): Promise<PanicCredential | null>;
  /** What a press sends with — waiting at most `boundMs` for a check in flight. */
  credentialForPress(boundMs: number): Promise<PressCredential>;
  /** The store's session changed under us (another component restored it). */
  noteSession(token: string | null, user: PanicUser | null): void;
}

function hasTenant(user: unknown): user is PanicUser {
  return !!user && typeof user === 'object' && typeof (user as PanicUser).tenantId === 'string' && !!(user as PanicUser).tenantId;
}

export function createPanicAuth(deps: PanicAuthDeps): PanicAuth {
  let state: PanicAuthState = { status: 'resolving' };
  let resolving: Promise<PanicAuthState> | null = null;
  let recovering: Promise<PanicCredential | null> | null = null;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  const set = (next: PanicAuthState): PanicAuthState => {
    state = next;
    try {
      deps.onChange(next);
    } catch {
      /* a render problem must never break the credential path */
    }
    return next;
  };

  const ready = (token: string, user: PanicUser, checked: boolean): PanicAuthState => ({
    status: 'ready',
    credential: { kind: 'session', token, user },
    checked,
  });

  /** The remembered session — the HttpOnly cookie, through the shared single flight. */
  async function restore(): Promise<PanicAuthState> {
    let attempt: RefreshAttempt;
    try {
      attempt = await deps.refresh();
    } catch {
      return { status: 'unreachable' };
    }
    const result = attempt.result;
    if (result?.access_token && hasTenant(result.user)) {
      try {
        deps.adoptSession(result.access_token, result.user);
      } catch {
        /* the credential is still good for this page */
      }
      return ready(result.access_token, result.user, true);
    }
    return attempt.outcome === 'refused' ? { status: 'signin' } : { status: 'unreachable' };
  }

  async function pass(): Promise<PanicAuthState> {
    const { token, user } = deps.readSession();
    if (!token) return restore();
    try {
      const res = await deps.verify(token);
      if (res.ok) {
        // /users/me returns the LIVE role + canTriggerPanic, so the authority
        // gate reflects the current row, not a cached blob.
        const me = await res.json().catch(() => null);
        const live = me && typeof me === 'object' ? ({ ...(user ?? {}), ...(me as object) } as PanicUser) : user;
        if (hasTenant(live)) return ready(token, live, true);
        return user && hasTenant(user) ? ready(token, user, false) : restore();
      }
      // 401 = this token is dead. The remembered session may still be alive.
      if (res.status === 401) return restore();
      // Anything else (a 5xx in a deploy overlap): never strand a held session
      // mid-emergency — keep it, the trigger itself is server-authoritative.
      if (hasTenant(user)) return ready(token, user, false);
      return restore();
    } catch {
      // Offline or hung: a held token plus the cached user is enough to try.
      if (hasTenant(user)) return ready(token, user, false);
      return restore();
    }
  }

  function resolve(): Promise<PanicAuthState> {
    if (resolving) return resolving;
    set({ status: 'resolving' });
    const run = pass()
      .catch((): PanicAuthState => ({ status: 'unreachable' }))
      .then((next) => {
        // A session another component restored while this pass ran wins over
        // a pass that came back empty-handed.
        if (next.status !== 'ready' && state.status === 'ready') return state;
        return set(next);
      });
    resolving = run;
    void run.finally(() => {
      if (resolving === run) resolving = null;
    });
    return run;
  }

  function recover(): Promise<PanicCredential | null> {
    if (recovering) return recovering;
    const run = restore()
      .catch((): PanicAuthState => ({ status: 'unreachable' }))
      .then((next) => {
        if (next.status === 'ready') {
          set(next);
          return next.credential;
        }
        // The dead credential must not be offered again.
        set(next);
        return null;
      });
    recovering = run;
    void run.finally(() => {
      if (recovering === run) recovering = null;
    });
    return run;
  }

  /** `promise`, or null once `ms` have passed. Never rejects. */
  function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return new Promise<T | null>((resolveOuter) => {
      let done = false;
      const timer = setTimer(() => {
        if (done) return;
        done = true;
        resolveOuter(null);
      }, ms);
      promise.then(
        (v) => {
          if (done) return;
          done = true;
          clearTimer(timer);
          resolveOuter(v);
        },
        () => {
          if (done) return;
          done = true;
          clearTimer(timer);
          resolveOuter(null);
        },
      );
    });
  }

  async function credentialForPress(boundMs: number): Promise<PressCredential> {
    if (state.status === 'ready') return { credential: state.credential };
    if (state.status === 'signin') return { credential: null, reason: 'signin' };
    // In flight: wait for it. Unreachable: one fresh pass — the signal may be
    // back. Either way bounded, so a hung network can never hold the press
    // (and the person holding the phone) indefinitely.
    const pending = state.status === 'resolving' && resolving ? resolving : resolve();
    const settled = await within(pending, boundMs);
    if (!settled) return { credential: null, reason: 'timeout' };
    if (settled.status === 'ready') return { credential: settled.credential };
    return { credential: null, reason: settled.status === 'signin' ? 'signin' : 'unreachable' };
  }

  function noteSession(token: string | null, user: PanicUser | null): void {
    if (!token || !hasTenant(user)) return;
    // A pass in flight reads the store itself (and a restore joins the same
    // refresh flight `SessionRestorer` uses), so it already sees this.
    if (state.status === 'resolving') return;
    if (state.status === 'ready' && state.credential.token === token) return;
    // A session reached the store after our pass ended (another component's
    // restore, or the api-client's own 401 refresh). The server minted it, so
    // it is offered — but marked unchecked until a request proves it.
    set(ready(token, user, false));
  }

  return {
    get state() {
      return state;
    },
    resolve,
    recover,
    credentialForPress,
    noteSession,
  };
}

/**
 * The HTTP status inside a server-action error string
 * (`"Emergency broadcast failed: 401 — …"`, `"All clear failed: 500"`), or
 * null. `broadcastEmergency` / `allClearEmergency` keep the status first in
 * the string for exactly this kind of routing (`trigger-emergency.ts`).
 */
export function failedStatusOf(error: unknown): number | null {
  if (typeof error !== 'string') return null;
  const m = /failed:\s*(\d{3})\b/.exec(error);
  return m ? Number(m[1]) : null;
}
