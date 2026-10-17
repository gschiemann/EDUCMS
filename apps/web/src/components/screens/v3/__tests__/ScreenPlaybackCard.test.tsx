/**
 * ScreenPlaybackCard (2026-10-11, video guarantee step 4) — the read-only
 * "plays smoothly / stutters / not checked yet" surface in the screen drawer.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ScreenPlaybackCapabilityResponse } from '@/hooks/use-api';

let state: { data?: ScreenPlaybackCapabilityResponse; isError?: boolean } = {};
const calls: Array<[string, boolean]> = [];
const clears: Array<[string, string]> = [];
let clearFails = false;
let role = 'SCHOOL_ADMIN';
jest.mock('@/hooks/use-api', () => ({
  useScreenPlaybackCapability: (id: string, enabled: boolean) => {
    calls.push([id, enabled]);
    return { data: state.data, isError: !!state.isError, isLoading: false };
  },
  useClearPlaybackDemotion: (screenId: string) => ({
    isPending: false,
    mutate: (id: string, opts: { onSuccess?: () => void; onError?: () => void }) => {
      clears.push([screenId, id]);
      if (clearFails) opts.onError?.();
      else opts.onSuccess?.();
    },
  }),
}));
jest.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: any) => any) => sel({ user: { id: 'u1', role } }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ScreenPlaybackCard, capabilityKey, excludedReasonKey } = require('../ScreenPlaybackCard') as typeof import('../ScreenPlaybackCard');

const cap = (over: Partial<ScreenPlaybackCapabilityResponse['capability']> = {}): ScreenPlaybackCapabilityResponse['capability'] => ({
  deviceClass: 'goodview/m65guq/t982/sdk30',
  maxShortEdge: null,
  stuttersAtShortEdge: null,
  maxFps: null,
  maxUnitConcurrentVideos: null,
  evidence: 'unknown',
  concurrencyEvidence: 'unknown',
  evidenceAt: null,
  classScreens: 0,
  stale: false,
  ...over,
});
const file = (over: Partial<ScreenPlaybackCapabilityResponse['files'][number]> = {}) => ({
  sha256: 'a'.repeat(64),
  name: 'Fall promo.mp4',
  assetId: 'asset-1',
  copy: 'original' as const,
  verdict: 'smooth' as const,
  samples: 12,
  settledSamples: 10,
  droppedPct: 0.1,
  worstPct: 0.2,
  lastPct: 0,
  width: 2160,
  height: 3338,
  engine: 'continuous',
  concurrentMax: 1,
  unitConcurrentMax: 1,
  firstAt: '2026-10-11T18:00:00Z',
  lastAt: '2026-10-11T19:35:00Z',
  ...over,
});

beforeEach(() => {
  state = {};
  calls.length = 0;
  clears.length = 0;
  clearFails = false;
  role = 'SCHOOL_ADMIN';
});

describe('ScreenPlaybackCard', () => {
  it('says "Not checked yet" when nothing is measured, and never invents a capability', () => {
    state.data = { screenId: 's', summary: 'unknown', capability: cap(), declared: null, files: [] };
    render(<ScreenPlaybackCard screenId="s" enabled />);
    expect(screen.getByTestId('screen-playback-summary').textContent).toBe('Not checked yet');
    expect(screen.queryByText(/Video up to/)).toBeNull();
    expect(screen.queryByTestId('screen-playback-files')).toBeNull();
  });

  it('a smooth 4K screen: the summary, what it can play, where that comes from, and the file', () => {
    state.data = {
      screenId: 's',
      summary: 'smooth',
      capability: cap({ maxShortEdge: 2160, evidence: 'measured-screen', maxUnitConcurrentVideos: 1, concurrencyEvidence: 'class-default' }),
      declared: null,
      files: [file()],
    };
    render(<ScreenPlaybackCard screenId="s" enabled />);
    expect(screen.getByTestId('screen-playback-summary').textContent).toBe('Plays video smoothly');
    expect(screen.getByText(/Video up to 4K · One video at a time on this display/)).toBeTruthy();
    expect(screen.getByText(/Measured on this screen/)).toBeTruthy();
    expect(screen.getByText('Fall promo.mp4')).toBeTruthy();
    expect(screen.getByText(/0.1% of frames dropped over 10 min · 2160 × 3338/)).toBeTruthy();
  });

  it('a double-sided unit stuttering on its 1080p copy says so, file by file', () => {
    state.data = {
      screenId: 's',
      summary: 'stutters',
      capability: cap({ maxShortEdge: 1080, evidence: 'class-default', maxUnitConcurrentVideos: 1, concurrencyEvidence: 'measured-screen' }),
      declared: null,
      files: [file({ verdict: 'stuttering', copy: '1080p', droppedPct: 54.6, width: 1080, height: 1668, unitConcurrentMax: 2, settledSamples: 5 })],
    };
    const { container } = render(<ScreenPlaybackCard screenId="s" enabled />);
    expect(screen.getByTestId('screen-playback-summary').textContent).toBe('Stutters on video');
    expect(container.querySelector('[data-playback-verdict="stuttering"]')).toBeTruthy();
    expect(screen.getByText(/54.6% of frames dropped over 5 min · 1080p copy · 1080 × 1668 · video was playing on both sides/)).toBeTruthy();
  });

  it('a file still being checked shows its sample count, not a percentage', () => {
    state.data = { screenId: 's', summary: 'unknown', capability: cap(), declared: null, files: [file({ verdict: 'insufficient', droppedPct: null, settledSamples: 0, samples: 2 })] };
    render(<ScreenPlaybackCard screenId="s" enabled />);
    expect(screen.getByText(/2 samples so far/)).toBeTruthy();
    expect(screen.getByText('Checking')).toBeTruthy();
  });

  it('measured on the model elsewhere names the count; stale evidence says it will be re-checked', () => {
    state.data = { screenId: 's', summary: 'unknown', capability: cap({ maxShortEdge: 2160, evidence: 'measured-class', classScreens: 3, stale: true }), declared: null, files: [] };
    render(<ScreenPlaybackCard screenId="s" enabled />);
    expect(screen.getByText(/Measured on 3 screens of this model/)).toBeTruthy();
    expect(screen.getByText(/it will be checked again/)).toBeTruthy();
  });

  it('a failed load says so plainly; disabled renders nothing and does not fetch', () => {
    state.isError = true;
    const { unmount } = render(<ScreenPlaybackCard screenId="s" enabled />);
    expect(screen.getByText('Couldn’t load playback history.')).toBeTruthy();
    unmount();
    const { container } = render(<ScreenPlaybackCard screenId="s2" enabled={false} />);
    expect(container.innerHTML).toBe('');
    expect(calls[calls.length - 1]).toEqual(['s2', false]);
  });

  it('minutes left out by the sample guard (2026-10-17) are shown with their reason, never hidden', () => {
    state.data = {
      screenId: 's',
      summary: 'smooth',
      capability: cap({ maxShortEdge: 2160, evidence: 'measured-screen' }),
      declared: null,
      files: [
        file({ excludedSamples: 3, excludedReason: 'page-load', excludedAt: '2026-10-17T09:02:04Z' }),
        file({ sha256: 'b'.repeat(64), name: 'Other.mp4', excludedSamples: 2, excludedReason: 'fallback-engine' }),
        file({ sha256: 'c'.repeat(64), name: 'Clean.mp4', excludedSamples: 0, excludedReason: null }),
      ],
    };
    render(<ScreenPlaybackCard screenId="s" enabled />);
    const lines = screen.getAllByTestId('screen-playback-excluded');
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toBe('3 min not counted — the page had just loaded');
    expect(lines[1].textContent).toBe('2 min not counted — the backup player was covering for the screen’s built-in video engine');
  });

  it('excludedReasonKey: nothing left out (or an older API) → no line; an unknown reason → the generic one', () => {
    expect(excludedReasonKey({})).toBeNull();
    expect(excludedReasonKey({ excludedSamples: 0, excludedReason: 'page-load' })).toBeNull();
    expect(excludedReasonKey({ excludedSamples: 1, excludedReason: 'handoff' })).toBe('excludedHandoff');
    expect(excludedReasonKey({ excludedSamples: 1, excludedReason: null })).toBe('excludedGeneric');
  });

  it('capabilityKey', () => {
    expect(capabilityKey(cap({ maxShortEdge: 2160 }))).toBe('cap2160');
    expect(capabilityKey(cap({ maxShortEdge: 1080 }))).toBe('cap1080');
    expect(capabilityKey(cap({ evidence: 'measured-screen' }))).toBe('capNone');
    expect(capabilityKey(cap())).toBeNull();
  });

  describe('a demoted screen (owner decision A, 2026-10-12)', () => {
    const demoted = (): ScreenPlaybackCapabilityResponse => ({
      screenId: 's',
      summary: 'stutters',
      capability: cap({ maxShortEdge: 2160, evidence: 'class-default' }),
      declared: null,
      files: [file({ verdict: 'stuttering' })],
      demotions: [{ id: 'dem-1', sha256: 'a'.repeat(64), assetId: 'asset-1', name: 'Fall promo.mp4', since: '2026-10-12T10:00:00Z' }],
    });

    it('says what happened in plain words; an admin gets ONE action that clears it', async () => {
      state.data = demoted();
      render(<ScreenPlaybackCard screenId="s" enabled />);
      expect(screen.getByText('Playing a lighter copy')).toBeTruthy();
      expect(screen.getByText(/stuttered on “Fall promo.mp4”, so it now plays the 1080p copy/)).toBeTruthy();
      await act(async () => {});
      fireEvent.click(screen.getByTestId('screen-playback-try-full-quality'));
      expect(clears).toEqual([['s', 'dem-1']]);
      expect(screen.getByText(/Full quality is back/)).toBeTruthy();
      expect(screen.queryByTestId('screen-playback-try-full-quality')).toBeNull();
    });

    it('a failure says so; a contributor sees the notice but no button', async () => {
      state.data = demoted();
      clearFails = true;
      const { unmount } = render(<ScreenPlaybackCard screenId="s" enabled />);
      await act(async () => {});
      fireEvent.click(screen.getByTestId('screen-playback-try-full-quality'));
      expect(screen.getByRole('alert').textContent).toMatch(/Couldn’t switch back/);
      unmount();
      role = 'CONTRIBUTOR';
      render(<ScreenPlaybackCard screenId="s" enabled />);
      await act(async () => {});
      expect(screen.getByText('Playing a lighter copy')).toBeTruthy();
      expect(screen.queryByTestId('screen-playback-try-full-quality')).toBeNull();
    });

    it('no demotions (or an older API without the field) → no notice', () => {
      state.data = { ...demoted(), demotions: undefined };
      render(<ScreenPlaybackCard screenId="s" enabled />);
      expect(screen.queryByTestId('screen-playback-demotion')).toBeNull();
    });
  });
});
