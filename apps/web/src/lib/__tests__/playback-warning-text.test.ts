/**
 * playback-warning-text (2026-10-12, video guarantee step 5): the video gate's
 * warnings and refusals in the operator's language. The bodies below are cut
 * from the producer — PlaybackGateService (`playbackWarnings` on a publish
 * response; 422 VIDEO_SCREEN_CANNOT_PLAY from `playbackCannotPlayRefusal`) in
 * apps/api/src/schedules/playback-gate.service.ts.
 */
import { useTranslations } from 'next-intl';
import {
  playbackGateErrorText,
  playbackWarningText,
  playbackWarningsOf,
  screenList,
  withPlaybackGateText,
} from '../playback-warning-text';
import { showPlaybackWarnings } from '../playback-warning-toast';

jest.mock('sonner', () => ({ toast: { warning: jest.fn() } }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toast } = require('sonner') as { toast: { warning: jest.Mock } };

const t = useTranslations('playbackGate');

const MAY_STUTTER = {
  code: 'VIDEO_MAY_STUTTER',
  reason: 'capability',
  assetId: 'clip',
  file: 'Promo 4K.mp4',
  screens: [{ id: 's1', name: 'Lobby' }],
  hasLighterCopy: true,
  message: '“Promo 4K.mp4” may stutter on Lobby. If it does, we will switch that screen to the 1080p copy automatically.',
};
const TWO_SIDED = {
  code: 'VIDEO_SCREEN_CANNOT_PLAY',
  reason: 'two-sided',
  assetId: 'clip',
  file: 'Promo 4K.mp4',
  screens: [{ id: 'front', name: 'DH43 Front' }],
  hasLighterCopy: true,
  max: 1,
  demand: 2,
  message: 'x',
};

describe('playbackWarningsOf', () => {
  it('reads the publish response; ignores junk; [] for a response with none', () => {
    expect(playbackWarningsOf({ id: 'sch-1', playbackWarnings: [MAY_STUTTER, { nope: 1 }, { ...MAY_STUTTER, screens: [] }] })).toHaveLength(1);
    expect(playbackWarningsOf({ id: 'sch-1' })).toEqual([]);
    expect(playbackWarningsOf(null)).toEqual([]);
  });
});

describe('playbackWarningText (en)', () => {
  it('names the file and the screen, and says what will happen', () => {
    expect(playbackWarningText(t, playbackWarningsOf({ playbackWarnings: [MAY_STUTTER] })[0])).toBe(
      '“Promo 4K.mp4” may stutter on “Lobby”. If it does, we will switch that screen to the 1080p copy automatically.',
    );
  });
  it('plural screens; more than three are summarised', () => {
    const many = { ...MAY_STUTTER, screens: ['A', 'B', 'C', 'D', 'E'].map((n) => ({ id: n, name: n })) };
    expect(playbackWarningText(t, playbackWarningsOf({ playbackWarnings: [many] })[0])).toBe(
      '“Promo 4K.mp4” may stutter on “A”, “B”, “C” and 2 more. If it does, we will switch those screens to the 1080p copy automatically.',
    );
    expect(screenList(t, ['Lobby'])).toBe('“Lobby”');
  });
  it('two-sided and concurrency say it keeps playing', () => {
    expect(playbackWarningText(t, playbackWarningsOf({ playbackWarnings: [TWO_SIDED] })[0])).toMatch(/both sides of this display can’t play video smoothly at the same time yet\. It will keep playing\./);
    const conc = { ...TWO_SIDED, reason: 'concurrency' };
    expect(playbackWarningText(t, playbackWarningsOf({ playbackWarnings: [conc] })[0])).toMatch(/it would play 2 videos at once, and this screen plays 1 smoothly/);
  });
  it('an unknown reason falls back to the server sentence', () => {
    expect(playbackWarningText(t, playbackWarningsOf({ playbackWarnings: [{ ...MAY_STUTTER, reason: 'future', message: 'Server words.' }] })[0])).toBe('Server words.');
  });
});

describe('enforce refusal', () => {
  const refusal = () => {
    const e = new Error('english') as Error & { code?: unknown; body?: unknown };
    e.code = 'VIDEO_SCREEN_CANNOT_PLAY';
    e.body = { code: 'VIDEO_SCREEN_CANNOT_PLAY', message: 'english', files: [{ assetId: 'clip', name: 'Promo 4K.mp4' }], screens: [{ id: 's1', name: 'Gym' }], warnings: [{ ...TWO_SIDED, reason: 'concurrency', screens: [{ id: 's1', name: 'Gym' }] }], reason: 'concurrency' };
    return e;
  };
  it('translates the refusal and says the previous content stays', () => {
    expect(playbackGateErrorText(t, refusal())).toMatch(/“Promo 4K\.mp4” may stutter on “Gym”.*The previous content stays on screen\.$/);
    expect(withPlaybackGateText(t, refusal()).message).toMatch(/previous content stays/);
  });
  it('any other error is left alone', () => {
    const other = Object.assign(new Error('boom'), { code: 'IMAGE_PLAYBACK_COPY_FAILED' });
    expect(withPlaybackGateText(t, other).message).toBe('boom');
  });
});

describe('showPlaybackWarnings', () => {
  it('one toast per warning (max three); nothing for a clean publish', () => {
    toast.warning.mockClear();
    expect(showPlaybackWarnings(t, { id: 'x' })).toEqual([]);
    expect(toast.warning).not.toHaveBeenCalled();
    const shown = showPlaybackWarnings(t, { playbackWarnings: [MAY_STUTTER, TWO_SIDED, MAY_STUTTER, MAY_STUTTER] });
    expect(shown).toHaveLength(3);
    expect(toast.warning).toHaveBeenCalledTimes(3);
  });
});

describe('es / zh parity of the gate words', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const load = (l: string) => require(`@/i18n/messages/${l}.json`).playbackGate;
  it('every key exists in every language with the same placeholders', () => {
    const en = load('en');
    const flat = (o: any, p = ''): Record<string, string> =>
      Object.entries(o).reduce((acc, [k, v]) => (typeof v === 'string' ? { ...acc, [p + k]: v } : { ...acc, ...flat(v, `${p}${k}.`) }), {} as Record<string, string>);
    const fe = flat(en);
    for (const l of ['es', 'zh']) {
      const fl = flat(load(l));
      expect(Object.keys(fl).sort()).toEqual(Object.keys(fe).sort());
      for (const k of Object.keys(fe)) {
        const vars = (s: string) => [...new Set((s.match(/\{(file|screens|max|demand|name|names|count)\b/g) ?? []))].sort();
        expect([l, k, vars(fl[k]).filter((v) => v !== '{count')]).toEqual([l, k, vars(fe[k]).filter((v) => v !== '{count')]);
      }
    }
  });
});
