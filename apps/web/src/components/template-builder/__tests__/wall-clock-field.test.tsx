/**
 * "why does the clock not go back to a standard clock field... its free
 * text, i know this works for other templates... the template actually is
 * pulling the correct time but the editor seems to not be right."
 *
 * Exactly right. `BOARD_CONFIG_KEYS` listed `clock.time` but not
 * `clock.hhmm` — the name 76 boards use — so those boards ticked
 * correctly on screen while the editor offered a text box holding a
 * stale authored value. Both halves read one shared list now.
 *
 * The other half of the invariant matters just as much: a SCHEDULED time
 * the operator authors (a service at 10:30 AM) must stay a text box.
 * Sweeping those into the clock control would take away the ability to
 * set them at all.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentFields } from '../PropertiesPanel';
import WALL_CLOCK_FIELDS from '@/lib/wall-clock-fields.json';

jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

function board(fields: Record<string, string>) {
  const spans = Object.entries(fields)
    .map(([k, v]) => `<div data-field="${k}">${v}</div>`).join('');
  return `<!doctype html><html><body><main id="stage">${spans}</main></body></html>`;
}

function mount(html: string) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(() =>
    Promise.resolve({ ok: true, text: () => Promise.resolve(html) }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ContentFields
        zone={{ id: 'z', widgetType: 'EXTERNAL_HTML', defaultConfig: { url: '/templates/signage/bar/x.html' } }}
        updateZone={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

it('the wall clock is a clock control, not a text box — whatever the board calls it', async () => {
  mount(board({ 'clock.hhmm': '10:42 PM', 'brand.name': 'THE LANTERN BAR' }));
  await waitFor(() => expect(screen.getByDisplayValue('THE LANTERN BAR')).toBeInTheDocument());
  // The stale authored time must NOT be offered as editable copy.
  expect(screen.queryByDisplayValue('10:42 PM')).not.toBeInTheDocument();
});

it.each([...WALL_CLOCK_FIELDS.time, ...WALL_CLOCK_FIELDS.date])(
  'a board naming its wall clock %s gets the control, not a text box', async (key) => {
    mount(board({ [key]: '9:42 AM', 'brand.name': 'CLUB' }));
    await waitFor(() => expect(screen.getByDisplayValue('CLUB')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('9:42 AM')).not.toBeInTheDocument();
  });

it('a SCHEDULED time stays editable — it is the operator’s to set', async () => {
  mount(board({ 'service.time': '10:30 AM', 'next.time': '10:15 AM', 'feat.time': '9:30 PM', 'brand.name': 'CLUB' }));
  await waitFor(() => expect(screen.getByDisplayValue('CLUB')).toBeInTheDocument());
  expect(screen.getByDisplayValue('10:30 AM')).toBeInTheDocument();
  expect(screen.getByDisplayValue('10:15 AM')).toBeInTheDocument();
  expect(screen.getByDisplayValue('9:30 PM')).toBeInTheDocument();
});

it('the shim drives a subset of what the editor treats as a clock, and never more', () => {
  const editorKnows = new Set([...WALL_CLOCK_FIELDS.time, ...WALL_CLOCK_FIELDS.date]);
  for (const k of [...WALL_CLOCK_FIELDS.shimDrives.time, ...WALL_CLOCK_FIELDS.shimDrives.date]) {
    expect(editorKnows.has(k)).toBe(true);
  }
});
