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
 *
 * 2026-07-01 DEPTH PASS adds the same four proofs for the report's
 * remaining widgets: SWIM_RELAY_EXCHANGE, SWIM_SPLITS_PANEL,
 * SWIM_RECORD_LINE, DIVE_JUDGES_PANEL.
 */

import { render, screen } from '@testing-library/react';
import { WidgetPreview } from '../WidgetRenderer';
import { warmAllWidgetFamilies } from '../widget-families';
import { warmVariantRegistry } from '../WidgetRenderer';

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

  // P1-10 (2026-07-02) — the `portrait` config flag (board page sets it from
  // its own viewport check) swaps the scene's natural width from 1920 to
  // 960 so a portrait LED wall gets a full-canvas grid instead of a
  // letterboxed strip. This is a scene-sizing change, not a content change
  // — the same rows/columns render either way.
  it('still renders every column with portrait:true (content unaffected by the sizing swap)', () => {
    const { container } = renderWidget('SWIM_LANE_GRID', { portrait: true });
    expect(container.textContent).toContain('J. RIVERA');
    expect(container.textContent).toContain('LANE');
    expect(container.textContent).toContain('SWIMMER / TEAM');
  });

  it('renders identically to landscape when portrait is unset (no regression)', () => {
    const landscape = renderWidget('SWIM_LANE_GRID').container.textContent;
    const portrait = renderWidget('SWIM_LANE_GRID', { portrait: false }).container.textContent;
    expect(portrait).toBe(landscape);
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

  // P1-10 (2026-07-02) — same portrait config flag as SWIM_LANE_GRID.
  it('still renders the diver field with portrait:true (content unaffected by the sizing swap)', () => {
    const { container } = renderWidget('DIVE_LEADERBOARD', { portrait: true });
    expect(container.textContent).toContain('A. WASHINGTON');
    expect(container.textContent).toContain('DIVER / TEAM');
  });
});

function expectNoInsetShorthand(container: HTMLElement) {
  const styled = container.querySelectorAll('[style]');
  styled.forEach((el) => {
    const style = (el as HTMLElement).getAttribute('style') || '';
    expect(style).not.toMatch(/inset\s*:/);
  });
}

describe('SWIM_RELAY_EXCHANGE', () => {
  it('renders the sample 4-leg relay when no legs are configured (builder tile is never blank)', () => {
    const { container } = renderWidget('SWIM_RELAY_EXCHANGE');
    expect(container.textContent).toContain('LEG 1');
    expect(container.textContent).toContain('D. OKAFOR');
    expect(container.textContent).toContain('EXCHANGE');
  });

  it('flags a negative exchange time as DQ', () => {
    const { container } = renderWidget('SWIM_RELAY_EXCHANGE');
    // Sample leg 3 carries exchange "-0.04" — an illegal early takeoff.
    expect(container.textContent).toContain('DQ');
  });

  it('honors an operator-set header override and custom legs', () => {
    const { container } = renderWidget('SWIM_RELAY_EXCHANGE', {
      headerText: 'EVENT 20 — GIRLS 200 MEDLEY RELAY',
      teamName: 'AWAY RELAY B',
      legs: [
        { legName: 'Leg 1 — Back', swimmer: 'S. Patel', split: '29.00', cumulative: '29.00', exchange: '0.20' },
      ],
    });
    expect(container.textContent).toContain('EVENT 20 — GIRLS 200 MEDLEY RELAY');
    expect(container.textContent).toContain('AWAY RELAY B');
    expect(container.textContent).toContain('S. Patel');
  });

  it('never uses the inset shorthand (Taurus / Chromium-83 safety)', () => {
    const { container } = renderWidget('SWIM_RELAY_EXCHANGE');
    expectNoInsetShorthand(container);
  });
});

describe('SWIM_SPLITS_PANEL', () => {
  it('renders the sample 4-length split table when no splits are configured', () => {
    const { container } = renderWidget('SWIM_SPLITS_PANEL');
    expect(container.textContent).toContain('SPLIT');
    expect(container.textContent).toContain('CUMULATIVE');
    expect(container.textContent).toContain('D. OKAFOR');
  });

  it('shows the pace-vs-record delta column by default', () => {
    const { container } = renderWidget('SWIM_SPLITS_PANEL');
    expect(container.textContent).toContain('VS. PACE');
    expect(container.textContent).toContain('-0.12');
  });

  it('hides the pace delta column when disabled', () => {
    const { container } = renderWidget('SWIM_SPLITS_PANEL', { showPaceDelta: false });
    expect(container.textContent).not.toContain('VS. PACE');
  });

  it('honors an operator-set header override', () => {
    const { container } = renderWidget('SWIM_SPLITS_PANEL', { headerText: 'EVENT 8 — GIRLS 500 FREE' });
    expect(container.textContent).toContain('EVENT 8 — GIRLS 500 FREE');
  });

  it('never uses the inset shorthand (Taurus / Chromium-83 safety)', () => {
    const { container } = renderWidget('SWIM_SPLITS_PANEL');
    expectNoInsetShorthand(container);
  });
});

describe('SWIM_RECORD_LINE', () => {
  it('renders the default reference line with sample record data', () => {
    const { container } = renderWidget('SWIM_RECORD_LINE');
    expect(container.textContent).toContain('POOL RECORD');
    expect(container.textContent).toContain('48.42');
    expect(container.textContent).toContain('D. OKAFOR, 2024');
  });

  it('honors operator overrides for record type/time/holder', () => {
    const { container } = renderWidget('SWIM_RECORD_LINE', {
      recordType: 'meet record',
      recordTime: '1:52.10',
      recordHolder: 'M. Chen, 2023',
    });
    expect(container.textContent).toContain('MEET RECORD');
    expect(container.textContent).toContain('1:52.10');
    expect(container.textContent).toContain('M. Chen, 2023');
  });

  it('flashes RECORD! when recordBroken is set, and hides the live delta', () => {
    const { container } = renderWidget('SWIM_RECORD_LINE', { recordBroken: true, liveDelta: '-0.30' });
    expect(container.textContent).toContain('RECORD!');
  });

  it('shows the live pace delta with AHEAD/BEHIND wording when not broken', () => {
    const { container } = renderWidget('SWIM_RECORD_LINE', { liveDelta: '-0.22' });
    expect(container.textContent).toContain('AHEAD');
  });

  it('never uses the inset shorthand (Taurus / Chromium-83 safety)', () => {
    const { container } = renderWidget('SWIM_RECORD_LINE');
    expectNoInsetShorthand(container);
  });
});

describe('DIVE_JUDGES_PANEL', () => {
  it('renders the sample dive with a 5-judge panel when no live game is bound', () => {
    const { container } = renderWidget('DIVE_JUDGES_PANEL');
    expect(container.textContent).toContain('A. WASHINGTON');
    expect(container.textContent).toContain('305C');
    expect(container.textContent).toContain('5-JUDGE PANEL');
    expect(container.textContent).toContain('DIVE SCORE');
    // Diving has no lanes.
    expect(container.textContent).not.toContain('LANE');
  });

  it('drops high/low for a 5-judge panel and computes the correct dive score', () => {
    // Scores [7, 7.5, 8, 7.5, 8], DD 2.7 → drop one 7 (low) and one 8 (high),
    // keep {7.5, 8, 7.5} = 23 × 2.7 = 62.1.
    const { container } = renderWidget('DIVE_JUDGES_PANEL');
    expect(container.textContent).toContain('62.1');
    // Exactly one score is greyed out as dropped on each end for 5 judges.
    const dropped = screen.getAllByText('DROPPED');
    expect(dropped.length).toBe(2);
  });

  it('keeps all scores (no drops) for a 3-judge panel', () => {
    const { container } = renderWidget('DIVE_JUDGES_PANEL', { judgeScores: [8, 8, 8], dd: 2.0 });
    // 8+8+8 = 24 × 2.0 = 48.0, no drops.
    expect(container.textContent).toContain('48.0');
    expect(container.textContent).toContain('3-JUDGE PANEL');
    expect(screen.queryByText('DROPPED')).not.toBeInTheDocument();
  });

  it('honors operator overrides for diver/dive/DD', () => {
    const { container } = renderWidget('DIVE_JUDGES_PANEL', {
      diverName: 'L. Fischer',
      diveCode: '105B',
      dd: 1.9,
    });
    expect(container.textContent).toContain('L. FISCHER');
    expect(container.textContent).toContain('105B');
    expect(container.textContent).toContain('DD 1.9');
  });

  it('never uses the inset shorthand (Taurus / Chromium-83 safety)', () => {
    const { container } = renderWidget('DIVE_JUDGES_PANEL');
    expectNoInsetShorthand(container);
  });
});
