import { create } from 'zustand';

/**
 * Unified application state store.
 * Consolidates the previously split ui-store and lib/store into a single source of truth.
 */
interface AppState {
  // Auth state
  token: string | null;
  user: { id: string; email: string; role: string; tenantId: string; tenantSlug?: string; canTriggerPanic?: boolean } | null;

  // UI state
  sidebarOpen: boolean;
  mobileSidebarOpen: boolean;
  activeTenant: string | null;
  isEmergencyActive: boolean;

  // Auth actions
  login: (token: string, user: any) => void;
  logout: () => void;

  // UI actions
  toggleSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  toggleMobileSidebar: () => void;
  setActiveTenant: (tenantId: string) => void;
  setEmergencyActive: (active: boolean) => void;
}

export const useUIStore = create<AppState>((set) => ({
  // Auth
  token: typeof window !== 'undefined' ? localStorage.getItem('edu_cms_token') : null,
  user: typeof window !== 'undefined' && localStorage.getItem('edu_cms_user')
    ? JSON.parse(localStorage.getItem('edu_cms_user')!)
    : null,

  // UI
  sidebarOpen: true,
  mobileSidebarOpen: false,
  activeTenant: null,
  isEmergencyActive: false,

  // Auth actions
  login: (token, user) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('edu_cms_token', token);
      localStorage.setItem('edu_cms_user', JSON.stringify(user));
    }
    set({ token, user, activeTenant: user.tenantSlug || user.tenantId });
  },
  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('edu_cms_token');
      localStorage.removeItem('edu_cms_user');
    }
    set({ token: null, user: null, activeTenant: null });
    // Redirect handled by the page-level useEffect
  },

  // UI actions
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  toggleMobileSidebar: () => set((state) => ({ mobileSidebarOpen: !state.mobileSidebarOpen })),
  setActiveTenant: (tenantId) => set({ activeTenant: tenantId }),
  setEmergencyActive: (active) => set({ isEmergencyActive: active }),
}));

// Re-export for backward compatibility with components that imported useAppStore
export const useAppStore = useUIStore;
