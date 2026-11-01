/**
 * Broadcast targeting (2026-10-31) — the composer reuses the emergency
 * trigger's shared screen picker. Default is all screens (byte-for-byte the
 * old request); a chosen group / screen is sent as scopeType group / device.
 */
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const SLUG = 'springfield-elementary';
const TENANT_UUID = '7a7f3e4e-0000-4000-8000-000000000001';

jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: SLUG }),
  usePathname: () => `/${SLUG}/emergency/broadcast`,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: (namespace?: string) => (key: string, vars?: Record<string, unknown>) => {
    const fullKey = namespace ? `${namespace}.${key}` : key;
    return vars ? `${fullKey} ${JSON.stringify(vars)}` : fullKey;
  },
}));
const storeState = {
  token: 'tok',
  user: { id: 'u1', email: 'admin@school.test', role: 'SCHOOL_ADMIN', tenantId: TENANT_UUID, canTriggerPanic: false },
};
jest.mock('@/store/ui-store', () => ({
  useUIStore: (selector?: (s: unknown) => unknown) => (selector ? selector(storeState) : storeState),
}));
jest.mock('@/lib/store', () => ({
  useAppStore: (selector?: (s: unknown) => unknown) => (selector ? selector(storeState) : storeState),
}));
jest.mock('@/lib/api-url', () => ({ API_URL: 'http://api.test/api/v1' }));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));
jest.mock('@/components/emergency/EmergencyLiveRegion', () => ({
  useEmergencyAnnouncer: () => ({ announce: jest.fn(), region: null }),
}));
jest.mock('@/components/assets/AssetPicker', () => ({ AssetPicker: () => null }));
const fetchWithTimeout = jest.fn();
jest.mock('@/lib/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));
import BroadcastPage from '../page';

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

const TARGETS = {
  tenantId: TENANT_UUID, tenantName: 'School', allScreensCount: 6,
  groups: [{ id: 'g-gym', name: 'Gym', tenantId: TENANT_UUID, tenantName: 'School', screenCount: 2 }],
  screens: [{ id: 's-lobby', name: 'Lobby', location: null, online: true, groupId: null, groupName: null, tenantId: TENANT_UUID, tenantName: 'School', displayScreenCount: 1 }],
};

beforeEach(() => {
  jest.useFakeTimers();
  fetchWithTimeout.mockReset();
  fetchWithTimeout.mockImplementation(async (url: string) =>
    url.includes('/emergency/targets') ? jsonResponse(TARGETS)
      : url.includes('/emergency/status') ? jsonResponse({ active: [] })
      : jsonResponse({ success: true, messageId: 'bcast_1' }, 201),
  );
});
afterEach(() => { jest.useRealTimers(); });

const sendCalls = () => fetchWithTimeout.mock.calls.filter((c) => /\/emergency\/(broadcast|media-alert)$/.test(String(c[0])));

async function holdSend() {
  fireEvent.change(screen.getByPlaceholderText('emergency.broadcast.messagePlaceholder'), { target: { value: 'Gym closed' } });
  fireEvent.pointerDown(screen.getByRole('button', { name: 'emergency.broadcast.sendAria' }));
  await act(async () => { jest.advanceTimersByTime(3_100); });
  await waitFor(() => expect(sendCalls()).toHaveLength(1));
  return JSON.parse(String((sendCalls()[0][1] as RequestInit).body));
}

async function openPicker() {
  await waitFor(() => expect(fetchWithTimeout.mock.calls.some((c) => String(c[0]).includes('/emergency/targets'))).toBe(true));
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByTestId('emergency-choose-screens'));
}

describe('Broadcast targeting', () => {
  it('shows the shared picker bar defaulting to all screens', async () => {
    await act(async () => { render(<BroadcastPage />); });
    expect(screen.getByTestId('emergency-target-bar')).toBeTruthy();
    expect(screen.getByTestId('emergency-target-label').textContent).toContain('emergency.target.allScreens');
  });

  it('choosing a group sends scopeType group with that id', async () => {
    await act(async () => { render(<BroadcastPage />); });
    await openPicker();
    fireEvent.click(await screen.findByTestId('target-option-group-g-gym'));
    const body = await holdSend();
    expect(body).toEqual(expect.objectContaining({ scopeType: 'group', scopeId: 'g-gym', text: 'Gym closed' }));
  });

  it('choosing one screen sends scopeType device with that id', async () => {
    await act(async () => { render(<BroadcastPage />); });
    await openPicker();
    fireEvent.click(await screen.findByTestId('target-option-screen-s-lobby'));
    const body = await holdSend();
    expect(body).toEqual(expect.objectContaining({ scopeType: 'device', scopeId: 's-lobby' }));
  });

  it('with no choice it still sends to the whole tenant', async () => {
    await act(async () => { render(<BroadcastPage />); });
    const body = await holdSend();
    expect(body).toEqual(expect.objectContaining({ scopeType: 'tenant', scopeId: TENANT_UUID }));
  });
});
