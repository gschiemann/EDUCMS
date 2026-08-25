/**
 * StarterBoardService — the new-tenant "first board" seed.
 *
 * What's load-bearing here and therefore tested:
 *   1. IDEMPOTENCY. Running the seed twice must produce ONE template + ONE
 *      playlist. This is the whole guard: the seed is fire-and-forget from
 *      signup, so a retry / double-invoke must never leave a tenant with two
 *      "Welcome — Acme" boards.
 *   2. NOTHING GOES LIVE. The playlist is created unscheduled — no Schedule
 *      row — so a brand-new tenant's first board can't hijack a real screen.
 *   3. NEVER FAILS SIGNUP. Any DB error is swallowed; the method resolves.
 *   4. EVERY VERTICAL RESOLVES to a real, offerable (non-quarantined,
 *      non-superseded) preset — a retired preset id must not silently strand
 *      a whole industry with a blank dashboard.
 */
import { VERTICALS } from '@cms/api-types';
import {
  StarterBoardService,
  STARTER_PLAYLIST_NAME,
  STARTER_PRESET_CANDIDATES,
  applyBrandToZoneConfig,
  offerablePresetById,
  resolveStarterPreset,
  starterBoardName,
} from './starter-board.service';

type Row = Record<string, any>;

/** Minimal in-memory Prisma double — same shape/spirit as onboarding.service.spec. */
function createInMemoryPrisma() {
  const templates: Row[] = [];
  const zones: Row[] = [];
  const playlists: Row[] = [];
  const schedules: Row[] = [];
  const auditLogs: Row[] = [];
  const branding: Row[] = [];

  const matches = (row: Row, where: Row) =>
    Object.entries(where || {}).every(([k, v]) => row[k] === v);

  const client: any = {
    template: {
      count: async ({ where }: any) => templates.filter((t) => matches(t, where)).length,
      findFirst: async ({ where }: any) => templates.find((t) => matches(t, where)) || null,
      create: async ({ data }: any) => {
        const { zones: zoneCreate, ...rest } = data;
        const row = { id: `tpl-${templates.length + 1}`, createdAt: new Date(), ...rest };
        templates.push(row);
        for (const z of zoneCreate?.create ?? []) {
          zones.push({ id: `zone-${zones.length + 1}`, templateId: row.id, ...z });
        }
        return row;
      },
    },
    playlist: {
      findFirst: async ({ where }: any) => playlists.find((p) => matches(p, where)) || null,
      create: async ({ data }: any) => {
        const row = { id: `pl-${playlists.length + 1}`, createdAt: new Date(), ...data };
        playlists.push(row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const row = { id: `audit-${auditLogs.length + 1}`, createdAt: new Date(), ...data };
        auditLogs.push(row);
        return row;
      },
    },
    tenantBranding: {
      findUnique: async ({ where }: any) => branding.find((b) => matches(b, where)) || null,
    },
  };

  return { client, state: { templates, zones, playlists, schedules, auditLogs, branding } };
}

function makeService(client: any) {
  return new StarterBoardService({ client } as any);
}

describe('StarterBoardService', () => {
  describe('seedForNewTenant', () => {
    it('seeds ONE branded template + ONE unscheduled playlist for a fresh tenant', async () => {
      const mem = createInMemoryPrisma();
      const svc = makeService(mem.client);

      await svc.seedForNewTenant('tenant-1', 'user-1', 'K12', 'Rosewood Elementary');

      expect(mem.state.templates).toHaveLength(1);
      const tpl = mem.state.templates[0];
      expect(tpl.name).toBe('Welcome — Rosewood Elementary');
      expect(tpl.tenantId).toBe('tenant-1');
      expect(tpl.createdById).toBe('user-1');
      // Tenant-owned templates carry the tenant's own vertical.
      expect(tpl.vertical).toBe('K12');
      // It is a REAL board: the preset's zones came across.
      expect(mem.state.zones.length).toBeGreaterThan(0);
      expect(mem.state.zones.every((z) => z.templateId === tpl.id)).toBe(true);

      expect(mem.state.playlists).toHaveLength(1);
      expect(mem.state.playlists[0].name).toBe(STARTER_PLAYLIST_NAME);
      expect(mem.state.playlists[0].templateId).toBe(tpl.id);

      // NOTHING is published — no schedule row is ever written.
      expect(mem.state.schedules).toHaveLength(0);

      // §16 — the mutation is on the record.
      expect(mem.state.auditLogs.some((a) => a.action === 'STARTER_BOARD_SEEDED')).toBe(true);
    });

    it('is IDEMPOTENT — a second run adds no template and no playlist', async () => {
      const mem = createInMemoryPrisma();
      const svc = makeService(mem.client);

      await svc.seedForNewTenant('tenant-1', 'user-1', 'K12', 'Rosewood Elementary');
      await svc.seedForNewTenant('tenant-1', 'user-1', 'K12', 'Rosewood Elementary');

      expect(mem.state.templates).toHaveLength(1);
      expect(mem.state.playlists).toHaveLength(1);
      expect(mem.state.auditLogs.filter((a) => a.action === 'STARTER_BOARD_SEEDED')).toHaveLength(1);
    });

    it('skips a tenant that already owns a template (not a brand-new tenant)', async () => {
      const mem = createInMemoryPrisma();
      mem.state.templates.push({ id: 'existing', tenantId: 'tenant-1', name: 'Hand-built board' });
      const svc = makeService(mem.client);

      await svc.seedForNewTenant('tenant-1', 'user-1', 'K12', 'Rosewood Elementary');

      expect(mem.state.templates).toHaveLength(1);
      expect(mem.state.playlists).toHaveLength(0);
    });

    it('still seeds a tenant whose SIBLING tenant already has templates (scope check)', async () => {
      const mem = createInMemoryPrisma();
      mem.state.templates.push({ id: 'other', tenantId: 'tenant-2', name: 'Welcome — Other Co' });
      const svc = makeService(mem.client);

      await svc.seedForNewTenant('tenant-1', 'user-1', 'K12', 'Rosewood Elementary');

      expect(mem.state.templates.filter((t) => t.tenantId === 'tenant-1')).toHaveLength(1);
    });

    it('re-uses an existing "My first playlist" instead of creating a second one', async () => {
      const mem = createInMemoryPrisma();
      mem.state.playlists.push({ id: 'pl-existing', tenantId: 'tenant-1', name: STARTER_PLAYLIST_NAME });
      const svc = makeService(mem.client);

      await svc.seedForNewTenant('tenant-1', 'user-1', 'K12', 'Rosewood Elementary');

      expect(mem.state.playlists).toHaveLength(1);
      expect(mem.state.templates).toHaveLength(1);
    });

    it('NEVER throws — a DB failure is swallowed so signup always completes', async () => {
      const mem = createInMemoryPrisma();
      mem.client.template.create = async () => {
        throw new Error('connection terminated');
      };
      const svc = makeService(mem.client);

      await expect(
        svc.seedForNewTenant('tenant-1', 'user-1', 'K12', 'Rosewood Elementary'),
      ).resolves.toBeUndefined();
      expect(mem.state.playlists).toHaveLength(0);
    });

    it('names the board for the vertical — a QSR tenant gets a Menu, not a Welcome', async () => {
      const mem = createInMemoryPrisma();
      const svc = makeService(mem.client);

      await svc.seedForNewTenant('tenant-1', 'user-1', 'QSR', "Joe's Burgers");

      expect(mem.state.templates[0].name).toBe("Menu — Joe's Burgers");
      expect(mem.state.templates[0].vertical).toBe('QSR');
    });

    it('applies tenant branding to blanks when a TenantBranding row already exists', async () => {
      const mem = createInMemoryPrisma();
      mem.state.branding.push({
        tenantId: 'tenant-1',
        palette: { ink: '#123456', accent: '#abcdef', surface: '#fafafa' },
        fontHeading: 'Bitter',
        logoUrl: null,
        logoSvgInline: null,
        faviconUrl: null,
        fontBody: null,
        fontHeadingUrl: null,
        fontBodyUrl: null,
        displayName: 'Rosewood',
        sourceUrl: null,
        scrapedAt: null,
      });
      const svc = makeService(mem.client);

      await svc.seedForNewTenant('tenant-1', 'user-1', 'K12', 'Rosewood Elementary');

      const tpl = mem.state.templates[0];
      expect(tpl.brandKit).toBeTruthy();
      expect(tpl.brandKit.palette.ink).toBe('#123456');
      const cfg = JSON.parse(mem.state.zones[0].defaultConfig);
      expect(cfg.color).toBe('#123456');
      expect(cfg.fontFamily).toBe('Bitter');
    });
  });

  describe('resolveStarterPreset', () => {
    it('resolves a real, offerable preset for EVERY shipped vertical', () => {
      for (const vertical of VERTICALS) {
        const preset = resolveStarterPreset(vertical);
        expect(preset).toBeTruthy();
        expect(typeof preset!.id).toBe('string');
        expect(Array.isArray(preset!.zones)).toBe(true);
        expect(preset!.zones.length).toBeGreaterThan(0);
      }
    });

    it('every hand-listed candidate id is a live, offerable preset', () => {
      // Asserted per-ID rather than per-vertical on purpose: resolveStarterPreset
      // falls back, so a typo'd / retired / quarantined id would otherwise hide
      // behind the next candidate and silently downgrade that vertical's first
      // impression. This is the test that fails when someone retires a preset.
      const missing: string[] = [];
      for (const [vertical, ids] of Object.entries(STARTER_PRESET_CANDIDATES)) {
        for (const id of ids) {
          if (!offerablePresetById(id)) missing.push(`${vertical}:${id}`);
        }
      }
      expect(missing).toEqual([]);
    });

    it('covers every shipped vertical with its own candidate list', () => {
      const uncovered = VERTICALS.filter((v) => !STARTER_PRESET_CANDIDATES[v]?.length);
      expect(uncovered).toEqual([]);
    });

    it('falls back to the K12 welcome board for an unknown vertical', () => {
      expect(resolveStarterPreset('NOT_A_VERTICAL')?.id).toBe('preset-lobby-animated-rainbow');
      expect(resolveStarterPreset('')?.id).toBe('preset-lobby-animated-rainbow');
    });
  });

  describe('starterBoardName', () => {
    it('is deterministic — the same inputs always produce the guard name', () => {
      expect(starterBoardName('K12', 'Acme District')).toBe('Welcome — Acme District');
      expect(starterBoardName('k12', '  Acme District  ')).toBe('Welcome — Acme District');
      expect(starterBoardName('BAR', 'The Anchor')).toBe('Tap List — The Anchor');
      expect(starterBoardName('SPORTS', 'Ridge Arena')).toBe('Game Day — Ridge Arena');
    });

    it('degrades to the bare label when the tenant has no usable name', () => {
      expect(starterBoardName('K12', '')).toBe('Welcome');
      expect(starterBoardName('QSR', '   ')).toBe('Menu');
    });
  });

  describe('applyBrandToZoneConfig', () => {
    const brand = { ink: '#111111', fontHeading: 'Inter', palette: { accent: '#ff0000' } };

    it('fills only blanks — a preset that art-directed its own color keeps it', () => {
      const cfg = applyBrandToZoneConfig({ color: '#ffffff', title: 'Hi' }, brand);
      expect(cfg.color).toBe('#ffffff');
      expect(cfg.fontFamily).toBe('Inter');
      expect(cfg.accentColor).toBe('#ff0000');
      expect(cfg.title).toBe('Hi');
    });

    it('writes NOTHING when the tenant has no brand yet (the signup-time case)', () => {
      const cfg = applyBrandToZoneConfig({ title: 'Hi' }, { ink: null, fontHeading: null, palette: null });
      expect(cfg).toEqual({ title: 'Hi' });
    });

    it('accepts a JSON-string config and a null config', () => {
      expect(applyBrandToZoneConfig('{"title":"Hi"}', brand).title).toBe('Hi');
      expect(applyBrandToZoneConfig(null, brand).color).toBe('#111111');
      expect(applyBrandToZoneConfig('not json', brand).color).toBe('#111111');
    });
  });
});
