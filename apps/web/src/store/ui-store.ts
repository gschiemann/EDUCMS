import { create } from 'zustand';
import { notifyExplicitLogout } from '@/lib/auth-events';
import { clog } from '@/lib/client-logger';
import { clearPasskeyOfferSessionAnswer } from '@/lib/passkey-offer';

/**
 * Unified application state store.
 *
 * ── WHERE THE BEARER LIVES, AND WHY (SEC-010, 2026-09-05) ────────────────
 * The access token lives in SESSION storage. Never localStorage. Never a
 * cookie page JavaScript can read.
 *
 * Two separate reasons, and both still hold:
 *
 *  1. MULTI-TENANT ISOLATION (the original). localStorage is shared across
 *     every tab of the same origin — a user who opened Chardon in one tab and
 *     Springfield in another saw the two sessions overwrite each other, and a
 *     hard-refresh in the loser adopted the winner's identity.
 *
 *  2. BLAST RADIUS (SEC-010). The independent security re-audit found "the
 *     remembered bearer remains JS-readable for up to 30 days": ticking "Keep
 *     me logged in" used to write a THIRTY-DAY JWT to localStorage, so one
 *     XSS on any route the nonce CSP cannot cover walked off with a month of
 *     access. The access token is now always <= 1h server-side, and nothing
 *     here persists it beyond the tab.
 *
 * Durability for "Keep me logged in" moved OUT of this store entirely. It is
 * an HttpOnly, first-party, single-use rotating cookie owned by the web
 * origin's own route handlers (`/api/session/*`); this file cannot read it,
 * and neither can an attacker's injected script. All that survives here is
 * `edu_cms_remember`, a BOOLEAN marker saying a durable session may exist —
 * knowing that buys an attacker nothing.
 *
 * Migration: any token still sitting in localStorage from before this change
 * is adopted into this tab's sessionStorage ONCE and then wiped from
 * localStorage — including the remembered case, which used to be kept. The
 * session itself is not lost: `SessionRestorer` immediately trades the
 * adopted token for a cookie, so a remembered operator stays remembered.
 */

const TOKEN_KEY = 'edu_cms_token';
const USER_KEY = 'edu_cms_user';
/** Boolean marker only — never a credential. See session-client.ts. */
const REMEMBER_KEY = 'edu_cms_remember';

function safeSession(): Storage | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}
function safeLocal(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

/**
 * Set for exactly one boot when a pre-SEC-010 token was found in localStorage
 * and adopted. `SessionRestorer` reads it and mints an HttpOnly cookie from
 * that token, so the operator's remembered session carries over instead of
 * ending the next time they close the app.
 */
let migratedLegacyToken: string | null = null;
export function takeMigratedLegacyToken(): string | null {
  const t = migratedLegacyToken;
  migratedLegacyToken = null;
  return t;
}

function bootstrapAuth(): { token: string | null; user: any | null } {
  const ss = safeSession();
  const ls = safeLocal();
  if (!ss && !ls) return { token: null, user: null };

  // The tab's own sessionStorage is the only place a token is READ from now.
  let token = ss?.getItem(TOKEN_KEY) || null;
  let userRaw = ss?.getItem(USER_KEY) || null;

  // ── One-time migration off localStorage ─────────────────────────────────
  // Pre-SEC-010 builds parked the token here (durably, for 30 days, when
  // "Keep me logged in" was ticked). Adopt it into this tab so nobody is
  // signed out by the upgrade, then WIPE it — a long-lived bearer must not
  // stay at rest where page JavaScript can read it across restarts.
  if (!token && ls) {
    const lsToken = ls.getItem(TOKEN_KEY);
    const lsUser = ls.getItem(USER_KEY);
    if (lsToken) {
      token = lsToken;
      userRaw = lsUser;
      const wasRemembered = ls.getItem(REMEMBER_KEY) === '1';
      try {
        ss?.setItem(TOKEN_KEY, lsToken);
        if (lsUser) ss?.setItem(USER_KEY, lsUser);
      } catch { /* storage full — accept the in-memory-only session */ }
      try {
        ls.removeItem(TOKEN_KEY);
        ls.removeItem(USER_KEY);
      } catch { /* private mode */ }
      // Only a REMEMBERED legacy session is worth a cookie: a plain one was
      // always per-tab, and upgrading it here would change its semantics.
      if (wasRemembered) migratedLegacyToken = lsToken;
    }
  }

  let user: any | null = null;
  if (userRaw) {
    try { user = JSON.parse(userRaw); } catch { user = null; }
  }
  return { token, user };
}

const initial = typeof window !== 'undefined' ? bootstrapAuth() : { token: null, user: null };

/**
 * True while a cold start may still be able to restore a remembered session
 * from the HttpOnly cookie. `AuthExpirationGuard` must NOT eject to /login
 * while this is set — before SEC-010 a remembered token was already in
 * localStorage at module-eval time, so "no token" always meant "signed out".
 * Now the answer arrives one network round trip later.
 */
function initialRestoring(): boolean {
  if (typeof window === 'undefined') return false;
  if (initial.token) return false;
  try { return window.localStorage.getItem(REMEMBER_KEY) === '1'; } catch { return false; }
}

interface AppState {
  // Auth state
  token: string | null;
  /**
   * SEC-010 — a cold start with the remember marker set has no token yet and
   * cannot get one synchronously (it lives behind an HttpOnly cookie the page
   * cannot read). This is true for the one round trip that answers the
   * question. `AuthExpirationGuard` holds its eject while it is set; without
   * that hold, every remembered operator would be bounced to /login on load
   * and the restore would land in a page that had already navigated away.
   */
  authRestoring: boolean;
  user: {
    id: string;
    email: string;
    role: string;
    /** 2026-05-11 — operator profile names. Set via /api/v1/users/me PUT
     *  and surfaced in /users/me + /auth/login responses. Nullable on
     *  legacy accounts that haven't filled them in; display helpers
     *  fall back to email-prefix. */
    firstName?: string | null;
    lastName?: string | null;
    tenantId: string;
    tenantSlug?: string;
    tenantName?: string | null;
    /** 2026-05-03 — VenueOS vertical (K12 / GYM / RETAIL / CORPORATE / QSR / FASHION).
     *  Drives useTenantCopy() — vertical-aware UI strings. Falls back to K12
     *  in the hook if missing (preserves EDU CMS pilot behavior for any
     *  pre-vertical session that hasn't re-logged in yet). */
    tenantVertical?: string;
    canTriggerPanic?: boolean;
    /** 2026-09-03 — FIRST-LOGIN CREDENTIAL SETUP. True while the account is
     *  still on the placeholder email + starter password it was provisioned
     *  with. `SchoolLayout` renders the blocking setup screen instead of the
     *  dashboard while it is set, and the API refuses every route but
     *  /auth/complete-setup, /auth/logout and /users/me. Optional because a
     *  session blob cached by an older bundle won't carry it — absent is
     *  treated as false, and the API is the real gate either way. */
    mustSetupCredentials?: boolean;
  } | null;

  // UI state
  sidebarOpen: boolean;
  mobileSidebarOpen: boolean;
  /**
   * 2026-05-29 — count of overlays (modals / bottom-sheets / drawers /
   * full-screen pickers) currently mounted. The mobile bottom tab bar
   * (MobileTabBar.tsx, z-60, fixed bottom) is the perennial loser of the
   * stacking war: any overlay anchored to the viewport bottom (its footer
   * Cancel/Confirm buttons) lands in the same 56-64px strip the tab bar
   * occupies, and across stacking contexts (transformed/blurred ancestors
   * in DashboardLayout) the modal's z-index doesn't reliably win.
   *
   * Rather than patch every modal's bottom padding one-by-one (brittle,
   * and the FIRST mobile pass missed asset-upload because it hand-picked a
   * list), we hide the tab bar whenever ANY overlay is open — exactly the
   * proven pattern already used for `mobileSidebarOpen`. ONE mobile nav
   * surface usable at a time; every overlay's footer always clears the
   * bottom of the screen. A COUNTER (not a boolean) so stacked overlays
   * (e.g. a folder picker opened from inside the upload flow, or an
   * appConfirm fired from a modal) don't prematurely un-hide the tab bar
   * when only the topmost one closes.
   *
   * Components register via the `useOverlayLock(open)` hook
   * (apps/web/src/hooks/use-overlay-lock.ts) so mount/unmount + StrictMode
   * double-invoke are handled correctly and the counter can never leak.
   */
  overlayOpenCount: number;
  activeTenant: string | null;
  isEmergencyActive: boolean;
  /** 2026-05-23 launch audit P2 #3 — store the overrideId returned from
   *  `broadcastEmergency` so EmergencyOverlay can pass it back to
   *  allClearEmergency. Without this, every clear minted a fresh
   *  `clear_<uuid>` and the AuditLog couldn't pair trigger → clear
   *  events, breaking forensic chain-of-custody. */
  activeEmergencyOverrideId: string | null;

  // Auth actions
  login: (token: string, user: any, remember?: boolean) => void;
  /**
   * Swap the stored session token in place, keeping the same user + the same
   * durability choice the operator already made.
   *
   * Exists for POST /auth/change-password (ACC-02): that endpoint revokes
   * EVERY live token for the account and returns one replacement pinned past
   * the revocation cut. Without this the tab that just changed its own
   * password keeps holding a now-dead token and 401s on its very next
   * request — signed out by its own security action.
   */
  setToken: (token: string) => void;
  /**
   * Replace the stored user in place, keeping the same token and the same
   * durability choice the operator already made.
   *
   * Exists for POST /auth/complete-setup (2026-09-03): finishing first-login
   * setup changes the account's EMAIL and clears `mustSetupCredentials`, so
   * the cached blob is wrong on both counts — leaving it would keep rendering
   * the setup gate over a dashboard the user has already earned. Paired with
   * `setToken` for the replacement token that call also returns.
   */
  setUser: (user: AppState['user']) => void;
  logout: () => void;
  /** Ends the cold-start restore window (see `authRestoring`). */
  setAuthRestoring: (restoring: boolean) => void;

  // UI actions
  toggleSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  toggleMobileSidebar: () => void;
  /** Increment when an overlay mounts (see overlayOpenCount). */
  pushOverlay: () => void;
  /** Decrement when an overlay unmounts; clamped at 0 so it can't underflow. */
  popOverlay: () => void;
  setActiveTenant: (tenantId: string) => void;
  setEmergencyActive: (active: boolean, overrideId?: string | null) => void;
}

export const useUIStore = create<AppState>((set) => ({
  // Auth
  token: initial.token,
  authRestoring: initialRestoring(),
  user: initial.user,

  // UI
  sidebarOpen: true,
  mobileSidebarOpen: false,
  overlayOpenCount: 0,
  activeTenant: initial.user?.tenantSlug || initial.user?.tenantId || null,
  isEmergencyActive: false,
  activeEmergencyOverrideId: null,

  // Auth actions
  login: (token, user, remember) => {
    const ss = safeSession();
    if (ss) {
      ss.setItem(TOKEN_KEY, token);
      ss.setItem(USER_KEY, JSON.stringify(user));
    }
    // SEC-010 — the token NEVER goes to localStorage, remembered or not.
    // Durability is the HttpOnly cookie the login page adopts right after
    // this call (`adoptRememberedSession`); all we persist here is the
    // boolean that tells a future cold start the cookie is worth asking for.
    const ls = safeLocal();
    if (ls) {
      try {
        ls.removeItem(TOKEN_KEY);
        ls.removeItem(USER_KEY);
        if (remember) ls.setItem(REMEMBER_KEY, '1');
        else ls.removeItem(REMEMBER_KEY);
      } catch { /* private mode — sessionStorage still holds this tab's session */ }
    }
    clog.info('auth', 'Login success', { userId: user?.id, role: user?.role, tenantId: user?.tenantId, remember: !!remember });
    set({ token, user, activeTenant: user.tenantSlug || user.tenantId, authRestoring: false });
  },
  setToken: (token) => {
    // sessionStorage only — see `login`.
    const ss = safeSession();
    if (ss) {
      try { ss.setItem(TOKEN_KEY, token); } catch { /* in-memory session still valid */ }
    }
    set({ token, authRestoring: false });
  },
  setUser: (user) => {
    // sessionStorage only — see `login`.
    const blob = user ? JSON.stringify(user) : null;
    const ss = safeSession();
    if (ss) {
      try {
        if (blob) ss.setItem(USER_KEY, blob);
        else ss.removeItem(USER_KEY);
      } catch { /* in-memory session still valid */ }
    }
    set({ user, activeTenant: user?.tenantSlug || user?.tenantId || null });
  },
  setAuthRestoring: (restoring) => set({ authRestoring: restoring }),
  logout: () => {
    const ss = safeSession();
    if (ss) {
      ss.removeItem(TOKEN_KEY);
      ss.removeItem(USER_KEY);
    }
    // 2026-09-24 — "Not now" on the post-sign-in passkey offer holds for the
    // SESSION, and a deliberate sign-out ends it: the next sign-in may ask
    // again. ("Don't ask on this device" is a device answer and is untouched.)
    clearPasskeyOfferSessionAnswer();
    // SEC-010 — revoke the durable half too. Fire-and-forget: a logout that
    // waited on the network could be cancelled by the hard redirect that
    // follows it, and the cookie is cleared by the route handler either way.
    // Imported lazily so the store stays usable in non-browser test setups.
    try {
      void import('@/lib/session-client').then((m) => m.endRememberedSession()).catch(() => {});
    } catch { /* best-effort */ }
    const ls = safeLocal();
    if (ls) {
      ls.removeItem(TOKEN_KEY);
      ls.removeItem(USER_KEY);
      ls.removeItem(REMEMBER_KEY);
      // 2026-05-03 — cross-tenant bleed fix. The SchoolSwitcher caches
      // the last-selected tenant slug here so the dashboard remembers
      // which child school an admin was inside. On logout we clear it
      // so the next user (potentially a different person on a different
      // tenant) doesn't see the previous user's tenant slug pre-selected.
      ls.removeItem('edu_cms_last_school');
    }
    clog.info('auth', 'Logout — clearing state', {});
    set({ token: null, user: null, activeTenant: null, authRestoring: false });
    // Fire the same event apiFetch fires on 401 so the
    // AuthExpirationGuard mounted in DashboardLayout redirects to
    // /login. Previously the comment "Redirect handled by the
    // page-level useEffect" was aspirational — no such effect existed,
    // which is why users got stuck on the same page after logout.
    try { notifyExplicitLogout(); } catch {}
  },

  // UI actions
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  toggleMobileSidebar: () => set((state) => ({ mobileSidebarOpen: !state.mobileSidebarOpen })),
  pushOverlay: () => set((state) => ({ overlayOpenCount: state.overlayOpenCount + 1 })),
  popOverlay: () => set((state) => ({ overlayOpenCount: Math.max(0, state.overlayOpenCount - 1) })),
  setActiveTenant: (tenantId) => set({ activeTenant: tenantId }),
  setEmergencyActive: (active, overrideId) =>
    set({
      isEmergencyActive: active,
      // Preserve forensic chain-of-custody (audit P2 #3): on activate
      // we record the overrideId so a later all-clear can pair to it
      // in the AuditLog. On deactivate we null it back out.
      activeEmergencyOverrideId: active ? (overrideId ?? null) : null,
    }),
}));

// Re-export for backward compatibility with components that imported useAppStore
export const useAppStore = useUIStore;
