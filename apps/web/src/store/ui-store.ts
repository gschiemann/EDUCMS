import { create } from 'zustand';
import { notifyExplicitLogout } from '@/lib/auth-events';
import { clog } from '@/lib/client-logger';

/**
 * Unified application state store.
 *
 * Auth storage lives in SESSION storage, not localStorage. localStorage
 * is shared across every tab of the same origin — a user who opened
 * Chardon in one tab and Springfield in another saw the two sessions
 * overwrite each other: whichever tab logged in last won, and a
 * hard-refresh in the other tab adopted the winner's identity. That's a
 * serious multi-tenant bleed.
 *
 * sessionStorage is scoped per-tab: each tab has an independent auth
 * session. Hard-refresh inside a tab preserves the tab's session.
 * Closing the tab ends the session (acceptable for an admin dashboard —
 * this is how Gmail, Notion, Linear behave when you need multiple
 * accounts at once).
 *
 * Migration: if a legacy token is still in localStorage (pre-fix) and
 * the tab has no sessionStorage token yet, copy it once and wipe the
 * localStorage copy so future tabs start fresh. After that, every
 * write/read is sessionStorage only.
 */

const TOKEN_KEY = 'edu_cms_token';
const USER_KEY = 'edu_cms_user';
// 2026-06-16 — "Keep me logged in". When the operator opts into persistence
// at login we ALSO write the token to localStorage (durable across app/tab
// close) and set this marker. Without it the token lived in sessionStorage
// only, which a phone wipes when the PWA/tab closes — so remember-me never
// survived a relaunch (the server already issues a 30-day JWT for it). The
// marker tells bootstrap to KEEP the localStorage copy instead of treating it
// as a legacy token to migrate-and-wipe. Default (unchecked) is unchanged:
// sessionStorage-only, per-tab multi-tenant isolation.
const REMEMBER_KEY = 'edu_cms_remember';

function safeSession(): Storage | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}
function safeLocal(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

function bootstrapAuth(): { token: string | null; user: any | null } {
  const ss = safeSession();
  const ls = safeLocal();
  if (!ss && !ls) return { token: null, user: null };

  // Prefer the tab's own sessionStorage (per-tab) over the shared LS.
  let token = ss?.getItem(TOKEN_KEY) || null;
  let userRaw = ss?.getItem(USER_KEY) || null;

  // localStorage fallback. Two cases:
  //   • remember-me ON (REMEMBER_KEY === '1'): the operator chose to stay
  //     logged in — load from localStorage AND KEEP it so the session
  //     survives the next app/tab close. Mirror into this tab's sessionStorage
  //     for fast per-tab reads.
  //   • otherwise: a legacy (pre-remember-me) localStorage token — migrate it
  //     into sessionStorage once, then WIPE localStorage so new tabs never
  //     inherit a stale identity (the original per-tab-isolation behavior).
  if (!token && ls) {
    const lsToken = ls.getItem(TOKEN_KEY);
    const lsUser = ls.getItem(USER_KEY);
    if (lsToken) {
      token = lsToken;
      userRaw = lsUser;
      try {
        ss?.setItem(TOKEN_KEY, lsToken);
        if (lsUser) ss?.setItem(USER_KEY, lsUser);
      } catch { /* storage full — accept the in-memory-only session */ }
      if (ls.getItem(REMEMBER_KEY) !== '1') {
        try {
          ls.removeItem(TOKEN_KEY);
          ls.removeItem(USER_KEY);
        } catch {}
      }
    }
  }

  let user: any | null = null;
  if (userRaw) {
    try { user = JSON.parse(userRaw); } catch { user = null; }
  }
  return { token, user };
}

const initial = typeof window !== 'undefined' ? bootstrapAuth() : { token: null, user: null };

interface AppState {
  // Auth state
  token: string | null;
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
    const ls = safeLocal();
    if (ls) {
      if (remember) {
        // "Keep me logged in" — persist durably so the session survives the
        // next app/tab close (the server pairs this with a 30-day JWT). This
        // trades the strict per-tab isolation for cross-restart persistence,
        // which is exactly what the operator opted into.
        try {
          ls.setItem(TOKEN_KEY, token);
          ls.setItem(USER_KEY, JSON.stringify(user));
          ls.setItem(REMEMBER_KEY, '1');
        } catch { /* storage full — sessionStorage still holds this tab's session */ }
      } else {
        // Default: per-tab only. Purge any durable copy so no legacy/remembered
        // token can leak back into a sibling tab.
        ls.removeItem(TOKEN_KEY);
        ls.removeItem(USER_KEY);
        ls.removeItem(REMEMBER_KEY);
      }
    }
    clog.info('auth', 'Login success', { userId: user?.id, role: user?.role, tenantId: user?.tenantId, remember: !!remember });
    set({ token, user, activeTenant: user.tenantSlug || user.tenantId });
  },
  setToken: (token) => {
    // Mirror `login`'s storage placement exactly: this tab's sessionStorage
    // always, and localStorage ONLY when the operator had chosen "keep me
    // logged in". Writing the durable copy unconditionally would silently
    // upgrade a per-tab session into a persistent one.
    const ss = safeSession();
    if (ss) {
      try { ss.setItem(TOKEN_KEY, token); } catch { /* in-memory session still valid */ }
    }
    const ls = safeLocal();
    if (ls && ls.getItem(REMEMBER_KEY) === '1') {
      try { ls.setItem(TOKEN_KEY, token); } catch { /* storage full */ }
    }
    set({ token });
  },
  setUser: (user) => {
    // Mirror `login`/`setToken`'s storage placement exactly: this tab's
    // sessionStorage always, and localStorage ONLY when the operator had
    // chosen "keep me logged in". Writing the durable copy unconditionally
    // would silently upgrade a per-tab session into a persistent one.
    const blob = user ? JSON.stringify(user) : null;
    const ss = safeSession();
    if (ss) {
      try {
        if (blob) ss.setItem(USER_KEY, blob);
        else ss.removeItem(USER_KEY);
      } catch { /* in-memory session still valid */ }
    }
    const ls = safeLocal();
    if (ls && ls.getItem(REMEMBER_KEY) === '1') {
      try {
        if (blob) ls.setItem(USER_KEY, blob);
        else ls.removeItem(USER_KEY);
      } catch { /* storage full */ }
    }
    set({ user, activeTenant: user?.tenantSlug || user?.tenantId || null });
  },
  logout: () => {
    const ss = safeSession();
    if (ss) {
      ss.removeItem(TOKEN_KEY);
      ss.removeItem(USER_KEY);
    }
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
    set({ token: null, user: null, activeTenant: null });
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
