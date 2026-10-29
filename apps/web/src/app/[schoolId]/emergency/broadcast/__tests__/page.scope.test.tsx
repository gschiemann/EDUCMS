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
const STORED_IMAGE = 'https://media.example.test/storage/evacuation-map.png';
jest.mock('@/components/assets/AssetPicker', () => ({
  AssetPicker: ({ kind, onPick, onClose }: { kind: string; onPick: (url: string) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Media picker">
      <button onClick={() => onPick(kind === 'audio' ? 'https://media.example.test/instructions.mp3' : STORED_IMAGE)}>Pick stored asset</button>
      <button onClick={onClose}>Close picker</button>
    </div>
  ),
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
  jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
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

describe('Broadcast composer safeguards and media', () => {
  const sendButton = () => screen.getByRole('button', { name: 'emergency.broadcast.sendAria' });
  const writeMessage = () => fireEvent.change(screen.getByLabelText('emergency.broadcast.message'), { target: { value: 'Use the north exit' } });
  const hold = async () => { fireEvent.pointerDown(sendButton()); await act(async () => { jest.advanceTimersByTime(3100); }); };

  it.each(['pointerUp', 'pointerCancel', 'pointerLeave', 'blur'] as const)('cancels an interrupted hold on %s', async (event) => {
    await act(async () => { render(<BroadcastPage />); });
    writeMessage();
    fireEvent.pointerDown(sendButton());
    await act(async () => { jest.advanceTimersByTime(1500); });
    fireEvent[event](sendButton());
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(sendCalls()).toHaveLength(0);
  });

  it('cancels timers when navigating away during a hold', async () => {
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<BroadcastPage />); });
    writeMessage();
    fireEvent.pointerDown(sendButton());
    view!.unmount();
    await act(async () => { jest.advanceTimersByTime(4000); });
    expect(sendCalls()).toHaveLength(0);
  });

  it('requires a continuous three-second keyboard hold and ignores repeats', async () => {
    await act(async () => { render(<BroadcastPage />); });
    writeMessage();
    fireEvent.keyDown(sendButton(), { key: 'Enter' });
    await act(async () => { jest.advanceTimersByTime(500); });
    fireEvent.keyUp(sendButton(), { key: 'Enter' });
    await act(async () => { jest.advanceTimersByTime(3100); });
    expect(sendCalls()).toHaveLength(0);
    fireEvent.keyDown(sendButton(), { key: ' ' });
    fireEvent.keyDown(sendButton(), { key: ' ', repeat: true });
    await act(async () => { jest.advanceTimersByTime(3100); });
    expect(sendCalls()).toHaveLength(1);
  });

  it('validates duration and empty media alerts before starting a hold', async () => {
    await act(async () => { render(<BroadcastPage />); });
    writeMessage();
    fireEvent.change(screen.getByLabelText('emergency.broadcast.duration'), { target: { value: '121' } });
    await hold();
    expect(screen.getByRole('alert')).toHaveTextContent('emergency.broadcast.errDuration');
    fireEvent.change(screen.getByLabelText('emergency.broadcast.duration'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('checkbox'));
    await hold();
    expect(screen.getByRole('alert')).toHaveTextContent('emergency.broadcast.errMediaRequired');
    expect(sendCalls()).toHaveLength(0);
  });

  it('sends picked image and audio URLs, with the selected expiry and tenant ID', async () => {
    await act(async () => { render(<BroadcastPage />); });
    writeMessage();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'emergency.broadcast.addImage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick stored asset' }));
    fireEvent.click(screen.getByRole('button', { name: 'emergency.broadcast.addAudio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick stored asset' }));
    fireEvent.change(screen.getByLabelText('emergency.broadcast.duration'), { target: { value: '12' } });
    await hold();
    const [url, init] = sendCalls()[0];
    expect(url).toContain('/emergency/media-alert');
    expect(JSON.parse(init.body)).toEqual({ scopeType: 'tenant', scopeId: TENANT_UUID,
      textBlob: 'Use the north exit', severity: 'WARN', mediaUrls: [STORED_IMAGE],
      audioUrl: 'https://media.example.test/instructions.mp3', expiresAt: Math.floor(Date.now() / 1000) + 720 });
  });

  it('preserves the message when a send fails', async () => {
    fetchWithTimeout.mockImplementation(async (url: string) => url.includes('/emergency/status') ? jsonResponse({ active: [] }) : jsonResponse({}, 503));
    await act(async () => { render(<BroadcastPage />); });
    writeMessage();
    await hold();
    expect(screen.getByLabelText('emergency.broadcast.message')).toHaveValue('Use the north exit');
    expect(screen.getByRole('alert')).toHaveTextContent('503');
  });

  it('shows a status failure instead of claiming there are no active alerts', async () => {
    fetchWithTimeout.mockResolvedValue(jsonResponse({}, 503));
    await act(async () => { render(<BroadcastPage />); });
    expect(screen.getByRole('alert')).toHaveTextContent('emergency.broadcast.statusError');
    expect(screen.queryByText('emergency.broadcast.noneActive')).not.toBeInTheDocument();
  });

  it('keeps a broadcast visible when all-clear fails', async () => {
    fetchWithTimeout.mockImplementation(async (url: string) => url.includes('/emergency/status') ? jsonResponse({ active: [{
      id: 'broadcast-one', type: 'TEXT_BROADCAST', severity: 'WARN', textBlob: 'Use the north exit', mediaUrls: [], audioUrl: null,
      expiresAt: null, createdAt: new Date().toISOString(),
    }] }) : jsonResponse({}, 503));
    await act(async () => { render(<BroadcastPage />); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'emergency.broadcast.clear' })); });
    expect(screen.getByText('Use the north exit')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('emergency.broadcast.errClearFailedBanner');
  });
});
