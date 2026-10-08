import {
  selectVideoFile,
  usesPortraitAvcCompatibility,
} from './video-rendition';
import {
  needs1080ImageCopy,
  needs1080VideoCopy,
} from '../schedules/media-publication.service';

const original = {
  fileUrl: 'https://example.com/original.mp4',
  fileHash: 'a'.repeat(64),
  fileSize: 250_000_000,
  mimeType: 'video/mp4',
  processingMeta: {
    processedDimensions: { w: 3840, h: 2160 },
    renditions: {
      '1080p': {
        url: 'https://example.com/1080.mp4',
        sha256: 'b'.repeat(64),
        size: 45_000_000,
      },
    },
  },
};

describe('screen-specific media rendition', () => {
  const compat = {
    url: 'https://example.com/portrait-compatible.mp4',
    sha256: 'c'.repeat(64),
    size: 230_000_000,
    sourceSha256: original.fileHash,
    displayWidth: 1080,
    displayHeight: 1668,
    codedWidth: 1668,
    codedHeight: 1080,
    rotation: 90,
    fps: 30,
    codec: 'h264',
    profile: 'Constrained Baseline',
    level: 40,
  };
  const portrait = {
    ...original,
    processingMeta: {
      ...original.processingMeta,
      probe: { fps: 30 },
      renditions: {
        '1080p': {
          ...original.processingMeta.renditions['1080p'],
          width: 1080,
          height: 1668,
        },
        'portrait-avc-compat': compat,
      },
    },
  };

  it('selects an explicitly scoped compatible file without reducing displayed pixels or frame rate', () => {
    expect(
      usesPortraitAvcCompatibility('front', {
        PLAYER_PORTRAIT_AVC_COMPAT: ' front , back ',
      }),
    ).toBe(true);
    for (const value of [undefined, '', 'all', 'fro', 'front-other']) {
      expect(
        usesPortraitAvcCompatibility('front', {
          PLAYER_PORTRAIT_AVC_COMPAT: value,
        }),
      ).toBe(false);
    }
    expect(selectVideoFile(portrait, '1080×1920', true)).toEqual({
      url: compat.url,
      sha256: compat.sha256,
      size: compat.size,
    });
    expect(selectVideoFile(portrait, '1080×1920').url).toBe(
      'https://example.com/1080.mp4',
    );
    for (const resolution of ['3840x2160', '2560x1440', null, 'unknown']) {
      expect(selectVideoFile(portrait, resolution, true).url).toBe(
        original.fileUrl,
      );
    }
    expect(
      selectVideoFile(
        { ...portrait, mimeType: 'image/jpeg' },
        '1080×1920',
        true,
      ).url,
    ).toBe('https://example.com/1080.mp4');
  });

  it.each([
    { sha256: '' },
    { size: 0 },
    { url: 'http://example.com/unverified.mp4' },
    { displayHeight: 1080 },
    { codedWidth: 1080 },
    { rotation: 0 },
    { fps: 24 },
    { sourceSha256: 'd'.repeat(64) },
    { profile: 'High' },
    { level: 51 },
  ])(
    'refuses incomplete, stale or lower-quality compatibility metadata %j',
    (invalid) => {
      const asset = {
        ...portrait,
        processingMeta: {
          ...portrait.processingMeta,
          renditions: {
            ...portrait.processingMeta.renditions,
            'portrait-avc-compat': { ...compat, ...invalid },
          },
        },
      };
      expect(selectVideoFile(asset, '1080×1920', true).url).toBe(
        'https://example.com/1080.mp4',
      );
    },
  );

  it('gives a 1080p player the cohesive playback URL, hash and size', () => {
    expect(selectVideoFile(original, '1920 x 1080')).toEqual({
      url: 'https://example.com/1080.mp4',
      sha256: 'b'.repeat(64),
      size: 45_000_000,
    });
    expect(needs1080VideoCopy(original, '1920 x 1080')).toBe(false);
  });

  it('preserves native 4K on a 4K screen', () => {
    expect(selectVideoFile(original, '3840 x 2160')).toEqual({
      url: original.fileUrl,
      sha256: original.fileHash,
      size: original.fileSize,
    });
  });

  it('never serves a partial rendition record', () => {
    const broken = {
      ...original,
      processingMeta: {
        ...original.processingMeta,
        renditions: {
          '1080p': {
            url: 'https://example.com/1080.mp4',
            sha256: '',
            size: 45_000_000,
          },
        },
      },
    };
    expect(selectVideoFile(broken, '1920 x 1080').url).toBe(original.fileUrl);
    expect(needs1080VideoCopy(broken, '1920 x 1080')).toBe(true);
  });

  it('does the same for a 4K image and never claims an already-1080 image needs work', () => {
    const image = {
      ...original,
      mimeType: 'image/jpeg',
      fileUrl: 'https://example.com/original.jpg',
    };
    expect(selectVideoFile(image, '1920 x 1080').url).toBe(
      'https://example.com/1080.mp4',
    );
    expect(needs1080ImageCopy(image, '1920 x 1080')).toBe(false);
    expect(
      needs1080ImageCopy(
        {
          mimeType: 'image/jpeg',
          processingMeta: {
            processedDimensions: { w: 3840, h: 2160 },
          },
        },
        '1920 x 1080',
      ),
    ).toBe(true);
    expect(
      needs1080ImageCopy(
        {
          mimeType: 'image/jpeg',
          processingMeta: {
            processedDimensions: { w: 1920, h: 1080 },
          },
        },
        '1920 x 1080',
      ),
    ).toBe(false);
  });

  // 2026-09-26 (Greg) — a >1080p screen is given its native file and NOTHING
  // else: no 1080p stand-in, whatever the resolution string says.
  it('never hands a >1080p or unknown-resolution screen the 1080p copy', () => {
    for (const resolution of [
      '3840 x 2160',
      '2560x1440',
      null,
      undefined,
      'garbage',
    ]) {
      expect(selectVideoFile(original, resolution)).toEqual({
        url: original.fileUrl,
        sha256: original.fileHash,
        size: original.fileSize,
      });
    }
  });
});
