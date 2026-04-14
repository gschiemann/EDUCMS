import { create } from 'zustand';

interface AppState {
  activeSchoolId: string | null;
  userRole: 'admin' | 'teacher' | null;
  isEmergencyActive: boolean;
  setActiveSchoolId: (id: string) => void;
  setUserRole: (role: 'admin' | 'teacher') => void;
  setEmergencyActive: (active: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeSchoolId: 'school-1', // Default
  userRole: 'admin', // Default to admin for prototyping
  isEmergencyActive: false,
  setActiveSchoolId: (id) => set({ activeSchoolId: id }),
  setUserRole: (role) => set({ userRole: role }),
  setEmergencyActive: (active) => set({ isEmergencyActive: active }),
}));
