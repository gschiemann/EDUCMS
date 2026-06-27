import {
  Controller, Get, Post, Put, Delete, Body, Param, Query,
  UseGuards, Request, HttpException, HttpStatus, Header, Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { SYSTEM_TEMPLATE_PRESETS } from './system-presets';
import { FITNESS_TEMPLATE_PRESETS } from './fitness-presets';
import { verticalMatchOr } from './ensure-system-presets';
import { AiService, sanitizeTouchTemplate } from '../ai/ai.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import {
  TemplateNameOnlySchema, type TemplateNameOnlyInput,
  TemplateSceneUpdateSchema, type TemplateSceneUpdateInput,
  TemplateCreateSchema, type TemplateCreateInput,
  TemplateGenerateTouchSchema, type TemplateGenerateTouchInput,
  TemplateGenerateTouchCandidatesSchema, type TemplateGenerateTouchCandidatesInput,
  TemplateRefineSignageSchema, type TemplateRefineSignageInput,
  TemplateCreateFromCandidateSchema, type TemplateCreateFromCandidateInput,
  TemplateDuplicateSchema, type TemplateDuplicateInput,
  TemplateUpdateSchema, type TemplateUpdateInput,
  TemplateReplaceZonesSchema, type TemplateReplaceZonesInput,
} from '@cms/api-types';

@Controller('api/v1/templates')
@UseGuards(JwtAuthGuard, RbacGuard)
export class TemplatesController {
  private readonly auditLogger = new Logger('TemplatesController');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  /**
   * P0-4 (2026-05-28) — write a template mutation to the immutable
   * AuditLog. Before this, the entire templates module wrote ZERO audit
   * rows across 14+ mutating endpoints, so a bad admin could delete or
   * rewrite every layout in the tenant with no forensic trail.
   *
   * Best-effort (a DB hiccup must never fail the operator's save), but
   * NOT silent — a write failure logs at warn so a broken audit path is
   * visible rather than masquerading as covered. `AuditLog.tenantId` is
   * NOT NULL; every mutating template endpoint is gated by JwtAuthGuard
   * which loads `req.user.tenantId`, so it is always known here.
   */
  private async audit(
    req: any,
    action: 'TEMPLATE_CREATED' | 'TEMPLATE_UPDATED' | 'TEMPLATE_DELETED' | 'TEMPLATE_IMPORTED',
    templateId: string | null,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) return; // defensive — guard guarantees this, but never throw
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: req?.user?.id ?? null,
          action,
          targetType: 'Template',
          targetId: templateId,
          details: JSON.stringify(details),
        },
      });
    } catch (e: any) {
      this.auditLogger.warn(`audit(${action}, ${templateId}) failed: ${e?.message ?? e}`);
    }
  }

  // ───────────────────────────────────────────────────────
  // BRAND INHERITANCE HELPER (2026-05-04)
  // ───────────────────────────────────────────────────────
  // Operator: "i have added the branding to the templates multiple
  // times now but it doesnt seem to save that...should it or do you
  // need to add that every new template you make?"
  //
  // Before this fix new templates ignored TenantBranding entirely —
  // the operator had to open BrandKitPanel inside every template and
  // re-detect the brand for each one. That's correct per-template
  // override behavior, but the DEFAULT for a new template should be
  // "inherits the tenant brand" not "blank slate."
  //
  // This helper reads TenantBranding once and returns the values to
  // seed into Template.bgColor / Template.brandKit / per-zone
  // defaultConfig.color + fontFamily. ONLY fills blanks — if the
  // request body or source preset already supplied a color/font, we
  // keep it. That preserves intent on duplicate-from-preset (which
  // has its own carefully-chosen palette) while still branding bare
  // new templates that have no opinion.
  private async getBrandDefaults(tenantId: string): Promise<{
    surface: string | null;
    ink: string | null;
    fontHeading: string | null;
    fontBody: string | null;
    brandKit: any | null;
    // 2026-05-07 — surface displayName for HS preset auto-fill so a
    // freshly-cloned varsity / broadcast / yearbook template reads as
    // the tenant's actual school instead of the placeholder
    // "WESTRIDGE WILDCATS" defaults.
    displayName: string | null;
    palette: any | null;
  }> {
    const b = await this.prisma.client.tenantBranding.findUnique({
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
    }).catch(() => null);
    if (!b) return { surface: null, ink: null, fontHeading: null, fontBody: null, brandKit: null, displayName: null, palette: null };
    const palette = (b.palette as any) || {};
    const surface = palette.surface || palette.surfaceAlt || null;
    const ink = palette.ink || null;
    // Compose a Template.brandKit JSON identical in shape to what
    // BrandKitPanel writes via /branding/templates/:id/adopt, so the
    // editor's "this template's brand" preview lights up immediately.
    const brandKit = {
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
    };
    return { surface, ink, fontHeading: b.fontHeading, fontBody: b.fontBody, brandKit, displayName: b.displayName, palette };
  }

  /**
   * Merge brand defaults into a zone's defaultConfig only where blank.
   *
   * 2026-05-07 — operator: "our HS templates are not great looking
   * and they are all broken, no hotspots editable data".
   *
   * For HS_* widget types specifically, also fill in the school
   * identity placeholders (schoolName, schoolInitials, mascot
   * greeting) from the tenant's branding so a fresh template clone
   * reads as the tenant's actual school instead of the placeholder
   * "WESTRIDGE WILDCATS" defaults baked into the widget.
   *
   * Strict fill-blanks rule preserved — only writes a field when the
   * preset's defaultConfig didn't already specify one. Operator can
   * still override anything via the PropertiesPanel.
   */
  private applyBrandToZoneConfig(
    raw: any,
    brand: {
      ink: string | null;
      fontHeading: string | null;
      displayName?: string | null;
      palette?: any | null;
    },
    widgetType?: string,
  ): any {
    const cfg = (() => {
      if (!raw) return {};
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return {}; }
      }
      return { ...raw };
    })();
    if (brand.ink && cfg.color === undefined) cfg.color = brand.ink;
    if (brand.fontHeading && cfg.fontFamily === undefined) cfg.fontFamily = brand.fontHeading;

    // 2026-05-26 audit fix — paint the tenant palette onto widgets
    // that read accentColor (restaurant menu boards, retail grids,
    // sports composite elements, fitness widgets, themed clocks /
    // tickers). Strict fill-blanks: only writes when the preset's
    // own designed accent was undefined, so existing-customized zones
    // stay untouched. accentColor is a near-universal widget key
    // across all of those packs — grep
    //   apps/web/src/components/widgets -rn 'c.accentColor\|config.accentColor'
    // returns 60+ consumers spanning restaurant, retail, sports,
    // fitness, themed clock, weather, ticker, motivational, music.
    const palette = brand.palette || {};
    if (palette.accent && cfg.accentColor === undefined) {
      cfg.accentColor = palette.accent;
    }

    // HS-specific identity fill: every HS widget shares the same
    // school-identity field names (schoolName, schoolInitials,
    // schoolEst, department, greetingEyebrow). Pre-populate with the
    // tenant's brand so the demo doesn't open with placeholder text.
    if (widgetType?.startsWith('HS_') && brand.displayName) {
      const upper = brand.displayName.toUpperCase();
      const initials = brand.displayName
        .split(/[\s\-_/]+/)
        .filter(Boolean)
        .filter((w) => !/^(the|of|at|and|for|in|a|an)$/i.test(w))
        .slice(0, 3)
        .map((w) => w[0])
        .join('')
        .toUpperCase();
      if (cfg.schoolName === undefined) cfg.schoolName = upper;
      if (cfg.schoolInitials === undefined && initials.length > 0) cfg.schoolInitials = initials;
      // Mascot/team-name greeting eyebrow — best-guess from the
      // displayName. "Buena Park High School Bulldogs" → "BULLDOGS".
      // "Lincoln HS" → falls through (no extractable mascot).
      const mascotMatch = brand.displayName.match(/\b(eagles?|tigers?|lions?|bulldogs?|wildcats?|panthers?|knights?|spartans?|trojans?|warriors?|raiders?|cougars?|huskies|hawks?|falcons?|bears?|wolves|patriots?|chargers?|broncos?|mustangs?|cavaliers?|cardinals?|jaguars?|rams?|titans?|vikings?|pirates?|crusaders?|saints?|angels?|owls?|sharks?|dragons?|phoenix|colts?|hornets?|stallions?|rebels?|generals?|royals?|comets?|jets?|stars?|sun\s*devils?|gators?|terriers?|gophers?|gauchos?|aggies)\b/i);
      const mascot = mascotMatch?.[1]?.toUpperCase();
      if (cfg.greetingEyebrow === undefined && mascot) {
        cfg.greetingEyebrow = `GOOD MORNING, ${mascot}`;
      }
      // Department label — leave blank unless the widget has a way to
      // derive it (most don't).

      // Optional brand-color tints for HS widgets that read primary/
      // accent from config. Strict fill-blanks; preset's own theme
      // wins. (palette is the same hoisted var declared above for
      // the cross-widget accentColor pass.)
      if (palette.primary && cfg.brandPrimary === undefined) cfg.brandPrimary = palette.primary;
      if (palette.accent && cfg.brandAccent === undefined) cfg.brandAccent = palette.accent;
    }

    return cfg;
  }

  // ───────────────────────────────────────────────────────
  // LIST — tenant templates + system presets
  // ───────────────────────────────────────────────────────

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  // Gallery cache — `private` because the list is tenant-scoped (each
  // tenant sees their own templates + system presets matching their
  // vertical). 30s fresh window covers the common "click into a
  // template, hit back, see the gallery again" flow without an extra
  // round trip; SWR window keeps the gallery instant for ~2 minutes
  // after that while a background refresh fires. Verified: this
  // endpoint was 17-22s end-to-end on a 97-template tenant before the
  // payload trim that landed alongside this header (2026-05-09 perf
  // fix), the cache turns the second visit into a 0-RTT load.
  @Header('Cache-Control', 'private, max-age=30, stale-while-revalidate=120')
  async list(
    @Request() req: any,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('includeSystem') includeSystem?: string,
  ) {
    const tenantId = req.user.tenantId;

    // Resolve caller's vertical so we only surface templates that
    // belong in their product surface. A gym tenant must never see
    // EDU templates in the gallery and vice-versa — that was the
    // user feedback after the first fitness commit mixed the two.
    // Super-admins see everything when they switch into a tenant;
    // the tenant-switch endpoint stamps their session with the
    // target tenant's vertical, so this check works for them too.
    let callerVertical = 'K12';
    try {
      const tenant = await this.prisma.client.tenant.findUnique({
        where: { id: tenantId },
        select: { vertical: true } as any,
      });
      callerVertical = (tenant as any)?.vertical || 'K12';
    } catch {
      callerVertical = 'K12';
    }

    const where: any = {
      AND: [
        {
          OR: [
            { tenantId },
            // Always include system templates so teachers see presets
            ...(includeSystem !== 'false' ? [{ isSystem: true }] : []),
          ],
        },
        // Vertical gate: tenant templates are always shown (they
        // belong to this tenant); system templates must match the
        // caller's vertical. The `OR` expands both sides so a gym
        // still sees its own custom templates even if one slipped
        // through with a non-fitness vertical tag.
        {
          OR: [
            { tenantId }, // tenant's own — always theirs
            // System presets matching the caller's vertical. A preset can
            // be dual-tagged (pipe-delimited `Template.vertical`, e.g.
            // "QSR|RESTAURANT") so verticalMatchOr expands to match the
            // caller's single vertical anywhere in that list.
            { AND: [{ isSystem: true }, { OR: verticalMatchOr(callerVertical) }] },
          ],
        },
      ],
    };

    if (category) where.category = category;
    if (status) {
      where.status = status;
    } else {
      // Gallery must never show ARCHIVED templates. The boot seed
      // archives stale / deduplicated system presets via
      // ensure-system-presets.ts so the IDs stay referenceable by
      // older playlists, but they MUST disappear from the gallery
      // list so teachers don't see the 2025 draft next to the 2026
      // final. Explicit ?status=archived still works for admin UIs.
      where.AND.push({ status: { not: 'ARCHIVED' as any } });
    }

    // Payload trim (2026-05-09 — perf fix). Production smoke test had
    // /api/v1/templates returning 1-3 MB across 97 templates and the
    // gallery time-to-tiles was 17-22s. The thumbnails NEED zones +
    // defaultConfig (ScaledTemplateThumbnail renders the actual widget
    // tree at scale), but the gallery does NOT need:
    //   • Template.brandKit (JSON, sometimes 5-20 KB per row — only the
    //     builder reads this)
    //   • Template.thumbnail (legacy data URL, never used in v1 — the
    //     scaled live preview replaced it)
    //   • Template.isTouchEnabled / idleResetMs (builder-only)
    //   • TemplateZone.touchAction (builder-only Json blob)
    //   • TemplateZone.name (gallery shows widget names from registry,
    //     not zone display names)
    //   • Tenant / createdBy joins (never accessed in the gallery)
    // Switch from `include` to explicit `select` to enforce the trim
    // at the SQL layer — Prisma generates a SELECT with just these
    // columns, the JSON serializer never touches the rest. The
    // single-template `:id` endpoint below stays untouched (the
    // builder still needs everything).
    const templates = await this.prisma.client.template.findMany({
      where,
      select: {
        id: true,
        tenantId: true,
        name: true,
        description: true,
        category: true,
        orientation: true,
        schoolLevel: true,
        vertical: true,
        screenWidth: true,
        screenHeight: true,
        isSystem: true,
        status: true,
        bgColor: true,
        bgImage: true,
        bgGradient: true,
        createdAt: true,
        updatedAt: true,
        zones: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            widgetType: true,
            x: true,
            y: true,
            width: true,
            height: true,
            zIndex: true,
            sortOrder: true,
            defaultConfig: true,
          },
        },
        _count: { select: { zones: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { updatedAt: 'desc' }],
    });
    return templates.map(mapTemplate);
  }

  // ───────────────────────────────────────────────────────
  // GET — single template with all zones
  // ───────────────────────────────────────────────────────

  @Get('backdrops')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  // Lightweight endpoint for backdrop swatch picker — only 5 fields per
  // template, no zones, no parsing. Caches for 5 min; the picker rarely
  // changes backdrops on existing templates.
  @Header('Cache-Control', 'private, max-age=300, stale-while-revalidate=1800')
  async getBackdrops(@Request() req: any) {
    const tenantId = req.user.tenantId;

    // Resolve caller's vertical — same as GET /templates list()
    let callerVertical = 'K12';
    try {
      const tenant = await this.prisma.client.tenant.findUnique({
        where: { id: tenantId },
        select: { vertical: true } as any,
      });
      callerVertical = (tenant as any)?.vertical || 'K12';
    } catch {
      callerVertical = 'K12';
    }

    const templates = await this.prisma.client.template.findMany({
      where: {
        AND: [
          {
            OR: [
              { tenantId },
              { isSystem: true },
            ],
          },
          {
            OR: [
              { tenantId },
              // Dual-tag aware (see list() above) — matches the caller's
              // vertical anywhere in a pipe-delimited `Template.vertical`.
              { AND: [{ isSystem: true }, { OR: verticalMatchOr(callerVertical) }] },
            ],
          },
          { status: { not: 'ARCHIVED' as any } },
        ],
      },
      select: {
        id: true,
        name: true,
        bgColor: true,
        bgGradient: true,
        bgImage: true,
      },
      orderBy: [{ isSystem: 'desc' }, { updatedAt: 'desc' }],
    });

    return templates;
  }

  @Get('system/presets')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  // Immutable in-memory catalog — filtered by caller's vertical so a
  // gym tenant gets the fitness preset list and an EDU tenant gets
  // the K-12 list. Cache is `private` (per-user) to respect that
  // scoping at the edge.
  @Header('Cache-Control', 'private, max-age=600, stale-while-revalidate=3600')
  async getSystemPresets(@Request() req: any) {
    let vertical = 'K12';
    try {
      const tenant = await this.prisma.client.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: { vertical: true } as any,
      });
      vertical = (tenant as any)?.vertical || 'K12';
    } catch { /* default to K12 */ }
    // 2026-05-03 — operator: "I logged in as the gym user and it's all
    // school still." Tenant verticals are tagged 'GYM' (per the VenueOS
    // rebrand in 2026-05-02), but this endpoint was still checking the
    // old sprint-plan name 'FITNESS'. Result: gym tenants got the K-12
    // preset list. Accept BOTH spellings so existing 'FITNESS' tenants
    // (if any) keep working AND new 'GYM' tenants see the right catalog.
    if (vertical === 'GYM' || vertical === 'FITNESS') return FITNESS_TEMPLATE_PRESETS;
    return SYSTEM_TEMPLATE_PRESETS;
  }

  @Get('widget-types')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  // Pure static JSON catalog — same for every tenant. `public` lets
  // the Vercel edge + any upstream CDN cache-share this payload
  // across users instead of fetching it per-user as `private` did.
  @Header('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600')
  async getWidgetTypes() {
    return WIDGET_TYPE_CATALOG;
  }

  @Get(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async get(@Request() req: any, @Param('id') id: string) {
    const template = await this.prisma.client.template.findFirst({
      where: {
        id,
        OR: [{ tenantId: req.user.tenantId }, { isSystem: true }],
      },
      include: {
        zones: { orderBy: { sortOrder: 'asc' } },
        // 2026-05-12 — Phase D2 multi-scene model. Single-template
        // detail now includes the scenes list so the builder can
        // render the scene panel without a second round trip. Player
        // also uses this on goto-template navigation.
        scenes: { orderBy: { sortOrder: 'asc' } } as any,
        createdBy: { select: { id: true, email: true, role: true } },
      } as any,
    });
    if (!template) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return mapTemplate(template);
  }

  /**
   * 2026-05-14 — Player-facing template fetch for `goto-template`
   * touch navigation. Separate from `GET :id` because the regular
   * endpoint is RBAC-gated to user roles (SUPER_ADMIN /
   * DISTRICT_ADMIN / SCHOOL_ADMIN / CONTRIBUTOR) — the device JWT a
   * kiosk player carries has `kind: 'device'` with no user role, so
   * every `goto-template` action on a real kiosk silently 403'd. The
   * touch-diag toast showed "dispatcher fired: goto-template" with
   * a target ID, then nothing rendered.
   *
   * This `:id/playback` variant accepts device JWTs and scopes the
   * lookup by the device's bound screen → tenant. System templates
   * are visible to every device. Tenant-owned templates only fetch
   * if the device's screen.tenantId matches the template's tenantId
   * (or template.isSystem). 404 on mismatch — no existence-leak.
   *
   * User JWTs also work (same auth class is decoded by JwtAuthGuard);
   * for those we fall back to the same tenantId scoping as `GET :id`.
   * No new `@RequireRoles` here on purpose — RBAC is enforced by the
   * scope check in the where clause rather than the decorator, since
   * device JWTs have no role to compare against.
   */
  @Get(':id/playback')
  async getForPlayback(@Request() req: any, @Param('id') id: string) {
    const u = req.user || {};
    let scopeTenantId: string | null = null;
    if (u.kind === 'device') {
      // Look up the bound screen and resolve its tenant.
      const screen = await this.prisma.client.screen.findUnique({
        where: { id: u.sub },
        select: { tenantId: true, status: true },
      });
      if (!screen || screen.status === 'REVOKED') {
        throw new HttpException('Device invalid', HttpStatus.FORBIDDEN);
      }
      scopeTenantId = screen.tenantId ?? null;
    } else if (u.role === AppRole.SUPER_ADMIN) {
      // SUPER_ADMIN sees every tenant's templates — leave scope open.
      scopeTenantId = null;
    } else {
      scopeTenantId = u.schoolId || u.tenantId || u.districtId || null;
      if (!scopeTenantId) {
        // No tenant context at all → only system templates are
        // visible. This matches the existing GET :id behavior for
        // tenant-less users (none today, but defensive).
        scopeTenantId = '__no_tenant__';
      }
    }
    const template = await this.prisma.client.template.findFirst({
      where: {
        id,
        OR: scopeTenantId
          ? [{ tenantId: scopeTenantId }, { isSystem: true }]
          : [{ isSystem: true }, { tenantId: { not: null } as any }],
      },
      include: {
        zones: { orderBy: { sortOrder: 'asc' } },
        scenes: { orderBy: { sortOrder: 'asc' } } as any,
      } as any,
    });
    if (!template) {
      // 404 not 403 — same existence-leak avoidance pattern the
      // manifest endpoint uses for cross-tenant requests.
      throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
    }
    return mapTemplate(template);
  }

  // ───────────────────────────────────────────────────────
  // Phase D2 multi-scene CRUD — operators add/rename/reorder/delete
  // scenes inside a template. Every template has at minimum one
  // is_default=true scene (auto-created by the migration); the
  // controller blocks deletion of that scene to keep the invariant.
  //
  // All endpoints scope by `tenantId` so an operator from Tenant A
  // can't enumerate or mutate scenes on a Tenant B template (system
  // templates accept reads via the same OR pattern as the existing
  // get, but writes require ownership).
  // ───────────────────────────────────────────────────────

  @Get(':id/scenes')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async listScenes(@Request() req: any, @Param('id') id: string) {
    const tpl = await this.prisma.client.template.findFirst({
      where: { id, OR: [{ tenantId: req.user.tenantId }, { isSystem: true }] },
      select: { id: true } as any,
    });
    if (!tpl) throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
    return (this.prisma.client as any).templateScene.findMany({
      where: { templateId: id },
      orderBy: { sortOrder: 'asc' },
    });
  }

  @Post(':id/scenes')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async createScene(
    @Request() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TemplateNameOnlySchema)) body: TemplateNameOnlyInput,
  ) {
    const tpl = await this.assertOwnedTemplate(id, req.user.tenantId);
    const name = (body?.name || 'Untitled scene').trim().slice(0, 80);
    if (!name) throw new HttpException('name required', HttpStatus.BAD_REQUEST);
    const lastSort = await (this.prisma.client as any).templateScene.findFirst({
      where: { templateId: tpl.id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const sortOrder = (lastSort?.sortOrder ?? -1) + 1;
    try {
      const scene = await (this.prisma.client as any).templateScene.create({
        data: { templateId: tpl.id, name, sortOrder, isDefault: false },
      });
      await this.audit(req, 'TEMPLATE_UPDATED', tpl.id, { via: 'scene-create', sceneName: name });
      return scene;
    } catch (e: any) {
      // Unique (templateId, name) collision → return a friendly error.
      if (e?.code === 'P2002') {
        throw new HttpException(`A scene named "${name}" already exists in this template`, HttpStatus.CONFLICT);
      }
      throw e;
    }
  }

  @Put(':id/scenes/:sceneId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async updateScene(
    @Request() req: any,
    @Param('id') id: string,
    @Param('sceneId') sceneId: string,
    @Body(new ZodValidationPipe(TemplateSceneUpdateSchema)) body: TemplateSceneUpdateInput,
  ) {
    const tpl = await this.assertOwnedTemplate(id, req.user.tenantId);
    const scene = await (this.prisma.client as any).templateScene.findFirst({
      where: { id: sceneId, templateId: tpl.id },
    });
    if (!scene) throw new HttpException('Scene not found', HttpStatus.NOT_FOUND);

    const data: any = {};
    if (body.name !== undefined) {
      const trimmed = String(body.name).trim().slice(0, 80);
      if (!trimmed) throw new HttpException('name must be non-empty', HttpStatus.BAD_REQUEST);
      data.name = trimmed;
    }
    if (body.sortOrder !== undefined) {
      data.sortOrder = Math.max(0, Math.floor(Number(body.sortOrder) || 0));
    }

    // Setting isDefault=true is a special transaction: flip the
    // previous default off, flip this one on, all-or-nothing so we
    // never end up with zero (or two) default scenes.
    if (body.isDefault === true && !scene.isDefault) {
      const result = await this.prisma.client.$transaction(async (tx: any) => {
        await tx.templateScene.updateMany({
          where: { templateId: tpl.id, isDefault: true },
          data: { isDefault: false },
        });
        return tx.templateScene.update({
          where: { id: sceneId },
          data: { ...data, isDefault: true },
        });
      });
      await this.audit(req, 'TEMPLATE_UPDATED', tpl.id, { via: 'scene-update', sceneId, setDefault: true });
      return result;
    }

    if (Object.keys(data).length === 0 && body.isDefault === undefined) {
      throw new HttpException('Nothing to update', HttpStatus.BAD_REQUEST);
    }
    try {
      const result = await (this.prisma.client as any).templateScene.update({
        where: { id: sceneId },
        data,
      });
      await this.audit(req, 'TEMPLATE_UPDATED', tpl.id, { via: 'scene-update', sceneId, changedFields: Object.keys(data) });
      return result;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new HttpException(`A scene with that name already exists`, HttpStatus.CONFLICT);
      }
      throw e;
    }
  }

  @Delete(':id/scenes/:sceneId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async deleteScene(
    @Request() req: any,
    @Param('id') id: string,
    @Param('sceneId') sceneId: string,
  ) {
    const tpl = await this.assertOwnedTemplate(id, req.user.tenantId);
    const scene = await (this.prisma.client as any).templateScene.findFirst({
      where: { id: sceneId, templateId: tpl.id },
    });
    if (!scene) throw new HttpException('Scene not found', HttpStatus.NOT_FOUND);
    if (scene.isDefault) {
      throw new HttpException(
        'Cannot delete the default scene. Set a different scene as default first.',
        HttpStatus.BAD_REQUEST,
      );
    }
    // Zones belonging to THIS scene get re-pointed to the default
    // scene so they keep rendering for the visitor. Critical: we
    // capture their ids BEFORE the cascade fires so we don't
    // accidentally re-point intentionally-shared zones (those have
    // sceneId=null from the start and must stay null).
    //
    // Functional audit 2026-05-12 caught the original bug: matching
    // `WHERE sceneId IS NULL` after the cascade hit every shared zone
    // in the template, silently dragging logos/persistent UI into the
    // default scene and losing their shared status.
    const def = await (this.prisma.client as any).templateScene.findFirst({
      where: { templateId: tpl.id, isDefault: true },
    });
    const zonesOnDeletedScene = await this.prisma.client.templateZone.findMany({
      where: { templateId: tpl.id, sceneId } as any,
      select: { id: true },
    });
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.templateScene.delete({ where: { id: sceneId } });
      if (def && zonesOnDeletedScene.length > 0) {
        await tx.templateZone.updateMany({
          where: { id: { in: zonesOnDeletedScene.map((z: { id: string }) => z.id) } },
          data: { sceneId: def.id },
        });
      }
    });
    await this.audit(req, 'TEMPLATE_UPDATED', tpl.id, {
      via: 'scene-delete',
      sceneId,
      sceneName: scene.name,
      zonesReassigned: zonesOnDeletedScene.length,
    });
    return { ok: true };
  }

  // Shared owner-check helper. SUPER_ADMIN sees everything; everyone
  // else is gated to their own tenant. System templates (isSystem)
  // are read-only — writes 403.
  private async assertOwnedTemplate(templateId: string, tenantId: string): Promise<{ id: string; tenantId: string | null }> {
    const tpl = await this.prisma.client.template.findFirst({
      where: { id: templateId },
      select: { id: true, tenantId: true, isSystem: true } as any,
    });
    if (!tpl) throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
    if ((tpl as any).isSystem) {
      throw new HttpException('System templates are read-only', HttpStatus.FORBIDDEN);
    }
    if ((tpl as any).tenantId !== tenantId) {
      throw new HttpException('Not your template', HttpStatus.FORBIDDEN);
    }
    return tpl as any;
  }

  // ───────────────────────────────────────────────────────
  // CREATE — new template with optional initial zones
  // ───────────────────────────────────────────────────────

  @Post()
  // CONTRIBUTOR (Editor) creates templates in their OWN tenant — the body
  // tenantId is ignored; `create` stamps `tenantId: req.user.tenantId`. This
  // is content-building, NOT publishing (a template reaches a screen only via
  // a playlist + schedule, which stays gated). Without this, the builder's
  // "Save as copy" 403'd for Editors. (2026-06-09 — operator: "editor role
  // tries to save a template and it fails to save".)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async create(
    @Request() req: any,
    @Body(new ZodValidationPipe(TemplateCreateSchema)) body: TemplateCreateInput,
    // P0-4 internal flag: importTemplate() reuses this create path but
    // wants to audit as TEMPLATE_IMPORTED, not TEMPLATE_CREATED. The
    // flag is not a route param — Nest only injects the decorated
    // params; internal callers pass it positionally.
    skipAudit = false,
  ) {
    if (!body.name?.trim()) {
      throw new HttpException('Template name is required', HttpStatus.BAD_REQUEST);
    }

    // Validate zones don't overflow the canvas
    if (body.zones) {
      for (const zone of body.zones) {
        validateZoneBounds(zone);
      }
    }

    // Derive orientation from dimensions if not explicitly set
    const screenWidth = body.screenWidth || 3840;
    const screenHeight = body.screenHeight || 2160;
    const orientation = body.orientation || (screenHeight > screenWidth ? 'PORTRAIT' : 'LANDSCAPE');

    // Auto-inherit tenant brand. Only fills blanks — caller's body
    // values win. See getBrandDefaults() comment.
    const brand = await this.getBrandDefaults(req.user.tenantId);

    const result = await this.prisma.client.template.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name.trim(),
        description: body.description || null,
        category: body.category || 'CUSTOM',
        orientation,
        screenWidth,
        screenHeight,
        bgColor: body.bgColor || brand.surface || null,
        bgImage: body.bgImage || null,
        bgGradient: body.bgGradient || null,
        brandKit: brand.brandKit ?? undefined,
        createdById: req.user.id,
        zones: body.zones
          ? {
              create: body.zones.map((z, i) => {
                const cfg = this.applyBrandToZoneConfig(z.defaultConfig, brand, z.widgetType);
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
            }
          : undefined,
      },
      include: {
        zones: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!skipAudit) {
      await this.audit(req, 'TEMPLATE_CREATED', result.id, {
        name: result.name,
        category: result.category,
        zoneCount: result.zones?.length ?? 0,
        via: 'blank',
      });
    }
    return mapTemplate(result);
  }

  // ───────────────────────────────────────────────────────
  // CREATE FROM AI PROMPT (Phase D3 — 2026-05-12)
  // ───────────────────────────────────────────────────────
  // Operator types "lobby check-in kiosk with three tap-buttons" →
  // AI returns structured template JSON → we sanitize it server-side →
  // persist as a brand-new draft template the operator can iterate
  // on. Identical save-then-edit loop as create-from-preset, just
  // sourced from an LLM instead of a hand-curated preset.
  //
  // All validation lives in AiService.sanitizeTouchTemplate — by the
  // time we're inserting rows, the payload has already been clamped
  // to safe widget types, percent ranges, and TouchActionConfig
  // variants. No raw model output reaches Prisma.

  @Post('generate-touch')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async generateTouchTemplate(
    @Request() req: any,
    @Body(new ZodValidationPipe(TemplateGenerateTouchSchema)) body: TemplateGenerateTouchInput,
  ) {
    const result = await this.ai.generateTouchTemplate({
      tenantId: req.user.tenantId,
      userId: req.user.id, // 2026-05-26 audit AI-P0-4 — required for AuditLog
      prompt: body.prompt,
      screenWidth: body.screenWidth,
      screenHeight: body.screenHeight,
      vertical: body.vertical,
    });

    const screenWidth = body.screenWidth || 1920;
    const screenHeight = body.screenHeight || 1080;

    // Single-shot generate-touch is always interactive (touch). The
    // shared persist helper (Slice 1c) also backs create-from-candidate.
    const created = await this.persistGeneratedTemplate(
      req,
      result.parsed,
      screenWidth,
      screenHeight,
      true,
    );

    await this.audit(req, 'TEMPLATE_CREATED', created?.id ?? null, {
      name: created?.name,
      zoneCount: created?.zones?.length ?? 0,
      via: 'ai-touch',
      aiSource: result.source,
    });

    return {
      template: mapTemplate(created),
      ai: {
        source: result.source,
        usage: result.usage,
      },
    };
  }

  // ───────────────────────────────────────────────────────
  // CREATE FROM AI — 3-candidate fan-out + pick-a-winner (Slice 1c, 2026-06-16)
  // ───────────────────────────────────────────────────────
  // generate-touch/candidates returns up to 3 sanitized DRAFTS (NOT
  // persisted) so the operator picks the winner; create-from-candidate
  // persists the chosen one (re-sanitized — client JSON is never trusted).
  // Serves BOTH touch templates and passive (non-touch) signage via the
  // `interactive` flag (operator demand 2026-06-16: touch AND non-touch).

  @Post('generate-touch/candidates')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async generateTouchCandidates(
    @Request() req: any,
    @Body(new ZodValidationPipe(TemplateGenerateTouchCandidatesSchema)) body: TemplateGenerateTouchCandidatesInput,
  ) {
    // Wave 2 (2026-06-26) — opt-in ENGINE path. `engine:true` routes through
    // the signage-design art-director pipeline so each board is grid-locked +
    // theme'd + signage-scale typed instead of grey-text-on-white. Wave 2a
    // (2026-06-27): returns UP TO `count` (default 3) DISTINCT candidates —
    // Balanced / Bold / Detailed — each carrying its own `background` +
    // archetype/theme. (Previously returned only ONE, which the "Three takes"
    // picker rendered as a single left-hugging card.) The old non-engine
    // fan-out below is untouched when the flag is absent/false.
    // Wave 2a (2026-06-27) — "build a whole set": ONE (or many newline-separated)
    // prompts → ONE cohesive multi-scene template (4-6 boards, one theme) that
    // plays itself. Returns a SINGLE candidate whose scenes[] is the set; the
    // existing create-from-candidate path persists the scenes unchanged.
    if (body.set === true) {
      const out = await this.ai.generateSignageBoardSet({
        tenantId: req.user.tenantId,
        userId: req.user.id,
        prompt: body.prompt,
        screenWidth: body.screenWidth,
        screenHeight: body.screenHeight,
        vertical: body.vertical,
        count: body.count,
      });
      return {
        candidates: [out.candidate],
        engine: true,
        set: true,
        ai: { source: out.source, usage: out.usage },
      };
    }
    if (body.engine === true) {
      const out = await this.ai.generateSignageBoardCandidates({
        tenantId: req.user.tenantId,
        userId: req.user.id,
        prompt: body.prompt,
        screenWidth: body.screenWidth,
        screenHeight: body.screenHeight,
        vertical: body.vertical,
        count: body.count,
      });
      // Each candidate round-trips through create-from-candidate, which
      // re-sanitizes the zones and persists `background`. We carry the bg +
      // archetype/theme so the FE can show them + send them back.
      return {
        candidates: out.candidates,
        engine: true,
        ai: { source: out.source, usage: out.usage },
      };
    }

    const result = await this.ai.generateTouchTemplateCandidates({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      prompt: body.prompt,
      screenWidth: body.screenWidth,
      screenHeight: body.screenHeight,
      vertical: body.vertical,
      interactive: body.interactive !== false,
      count: body.count,
    });
    // Candidates are returned UNPERSISTED — the FE renders pick-cards and
    // the operator's choice round-trips through create-from-candidate.
    return {
      candidates: result.candidates,
      ai: { source: result.source, usage: result.usage },
    };
  }

  @Post('create-from-candidate')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async createFromCandidate(
    @Request() req: any,
    @Body(new ZodValidationPipe(TemplateCreateFromCandidateSchema)) body: TemplateCreateFromCandidateInput,
  ) {
    // SECURITY — the candidate round-tripped through the browser, so never
    // trust it. Re-run the SAME server-side sanitizer the generator used
    // (clamps coords, allowlists widget types + touch actions, scrubs
    // configs + SSRF targets). Anything tampered with client-side is dropped.
    const parsed = sanitizeTouchTemplate(body.candidate);
    if (!parsed.zones.length) {
      throw new BadRequestException('That option had no usable content. Generate again.');
    }
    const screenWidth = body.screenWidth || 1920;
    const screenHeight = body.screenHeight || 1080;
    const interactive = body.interactive !== false;

    // Wave 2 (2026-06-26) — an engine candidate carries a background descriptor
    // (bgColor/bgGradient/bgImage). Persist it onto the Template's bg fields.
    // The candidate round-tripped through the browser, so only the bounded
    // (BoundedText) fields from the Zod schema reach here — never trust shape.
    const background = body.background
      ? {
          bgColor: body.background.bgColor,
          bgGradient: body.background.bgGradient,
          bgImage: body.background.bgImage,
        }
      : undefined;

    const created = await this.persistGeneratedTemplate(
      req,
      parsed,
      screenWidth,
      screenHeight,
      interactive,
      background,
    );

    await this.audit(req, 'TEMPLATE_CREATED', created?.id ?? null, {
      name: created?.name,
      zoneCount: created?.zones?.length ?? 0,
      via: 'ai-candidate',
      interactive,
      engine: !!background,
    });

    return { template: mapTemplate(created) };
  }

  // Wave 3 (2026-06-27) — one-shot "build me ONE great board, with a real
  // background photo." Runs the signage-design art-director engine AND (for
  // image archetypes) generates a background image via the tenant's BYOK
  // provider (withImage), then persists. Distinct from generate-touch/candidates
  // (the fast 3-up picker, which stays image-free): this is the
  // describe-it-and-get-a-finished-board flow. Passive signage (non-touch).
  // Any image failure leaves the board on its theme gradient — never blocks.
  @Post('generate-signage')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async generateSignage(
    @Request() req: any,
    @Body(new ZodValidationPipe(TemplateGenerateTouchCandidatesSchema)) body: TemplateGenerateTouchCandidatesInput,
  ) {
    const screenWidth = body.screenWidth || 1920;
    const screenHeight = body.screenHeight || 1080;
    const board = await this.ai.generateSignageBoard({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      role: req.user.role,
      prompt: body.prompt,
      screenWidth,
      screenHeight,
      vertical: body.vertical,
      withImage: true,
    });
    // Re-run the SAME server-side sanitizer the candidate path uses (the board
    // is engine-built, but defense-in-depth + it preserves our https assetUrl).
    const parsed = sanitizeTouchTemplate(board);
    if (!parsed.zones.length) {
      throw new BadRequestException('The AI could not build a board. Try a more concrete prompt.');
    }
    const created = await this.persistGeneratedTemplate(
      req,
      parsed,
      screenWidth,
      screenHeight,
      false,
      board.background,
    );
    await this.audit(req, 'TEMPLATE_CREATED', created?.id ?? null, {
      name: created?.name,
      zoneCount: created?.zones?.length ?? 0,
      via: 'ai-signage',
      engine: true,
      withImage: true,
      archetype: board.archetype,
    });
    return { template: mapTemplate(created), archetype: board.archetype, theme: board.theme };
  }

  // Wave 3 (2026-06-27) — CHAT-TO-EDIT. Refine an already-generated (unpersisted)
  // engine candidate by a natural-language instruction. Returns a NEW candidate
  // (same shape, carrying the updated spec) — NOT persisted; the operator still
  // picks "Use this" to commit via create-from-candidate. A delta-prompt over
  // the candidate's ArtDirectorSpec; the incoming spec is re-sanitized server-side.
  @Post('refine-signage')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async refineSignage(
    @Request() req: any,
    @Body(new ZodValidationPipe(TemplateRefineSignageSchema)) body: TemplateRefineSignageInput,
  ) {
    const out = await this.ai.refineSignageBoard({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      spec: body.spec,
      instruction: body.instruction,
      screenWidth: body.screenWidth,
      screenHeight: body.screenHeight,
      vertical: body.vertical,
    });
    return {
      candidates: [out.candidate],
      engine: true,
      refined: true,
      ai: { source: out.source, usage: out.usage },
    };
  }

  /**
   * Shared persist for AI-generated templates (Slice 1c). Creates the
   * Template + scenes + zones in one transaction with tenant-brand
   * inheritance and goto-scene target resolution. Used by BOTH the
   * single-shot generate-touch AND create-from-candidate. `interactive`
   * sets isTouchEnabled (true = touch kiosk, false = passive signage).
   */
  private async persistGeneratedTemplate(
    req: any,
    parsed: { name: string; description?: string; zones: any[]; scenes?: Array<{ name: string }> },
    screenWidth: number,
    screenHeight: number,
    interactive: boolean,
    // Wave 2 (2026-06-26) — optional engine-derived background descriptor. The
    // signage-design engine paints the bg ZONE with the gradient; this sets the
    // Template's solid bg base (and any future bgGradient/bgImage). Falls back to
    // the tenant brand surface only when background.bgColor is absent.
    background?: { bgColor?: string; bgGradient?: string; bgImage?: string },
  ): Promise<any> {
    const orientation = screenHeight > screenWidth ? 'PORTRAIT' : 'LANDSCAPE';

    // Auto-inherit tenant brand like the regular POST / route. The AI
    // already proposes a description + initial palette via widget
    // configs; the brand defaults paint chrome (font, surface, ink).
    const brand = await this.getBrandDefaults(req.user.tenantId);

    // Create the template + initial scenes in a transaction so a
    // half-built draft can't survive a failure mid-write.
    return this.prisma.client.$transaction(async (tx) => {
      const tpl = await tx.template.create({
        data: {
          tenantId: req.user.tenantId,
          name: parsed.name,
          description: parsed.description || null,
          category: 'CUSTOM',
          orientation,
          screenWidth,
          screenHeight,
          isTouchEnabled: interactive,
          // Engine background wins; else fall back to the tenant brand surface.
          bgColor: background?.bgColor || brand.surface || null,
          bgGradient: background?.bgGradient || null,
          bgImage: background?.bgImage || null,
          brandKit: brand.brandKit ?? undefined,
          createdById: req.user.id,
        } as any,
      });

      // Scenes (optional). If the AI returned scene names, create them
      // and resolve scene-name targets in zone touchActions to the real
      // scene ids below. Default scene = first one returned. Passive
      // signage emits no scenes → a single default "Main" scene.
      const sceneNameToId = new Map<string, string>();
      const scenesToCreate = parsed.scenes && parsed.scenes.length
        ? parsed.scenes
        : [{ name: 'Main' }];
      for (let i = 0; i < scenesToCreate.length; i++) {
        const s = scenesToCreate[i];
        const scene = await (tx as any).templateScene.create({
          data: {
            templateId: tpl.id,
            name: s.name,
            sortOrder: i,
            isDefault: i === 0,
          },
        });
        sceneNameToId.set(s.name.toLowerCase(), scene.id);
      }
      const defaultSceneId = Array.from(sceneNameToId.values())[0];

      // Resolve scene-name targets in goto-scene touch actions to actual
      // scene ids. If the AI emitted a name we never created, fall back to
      // the default scene. sanitizeAction already DROPS actions with a
      // missing required target — this is a defensive guard.
      const resolveActionTarget = (a: any): any => {
        if (!a || typeof a !== 'object') return null;
        if (a.type === 'goto-scene') {
          const wanted = typeof a.target === 'string' ? a.target.toLowerCase() : '';
          const resolved = (wanted && sceneNameToId.get(wanted)) || defaultSceneId;
          if (!resolved) return null;
          return { ...a, target: resolved };
        }
        return a;
      };

      for (let i = 0; i < parsed.zones.length; i++) {
        const z = parsed.zones[i];
        const cfg = this.applyBrandToZoneConfig(z.defaultConfig, brand, z.widgetType);
        await tx.templateZone.create({
          data: {
            templateId: tpl.id,
            name: z.name || `${z.widgetType.toLowerCase()} ${i + 1}`,
            widgetType: z.widgetType,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: i + 1,
            sortOrder: i,
            defaultConfig: cfg && Object.keys(cfg).length ? JSON.stringify(cfg) : null,
            touchAction: resolveActionTarget(z.touchAction),
            // F-AI1 (2026-06-26) — place each zone on ITS scene. The
            // sanitizer carries the AI's per-zone scene NAME as `sceneRef`;
            // resolve it to the created scene's id (fall back to the default
            // scene when absent/unmatched). Previously hardcoded
            // `defaultSceneId`, so an AI multi-scene template dumped ALL
            // content on scene 1 and destination scenes rendered blank.
            sceneId:
              ((z as any).sceneRef && sceneNameToId.get(String((z as any).sceneRef).toLowerCase())) ||
              defaultSceneId,
          } as any,
        });
      }

      const fresh = await tx.template.findUnique({
        where: { id: tpl.id },
        include: {
          zones: { orderBy: { sortOrder: 'asc' } },
          scenes: { orderBy: { sortOrder: 'asc' } } as any,
        } as any,
      });
      return fresh;
    });
  }

  // ───────────────────────────────────────────────────────
  // CREATE FROM PRESET — one-click template from system preset
  // ───────────────────────────────────────────────────────

  @Post('from-preset/:presetId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async createFromPreset(
    @Request() req: any,
    @Param('presetId') presetId: string,
    @Body(new ZodValidationPipe(TemplateNameOnlySchema)) body: TemplateNameOnlyInput,
  ) {
    // Try database first (seeded system templates)
    let source = await this.prisma.client.template.findFirst({
      where: { id: presetId, isSystem: true },
      include: { zones: { orderBy: { sortOrder: 'asc' } } },
    });

    // Fall back to in-memory presets
    if (!source) {
      // Search both vertical packs — the preset id is globally
      // unique across files, and "clone this preset" still works even
      // if an admin bookmarks a preset id outside their own vertical.
      const preset =
        SYSTEM_TEMPLATE_PRESETS.find((p) => p.id === presetId) ||
        FITNESS_TEMPLATE_PRESETS.find((p) => p.id === presetId);
      if (!preset) {
        throw new HttpException('Preset not found', HttpStatus.NOT_FOUND);
      }
      // Auto-inherit tenant brand. Preset's own bgColor/zone configs
      // win — most presets are themed by design (Sunny Meadow,
      // Animated Rainbow) and we never want to wipe their look. We
      // ONLY paint blanks: a preset that left bgColor null falls
      // through to the tenant surface; a zone that didn't set
      // color/fontFamily picks up the brand ink/heading. brandKit is
      // attached on the new copy regardless so the editor's "this
      // template's brand" panel shows it.
      const brand = await this.getBrandDefaults(req.user.tenantId);
      const presetResult = await this.prisma.client.template.create({
        data: {
          tenantId: req.user.tenantId,
          name: body.name || preset.name,
          description: preset.description,
          category: preset.category,
          orientation: preset.orientation,
          schoolLevel: preset.schoolLevel ?? 'UNIVERSAL',
          screenWidth: preset.screenWidth || (preset.orientation === 'PORTRAIT' ? 2160 : 3840),
          screenHeight: preset.screenHeight || (preset.orientation === 'PORTRAIT' ? 3840 : 2160),
          // Carry themed background from preset (optional — most presets leave it null)
          bgColor: preset.bgColor ?? brand.surface ?? null,
          bgGradient: preset.bgGradient ?? null,
          bgImage: preset.bgImage ?? null,
          brandKit: brand.brandKit ?? undefined,
          createdById: req.user.id,
          zones: {
            create: preset.zones.map((z, i) => {
              const cfg = this.applyBrandToZoneConfig(z.defaultConfig, brand, z.widgetType);
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
        },
        include: { zones: { orderBy: { sortOrder: 'asc' } } },
      });
      await this.audit(req, 'TEMPLATE_CREATED', presetResult.id, {
        name: presetResult.name,
        via: 'preset',
        presetId,
      });
      return mapTemplate(presetResult);
    }

    // Clone from database system template — same fill-blanks rule.
    const dbBrand = await this.getBrandDefaults(req.user.tenantId);
    const dbPresetResult = await this.prisma.client.template.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name || `${source.name} (Copy)`,
        description: source.description,
        category: source.category,
        orientation: source.orientation,
        screenWidth: source.screenWidth,
        screenHeight: source.screenHeight,
        bgColor: source.bgColor || dbBrand.surface || null,
        bgImage: source.bgImage,
        bgGradient: source.bgGradient,
        brandKit: dbBrand.brandKit ?? undefined,
        createdById: req.user.id,
        zones: {
          create: source.zones.map((z) => {
            const cfg = this.applyBrandToZoneConfig(z.defaultConfig, dbBrand, z.widgetType);
            return {
              name: z.name,
              widgetType: z.widgetType,
              x: z.x,
              y: z.y,
              width: z.width,
              height: z.height,
              zIndex: z.zIndex,
              sortOrder: z.sortOrder,
              defaultConfig: Object.keys(cfg).length ? JSON.stringify(cfg) : null,
            };
          }),
        },
      },
      include: { zones: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.audit(req, 'TEMPLATE_CREATED', dbPresetResult.id, {
      name: dbPresetResult.name,
      via: 'preset-db',
      presetId,
    });
    // Return shape preserved verbatim from before the audit change: this
    // branch historically returned the raw Prisma row (defaultConfig as
    // JSON strings), unlike the in-memory branch above which maps. Not
    // touching that to keep this a pure audit addition.
    return dbPresetResult;
  }

  // ───────────────────────────────────────────────────────
  // DUPLICATE — clone any template the user has access to
  // ───────────────────────────────────────────────────────

  @Post(':id/duplicate')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async duplicate(
    @Request() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TemplateDuplicateSchema)) body: TemplateDuplicateInput,
  ) {
    const source = await this.prisma.client.template.findFirst({
      where: {
        id,
        OR: [{ tenantId: req.user.tenantId }, { isSystem: true }],
      },
      include: { zones: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!source) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    // Resolve canvas size: explicit body overrides win, otherwise inherit
    // the source's dimensions. Cap inputs at sane bounds — anything
    // outside this range is almost certainly a typo and would break the
    // builder's viewport calculations.
    const requestedW = Number.isFinite(body.screenWidth) ? Number(body.screenWidth) : 0;
    const requestedH = Number.isFinite(body.screenHeight) ? Number(body.screenHeight) : 0;
    const screenWidth = requestedW >= 100 && requestedW <= 15360 ? requestedW : source.screenWidth;
    const screenHeight = requestedH >= 100 && requestedH <= 15360 ? requestedH : source.screenHeight;
    const orientation =
      body.orientation === 'PORTRAIT' || body.orientation === 'LANDSCAPE'
        ? body.orientation
        : (screenHeight > screenWidth ? 'PORTRAIT' : 'LANDSCAPE');

    // Auto-inherit tenant brand on duplicate (fill blanks only —
    // don't repaint a deliberately-themed source). System presets
    // duplicated this way pick up the operator's brand exactly like
    // a from-preset clone does. User-template duplicates: if the
    // source already had a brand-filled config, the helper sees
    // existing keys and skips them; if blank, gets the tenant brand.
    const brand = await this.getBrandDefaults(req.user.tenantId);

    // Default name. If canvas was overridden, encode the new dimensions
    // so the operator can tell siblings apart at a glance.
    const canvasChanged = screenWidth !== source.screenWidth || screenHeight !== source.screenHeight;
    const defaultName = canvasChanged
      ? `${source.name} (${screenWidth}×${screenHeight})`
      : `${source.name} (Copy)`;

    const duplicated = await this.prisma.client.template.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name || defaultName,
        description: source.description,
        category: source.category,
        orientation,
        screenWidth,
        screenHeight,
        bgColor: source.bgColor || brand.surface || null,
        bgImage: source.bgImage,
        bgGradient: source.bgGradient,
        brandKit: (source as any).brandKit ?? brand.brandKit ?? undefined,
        createdById: req.user.id,
        zones: {
          create: source.zones.map((z) => {
            const cfg = this.applyBrandToZoneConfig(z.defaultConfig, brand, z.widgetType);
            return {
              name: z.name,
              widgetType: z.widgetType,
              // Zones already stored as %-of-canvas — inherit verbatim.
              // Widgets handle their own internal pixel scaling via
              // useScaleToFit so the visual proportions stay correct
              // even when the new canvas has a different aspect.
              x: z.x,
              y: z.y,
              width: z.width,
              height: z.height,
              zIndex: z.zIndex,
              sortOrder: z.sortOrder,
              defaultConfig: Object.keys(cfg).length ? JSON.stringify(cfg) : null,
            };
          }),
        },
      },
      include: { zones: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.audit(req, 'TEMPLATE_CREATED', duplicated.id, {
      name: duplicated.name,
      via: 'duplicate',
      sourceId: id,
    });
    // Return shape preserved verbatim (raw Prisma row, as before).
    return duplicated;
  }

  // ───────────────────────────────────────────────────────
  // EXPORT — download a template as a portable JSON file
  // ───────────────────────────────────────────────────────
  // Cross-account move: an operator can export a template from one
  // tenant and import it into another (e.g. their own second account).
  // The envelope deliberately carries ONLY portable design data — no
  // id / tenantId / isSystem / createdBy / timestamps — so an import
  // always lands as a fresh, tenant-owned template.

  @Get(':id/export')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async exportTemplate(@Request() req: any, @Param('id') id: string) {
    // Same read gate as duplicate: the caller's own tenant templates,
    // plus system presets (which every tenant may read).
    const tpl = await this.prisma.client.template.findFirst({
      where: { id, OR: [{ tenantId: req.user.tenantId }, { isSystem: true }] },
      include: { zones: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!tpl) throw new HttpException('Template not found', HttpStatus.NOT_FOUND);

    const parseCfg = (s: string | null): any => {
      if (!s) return undefined;
      try { return JSON.parse(s); } catch { return undefined; }
    };

    const template: any = {
      name: tpl.name,
      category: tpl.category,
      orientation: tpl.orientation,
      screenWidth: tpl.screenWidth,
      screenHeight: tpl.screenHeight,
      zones: tpl.zones.map((z) => {
        const cfg = parseCfg(z.defaultConfig);
        return {
          name: z.name,
          widgetType: z.widgetType,
          x: z.x, y: z.y, width: z.width, height: z.height,
          zIndex: z.zIndex,
          sortOrder: z.sortOrder,
          ...(cfg !== undefined ? { defaultConfig: cfg } : {}),
        };
      }),
    };
    // Optional fields — only include when set so the import schema's
    // .optional() checks pass cleanly (no explicit nulls in the file).
    if (tpl.description) template.description = tpl.description;
    if (tpl.bgColor) template.bgColor = tpl.bgColor;
    if (tpl.bgImage) template.bgImage = tpl.bgImage;
    if (tpl.bgGradient) template.bgGradient = tpl.bgGradient;

    return {
      _format: 'educms.template',
      _version: 1,
      exportedAt: new Date().toISOString(),
      template,
    };
  }

  // ───────────────────────────────────────────────────────
  // IMPORT — create a template from an exported JSON file
  // ───────────────────────────────────────────────────────
  // Accepts the envelope produced by GET :id/export. The template
  // always lands in the CALLER's tenant as a fresh, non-system
  // template — this is a create, so it carries the same admin RBAC as
  // POST /. The file is fully untrusted input: the envelope is
  // shape-checked, then the inner template runs through the exact same
  // Zod schema + create path as a hand-built template.

  @Post('import')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async importTemplate(@Request() req: any, @Body() body: any) {
    if (!body || typeof body !== 'object' || body._format !== 'educms.template') {
      throw new HttpException(
        'That file is not an EduCMS template export.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (body._version !== 1) {
      throw new HttpException(
        `Unsupported template file version (${body._version}). This server expects version 1.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const parsed = TemplateCreateSchema.safeParse(body.template);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first?.path?.length ? ` (${first.path.join('.')})` : '';
      throw new HttpException(
        `Template file is malformed${where}: ${first?.message || 'invalid'}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    // Reuse the standard create path verbatim — zone-bounds validation,
    // orientation derivation, tenant-brand inheritance, mapTemplate.
    // Pass skipAudit=true so we record TEMPLATE_IMPORTED here instead of
    // create()'s TEMPLATE_CREATED (this is an import, not a blank build).
    const created = await this.create(req, parsed.data, true);
    await this.audit(req, 'TEMPLATE_IMPORTED', created?.id ?? null, {
      name: created?.name,
      zoneCount: created?.zones?.length ?? 0,
    });
    return created;
  }

  // ───────────────────────────────────────────────────────
  // UPDATE — template metadata (name, description, status)
  // ───────────────────────────────────────────────────────

  @Put(':id')
  // CONTRIBUTOR (Editor) may update their OWN, non-system templates: the
  // method below is tenant-scoped (findFirst {id, tenantId: req.user.tenantId})
  // AND throws on isSystem, so an Editor still can't touch system presets or
  // another tenant's templates. This is the metadata write the builder's
  // handleSave() hits FIRST — it was admin-only, so every Editor save 403'd
  // before the zones ever wrote. (2026-06-09 — "editor … fails to save".)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TemplateUpdateSchema)) body: TemplateUpdateInput,
  ) {
    const template = await this.prisma.client.template.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!template) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    if (template.isSystem) {
      throw new HttpException('Cannot modify system templates. Duplicate it first.', HttpStatus.FORBIDDEN);
    }

    // Clamp idleResetMs into a sane window so a buggy client can't
    // brick a kiosk by saving idleResetMs=0 (visitor flow returns
    // home before the first frame paints). 5s floor, 10min ceiling.
    const clampedIdle = typeof body.idleResetMs === 'number' && Number.isFinite(body.idleResetMs)
      ? Math.max(5_000, Math.min(600_000, body.idleResetMs))
      : undefined;

    const updated = await this.prisma.client.template.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name.trim() }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.category && { category: body.category }),
        ...(body.orientation && { orientation: body.orientation }),
        ...(body.screenWidth && { screenWidth: body.screenWidth }),
        ...(body.screenHeight && { screenHeight: body.screenHeight }),
        ...(body.status && { status: body.status }),
        ...(body.bgColor !== undefined && { bgColor: body.bgColor }),
        ...(body.bgImage !== undefined && { bgImage: body.bgImage }),
        ...(body.bgGradient !== undefined && { bgGradient: body.bgGradient }),
        ...(typeof body.isTouchEnabled === 'boolean' && { isTouchEnabled: body.isTouchEnabled }),
        ...(clampedIdle !== undefined && { idleResetMs: clampedIdle }),
      } as any,
      include: { zones: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.audit(req, 'TEMPLATE_UPDATED', updated.id, {
      // Record which fields the operator changed (keys only, not values
      // — values can be large bgImage data URLs). Status changes
      // (DRAFT→PUBLISHED→ARCHIVED) are the forensically interesting ones.
      changedFields: Object.keys(body || {}),
      ...(body.status ? { status: body.status } : {}),
    });
    return mapTemplate(updated);
  }

  // ───────────────────────────────────────────────────────
  // REPLACE ZONES — atomic zone layout update (like playlist items)
  // The frontend builder sends the complete zone layout, and we
  // replace everything in a transaction for consistency.
  // ───────────────────────────────────────────────────────

  @Put(':id/zones')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async replaceZones(
    @Request() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TemplateReplaceZonesSchema)) body: TemplateReplaceZonesInput,
  ) {
    const template = await this.prisma.client.template.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!template) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    if (template.isSystem) {
      throw new HttpException('Cannot modify system templates. Duplicate it first.', HttpStatus.FORBIDDEN);
    }

    // Validate all zones
    for (const zone of body.zones) {
      validateZoneBounds(zone);
    }

    // Phase D2.5 — guard sceneId references. The atomic replace below
    // would happily insert sceneIds that don't belong to this template
    // (or don't exist at all); validating up-front gives the operator
    // a friendly error instead of a foreign-key violation later.
    const referencedSceneIds = Array.from(
      new Set(
        body.zones
          .map((z) => z.sceneId)
          .filter((s): s is string => typeof s === 'string' && !!s),
      ),
    );
    if (referencedSceneIds.length > 0) {
      const validScenes = await (this.prisma.client as any).templateScene.findMany({
        where: { templateId: id, id: { in: referencedSceneIds } },
        select: { id: true },
      });
      const validIds = new Set((validScenes as Array<{ id: string }>).map((s) => s.id));
      const bad = referencedSceneIds.filter((sid) => !validIds.has(sid));
      if (bad.length > 0) {
        throw new HttpException(
          `Zones reference scene ids that don't belong to this template: ${bad.join(', ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Atomic replace: delete all existing zones then create new ones
    await this.prisma.client.$transaction([
      this.prisma.client.templateZone.deleteMany({ where: { templateId: id } }),
      ...body.zones.map((z, i) =>
        this.prisma.client.templateZone.create({
          data: {
            templateId: id,
            name: z.name,
            widgetType: z.widgetType,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: z.zIndex ?? 0,
            sortOrder: z.sortOrder ?? i,
            defaultConfig: z.defaultConfig ? JSON.stringify(z.defaultConfig) : null,
            // Phase D1 — persist TouchActionConfig. The player runtime
            // reads zone.touchAction; the column accepts arbitrary
            // JSON so future TouchActionConfig variants don't need
            // schema migrations.
            touchAction: z.touchAction == null ? null : (z.touchAction as any),
            // Phase D2.5 — scene assignment. Null = shared across
            // every scene. Validated above; safe to write directly.
            sceneId: z.sceneId ?? null,
          } as any,
        }),
      ),
    ]);

    const freshTemplate = await this.prisma.client.template.findUnique({
      where: { id },
      include: {
        zones: { orderBy: { sortOrder: 'asc' } },
        scenes: { orderBy: { sortOrder: 'asc' } } as any,
      } as any,
    });
    await this.audit(req, 'TEMPLATE_UPDATED', id, {
      via: 'replace-zones',
      zoneCount: body.zones.length,
    });
    return mapTemplate(freshTemplate);
  }

  // ───────────────────────────────────────────────────────
  // DELETE — remove a custom template
  // ───────────────────────────────────────────────────────

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const template = await this.prisma.client.template.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!template) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    if (template.isSystem) {
      throw new HttpException('Cannot delete system templates', HttpStatus.FORBIDDEN);
    }

    // Cascade deletes zones automatically via Prisma relation
    await this.prisma.client.template.delete({ where: { id } });
    await this.audit(req, 'TEMPLATE_DELETED', id, {
      // Capture the name from the pre-delete lookup so the audit row is
      // meaningful after the row is gone ("Operator X deleted 'Lobby
      // Welcome'"). The id alone is useless post-delete.
      name: template.name,
      category: template.category,
    });
    return { deleted: true };
  }
}

// ───────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────

const mapTemplateLogger = new Logger('mapTemplate');

// 2026-05-26 — exported so sports.service.ts can resolve + bundle
// templates inside the public /sports/board/:id payload. Public
// surfaces (board/ribbon/scorebug) need the template structure to
// render but can't hit the auth-gated /templates/:id; bundling is
// the fix. Tenant scope still enforced at the call site.
export function mapTemplate(template: any) {
  if (!template) return template;
  if (template.zones) {
    template.zones = template.zones.map((z: any) => ({
      ...z,
      // One malformed defaultConfig row used to 500 GET /templates for
      // the entire tenant. Swallow the parse error, log it with the
      // zone id, and fall through with an empty config so the rest of
      // the template still renders.
      defaultConfig: (() => {
        if (!z.defaultConfig) return null;
        try {
          return JSON.parse(z.defaultConfig);
        } catch (e) {
          mapTemplateLogger.warn(
            `malformed defaultConfig on zone ${z.id}: ${(e as Error).message}`,
          );
          return {};
        }
      })(),
    }));
  }
  return template;
}

function validateZoneBounds(zone: { x: number; y: number; width: number; height: number }) {
  if (zone.x < 0 || zone.y < 0 || zone.width <= 0 || zone.height <= 0) {
    throw new HttpException(
      `Zone dimensions must be positive. Got x=${zone.x} y=${zone.y} w=${zone.width} h=${zone.height}`,
      HttpStatus.BAD_REQUEST,
    );
  }
  if (zone.x + zone.width > 100.01 || zone.y + zone.height > 100.01) {
    throw new HttpException(
      `Zone overflows the canvas (100×100). x+w=${zone.x + zone.width}, y+h=${zone.y + zone.height}`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Widget type catalog — used by the frontend template builder to render
 * the palette of available widgets with friendly names, icons, and
 * descriptions that make sense to teachers.
 */
const WIDGET_TYPE_CATALOG = [
  {
    type: 'VIDEO',
    label: 'Video Player',
    icon: 'play-circle',
    description: 'Play a video file or stream',
    category: 'media',
  },
  {
    type: 'IMAGE',
    label: 'Single Image',
    icon: 'image',
    description: 'Display a photo or graphic',
    category: 'media',
  },
  {
    type: 'IMAGE_CAROUSEL',
    label: 'Photo Slideshow',
    icon: 'images',
    description: 'Rotate through multiple photos automatically',
    category: 'media',
  },
  {
    type: 'PLAYLIST',
    label: 'Content Playlist',
    icon: 'list-video',
    description: 'Play a sequence of mixed content from a playlist',
    category: 'media',
  },
  {
    type: 'WEBPAGE',
    label: 'Website / Web App',
    icon: 'globe',
    description: 'Embed any website, Google Slide, or web tool',
    category: 'web',
  },
  {
    type: 'TEXT',
    label: 'Text Block',
    icon: 'type',
    description: 'Simple text with custom font, size, and color',
    category: 'web',
  },
  {
    type: 'RICH_TEXT',
    label: 'Rich Text',
    icon: 'file-text',
    description: 'Formatted text with headings, bold, lists, and links',
    category: 'web',
  },
  {
    type: 'RSS_FEED',
    label: 'News Feed',
    icon: 'rss',
    description: 'Show headlines from any RSS news source',
    category: 'web',
  },
  {
    type: 'SOCIAL_FEED',
    label: 'Social Media',
    icon: 'share-2',
    description: 'Display posts from a social media account',
    category: 'web',
  },
  {
    type: 'ANNOUNCEMENT',
    label: 'Announcement',
    icon: 'megaphone',
    description: 'Highlight an important message with eye-catching styling',
    category: 'education',
  },
  {
    type: 'BELL_SCHEDULE',
    label: 'Bell Schedule',
    icon: 'bell',
    description: 'Show class periods with the current one highlighted',
    category: 'education',
  },
  {
    type: 'LUNCH_MENU',
    label: 'Lunch Menu',
    icon: 'utensils',
    description: "Display today's cafeteria menu",
    category: 'education',
  },
  {
    type: 'CALENDAR',
    label: 'School Calendar',
    icon: 'calendar',
    description: 'Show upcoming events from a calendar feed',
    category: 'education',
  },
  {
    type: 'COUNTDOWN',
    label: 'Countdown Timer',
    icon: 'timer',
    description: 'Count down to a special event (prom, graduation, break)',
    category: 'education',
  },
  {
    type: 'STAFF_SPOTLIGHT',
    label: 'Staff Spotlight',
    icon: 'user-check',
    description: 'Feature a teacher or staff member with photo and quote',
    category: 'education',
  },
  {
    type: 'CLOCK',
    label: 'Clock',
    icon: 'clock',
    description: 'Current time display',
    category: 'utility',
  },
  {
    type: 'WEATHER',
    label: 'Weather',
    icon: 'cloud-sun',
    description: 'Local weather conditions and forecast',
    category: 'utility',
  },
  {
    type: 'LOGO',
    label: 'School Logo',
    icon: 'shield',
    description: 'Display your school or district logo',
    category: 'utility',
  },
  {
    type: 'TICKER',
    label: 'Scrolling Ticker',
    icon: 'arrow-right',
    description: 'Scrolling text banner for quick updates',
    category: 'utility',
  },
  {
    type: 'EMPTY',
    label: 'Empty Placeholder',
    icon: 'square',
    description: 'Reserve a zone to fill in later',
    category: 'utility',
  },
];
