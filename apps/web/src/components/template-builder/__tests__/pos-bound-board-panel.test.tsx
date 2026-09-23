/**
 * POS-A (2026-09-23) — the builder's "Live menu" section on a kept POS-bound AI
 * board says what is TRUE, through the REAL ContentFields switch (rule #9).
 *
 * Before: the name-join picker ("auto-fill … matched by item name" — false for
 * these boards) and a report that span forever. Now: which POS, how many rows,
 * which are live / sold out / off the menu with what the screens show for each,
 * how soon a change reaches the screens (per the provider's real facts), and a
 * bound row's fields are chips that say what the screens show — not text boxes
 * whose words would never reach one.
 */
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentFields } from '../PropertiesPanel';
import { apiFetch } from '@/lib/api-client';
import { keptPosZoneConfig } from '../../../../tests/fixtures/kept-pos-board';

jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(),
}));

const TOAST_LIVE = { names: true, prices: true, descriptions: true, photos: true, soldOut: false, cadence: 'publish-5min' };
const CONNECTION = {
  id: 'conn-toast', providerId: 'toast', providerName: 'Toast', status: 'ACTIVE', owner: 'parent',
  itemCount: 2, sections: [{ name: 'Tacos', itemCount: 2 }], live: TOAST_LIVE,
};

let boundMenu: unknown;
const apiFetchMock = apiFetch as unknown as jest.Mock;
beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (p: string) => {
    if (String(p).startsWith('/templates/concierge/pos-bound-menu')) {
      if (boundMenu instanceof Error) throw boundMenu;
      return boundMenu;
    }
    return new Promise(() => undefined);
  });
  (global as unknown as { fetch: unknown }).fetch = jest.fn(() => new Promise(() => undefined));
});

function mount(defaultConfig: Record<string, unknown>) {
  const updateZone = jest.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ContentFields zone={{ id: 'z', widgetType: 'EXTERNAL_HTML', defaultConfig }} updateZone={updateZone} />
    </QueryClientProvider>,
  );
  const lastConfig = () => updateZone.mock.calls[updateZone.mock.calls.length - 1][1].defaultConfig as Record<string, unknown>;
  return { updateZone, lastConfig };
}

describe('a kept POS-bound AI board — the Live menu section', () => {
  it('says which POS, how many rows, and what the screens show for each — from the bound menu for this location', async () => {
    boundMenu = {
      connection: CONNECTION,
      readable: true,
      items: [
        { externalId: 'birria', name: '3 Birria Tacos', price: '$16.50', available: true },
        { externalId: 'horchata', name: 'Horchata', price: '$3.25', available: false },
      ],
    };
    mount(keptPosZoneConfig());
    const panel = await screen.findByTestId('pos-bound-board-panel');
    await waitFor(() => expect(within(panel).getByText('Live from Toast')).toBeInTheDocument());
    expect(within(panel).getByText('Bound to Toast — 3 items')).toBeInTheDocument();
    expect(within(panel).getByText('1 is sold out right now — screens show “Sold out”: Horchata')).toBeInTheDocument();
    expect(within(panel).getByText('1 isn\'t on your Toast menu now — screens show “Not available”: Asada Super Burrito')).toBeInTheDocument();
    // What stays live, per Toast's real facts — no auto-86 promise.
    expect(within(panel).getByText('Name and price changes reach your screens about 5 minutes after you publish them in Toast.')).toBeInTheDocument();
    expect(within(panel).getByText('Toast doesn\'t report sold-out items, so those won\'t update on their own.')).toBeInTheDocument();
    // The checks the board is bound by id, for THIS connection.
    expect(apiFetchMock).toHaveBeenCalledWith('/templates/concierge/pos-bound-menu?connectionId=conn-toast');
    // None of the name-join claims, and no endless check.
    expect(screen.queryByText(/matched by item name/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Driven by your POS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Checking which items this board will pull/)).not.toBeInTheDocument();
  });

  it('every row live → says so, and the rows list shows each item’s live price', async () => {
    boundMenu = {
      connection: CONNECTION,
      readable: true,
      items: [
        { externalId: 'birria', name: '3 Birria Tacos', price: '$16.50', available: true },
        { externalId: 'asada', name: 'Asada Super Burrito', price: '$17.50', available: true },
        { externalId: 'horchata', name: 'Horchata', price: '$3.25', available: true },
      ],
    };
    mount(keptPosZoneConfig());
    const panel = await screen.findByTestId('pos-bound-board-panel');
    await waitFor(() => expect(within(panel).getByText('All 3 are on your Toast menu now.')).toBeInTheDocument());
    expect(within(panel).getByText('1. 3 Birria Tacos · $16.50')).toBeInTheDocument();
  });

  it('a bound row’s price is a chip saying what the screens show — not a text box', async () => {
    boundMenu = { connection: CONNECTION, readable: true, items: [{ externalId: 'birria', name: '3 Birria Tacos', price: '$16.50', available: true }] };
    mount(keptPosZoneConfig());
    await waitFor(() => expect(screen.getAllByTestId('pos-slot-field-chip').length).toBeGreaterThan(0));
    const priceRow = document.querySelector('[data-edit-field="item.0.price"]') as HTMLElement;
    await waitFor(() => expect(within(priceRow).getByText('Live from Toast · On screens: $16.50')).toBeInTheDocument());
    expect(priceRow.querySelector('input, textarea')).toBeNull();
    // A field that is NOT in a bound row stays an ordinary text box.
    const heading = document.querySelector('[data-edit-field="menu.title"]') as HTMLElement;
    expect(heading.querySelector('input, textarea')).not.toBeNull();
  });

  it('unbinding a row from its chip keeps every other row bound', async () => {
    boundMenu = { connection: CONNECTION, readable: true, items: [] };
    const { lastConfig } = mount(keptPosZoneConfig());
    const priceRow = await waitFor(() => {
      const el = document.querySelector('[data-edit-field="item.0.price"]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.click(within(priceRow).getByRole('button', { name: 'Unbind this row' }));
    await waitFor(() => expect(lastConfig().posItemBindings).toEqual({ 'item.1': 'asada', 'item.2': 'horchata' }));
    expect(lastConfig().posSync).toBe(true);
  });

  it('"Stop live updates" asks first, then takes every binding off', async () => {
    boundMenu = { connection: CONNECTION, readable: true, items: [] };
    const { updateZone, lastConfig } = mount(keptPosZoneConfig({ textOverrides: { 'menu.title': 'Burritos', 'hero.price': '{{pos.item:x.price}}' } }));
    const panel = await screen.findByTestId('pos-bound-board-panel');
    fireEvent.click(within(panel).getByRole('button', { name: 'Stop live updates' }));
    expect(updateZone).not.toHaveBeenCalled();
    expect(within(panel).getByText('Screens will show the names and prices saved in the board and stop following Toast.')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(updateZone).toHaveBeenCalled());
    expect(lastConfig()).toMatchObject({ posItemBindings: undefined, posSync: false, dataSource: 'NONE', posProvider: undefined, posConnectionId: undefined, textOverrides: { 'menu.title': 'Burritos' } });
  });

  it('a connection that is gone says so — and where to fix it', async () => {
    boundMenu = { connection: null, readable: true, items: [] };
    mount(keptPosZoneConfig());
    const panel = await screen.findByTestId('pos-bound-board-panel');
    await waitFor(() => expect(within(panel).getByText('Not connected')).toBeInTheDocument());
    expect(within(panel).getByText(/The Toast connection this board was bound to is gone/)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Open Settings → POS/ })).toBeInTheDocument();
    // No live-update promise for a board that cannot be live.
    expect(within(panel).queryByText(/reach your screens/)).not.toBeInTheDocument();
  });

  it('a connection that needs attention does not claim live updates either', async () => {
    boundMenu = { connection: { ...CONNECTION, status: 'EXPIRED' }, readable: true, items: [] };
    mount(keptPosZoneConfig());
    const panel = await screen.findByTestId('pos-bound-board-panel');
    await waitFor(() => expect(within(panel).getByText('Toast needs attention')).toBeInTheDocument());
    expect(within(panel).getByText(/Toast needs attention \(EXPIRED\)\. Screens keep the last prices/)).toBeInTheDocument();
    expect(within(panel).queryByText(/reach your screens/)).not.toBeInTheDocument();
  });

  it('a check that fails (e.g. not an admin) is said plainly — never an endless spinner', async () => {
    boundMenu = new Error('403');
    mount(keptPosZoneConfig());
    const panel = await screen.findByTestId('pos-bound-board-panel');
    await waitFor(() => expect(within(panel).getByText('Couldn\'t check your Toast menu from here. Screens still follow it.')).toBeInTheDocument());
    expect(within(panel).getByText('Bound to Toast — 3 items')).toBeInTheDocument();
  });
});
