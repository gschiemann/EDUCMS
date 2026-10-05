/**
 * What the dashboard says about a video's screen-ready verdict (2026-10-05).
 * The verdict is `processingMeta.screen`, read with the SAME `readScreenStamp`
 * the API's manifest gate uses — so "converting" / "can't play" here is exactly
 * "not handed to any screen" there.
 */
import { withheldFromScreens } from '@cms/api-types';
import {
  convertedFromLabel,
  notPlayingOnScreens,
  screenFailedSentence,
  screenFailureReason,
  screenReadinessOf,
} from '../screen-readiness-copy';
import { useTranslations } from 'next-intl';
import type { VideoOptimization } from '@/hooks/use-video-optimization';

const t = useTranslations();

const video = (screen: unknown, extra: Record<string, unknown> = {}) => ({
  mimeType: 'video/mp4',
  processingMeta: screen === undefined ? { probe: { codec: 'h264' }, ...extra } : { screen, ...extra },
});
const PENDING = { version: 1, ready: false, pending: true, issues: ['codec', 'hdr'], checkedAt: 'x' };
const FAILED = (error: string, issues = ['codec']) => ({ version: 1, ready: false, issues, error, checkedAt: 'x' });
const job = (over: Partial<VideoOptimization>): VideoOptimization => ({
  status: 'running',
  reason: null,
  progress: null,
  sourceBytes: null,
  outputBytes: null,
  finishedAt: null,
  ...over,
});

describe('screenReadinessOf', () => {
  it('pending → converting (no job info: no progress)', () => {
    expect(screenReadinessOf(video(PENDING))).toEqual({ kind: 'converting', progress: null, queued: false });
  });

  it('pending + a running job → converting WITH the job’s progress; queued → waiting', () => {
    expect(screenReadinessOf(video(PENDING), job({ status: 'running', progress: 42 }))).toEqual({
      kind: 'converting',
      progress: 42,
      queued: false,
    });
    expect(screenReadinessOf(video(PENDING), job({ status: 'queued' }))).toEqual({
      kind: 'converting',
      progress: null,
      queued: true,
    });
  });

  it('a FAILED stamp with a job running again (a retry) reads converting — the live job wins over the row', () => {
    expect(screenReadinessOf(video(FAILED('ffmpeg-failed')), job({ status: 'running', progress: 7 }))?.kind).toBe(
      'converting',
    );
  });

  it('failed → failed, with a plain reason', () => {
    expect(screenReadinessOf(video(FAILED('timeout')))).toEqual({ kind: 'failed', reason: 'tooSlow' });
  });

  it('converted → converted, with what it was converted from and the codec it replaced', () => {
    expect(
      screenReadinessOf(
        video({ version: 1, ready: true, convertedFrom: ['codec', 'hdr'], checkedAt: 'x' }, { transcode: { codecIn: 'hevc' } }),
      ),
    ).toEqual({ kind: 'converted', from: ['codec', 'hdr'], codecIn: 'hevc' });
  });

  it('nothing to add: ready as uploaded, no verdict (every older video), a non-video, an unknown stamp version', () => {
    expect(screenReadinessOf(video({ version: 1, ready: true, checkedAt: 'x' }))).toBeNull();
    expect(screenReadinessOf(video(undefined))).toBeNull();
    expect(screenReadinessOf({ mimeType: 'image/png', processingMeta: { screen: PENDING } })).toBeNull();
    expect(screenReadinessOf(video({ version: 2, ready: false }))).toBeNull();
    expect(screenReadinessOf(null)).toBeNull();
  });

  it('alert media whose job ended "emergency-content" keeps the job’s own sentence — "converting" would never come true', () => {
    expect(screenReadinessOf(video(PENDING), job({ status: 'skipped', reason: 'emergency-content' }))).toBeNull();
  });

  it('AGREES WITH THE MANIFEST: "not playing on screens" is exactly what the API’s gate withholds', () => {
    const cases = [
      video(PENDING),
      video(FAILED('ffmpeg-failed')),
      video({ version: 1, ready: true, checkedAt: 'x' }),
      video({ version: 1, ready: true, convertedFrom: ['codec'], checkedAt: 'x' }),
      video(undefined),
      video({ version: 2, ready: false }),
      { mimeType: 'image/png', processingMeta: { screen: PENDING } },
    ];
    for (const a of cases) {
      expect(notPlayingOnScreens(screenReadinessOf(a))).toBe(withheldFromScreens(a));
    }
  });
});

describe('screenFailureReason — the job outcome in plain words', () => {
  it.each([
    [['unreadable'], 'probe-failed', 'unreadable'],
    [['codec'], 'no-video-stream', 'unreadable'],
    [['codec'], 'timeout', 'tooSlow'],
    [['codec'], 'insufficient-temp-disk', 'couldNotRun'],
    [['codec'], 'stalled', 'couldNotRun'],
    [['codec'], 'expired', 'couldNotRun'],
    [['codec'], 'not-queued', 'couldNotRun'],
    [['codec'], 'ffmpeg-failed', 'failed'],
    [['codec'], 'output-rejected', 'failed'],
    [['codec'], 'error', 'failed'],
    [['codec'], null, 'failed'],
  ])('issues %j, error %s → %s', (issues, error, expected) => {
    expect(screenFailureReason({ issues: issues as string[], error: error as string | null })).toBe(expected);
  });
});

describe('the sentences', () => {
  it('a failed conversion says what happened and what to do', () => {
    expect(screenFailedSentence(t, { kind: 'failed', reason: 'tooSlow' })).toBe(
      'This video could not be converted for screens: converting it took too long. Export it as MP4 (H.264) and upload it again.',
    );
    expect(screenFailedSentence(t, { kind: 'failed', reason: 'unreadable' })).toMatch(/couldn't be read as a video/);
  });

  it('"was H.265 / HEVC, 10-bit colour, HDR, over 30 fps" — the codec by the name on export dialogs, the rest in plain words', () => {
    expect(
      convertedFromLabel(t, { kind: 'converted', from: ['codec', 'pixel-format', 'hdr', 'frame-rate'], codecIn: 'hevc' }),
    ).toBe('H.265 / HEVC, 10-bit colour, HDR, over 30 fps');
  });

  it('three audio problems are ONE label; an unknown code is left out, never shown raw', () => {
    expect(
      convertedFromLabel(t, {
        kind: 'converted',
        from: ['audio-codec', 'audio-channels', 'audio-sample-rate', 'some-future-code', 'container'],
        codecIn: null,
      }),
    ).toBe("audio screens can't play, not MP4");
  });

  it('a codec it does not know the name of is still said plainly', () => {
    expect(convertedFromLabel(t, { kind: 'converted', from: ['codec'], codecIn: null })).toBe("a codec screens can't play");
  });
});
