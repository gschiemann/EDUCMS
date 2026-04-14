import { useAppStore } from './store';
import { act } from '@testing-library/react';

describe('AppStore', () => {
  const initialStoreState = useAppStore.getState();

  beforeEach(() => {
    useAppStore.setState(initialStoreState, true);
  });

  test('should set active school id', () => {
    act(() => {
      useAppStore.getState().setActiveSchoolId('school-999');
    });
    expect(useAppStore.getState().activeSchoolId).toBe('school-999');
  });

  test('should trigger emergency and clear emergency', () => {
    // Initial state
    expect(useAppStore.getState().isEmergencyActive).toBe(false);

    // Trigger
    act(() => {
      useAppStore.getState().setEmergencyActive(true);
    });
    expect(useAppStore.getState().isEmergencyActive).toBe(true);

    // Clear
    act(() => {
      useAppStore.getState().setEmergencyActive(false);
    });
    expect(useAppStore.getState().isEmergencyActive).toBe(false);
  });

  test('should change user role', () => {
    act(() => {
      useAppStore.getState().setUserRole('teacher');
    });
    expect(useAppStore.getState().userRole).toBe('teacher');
  });
});
