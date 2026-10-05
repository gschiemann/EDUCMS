import {
  buildScreenStamp,
  readScreenStamp,
  SCREEN_STAMP_VERSION,
  withheldFromScreens,
} from './screen-readiness';

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const AT = new Date(NOW).toISOString();

describe('buildScreenStamp — the one shape every writer uses', () => {
  it('ready', () => {
    expect(buildScreenStamp({ ready: true }, NOW)).toEqual({ version: 1, ready: true, checkedAt: AT });
  });

  it('converted: ready with what the conversion fixed', () => {
    expect(buildScreenStamp({ ready: true, convertedFrom: ['codec', 'hdr'] }, NOW)).toEqual({
      version: 1,
      ready: true,
      convertedFrom: ['codec', 'hdr'],
      checkedAt: AT,
    });
  });

  it('pending: not ready yet, with the reasons', () => {
    expect(buildScreenStamp({ ready: false, pending: true, issues: ['codec', 'frame-rate'] }, NOW)).toEqual({
      version: 1,
      ready: false,
      pending: true,
      issues: ['codec', 'frame-rate'],
      checkedAt: AT,
    });
  });

  it('failed: not ready, with the reasons and why — and NO pending', () => {
    expect(buildScreenStamp({ ready: false, issues: ['codec'], error: 'ffmpeg-failed' }, NOW)).toEqual({
      version: 1,
      ready: false,
      issues: ['codec'],
      error: 'ffmpeg-failed',
      checkedAt: AT,
    });
  });

  it('`pending` is never written on a ready stamp (a contradiction a reader would have to guess about)', () => {
    expect(buildScreenStamp({ ready: true, pending: true }, NOW)).not.toHaveProperty('pending');
  });

  it('a long error is a label, not a log', () => {
    expect(buildScreenStamp({ ready: false, error: 'x'.repeat(500) }, NOW).error).toHaveLength(160);
  });

  it('round-trips through the reader', () => {
    const stamp = buildScreenStamp({ ready: false, pending: true, issues: ['container'] }, NOW);
    expect(readScreenStamp({ screen: stamp })).toEqual({
      ready: false,
      pending: true,
      issues: ['container'],
      convertedFrom: [],
      error: null,
      checkedAt: AT,
    });
  });
});

describe('readScreenStamp — unknown stays unknown', () => {
  it.each([
    ['no processingMeta', null],
    ['processingMeta without a stamp', { probe: { codec: 'hevc' } }],
    ['an array', []],
    ['a stamp of another version', { screen: { version: 2, ready: false } }],
    ['a stamp with no version', { screen: { ready: false } }],
    ['ready that is not a boolean', { screen: { version: 1, ready: 'false' } }],
    ['a stamp that is not an object', { screen: 'ready' }],
  ])('%s → null', (_label, meta) => {
    expect(readScreenStamp(meta)).toBeNull();
  });

  it('pending on a ready stamp reads as not pending', () => {
    expect(readScreenStamp({ screen: { version: SCREEN_STAMP_VERSION, ready: true, pending: true } })?.pending).toBe(false);
  });

  it('garbage inside the lists is dropped, not trusted', () => {
    expect(
      readScreenStamp({ screen: { version: 1, ready: false, issues: ['codec', 7, null, 'codec', ' hdr '] } })?.issues,
    ).toEqual(['codec', 'hdr']);
  });
});

describe('withheldFromScreens — the manifest gate', () => {
  const video = (screen?: unknown) => ({ mimeType: 'video/mp4', processingMeta: screen === undefined ? null : { screen } });

  it('a video still converting is withheld', () => {
    expect(withheldFromScreens(video({ version: 1, ready: false, pending: true, issues: ['codec'] }))).toBe(true);
  });

  it('a video whose conversion failed is withheld', () => {
    expect(withheldFromScreens(video({ version: 1, ready: false, issues: ['codec'], error: 'timeout' }))).toBe(true);
  });

  it('a ready / converted video is delivered', () => {
    expect(withheldFromScreens(video({ version: 1, ready: true }))).toBe(false);
    expect(withheldFromScreens(video({ version: 1, ready: true, convertedFrom: ['hdr'] }))).toBe(false);
  });

  it('a video with NO stamp (every asset uploaded before the verdict existed) is delivered exactly as before', () => {
    expect(withheldFromScreens(video())).toBe(false);
    expect(withheldFromScreens({ mimeType: 'video/mp4' })).toBe(false);
  });

  it('an unreadable stamp is unknown, so delivered', () => {
    expect(withheldFromScreens(video({ version: 9, ready: false }))).toBe(false);
  });

  it('only videos: an image, a PDF or a web page carrying a stray stamp is never withheld by this rule', () => {
    const stamp = { screen: { version: 1, ready: false, issues: ['codec'] } };
    expect(withheldFromScreens({ mimeType: 'image/png', processingMeta: stamp })).toBe(false);
    expect(withheldFromScreens({ mimeType: 'application/pdf', processingMeta: stamp })).toBe(false);
    expect(withheldFromScreens({ mimeType: null, processingMeta: stamp })).toBe(false);
    expect(withheldFromScreens(null)).toBe(false);
  });

  it('the mime check is case-insensitive', () => {
    expect(withheldFromScreens({ mimeType: 'VIDEO/QuickTime', processingMeta: { screen: { version: 1, ready: false } } })).toBe(true);
  });
});
