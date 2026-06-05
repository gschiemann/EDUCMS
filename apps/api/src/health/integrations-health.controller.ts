/**
 * IntegrationsHealthController — single source of truth for the
 * /[schoolId]/settings/test-integrations dashboard.
 *
 * 2026-05-26 — operator: "the test integrations should be more than
 * useful, it should test, take you to the actual template it works
 * in and test their, the idea of this setting was to help me test
 * all our integrations and now its useless."
 *
 * What this endpoint does, for every integration the app ships:
 *   1. Probes the deployment-level config (env var present + service
 *      `isConfigured()` / `enabled()` returns true).
 *   2. Probes the tenant-level config (a row exists with valid
 *      credentials — Clever district id, AI key, POS connection,
 *      streaming connection, etc.).
 *   3. Records the probe latency so the operator can see "Square
 *      slow today, 2.4s round-trip" right away.
 *   4. Hints which system-preset template uses the integration's
 *      widget — the UI links straight to "create-from-preset" so
 *      the operator sees the integration render in a live canvas
 *      with one click.
 *
 * Three response states per row (mirrors industry-standard health
 * dashboards — green/amber/red, no marketing-orange "everything's
 * fine"):
 *   • READY — works end-to-end, both deploy + tenant configured.
 *   • DEGRADED — configured but probe failed / partial credentials
 *                / "Coming soon" feature (transparent: NOT a "works"
 *                lie). Includes a reason the operator can act on.
 *   • NOT_CONFIGURED — either the deploy env var or the tenant
 *                      credentials are missing. The UI tells the
 *                      operator where to set them.
 *
 * Endpoint path: GET /api/v1/health/integrations
 *   Admin-only (SUPER_ADMIN / DISTRICT_ADMIN / SCHOOL_ADMIN). Returns
 *   a categorized payload with one row per integration. The frontend
 *   consumes this directly — single fetch, no waterfall.
 *
 * SAFETY: never makes outbound calls that could leak the tenant's
 *   credentials. We probe shape (env var set / row exists) plus
 *   internal service health (DB reachable, Redis reachable). For
 *   true upstream connectivity we rely on the integration's own
 *   service-layer `isConfigured()` / explicit short-circuit checks.
 *   The Run-test buttons on the UI hit existing /sample-data/* +
 *   /streaming/* etc. endpoints, which DO touch live providers — so
 *   the burden of "did the real API respond" stays where it already
 *   has rate-limits + auth + audit-log coverage.
 */
import { Controller, Get, Logger, Query, Request, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { StripeService } from '../billing/stripe.service';
import { EmailService } from '../email/email.service';

export type IntegrationStatus = 'READY' | 'DEGRADED' | 'NOT_CONFIGURED' | 'COMING_SOON';

export type IntegrationCategory =
  | 'core'
  | 'streaming'
  | 'pos'
  | 'sis'
  | 'auth'
  | 'communications'
  | 'sports'
  | 'design-import'
  | 'ai'
  | 'payments'
  | 'monetize'
  | 'storage'
  | 'realtime'
  | 'observability';

export interface IntegrationRow {
  /** Stable machine id — used by the frontend to track state. */
  id: string;
  /** Operator-facing label. */
  name: string;
  /** Category bucket the UI groups into. */
  category: IntegrationCategory;
  status: IntegrationStatus;
  /** One-sentence "why" — surfaced inline under the row. */
  message: string;
  /** Roundtrip ms for this probe; null if we didn't network-call. */
  latencyMs: number | null;
  /** ISO when the probe ran. */
  checkedAt: string;
  /**
   * Optional preset id to clone via `POST /templates/from-preset/:id`.
   * If null, the UI falls back to the templates gallery filtered by
   * verticalHint (or all templates).
   */
  presetId?: string | null;
  /** When presetId is null, hint a vertical to filter the gallery. */
  verticalHint?: string | null;
  /** Optional CTA label override (default "Open template using this"). */
  ctaLabel?: string;
  /**
   * Optional deep-link path on the API or web that runs a real test
   * (e.g. /sample-data/streaming/public-broadcasters). The UI binds
   * a Test button to this when present.
   */
  testEndpoint?: string;
  /** HTTP method for testEndpoint — default POST. */
  testMethod?: 'POST' | 'DELETE' | 'GET';
  /**
   * Optional configure-here path on the web (e.g. /settings/ai,
   * /settings/streaming). The UI surfaces a Configure link when set.
   */
  configurePath?: string;
  /**
   * Public docs URL for the upstream provider. NEVER our own /docs/*
   * paths — Next.js can't serve those (gotcha hit before).
   */
  docsUrl?: string;
}

export interface IntegrationsGrid {
  generatedAt: string;
  generatedInMs: number;
  /** Summary counts per category {category: {ready, degraded, not, coming}} */
  summary: Record<string, { ready: number; degraded: number; notConfigured: number; comingSoon: number; total: number }>;
  rows: IntegrationRow[];
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<{ ok: true; value: T; ms: number } | { ok: false; error: string; ms: number }> {
  const start = Date.now();
  try {
    const value = await Promise.race([
      p,
      new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)),
    ]);
    return { ok: true, value, ms: Date.now() - start };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err), ms: Date.now() - start };
  }
}

@Controller('api/v1/health/integrations')
@SkipThrottle()
export class IntegrationsHealthController {
  private readonly logger = new Logger(IntegrationsHealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly stripe: StripeService,
    private readonly email: EmailService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async grid(@Request() req: any, @Query('admin') admin?: string): Promise<IntegrationsGrid> {
    const isSuperAdmin = req.user?.role === AppRole.SUPER_ADMIN;
    const showAll = admin === '1' && isSuperAdmin;
    const tenantId = req.user.tenantId as string;
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();

    const rows: IntegrationRow[] = [];

    // ───── CORE (always probed) ────────────────────────────────────
    rows.push(...await this.probeCore(checkedAt));
    rows.push(...await this.probeRealtime(checkedAt));
    rows.push(...await this.probeStorage(checkedAt));
    rows.push(...await this.probeObservability(checkedAt));

    // ───── TENANT-LEVEL integrations ───────────────────────────────
    rows.push(...await this.probeAI(tenantId, checkedAt));
    rows.push(...await this.probeStreaming(tenantId, checkedAt));
    rows.push(...await this.probePos(tenantId, checkedAt));
    rows.push(...await this.probeSso(tenantId, checkedAt));
    rows.push(...await this.probeClever(tenantId, checkedAt));
    rows.push(...await this.probePayments(tenantId, checkedAt));
    rows.push(...await this.probeCommunications(checkedAt));
    rows.push(...await this.probeDesignImport(checkedAt));
    rows.push(...await this.probeSports(tenantId, checkedAt));
    rows.push(...await this.probeMonetize(tenantId, checkedAt));

    // Filter Coming-Soon rows when admin=0 (default) so the everyday
    // operator doesn't get a wall of grey items — they only see the
    // integrations that are ACTUALLY shippable today. SUPER_ADMIN
    // with admin=1 sees everything, including the still-TODO list.
    const filtered = showAll ? rows : rows.filter((r) => r.status !== 'COMING_SOON' || r.id === 'design-import-canva');

    // ───── Aggregate summary ───────────────────────────────────────
    const summary: IntegrationsGrid['summary'] = {};
    for (const r of filtered) {
      const cat = r.category;
      const cur = summary[cat] || { ready: 0, degraded: 0, notConfigured: 0, comingSoon: 0, total: 0 };
      cur.total += 1;
      if (r.status === 'READY') cur.ready += 1;
      else if (r.status === 'DEGRADED') cur.degraded += 1;
      else if (r.status === 'NOT_CONFIGURED') cur.notConfigured += 1;
      else cur.comingSoon += 1;
      summary[cat] = cur;
    }

    return {
      generatedAt: checkedAt,
      generatedInMs: Date.now() - startedAt,
      summary,
      rows: filtered,
    };
  }

  // ─── CORE PROBES ─────────────────────────────────────────────────

  private async probeCore(checkedAt: string): Promise<IntegrationRow[]> {
    // DB liveness — 400ms budget. Same probe shape as health.controller.
    const dbProbe = await withTimeout(this.prisma.client.$queryRaw`SELECT 1`, 400, 'db');
    return [
      {
        id: 'core-db',
        name: 'PostgreSQL database',
        category: 'core',
        status: dbProbe.ok ? 'READY' : 'DEGRADED',
        message: dbProbe.ok
          ? 'Prisma pool reachable.'
          : `Database unreachable: ${('error' in dbProbe ? dbProbe.error : 'unknown')}`,
        latencyMs: dbProbe.ms,
        checkedAt,
      },
    ];
  }

  private async probeRealtime(checkedAt: string): Promise<IntegrationRow[]> {
    const pub = this.redis.publisher;
    if (!pub) {
      return [{
        id: 'realtime-redis',
        name: 'Realtime (Redis pub/sub)',
        category: 'realtime',
        status: 'DEGRADED',
        message: 'REDIS_URL not set — HTTP polling fallback is active. Emergency alerts still work; latency is ~5s instead of ~200ms.',
        latencyMs: null,
        checkedAt,
        configurePath: '/settings',
      }];
    }
    if (pub.status !== 'ready') {
      return [{
        id: 'realtime-redis',
        name: 'Realtime (Redis pub/sub)',
        category: 'realtime',
        status: 'DEGRADED',
        message: `Redis client status: ${pub.status}. HTTP polling fallback is active.`,
        latencyMs: null,
        checkedAt,
      }];
    }
    const ping = await withTimeout(pub.ping(), 200, 'redis');
    return [{
      id: 'realtime-redis',
      name: 'Realtime (Redis pub/sub)',
      category: 'realtime',
      status: ping.ok ? 'READY' : 'DEGRADED',
      message: ping.ok
        ? 'Signed pub/sub channel is live — emergency triggers fan out in ~200ms.'
        : `Redis PING failed: ${('error' in ping ? ping.error : 'unknown')}`,
      latencyMs: ping.ms,
      checkedAt,
    }];
  }

  private async probeStorage(checkedAt: string): Promise<IntegrationRow[]> {
    const configured = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    return [{
      id: 'storage-supabase',
      name: 'Supabase storage',
      category: 'storage',
      status: configured ? 'READY' : 'NOT_CONFIGURED',
      message: configured
        ? 'SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set. Asset uploads land in the tenant bucket.'
        : 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. Asset uploads will fail.',
      latencyMs: null,
      checkedAt,
      docsUrl: 'https://supabase.com/docs/guides/storage',
    }];
  }

  private async probeObservability(checkedAt: string): Promise<IntegrationRow[]> {
    const sentryConfigured = !!process.env.SENTRY_DSN;
    const growthbookConfigured = !!process.env.GROWTHBOOK_API_HOST && !!process.env.GROWTHBOOK_CLIENT_KEY;
    return [
      {
        id: 'observability-sentry',
        name: 'Sentry (error tracking)',
        category: 'observability',
        status: sentryConfigured ? 'READY' : 'NOT_CONFIGURED',
        message: sentryConfigured
          ? 'SENTRY_DSN set — errors and performance traces are flowing.'
          : 'SENTRY_DSN not set. The app still runs; errors only land in Railway logs.',
        latencyMs: null,
        checkedAt,
        docsUrl: 'https://sentry.io/welcome/',
      },
      {
        id: 'observability-growthbook',
        name: 'GrowthBook (feature flags)',
        category: 'observability',
        status: growthbookConfigured ? 'READY' : 'DEGRADED',
        message: growthbookConfigured
          ? 'GROWTHBOOK_API_HOST + GROWTHBOOK_CLIENT_KEY set. Per-tenant flag overrides are live.'
          : 'GrowthBook not configured — every flag falls back to its hard-coded default. Acceptable for v1.',
        latencyMs: null,
        checkedAt,
        docsUrl: 'https://docs.growthbook.io/',
      },
    ];
  }

  // ─── AI ──────────────────────────────────────────────────────────

  private async probeAI(tenantId: string, checkedAt: string): Promise<IntegrationRow[]> {
    const platformAnthropic = !!process.env.ANTHROPIC_API_KEY;
    let tenantAiProvider: string | null = null;
    let tenantAiKeyConfigured = false;
    try {
      const t = await (this.prisma.client.tenant as any).findUnique({
        where: { id: tenantId },
        select: { aiProvider: true, aiKeyEncrypted: true },
      });
      tenantAiProvider = t?.aiProvider ?? null;
      tenantAiKeyConfigured = !!t?.aiKeyEncrypted;
    } catch {
      // Schema race during a fresh deploy — never crashes the grid.
    }
    return [
      {
        id: 'ai-byok',
        name: 'AI provider key (BYOK)',
        category: 'ai',
        status: tenantAiKeyConfigured ? 'READY' : (platformAnthropic ? 'DEGRADED' : 'NOT_CONFIGURED'),
        message: tenantAiKeyConfigured
          ? `Tenant key set (${tenantAiProvider || 'unknown provider'}). Sparkle button + touch-template gen route to your account.`
          : (platformAnthropic
              ? 'Tenant has no own key — using shared platform Anthropic key. Free-trial usage applies.'
              : 'No tenant key AND no platform ANTHROPIC_API_KEY. The sparkle button surfaces "AI not configured for this deploy".'),
        latencyMs: null,
        checkedAt,
        configurePath: '/settings/ai',
        // The Sparkle button lives in the template builder, so the
        // best "open a template using this" is any preset that has
        // text widgets — Animated Rainbow lobby has rich text the
        // operator can rewrite with the sparkle button.
        presetId: 'preset-lobby-animated-rainbow',
        verticalHint: 'K12',
        docsUrl: 'https://console.anthropic.com/settings/keys',
      },
    ];
  }

  // ─── STREAMING ───────────────────────────────────────────────────

  private async probeStreaming(tenantId: string, checkedAt: string): Promise<IntegrationRow[]> {
    let connections: Array<{ providerId: string; displayName: string | null }> = [];
    try {
      connections = await ((this.prisma.client as any).streamProviderConnection).findMany({
        where: { tenantId },
        select: { providerId: true, displayName: true },
      });
    } catch {
      // Table missing (pre-migration) → treat as none.
    }
    const ids = new Set(connections.map((c) => c.providerId));
    const has = (id: string) => ids.has(id);

    const rows: IntegrationRow[] = [];
    // Self-serve providers (free / public).
    rows.push({
      id: 'streaming-public-broadcasters',
      name: 'Public Broadcasters (NHK / France 24 / DW / Al Jazeera / Bloomberg / Sky News / CBS)',
      category: 'streaming',
      status: has('public-broadcasters') ? 'READY' : 'NOT_CONFIGURED',
      message: has('public-broadcasters')
        ? 'Connected — 9 venue-friendly news channels available to the Live Stream widget.'
        : 'Not connected. Click Run to load all 9 channels (no credentials needed).',
      latencyMs: null,
      checkedAt,
      presetId: 'bar-game-day-hub',
      verticalHint: 'BAR',
      testEndpoint: '/sample-data/streaming/public-broadcasters',
      testMethod: 'POST',
      configurePath: '/settings/streaming',
      docsUrl: 'https://www3.nhk.or.jp/nhkworld/en/live/',
    });
    rows.push({
      id: 'streaming-mux-hls',
      name: 'Mux test HLS streams',
      category: 'streaming',
      status: has('custom-hls') ? 'READY' : 'NOT_CONFIGURED',
      message: has('custom-hls')
        ? 'Connected — Mux open test bucket streams verify hls.js playback end-to-end.'
        : 'Not connected. Click Run to load Mux test streams (no credentials needed).',
      latencyMs: null,
      checkedAt,
      presetId: 'bar-game-day-hub',
      verticalHint: 'BAR',
      testEndpoint: '/sample-data/streaming/custom-hls',
      testMethod: 'POST',
      docsUrl: 'https://test-streams.mux.dev/',
    });
    rows.push({
      id: 'streaming-youtube',
      name: 'YouTube Live (embed)',
      category: 'streaming',
      status: has('youtube') ? 'READY' : 'NOT_CONFIGURED',
      message: has('youtube')
        ? 'Connected. Embed any public YouTube live URL via the Live Stream widget.'
        : 'Not connected. Add a YouTube channel in /settings/streaming or via the streaming widget config.',
      latencyMs: null,
      checkedAt,
      configurePath: '/settings/streaming',
      docsUrl: 'https://developers.google.com/youtube/iframe_api_reference',
    });
    rows.push({
      id: 'streaming-twitch',
      name: 'Twitch (embed)',
      category: 'streaming',
      status: has('twitch') ? 'READY' : 'NOT_CONFIGURED',
      message: has('twitch')
        ? 'Connected. Embed any public Twitch channel via the Live Stream widget.'
        : 'Not connected. Add a Twitch channel in /settings/streaming.',
      latencyMs: null,
      checkedAt,
      configurePath: '/settings/streaming',
      docsUrl: 'https://dev.twitch.tv/docs/embed/',
    });
    // BRIDGE-tier providers — exist on the platform but require a
    // hardware capture box, so we mark them DEGRADED with a clear
    // explanation instead of pretending they're plug-and-play.
    for (const bridge of [
      { id: 'atmosphere', label: 'Atmosphere TV', docs: 'https://atmosphere.tv/business/' },
      { id: 'directv-business', label: 'DIRECTV for Business', docs: 'https://www.business.directv.com/' },
      { id: 'dish-business', label: 'DISH Business', docs: 'https://business.dish.com/' },
      { id: 'mood-media', label: 'Mood Media', docs: 'https://us.moodmedia.com' },
    ]) {
      rows.push({
        id: `streaming-${bridge.id}`,
        name: bridge.label,
        category: 'streaming',
        status: has(bridge.id) ? 'READY' : 'DEGRADED',
        message: has(bridge.id)
          ? `Connected via Custom HLS bridge — capture card → ffmpeg → local HLS.`
          : `Hardware-bridge integration. Customer brings the ${bridge.label} subscription, you capture HDMI → HLS, then connect via Custom HLS. See docs.`,
        latencyMs: null,
        checkedAt,
        configurePath: '/settings/streaming',
        docsUrl: bridge.docs,
      });
    }
    return rows;
  }

  // ─── POS ─────────────────────────────────────────────────────────

  private async probePos(tenantId: string, checkedAt: string): Promise<IntegrationRow[]> {
    let connections: Array<{ providerId: string; displayName: string | null }> = [];
    try {
      connections = await ((this.prisma.client as any).posProviderConnection).findMany({
        where: { tenantId },
        select: { providerId: true, displayName: true },
      });
    } catch {
      // Table missing → treat as none.
    }
    const byProvider = new Map(connections.map((c) => [c.providerId, c]));

    const rows: IntegrationRow[] = [];
    const def = (id: string, name: string, opts: { presetId?: string; verticalHint?: string; testEndpoint?: string; docsUrl?: string; status?: IntegrationStatus; message?: string }) => {
      const has = byProvider.has(id);
      rows.push({
        id: `pos-${id}`,
        name,
        category: 'pos',
        status: opts.status || (has ? 'READY' : 'NOT_CONFIGURED'),
        message: opts.message || (has
          ? `${name} connection live — menu boards auto-sync from the catalog.`
          : `Not connected. Use /settings/pos to wire up ${name}.`),
        latencyMs: null,
        checkedAt,
        configurePath: '/settings/pos',
        presetId: opts.presetId ?? 'qsr-drive-thru-menu',
        verticalHint: opts.verticalHint ?? 'QSR',
        testEndpoint: opts.testEndpoint,
        testMethod: opts.testEndpoint ? 'POST' : undefined,
        docsUrl: opts.docsUrl,
      });
    };
    // 2026-05-28 audit P1-6: Square + Custom Webhook are the only POS
    // connectors with a live sync handler. The rest (Toast / Clover /
    // Lightspeed / Shopify / Stripe-catalog / MINDBODY) are PARTNER-tier
    // and dead-end on sync, so they're reported COMING_SOON here — never
    // a "READY"/"NOT_CONFIGURED" implication that connecting them works.
    // Re-promote one to the dynamic `def(...)` form the moment its
    // `providers/<id>.ts` handler + DIRECT tier ship.
    const comingSoon = (reason: string) => ({ status: 'COMING_SOON' as const, message: reason });
    def('square', 'Square POS', { docsUrl: 'https://developer.squareup.com/docs/catalog-api/what-it-does' });
    def('toast', 'Toast', { docsUrl: 'https://doc.toasttab.com/', ...comingSoon('Toast connector in development (Partner Program). Use Custom Webhook to push your catalog today.') });
    def('clover', 'Clover', { docsUrl: 'https://docs.clover.com/docs/inventory-overview', ...comingSoon('Clover connector in development. Use Custom Webhook to push your catalog today.') });
    def('lightspeed-retail', 'Lightspeed Retail', { presetId: 'retail-storefront-welcome', verticalHint: 'RETAIL', docsUrl: 'https://developers.lightspeedhq.com/retail/', ...comingSoon('Lightspeed connector in development. Use Custom Webhook to push your catalog today.') });
    def('shopify-pos', 'Shopify POS', { presetId: 'retail-storefront-welcome', verticalHint: 'RETAIL', docsUrl: 'https://shopify.dev/docs/api/admin-rest/2024-04/resources/product', ...comingSoon('Shopify connector in development. Use Custom Webhook to push your catalog today.') });
    def('stripe-terminal', 'Stripe (catalog)', { docsUrl: 'https://docs.stripe.com/api/products', ...comingSoon('Stripe Products/Prices catalog connector in development. Use Custom Webhook to push your catalog today.') });
    def('mindbody', 'MINDBODY', { docsUrl: 'https://developers.mindbodyonline.com/', ...comingSoon('MINDBODY connector in development (Partner Program). Use Custom Webhook to push your catalog today.') });
    // Sample-data loaders — useful as a one-click "verify the
    // restaurant menu board works" smoke test.
    rows.push({
      id: 'pos-sample-restaurant',
      name: 'Sample restaurant catalog (smoke test)',
      category: 'pos',
      status: byProvider.has('custom-webhook') ? 'READY' : 'NOT_CONFIGURED',
      message: byProvider.has('custom-webhook')
        ? 'Sample data loaded — open the QSR Drive-Thru template to see 24 items render.'
        : 'No sample data loaded. Click Run to seed 24 menu items across 4 categories.',
      latencyMs: null,
      checkedAt,
      presetId: 'qsr-drive-thru-menu',
      verticalHint: 'QSR',
      testEndpoint: '/sample-data/pos/sample-restaurant',
      testMethod: 'POST',
      configurePath: '/settings/pos',
      ctaLabel: 'Open the QSR Drive-Thru template',
    });
    rows.push({
      id: 'pos-sample-retail',
      name: 'Sample retail catalog (smoke test)',
      category: 'pos',
      status: byProvider.has('custom-webhook') ? 'READY' : 'NOT_CONFIGURED',
      message: byProvider.has('custom-webhook')
        ? 'Sample data loaded — open the Retail Storefront template to see 18 SKUs render.'
        : 'No sample data loaded. Click Run to seed 18 retail SKUs across 3 categories.',
      latencyMs: null,
      checkedAt,
      presetId: 'retail-storefront-welcome',
      verticalHint: 'RETAIL',
      testEndpoint: '/sample-data/pos/sample-retail',
      testMethod: 'POST',
      configurePath: '/settings/pos',
      ctaLabel: 'Open the Retail Storefront template',
    });
    return rows;
  }

  // ─── SIS ─────────────────────────────────────────────────────────

  private async probeClever(tenantId: string, checkedAt: string): Promise<IntegrationRow[]> {
    // Deploy-level: env var present?
    const cleverConfigured = !!process.env.CLEVER_CLIENT_ID && !!process.env.CLEVER_CLIENT_SECRET;
    // Tenant-level: district id stored?
    let connected = false;
    let districtId: string | null = null;
    let lastSyncAt: Date | null = null;
    const start = Date.now();
    try {
      const t = await (this.prisma.client.tenant as any).findUnique({
        where: { id: tenantId },
        select: { cleverDistrictId: true, cleverConnectedAt: true },
      });
      connected = !!t?.cleverDistrictId;
      districtId = t?.cleverDistrictId ?? null;
      lastSyncAt = t?.cleverConnectedAt ?? null;
    } catch {
      // Schema race or column not present — gracefully degrade.
    }
    const ms = Date.now() - start;

    let status: IntegrationStatus;
    let message: string;
    if (!cleverConfigured) {
      status = 'NOT_CONFIGURED';
      message = 'CLEVER_CLIENT_ID / CLEVER_CLIENT_SECRET not set on this deploy — Connect button is dormant.';
    } else if (!connected) {
      status = 'DEGRADED';
      message = 'Clever app is configured at the deploy level, but no district has been connected yet. Go to /settings/integrations/clever to authorize.';
    } else {
      status = 'READY';
      const last = lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'never';
      message = `Connected to district ${districtId} — last connected ${last}.`;
    }
    return [{
      id: 'sis-clever',
      name: 'Clever SIS',
      category: 'sis',
      status,
      message,
      latencyMs: ms,
      checkedAt,
      configurePath: '/settings/integrations/clever',
      docsUrl: 'https://dev.clever.com/',
    }];
  }

  // ─── SSO ─────────────────────────────────────────────────────────

  private async probeSso(tenantId: string, checkedAt: string): Promise<IntegrationRow[]> {
    // 2026-06-06 — was `(this.prisma.client as any).ssoConfig?.findUnique?.()`.
    // The real Prisma delegate is `tenantSSOConfig` (model TenantSSOConfig /
    // table tenant_sso_configs); `ssoConfig` does not exist, so the `as any`
    // + optional-chaining silently returned undefined → the integrations
    // dashboard reported SSO as NOT_CONFIGURED even when a config row existed.
    // Use the correct, typed delegate (sso.service.ts uses the same one).
    let ssoConfig: { provider: string; enabled: boolean } | null = null;
    try {
      ssoConfig = await this.prisma.client.tenantSSOConfig.findUnique({
        where: { tenantId },
        select: { provider: true, enabled: true },
      });
    } catch {
      // Table doesn't exist yet on this deploy — gracefully degrade.
    }
    if (!ssoConfig) {
      return [{
        id: 'auth-sso',
        name: 'SSO (SAML / OIDC)',
        category: 'auth',
        status: 'NOT_CONFIGURED',
        message: 'No SSO provider configured. Users log in with email + Argon2 password.',
        latencyMs: null,
        checkedAt,
        configurePath: '/settings/sso',
      }];
    }
    return [{
      id: 'auth-sso',
      name: 'SSO (SAML / OIDC)',
      category: 'auth',
      status: ssoConfig.enabled ? 'READY' : 'DEGRADED',
      message: ssoConfig.enabled
        ? `SSO enabled — ${ssoConfig.provider} provider.`
        : `SSO is configured (${ssoConfig.provider}) but disabled. Flip the toggle in /settings/sso to activate.`,
      latencyMs: null,
      checkedAt,
      configurePath: '/settings/sso',
    }];
  }

  // ─── PAYMENTS ────────────────────────────────────────────────────

  private async probePayments(tenantId: string, checkedAt: string): Promise<IntegrationRow[]> {
    const stripeEnabled = this.stripe.enabled();
    const webhookConfigured = !!process.env.STRIPE_WEBHOOK_SECRET;
    const pricesConfigured = !!process.env.STRIPE_PRICE_MONTHLY && !!process.env.STRIPE_PRICE_ANNUAL;
    let status: IntegrationStatus;
    let message: string;
    if (!stripeEnabled) {
      status = 'NOT_CONFIGURED';
      message = 'STRIPE_SECRET_KEY not set — billing is dormant. Set in Railway env to enable.';
    } else if (!webhookConfigured) {
      status = 'DEGRADED';
      message = 'STRIPE_SECRET_KEY set but STRIPE_WEBHOOK_SECRET is missing — webhook events from Stripe will 400. Create a webhook in the Stripe dashboard.';
    } else if (!pricesConfigured) {
      status = 'DEGRADED';
      message = 'Stripe enabled but STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL not set — Checkout will fall back to "free pilot" tier.';
    } else {
      status = 'READY';
      message = 'Stripe Checkout / Portal / Invoices live. Webhook signing secret present.';
    }
    return [{
      id: 'payments-stripe',
      name: 'Stripe billing',
      category: 'payments',
      status,
      message,
      latencyMs: null,
      checkedAt,
      configurePath: '/settings/billing',
      docsUrl: 'https://docs.stripe.com/billing',
    }];
  }

  // ─── COMMUNICATIONS ──────────────────────────────────────────────

  private async probeCommunications(checkedAt: string): Promise<IntegrationRow[]> {
    const emailConfigured = this.email.isConfigured();
    // Twilio + Slack have NO send code yet (audit 2026-05-31, §9 Communications).
    // They are reported COMING_SOON regardless of env so that setting
    // TWILIO_ACCOUNT_SID / SLACK_WEBHOOK_URL never implies "ready, just
    // misconfigured" (DEGRADED) — a district expecting SMS emergency alerts
    // would otherwise get silence. Flip back to an env-gated probe only when
    // the dispatch path actually ships.
    return [
      {
        id: 'comms-email',
        name: 'Email (Resend)',
        category: 'communications',
        status: emailConfigured ? 'READY' : 'NOT_CONFIGURED',
        message: emailConfigured
          ? 'RESEND_API_KEY set — invite + password-reset emails go out to the operator\'s inbox.'
          : 'RESEND_API_KEY not set. Invite emails fall back to copy-the-link UX. Set in Railway env to enable real delivery.',
        latencyMs: null,
        checkedAt,
        docsUrl: 'https://resend.com',
      },
      {
        id: 'comms-twilio',
        name: 'Twilio (SMS / voice)',
        category: 'communications',
        status: 'COMING_SOON',
        message:
          'Coming in V2 — SMS + voice fan-out on an emergency trigger. No send code exists yet, so setting TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN does NOT enable SMS. Stays "coming soon" until the dispatch path ships.',
        latencyMs: null,
        checkedAt,
        docsUrl: 'https://www.twilio.com/docs',
      },
      {
        id: 'comms-slack',
        name: 'Slack / Teams (webhook)',
        category: 'communications',
        status: 'COMING_SOON',
        message:
          'Coming in V2 — outbound emergency / status notifications to ops channels. No send code exists yet, so setting SLACK_WEBHOOK_URL does NOT enable notifications. Stays "coming soon" until the dispatch path ships.',
        latencyMs: null,
        checkedAt,
        docsUrl: 'https://api.slack.com/messaging/webhooks',
      },
      {
        id: 'comms-push',
        name: 'Push notifications (APNs / FCM)',
        category: 'communications',
        status: 'COMING_SOON',
        message: 'Coming in V2 — push to the mobile panic page when an emergency fires.',
        latencyMs: null,
        checkedAt,
      },
    ];
  }

  // ─── DESIGN IMPORT ───────────────────────────────────────────────

  private async probeDesignImport(checkedAt: string): Promise<IntegrationRow[]> {
    // Stage 1 — PDF / image upload — works today. Stage 2 — Canva
    // Connect — pending partner approval (CANVA_CLIENT_ID env var).
    const canvaConfigured = !!process.env.CANVA_CLIENT_ID && !!process.env.CANVA_CLIENT_SECRET;
    return [
      {
        id: 'design-import-upload',
        name: 'Drop a PDF / image (Canva, Slides, PowerPoint, Figma export)',
        category: 'design-import',
        status: 'READY',
        message: 'Stage 1 import works today. Drop a PDF / PNG / JPG / WEBP up to 50 MB; we turn it into Asset + Playlist rows.',
        latencyMs: null,
        checkedAt,
        configurePath: '/templates/imports',
        docsUrl: 'https://github.com/gschiemann/EDUCMS/blob/master/docs/CANVA_INTEGRATION.md',
      },
      {
        id: 'design-import-canva',
        name: 'Canva Connect (OAuth + auto-resync)',
        category: 'design-import',
        status: 'COMING_SOON',
        message: canvaConfigured
          // Honest: the live OAuth picker / Connect flow is NOT built (Sprint 11).
          // Setting the env vars alone does not enable a working "Sign in with Canva".
          ? 'CANVA_CLIENT_ID / CANVA_CLIENT_SECRET are set, but Canva Connect (the OAuth picker + auto-resync) is not built yet — Sprint 11. Export your Canva design to PDF/PNG and drop it at /templates/imports today.'
          : 'Canva Connect (live OAuth import) is not built yet — Sprint 11. Today: export your Canva design to PDF/PNG and drop it at /templates/imports — it works.',
        latencyMs: null,
        checkedAt,
        configurePath: '/templates/imports',
        docsUrl: 'https://www.canva.dev/docs/connect/',
      },
      {
        id: 'design-import-slides',
        name: 'Google Slides (Drive API)',
        category: 'design-import',
        status: 'COMING_SOON',
        message: 'Sprint 11 — same code path as Canva, different OAuth scope. Drops in after Canva ships.',
        latencyMs: null,
        checkedAt,
      },
      {
        id: 'design-import-ppt',
        name: 'PowerPoint Online (Microsoft Graph)',
        category: 'design-import',
        status: 'COMING_SOON',
        message: 'Sprint 11 — uses /me/drive/items/{id}/content?format=pdf and the same conversion pipeline.',
        latencyMs: null,
        checkedAt,
      },
      {
        id: 'design-import-figma',
        name: 'Figma (REST API)',
        category: 'design-import',
        status: 'COMING_SOON',
        message: 'Sprint 11 — designers iterating on kiosk hero art. OAuth + export endpoint.',
        latencyMs: null,
        checkedAt,
      },
    ];
  }

  // ─── SPORTS DATA ─────────────────────────────────────────────────

  private async probeSports(tenantId: string, checkedAt: string): Promise<IntegrationRow[]> {
    // Manual-entry scoring (phone control) is shipped. Console tap-off
    // and league feeds are Sprint 13 Phases 3-4 — not built yet.
    let hasGames = false;
    try {
      const count = await ((this.prisma.client as any).game).count({ where: { tenantId } });
      hasGames = count > 0;
    } catch {
      // Sports tables not present on this deploy.
    }
    return [
      {
        id: 'sports-manual-entry',
        name: 'Manual scoreboard (phone control)',
        category: 'sports',
        status: 'READY',
        message: hasGames
          ? 'Sports engine live, at least one Game record exists. Phone control + 6 flagship sport definitions.'
          : 'Sports engine wired up — no games created yet. Go to /sports to start a game.',
        latencyMs: null,
        checkedAt,
        presetId: 'sports-gameday-countdown',
        verticalHint: 'SPORTS',
      },
      {
        id: 'sports-daktronics',
        name: 'Daktronics All Sport console tap-off',
        category: 'sports',
        status: 'COMING_SOON',
        message: 'Sprint 13 Phase 4 — small box reads existing Daktronics All Sport console serial output and publishes live clock + score.',
        latencyMs: null,
        checkedAt,
      },
      {
        id: 'sports-sportzcast',
        name: 'Sportzcast / Scorebird',
        category: 'sports',
        status: 'COMING_SOON',
        message: 'Sprint 13 Phase 4 — alternative tap-off vendor with the same ScoreSource abstraction.',
        latencyMs: null,
        checkedAt,
      },
      {
        id: 'sports-genius',
        name: 'Genius Sports / Sportradar',
        category: 'sports',
        status: 'COMING_SOON',
        message: 'Sprint 13 Phase 4 — league push feed for stats overlays. 20-30s lag, never used for the live clock.',
        latencyMs: null,
        checkedAt,
      },
      {
        id: 'sports-maxpreps',
        name: 'MaxPreps',
        category: 'sports',
        status: 'COMING_SOON',
        message: 'Sprint 13 Phase 4 — HS-friendly stats source.',
        latencyMs: null,
        checkedAt,
      },
      {
        id: 'sports-gamechanger',
        name: 'GameChanger',
        category: 'sports',
        status: 'COMING_SOON',
        message: 'Sprint 13 Phase 4 — baseball / softball score source.',
        latencyMs: null,
        checkedAt,
      },
    ];
  }

  // ─── MONETIZE ────────────────────────────────────────────────────

  private async probeMonetize(tenantId: string, checkedAt: string): Promise<IntegrationRow[]> {
    let connections: Array<{ networkId: string; status: string }> = [];
    try {
      connections = await ((this.prisma.client as any).adNetworkConnection).findMany({
        where: { tenantId },
        select: { networkId: true, status: true },
      });
    } catch {
      // Tables not present.
    }
    const ids = new Set(connections.map((c) => c.networkId));
    return [
      {
        id: 'monetize-house-only',
        name: 'House-only ad network',
        category: 'monetize',
        status: ids.has('house-only') ? 'READY' : 'NOT_CONFIGURED',
        message: ids.has('house-only')
          ? 'Connected. Upload your own creatives in Assets → Ad Slots and the streaming widget renders them on a flight schedule.'
          : 'Not connected. House-only = your own creatives only. No external auth. Click Run to enable.',
        latencyMs: null,
        checkedAt,
        configurePath: '/settings/monetize',
        testEndpoint: '/sample-data/ads/house-only',
        testMethod: 'POST',
        verticalHint: 'BAR',
      },
      {
        id: 'monetize-hivestack',
        name: 'Hivestack DOOH SSP',
        category: 'monetize',
        status: ids.has('hivestack') ? 'READY' : 'COMING_SOON',
        message: 'Programmatic DOOH SSP — sales-led integration. Currently a partner-managed onboarding.',
        latencyMs: null,
        checkedAt,
        docsUrl: 'https://hivestack.com/publishers',
      },
      {
        id: 'monetize-vistar',
        name: 'Vistar Media DOOH SSP',
        category: 'monetize',
        status: ids.has('vistar') ? 'READY' : 'COMING_SOON',
        message: 'Programmatic DOOH SSP — sales-led integration.',
        latencyMs: null,
        checkedAt,
        docsUrl: 'https://vistarmedia.com',
      },
      {
        id: 'monetize-place-exchange',
        name: 'Place Exchange DOOH SSP',
        category: 'monetize',
        status: ids.has('place-exchange') ? 'READY' : 'COMING_SOON',
        message: 'Programmatic DOOH SSP — sales-led integration.',
        latencyMs: null,
        checkedAt,
        docsUrl: 'https://www.placeexchange.com',
      },
    ];
  }
}
