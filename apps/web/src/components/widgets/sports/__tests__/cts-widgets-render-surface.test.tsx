/**
 * task #290 (2026-07-03) — CTS widget fake-data-on-real-surfaces guard.
 *
 * Root bug (docs/research/2026-07-02-sports-deep-pass/03-S2-REPORT.md,
 * "OUT-OF-SCOPE FOUND"): CtsScoreboard.tsx and CtsRibbonWidgets.tsx keyed
 * their SAMPLE-vs-NEUTRAL choice off the generic `live` boolean prop that
 * `WidgetRenderer.WidgetPreviewInner` threads into every widget (gates
 * video autoplay, carousel rotation, etc). That prop is ALSO `true` on
 * `TemplatePreviewModal` (the builder's fullscreen "what does this look
 * like on a TV?" preview — deliberately `live={true}` so videos/carousels
 * run) and `AppConfigForm`'s config-preview pane — neither of which is a
 * real screen with CTS hardware attached. So a builder-only preview could
 * paint the fabricated SAMPLE score (CtsScoreboard: 1-0 / 7:42 / Q3;
 * CtsRibbonWidgets: 4-3) as if it were live game data.
 *
 * The fix mirrors Sports Wave S2's shipped pattern (GameStateContext.tsx's
 * `RenderSurfaceContext` / `useRenderSurface()`, see
 * sports-render-surface.test.tsx for the S2 proofs on MainScoreboardWidget
 * / SwimDiveWidgets): CtsScoreboard + CtsRibbonWidgets' `useCtsGameState`
 * now require BOTH signals — `renderSurface === 'player'` (set ONLY by
 * player/page.tsx + TouchOverlay.tsx) AND the caller's `live` prop truthy
 * — before treating "no bridge event yet" as "render the neutral dash."
 *
 * These proofs specifically exercise the MISMATCHED cases the old code
 * got wrong:
 *   - renderSurface unset (builder default) + live=true  → SAMPLE (this
 *     is exactly the TemplatePreviewModal shape — the bug this closes).
 *   - renderSurface="player" + live=true + no feed        → NEUTRAL.
 *   - renderSurface="player" + live=false                 → SAMPLE (the
 *     `isLiveSurface` guard still requires the caller's live flag too,
 *     matching the pre-existing `cfg.preview` escape hatch semantics).
 */

import { render, screen } from '@testing-library/react';
import { WidgetPreview } from '../../WidgetRenderer';
// Side-effecting import registers 'scoreboard-cts-ribbon' + the composable
// CTS tile variants into the variants.ts Map — same convention
// sports-render-surface.test.tsx uses for 'scoreboard-main' (CLAUDE.md
// rule #9: without this, `config.variant` resolves to nothing and
// WidgetPreview silently falls through to the generic non-sport
// ScoreboardWidget, hiding the very regression this suite guards).
import '../../variants-register';
import { warmAllWidgetFamilies } from '../../widget-families';
import { warmVariantRegistry } from '../../WidgetRenderer';

// jsdom has no ResizeObserver — both CTS widget files use it for their
// scale-to-fit / measured-height primitives (same polyfill pattern as
// swim-dive-widgets.test.tsx / sports-render-surface.test.tsx).
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

function renderCts(
  variant: string,
  config: Record<string, unknown> = {},
  opts: { renderSurface?: 'player'; live?: boolean } = {},
) {
  return render(
    <div style={{ position: 'relative', width: 800, height: 300 }}>
      <WidgetPreview
        widgetType="SCOREBOARD"
        config={{ variant, ...config }}
        width={100}
        height={100}
        live={opts.live}
        renderSurface={opts.renderSurface}
      />
    </div>,
  );
}

// P1-1 (2026-09-03) — widget families load from their own chunks now, so a
// proxy renders `null` until its chunk resolves. These suites render a widget
// and assert on its DOM in the same tick; warming the families first makes the
// proxies render their real component on FIRST render, exactly as on a warmed
// screen. Without this the assertions below would run against an empty
// container — a false green, not a pass.
beforeAll(async () => {
  await warmAllWidgetFamilies();
  await warmVariantRegistry();
});

describe('task #290 — CtsScoreboard (all-in-one ribbon tile)', () => {
  it('TemplatePreviewModal shape (renderSurface unset, live=true) renders the alive SAMPLE, never a neutral dash', () => {
    renderCts('scoreboard-cts-ribbon', {}, { live: true });
    // SAMPLE: clock 7:42, score 1-0 (rendered "01"/"00"), exclusion #7.
    expect(screen.getByText('7:42')).toBeInTheDocument();
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('00')).toBeInTheDocument();
    expect(screen.queryByText('—:—')).not.toBeInTheDocument();
  });

  it('AppConfigForm shape (renderSurface unset, live=false) also renders the alive SAMPLE', () => {
    renderCts('scoreboard-cts-ribbon', {}, {});
    expect(screen.getByText('7:42')).toBeInTheDocument();
    expect(screen.queryByText('—:—')).not.toBeInTheDocument();
  });

  it('real player surface with no bridge feed yet (renderSurface="player", live=true) renders NEUTRAL, never the fabricated SAMPLE', () => {
    renderCts('scoreboard-cts-ribbon', {}, { renderSurface: 'player', live: true });
    expect(screen.getByText('—:—')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('7:42')).not.toBeInTheDocument();
    // The fabricated exclusion (#7, 12s) must never appear on a real
    // screen with no feed.
    expect(screen.queryByText(/EXCL #7/)).not.toBeInTheDocument();
  });

  it('real player surface but live=false (e.g. a paused preview of the player route) still shows SAMPLE — isLiveSurface requires BOTH signals', () => {
    renderCts('scoreboard-cts-ribbon', {}, { renderSurface: 'player', live: false });
    expect(screen.getByText('7:42')).toBeInTheDocument();
  });

  it('cfg.preview still force-shows SAMPLE even on a real player surface', () => {
    renderCts('scoreboard-cts-ribbon', { preview: true }, { renderSurface: 'player', live: true });
    expect(screen.getByText('7:42')).toBeInTheDocument();
  });
});

describe('task #290 — CtsRibbonWidgets composable tiles', () => {
  describe('Clock (CTS)', () => {
    it('builder preview shape (live=true, no renderSurface) shows the SAMPLE clock', () => {
      renderCts('scoreboard-cts-clock', {}, { live: true });
      expect(screen.getByText('7:42')).toBeInTheDocument();
    });

    it('real player, no feed yet: shows the neutral clock dash, never 7:42', () => {
      renderCts('scoreboard-cts-clock', {}, { renderSurface: 'player', live: true });
      expect(screen.getByText('—:—')).toBeInTheDocument();
      expect(screen.queryByText('7:42')).not.toBeInTheDocument();
    });
  });

  describe('Score H-A (CTS)', () => {
    it('builder preview shape (live=true, no renderSurface) shows the SAMPLE score 04-03', () => {
      renderCts('scoreboard-cts-score', {}, { live: true });
      expect(screen.getByText('04')).toBeInTheDocument();
      expect(screen.getByText('03')).toBeInTheDocument();
    });

    it('real player, no feed yet: shows dashes, never the fabricated 04-03', () => {
      renderCts('scoreboard-cts-score', {}, { renderSurface: 'player', live: true });
      expect(screen.getAllByText('—').length).toBe(2);
      expect(screen.queryByText('04')).not.toBeInTheDocument();
      expect(screen.queryByText('03')).not.toBeInTheDocument();
    });
  });

  describe('Active Exclusion (CTS)', () => {
    it('builder preview shape shows the fabricated #7 exclusion', () => {
      renderCts('scoreboard-cts-exclusion', {}, { live: true });
      expect(screen.getByText('#7')).toBeInTheDocument();
    });

    it('real player, no feed yet: shows "NO PENALTY", never a fabricated jersey number', () => {
      renderCts('scoreboard-cts-exclusion', {}, { renderSurface: 'player', live: true });
      expect(screen.getByText('NO PENALTY')).toBeInTheDocument();
      expect(screen.queryByText('#7')).not.toBeInTheDocument();
    });
  });

  describe('Shot Clock (CTS)', () => {
    it('builder preview shape shows the fabricated "24"', () => {
      renderCts('scoreboard-cts-shot-clock', {}, { live: true });
      expect(screen.getByText('24')).toBeInTheDocument();
    });

    it('real player, no feed yet: parked dash, never the fabricated "24"', () => {
      renderCts('scoreboard-cts-shot-clock', {}, { renderSurface: 'player', live: true });
      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.queryByText('24')).not.toBeInTheDocument();
    });
  });
});

function expectNoInsetOrGapShorthand(container: HTMLElement) {
  const styled = container.querySelectorAll('[style]');
  styled.forEach((el) => {
    const style = (el as HTMLElement).getAttribute('style') || '';
    expect(style).not.toMatch(/inset\s*:/);
    expect(style).not.toMatch(/(?<![\w-])gap\s*:/);
  });
}

describe('task #290 — Chromium-83 / Taurus safety (CLAUDE.md rule #10)', () => {
  it('the CtsScoreboard neutral render never uses inset/gap shorthand', () => {
    const { container } = renderCts('scoreboard-cts-ribbon', {}, { renderSurface: 'player', live: true });
    expectNoInsetOrGapShorthand(container);
  });

  it('the CtsRibbonWidgets neutral renders never use inset/gap shorthand', () => {
    const { container: c1 } = renderCts('scoreboard-cts-clock', {}, { renderSurface: 'player', live: true });
    expectNoInsetOrGapShorthand(c1);
    const { container: c2 } = renderCts('scoreboard-cts-exclusion', {}, { renderSurface: 'player', live: true });
    expectNoInsetOrGapShorthand(c2);
  });
});
