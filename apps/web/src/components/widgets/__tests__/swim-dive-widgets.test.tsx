/**
 * Swim/dive sport split (2026-07-01) — flagship widget render-tree proof.
 *
 * CLAUDE.md rule #9 ("VERIFY THE RENDER TREE"): green tsc is not proof a
 * widget actually mounts. This test drives the SAME `WidgetPreview`
 * dispatcher the template builder canvas (`BuilderZone.tsx`) and the live
 * player (`player/page.tsx`) use, so a regression here means the operator
 * would see a blank tile / crash for real, not just a type error.
 *
 * Covers:
 *  - SWIM_LANE_GRID renders a lane grid with a sample heat (builder-tile
 *    "never blank" rule) when there's no live GameStateProvider.
 *  - DIVE_LEADERBOARD renders a sample diver field.
 *  - Both honor operator overrides (headerText) — proves the PropertiesPanel
 *    fields actually reach the render, not just exist in the config schema.
 *  - Neither widget uses the CSS `inset` shorthand (CLAUDE.md rule #10 —
 *    these ship to the player, including Taurus LED installs).
 */

import { render, screen } from '@testing-library/react';
import { WidgetPreview } from '../WidgetRenderer';

// jsdom has no ResizeObserver — the widgets under test use the shared
// useScaleToFit primitive (same as MainScoreboardWidget.tsx), which the
// real browser always has. Polyfill locally so this test file doesn't
// need to touch the shared jest.setup.ts.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

function renderWidget(type: string, config: Record<string, unknown> = {}) {
  return render(
    <div style={{ position: 'relative', width: 800, height: 450 }}>
      <WidgetPreview widgetType={type} config={config} width={100} height={100} live={false} />
    </div>,
  );
}

describe('SWIM_LANE_GRID', () => {
  it('renders the sample heat when no live game is bound (builder tile is never blank)', () => {
    const { container } = renderWidget('SWIM_LANE_GRID');
    expect(container.textContent).toContain('J. RIVERA');
    expect(container.textContent).toContain('LANE');
    expect(container.textContent).toContain('SWIMMER / TEAM');
  });

  it('honors an operator-set header override', () => {
    const { container } = renderWidget('SWIM_LANE_GRID', { headerText: 'EVENT 5 — GIRLS 200 IM' });
    expect(container.textContent).toContain('EVENT 5 — GIRLS 200 IM');
  });

  it('renders DQ marks without crashing', () => {
    const { container } = renderWidget('SWIM_LANE_GRID');
    expect(container.textContent).toContain('DQ');
  });

  it('never uses the inset shorthand (Taurus / Chromium-83 safety)', () => {
    const { container } = renderWidget('SWIM_LANE_GRID');
    const styled = container.querySelectorAll('[style]');
    styled.forEach((el) => {
      const style = (el as HTMLElement).getAttribute('style') || '';
      expect(style).not.toMatch(/inset\s*:/);
    });
  });
});

describe('DIVE_LEADERBOARD', () => {
  it('renders the sample diver field when no live game is bound', () => {
    const { container } = renderWidget('DIVE_LEADERBOARD');
    expect(container.textContent).toContain('A. WASHINGTON');
    expect(container.textContent).toContain('DIVER / TEAM');
    // Diving has no lanes — the word "LANE" must never appear on this board.
    expect(container.textContent).not.toContain('LANE');
  });

  it('honors an operator-set header override', () => {
    const { container } = renderWidget('DIVE_LEADERBOARD', { headerText: 'BOYS 3M FINAL' });
    expect(container.textContent).toContain('BOYS 3M FINAL');
  });

  it('shows the dives-in-list count when configured', () => {
    renderWidget('DIVE_LEADERBOARD', { divesInList: 11 });
    expect(screen.getByText('11 DIVES')).toBeInTheDocument();
  });

  it('never uses the inset shorthand (Taurus / Chromium-83 safety)', () => {
    const { container } = renderWidget('DIVE_LEADERBOARD');
    const styled = container.querySelectorAll('[style]');
    styled.forEach((el) => {
      const style = (el as HTMLElement).getAttribute('style') || '';
      expect(style).not.toMatch(/inset\s*:/);
    });
  });
});
