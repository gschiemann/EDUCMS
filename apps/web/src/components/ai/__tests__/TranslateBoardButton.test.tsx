/**
 * TranslateBoardButton — whole-board localization (2026-07-05, #282).
 * Pins the gating contract (hide when AI off or nothing to translate) and the
 * apply path (POST /ai/translate with ALL translatable zones → onApply(diff)).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TranslateBoardButton } from '../TranslateBoardButton';

const apiFetchMock = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiFetch: (...a: any[]) => apiFetchMock(...a) }));

let aiSource: 'platform' | 'tenant' | 'none' = 'platform';
jest.mock('@/components/ai/AiGenerateButton', () => ({
  getAiStatusSource: () => Promise.resolve(aiSource),
}));

const textZones = [
  { id: 'z1', widgetType: 'TEXT', defaultConfig: { content: 'Welcome' } },
  { id: 'z2', widgetType: 'TEXT', defaultConfig: { content: 'Lunch at noon' } },
];

beforeEach(() => { apiFetchMock.mockReset(); aiSource = 'platform'; });

it('is hidden when AI is not configured', async () => {
  aiSource = 'none';
  const { container } = render(<TranslateBoardButton zones={textZones as any} onApply={() => {}} />);
  // Wait a tick for the async status resolve; button must never appear.
  await waitFor(() => expect(container.querySelector('button')).toBeNull());
});

it('is hidden when the board has no translatable text (HTML / media only)', async () => {
  const noText = [
    { id: 'h1', widgetType: 'EXTERNAL_HTML', defaultConfig: { html: '<div>lots of html here…</div>' } },
    { id: 'i1', widgetType: 'IMAGE', defaultConfig: { fit: 'cover' } },
  ];
  const { container } = render(<TranslateBoardButton zones={noText as any} onApply={() => {}} />);
  await waitFor(() => expect(container.querySelector('button')).toBeNull());
});

it('shows the button + language menu and translates the WHOLE board on pick', async () => {
  apiFetchMock.mockResolvedValue({
    diff: [
      { zoneId: 'z1', patch: { defaultConfig: { content: 'Bienvenidos' } }, summary: ['Translated'] },
      { zoneId: 'z2', patch: { defaultConfig: { content: 'Almuerzo al mediodía' } }, summary: ['Translated'] },
    ],
    translated: 2,
    targetLangLabel: 'Spanish',
  });
  const onApply = jest.fn();
  render(<TranslateBoardButton zones={textZones as any} vertical="k12" onApply={onApply} />);

  const trigger = await screen.findByTitle(/translate every text element/i);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('option', { name: 'Spanish' }));

  await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
  const [url, opts] = apiFetchMock.mock.calls[0];
  expect(url).toBe('/ai/translate');
  const body = JSON.parse(opts.body);
  expect(body.targetLang).toBe('es');
  expect(body.vertical).toBe('k12');
  expect(body.zones.map((z: any) => z.id)).toEqual(['z1', 'z2']); // ALL translatable zones sent

  await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
  expect(onApply.mock.calls[0][0]).toHaveLength(2); // both zones committed
});

it('surfaces a friendly error and does NOT apply when the endpoint fails', async () => {
  apiFetchMock.mockRejectedValue({ status: 429, message: 'hourly limit' });
  const onApply = jest.fn();
  render(<TranslateBoardButton zones={textZones as any} onApply={onApply} />);
  fireEvent.click(await screen.findByTitle(/translate every text element/i));
  fireEvent.click(await screen.findByRole('option', { name: 'Spanish' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/limit/i));
  expect(onApply).not.toHaveBeenCalled();
});
