/**
 * M0-3 — what the EXTERNAL_HTML sender actually puts on the wire.
 *
 * THE BUG: `ExternalHtmlWidget` forwarded `cfg._styles` VERBATIM. The builder
 * writes BOOLEANS there (`{bold:true, italic:true, underline:true,
 * strikethrough:true}`) and every board shim reads CSS props only, so the
 * operator pressed Bold, the button lit up, and the headline did not move —
 * on 250 packaged boards, in the builder AND on the player (both render
 * through this component).
 *
 * WHY IT MOUNTS. The payload is built inside a `useMemo` in a component
 * chosen at runtime by widget type; a source-level check would prove nothing
 * (CLAUDE.md #9). So this renders through `WidgetPreview` — the exact path
 * BuilderZone and the player use — and decodes the real iframe `src`, which
 * is the byte-for-byte thing a board receives.
 */
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WidgetPreview } from '../WidgetRenderer';

// The board widget probes the gym-media + POS hooks on mount; in jsdom those
// can only stay pending. Same posture as the other builder suites.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

const BOARD = '/templates/hs/achievement.html';
const FIELD = 'hero.title';

/** Decode one base64url query param the shim will decode the same way. */
function decodeParam(src: string, name: string): Record<string, unknown> | null {
  const raw = new URL(src, 'http://localhost').searchParams.get(name);
  if (!raw) return null;
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

function renderBoard(config: Record<string, unknown>): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <WidgetPreview
        widgetType="EXTERNAL_HTML"
        config={{ url: BOARD, ...config }}
        width={100}
        height={100}
      />
    </QueryClientProvider>,
  );
  const frame = container.querySelector('iframe');
  expect(frame).toBeTruthy();
  return frame!.getAttribute('src') || '';
}

describe('EXTERNAL_HTML sender — the builder’s booleans reach the board as CSS', () => {
  it('bold + underline + line-height + alignment all ship as CSS props', () => {
    const src = renderBoard({
      _styles: { [FIELD]: { bold: true, underline: true, lineHeight: 1.4, textAlign: 'center' } },
    });
    expect(decodeParam(src, 'textStyles')).toEqual({
      [FIELD]: {
        fontWeight: 800,
        textDecoration: 'underline',
        lineHeight: 1.4,
        textAlign: 'center',
      },
    });
  });

  it('ships NO boolean aliases — a board shim would silently ignore them', () => {
    const src = renderBoard({
      _styles: { [FIELD]: { bold: true, italic: true, underline: true, strikethrough: true } },
    });
    const sent = decodeParam(src, 'textStyles')![FIELD] as Record<string, unknown>;
    expect(sent).toEqual({
      fontWeight: 800,
      fontStyle: 'italic',
      textDecoration: 'underline line-through',
    });
    for (const alias of ['bold', 'italic', 'underline', 'strikethrough']) {
      expect(Object.prototype.hasOwnProperty.call(sent, alias)).toBe(false);
    }
  });

  it('a numeric fontWeight still wins over bold, all the way to the wire', () => {
    const src = renderBoard({ _styles: { [FIELD]: { bold: true, fontWeight: 300 } } });
    expect(decodeParam(src, 'textStyles')).toEqual({ [FIELD]: { fontWeight: 300 } });
  });

  it('the highlight background and hide-field keys survive the translation', () => {
    const src = renderBoard({
      _styles: { [FIELD]: { backgroundColor: '#fef08a' }, 'hero.dek': { hidden: true } },
    });
    expect(decodeParam(src, 'textStyles')).toEqual({
      [FIELD]: { backgroundColor: '#fef08a' },
      'hero.dek': { hidden: true },
    });
  });

  it('the canonical `textStyles` config key gets the same treatment as `_styles`', () => {
    const src = renderBoard({ textStyles: { [FIELD]: { bold: true } } });
    expect(decodeParam(src, 'textStyles')).toEqual({ [FIELD]: { fontWeight: 800 } });
  });

  it('a board with no style overrides still ships no textStyles param', () => {
    const src = renderBoard({ textOverrides: { [FIELD]: 'Hello' } });
    expect(decodeParam(src, 'textStyles')).toBeNull();
    expect(decodeParam(src, 'text')).toEqual({ [FIELD]: 'Hello' });
  });
});
