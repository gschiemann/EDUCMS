/**
 * "if i want to add a 4th event i should be able to and the cards
 * resize… they need to just work no matter what the user is trying to
 * do."
 *
 * The board half is measured by tests/cross-browser/repeat-groups.cjs
 * (identity at the authored count, real growth and fit above it). This
 * covers the editor half: the control appears for a list, it does not
 * appear for a board without one, the count reaches the config, and —
 * the part that is easy to forget — the row you just added has fields to
 * type into. Without that last one you can add a 4th event and be left
 * with a blank card and nowhere to fill it.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentFields } from '../PropertiesPanel';

jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

// A board with a three-row list, exactly as the packs ship them.
const BOARD_WITH_LIST = `<!doctype html><html><body><main id="stage">
  <h1 data-field="story.headline">Reading buddies team up today</h1>
  <aside>
    <div><span data-field="event.0.number">01</span><div data-field="event.0.time">9:20 · Library</div><div data-field="event.0.name">Reading buddy meetup</div></div>
    <div><span data-field="event.1.number">02</span><div data-field="event.1.time">11:10 · Cafeteria</div><div data-field="event.1.name">Kindness table opens</div></div>
    <div><span data-field="event.2.number">03</span><div data-field="event.2.time">1:45 · Gym</div><div data-field="event.2.name">All-school pep rally</div></div>
  </aside>
</main></body></html>`;

const BOARD_NO_LIST = `<!doctype html><html><body><main id="stage">
  <h1 data-field="story.headline">One headline</h1><p data-field="story.summary">One summary</p>
</main></body></html>`;

function mount(html: string, defaultConfig: Record<string, unknown> = {}) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(() =>
    Promise.resolve({ ok: true, text: () => Promise.resolve(html) }));
  const updateZone = jest.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ContentFields
        zone={{ id: 'z', widgetType: 'EXTERNAL_HTML', defaultConfig: { url: '/templates/school/x.html', ...defaultConfig } }}
        updateZone={updateZone}
      />
    </QueryClientProvider>,
  );
  return { updateZone };
}

const lastCfg = (m: jest.Mock) => m.mock.calls[m.mock.calls.length - 1][1].defaultConfig as Record<string, unknown>;

it('a board with a list offers a count, starting at what it ships', async () => {
  mount(BOARD_WITH_LIST);
  await waitFor(() => expect(screen.getByText(/How many events/i)).toBeInTheDocument());
  expect(screen.getByText('3 — as designed')).toBeInTheDocument();
});

it('a board with no list offers no count', async () => {
  mount(BOARD_NO_LIST);
  await waitFor(() => expect(screen.getByText(/Story/i)).toBeInTheDocument());
  expect(screen.queryByText(/How many/i)).not.toBeInTheDocument();
});

it('adding a row writes the count and says the rows will resize', async () => {
  const { updateZone } = mount(BOARD_WITH_LIST);
  await waitFor(() => expect(screen.getByText(/How many events/i)).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText('Add one event'));
  expect(lastCfg(updateZone)).toEqual(expect.objectContaining({ repeatCounts: { event: 4 } }));
});

it('returning to the authored count clears the override rather than pinning it', async () => {
  const { updateZone } = mount(BOARD_WITH_LIST, { repeatCounts: { event: 4 } });
  await waitFor(() => expect(screen.getByText(/How many events/i)).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText('Remove one event'));
  expect(lastCfg(updateZone).repeatCounts).toBeUndefined();
});

it('the row you just added has fields to type into', async () => {
  mount(BOARD_WITH_LIST, { repeatCounts: { event: 4 } });
  // event.3.* is not in the board HTML — it is cloned at render time — so
  // the panel has to synthesize its fields or the new card is unfillable.
  await waitFor(() => expect(screen.getByText('4 · they resize to fit (max 12)')).toBeInTheDocument());
  const labels = screen.getAllByText(/Event 4/i);
  expect(labels.length).toBeGreaterThanOrEqual(2); // time + name at least
});

it('the count is capped, and the cap is real', async () => {
  mount(BOARD_WITH_LIST, { repeatCounts: { event: 12 } });
  await waitFor(() => expect(screen.getByText(/How many events/i)).toBeInTheDocument());
  expect(screen.getByLabelText('Add one event')).toBeDisabled();
});
