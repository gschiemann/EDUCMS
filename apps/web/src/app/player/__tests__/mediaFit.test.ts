/**
 * Playlist media fit (2026-10-11, owner decision): crop to fill, centred,
 * never stretch — emergency playlists keep `fill` pending sign-off.
 */
import {
  DEFAULT_PLAYLIST_MEDIA_FIT,
  EMERGENCY_PLAYLIST_MEDIA_FIT,
  mediaFitClass,
  mediaFitStyle,
  playlistMediaFit,
  visibleSourceRect,
} from '../mediaFit';

describe('playlistMediaFit', () => {
  it('normal content crops to fill; an emergency is shown whole (contain), never cropped or stretched', () => {
    expect(DEFAULT_PLAYLIST_MEDIA_FIT).toBe('cover');
    expect(EMERGENCY_PLAYLIST_MEDIA_FIT).toBe('contain');
    expect(playlistMediaFit(false)).toBe('cover');
    expect(playlistMediaFit(true)).toBe('contain');
  });

  it('contain keeps the whole source frame for the cover capture', () => {
    expect(visibleSourceRect('contain', 1080, 1668, 1080, 1920)).toEqual({ sx: 0, sy: 0, sw: 1080, sh: 1668 });
    expect(mediaFitStyle('contain')).toEqual({ objectFit: 'contain', objectPosition: '50% 50%' });
    expect(mediaFitClass('contain')).toBe('object-contain');
  });

  it('style and class agree, centred', () => {
    expect(mediaFitStyle('cover')).toEqual({ objectFit: 'cover', objectPosition: '50% 50%' });
    expect(mediaFitStyle('fill')).toEqual({ objectFit: 'fill', objectPosition: '50% 50%' });
    expect(mediaFitClass('cover')).toBe('object-cover');
    expect(mediaFitClass('fill')).toBe('object-fill');
  });

  it('never emits the inset shorthand or a box side (Taurus)', () => {
    const style = mediaFitStyle('cover') as Record<string, unknown>;
    for (const k of ['inset', 'top', 'right', 'bottom', 'left']) expect(style[k]).toBeUndefined();
  });
});

describe('visibleSourceRect', () => {
  it("Greg's case: a 1080×1668 portrait clip on a 1080×1920 panel trims the sides instead of stretching", () => {
    const r = visibleSourceRect('cover', 1080, 1668, 1080, 1920);
    // Panel (0.5625) is narrower than the clip (0.6475): keep full height, trim width.
    expect(r.sy).toBe(0);
    expect(r.sh).toBe(1668);
    expect(r.sw).toBeCloseTo(1668 * (1080 / 1920), 6);
    expect(r.sx).toBeCloseTo((1080 - r.sw) / 2, 6);
    expect(r.sw / r.sh).toBeCloseTo(1080 / 1920, 6);
  });

  it('a 16:9 picture in a 4:3 box trims left and right equally', () => {
    const r = visibleSourceRect('cover', 1920, 1080, 1024, 768);
    expect(r.sh).toBe(1080);
    expect(r.sw).toBeCloseTo(1440, 6);
    expect(r.sx).toBeCloseTo(240, 6);
  });

  it('a portrait file in a landscape box trims top and bottom equally', () => {
    const r = visibleSourceRect('cover', 1080, 1920, 1920, 1080);
    expect(r.sw).toBe(1080);
    expect(r.sh).toBeCloseTo(607.5, 6);
    expect(r.sy).toBeCloseTo((1920 - 607.5) / 2, 6);
  });

  it('an exact-shape file, and `fill`, use the whole frame (correct content is unchanged)', () => {
    expect(visibleSourceRect('cover', 3840, 2160, 1920, 1080)).toEqual({ sx: 0, sy: 0, sw: 3840, sh: 2160 });
    expect(visibleSourceRect('fill', 1080, 1668, 1080, 1920)).toEqual({ sx: 0, sy: 0, sw: 1080, sh: 1668 });
  });

  it('no usable box → the whole frame', () => {
    expect(visibleSourceRect('cover', 1080, 1668, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 1080, sh: 1668 });
  });
});
