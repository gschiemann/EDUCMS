/**
 * slideLoaded — the browser's own answer to "is this slide's picture ready?".
 * See slideLoaded.ts for the 2026-09-28 "Loading content on a playing screen"
 * incident this exists for.
 */
import { findSlideImage, isImageLoaded } from '../slideLoaded';

describe('isImageLoaded', () => {
  it('is true for a decoded image', () => {
    expect(isImageLoaded({ complete: true, naturalWidth: 640 })).toBe(true);
  });

  it('is false while the image is still loading', () => {
    expect(isImageLoaded({ complete: false, naturalWidth: 0 })).toBe(false);
    // A previous bitmap can linger during a src swap; `complete` is the gate.
    expect(isImageLoaded({ complete: false, naturalWidth: 640 })).toBe(false);
  });

  it('is false for a BROKEN image (`complete` is true for those too)', () => {
    expect(isImageLoaded({ complete: true, naturalWidth: 0, currentSrc: 'https://cdn.test/slide-1.png' })).toBe(false);
  });

  it('accepts an SVG with no intrinsic size', () => {
    expect(isImageLoaded({ complete: true, naturalWidth: 0, currentSrc: 'https://cdn.test/logo.svg?v=2' })).toBe(true);
  });

  it('is false for nothing', () => {
    expect(isImageLoaded(null)).toBe(false);
    expect(isImageLoaded(undefined)).toBe(false);
  });
});

describe('findSlideImage', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('finds the <img> tagged with the item id, among the whole slideshow', () => {
    document.body.innerHTML =
      '<img data-slide-id="a"><img data-slide-id="b"><img data-slide-id="c"><img alt="unrelated">';
    const found = findSlideImage('b');
    expect(found).not.toBeNull();
    expect(found!.getAttribute('data-slide-id')).toBe('b');
  });

  it('returns null when that slide is not mounted', () => {
    document.body.innerHTML = '<img data-slide-id="a">';
    expect(findSlideImage('zzz')).toBeNull();
  });

  it('an id with quotes or brackets cannot break the lookup', () => {
    document.body.innerHTML = '<img data-slide-id=\'x"]y\'>';
    expect(findSlideImage('x"]y')).not.toBeNull();
    expect(findSlideImage('x')).toBeNull();
  });
});
