/**
 * Templates Gallery — Calm v1 · §4.5 / §6.2, the frozen thumbnail.
 *
 * "The gallery thumbnail should be static or frozen. Live clocks,
 * animations, videos and external HTML should activate only in the
 * full-screen preview."
 *
 * This matters at catalog scale, not on one card. The tenant catalog is
 * ~114 boards; before poster PNGs landed, the grid mounted that many live
 * sandboxed 4K iframes, each with a clock setInterval, keyframe
 * animations and a scrolling ticker, and the browser showed "page
 * unresponsive". The freeze is therefore a THREE-part mechanism, and this
 * suite asserts each part separately because each one has failed alone:
 *
 *   1. an EXTERNAL_HTML board resolves to a static <img> poster — no
 *      document, no process, no iframe;
 *   2. a live frame (the fallback, and the full-screen preview) carries
 *      ?freeze=1 so the board's baked shim renders one auto-fit frame
 *      and then kills its own timers;
 *   3. a zone-based template's stage carries data-tpl-frozen, the hook
 *      globals.css uses to stop every widget's CSS keyframes at once.
 *
 * And the negative half, which is what keeps the preview honest: the
 * full-screen modal passes freeze={false} and must get NONE of it.
 */

import { render, waitFor } from '@testing-library/react';

// Stand in for the widget catalog. The freeze contract we care about is
// what ScaledTemplateThumbnail HANDS DOWN — mounting the real 40-theme
// renderer to observe one boolean would make this suite slow and would
// test WidgetRenderer, not the thumbnail.
jest.mock('@/components/widgets/WidgetRenderer', () => ({
  WidgetPreview: (props: { widgetType: string; freeze?: boolean; live?: boolean }) => (
    <div
      data-testid="widget-stub"
      data-widget-type={props.widgetType}
      data-freeze={String(!!props.freeze)}
      data-live={String(!!props.live)}
    />
  ),
}));

import { ScaledTemplateThumbnail } from '../ScaledTemplateThumbnail';

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

const boardZone = {
  id: 'z1',
  widgetType: 'EXTERNAL_HTML',
  x: 0, y: 0, width: 100, height: 100,
  defaultConfig: { url: '/templates/hs/front-desk-welcome.html' },
};

const clockZone = {
  id: 'z2',
  widgetType: 'CLOCK',
  x: 0, y: 0, width: 100, height: 100,
  defaultConfig: {},
};

function mount(zones: any[], freeze: boolean) {
  return render(
    <ScaledTemplateThumbnail
      zones={zones}
      screenWidth={1920}
      screenHeight={1080}
      maxHeight={144}
      freeze={freeze}
    />,
  );
}

describe('§6.2 — a frozen board thumbnail is a static image, not a live document', () => {
  it('renders an <img> poster and NO iframe', () => {
    const { container } = mount([boardZone], true);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toMatch(/\/templates\/_thumbs\/hs\/front-desk-welcome\.png/);
    // The whole point: no board document is instantiated for a card.
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('the poster is lazily loaded and non-interactive', () => {
    const { container } = mount([boardZone], true);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('loading')).toBe('lazy');
    // Decorative: the wrapping preview control carries the accessible
    // name ("Preview of <name> template"), so the artwork inside must not
    // be announced a second time (§14).
    expect(img.getAttribute('alt')).toBe('');
  });

  it('a CUSTOMIZED board falls back to a real render — carrying freeze', async () => {
    // A board with brand/text overrides can't use the pristine poster:
    // it would mask the operator's own customization ("apply brand did
    // nothing"). So it renders for real — but still frozen, which the
    // board's baked shim turns into ?freeze=1 (one auto-fit frame, then
    // its own timers die).
    const customized = {
      ...boardZone,
      defaultConfig: { url: '/templates/hs/front-desk-welcome.html', brand: { primary: '#3515e8' } },
    };
    const { container, findByTestId } = mount([customized], true);
    expect(container.querySelector('img')).toBeNull();
    const stub = await findByTestId('widget-stub');
    expect(stub).toHaveAttribute('data-widget-type', 'EXTERNAL_HTML');
    expect(stub).toHaveAttribute('data-freeze', 'true');
  });
});

describe('§6.2 — a frozen ZONE template stops its widgets\' animations', () => {
  it('marks the stage with the data-tpl-frozen hook globals.css keys off', () => {
    const { container } = mount([clockZone], true);
    expect(container.querySelector('[data-tpl-frozen="1"]')).toBeTruthy();
  });

  it('a clock in the grid is mounted frozen and NOT live', async () => {
    const { findByTestId } = mount([clockZone], true);
    const stub = await findByTestId('widget-stub');
    expect(stub).toHaveAttribute('data-freeze', 'true');
    expect(stub).toHaveAttribute('data-live', 'false');
  });

  it('the un-frozen render (the full-screen preview) carries no freeze marker', () => {
    const { container } = mount([clockZone], false);
    expect(container.querySelector('[data-tpl-frozen="1"]')).toBeNull();
  });
});

describe('§8.4 — the full-screen preview is never frozen', () => {
  it('an un-frozen board takes no poster shortcut and is not frozen', async () => {
    const { container, findByTestId } = mount([boardZone], false);
    expect(container.querySelector('img')).toBeNull();
    const stub = await findByTestId('widget-stub');
    expect(stub).toHaveAttribute('data-widget-type', 'EXTERNAL_HTML');
    expect(stub).toHaveAttribute('data-freeze', 'false');
  });

  it('an un-frozen zone template renders its widgets un-frozen too', async () => {
    const { findByTestId } = mount([clockZone], false);
    await waitFor(() => expect(findByTestId('widget-stub')).resolves.toBeTruthy());
    const stub = await findByTestId('widget-stub');
    expect(stub).toHaveAttribute('data-freeze', 'false');
  });
});
