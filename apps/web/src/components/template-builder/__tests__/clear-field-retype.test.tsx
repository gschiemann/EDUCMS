/**
 * "when i delete the last letter of the existing church it puts the
 * entire old name back in, so i can[']t actually delete it all and enter
 * my church name."
 *
 * The input renders `textOverrides[key] ?? defaultText`, and clearing the
 * input used to DELETE the override — so deleting the final character
 * restored the template's copy into both the input and the board. There
 * was no way to reach an empty box.
 *
 * Empty is a value now. Reset is the explicit way back.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentFields } from '../PropertiesPanel';

jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

const BOARD = `<!doctype html><html><body><main id="stage">
  <div data-field="brand.name">HAVEN CHURCH</div>
  <div data-field="brand.location">RIVER CAMPUS</div>
</main></body></html>`;

function mount(defaultConfig: Record<string, unknown> = {}) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(() =>
    Promise.resolve({ ok: true, text: () => Promise.resolve(BOARD) }));
  const updateZone = jest.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ContentFields
        zone={{ id: 'z', widgetType: 'EXTERNAL_HTML', defaultConfig: { url: '/templates/signage/worship/x.html', ...defaultConfig } }}
        updateZone={updateZone}
      />
    </QueryClientProvider>,
  );
  return { updateZone };
}
const lastCfg = (m: jest.Mock) => m.mock.calls[m.mock.calls.length - 1][1].defaultConfig as Record<string, unknown>;
const overrides = (m: jest.Mock) => (lastCfg(m).textOverrides || {}) as Record<string, string>;

it('deleting the last character leaves the field EMPTY, not refilled', async () => {
  const { updateZone } = mount();
  const input = await screen.findByDisplayValue('HAVEN CHURCH');
  fireEvent.change(input, { target: { value: '' } });
  // The override must exist and be empty — deleting it is what resurrected
  // the old name.
  expect(overrides(updateZone)['brand.name']).toBe('');
});

it('the emptied field stays empty in the input instead of snapping back', async () => {
  mount({ textOverrides: { 'brand.name': '' } });
  await waitFor(() => expect(screen.getByDisplayValue('RIVER CAMPUS')).toBeInTheDocument());
  expect(screen.queryByDisplayValue('HAVEN CHURCH')).not.toBeInTheDocument();
});

it('you can then type your own name', async () => {
  const { updateZone } = mount({ textOverrides: { 'brand.name': '' } });
  await waitFor(() => expect(screen.getByDisplayValue('RIVER CAMPUS')).toBeInTheDocument());
  const inputs = screen.getAllByRole('textbox');
  fireEvent.change(inputs[0], { target: { value: 'GRACE FELLOWSHIP' } });
  expect(overrides(updateZone)['brand.name']).toBe('GRACE FELLOWSHIP');
});

it('Reset shows only on a customized field, and puts the template copy back', async () => {
  const { updateZone } = mount({ textOverrides: { 'brand.name': 'GRACE' } });
  const reset = await screen.findByLabelText(/Reset .* to the template text/i);
  // Only the customized field offers it — the untouched one does not.
  expect(screen.getAllByLabelText(/Reset .* to the template text/i)).toHaveLength(1);
  fireEvent.click(reset);
  expect('brand.name' in overrides(updateZone)).toBe(false);
});

it('an untouched board offers no Reset at all', async () => {
  mount();
  await screen.findByDisplayValue('HAVEN CHURCH');
  expect(screen.queryByLabelText(/Reset .* to the template text/i)).not.toBeInTheDocument();
});

it('typing the template text back still clears the override — no no-op entries', async () => {
  const { updateZone } = mount({ textOverrides: { 'brand.name': 'GRACE' } });
  const input = await screen.findByDisplayValue('GRACE');
  fireEvent.change(input, { target: { value: 'HAVEN CHURCH' } });
  expect('brand.name' in overrides(updateZone)).toBe(false);
});
