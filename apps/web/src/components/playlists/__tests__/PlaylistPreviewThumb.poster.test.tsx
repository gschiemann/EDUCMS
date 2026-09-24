/**
 * The library card / list tile draws a video playlist as its poster frame.
 *
 * Greg, 2026-09-24 (screenshot): "playlist videos also arent showing and
 * previews of the content". A video-only playlist's tile was a dark navy
 * mat with a play glyph — deliberately, since the 2026-05-30 egress fix
 * (no <video> bytes per tile). The poster keeps that win (a few-KB JPEG,
 * video still preload="none" until a real hover) and finally shows the
 * content. A video with no poster falls back to the first-frame <video>
 * the asset library uses. The play badge stays either way, so the tile
 * still reads as "video".
 */
import * as React from 'react';
import { render } from '@testing-library/react';
import { PlaylistPreviewThumb } from '../PlaylistPreviewThumb';

const POSTER = 'https://cdn.example.com/posters/v1.jpg';
const video = (id: string, posterUrl: string | null) => ({
  id, originalName: `${id}.mp4`, fileUrl: `https://cdn.example.com/${id}.mp4`, mimeType: 'video/mp4', posterUrl,
});
const image = (id: string) => ({
  id, originalName: `${id}.png`, fileUrl: `https://cdn.example.com/${id}.png`, mimeType: 'image/png',
});
type Fixture = ReturnType<typeof video> | ReturnType<typeof image>;
const playlist = (assets: Fixture[]) => ({
  id: 'p', name: 'P', items: assets.map((a, i) => ({ id: `i${i}`, assetId: a.id, asset: a, sequenceOrder: i, durationMs: 10_000 })),
});

const playBadge = (container: HTMLElement) => container.querySelector('svg.lucide-play');

describe('video-only playlist', () => {
  it.each(['tile', 'list'] as const)('%s: first video with a poster → poster <img>, no video bytes, play badge kept', (size) => {
    const { container } = render(<PlaylistPreviewThumb playlist={playlist([video('v1', POSTER), video('v2', null)])} size={size} />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(POSTER);
    const vid = container.querySelector('video') as HTMLVideoElement;
    expect(vid.getAttribute('preload')).toBe('none');
    expect(vid.getAttribute('src')).toBe('https://cdn.example.com/v1.mp4');
    expect(vid.hasAttribute('autoplay')).toBe(false);
    expect(playBadge(container)).toBeTruthy();
    // The "+1 more" count is still on the tile.
    expect(container.textContent).toContain('+1');
  });

  it.each(['tile', 'list'] as const)('%s: first video WITHOUT a poster → the mat with the first-frame <video>, play badge kept', (size) => {
    const { container } = render(<PlaylistPreviewThumb playlist={playlist([video('v1', null)])} size={size} />);
    expect(container.querySelector('img')).toBeNull();
    const vid = container.querySelector('video') as HTMLVideoElement;
    expect(vid.getAttribute('src')).toBe('https://cdn.example.com/v1.mp4#t=0.1');
    expect(vid.getAttribute('preload')).toBe('metadata');
    expect(vid.hasAttribute('autoplay')).toBe(false);
    expect(container.querySelector('.bg-slate-800')).toBeTruthy(); // the mat is still underneath
    expect(playBadge(container)).toBeTruthy();
  });
});

describe('mixed playlist grid', () => {
  it('a video cell draws its poster; an image cell draws the image', () => {
    const { container } = render(<PlaylistPreviewThumb playlist={playlist([image('a'), video('v1', POSTER)])} size="tile" />);
    const srcs = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src') || '');
    expect(srcs.some((s) => s.includes('/a.png'))).toBe(true);
    expect(srcs).toContain(POSTER);
    expect(container.querySelector('video')?.getAttribute('preload')).toBe('none');
  });
});
