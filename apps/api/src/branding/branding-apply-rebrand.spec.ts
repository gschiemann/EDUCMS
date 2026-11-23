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
  opts: { auditFails?: boolean; branding?: unknown } = {},
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
      update: jest.fn(async (_a: any) => {
        calls.push('templateZone.update');
        return {};
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
      update: jest.fn(),
    },
    templateZone: { update: jest.fn() },
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
  const call = tx.templateZone.update.mock.calls.find(
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

  it("no brandKit snapshot: blanks only — the old values stay (today's behaviour)", async () => {
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
    expect(zoneWrite(tx, 't1-z2')).toMatchObject({
      schoolName: 'WESTRIDGE HIGH SCHOOL',
      schoolInitials: 'WHS',
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
    const touchedZones = tx.templateZone.update.mock.calls.map(
      (c: any[]) => c[0].where.id,
    );
    expect(touchedZones.every((id: string) => id.startsWith('mine-z'))).toBe(
      true,
    );
    expect(client.template.update).not.toHaveBeenCalled();
    expect(client.templateZone.update).not.toHaveBeenCalled();
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
    expect(second.tx.templateZone.update).not.toHaveBeenCalled();
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
