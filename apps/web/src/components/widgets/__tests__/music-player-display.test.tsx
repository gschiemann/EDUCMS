/**
 * Music player "On screen" (owner, 2026-10-12): hidden (audio only — the
 * default for a NEW music zone), a small corner badge, or a now-playing card;
 * never the old dark box whose text got drag-selected on the canvas.
 */
import { render, screen } from '@testing-library/react';
import { MusicPlayerWidget, resolveMusicDisplay, resolveStreamUrl } from '../MusicPlayerWidget';
import { seedDefaultConfig } from '@/components/template-builder/useBuilderStore';
import { resolveDropSize } from '@/components/template-builder/drop-sizes';
import { listVariants } from '../variants';
import '../variants-register';

beforeAll(() => {
  // jsdom: no media playback.
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => undefined });
});

describe('resolveMusicDisplay', () => {
  it('honours an explicit choice', () => {
    expect(resolveMusicDisplay({ display: 'badge' })).toBe('badge');
    expect(resolveMusicDisplay({ display: 'card', hideOnScreen: true })).toBe('card');
  });
  it('keeps a zone saved before "display" existed exactly as it was', () => {
    expect(resolveMusicDisplay({})).toBe('card');
    expect(resolveMusicDisplay({ hideOnScreen: true })).toBe('hidden');
  });
});

describe('a NEW music zone is audio only', () => {
  it('from the widget tile', () => {
    const tile = listVariants().find((v) => v.id === 'music-player-basic');
    expect(tile && resolveMusicDisplay(tile.defaultConfig || {})).toBe('hidden');
  });
  it('from a plain add', () => {
    expect(resolveMusicDisplay(seedDefaultConfig('MUSIC_PLAYER'))).toBe('hidden');
  });
  it('drops as a small handle, not a 40×30 box', () => {
    const size = resolveDropSize('MUSIC_PLAYER');
    expect(size && size.w * size.h).toBeLessThan(40 * 30);
  });
});

describe('MusicPlayerWidget', () => {
  it('hidden, in the editor: a small "♪ audio" chip and nothing else', () => {
    const { container } = render(<MusicPlayerWidget config={{ display: 'hidden' }} />);
    const chip = container.querySelector('[data-music-chip]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toMatch(/Audio/);
    expect(chip!.textContent).toMatch(/Groove Salad/);
    expect(container.querySelector('[data-music-card]')).toBeNull();
  });

  it('hidden, on a screen: paints nothing but the audio element', () => {
    const { container } = render(<MusicPlayerWidget config={{ display: 'hidden' }} live />);
    expect(container.querySelector('[data-music-chip]')).toBeNull();
    expect(container.querySelector('[data-music-card]')).toBeNull();
    expect(container.querySelector('audio')).not.toBeNull();
    expect((container.textContent || '').trim()).toBe('');
  });

  it('badge: the station, compactly', () => {
    const { container } = render(<MusicPlayerWidget config={{ display: 'badge', somafmStationId: 'secretagent' }} />);
    expect(container.querySelector('[data-music-badge]')!.textContent).toMatch(/Secret Agent/);
  });

  it('card: a designed now-playing card — station name, no raw id, no "preview" filler', () => {
    const { container } = render(<MusicPlayerWidget config={{ display: 'card' }} />);
    const card = container.querySelector('[data-music-card]')!;
    expect(card).not.toBeNull();
    expect(screen.getByText('Groove Salad')).toBeTruthy();
    expect(card.textContent).toMatch(/Now playing/i);
    expect(card.textContent).not.toMatch(/groovesalad/);
    expect(card.textContent).not.toMatch(/preview/i);
    expect(card.textContent).not.toMatch(/Volume/i);
    expect(container.querySelector('[data-music-eq]')).not.toBeNull();
  });

  it('nothing on it can be drag-selected on the canvas (the highlighted-text bug)', () => {
    for (const display of ['hidden', 'badge', 'card'] as const) {
      const { container, unmount } = render(<MusicPlayerWidget config={{ display }} />);
      const root = container.firstElementChild as HTMLElement;
      expect(root.style.userSelect).toBe('none');
      unmount();
    }
  });
});

describe('resolveStreamUrl', () => {
  it('names stations in words', () => {
    expect(resolveStreamUrl({ source: 'somafm', somafmStationId: 'u80s' })).toMatchObject({ title: 'Underground 80s', provider: 'SomaFM' });
    expect(resolveStreamUrl({ source: 'nts', ntsChannel: '2' })).toMatchObject({ title: 'NTS 2' });
  });
});
