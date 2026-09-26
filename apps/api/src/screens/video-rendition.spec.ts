import { selectFallbackVideoFile, selectVideoFile } from './video-rendition';
import { needs1080ImageCopy, needs1080VideoCopy } from '../schedules/media-publication.service';

const original = {
  fileUrl: 'https://example.com/original.mp4', fileHash: 'a'.repeat(64), fileSize: 250_000_000,
  mimeType: 'video/mp4',
  processingMeta: {
    processedDimensions: { w: 3840, h: 2160 },
    renditions: { '1080p': {
      url: 'https://example.com/1080.mp4', sha256: 'b'.repeat(64), size: 45_000_000,
    } },
  },
};

describe('screen-specific media rendition', () => {
  it('gives a 1080p player the cohesive playback URL, hash and size', () => {
    expect(selectVideoFile(original, '1920 x 1080')).toEqual({
      url: 'https://example.com/1080.mp4', sha256: 'b'.repeat(64), size: 45_000_000,
    });
    expect(needs1080VideoCopy(original, '1920 x 1080')).toBe(false);
  });

  it('preserves native 4K on a 4K screen', () => {
    expect(selectVideoFile(original, '3840 x 2160')).toEqual({
      url: original.fileUrl, sha256: original.fileHash, size: original.fileSize,
    });
  });

  it('never serves a partial rendition record', () => {
    const broken = { ...original, processingMeta: {
      ...original.processingMeta,
      renditions: { '1080p': { url: 'https://example.com/1080.mp4', sha256: '', size: 45_000_000 } },
    } };
    expect(selectVideoFile(broken, '1920 x 1080').url).toBe(original.fileUrl);
    expect(needs1080VideoCopy(broken, '1920 x 1080')).toBe(true);
  });

  it('does the same for a 4K image and never claims an already-1080 image needs work', () => {
    const image = { ...original, mimeType: 'image/jpeg', fileUrl: 'https://example.com/original.jpg' };
    expect(selectVideoFile(image, '1920 x 1080').url).toBe('https://example.com/1080.mp4');
    expect(needs1080ImageCopy(image, '1920 x 1080')).toBe(false);
    expect(needs1080ImageCopy({ mimeType: 'image/jpeg', processingMeta: {
      processedDimensions: { w: 3840, h: 2160 },
    } }, '1920 x 1080')).toBe(true);
    expect(needs1080ImageCopy({ mimeType: 'image/jpeg', processingMeta: {
      processedDimensions: { w: 1920, h: 1080 },
    } }, '1920 x 1080')).toBe(false);
  });

  // 2026-09-26 — a >1080p screen gets the 1080p copy as a FALLBACK: the player
  // plays it until the native file is in its cache (mediaSourceChoice.ts).
  it('offers the 1080p copy as a fallback to a screen that was given the native video', () => {
    const selected = selectVideoFile(original, '3840 x 2160');
    expect(selectFallbackVideoFile(original, selected)).toEqual({
      url: 'https://example.com/1080.mp4', sha256: 'b'.repeat(64), size: 45_000_000,
    });
    // Unknown resolution → native file selected, copy offered as the bridge.
    expect(selectFallbackVideoFile(original, selectVideoFile(original, null))).not.toBeNull();
  });

  it('never offers the file that was already selected, nor a partial record, nor one for an image', () => {
    const on1080 = selectVideoFile(original, '1920 x 1080');
    expect(selectFallbackVideoFile(original, on1080)).toBeNull();
    const broken = { ...original, processingMeta: {
      ...original.processingMeta,
      renditions: { '1080p': { url: 'https://example.com/1080.mp4', sha256: 'nope', size: 45_000_000 } },
    } };
    expect(selectFallbackVideoFile(broken, selectVideoFile(broken, '3840 x 2160'))).toBeNull();
    const noRendition = { ...original, processingMeta: { processedDimensions: { w: 3840, h: 2160 } } };
    expect(selectFallbackVideoFile(noRendition, selectVideoFile(noRendition, '3840 x 2160'))).toBeNull();
    const image = { ...original, mimeType: 'image/jpeg', fileUrl: 'https://example.com/original.jpg' };
    expect(selectFallbackVideoFile(image, selectVideoFile(image, '3840 x 2160'))).toBeNull();
  });
});
