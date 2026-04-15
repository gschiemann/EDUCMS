import { useUIStore } from '@/store/ui-store';

describe('Unified App Store', () => {
  beforeEach(() => {
    // Reset store between tests
    useUIStore.setState({
      token: null,
      user: null,
      sidebarOpen: true,
      activeTenant: null,
      isEmergencyActive: false,
    });
  });

  it('should handle login and set tenant', () => {
    const store = useUIStore.getState();
    store.login('test-token', {
      id: 'user-1',
      email: 'admin@test.edu',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-123'
    });

    const state = useUIStore.getState();
    expect(state.token).toBe('test-token');
    expect(state.user?.email).toBe('admin@test.edu');
    expect(state.activeTenant).toBe('tenant-123');
  });

  it('should handle setActiveTenant', () => {
    useUIStore.getState().setActiveTenant('school-999');
    expect(useUIStore.getState().activeTenant).toBe('school-999');
  });

  it('should toggle emergency state', () => {
    useUIStore.getState().setEmergencyActive(true);
    expect(useUIStore.getState().isEmergencyActive).toBe(true);
    
    useUIStore.getState().setEmergencyActive(false);
    expect(useUIStore.getState().isEmergencyActive).toBe(false);
  });

  it('should handle logout and clear state', () => {
    const store = useUIStore.getState();
    store.login('token', { id: '1', email: 'a@b.com', role: 'ADMIN', tenantId: 't1' });
    store.logout();

    const state = useUIStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.activeTenant).toBeNull();
  });
});
