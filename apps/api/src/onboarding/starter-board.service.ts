/**
 * StarterBoardService — every brand-new tenant lands on a WORKING BOARD,
 * not an empty dashboard.
 *
 * THE PROBLEM (audit §20 / VERT-001). Signup → branding wizard → concierge →
 * dashboard used to seed sample INTEGRATIONS (SampleDataService) but ZERO
 * CONTENT: no template, no playlist, nothing an operator could look at and
 * say "that's my screen." The activation milestone we're buying is *"I saw my
 * branded content playing and I understood how to change it"* — and you cannot
 * hit that from a blank gallery.
 *
 * WHAT THIS DOES. On signup, exactly once per tenant:
 *   1. Clones ONE vertical-appropriate flagship preset into a REAL, tenant-owned
 *      `Template` named `<label> — <Tenant name>` ("Welcome — Rosewood
 *      Elementary", "Menu — Joe's Burgers", "Game Day — Ridge Arena").
 *   2. Creates ONE `Playlist` — "My first playlist" — whose `templateId` points
 *      at that board. NO `Schedule` row: the board is ready to look at and edit,
 *      but nothing is published to any real screen until the operator says so.
 *   3. Writes one AuditLog row (§16 — every privileged mutation is on the record).
 *
 * The clone follows the SAME rules as `POST /templates/from-preset/:presetId`
 * (templates.controller.ts `createFromPreset`): the preset's own designed theme
 * always wins, the tenant brand only fills BLANKS, and `brandKit` is attached so
 * the builder's brand panel lights up. At signup the tenant has no
 * `TenantBranding` row yet (the wizard runs after), so in practice every fill is
 * a no-op and the board rides its designed palette — the tenant's brand reaches
 * it at RENDER time through the `--brand-*` CSS vars, exactly like every other
 * surface. Re-running after the wizard (or an operator hitting "apply brand to
 * templates") paints it for real.
 *
 * NEVER FAILS SIGNUP. Same best-effort contract as SampleDataService: every
 * error is swallowed + logged. A tenant with no starter board is a slightly
 * worse first run; a tenant with no ACCOUNT is a lost customer.
 *
 * IDEMPOTENT, TWO WAYS:
 *   (a) a tenant that already owns ANY template is skipped outright — the
 *       "brand-new tenant" precondition is false, so there is nothing to seed;
 *   (b) belt-and-suspenders, the deterministic starter NAME is checked before
 *       the insert, so a re-run after a tenant rename still can't double up.
 * Same pair of guards on the playlist.
 *
 * Presets are resolved from the IN-MEMORY packs, never from the DB: the boot
 * seeder (`ensure-system-presets.ts`) may not have reconciled a brand-new
 * preset id yet, and reading a system row by bare id is exactly the unscoped
 * access the TEN-001 gate exists to stop. Quarantined + superseded ids are
 * filtered out so a new tenant can never be handed a board the catalog has
 * already pulled from the gallery.
 */
import { Injectable, Logger } from '@nestjs/common';
import { QUARANTINED_BOARD_URLS } from '@cms/api-types';
import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_TEMPLATE_PRESETS, type SystemPreset } from '../templates/system-presets';
import { FITNESS_TEMPLATE_PRESETS } from '../templates/fitness-presets';
import { RESTAURANT_TEMPLATE_PRESETS } from '../templates/restaurant-presets';
import { BAR_TEMPLATE_PRESETS } from '../templates/bar-presets';
import { RETAIL_TEMPLATE_PRESETS } from '../templates/retail-presets';
import { SPORTS_TEMPLATE_PRESETS } from '../templates/sports-presets';
import { WORSHIP_TEMPLATE_PRESETS } from '../templates/worship-presets';
import { SUPERSEDED_PRESET_IDS } from '../templates/ensure-system-presets';

/** The one playlist a new tenant gets. Deterministic — it is also the guard. */
export const STARTER_PLAYLIST_NAME = 'My first playlist';

/** Every preset pack, unioned — the same set `ensure-system-presets` seeds. */
const ALL_PRESETS: SystemPreset[] = [
  ...SYSTEM_TEMPLATE_PRESETS,
  ...FITNESS_TEMPLATE_PRESETS,
  ...RESTAURANT_TEMPLATE_PRESETS,
  ...BAR_TEMPLATE_PRESETS,
  ...RETAIL_TEMPLATE_PRESETS,
  ...SPORTS_TEMPLATE_PRESETS,
  ...WORSHIP_TEMPLATE_PRESETS,
];

/**
 * The FIRST JOB per vertical — an ordered candidate list, best first.
 *
 * Each entry is the flagship "this is what your screen does all day" board for
 * that industry, deliberately picked from the design-reviewed set:
 *   • K12    → the Animated Rainbow welcome scene (the repo's gold-standard
 *              template, every field editable in PropertiesPanel)
 *   • GYM    → the fitness Lobby Welcome (class schedule + clock + weather)
 *   • QSR    → a real menu board with POS sync already toggled on
 *   • BAR    → the tap list
 *   • SPORTS → tonight's game
 *   • …everything else → that vertical's flagship lobby/welcome board
 *
 * Fallbacks exist so retiring one preset can never strand a whole vertical, and
 * `resolveStarterPreset` degrades to the K12 welcome if a list ever goes empty.
 * Keep every id here in the packs above — `starter-board.spec.ts` asserts it.
 */
export const STARTER_PRESET_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  K12: ['preset-lobby-animated-rainbow', 'preset-lobby-animated-middle', 'preset-lobby-animated-high'],
  GYM: ['fitness-lobby-welcome', 'preset-sig-gym-01'],
  RETAIL: ['preset-sig-retail-01', 'preset-sig-retail-02'],
  CORPORATE: ['preset-sig-corporate-01', 'preset-sig-office-01'],
  QSR: ['qsr-modern-burger', 'preset-sig-qsr-12'],
  FASHION: ['preset-sig-fashion-01', 'preset-sig-fashion-02'],
  BAR: ['bar-tap-list-board', 'preset-sig-bar-01'],
  HEALTHCARE: ['preset-sig-healthcare-01', 'preset-sig-clinic-01'],
  HOSPITALITY: ['preset-sig-hospitality-01', 'preset-sig-museum-01'],
  RESTAURANT: ['preset-sig-menus-pos-01', 'qsr-modern-burger'],
  SPORTS: ['sports-gameday-tonight', 'sports-gameday-lineup'],
  WORSHIP: ['preset-sig-worship-01', 'preset-sig-worship-02'],
};

/**
 * What this vertical's first board IS, in the operator's own words. Used as the
 * template-name prefix so a restaurant doesn't open the gallery to a board
 * called "Welcome — Joe's Burgers" when it is plainly a menu.
 */
export const STARTER_BOARD_LABEL: Readonly<Record<string, string>> = {
  QSR: 'Menu',
  RESTAURANT: 'Menu',
  BAR: 'Tap List',
  SPORTS: 'Game Day',
};

const DEFAULT_LABEL = 'Welcome';

/** The EXTERNAL_HTML board url a single-scene preset points at, if any. */
function presetBoardUrl(preset: SystemPreset): string | undefined {
  for (const z of preset.zones || []) {
    const url = (z.defaultConfig as any)?.url;
    if (typeof url === 'string' && url) return url;
  }
  return undefined;
}

/** A preset the catalog has pulled — quarantined (quality/legal) or superseded. */
function isOfferable(preset: SystemPreset): boolean {
  if (SUPERSEDED_PRESET_IDS.has(preset.id)) return false;
  const url = presetBoardUrl(preset);
  return !(url != null && QUARANTINED_BOARD_URLS.has(url));
}

/**
 * The starter board name for a tenant. Pure + deterministic — this doubles as
 * the idempotency guard, so it must be a function of (vertical, tenant name)
 * only. Tenant names get trimmed/capped so a pathological 500-char org name
 * can't blow past the column's practical width.
 */
export function starterBoardName(vertical: string, tenantName: string): string {
  const v = (vertical || 'K12').toUpperCase();
  const label = STARTER_BOARD_LABEL[v] || DEFAULT_LABEL;
  const name = (tenantName || '').trim().slice(0, 120);
  return name ? `${label} — ${name}` : label;
}

/**
 * One preset by id, but ONLY if the catalog still offers it. Exported so the
 * spec can assert every hand-listed candidate above is a live, offerable id
 * (a retired preset must fail the test, not silently fall through).
 */
export function offerablePresetById(id: string): SystemPreset | null {
  const preset = ALL_PRESETS.find((p) => p.id === id);
  return preset && isOfferable(preset) ? preset : null;
}

/**
 * Pick the preset to clone for a vertical. Walks the candidate list, skipping
 * ids that no longer exist in the packs or that the catalog has pulled, then
 * falls back to the K12 welcome board (which is never quarantined) so this can
 * only return null in a tree where the preset packs themselves are broken.
 */
export function resolveStarterPreset(vertical: string): SystemPreset | null {
  const v = (vertical || 'K12').toUpperCase();
  const ordered = [
    ...(STARTER_PRESET_CANDIDATES[v] || []),
    ...(v === 'K12' ? [] : STARTER_PRESET_CANDIDATES.K12),
  ];
  for (const id of ordered) {
    const preset = offerablePresetById(id);
    if (preset) return preset;
  }
  return null;
}

/**
 * Fill-blanks brand merge for one zone's defaultConfig.
 *
 * Mirrors `TemplatesController.applyBrandToZoneConfig` (the from-preset path)
 * on purpose: the preset's designed theme always wins, and a NULL brand value
 * writes NOTHING — critical here, because at signup there is no TenantBranding
 * row and a "default ink" would repaint boards that were art-directed to be
 * light-on-dark. The HS_* school-identity fill lives only in the controller;
 * no HS_* widget appears in any starter candidate above.
 */
export function applyBrandToZoneConfig(
  raw: unknown,
  brand: { ink: string | null; fontHeading: string | null; palette: any | null },
): Record<string, any> {
  const cfg: Record<string, any> = (() => {
    if (!raw) return {};
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }
    if (typeof raw === 'object') return { ...(raw as Record<string, any>) };
    return {};
  })();
  if (brand.ink && cfg.color === undefined) cfg.color = brand.ink;
  if (brand.fontHeading && cfg.fontFamily === undefined) cfg.fontFamily = brand.fontHeading;
  const accent = brand.palette?.accent;
  if (accent && cfg.accentColor === undefined) cfg.accentColor = accent;
  return cfg;
}

@Injectable()
export class StarterBoardService {
  private readonly logger = new Logger(StarterBoardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Seed the tenant's first board + playlist. Best-effort, idempotent.
   *
   * Called from `OnboardingService.signup()` right beside the sample-data seed,
   * fire-and-forget, so nothing here can slow down or fail account creation.
   *
   * @param tenantId   Newly created tenant id.
   * @param userId     The first DISTRICT_ADMIN (template/playlist author + audit actor).
   * @param vertical   Tenant vertical (K12 | GYM | QSR | …) — picks the board.
   * @param tenantName Tenant display name — goes into the board's name.
   */
  async seedForNewTenant(
    tenantId: string,
    userId: string,
    vertical: string,
    tenantName: string,
  ): Promise<void> {
    try {
      const v = (vertical || 'K12').toUpperCase();
      const preset = resolveStarterPreset(v);
      if (!preset) {
        this.logger.warn(`starterBoard(${tenantId}): no offerable preset for vertical ${v} — skipping.`);
        return;
      }
      const name = starterBoardName(v, tenantName);

      // ─── Guard (a): a tenant that already owns content is not "brand new". ───
      const ownedTemplates = await this.prisma.client.template.count({ where: { tenantId } });
      if (ownedTemplates > 0) {
        this.logger.log(`starterBoard(${tenantId}): tenant already has ${ownedTemplates} template(s) — skipping.`);
        return;
      }
      // ─── Guard (b): deterministic-name check, survives a tenant rename. ───
      const dupe = await this.prisma.client.template.findFirst({
        where: { tenantId, name },
        select: { id: true },
      });
      if (dupe) {
        this.logger.log(`starterBoard(${tenantId}): "${name}" already exists — skipping.`);
        return;
      }

      const brand = await this.readBrandDefaults(tenantId);

      const template = await this.prisma.client.template.create({
        data: {
          tenantId,
          name,
          description: preset.description,
          category: preset.category,
          orientation: preset.orientation,
          schoolLevel: preset.schoolLevel ?? 'UNIVERSAL',
          // Tenant-owned templates inherit the tenant's own vertical (see the
          // Template.vertical comment in schema.prisma) so the gallery's
          // vertical filter and any per-vertical tooling read it correctly.
          vertical: v,
          screenWidth: preset.screenWidth || (preset.orientation === 'PORTRAIT' ? 2160 : 3840),
          screenHeight: preset.screenHeight || (preset.orientation === 'PORTRAIT' ? 3840 : 2160),
          // Preset theme first, brand surface only when the preset had no opinion.
          bgColor: preset.bgColor ?? brand.surface ?? null,
          bgGradient: preset.bgGradient ?? null,
          bgImage: preset.bgImage ?? null,
          brandKit: brand.brandKit ?? undefined,
          createdById: userId,
          zones: {
            create: (preset.zones || []).map((z, i) => {
              const cfg = applyBrandToZoneConfig(z.defaultConfig, brand);
              return {
                name: z.name,
                widgetType: z.widgetType,
                x: z.x,
                y: z.y,
                width: z.width,
                height: z.height,
                zIndex: z.zIndex ?? 0,
                sortOrder: z.sortOrder ?? i,
                defaultConfig: Object.keys(cfg).length ? JSON.stringify(cfg) : null,
              };
            }),
          },
        } as any,
        select: { id: true, name: true },
      });

      // ─── The playlist that holds it. NO Schedule row — nothing goes live on a
      //     real screen until the operator publishes it themselves. ───
      let playlistId: string | null = null;
      const existingPlaylist = await this.prisma.client.playlist.findFirst({
        where: { tenantId, name: STARTER_PLAYLIST_NAME },
        select: { id: true },
      });
      if (existingPlaylist) {
        playlistId = existingPlaylist.id;
      } else {
        const playlist = await this.prisma.client.playlist.create({
          data: {
            tenantId,
            name: STARTER_PLAYLIST_NAME,
            templateId: template.id,
            createdByUserId: userId,
          },
          select: { id: true },
        });
        playlistId = playlist.id;
      }

      // §16 — every privileged mutation leaves a row. Best-effort: a missing
      // audit row must not undo a board the operator can already see.
      await this.prisma.client.auditLog
        .create({
          data: {
            tenantId,
            userId,
            action: 'STARTER_BOARD_SEEDED',
            targetType: 'Template',
            targetId: template.id,
            details: JSON.stringify({
              presetId: preset.id,
              vertical: v,
              templateName: template.name,
              playlistId,
            }),
          },
        })
        .catch(() => {});

      this.logger.log(
        `starterBoard(${tenantId}, ${v}): seeded "${template.name}" from ${preset.id} + playlist ${playlistId}.`,
      );
    } catch (err: any) {
      // Non-fatal by design — signup already succeeded upstream.
      this.logger.warn(`starterBoard(${tenantId}) failed (non-fatal): ${err?.message ?? err}`);
    }
  }

  /**
   * Tenant brand defaults, same shape + fallback chain as
   * `TemplatesController.getBrandDefaults`. Returns all-null when the tenant has
   * no TenantBranding row yet (the normal case at signup) so every fill-blanks
   * merge above becomes a no-op.
   */
  private async readBrandDefaults(tenantId: string): Promise<{
    surface: string | null;
    ink: string | null;
    fontHeading: string | null;
    palette: any | null;
    brandKit: any | null;
  }> {
    const empty = { surface: null, ink: null, fontHeading: null, palette: null, brandKit: null };
    const b = await this.prisma.client.tenantBranding
      .findUnique({
        where: { tenantId },
        select: {
          palette: true,
          fontHeading: true,
          fontBody: true,
          logoUrl: true,
          logoSvgInline: true,
          faviconUrl: true,
          displayName: true,
          sourceUrl: true,
          scrapedAt: true,
          fontHeadingUrl: true,
          fontBodyUrl: true,
        },
      })
      .catch(() => null);
    if (!b) return empty;
    const palette = (b.palette as any) || {};
    return {
      surface: palette.surface || palette.surfaceAlt || null,
      ink: palette.ink || null,
      fontHeading: b.fontHeading,
      palette,
      // Same JSON shape BrandKitPanel writes via /branding/templates/:id/adopt,
      // so the builder's "this template's brand" preview lights up immediately.
      brandKit: {
        palette,
        logoUrl: b.logoUrl,
        logoSvgInline: b.logoSvgInline,
        faviconUrl: b.faviconUrl,
        fontHeading: b.fontHeading,
        fontBody: b.fontBody,
        fontHeadingUrl: b.fontHeadingUrl,
        fontBodyUrl: b.fontBodyUrl,
        displayName: b.displayName,
        sourceUrl: b.sourceUrl,
        scrapedAt: b.scrapedAt ? new Date(b.scrapedAt).toISOString() : null,
        inheritedAt: new Date().toISOString(),
        inheritedFrom: 'tenant-branding',
      },
    };
  }
}
