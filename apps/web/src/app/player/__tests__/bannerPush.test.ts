/**
 * An Info banner pushes the content down (2026-10-26). The numbers and the
 * <html> writes the layout rule in player/layout.tsx reads — see bannerPush.ts.
 */
import {
  BANNER_HEIGHT_VAR,
  BANNER_PUSH_ATTR,
  BANNER_PUSH_RELEASE_MS,
  STAGE_HEIGHT_VAR,
  applyBannerPush,
  bannerOffsetPx,
  clearBannerPush,
  stageHeightPx,
} from '../bannerPush';

describe('bannerOffsetPx', () => {
  it('is a whole pixel count, rounded UP so the content never tucks under the banner’s last row', () => {
    expect(bannerOffsetPx(96)).toBe(96);
    expect(bannerOffsetPx(96.2)).toBe(97);
  });
  it('is never a sub-pixel 0.x (Taurus rule #10: nothing may serialize to `0.x` first)', () => {
    expect(bannerOffsetPx(0.2)).toBe(1);
  });
  it('is 0 for no banner / nonsense', () => {
    for (const v of [0, -5, NaN, Infinity, null, undefined]) expect(bannerOffsetPx(v as number)).toBe(0);
  });
});

describe('stageHeightPx', () => {
  const viewportHeight = 720.4;
  it('uses the same precedence the banner’s width uses: face stage, LED canvas, canonical canvas var, viewport', () => {
    expect(stageHeightPx({ faceStageHeight: 960, canvasHeight: 1080, cssLedHeight: '2160px', viewportHeight })).toBe(960);
    expect(stageHeightPx({ canvasHeight: 1080, cssLedHeight: '2160px', viewportHeight })).toBe(1080);
    expect(stageHeightPx({ cssLedHeight: ' 2160px', viewportHeight })).toBe(2160);
    expect(stageHeightPx({ viewportHeight })).toBe(720);
  });
  it('skips unusable values instead of trusting them', () => {
    expect(stageHeightPx({ faceStageHeight: 0, canvasHeight: null, cssLedHeight: '', viewportHeight: 800 })).toBe(800);
    expect(stageHeightPx({ cssLedHeight: 'auto', viewportHeight: 800 })).toBe(800);
  });
});

describe('applyBannerPush / clearBannerPush', () => {
  let root: HTMLElement;
  beforeEach(() => {
    jest.useFakeTimers();
    root = document.createElement('html');
  });
  afterEach(() => {
    clearBannerPush(root, false);
    jest.useRealTimers();
  });

  it('sets the mark and both variables', () => {
    applyBannerPush(root, 88, 1080);
    expect(root.getAttribute(BANNER_PUSH_ATTR)).toBe('on');
    expect(root.style.getPropertyValue(BANNER_HEIGHT_VAR)).toBe('88px');
    expect(root.style.getPropertyValue(STAGE_HEIGHT_VAR)).toBe('1080px');
  });

  it('a banner of no height clears the push instead of marking a zero offset', () => {
    applyBannerPush(root, 88, 1080);
    applyBannerPush(root, 0, 1080);
    expect(root.hasAttribute(BANNER_PUSH_ATTR)).toBe(false);
  });

  it('re-measuring updates in place (a longer message, a resize)', () => {
    applyBannerPush(root, 88, 1080);
    applyBannerPush(root, 132, 1080);
    expect(root.style.getPropertyValue(BANNER_HEIGHT_VAR)).toBe('132px');
    expect(root.getAttribute(BANNER_PUSH_ATTR)).toBe('on');
  });

  it('the stage is never reported smaller than the offset it must contain', () => {
    applyBannerPush(root, 600, 100);
    expect(parseInt(root.style.getPropertyValue(STAGE_HEIGHT_VAR), 10)).toBeGreaterThan(600);
  });

  it('clearing GLIDES home: the offset goes to 0 first, the mark is dropped after the roots have moved', () => {
    applyBannerPush(root, 88, 1080);
    clearBannerPush(root);
    expect(root.getAttribute(BANNER_PUSH_ATTR)).toBe('on');
    expect(root.style.getPropertyValue(BANNER_HEIGHT_VAR)).toBe('0px');
    jest.advanceTimersByTime(BANNER_PUSH_RELEASE_MS + 1);
    expect(root.hasAttribute(BANNER_PUSH_ATTR)).toBe(false);
    expect(root.style.getPropertyValue(BANNER_HEIGHT_VAR)).toBe('');
    expect(root.style.getPropertyValue(STAGE_HEIGHT_VAR)).toBe('');
  });

  it('a banner replacing a banner (clear then apply in one commit) keeps the push — the glide timer is cancelled', () => {
    applyBannerPush(root, 88, 1080);
    clearBannerPush(root);
    applyBannerPush(root, 120, 1080);
    jest.advanceTimersByTime(BANNER_PUSH_RELEASE_MS * 3);
    expect(root.getAttribute(BANNER_PUSH_ATTR)).toBe('on');
    expect(root.style.getPropertyValue(BANNER_HEIGHT_VAR)).toBe('120px');
  });

  it('clearing with nothing applied is a no-op', () => {
    expect(() => clearBannerPush(root)).not.toThrow();
    expect(root.hasAttribute(BANNER_PUSH_ATTR)).toBe(false);
  });

  it('clearing without the glide drops everything at once', () => {
    applyBannerPush(root, 88, 1080);
    clearBannerPush(root, false);
    expect(root.hasAttribute(BANNER_PUSH_ATTR)).toBe(false);
    expect(root.style.getPropertyValue(BANNER_HEIGHT_VAR)).toBe('');
  });
});
