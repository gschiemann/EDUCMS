/**
 * app-zone — an app is on the canvas the moment it is clicked or dropped
 * (owner, 2026-10-12: "I still can't add any apps to my templates").
 */
import { useBuilderStore } from '@/components/template-builder/useBuilderStore';
import { getApp, type AppDefinition } from '../app-registry';
import { addAppZone, applyAppToZone, appZoneInfo, removeAppZone, APP_PENDING_KEY } from '../app-zone';

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

function app(id: string): AppDefinition {
  const a = getApp(id);
  if (!a) throw new Error(`no app ${id}`);
  return a;
}
const zones = () => useBuilderStore.getState().zones;

beforeEach(() => {
  useBuilderStore.setState({ zones: [], past: [], future: [], selectedIds: [], activeSceneId: null });
});

describe('addAppZone', () => {
  it('a click with nothing typed adds a "Set up" zone, selected', () => {
    const id = addAppZone(app('youtube'))!;
    expect(id).toBeTruthy();
    expect(zones()).toHaveLength(1);
    const z = zones()[0];
    expect(z.widgetType).toBe('STREAMING');
    expect(z.name).toMatch(/^YouTube/);
    expect((z.defaultConfig as Record<string, unknown>)[APP_PENDING_KEY]).toBe(true);
    expect(appZoneInfo(z)?.pending).toBe(true);
    expect(useBuilderStore.getState().selectedIds).toEqual([id]);
  });

  it('a recognised paste lands LIVE, with the built config', () => {
    const id = addAppZone(app('youtube'), { values: { url: YT } })!;
    const z = zones().find((x) => x.id === id)!;
    const cfg = z.defaultConfig as Record<string, unknown>;
    expect(cfg[APP_PENDING_KEY]).toBeUndefined();
    expect(String(cfg.embedUrl)).toContain('youtube.com');
    expect(appZoneInfo(z)?.values.url).toBe(YT);
  });

  it('fills the blank starter instead of stacking on it', () => {
    useBuilderStore.setState({
      zones: [{ id: 'blank', name: 'Full', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} }],
    });
    addAppZone(app('youtube'));
    expect(zones().map((z) => z.widgetType)).toEqual(['STREAMING']);
  });

  it('joins the page the operator is looking at', () => {
    useBuilderStore.setState({ activeSceneId: 'page-2' });
    addAppZone(app('youtube'));
    expect(zones()[0].sceneId).toBe('page-2');
  });

  it('centres on a drop point', () => {
    const id = addAppZone(app('youtube'), { dropAt: { x: 50, y: 50 } })!;
    const z = zones().find((x) => x.id === id)!;
    expect(z.x + z.width / 2).toBeCloseTo(50, 0);
    expect(z.y + z.height / 2).toBeCloseTo(50, 0);
  });

  it('refuses a coming-soon tile — nothing it adds would show', () => {
    const soon = { ...app('youtube'), comingSoon: true };
    expect(addAppZone(soon)).toBeNull();
    expect(zones()).toHaveLength(0);
  });
});

describe('applyAppToZone', () => {
  it('a valid link turns the pending zone live in one undo step', () => {
    const id = addAppZone(app('youtube'))!;
    const before = useBuilderStore.getState().past.length;
    expect(applyAppToZone(id, app('youtube'), { url: YT, muted: 'true' })).toBe(true);
    const z = zones()[0];
    expect(appZoneInfo(z)?.pending).toBe(false);
    expect(String((z.defaultConfig as Record<string, unknown>).embedUrl)).toContain('youtube.com');
    expect(useBuilderStore.getState().past.length).toBe(before + 1);
  });

  it('a link that cannot work writes nothing', () => {
    const id = addAppZone(app('youtube'))!;
    expect(applyAppToZone(id, app('youtube'), { url: 'https://example.com/not-youtube' })).toBe(false);
    expect(appZoneInfo(zones()[0])?.pending).toBe(true);
  });
});

describe('removeAppZone', () => {
  it('takes the zone off the board', () => {
    const id = addAppZone(app('youtube'))!;
    removeAppZone(id);
    expect(zones()).toHaveLength(0);
  });
});
