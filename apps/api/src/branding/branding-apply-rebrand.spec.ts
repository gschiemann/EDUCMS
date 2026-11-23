/**
 * POST /api/v1/branding/apply-to-templates — a rebrand reaches everything.
 *
 * Owner, before a demo: "when I update the branding it does give me the new
 * logo but it doesn't try to apply the new name and tagline". The endpoint
 * now writes the name / tagline / initials / logo too, replaces whatever the
 * template's PREVIOUS brand (its Template.brandKit snapshot) stamped, leaves
 * hand-typed text alone in fill-blanks, and records the new brand as the
 * template's snapshot — all in one transaction with the audit row.
 */
// The controller pulls in the scraper stack; the same mocks the sibling specs use keep ESM-only deps out of jest.
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (x: string) => x },
}));
jest.mock('./safe-fetch', () => ({
  safeFetch: jest.fn(),
  safeFetchBuffer: jest.fn(),
}));

import { BrandingController } from './branding.controller';
import type { PrismaService } from '../prisma/prisma.service';

const OLD_KIT = {
  displayName: 'Westridge High School',
  tagline: 'Home of the Wildcats',
  logoUrl: 'https://cdn.example/old-logo.png',
  palette: {
    primary: '#112233',
    accent: '#445566',
    ink: '#0a0a0a',
    surface: '#fafafa',
  },
  fontHeading: 'Oswald',
  fontBody: 'Inter',
};
const NEW_BRANDING = {
  tenantId: 'ten1',
  displayName: 'Buena Park Academy',
  tagline: 'Learning without limits',
  logoUrl: 'https://cdn.example/new-logo.png',
  logoSvgInline: null,
  faviconUrl: null,
  palette: {
    primary: '#aa0000',
    accent: '#00aa00',
    ink: '#222222',
    surface: '#ffffee',
  },
  fontHeading: 'Montserrat',
  fontBody: 'Lato',
  fontHeadingUrl: null,
  fontBodyUrl: null,
  sourceUrl: 'https://buenapark.example',
  scrapedAt: new Date('2026-11-01T00:00:00Z'),
};

type Tpl = {
  id: string;
  name: string;
  tenantId: string | null;
  isSystem: boolean;
  bgColor: string | null;
  bgGradient: string | null;
  bgImage: string | null;
  brandKit: unknown;
  zones: Array<{
    id: string;
    widgetType: string;
    defaultConfig: string | null;
  }>;
};

/** A board the OLD brand stamped (clone-time snapshot = OLD_KIT). */
function rebrandedBoard(
  id: string,
  tenantId: string | null,
  isSystem = false,
): Tpl {
  return {
    id,
    name: `Board ${id}`,
    tenantId,
    isSystem,
    bgColor: '#112233',
    bgGradient: 'linear-gradient(135deg, #112233 0%, #445566 100%)',
    bgImage: null,
    brandKit: OLD_KIT,
    zones: [
      {
        id: `${id}-z1`,
        widgetType: 'EXTERNAL_HTML',
        defaultConfig: JSON.stringify({
          color: '#0a0a0a',
          fontFamily: 'Oswald',
          accentColor: '#445566',
          brand: {
            primary: '#112233',
            accent: '#445566',
            fontDisplay: 'Oswald',
            fontBody: 'Inter',
          },
          textOverrides: {
            'brand.name': 'Westridge High School',
            'brand.tagline': 'Home of the Wildcats',
            'school.initials': 'WHS',
            'menu.special': 'Tacos',
          },
          imageOverrides: { 'brand.logo': 'https://cdn.example/old-logo.png' },
        }),
      },
      {
        id: `${id}-z2`,
        widgetType: 'HS_VARSITY',
        defaultConfig: JSON.stringify({
          schoolName: 'WESTRIDGE HIGH SCHOOL',
          schoolInitials: 'WHS',
        }),
      },
    ],
  };
}

function build(
  rows: Tpl[],
  opts: { auditFails?: boolean; branding?: unknown; zoneCount?: number } = {},
) {
  const calls: string[] = [];
  const tx = {
    template: {
      update: jest.fn(async (_a: any) => {
        calls.push('template.update');
        return {};
      }),
    },
    templateZone: {
      // The zone write is an updateMany constrained to the caller's own
      // (non-preset) template; anything but one row aborts the rebrand.
      updateMany: jest.fn(async (_a: any) => {
        calls.push('templateZone.updateMany');
        return { count: opts.zoneCount ?? 1 };
      }),
    },
    auditLog: {
      create: jest.fn(async (_a: any) => {
        calls.push('auditLog.create');
        if (opts.auditFails) throw new Error('audit store down');
        return {};
      }),
    },
  };
  const client = {
    tenantBranding: {
      findUnique: jest.fn(async () =>
        opts.branding === undefined ? NEW_BRANDING : opts.branding,
      ),
    },
    template: {
      // Honour the where the controller sends, so a scoping regression shows up as a touched row.
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter(
          (r) => r.tenantId === where.tenantId && r.isSystem === where.isSystem,
        ),
      ),
      findFirst: jest.fn(
        async ({ where }: any) =>
          rows.find(
            (r) => r.id === where.id && r.tenantId === where.tenantId,
          ) ?? null,
      ),
      update: jest.fn(),
    },
    templateZone: { update: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const prisma = { client } as unknown as PrismaService;
  const ctrl = new BrandingController(
    prisma,
    {} as never,
    { check: () => undefined } as never,
    {} as never,
  );
  return { ctrl, client, tx, calls };
}
const req = { user: { id: 'u1', tenantId: 'ten1' } } as never;

const zoneWrite = (tx: ReturnType<typeof build>['tx'], zoneId: string) => {
  const call = tx.templateZone.updateMany.mock.calls.find(
    (c: any[]) => c[0].where.id === zoneId,
  );
  return call ? JSON.parse(call[0].data.defaultConfig) : null;
};

describe('applyBrandToTemplates — rebrand', () => {
  it("a rebrand replaces the old brand's name, tagline, initials, logo, colours and fonts; hand-typed text stays", async () => {
    const { ctrl, tx } = build([rebrandedBoard('t1', 'ten1')]);
    const res: any = await ctrl.applyBrandToTemplates(req, {
      mode: 'fill-blanks',
    });

    const board = zoneWrite(tx, 't1-z1');
    expect(board.textOverrides).toMatchObject({
      'brand.name': 'Buena Park Academy',
      'school.name': 'Buena Park Academy',
      'brand.tagline': 'Learning without limits',
      'school.initials': 'BPA',
      'brand.monogram': 'B',
      'menu.special': 'Tacos',
    });
    expect(board.imageOverrides).toMatchObject({
      'brand.logo': 'https://cdn.example/new-logo.png',
      'school.logo': 'https://cdn.example/new-logo.png',
    });
    expect(board).toMatchObject({
      color: '#222222',
      fontFamily: 'Montserrat',
      accentColor: '#00aa00',
    });
    expect(board.brand).toMatchObject({
      primary: '#aa0000',
      accent: '#00aa00',
      fontDisplay: 'Montserrat',
      fontBody: 'Lato',
    });

    expect(zoneWrite(tx, 't1-z2')).toEqual({
      schoolName: 'BUENA PARK ACADEMY',
      schoolInitials: 'BPA',
      color: '#222222',
      fontFamily: 'Montserrat',
      accentColor: '#00aa00',
    });

    // Background was the old brand's gradient → the new one; the new brand becomes the snapshot.
    const tplWrite = tx.template.update.mock.calls[0][0];
    expect(tplWrite.where).toEqual({ id: 't1', tenantId: 'ten1' });
    expect(tplWrite.data).toMatchObject({
      bgColor: '#aa0000',
      bgGradient: 'linear-gradient(135deg, #aa0000 0%, #00aa00 100%)',
      brandKit: {
        displayName: 'Buena Park Academy',
        tagline: 'Learning without limits',
        logoUrl: 'https://cdn.example/new-logo.png',
        inheritedFrom: 'tenant-branding',
      },
    });

    expect(res).toMatchObject({
      count: 1,
      zonesPatched: 2,
      mode: 'fill-blanks',
      identityZonesPatched: { name: 2, tagline: 1, initials: 2, logo: 1 },
    });
    expect(res.templates).toEqual([{ id: 't1', name: 'Board t1' }]);
  });

  it('a hand-typed name survives fill-blanks and is replaced in override', async () => {
    const tpl = rebrandedBoard('t1', 'ten1');
    tpl.zones = [
      {
        id: 't1-z1',
        widgetType: 'EXTERNAL_HTML',
        defaultConfig: JSON.stringify({
          textOverrides: { 'brand.name': "Ms. Lopez's Room" },
        }),
      },
    ];

    const fill = build([tpl]);
    await fill.ctrl.applyBrandToTemplates(req, { mode: 'fill-blanks' });
    const kept = zoneWrite(fill.tx, 't1-z1');
    expect(kept.textOverrides['brand.name']).toBe("Ms. Lopez's Room");
    expect(kept.textOverrides['school.name']).toBe('Buena Park Academy'); // the blank alias still fills

    const over = build([tpl]);
    await over.ctrl.applyBrandToTemplates(req, { mode: 'override' });
    expect(zoneWrite(over.tx, 't1-z1').textOverrides['brand.name']).toBe(
      'Buena Park Academy',
    );
  });

  it('no brandKit snapshot: blanks (and renderer placeholders) only — the old values stay', async () => {
    const tpl = rebrandedBoard('t1', 'ten1');
    tpl.brandKit = null;
    const { ctrl, tx } = build([tpl]);
    await ctrl.applyBrandToTemplates(req, {});

    const board = zoneWrite(tx, 't1-z1');
    expect(board.textOverrides['brand.name']).toBe('Westridge High School');
    expect(board.textOverrides['school.name']).toBe('Buena Park Academy');
    expect(board.imageOverrides['brand.logo']).toBe(
      'https://cdn.example/old-logo.png',
    );
    expect(board.imageOverrides['school.logo']).toBe(
      'https://cdn.example/new-logo.png',
    );
    expect(board).toMatchObject({
      color: '#0a0a0a',
      fontFamily: 'Oswald',
      accentColor: '#445566',
    });
    expect(board.brand).toEqual({
      primary: '#112233',
      accent: '#445566',
      fontDisplay: 'Oswald',
      fontBody: 'Inter',
    });
    // The old name is not blank, not a previous brand and not HS_VARSITY's
    // placeholder ('WESTRIDGE WILDCATS'), so it stays. 'WHS' IS the Varsity
    // renderer's own placeholder for schoolInitials (its DEFAULTS), so since
    // 2026-11-23 it counts as nobody's and takes the organisation's initials.
    expect(zoneWrite(tx, 't1-z2')).toMatchObject({
      schoolName: 'WESTRIDGE HIGH SCHOOL',
      schoolInitials: 'BPA',
    });

    // The background is kept; the snapshot is still recorded so the NEXT rebrand can recognise this one.
    const tplWrite = tx.template.update.mock.calls[0][0];
    expect(tplWrite.data.bgColor).toBeUndefined();
    expect(tplWrite.data.bgGradient).toBeUndefined();
    expect(tplWrite.data.brandKit).toMatchObject({
      displayName: 'Buena Park Academy',
      tagline: 'Learning without limits',
    });
  });

  it('tenantless (system) and other-tenant templates are never touched', async () => {
    const { ctrl, client, tx } = build([
      rebrandedBoard('mine', 'ten1'),
      rebrandedBoard('system', null, true),
      rebrandedBoard('theirs', 'ten2'),
      rebrandedBoard('mine-system', 'ten1', true),
    ]);
    const res: any = await ctrl.applyBrandToTemplates(req, {
      mode: 'override',
    });

    expect(client.template.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 'ten1',
      isSystem: false,
    });
    expect(res.count).toBe(1);
    const touchedTemplates = tx.template.update.mock.calls.map(
      (c: any[]) => c[0].where,
    );
    expect(touchedTemplates).toEqual([{ id: 'mine', tenantId: 'ten1' }]);
    const touchedZones = tx.templateZone.updateMany.mock.calls.map(
      (c: any[]) => c[0].where.id,
    );
    expect(touchedZones.every((id: string) => id.startsWith('mine-z'))).toBe(
      true,
    );
    expect(client.template.update).not.toHaveBeenCalled();
    expect(client.templateZone.update).not.toHaveBeenCalled();
    expect(client.templateZone.updateMany).not.toHaveBeenCalled();
    // Every zone write carries the parent template's tenant constraint.
    for (const c of tx.templateZone.updateMany.mock.calls as any[][])
      expect(c[0].where).toEqual({
        id: c[0].where.id,
        templateId: 'mine',
        template: { tenantId: 'ten1', isSystem: false },
      });
  });

  it('writes the audit row inside the same transaction, with identity counts', async () => {
    const { ctrl, client, tx, calls } = build([rebrandedBoard('t1', 'ten1')]);
    await ctrl.applyBrandToTemplates(req, { mode: 'fill-blanks' });

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(calls[calls.length - 1]).toBe('auditLog.create');
    expect(client.auditLog.create).not.toHaveBeenCalled();
    const audit = tx.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({
      action: 'BRANDING_APPLY_TO_TEMPLATES',
      targetType: 'tenant',
      targetId: 'ten1',
      tenantId: 'ten1',
      userId: 'u1',
    });
    expect(JSON.parse(audit.details)).toEqual({
      mode: 'fill-blanks',
      templateCount: 1,
      zonesPatched: 2,
      templatesWithPreviousBrand: 1,
      identityZonesPatched: { name: 2, tagline: 1, initials: 2, logo: 1 },
    });
  });

  it('a failed audit write fails the request instead of reporting an unaudited rebrand', async () => {
    const { ctrl } = build([rebrandedBoard('t1', 'ten1')], {
      auditFails: true,
    });
    await expect(ctrl.applyBrandToTemplates(req, {})).rejects.toThrow(
      'audit store down',
    );
  });

  it('applying the same brand again changes no zone', async () => {
    const first = build([rebrandedBoard('t1', 'ten1')]);
    await first.ctrl.applyBrandToTemplates(req, {});
    const tpl = rebrandedBoard('t1', 'ten1');
    tpl.brandKit = first.tx.template.update.mock.calls[0][0].data.brandKit;
    tpl.zones = tpl.zones.map((z) => ({
      ...z,
      defaultConfig: JSON.stringify(zoneWrite(first.tx, z.id)),
    }));
    tpl.bgColor = '#aa0000';
    tpl.bgGradient = 'linear-gradient(135deg, #aa0000 0%, #00aa00 100%)';

    const second = build([tpl]);
    const res: any = await second.ctrl.applyBrandToTemplates(req, {});
    expect(res.zonesPatched).toBe(0);
    expect(second.tx.templateZone.updateMany).not.toHaveBeenCalled();
    // Nothing changed on the template either: no rewrite of its brandKit.
    expect(second.tx.template.update).not.toHaveBeenCalled();
  });

  it('runs with a transaction timeout a large tenant does not hit', async () => {
    const { ctrl, client } = build([rebrandedBoard('t1', 'ten1')]);
    await ctrl.applyBrandToTemplates(req, {});
    expect((client.$transaction.mock.calls[0] as any[])[1]).toEqual({
      timeout: 30_000,
      maxWait: 10_000,
    });
  });

  it('no tenant brand → 400, nothing written', async () => {
    const { ctrl, client } = build([rebrandedBoard('t1', 'ten1')], {
      branding: null,
    });
    await expect(ctrl.applyBrandToTemplates(req, {})).rejects.toMatchObject({
      response: { code: 'BRANDING_NOT_CONFIGURED' },
    });
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});

// ── Successive brands across the editor and Settings ─────────────────

const BRAND_B = {
  ...NEW_BRANDING,
  displayName: 'Crestview Prep',
  tagline: 'Rise together',
  logoUrl: 'https://cdn.example/b-logo.png',
  palette: {
    primary: '#0000aa',
    accent: '#aaaa00',
    ink: '#333333',
    surface: '#eeeeff',
  },
  fontHeading: 'Raleway',
  fontBody: 'Nunito',
};

/** What the editor's "Brand this template" writes for a brand (brand-kit-actions.ts brandZoneConfig). */
function editorStamped(b: typeof BRAND_B, id: string): Tpl['zones'] {
  return [
    {
      id: `${id}-z1`,
      widgetType: 'EXTERNAL_HTML',
      defaultConfig: JSON.stringify({
        brand: {
          primary: b.palette.primary,
          accent: b.palette.accent,
          fontDisplay: b.fontHeading,
          fontBody: b.fontBody,
        },
        textOverrides: {
          'brand.name': b.displayName,
          'school.name': b.displayName,
          'brand.tagline': b.tagline,
          'school.motto': b.tagline,
          'menu.special': 'Tacos',
        },
        imageOverrides: { 'brand.logo': b.logoUrl, 'school.logo': b.logoUrl },
      }),
    },
    {
      id: `${id}-z2`,
      widgetType: 'LOGO',
      defaultConfig: JSON.stringify({
        assetUrl: b.logoUrl,
        logoUrl: b.logoUrl,
        accentColor: b.palette.primary,
        color: b.palette.ink,
        schoolName: b.displayName,
        tagline: b.tagline,
      }),
    },
  ];
}

describe('a rebrand recognises what the editor stamped', () => {
  it('per-template adopt saves the detected tagline; the next rebrand replaces it', async () => {
    const tpl = rebrandedBoard('t1', 'ten1');
    tpl.brandKit = null;
    const adopt = build([tpl]);
    (adopt.ctrl as any).processBrandingAssets = jest.fn(async () => ({
      palette: BRAND_B.palette,
      logoUrl: BRAND_B.logoUrl,
      logoSvgInline: null,
      faviconUrl: null,
    }));
    await adopt.ctrl.adoptTemplateBranding(req, 't1', {
      displayName: BRAND_B.displayName,
      tagline: BRAND_B.tagline,
      sourceUrl: 'https://crestview.example',
      fonts: {
        heading: { family: BRAND_B.fontHeading },
        body: { family: BRAND_B.fontBody },
      },
    } as never);
    const adopted = adopt.tx.template.update.mock.calls[0][0].data.brandKit;
    expect(adopted).toMatchObject({
      displayName: 'Crestview Prep',
      tagline: 'Rise together',
    });

    // The editor stamps the adopted kit onto the canvas, then Settings rebrands.
    const next = rebrandedBoard('t1', 'ten1');
    next.brandKit = adopted;
    next.zones = editorStamped(BRAND_B, 't1');
    const rebrand = build([next]);
    await rebrand.ctrl.applyBrandToTemplates(req, { mode: 'fill-blanks' });
    const board = zoneWrite(rebrand.tx, 't1-z1');
    expect(board.textOverrides).toMatchObject({
      'brand.name': 'Buena Park Academy',
      'brand.tagline': 'Learning without limits',
      'school.motto': 'Learning without limits',
      'menu.special': 'Tacos',
    });
    expect(zoneWrite(rebrand.tx, 't1-z2')).toMatchObject({
      schoolName: 'Buena Park Academy',
      tagline: 'Learning without limits',
      logoUrl: 'https://cdn.example/new-logo.png',
    });
  });

  it('A (clone) -> editor stamps organisation brand B -> Settings rebrands to C: every B value becomes C', async () => {
    // Template cloned under A (OLD_KIT snapshot); the organisation is now B.
    const tpl = rebrandedBoard('t1', 'ten1');
    const record = build([tpl], { branding: BRAND_B });
    const recorded: any = await record.ctrl.recordTemplateBrandStamp(req, 't1');
    expect(recorded).toMatchObject({ ok: true, changed: true });
    const kit = record.tx.template.update.mock.calls[0][0].data.brandKit;
    // The snapshot (A) stays; B joins the history.
    expect(kit).toMatchObject({ displayName: 'Westridge High School' });
    expect(kit.stamped).toEqual([
      expect.objectContaining({
        displayName: 'Crestview Prep',
        tagline: 'Rise together',
        logoUrl: 'https://cdn.example/b-logo.png',
      }),
    ]);

    // Zones hold B (the editor's canvas, saved); the organisation rebrands to C.
    const next = rebrandedBoard('t1', 'ten1');
    next.brandKit = kit;
    next.zones = editorStamped(BRAND_B, 't1');
    const rebrand = build([next]);
    const res: any = await rebrand.ctrl.applyBrandToTemplates(req, {
      mode: 'fill-blanks',
    });

    const board = zoneWrite(rebrand.tx, 't1-z1');
    expect(board.textOverrides).toEqual({
      'brand.name': 'Buena Park Academy',
      'school.name': 'Buena Park Academy',
      'brand.restaurant': 'Buena Park Academy',
      'brand.tagline': 'Learning without limits',
      'school.motto': 'Learning without limits',
      'school.initials': 'BPA',
      'brand.initials': 'BPA',
      'brand.mark': 'BPA',
      'brand.monogram': 'B',
      'menu.special': 'Tacos',
    });
    expect(board.imageOverrides).toEqual({
      'brand.logo': 'https://cdn.example/new-logo.png',
      'school.logo': 'https://cdn.example/new-logo.png',
    });
    expect(board.brand).toEqual(styleTokensOf(NEW_BRANDING));
    expect(zoneWrite(rebrand.tx, 't1-z2')).toEqual({
      assetUrl: 'https://cdn.example/new-logo.png',
      logoUrl: 'https://cdn.example/new-logo.png',
      accentColor: '#00aa00',
      color: '#222222',
      fontFamily: 'Montserrat',
      schoolName: 'Buena Park Academy',
      tagline: 'Learning without limits',
    });
    expect(res.identityZonesPatched).toMatchObject({
      name: 2,
      tagline: 2,
      logo: 2,
    });
  });

  it('a canvas change the operator discarded is still covered: A values become C too', async () => {
    const tpl = rebrandedBoard('t1', 'ten1');
    const record = build([tpl], { branding: BRAND_B });
    await record.ctrl.recordTemplateBrandStamp(req, 't1');
    const next = rebrandedBoard('t1', 'ten1'); // zones still hold A
    next.brandKit = record.tx.template.update.mock.calls[0][0].data.brandKit;
    const rebrand = build([next]);
    await rebrand.ctrl.applyBrandToTemplates(req, { mode: 'fill-blanks' });
    expect(zoneWrite(rebrand.tx, 't1-z1').textOverrides).toMatchObject({
      'brand.name': 'Buena Park Academy',
      'brand.tagline': 'Learning without limits',
    });
  });

  it('after a rebrand, the replaced snapshot stays as history (a brand without a tagline does not strand the old one)', async () => {
    // Rebrand A -> C where C has no tagline: A's tagline stays (nothing to write).
    const noTagline = { ...NEW_BRANDING, tagline: null };
    const first = build([rebrandedBoard('t1', 'ten1')], {
      branding: noTagline,
    });
    await first.ctrl.applyBrandToTemplates(req, {});
    const afterFirst = rebrandedBoard('t1', 'ten1');
    afterFirst.brandKit =
      first.tx.template.update.mock.calls[0][0].data.brandKit;
    afterFirst.zones = afterFirst.zones.map((z) => ({
      ...z,
      defaultConfig: JSON.stringify(zoneWrite(first.tx, z.id)),
    }));
    expect(
      JSON.parse(afterFirst.zones[0].defaultConfig!).textOverrides[
        'brand.tagline'
      ],
    ).toBe('Home of the Wildcats');

    // Then C -> B (with a tagline): A's tagline is still recognised.
    const second = build([afterFirst], { branding: BRAND_B });
    await second.ctrl.applyBrandToTemplates(req, {});
    expect(zoneWrite(second.tx, 't1-z1').textOverrides['brand.tagline']).toBe(
      'Rise together',
    );
  });

  it('a default ink the first rebrand stamped is recognised by the next one', async () => {
    const noInk = {
      ...NEW_BRANDING,
      palette: { primary: '#aa0000', accent: '#00aa00' },
    };
    const tpl = rebrandedBoard('t1', 'ten1');
    tpl.brandKit = null;
    tpl.zones = [{ id: 't1-z1', widgetType: 'TEXT', defaultConfig: null }];
    const first = build([tpl], { branding: noInk });
    await first.ctrl.applyBrandToTemplates(req, {});
    expect(zoneWrite(first.tx, 't1-z1').color).toBe('#0f172a');
    const kit = first.tx.template.update.mock.calls[0][0].data.brandKit;
    expect(kit.appliedDefaults).toBe(true);

    const after = rebrandedBoard('t1', 'ten1');
    after.brandKit = kit;
    after.zones = [
      {
        id: 't1-z1',
        widgetType: 'TEXT',
        defaultConfig: JSON.stringify(zoneWrite(first.tx, 't1-z1')),
      },
    ];
    const second = build([after], { branding: BRAND_B });
    await second.ctrl.applyBrandToTemplates(req, {});
    expect(zoneWrite(second.tx, 't1-z1').color).toBe('#333333');
  });
});

describe('POST /branding/templates/:id/stamped', () => {
  it("is scoped to the caller's tenant, refuses presets, and audits in the same transaction", async () => {
    const theirs = build([rebrandedBoard('x', 'ten2')], { branding: BRAND_B });
    await expect(
      theirs.ctrl.recordTemplateBrandStamp(req, 'x'),
    ).rejects.toMatchObject({
      response: { code: 'BRANDING_TEMPLATE_NOT_FOUND' },
    });
    expect(theirs.client.template.findFirst.mock.calls[0][0].where).toEqual({
      id: 'x',
      tenantId: 'ten1',
    });
    expect(theirs.client.$transaction).not.toHaveBeenCalled();

    const preset = build([rebrandedBoard('p', 'ten1', true)], {
      branding: BRAND_B,
    });
    await expect(
      preset.ctrl.recordTemplateBrandStamp(req, 'p'),
    ).rejects.toMatchObject({
      response: { code: 'BRANDING_SYSTEM_TEMPLATE_NOT_ALLOWED' },
    });

    const mine = build([rebrandedBoard('t1', 'ten1')], { branding: BRAND_B });
    await mine.ctrl.recordTemplateBrandStamp(req, 't1');
    expect(mine.calls).toEqual(['template.update', 'auditLog.create']);
    expect(mine.tx.template.update.mock.calls[0][0].where).toEqual({
      id: 't1',
      tenantId: 'ten1',
    });
    expect(mine.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'RECORD_TEMPLATE_BRAND_STAMP',
      targetType: 'template',
      targetId: 't1',
      tenantId: 'ten1',
      userId: 'u1',
    });
  });

  it('recording the same brand twice writes nothing the second time', async () => {
    const first = build([rebrandedBoard('t1', 'ten1')], { branding: BRAND_B });
    await first.ctrl.recordTemplateBrandStamp(req, 't1');
    const tpl = rebrandedBoard('t1', 'ten1');
    tpl.brandKit = first.tx.template.update.mock.calls[0][0].data.brandKit;
    const second = build([tpl], { branding: BRAND_B });
    const res: any = await second.ctrl.recordTemplateBrandStamp(req, 't1');
    expect(res.changed).toBe(false);
    expect(second.client.$transaction).not.toHaveBeenCalled();
  });

  it('no organisation brand: 400, nothing written', async () => {
    const { ctrl, client } = build([rebrandedBoard('t1', 'ten1')], {
      branding: null,
    });
    await expect(
      ctrl.recordTemplateBrandStamp(req, 't1'),
    ).rejects.toMatchObject({ response: { code: 'BRANDING_NOT_CONFIGURED' } });
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});

function styleTokensOf(b: typeof NEW_BRANDING): Record<string, string> {
  return {
    primary: b.palette.primary,
    accent: b.palette.accent,
    text: b.palette.ink,
    surface: b.palette.surface,
    background: b.palette.primary,
    fontDisplay: b.fontHeading,
    fontBody: b.fontBody,
  };
}

// ── The gap #347's round-2 review named (2026-11-23) ──
// A template cloned BEFORE this rule carries no record of its source preset
// and often no brandKit. Its themed widgets still show the preset's sample
// name; fill-blanks now replaces that (the renderer's own placeholder) and
// fills the keys MS scenes read, while a name somebody typed stays.
describe('applyBrandToTemplates — a widget still showing its sample text', () => {
  function legacy(): Tpl {
    return {
      id: 'old',
      name: 'Cloned in 2026-06',
      tenantId: 'ten1',
      isSystem: false,
      bgColor: '#123456',
      bgGradient: null,
      bgImage: null,
      brandKit: null,
      zones: [
        {
          id: 'old-varsity',
          widgetType: 'HS_VARSITY',
          defaultConfig: JSON.stringify({
            schoolName: 'WESTRIDGE WILDCATS',
            schoolInitials: 'WHS',
            color: '#101010',
            fontFamily: 'Anton',
            accentColor: '#ff0000',
          }),
        },
        {
          id: 'old-logo',
          widgetType: 'LOGO',
          defaultConfig: JSON.stringify({
            variant: 'logo-ops',
            schoolName: 'Roosevelt Academy of Fine Arts',
            color: '#101010',
            fontFamily: 'Anton',
            accentColor: '#ff0000',
          }),
        },
        {
          id: 'old-arcade',
          widgetType: 'MS_ARCADE',
          defaultConfig: JSON.stringify({
            color: '#101010',
            fontFamily: 'Anton',
            accentColor: '#ff0000',
          }),
        },
      ],
    };
  }

  it('fill-blanks replaces the placeholder, fills the MS scene, keeps the typed name — and counts them', async () => {
    const { ctrl, tx } = build([legacy()]);
    const res: any = await ctrl.applyBrandToTemplates(req, {
      mode: 'fill-blanks',
    });

    expect(zoneWrite(tx, 'old-varsity')).toEqual({
      schoolName: 'BUENA PARK ACADEMY',
      schoolInitials: 'BPA',
      color: '#101010',
      fontFamily: 'Anton',
      accentColor: '#ff0000',
    });
    const logo = zoneWrite(tx, 'old-logo');
    expect(logo.schoolName).toBe('Roosevelt Academy of Fine Arts');
    expect(logo).toMatchObject({
      logoUrl: 'https://cdn.example/new-logo.png',
      assetUrl: 'https://cdn.example/new-logo.png',
      tagline: 'Learning without limits',
    });
    expect(zoneWrite(tx, 'old-arcade')).toEqual({
      'school.name': 'BUENA PARK ACADEMY',
      'school.logoUrl': 'https://cdn.example/new-logo.png',
      color: '#101010',
      fontFamily: 'Anton',
      accentColor: '#ff0000',
    });
    expect(res).toMatchObject({
      zonesPatched: 3,
      identityZonesPatched: { name: 2, tagline: 1, initials: 1, logo: 2 },
    });

    // The audit row rides in the same transaction, after every zone write.
    const audit = JSON.parse(tx.auditLog.create.mock.calls[0][0].data.details);
    expect(audit.identityZonesPatched).toEqual({
      name: 2,
      tagline: 1,
      initials: 1,
      logo: 2,
    });
    expect(audit.templatesWithPreviousBrand).toBe(0);
  });

  it('override still replaces the typed name', async () => {
    const { ctrl, tx } = build([legacy()]);
    await ctrl.applyBrandToTemplates(req, { mode: 'override' });
    expect(zoneWrite(tx, 'old-logo').schoolName).toBe('Buena Park Academy');
  });

  it("each zone write is constrained to the caller's own template, never a preset's", async () => {
    const { ctrl, tx } = build([legacy()]);
    await ctrl.applyBrandToTemplates(req, {});
    const wheres = (tx.templateZone.updateMany.mock.calls as any[][]).map(
      (c) => c[0].where,
    );
    expect(wheres.map((w) => w.id).sort()).toEqual([
      'old-arcade',
      'old-logo',
      'old-varsity',
    ]);
    for (const w of wheres) {
      expect(w.templateId).toBe('old');
      expect(w.template).toEqual({ tenantId: 'ten1', isSystem: false });
    }
  });

  it('a zone write that hits no row rolls the whole rebrand back (no audit row, no success)', async () => {
    const { ctrl, tx, calls } = build([legacy()], { zoneCount: 0 });
    await expect(ctrl.applyBrandToTemplates(req, {})).rejects.toThrow(
      /expected 1/,
    );
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(calls).not.toContain('auditLog.create');
    expect(tx.templateZone.updateMany).toHaveBeenCalledTimes(1);
  });
});
