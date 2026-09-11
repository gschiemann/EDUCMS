/**
 * Variant fallback integrity (2026-09-11).
 *
 * THE BUG CLASS THIS PINS: a zone's `config.variant` is the operator's
 * CHOICE, persisted on the TemplateZone. When the registry could not resolve
 * it, WidgetRenderer rendered a DIFFERENT widget and said nothing —
 * `<WidgetPreview widgetType="CLOCK" config={{variant:'totally-made-up-id'}}/>`
 * produced an ordinary clock, no error, no signal. On signage that is the
 * whole failure: nobody is looking at the screen to notice that the style
 * they picked is not the one playing.
 *
 * The substitution itself stays — a blank wall screen is worse than a
 * stand-in, and the player rules say a degraded path degrades, never blanks.
 * What these tests pin is that it stops MASQUERADING:
 *   - it logs, every time, naming the id that was lost;
 *   - it never rewrites the saved variant id to something nobody chose;
 *   - the BUILDER is told (corner badge) and the PLAYER is not (no chrome on
 *     a wall display, and nobody there to read it).
 */
import { render, screen } from '@testing-library/react';
import { WidgetPreview, warmVariantRegistry } from '../WidgetRenderer';
import { warmAllWidgetFamilies } from '../widget-families';
import { listVariants, type WidgetVariant } from '../variants';

// Chunked widget families + the variant registry render `null` until armed;
// asserting in the same tick without warming them is a false green, not a
// pass (see cts-widgets-render-surface.test.tsx).
beforeAll(async () => {
  await warmAllWidgetFamilies();
  await warmVariantRegistry();
});

let errorSpy: jest.SpyInstance;
beforeEach(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

function renderZone(
  widgetType: string,
  config: Record<string, unknown>,
  opts: { live?: boolean; freeze?: boolean; onConfigChange?: (p: Record<string, any>) => void } = {},
) {
  return render(
    <div style={{ position: 'relative', width: 400, height: 300 }}>
      <WidgetPreview widgetType={widgetType} config={config} width={50} height={50} {...opts} />
    </div>,
  );
}

const BADGE = 'Missing style';

describe('unknown variant id — the builder is told what it is looking at', () => {
  it('still renders the type default (never a blank zone) but marks it as a substitute', () => {
    renderZone('CLOCK', { variant: 'totally-made-up-id' }, { live: false });
    // The clock is there — graceful, unchanged.
    expect(document.body.textContent).not.toBe('');
    // …and it does not claim to be the style that was picked.
    expect(screen.getByText(BADGE)).toBeInTheDocument();
    expect(screen.getByTitle(/totally-made-up-id/)).toBeInTheDocument();
  });

  it('logs the lost id loudly', () => {
    renderZone('CLOCK', { variant: 'another-made-up-id' }, { live: false });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('another-made-up-id'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SUBSTITUTE'));
  });

  it('never rewrites the saved variant id', () => {
    // onConfigChange is the ONLY path from a render back to the database. A
    // substitution must not travel down it: the saved id is the only surviving
    // record of what the operator asked for.
    const onConfigChange = jest.fn();
    renderZone('CLOCK', { variant: 'third-made-up-id' }, { live: false, onConfigChange });
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it('does not badge a REGISTERED variant (no false positives on the happy path)', () => {
    const known = listVariants({ widgetType: 'CLOCK' }).find((v) => !v.previewOnly && v.render);
    expect(known).toBeDefined();
    renderZone('CLOCK', { variant: known!.id }, { live: false });
    expect(screen.queryByText(BADGE)).not.toBeInTheDocument();
  });

  it('does not badge a previewOnly variant — that fallthrough is the documented design', () => {
    const previewOnly = listVariants().find((v) => v.previewOnly);
    expect(previewOnly).toBeDefined();
    renderZone(String(previewOnly!.widgetType), { variant: previewOnly!.id }, { live: false });
    expect(screen.queryByText(BADGE)).not.toBeInTheDocument();
  });
});

describe('unknown variant id — the player gets content, not chrome', () => {
  it('renders the substitute with no badge on a live screen', () => {
    renderZone('CLOCK', { variant: 'made-up-on-the-player' }, { live: true });
    expect(screen.queryByText(BADGE)).not.toBeInTheDocument();
    // Still logged: the screen has nobody to tell, the console does.
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('made-up-on-the-player'));
  });

  it('renders no badge on a frozen gallery thumbnail (the grid is a picture, not an editor)', () => {
    renderZone('CLOCK', { variant: 'made-up-in-the-gallery' }, { live: false, freeze: true });
    expect(screen.queryByText(BADGE)).not.toBeInTheDocument();
  });
});

describe('canonical-only type with a lost variant — the substitute is not stamped', () => {
  // These types (RETAIL, WORSHIP, CORPORATE, …) have no single hard-coded
  // renderer: every tile registers under the canonical type and is selected by
  // cfg.variant. When the variant is gone, WidgetTypeDispatch resolves the
  // first registered variant and renders it. It used to hand that substitute
  // `variant: <substitute id>` — a config asserting the operator had picked
  // it. Nothing persisted that today, but one refactor from patch-writes to
  // whole-config writes would have laundered it into the database.
  const CANONICAL = 'RETAIL';
  let sub: WidgetVariant;
  let realRender: WidgetVariant['render'];
  const seen: any[] = [];

  beforeEach(() => {
    const candidates = listVariants({ widgetType: CANONICAL });
    sub = (candidates.find((v) => !v.previewOnly && v.render) || candidates[0])!;
    expect(sub).toBeDefined();
    realRender = sub.render;
    seen.length = 0;
    // The registry hands out live object references, so this swaps the exact
    // component the renderer is about to pick. Restored below.
    sub.render = ((props: any) => { seen.push(props.config); return <div data-testid="sub" />; }) as any;
  });
  afterEach(() => { sub.render = realRender; });

  it('hands the substitute the operator\'s own variant value, never the substitute\'s id', () => {
    renderZone(CANONICAL, { variant: 'a-retail-tile-that-was-removed' }, { live: true });
    expect(screen.getByTestId('sub')).toBeInTheDocument();
    expect(seen).toHaveLength(1);
    expect(seen[0].variant).toBe('a-retail-tile-that-was-removed');
    expect(seen[0].variant).not.toBe(sub.id);
  });

  it('leaves variant undefined when the zone never had one', () => {
    renderZone(CANONICAL, {}, { live: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].variant).toBeUndefined();
  });

  it('badges the no-variant case in the builder only', () => {
    renderZone(CANONICAL, {}, { live: false });
    expect(screen.getByText(BADGE)).toBeInTheDocument();
  });

  it('does not stack two badges when the id is unknown (VariantDispatch owns that one)', () => {
    renderZone(CANONICAL, { variant: 'gone-missing' }, { live: false });
    expect(screen.getAllByText(BADGE)).toHaveLength(1);
  });
});
