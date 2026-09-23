/**
 * POST /templates/generate-designer/candidates — the request the Concierge
 * actually sends (2026-09-22, AI Designer rework).
 *
 * The Concierge intake is spread straight into this request. When the tenant
 * has brand colors on file its `palette` is the string 'brand'; when the chat
 * named colors it is `{ colors: [...] }`. The schema used to accept only a hex
 * list, so both shapes answered 400 — on exactly the no-website "standard
 * items" run (report 02, P2 item 10). 'brand' now resolves server-side to the
 * tenant's saved palette.
 */
import { z } from 'zod';
import { TemplatesController, DesignerGenerateSchema } from './templates.controller';

function makeController(branding: any, captured: any[] = []) {
  const controller = Object.create(TemplatesController.prototype) as TemplatesController;
  (controller as any).prisma = {
    client: { tenantBranding: { findUnique: jest.fn(async () => branding) } },
  };
  (controller as any).ai = {
    generateDesignerBoardCandidates: jest.fn(async (opts: any) => {
      captured.push(opts);
      return { candidates: [], batchId: 'b1', source: 'tenant', usage: null };
    }),
  };
  return controller;
}

const req = { user: { tenantId: 't1', id: 'u1', role: 'SCHOOL_ADMIN' } } as any;

describe('DesignerGenerateSchema — palette shapes', () => {
  it('accepts a hex list, the Concierge\'s "brand", and { colors }', () => {
    expect(DesignerGenerateSchema.safeParse({ prompt: 'x', palette: ['#d83c21'] }).success).toBe(true);
    expect(DesignerGenerateSchema.safeParse({ prompt: 'x', palette: 'brand' }).success).toBe(true);
    expect(DesignerGenerateSchema.safeParse({ prompt: 'x', palette: { colors: ['#d83c21', '#f1c93a'] } }).success).toBe(true);
  });

  it('still rejects junk', () => {
    expect(DesignerGenerateSchema.safeParse({ prompt: 'x', palette: 5 }).success).toBe(false);
    expect(DesignerGenerateSchema.safeParse({ prompt: 'x', palette: 'rainbow' }).success).toBe(false);
    expect(DesignerGenerateSchema.safeParse({ prompt: 'x', palette: { colors: 'red' } }).success).toBe(false);
  });

  it('negative control: the old hex-list-only shape is what 400\'d the Concierge', () => {
    const OLD = z.object({ prompt: z.string(), palette: z.array(z.string().max(32)).max(12).optional() });
    expect(OLD.safeParse({ prompt: 'x', palette: 'brand' }).success).toBe(false);
    expect(OLD.safeParse({ prompt: 'x', palette: { colors: ['#fff'] } }).success).toBe(false);
  });

  it('carries purpose and sampleMenu', () => {
    const r = DesignerGenerateSchema.safeParse({ prompt: 'x', purpose: 'menu', sampleMenu: true });
    expect(r.success && r.data.purpose).toBe('menu');
    expect(r.success && r.data.sampleMenu).toBe(true);
  });
});

describe('resolveDesignerPalette', () => {
  it("'brand' → the tenant's saved palette, primary first", async () => {
    const c = makeController({ palette: { primary: '#D83C21', accent: '#f1c93a', ink: '#2d1a13', surface: '#fffaf2' } });
    await expect(c.resolveDesignerPalette('t1', 'brand')).resolves.toEqual(['#d83c21', '#f1c93a', '#2d1a13', '#fffaf2']);
  });

  it("'brand' with nothing on file → no palette (the model chooses), never an error", async () => {
    await expect(makeController(null).resolveDesignerPalette('t1', 'brand')).resolves.toBeUndefined();
    await expect(makeController({ palette: {} }).resolveDesignerPalette('t1', 'brand')).resolves.toBeUndefined();
  });

  it('{ colors } unwraps; a hex list passes through; empty → undefined', async () => {
    const c = makeController(null);
    await expect(c.resolveDesignerPalette('t1', { colors: ['#123456', ' '] })).resolves.toEqual(['#123456']);
    await expect(c.resolveDesignerPalette('t1', ['#abcdef'])).resolves.toEqual(['#abcdef']);
    await expect(c.resolveDesignerPalette('t1', [])).resolves.toBeUndefined();
    await expect(c.resolveDesignerPalette('t1', undefined)).resolves.toBeUndefined();
  });

  it('the endpoint hands the resolved palette, the purpose and sampleMenu to the Designer', async () => {
    const captured: any[] = [];
    const c = makeController({ palette: { primary: '#d83c21', accent: '#f1c93a' } }, captured);
    await c.generateDesignerCandidates(req, { prompt: 'menu board', palette: 'brand', purpose: 'menu', sampleMenu: true } as any);
    expect(captured[0]).toMatchObject({ tenantId: 't1', palette: ['#d83c21', '#f1c93a'], purpose: 'menu', sampleMenu: true });
  });
});
