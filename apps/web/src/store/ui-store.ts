import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  activeTenant: string | null;
  toggleSidebar: () => void;
  setActiveTenant: (tenantId: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  activeTenant: null,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setActiveTenant: (tenantId) => set({ activeTenant: tenantId }),
}));
