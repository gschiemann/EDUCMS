/**
 * VideoPreviewThumb — the one video thumbnail for every playlist surface.
 *
 * Greg, 2026-09-24, on an iPad: a video row's thumbnail "is a blank grey
 * box" (a <video preload="none"> with a hover-load trick; touch has no
 * hover), then: "it should be like the asset preview, i hold the mouse over
 * the asset and the video starts playing". The contract this pins:
 *
 *   at rest   poster <img> + a preload="none" video (zero video bytes);
 *             no poster → the asset library's first-frame video (#t=0.1,
 *             preload="metadata"), no <img>.
 *   hover     a mouse/pen entering plays; frames rendering reveals the
 *             video; leaving pauses, rewinds, brings the poster back.
 *   touch     a tap (pointerType "touch") does nothing — the poster stays.
 *   failure   a poster that 404s degrades to the first-frame video.
 *   jsdom     play() returns undefined there (and in the oldest WebViews):
 *             never chained on blindly.
 */
import * as React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
// jsdom 26 has no PointerEvent; without this, `pointerType` never reaches React.
import '../../../../test-mocks/pointer-event-polyfill';
import { VideoPreviewThumb, assetPosterUrl, FIRST_FRAME_SECONDS } from '../VideoPreviewThumb';

const SRC = 'https://cdn.example.com/clip.mp4';
const POSTER = 'https://cdn.example.com/posters/clip.jpg';

const wrapperOf = (container: HTMLElement) =>
  container.querySelector('[data-video-preview]') as HTMLElement;
const videoOf = (container: HTMLElement) => container.querySelector('video') as HTMLVideoElement;

let play: jest.SpyInstance;
let pause: jest.SpyInstance;
beforeEach(() => {
  // jsdom implements neither; the component must cope with a play() that
  // returns undefined AND one that returns a promise.
  play = jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  pause = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => {
  play.mockRestore();
  pause.mockRestore();
});

describe('at rest', () => {
  it('with a poster: the poster is an <img>; the video is preload="none" with no fragment', () => {
    const { container } = render(<VideoPreviewThumb src={SRC} posterUrl={POSTER} className="w-full h-full object-contain" />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(POSTER);
    expect(img.className).toMatch(/\bobject-contain\b/);
    const video = videoOf(container);
    expect(video.getAttribute('src')).toBe(SRC);
    expect(video.getAttribute('preload')).toBe('none');
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.className).toMatch(/\bopacity-0\b/); // hidden behind the poster until frames render
    expect(wrapperOf(container).getAttribute('data-video-preview')).toBe('poster');
    expect(wrapperOf(container).getAttribute('data-preview-state')).toBe('rest');
    expect(play).not.toHaveBeenCalled(); // never on mount
  });

  it('without a poster: no <img>; the first-frame video the asset library uses', () => {
    for (const posterUrl of [null, undefined, '', '   ']) {
      const { container, unmount } = render(<VideoPreviewThumb src={SRC} posterUrl={posterUrl} className="w-full h-full object-cover" />);
      expect(container.querySelector('img')).toBeNull();
      const video = videoOf(container);
      expect(video.getAttribute('src')).toBe(`${SRC}#t=${FIRST_FRAME_SECONDS}`);
      expect(video.getAttribute('preload')).toBe('metadata');
      expect(video.className).not.toMatch(/opacity-0/); // it IS the picture
      expect(wrapperOf(container).getAttribute('data-video-preview')).toBe('first-frame');
      expect(play).not.toHaveBeenCalled();
      unmount();
    }
  });
});

describe('hover to play', () => {
  it('a mouse entering plays; frames rendering reveals the video; leaving pauses, rewinds and restores the poster', () => {
    const { container } = render(<VideoPreviewThumb src={SRC} posterUrl={POSTER} className="w-full h-full" />);
    const wrapper = wrapperOf(container);
    const video = videoOf(container);

    fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' });
    expect(play).toHaveBeenCalledTimes(1);
    // Not revealed yet — nothing has painted, so the poster must stay (no black flash).
    expect(wrapper.getAttribute('data-preview-state')).toBe('rest');
    expect(video.className).toMatch(/\bopacity-0\b/);

    fireEvent(video, new Event('playing'));
    expect(wrapper.getAttribute('data-preview-state')).toBe('playing');
    expect(video.className).toMatch(/\bopacity-100\b/);

    const setTime = jest.spyOn(video, 'currentTime', 'set');
    fireEvent.pointerLeave(wrapper, { pointerType: 'mouse' });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(setTime).toHaveBeenCalledWith(0);
    expect(wrapper.getAttribute('data-preview-state')).toBe('rest');
    expect(video.className).toMatch(/\bopacity-0\b/);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(POSTER);
  });

  it('a `playing` that lands after a fast leave is undone by the `pause` that follows it', () => {
    const { container } = render(<VideoPreviewThumb src={SRC} posterUrl={POSTER} className="w-full h-full" />);
    const wrapper = wrapperOf(container);
    const video = videoOf(container);
    fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' });
    fireEvent.pointerLeave(wrapper, { pointerType: 'mouse' });
    // The browser had already queued `playing` before pause() ran.
    fireEvent(video, new Event('playing'));
    expect(wrapper.getAttribute('data-preview-state')).toBe('playing');
    fireEvent(video, new Event('pause'));
    expect(wrapper.getAttribute('data-preview-state')).toBe('rest');
    expect(video.className).toMatch(/\bopacity-0\b/);
  });

  it('a pen counts as a pointer that can hover', () => {
    const { container } = render(<VideoPreviewThumb src={SRC} posterUrl={POSTER} />);
    fireEvent.pointerEnter(wrapperOf(container), { pointerType: 'pen' });
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('a touch never plays — the poster stays and the tap is left to the tile', () => {
    const { container } = render(<VideoPreviewThumb src={SRC} posterUrl={POSTER} />);
    const wrapper = wrapperOf(container);
    fireEvent.pointerEnter(wrapper, { pointerType: 'touch' });
    fireEvent.pointerLeave(wrapper, { pointerType: 'touch' });
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(wrapper.getAttribute('data-preview-state')).toBe('rest');
    expect(container.querySelector('img')?.getAttribute('src')).toBe(POSTER);
  });

  it('the no-poster fallback rewinds to its painted first frame on leave', () => {
    const { container } = render(<VideoPreviewThumb src={SRC} posterUrl={null} />);
    const wrapper = wrapperOf(container);
    const video = videoOf(container);
    fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' });
    expect(play).toHaveBeenCalledTimes(1);
    const setTime = jest.spyOn(video, 'currentTime', 'set');
    fireEvent.pointerLeave(wrapper, { pointerType: 'mouse' });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(setTime).toHaveBeenCalledWith(FIRST_FRAME_SECONDS);
  });

  it('survives a play() that returns undefined (jsdom, old WebViews) and one that rejects', async () => {
    play.mockImplementation(() => undefined as unknown as Promise<void>);
    const { container, unmount } = render(<VideoPreviewThumb src={SRC} posterUrl={POSTER} />);
    expect(() => fireEvent.pointerEnter(wrapperOf(container), { pointerType: 'mouse' })).not.toThrow();
    unmount();

    play.mockImplementation(() => Promise.reject(new DOMException('interrupted', 'AbortError')));
    const second = render(<VideoPreviewThumb src={SRC} posterUrl={POSTER} />);
    expect(() => fireEvent.pointerEnter(wrapperOf(second.container), { pointerType: 'mouse' })).not.toThrow();
    // Let the rejection settle; an unhandled rejection would fail the suite.
    await act(async () => { await Promise.resolve(); });
  });
});

describe('degrades, never breaks', () => {
  it('a poster that fails to load hands the tile to the first-frame video', () => {
    const { container } = render(<VideoPreviewThumb src={SRC} posterUrl={POSTER} />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(videoOf(container).getAttribute('src')).toBe(`${SRC}#t=${FIRST_FRAME_SECONDS}`);
    expect(videoOf(container).getAttribute('preload')).toBe('metadata');
    expect(wrapperOf(container).getAttribute('data-video-preview')).toBe('first-frame');
  });

  it('reports the picture size from the poster, or from the fallback video metadata', () => {
    const onDimensions = jest.fn();
    const withPoster = render(<VideoPreviewThumb src={SRC} posterUrl={POSTER} onDimensions={onDimensions} />);
    const img = withPoster.container.querySelector('img') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 1080 });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 1920 });
    fireEvent.load(img);
    expect(onDimensions).toHaveBeenLastCalledWith(1080, 1920);
    withPoster.unmount();

    const noPoster = render(<VideoPreviewThumb src={SRC} posterUrl={null} onDimensions={onDimensions} />);
    const video = videoOf(noPoster.container);
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 });
    fireEvent.loadedMetadata(video);
    expect(onDimensions).toHaveBeenLastCalledWith(1920, 1080);
  });
});

describe('assetPosterUrl', () => {
  it('only a video with a real poster gets one; relative paths resolve against the API origin', () => {
    expect(assetPosterUrl({ mimeType: 'video/mp4', posterUrl: POSTER })).toBe(POSTER);
    expect(assetPosterUrl({ mimeType: 'video/mp4', posterUrl: '/posters/x.jpg' })).toMatch(/^https?:\/\/.+\/posters\/x\.jpg$/);
    expect(assetPosterUrl({ mimeType: 'video/mp4', posterUrl: null })).toBeNull();
    expect(assetPosterUrl({ mimeType: 'video/mp4', posterUrl: '  ' })).toBeNull();
    expect(assetPosterUrl({ mimeType: 'video/mp4' })).toBeNull();
    expect(assetPosterUrl({ mimeType: 'image/png', posterUrl: POSTER })).toBeNull();
    expect(assetPosterUrl(null)).toBeNull();
    expect(assetPosterUrl(undefined)).toBeNull();
  });
});
