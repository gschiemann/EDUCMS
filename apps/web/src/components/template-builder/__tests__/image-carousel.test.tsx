/**
 * "images should allow a carousel and not just one image if they want."
 *
 * Every image slot on every board now takes a LIST. The board rotates it
 * (EDUCMS-SHIM-V13, verified in a browser). This covers the editor half,
 * and one property matters more than the rest: a slot with ONE image must
 * still store a plain string, so every board saved before this exists is
 * byte-identical and nothing has to be migrated.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentFields } from '../PropertiesPanel';

jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

const BOARD = `<!doctype html><html><body><main id="stage">
  <div data-imgslot="hero.image"></div>
  <div data-imgslot="scan.qr"></div>
</main></body></html>`;

function mount(cfg: Record<string, unknown> = {}) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(() =>
    Promise.resolve({ ok: true, text: () => Promise.resolve(BOARD) }));
  const updateZone = jest.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ContentFields
        zone={{ id: 'z', widgetType: 'EXTERNAL_HTML', defaultConfig: { url: '/templates/signage/worship/x.html', ...cfg } }}
        updateZone={updateZone}
      />
    </QueryClientProvider>,
  );
  return { updateZone };
}
const lastImgs = (m: jest.Mock) =>
  (m.mock.calls[m.mock.calls.length - 1][1].defaultConfig as Record<string, unknown>).imageOverrides as Record<string, unknown>;

it('an empty slot offers no list controls until it has an image', async () => {
  mount();
  await waitFor(() => expect(screen.getAllByText(/Browse library/i).length).toBeGreaterThan(0));
  expect(screen.queryByText(/Add another image/i)).not.toBeInTheDocument();
});

it('a slot with one image offers to add another', async () => {
  mount({ imageOverrides: { 'hero.image': '/a.jpg' } });
  await waitFor(() => expect(screen.getByText(/Add another image/i)).toBeInTheDocument());
  expect(screen.queryByText(/rotating/i)).not.toBeInTheDocument();
});

it('ONE image is still stored as a plain string — no migration for saved boards', async () => {
  const { updateZone } = mount({ imageOverrides: { 'hero.image': ['/a.jpg', '/b.jpg'] } });
  await waitFor(() => expect(screen.getByLabelText(/Remove image 2/i)).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText(/Remove image 2/i));
  expect(lastImgs(updateZone)['hero.image']).toBe('/a.jpg');
});

it('two or more become a list, and it says how many rotate', async () => {
  mount({ imageOverrides: { 'hero.image': ['/a.jpg', '/b.jpg', '/c.jpg'] } });
  await waitFor(() => expect(screen.getByText(/3 rotating/i)).toBeInTheDocument());
  expect(screen.getByLabelText(/Remove image 2/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/Remove image 3/i)).toBeInTheDocument();
});

it('editing the first image keeps the rest of the list', async () => {
  const { updateZone } = mount({ imageOverrides: { 'hero.image': ['/a.jpg', '/b.jpg'] } });
  await waitFor(() => expect(screen.getByText(/2 rotating/i)).toBeInTheDocument());
  // ControlledUrlInput commits on BLUR, not per keystroke — typing alone
  // never reaches the parent.
  const first = screen.getAllByDisplayValue('/a.jpg')[0];
  fireEvent.change(first, { target: { value: '/z.jpg' } });
  fireEvent.blur(first);
  expect(lastImgs(updateZone)['hero.image']).toEqual(['/z.jpg', '/b.jpg']);
});

it('a QR slot is never offered a carousel — a rotating QR cannot be scanned', async () => {
  mount({ imageOverrides: { 'hero.image': '/a.jpg', 'scan.qr': '/q.png' } });
  await waitFor(() => expect(screen.getAllByText(/Add another image/i).length).toBe(1));
});
