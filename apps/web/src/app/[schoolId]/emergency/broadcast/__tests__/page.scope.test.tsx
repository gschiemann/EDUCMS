/**
 * Launch QA B1 (2026-10-23) — the desktop Emergency Broadcast console sent
 * the URL SLUG (`params.schoolId`, e.g. "springfield-elementary") as the
 * tenant id. `POST /emergency/broadcast` / `/media-alert` scope by tenant
 * UUID, so every send 403'd for a SCHOOL_ADMIN ("Your alert was NOT sent")
 * and the active-messages poll 403'd for a super admin, leaving the Clear
 * list empty on the one page the dashboard's red "Emergency console" button
 * opens during an alert. The id now comes from the signed-in workspace
 * (`user.tenantId`, the same source as EmergencyTriggerModal), falling back
 * to the route param only when no user is loaded yet.
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
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key} ${JSON.stringify(vars)}` : key,
}));
const storeState = {
  token: 'tok',
  user: { id: 'u1', email: 'admin@school.test', role: 'SCHOOL_ADMIN', tenantId: TENANT_UUID, canTriggerPanic: false },
};
// `@/lib/store` re-exports `useUIStore` as `useAppStore`; the page uses both
// the bare form (`useAppStore()`) and the selector form.
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
const fetchWithTimeout = jest.fn();
jest.mock('@/lib/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));

import BroadcastPage from '../page';

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

beforeEach(() => {
  jest.useFakeTimers();
  fetchWithTimeout.mockReset();
  fetchWithTimeout.mockImplementation(async (url: string) =>
    url.includes('/emergency/status') ? jsonResponse({ active: [] }) : jsonResponse({ success: true, messageId: 'bcast_1' }, 201),
  );
});
afterEach(() => {
  jest.useRealTimers();
});

const statusCalls = () => fetchWithTimeout.mock.calls.filter((c) => String(c[0]).includes('/emergency/status'));
const sendCalls = () => fetchWithTimeout.mock.calls.filter((c) => String(c[0]).includes('/emergency/broadcast') || String(c[0]).includes('/emergency/media-alert'));

describe('Emergency Broadcast console — request scope (B1)', () => {
  it('polls the active list with the TENANT ID, never the URL slug', async () => {
    await act(async () => { render(<BroadcastPage />); });
    await waitFor(() => expect(statusCalls().length).toBeGreaterThan(0));
    const url = String(statusCalls()[0][0]);
    expect(url).toBe(`http://api.test/api/v1/emergency/status?tenantId=${encodeURIComponent(TENANT_UUID)}`);
    expect(url).not.toContain(SLUG);
  });

  it('a held send posts scopeType tenant with the TENANT ID as scopeId', async () => {
    await act(async () => { render(<BroadcastPage />); });
    fireEvent.change(screen.getByPlaceholderText('emergency.broadcast.messagePlaceholder'), {
      target: { value: 'All staff to the main office' },
    });
    const button = screen.getByRole('button', { name: 'emergency.broadcast.sendAria' });
    fireEvent.pointerDown(button);
    await act(async () => { jest.advanceTimersByTime(3_100); });
    await waitFor(() => expect(sendCalls()).toHaveLength(1));

    const [url, init] = sendCalls()[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/emergency/broadcast');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual(
      expect.objectContaining({ scopeType: 'tenant', scopeId: TENANT_UUID, text: 'All staff to the main office' }),
    );
    expect(JSON.stringify(body)).not.toContain(SLUG);
  });
});
