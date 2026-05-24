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

  // One-time migration from legacy localStorage. After this, LS is
  // wiped so new tabs never inherit a stale identity.
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
      try {
        ls.removeItem(TOKEN_KEY);
        ls.removeItem(USER_KEY);
      } catch {}
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
  } | null;

  // UI state
  sidebarOpen: boolean;
  mobileSidebarOpen: boolean;
  activeTenant: string | null;
  isEmergencyActive: boolean;
  /** 2026-05-23 launch audit P2 #3 — store the overrideId returned from
   *  `broadcastEmergency` so EmergencyOverlay can pass it back to
   *  allClearEmergency. Without this, every clear minted a fresh
   *  `clear_<uuid>` and the AuditLog couldn't pair trigger → clear
   *  events, breaking forensic chain-of-custody. */
  activeEmergencyOverrideId: string | null;

  // Auth actions
  login: (token: string, user: any) => void;
  logout: () => void;

  // UI actions
  toggleSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  toggleMobileSidebar: () => void;
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
  activeTenant: initial.user?.tenantSlug || initial.user?.tenantId || null,
  isEmergencyActive: false,
  activeEmergencyOverrideId: null,

  // Auth actions
  login: (token, user) => {
    const ss = safeSession();
    if (ss) {
      ss.setItem(TOKEN_KEY, token);
      ss.setItem(USER_KEY, JSON.stringify(user));
    }
    // Belt-and-suspenders: always purge localStorage on login so no
    // legacy copy can leak back into a sibling tab.
    const ls = safeLocal();
    if (ls) {
      ls.removeItem(TOKEN_KEY);
      ls.removeItem(USER_KEY);
    }
    clog.info('auth', 'Login success', { userId: user?.id, role: user?.role, tenantId: user?.tenantId });
    set({ token, user, activeTenant: user.tenantSlug || user.tenantId });
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
