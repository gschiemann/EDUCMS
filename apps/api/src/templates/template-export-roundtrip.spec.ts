/**
 * An export that silently drops what the builder holds is worse than no export:
 * the loss only shows up when someone reopens the file somewhere else.
 *
 * The 2026-09-15 audit found the envelope stopping at geometry and config, so a
 * touch kiosk came back flat — scenes gone, every tap action gone, every locked
 * zone unlocked. These assertions are on the real controller methods with the
 * database doubled.
 */
import { TemplatesController } from './templates.controller';

const TENANT = 'tenant-a';
const req = { user: { tenantId: TENANT, id: 'u1', role: 'SCHOOL_ADMIN' } };

/** A touch kiosk: two scenes, a locked zone, and a tap action. */
function kiosk() {
  return {
    id: 'tpl-1', tenantId: TENANT, name: 'Front desk kiosk',
    description: 'Lobby', category: 'CUSTOM', orientation: 'LANDSCAPE',
    screenWidth: 1920, screenHeight: 1080,
    bgColor: '#101820', bgImage: null, bgGradient: null,
    isTouchEnabled: true, idleResetMs: 45000,
    scenes: [
      { id: 'sc-home', name: 'Home', sortOrder: 0, isDefault: true },
      { id: 'sc-menu', name: 'Menu', sortOrder: 1, isDefault: false },
    ],
    zones: [
      {
        id: 'z1', name: 'Welcome', widgetType: 'TEXT', x: 5, y: 5, width: 40, height: 20,
        zIndex: 1, sortOrder: 0, defaultConfig: JSON.stringify({ content: 'Welcome' }),
        sceneId: 'sc-home', locked: true, touchAction: { type: 'goToScene', sceneId: 'sc-menu' },
      },
      {
        id: 'z2', name: 'Menu board', widgetType: 'IMAGE', x: 0, y: 30, width: 100, height: 60,
        zIndex: 2, sortOrder: 1, defaultConfig: JSON.stringify({ assetUrl: 'https://cdn/x.png' }),
        sceneId: 'sc-menu', locked: false, touchAction: null,
      },
    ],
  };
}

function controllerFor(tpl: any) {
  const prisma = {
    client: {
      template: { findFirst: jest.fn().mockResolvedValue(tpl) },
    },
  };
  return new TemplatesController(prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
}

describe('template export envelope', () => {
  it('carries the scenes, in order, with the default marked', async () => {
    const c: any = controllerFor(kiosk());
    const out = await c.exportTemplate(req, 'tpl-1');
    expect(out.template.scenes).toEqual([
      { name: 'Home', sortOrder: 0, isDefault: true },
      { name: 'Menu', sortOrder: 1, isDefault: false },
    ]);
  });

  it('places each zone in its scene BY NAME, because ids are regenerated on import', async () => {
    const c: any = controllerFor(kiosk());
    const out = await c.exportTemplate(req, 'tpl-1');
    expect(out.template.zones[0].sceneName).toBe('Home');
    expect(out.template.zones[1].sceneName).toBe('Menu');
    // An id would be meaningless in the destination account.
    expect(JSON.stringify(out.template)).not.toContain('sc-home');
  });

  it('carries zone locks and tap actions', async () => {
    const c: any = controllerFor(kiosk());
    const out = await c.exportTemplate(req, 'tpl-1');
    expect(out.template.zones[0].locked).toBe(true);
    expect(out.template.zones[0].touchAction).toEqual({ type: 'goToScene', sceneId: 'sc-menu' });
    // An unlocked zone stays absent rather than writing `locked: false`, so the
    // envelope keeps its "only include what is set" shape.
    expect(out.template.zones[1]).not.toHaveProperty('locked');
  });

  it('carries the touch mode and idle reset', async () => {
    const c: any = controllerFor(kiosk());
    const out = await c.exportTemplate(req, 'tpl-1');
    expect(out.template.isTouchEnabled).toBe(true);
    expect(out.template.idleResetMs).toBe(45000);
  });

  it('a plain board exports without inventing scene fields', async () => {
    const flat = { ...kiosk(), scenes: [], isTouchEnabled: false };
    flat.zones = flat.zones.map((z) => ({ ...z, sceneId: null, locked: false, touchAction: null }));
    const c: any = controllerFor(flat);
    const out = await c.exportTemplate(req, 'tpl-1');
    expect(out.template).not.toHaveProperty('scenes');
    expect(out.template).not.toHaveProperty('isTouchEnabled');
    expect(out.template.zones[0]).not.toHaveProperty('sceneName');
    expect(out.template.zones[0]).not.toHaveProperty('touchAction');
  });
});
