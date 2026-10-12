/**
 * Finished layouts + the "Set up <App>" button (owner, 2026-10-12: "i click
 * setup and nothing happens … what are the full bleed settings in the side
 * bar they dont do anything").
 */
import { useBuilderStore } from '@/components/template-builder/useBuilderStore';
import { APP_REGISTRY, getApp, type AppDefinition, type AppStarterLayout } from '../app-registry';
import {
  addAppZone,
  applyStarterLayout,
  appZoneInfo,
  openAppSetup,
  planStarterLayout,
  requestAppSetupFocus,
  takeAppSetupFocus,
  APP_SETUP_FOCUS_EVENT,
} from '../app-zone';

const VIMEO = 'https://vimeo.com/123456789';

function app(id: string): AppDefinition {
  const a = getApp(id);
  if (!a) throw new Error(`no app ${id}`);
  return a;
}
function layout(a: AppDefinition, id: string): AppStarterLayout {
  const l = a.starterLayouts?.find((x) => x.id === id);
  if (!l) throw new Error(`no layout ${id} on ${a.id}`);
  return l;
}
const zones = () => useBuilderStore.getState().zones;
const BLANK = { id: 'blank', name: 'Full', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} };

beforeEach(() => {
  useBuilderStore.setState({ zones: [BLANK], past: [], future: [], selectedIds: [], activeSceneId: null });
  takeAppSetupFocus('drain'); // clear any pending request between tests
});

describe('"Set up <App>" — the canvas button', () => {
  it('selects the zone AND asks its form for the caret', () => {
    const id = addAppZone(app('vimeo'))!;
    useBuilderStore.getState().select(null);
    takeAppSetupFocus(id); // consume the add-time request
    const heard: string[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent<{ zoneId: string }>).detail.zoneId);
    window.addEventListener(APP_SETUP_FOCUS_EVENT, on);
    openAppSetup(id);
    window.removeEventListener(APP_SETUP_FOCUS_EVENT, on);
    expect(useBuilderStore.getState().selectedIds).toEqual([id]);
    expect(heard).toEqual([id]);
    // A form that mounts AFTER the click (Properties was closed) still gets it, once.
    expect(takeAppSetupFocus(id)).toBe(true);
    expect(takeAppSetupFocus(id)).toBe(false);
  });

  it('re-clicking on an already-selected zone still produces a focus request (the reported "nothing happens")', () => {
    const id = addAppZone(app('vimeo'))!;
    expect(useBuilderStore.getState().selectedIds).toEqual([id]);
    takeAppSetupFocus(id);
    const epoch = useBuilderStore.getState().selectionEpoch;
    openAppSetup(id);
    expect(useBuilderStore.getState().selectionEpoch).toBe(epoch + 1);
    expect(takeAppSetupFocus(id)).toBe(true);
  });

  it('a request for another zone is not taken', () => {
    requestAppSetupFocus('a');
    expect(takeAppSetupFocus('b')).toBe(false);
  });
});

describe('finished layouts build what their card shows', () => {
  it('Full-bleed + branded title: app fills the canvas, brand title bar on top of it', () => {
    const v = app('vimeo');
    const id = applyStarterLayout(v, layout(v, 'full-bleed-titled'), { url: VIMEO, muted: 'true' })!;
    const all = zones();
    expect(all.map((z) => z.widgetType)).toEqual(['STREAMING', 'TEXT']); // the blank placeholder is gone
    const appZone = all.find((z) => z.id === id)!;
    expect([appZone.x, appZone.y, appZone.width, appZone.height]).toEqual([0, 0, 100, 100]);
    expect(appZoneInfo(appZone)?.pending).toBe(false);
    expect(String((appZone.defaultConfig as Record<string, unknown>).embedUrl)).toBe(VIMEO);
    const title = all.find((z) => z.widgetType === 'TEXT')!;
    expect(title.zIndex).toBeGreaterThan(appZone.zIndex);
    expect(title.y + title.height).toBe(100);
    const cfg = title.defaultConfig as Record<string, unknown>;
    expect(cfg.bgColor).toContain('--brand-primary');
    expect(cfg.color).toContain('--brand-primary-ink');
    expect(cfg.fontFamily).toContain('--brand-font-heading');
    expect(cfg.content).toBeTruthy();
    expect(useBuilderStore.getState().selectedIds).toEqual([id]);
  });

  it('Clock rail: app on the left, a brand clock panel on the right', () => {
    const v = app('vimeo');
    applyStarterLayout(v, layout(v, 'clock-rail'), { url: VIMEO, muted: 'true' });
    const [a, c] = zones();
    expect(a.widgetType).toBe('STREAMING');
    expect(c.widgetType).toBe('CLOCK');
    expect(a.x + a.width).toBe(c.x);
    expect(c.x + c.width).toBe(100);
    expect((c.defaultConfig as Record<string, unknown>).bgColor).toContain('--brand-primary');
  });

  it('works BEFORE a link is typed: the app slot is a "Set up" zone and asks for the caret', () => {
    const v = app('vimeo');
    const id = applyStarterLayout(v, layout(v, 'full-bleed-titled'), { url: '', muted: 'true' })!;
    const appZone = zones().find((z) => z.id === id)!;
    expect(appZoneInfo(appZone)?.pending).toBe(true);
    expect(takeAppSetupFocus(id)).toBe(true);
  });

  it('from a zone\'s setup card the layout REPLACES that zone', () => {
    const pendingId = addAppZone(app('vimeo'))!;
    const v = app('vimeo');
    applyStarterLayout(v, layout(v, 'clock-rail'), { url: VIMEO, muted: 'true' }, { replaceZoneId: pendingId });
    expect(zones().some((z) => z.id === pendingId)).toBe(false);
    expect(zones().map((z) => z.widgetType)).toEqual(['STREAMING', 'CLOCK']);
  });

  it('keeps other content on a preset, stacking the layout above it', () => {
    useBuilderStore.setState({
      zones: [
        { id: 'logo', name: 'Logo', widgetType: 'LOGO', x: 2, y: 2, width: 10, height: 10, zIndex: 3, sortOrder: 0, defaultConfig: {} },
        { id: 'txt', name: 'Text', widgetType: 'TEXT', x: 20, y: 20, width: 30, height: 10, zIndex: 4, sortOrder: 1, defaultConfig: { content: 'Hi' } },
      ],
    });
    const v = app('vimeo');
    applyStarterLayout(v, layout(v, 'full-bleed-titled'), { url: VIMEO, muted: 'true' });
    expect(zones().map((z) => z.id).slice(0, 2)).toEqual(['logo', 'txt']);
    expect(zones()).toHaveLength(4);
    expect(Math.min(...zones().slice(2).map((z) => z.zIndex))).toBeGreaterThan(4);
  });

  it('is ONE undo step — Undo restores exactly the board before, Redo brings the layout back', () => {
    const pendingId = addAppZone(app('vimeo'))!;
    const before = zones().map((z) => z.id);
    const pastLen = useBuilderStore.getState().past.length;
    const v = app('vimeo');
    applyStarterLayout(v, layout(v, 'clock-rail'), { url: VIMEO, muted: 'true' }, { replaceZoneId: pendingId });
    expect(useBuilderStore.getState().past.length).toBe(pastLen + 1);
    const after = zones().map((z) => z.id);
    useBuilderStore.getState().undo();
    expect(zones().map((z) => z.id)).toEqual(before);
    useBuilderStore.getState().redo();
    expect(zones().map((z) => z.id)).toEqual(after);
  });

  it('every layout of every app plans the zones it builds (card = result)', () => {
    for (const a of APP_REGISTRY) {
      for (const l of a.starterLayouts ?? []) {
        useBuilderStore.setState({ zones: [BLANK], past: [], future: [], selectedIds: [] });
        const plan = planStarterLayout(a, l, {});
        expect(plan.filter((z) => z.role === 'app')).toHaveLength(1);
        applyStarterLayout(a, l, {});
        const built = zones();
        expect(built.map((z) => [z.widgetType, z.x, z.y, z.width, z.height])).toEqual(
          plan.map((z) => [z.widgetType, z.x, z.y, z.width, z.height]),
        );
        // No decoration-only TEXT zone: an empty TEXT renders "Your text here".
        for (const z of built.filter((x) => x.widgetType === 'TEXT')) {
          expect(String((z.defaultConfig as Record<string, unknown>).content || '')).not.toBe('');
        }
        for (const z of built) {
          expect(z.x + z.width).toBeLessThanOrEqual(100);
          expect(z.y + z.height).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
