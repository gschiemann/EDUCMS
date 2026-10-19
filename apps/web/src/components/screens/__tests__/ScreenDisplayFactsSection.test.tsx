/**
 * Render-level proof of the "Panel and playback pacing" section: what the
 * operator READS for a real native report, in the real English catalogue — and
 * that a screen with no native report gets no box at all.
 *
 * Every fixture is made up. The rules themselves are pinned in
 * displayFacts.test.ts; this proves they reach the page, and that the page
 * stays facts-only (nothing to click).
 */
import * as React from 'react';
import { render, screen as rtl, within } from '@testing-library/react';
import { ScreenDisplayFactsSection } from '../ScreenDisplayFactsSection';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const TWO_MIN_AGO = new Date(NOW - 120_000).toISOString();

const buckets = (): number[] => {
  const b = new Array<number>(16).fill(0);
  b[2] = 4; b[4] = 41_191; b[5] = 5; b[8] = 3;
  return b;
};

const native = (over: Record<string, unknown> = {}) => ({
  version: 1,
  state: 'presenting',
  at: TWO_MIN_AGO,
  evidence: 'surface-render-callback',
  timing: {
    decodedFrames: 41_210, submittedFrames: 41_203, lateFrames: 143, lastLateUs: 120, maxLateUs: 4_100,
    maxSubmitGapMs: 96, leadUs: 66_666, sourceWidth: 3840, sourceHeight: 2160,
    droppedFrames: 0, sourceFps: 30, refreshRate: 30, displayMode: '1:3840x2160@30.00',
    intervalUnitNs: 8_333_333, intervalBuckets: buckets(), intervalCount: 41_203,
    supportedModes: ['1:3840x2160@30.00'], keepScreenOn: false,
    snappedFrames: 41_000, snapErrorMeanUs: 9, snapErrorMaxUs: 120, vsyncPeriodUs: 16_666, vsyncSamples: 1_204, clockSlewUs: -3_200,
  },
  experiments: {
    requested: { vsyncSnap: true, webviewInvisible: true, prefer60hz: true },
    applied: { webviewInvisible: true, vsyncSnap: true, prefer60hz: 'no-60hz-mode' },
    guard: { disabled: {}, applied: {} },
  },
  ...over,
});

const screenWith = (n: Record<string, unknown>) => ({ lastVideoReport: { url: 'https://example.test/a.mp4', native: n } });

const renderSection = (screen: { lastVideoReport?: unknown } | null | undefined) =>
  render(<ScreenDisplayFactsSection screen={screen} now={NOW} />);

describe('<ScreenDisplayFactsSection />', () => {
  describe('no native report → no box', () => {
    it.each([
      ['no screen', null],
      ['a screen with no report', {}],
      ['a null report', { lastVideoReport: null }],
      ['an HTML-only sample (a web player, or before the native engine)', { lastVideoReport: { url: 'https://example.test/a.mp4', totalFrames: 900, droppedFrames: 3 } }],
      ['an empty native block', screenWith({})],
      ['a native block with nothing this section reads', screenWith({ version: 1, state: 'presenting', at: TWO_MIN_AGO })],
    ])('%s renders nothing at all', (_name, screen) => {
      const { container } = renderSection(screen as never);
      expect(container.firstChild).toBeNull();
      expect(rtl.queryByTestId('display-facts-section')).not.toBeInTheDocument();
    });
  });

  it('cannot take the drawer down: a report that blows up when it is read renders nothing, and does not throw', () => {
    const hostile = { lastVideoReport: { get native(): never { throw new Error('boom'); } } };
    expect(() => renderSection(hostile)).not.toThrow();
    expect(rtl.queryByTestId('display-facts-section')).not.toBeInTheDocument();
  });

  describe('the 4K / 30 Hz reading', () => {
    beforeEach(() => { renderSection(screenWith(native())); });

    it('is a labelled section with the plain title, its source and its age', () => {
      const section = rtl.getByTestId('display-facts-section');
      expect(within(section).getByRole('heading', { name: 'Panel and playback pacing' })).toBeInTheDocument();
      expect(section).toHaveAttribute('aria-labelledby');
      expect(rtl.getByTestId('display-facts-provenance').textContent).toBe('From the player’s last native video report, 2 minutes ago.');
    });

    it('panel: the active mode, the honest 60 Hz line, the modes it lists', () => {
      const row = rtl.getByTestId('display-facts-panel');
      expect(row.textContent).toContain('Panel mode');
      expect(row.textContent).toContain('3840×2160 at 30 Hz');
      expect(row.textContent).toContain('No 60 Hz mode offered at 3840×2160.');
      expect(row.textContent).toContain('Modes offered: 3840×2160 at 30 Hz');
      expect(row.textContent).not.toMatch(/cannot|can’t|unable/i);
    });

    it('cadence: the share, late, dropped and the longest gap on one line', () => {
      const row = rtl.getByTestId('display-facts-cadence');
      expect(row.textContent).toContain('99.97 % on cadence · 143 late · 0 dropped · max gap 96 ms');
      expect(row.textContent).toContain('±4 ms of the 33.3 ms source frame period');
    });

    it('experiments: each in plain words', () => {
      const row = rtl.getByTestId('display-facts-experiments');
      expect(row.textContent).toContain('Vsync snap: on, locked to a 16.67 ms vsync grid (error 9 µs mean, 120 µs max)');
      expect(row.textContent).toContain('WebView hidden: requested, applied');
      expect(row.textContent).toContain('60 Hz mode: requested, no 60 Hz mode offered');
    });

    it('keep-screen-on: as of the last report', () => {
      expect(rtl.getByTestId('display-facts-keepScreenOn').textContent).toContain('The player window did not hold keep-screen-on at the last report.');
    });

    it('rows are stacked label-over-value (a description list), in a fixed order', () => {
      const section = rtl.getByTestId('display-facts-section');
      const terms = [...section.querySelectorAll('dt')].map((el) => el.textContent);
      expect(terms).toEqual(['Panel mode', 'Frame cadence', 'Experiments on this screen', 'Keep screen on']);
      expect(section.querySelectorAll('dd')).toHaveLength(4);
    });

    it('is facts only: nothing to click, type into or focus', () => {
      const section = rtl.getByTestId('display-facts-section');
      expect(section.querySelectorAll('button, a, input, select, textarea, summary, [role="button"], [role="link"], [tabindex]')).toHaveLength(0);
    });

    it('draws no blur, and leaves the mobile-perf standard nothing to flag', () => {
      expect(rtl.getByTestId('display-facts-section').outerHTML).not.toMatch(/backdrop-blur|blur-\[/);
    });
  });

  describe('previous sessions', () => {
    const entry = (over: Record<string, unknown> = {}) => ({
      at: NOW - 3 * 3_600_000, face: 0, elapsedMs: 12 * 60_000, fps: 30, vsyncSnap: true, prefer60hz: 'no-60hz-mode',
      intervalUnitNs: 8_333_333, intervalBuckets: buckets(), intervalCount: 41_203, ...over,
    });
    const withHistory = (entries: unknown[], overflow = 0) =>
      screenWith(native({ faceIndex: 0, timing: { ...native().timing, history: { entries, overflow, capacity: 6 } } }));

    it('is a last row of one line per finished session, newest first, and an overflow note', () => {
      renderSection(withHistory([
        entry({ at: NOW - 26 * 3_600_000, vsyncSnap: false, prefer60hz: undefined }),
        entry({ at: NOW - 9 * 3_600_000, recovered: true }),
        entry(),
      ], 2));
      const row = rtl.getByTestId('display-facts-history');
      expect(row.querySelector('dt')!.textContent).toBe('Previous sessions');
      const lines = [...row.querySelectorAll('dd p')].map((p) => p.textContent);
      expect(lines).toEqual([
        '3 hours ago · ran 12 min · snap on · 60 Hz mode: no 60 Hz mode offered · 99.97 % on cadence',
        '9 hours ago · recovered after a restart · ran 12 min · snap on · 60 Hz mode: no 60 Hz mode offered · 99.97 % on cadence',
        'yesterday · ran 12 min · snap off · 99.97 % on cadence',
        '2 older sessions are no longer listed — the player keeps only its most recent ones.',
      ]);
      // It is the last row of the card.
      const terms = [...rtl.getByTestId('display-facts-section').querySelectorAll('dt')].map((el) => el.textContent);
      expect(terms.at(-1)).toBe('Previous sessions');
    });

    it('stays facts only', () => {
      renderSection(withHistory([entry()]));
      expect(rtl.getByTestId('display-facts-section').querySelectorAll('button, a, input, select, textarea, summary, [role="button"], [tabindex]')).toHaveLength(0);
    });

    it('the other face’s sessions are not this screen’s', () => {
      renderSection(withHistory([entry({ face: 1 })]));
      expect(rtl.queryByTestId('display-facts-history')).not.toBeInTheDocument();
    });
  });

  describe('what it will not say', () => {
    it('a native session that had stopped is said so, with its reason code', () => {
      renderSection(screenWith(native({ state: 'failed', reason: 'output-stalled' })));
      expect(rtl.getByTestId('display-facts-session').textContent).toBe('The native video session had stopped at that report (output-stalled).');
    });

    it('a session that was presenting adds no caveat line', () => {
      renderSection(screenWith(native()));
      expect(rtl.queryByTestId('display-facts-session')).not.toBeInTheDocument();
    });

    it('an older player (nine counters only) shows only what it measured — no panel, no experiments', () => {
      const old = native();
      renderSection(screenWith({
        ...old,
        experiments: undefined,
        timing: {
          decodedFrames: 900, submittedFrames: 880, lateFrames: 143, lastLateUs: 0, maxLateUs: 4_100,
          maxSubmitGapMs: 96, leadUs: 66_666, sourceWidth: 1920, sourceHeight: 1080,
        },
      }));
      expect(rtl.queryByTestId('display-facts-panel')).not.toBeInTheDocument();
      expect(rtl.queryByTestId('display-facts-experiments')).not.toBeInTheDocument();
      expect(rtl.queryByTestId('display-facts-keepScreenOn')).not.toBeInTheDocument();
      expect(rtl.getByTestId('display-facts-cadence').textContent).toContain('143 late · max gap 96 ms');
      expect(rtl.getByTestId('display-facts-cadence').textContent).not.toContain('on cadence');
    });

    it('a 60 Hz mode that is offered is stated as offered, not as applied', () => {
      renderSection(screenWith(native({
        experiments: undefined,
        timing: { ...native().timing, supportedModes: ['1:3840x2160@30.00', '2:3840x2160@60.00'] },
      })));
      const row = rtl.getByTestId('display-facts-panel');
      expect(row.textContent).toContain('A ~60 Hz mode is offered at 3840×2160 (60 Hz).');
      expect(row.textContent).toContain('3840×2160 at 30 Hz');
    });

    it('the guard’s switch-off is its own muted line, not a verdict on the screen', () => {
      renderSection(screenWith(native({
        experiments: {
          requested: { vsyncSnap: true },
          applied: { webviewInvisible: false, vsyncSnap: false },
          guard: { disabled: { vsyncSnap: 'output-stalled' }, applied: {} },
        },
      })));
      const row = rtl.getByTestId('display-facts-experiments');
      expect(row.textContent).toContain('Vsync snap: requested, not applied at the last report');
      expect(row.textContent).toContain('The player’s guard switched Vsync snap off after the video output stalled.');
    });
  });
});
