import { act, renderHook } from '@testing-library/react';
const mockPush = jest.fn();
const mockRouter = { push: mockPush };
const mockClear = jest.fn();
const mockQueryClient = { clear: mockClear };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockQueryClient }));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }));
import { apiFetch } from '@/lib/api-client';
import { useTenantSwitch } from '../use-tenant-switch';
import { setRememberMarker, hasRememberMarker } from '@/lib/session-client';
import { useUIStore } from '@/store/ui-store';
beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear();
  useUIStore.setState({ user: { id: 'operator', tenantId: 'home' } as never, token: 'old' });
  (apiFetch as jest.Mock).mockResolvedValue({ access_token: 'new', user: { id: 'operator', tenantId: 'child', tenantSlug: 'child' } });
});
for (const remembered of [true, false]) {
  it(`switching keeps the original remember choice (${remembered}) and records the last workspace`, async () => {
    setRememberMarker(remembered);
    const { result } = renderHook(() => useTenantSwitch());
    await act(async () => { expect(await result.current.switchToTenant({ id: 'child', slug: 'child' })).toEqual({ ok: true }); });
    expect(hasRememberMarker()).toBe(remembered);
    expect(useUIStore.getState().user?.tenantId).toBe('child');
    expect(localStorage.getItem('edu_cms_last_school')).toBe('child');
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/child/dashboard');
  });
}
