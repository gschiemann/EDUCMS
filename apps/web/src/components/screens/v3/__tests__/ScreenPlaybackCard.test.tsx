/**
 * ScreenPlaybackCard (2026-10-11, video guarantee step 4) — the read-only
 * "plays smoothly / stutters / not checked yet" surface in the screen drawer.
 */
import { render, screen } from '@testing-library/react';
import type { ScreenPlaybackCapabilityResponse } from '@/hooks/use-api';

let state: { data?: ScreenPlaybackCapabilityResponse; isError?: boolean } = {};
const calls: Array<[string, boolean]> = [];
jest.mock('@/hooks/use-api', () => ({
  useScreenPlaybackCapability: (id: string, enabled: boolean) => {
    calls.push([id, enabled]);
    return { data: state.data, isError: !!state.isError, isLoading: false };
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ScreenPlaybackCard, capabilityKey } = require('../ScreenPlaybackCard') as typeof import('../ScreenPlaybackCard');

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

  it('capabilityKey', () => {
    expect(capabilityKey(cap({ maxShortEdge: 2160 }))).toBe('cap2160');
    expect(capabilityKey(cap({ maxShortEdge: 1080 }))).toBe('cap1080');
    expect(capabilityKey(cap({ evidence: 'measured-screen' }))).toBe('capNone');
    expect(capabilityKey(cap())).toBeNull();
  });
});
