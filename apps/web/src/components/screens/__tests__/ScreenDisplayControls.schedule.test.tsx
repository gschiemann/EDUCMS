/**
 * The Settings tab's on/off schedule line shows what APPLIES: the screen's own
 * schedule, else its group's, else "none" — with Override / Use group actions.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScreenDisplayControls } from '../ScreenDisplayControls';

let screenRows: unknown[] = [];
let groupRows: unknown[] = [];
const calls: Array<{ path: string; method?: string; body?: string }> = [];

jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: jest.fn().mockResolvedValue(true),
  appPrompt: jest.fn(),
  appAlert: jest.fn(),
}));
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: { method?: string; body?: string }) => {
    calls.push({ path, method: opts?.method, body: opts?.body });
    if (path.startsWith('/display-schedules?screenId=')) return Promise.resolve(screenRows);
    if (path.startsWith('/display-schedules?screenGroupId=')) return Promise.resolve(groupRows);
    return Promise.resolve({ success: true });
  },
}));

const row = (over: Record<string, unknown>) => ({
  id: 'r1', onTime: '07:00', offTime: '18:00', isActive: true, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], timezone: 'America/Chicago', ...over,
});

function renderPanel(onOpen = jest.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ScreenDisplayControls
        screen={{
          id: 's1', name: 'Lobby', status: 'ONLINE', renderHealth: 'OK',
          screenGroupId: 'g1', screenGroup: { name: 'Front Office' },
          displayCapabilities: { schema: 1, reportedAt: 1_760_000_000_000, build: {}, verdict: { reboot: 'none' } },
        }}
        onOpenSchedule={onOpen}
      />
    </QueryClientProvider>,
  );
  return onOpen;
}

beforeEach(() => { calls.length = 0; });

describe('on/off schedule line', () => {
  it('inherited: shows the group schedule, names the group, offers Override', async () => {
    screenRows = [];
    groupRows = [row({ id: 'g-r1' })];
    const onOpen = renderPanel();
    await waitFor(() => expect(rtl.getByTestId('schedule-source').textContent).toBe('From the group “Front Office”'));
    expect(rtl.getByTestId('schedule-line').textContent).toContain('Off 6 PM – on 7 AM');
    expect(rtl.queryByText('No on/off schedule')).not.toBeInTheDocument();
    fireEvent.click(rtl.getByTestId('schedule-override'));
    await waitFor(() => expect(onOpen).toHaveBeenCalled());
    const post = calls.find((c) => c.method === 'POST');
    expect(JSON.parse(post!.body!)).toMatchObject({ screenId: 's1', onTime: '07:00', offTime: '18:00' });
  });

  it('overridden: shows the screen’s own schedule and "Use the group’s schedule" deletes it', async () => {
    screenRows = [row({ id: 's-r1', offTime: '20:00', screenId: 's1' })];
    groupRows = [row({ id: 'g-r1' })];
    renderPanel();
    await waitFor(() => expect(rtl.getByTestId('schedule-source').textContent).toBe('This screen’s own schedule'));
    expect(rtl.getByTestId('schedule-line').textContent).toContain('Off 8 PM – on 7 AM');
    fireEvent.click(rtl.getByTestId('schedule-use-group'));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/display-schedules/s-r1')).toBe(true));
  });

  it('none: only when neither the screen nor its group has one', async () => {
    screenRows = [];
    groupRows = [];
    renderPanel();
    await waitFor(() => expect(rtl.getByTestId('schedule-line').textContent).toContain('No on/off schedule'));
    expect(rtl.queryByTestId('schedule-override')).not.toBeInTheDocument();
    expect(rtl.queryByTestId('schedule-use-group')).not.toBeInTheDocument();
  });
});
