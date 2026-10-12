/**
 * Pages (renamed Scenes, 2026-10-12) — the pure rules behind the page strip.
 */
import { isInteractiveTemplate, isTapTargetZone, nextPageName, reorderPages, sortPages, zonesOnPage } from '../pages';
import type { TemplateScene, Zone } from '../types';

const scene = (id: string, name: string, sortOrder: number, isDefault = false): TemplateScene =>
  ({ id, templateId: 't', name, sortOrder, isDefault });
const zone = (id: string, sceneId: string | null, extra: Partial<Zone> = {}): Zone =>
  ({ id, name: id, widgetType: 'TEXT', x: 0, y: 0, width: 10, height: 10, zIndex: 1, sortOrder: 0, sceneId, ...extra });

describe('isInteractiveTemplate — the Pages tab + strip are hidden otherwise', () => {
  it('a plain signage board is not interactive (one default page, no taps)', () => {
    expect(isInteractiveTemplate({ isTouchEnabled: false, scenes: [scene('a', 'Main', 0, true)], zones: [zone('z', 'a')] })).toBe(false);
  });
  it('touch mode on → interactive', () => {
    expect(isInteractiveTemplate({ isTouchEnabled: true, scenes: [], zones: [] })).toBe(true);
  });
  it('any tap action → interactive', () => {
    expect(isInteractiveTemplate({ isTouchEnabled: false, scenes: [], zones: [zone('z', null, { touchAction: { type: 'reset-idle' } as Zone['touchAction'] })] })).toBe(true);
  });
  it('existing multi-page data stays reachable even with touch mode off', () => {
    expect(isInteractiveTemplate({ isTouchEnabled: false, scenes: [scene('a', 'A', 0, true), scene('b', 'B', 1)], zones: [] })).toBe(true);
  });
});

describe('page order + names', () => {
  it('sorts by sortOrder, then the start page first', () => {
    expect(sortPages([scene('b', 'B', 1), scene('x', 'X', 0), scene('h', 'Home', 0, true)]).map((s) => s.id)).toEqual(['h', 'x', 'b']);
  });
  it('names a new page "Page N" without reusing a taken name', () => {
    const label = (n: number) => `Page ${n}`;
    expect(nextPageName([scene('a', 'Main', 0, true)], label)).toBe('Page 2');
    expect(nextPageName([scene('a', 'Main', 0, true), scene('b', 'page 3', 1)], label)).toBe('Page 4');
  });
});

describe('reorderPages', () => {
  const pages = [scene('a', 'A', 0, true), scene('b', 'B', 1), scene('c', 'C', 2)];
  it('moves a page right and writes only what changes', () => {
    expect(reorderPages(pages, 'a', 1)).toEqual([{ sceneId: 'b', sortOrder: 0 }, { sceneId: 'a', sortOrder: 1 }]);
  });
  it('does nothing past either end', () => {
    expect(reorderPages(pages, 'a', -1)).toEqual([]);
    expect(reorderPages(pages, 'c', 1)).toEqual([]);
  });
  it('gives legacy pages that all share sortOrder 0 a real order', () => {
    const legacy = [scene('a', 'A', 0, true), scene('b', 'B', 0), scene('c', 'C', 0)];
    const writes = reorderPages(legacy, 'c', -1);
    const order = new Map(legacy.map((s) => [s.id, s.sortOrder]));
    writes.forEach((w) => order.set(w.sceneId, w.sortOrder));
    expect([...order.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id)).toEqual(['a', 'c', 'b']);
  });
});

it('zonesOnPage separates a page from the shared layer', () => {
  const zs = [zone('1', 'a'), zone('2', null), zone('3', 'b')];
  expect(zonesOnPage(zs, 'a').map((z) => z.id)).toEqual(['1']);
  expect(zonesOnPage(zs, null).map((z) => z.id)).toEqual(['2']);
});

it('isTapTargetZone: touch points and buttons get "When tapped → Go to page"', () => {
  expect(isTapTargetZone({ widgetType: 'TOUCH_POINT' })).toBe(true);
  expect(isTapTargetZone({ widgetType: 'KIOSK_BUTTON' })).toBe(true);
  expect(isTapTargetZone({ widgetType: 'CLOCK' })).toBe(false);
  expect(isTapTargetZone({ widgetType: 'IMAGE', touchAction: { type: 'reset-idle' } as Zone['touchAction'] })).toBe(true);
});
