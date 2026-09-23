/**
 * Keeping / revising a POS-bound AI board (2026-09-22).
 *
 * create-designer reads the bindings back off the board, verifies every id
 * against THIS tenant's catalog for the board's connection, strips the rest,
 * and saves Codex's zone-config convention beside the html:
 *
 *   { html, posSync: true, dataSource: 'POS', posProvider, posConnectionId,
 *     posItemBindings: { 'item.N': '<externalId>' } }
 *
 * (the same shape ToastItemBindingsPanel writes and WidgetRenderer hands the
 * board as `menu.bindings`). refine-designer ("Edit with words") re-derives the
 * same config and returns it as `pos`.
 *
 * The boards are produced by the real binder (bindMenuRows) from a plan, the
 * way generate-designer/candidates hands them to the browser.
 */
import { TemplatesController } from './templates.controller';
import { bindMenuRows, type BindingPlan } from '../ai/menu-binding';

const menuItem = (externalId: string, name: string, priceCents: number, category: string) => ({
  id: `mi-${externalId}`, externalId, name, description: null, priceCents, priceOverridden: false, imageUrl: null,
  allergens: [], tags: [], category, categoryId: `cat-${category}`, sortOrder: 0, available: true, soldOut: false,
});

/** Location t1's Toast catalog, as MenuService resolves it. */
const TOAST_MENU = {
  locationTenantId: 't1',
  generatedAt: '2026-09-22T00:00:00.000Z',
  sourceConfigured: true,
  categories: [{ id: 'cat-Tacos', name: 'Tacos', sortOrder: 0, daypartId: null }],
  items: [menuItem('toast-birria', '3 Birria Tacos w/ consome', 1450, 'Tacos'), menuItem('toast-fish', 'Fish Taco', 450, 'Tacos')],
};

const CONNECTIONS = [
  { id: 'conn-own-toast', tenantId: 't1', providerId: 'toast', displayName: null, status: 'ACTIVE', statusReason: null, lastSyncedAt: null },
  { id: 'conn-foreign', tenantId: 't2', providerId: 'square', displayName: null, status: 'ACTIVE', statusReason: null, lastSyncedAt: null },
];

function planFor(connectionId: string, rows: Array<[string, string, number]>): BindingPlan {
  return {
    providerId: 'toast',
    providerName: 'Toast',
    connectionId,
    items: rows.map(([externalId, name, cents], n) => ({
      n, externalId, name, priceCents: cents, priceText: `$${(cents / 100).toFixed(2)}`, section: 'Tacos',
    })),
  };
}

function modelBoard(rowCount: number): string {
  const rows = Array.from({ length: rowCount }, (_, n) =>
    `<div class="row" data-menu-row="${n}"><span data-field="item.${n}.name">Row ${n}</span><span data-field="item.${n}.price">$1.00</span></div>`).join('');
  return `<!doctype html><html><head><style>.stage{width:1920px;height:1080px}</style></head><body><div class="stage"><h1 data-field="headline">Tacos</h1><div class="menu">${rows}</div></div></body></html>`;
}

/** A board as generate-designer/candidates returns it (bound by the server). */
const boundBoard = (connectionId: string, rows: Array<[string, string, number]>) =>
  bindMenuRows(modelBoard(rows.length), planFor(connectionId, rows)).html;

const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');

function harness() {
  const zones: any[] = [];
  const audits: any[] = [];
  const tx = {
    template: {
      create: jest.fn(async ({ data }: any) => ({ id: 'tpl-new', ...data })),
      findUnique: jest.fn(async () => ({ id: 'tpl-new', zones: zones.map((z, i) => ({ id: `z${i}`, ...z })), scenes: [] })),
    },
    templateScene: { create: jest.fn(async ({ data }: any) => ({ id: 'scene-1', ...data })) },
    templateZone: { create: jest.fn(async ({ data }: any) => { zones.push(data); return data; }) },
  };
  const prisma: any = {
    client: {
      $transaction: async (fn: any) => fn(tx),
      tenantBranding: { findUnique: jest.fn(async () => null) },
      auditLog: { create: jest.fn(async ({ data }: any) => { audits.push(data); return data; }) },
      tenant: { findUnique: jest.fn(async ({ where }: any) => (where.id === 't1' ? { parentId: null } : null)) },
      posProviderConnection: {
        findMany: jest.fn(async ({ where }: any) => CONNECTIONS.filter((c) => where.tenantId.in.includes(c.tenantId))),
      },
    },
  };
  const menu = {
    resolvePosMenuForLocation: jest.fn(async (_loc: string, o: any) =>
      o?.connectionId === 'conn-own-toast' ? TOAST_MENU : { ...TOAST_MENU, sourceConfigured: false, categories: [], items: [] }),
  };
  const ai = { refineDesignerBoard: jest.fn() };
  const controller = Object.create(TemplatesController.prototype) as TemplatesController;
  Object.assign(controller as any, { prisma, menu, ai, auditLogger: { warn: jest.fn() } });
  const req = { user: { tenantId: 't1', id: 'u1', role: 'SCHOOL_ADMIN' } };
  const savedConfig = () => JSON.parse(zones[0].defaultConfig);
  const auditDetails = () => JSON.parse(audits.find((a) => a.action === 'TEMPLATE_CREATED').details);
  return { controller, req, zones, savedConfig, auditDetails, ai, menu };
}

describe('create-designer — a POS-bound board is SAVED bound', () => {
  it('saves Codex\'s zone config beside the html: posSync / dataSource / posProvider / posConnectionId / posItemBindings', async () => {
    const h = harness();
    const html = boundBoard('conn-own-toast', [['toast-birria', '3 Birria Tacos w/ consome', 1450], ['toast-fish', 'Fish Taco', 450]]);
    await h.controller.createDesigner(h.req, { htmlBase64: b64(html), screenWidth: 1920, screenHeight: 1080 } as any);
    const cfg = h.savedConfig();
    expect(Object.keys(cfg)).toEqual(['html', 'posSync', 'dataSource', 'posProvider', 'posConnectionId', 'posItemBindings']);
    expect(cfg).toMatchObject({
      posSync: true,
      dataSource: 'POS',
      posProvider: 'toast',
      posConnectionId: 'conn-own-toast',
      posItemBindings: { 'item.0': 'toast-birria', 'item.1': 'toast-fish' },
    });
    expect(cfg.html).toContain('data-pos-item="toast-birria"');
    expect(h.menu.resolvePosMenuForLocation).toHaveBeenCalledWith('t1', { connectionId: 'conn-own-toast', includeUnavailable: true, ignoreDayparts: true });
    expect(h.auditDetails()).toMatchObject({ posProvider: 'toast', posBindings: 2, posBindingsDropped: 0 });
  });

  it('an id that is not in THIS tenant\'s catalog is dropped from the config AND unbound on the board', async () => {
    const h = harness();
    const html = boundBoard('conn-own-toast', [['toast-birria', '3 Birria Tacos w/ consome', 1450], ['tenant-b-item-guid', 'Their Item', 999]]);
    await h.controller.createDesigner(h.req, { htmlBase64: b64(html) } as any);
    const cfg = h.savedConfig();
    expect(cfg.posItemBindings).toEqual({ 'item.0': 'toast-birria' });
    expect(cfg.html).not.toContain('tenant-b-item-guid');
    expect(h.auditDetails().posBindingsDropped).toBe(1);
  });

  it('a board claiming ANOTHER tenant\'s connection is saved unbound — no POS config, no ids left on it', async () => {
    const h = harness();
    const html = boundBoard('conn-foreign', [['toast-birria', '3 Birria Tacos w/ consome', 1450]]);
    await h.controller.createDesigner(h.req, { htmlBase64: b64(html) } as any);
    const cfg = h.savedConfig();
    expect(Object.keys(cfg)).toEqual(['html']);
    expect(cfg.html).not.toContain('data-pos-item');
    expect(cfg.html).not.toContain('conn-foreign');
    // Verification read THIS tenant's connections only.
    expect(h.menu.resolvePosMenuForLocation).not.toHaveBeenCalled();
  });

  it('a board with no bindings saves { html } exactly as before', async () => {
    const h = harness();
    await h.controller.createDesigner(h.req, { htmlBase64: b64(modelBoard(2)) } as any);
    expect(Object.keys(h.savedConfig())).toEqual(['html']);
    expect(h.auditDetails()).not.toHaveProperty('posBindings');
  });
});

describe('refine-designer — "Edit with words" re-derives the bindings', () => {
  it('returns the zone config the board now carries', async () => {
    const h = harness();
    const html = boundBoard('conn-own-toast', [['toast-birria', '3 Birria Tacos w/ consome', 1450], ['toast-fish', 'Fish Taco', 450]]);
    h.ai.refineDesignerBoard.mockResolvedValue({ html, source: 'tenant', usage: null });
    const out: any = await h.controller.refineDesigner(h.req, { instruction: 'warmer colors', htmlBase64: b64(html) } as any);
    expect(out.pos).toEqual({
      posSync: true,
      dataSource: 'POS',
      posProvider: 'toast',
      posConnectionId: 'conn-own-toast',
      posItemBindings: { 'item.0': 'toast-birria', 'item.1': 'toast-fish' },
    });
  });

  it('pos: null when nothing on the revised board can be verified; absent for a board that was never bound', async () => {
    const h = harness();
    const foreign = boundBoard('conn-foreign', [['x', 'X', 100]]);
    h.ai.refineDesignerBoard.mockResolvedValue({ html: foreign, source: 'tenant', usage: null });
    const out: any = await h.controller.refineDesigner(h.req, { instruction: 'x', htmlBase64: b64(foreign) } as any);
    expect(out).toHaveProperty('pos', null);
    expect(out.html).not.toContain('data-pos-item');

    h.ai.refineDesignerBoard.mockResolvedValue({ html: modelBoard(1), source: 'tenant', usage: null });
    const plain: any = await h.controller.refineDesigner(h.req, { instruction: 'x', htmlBase64: b64(modelBoard(1)) } as any);
    expect(plain).not.toHaveProperty('pos');
  });
});
