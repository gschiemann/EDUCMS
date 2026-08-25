import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  deriveStage,
  isExcludedFromFunnel,
  medianOf,
  hoursBetween,
  rateOf,
  FUNNEL_STAGES,
  type FunnelStage,
  type TenantMilestones,
} from './activation-funnel.logic';

/**
 * ══════════════════════════════════════════════════════════════════════
 * ACTIVATION FUNNEL — DEFINITION (this is the stable source of truth;
 * read this before touching field names, exclusions, or stage order).
 * ══════════════════════════════════════════════════════════════════════
 *
 * activated = first content published to a real screen.
 * proven    = render-proof received (the fleet reported pixels painting).
 *
 * Everything below is derived from rows that already exist — zero new
 * event writes, zero schema changes, zero new instrumentation calls.
 *
 * Stage sequence (strictly monotonic — see deriveStage() in
 * activation-funnel.logic.ts for exactly what "monotonic" enforces):
 *
 *   SIGNED_UP      Tenant row exists.                     Tenant.createdAt
 *   BOARD_CREATED  Operator built/duplicated their own     MIN(Template.createdAt)
 *                  (non-system) template.                  WHERE tenantId=X, isSystem=false
 *   SCREEN_PAIRED  Operator finished pairing real           MIN(Screen.pairedAt)
 *                  hardware.                                WHERE tenantId=X, pairedAt NOT NULL
 *   PUBLISHED      ACTIVATED. First content published       resolvePublishedAt() below
 *                  to a real screen.
 *   RENDER_PROVEN  PROVEN. The fleet has reported a          MAX(Screen.lastRenderedAt)
 *                  render-proof heartbeat.                   WHERE tenantId=X
 *
 * ── Why "board created" only counts non-system templates ───────────────
 * Template.tenantId is nullable; the 17 system presets (system-presets.ts)
 * are seeded with tenantId=null and isSystem=true, shared platform-wide —
 * they are never "created BY a tenant." A tenant duplicating one to
 * customize it produces a normal isSystem=false row with their own
 * tenantId, which is exactly what this counts. Verified no onboarding /
 * sample-data path auto-creates a Template row for a new tenant (grepped
 * both for `.template.create(` — zero hits — so this milestone reflects a
 * genuine operator action, not a signup side-effect.
 *
 * ── Why PUBLISHED has no single createdAt column ────────────────────────
 * Schedule has NO createdAt field in the schema (verified — the model has
 * startTime/endTime/daysOfWeek/timeStart/timeEnd/priority/mode/isActive
 * and nothing else timestamp-shaped). resolvePublishedAt() below prefers
 * the earliest AuditLog row with action='SCHEDULE_CREATED' — the real
 * "operator clicked publish" event — but that audit action was only added
 * 2026-08-03 (see SchedulesController.audit()'s own comment: "CREATE, the
 * publish action itself, wrote no SCHEDULE_CREATED at all" before that
 * date). So we fall back to MIN(Schedule.startTime) across every one of
 * the tenant's schedules for tenants who published earlier, or who only
 * ever went live via the fleet-publish path
 * (PlaylistDistributionService.scheduleLive). Both of the verified
 * "publish now" write paths (SchedulesController.create's default and
 * scheduleLive) set `startTime: new Date()` at creation time, so this
 * fallback equals the true publish moment in the common case; it only
 * drifts when an operator explicitly back-dates or future-dates a
 * schedule's start via the manual form.
 *
 * PUBLISHED is reached if the tenant has EVER had at least one Schedule
 * row — not "currently has an active one." Milestones are permanent
 * achievements, not live state: a tenant who published once and later
 * paused/replaced that schedule (SCHEDULE_TOGGLED) must not un-activate.
 * Because deriveStage() requires SCREEN_PAIRED before it will consider
 * PUBLISHED, this also operationalizes "published to a REAL screen"
 * without needing to resolve each schedule's screenGroup membership —
 * a tenant can't reach PUBLISHED in this funnel until they've paired
 * actual hardware.
 *
 * ── Why RENDER_PROVEN uses MAX(lastRenderedAt), not MIN, and is not a
 *    "first" timestamp ───────────────────────────────────────────────────
 * Screen.lastRenderedAt is OVERWRITTEN on every render-proof POST (every
 * ~30-40s while a screen is actively rendering — see the write-debounce
 * comment in manifest-hot-cache.ts). It is not an append-only log, so
 * there is no way to recover "when did this tenant's FIRST-EVER
 * render-proof land" from data that already exists — the task's own
 * mandate rules out adding a new append-only table to capture it. Given
 * that constraint, we report the MOST RECENT proof across the tenant's
 * screens (MAX), which turns this into an honest, useful number: "how
 * many days ago did we last see this tenant's fleet actually paint a
 * frame." For a healthy tenant currently rendering, that's ~0 days
 * (fresh). For a tenant whose screens have gone dark, it grows — a
 * legitimate churn/health signal for an already-activated customer,
 * arguably more actionable than a long-buried "time to first proof"
 * number would have been. The API field is named `lastRenderProofAt`,
 * never "first...", so the contract doesn't overclaim precision it
 * cannot have. `medianHoursToMilestone.renderProven` inherits the same
 * caveat — treat it as "how fresh is the median tenant's last proof",
 * not "how long activation took."
 *
 * ── Exclusions (see isExcludedFromFunnel() in activation-funnel.logic.ts)
 *   - archivedAt IS NOT NULL — soft-deleted tenants (required by spec).
 *   - id === SYSTEM_TENANT_ID ('00000000-0000-0000-0000-000000000000',
 *     apps/api/src/security/system-tenant.ts) — "owns nothing
 *     operationally" per its own doc comment; would sit at SIGNED_UP
 *     forever and is pure noise in a customer-activation funnel.
 *   - slug starts with 'acme-' — the 5-location POS integration-test
 *     fixture from packages/database/prisma/seed-multilocation-demo.mjs
 *     (ships its own `--clean` flag; explicitly throwaway).
 *
 *   NOT excluded, on purpose: the Springfield seed tenants
 *   ('…0001' School District / '…0002' Elementary). scripts/
 *   archive-test-tenants.cjs already ran a real, reviewed audit of every
 *   tenant on the platform and explicitly kept Springfield alongside real
 *   customers ("Real customers + Springfield + system — NEVER archived")
 *   rather than archiving it. We defer to that existing, reviewed
 *   decision instead of re-litigating it here. If Springfield should be
 *   out of the funnel too, archiving it (already-shipped feature) removes
 *   it from this endpoint for free — no code change needed.
 *
 *   NOT excluded, and NOT detectable from this worktree: the "Walnut
 *   Creek" demo district (prior-session memory: seeded 2026-07-31). Its
 *   seed script AND its research notes are BOTH deliberately gitignored —
 *   ".gitignore: docs/research/2026-07-31-walnut-creek-demo-district/ and
 *   packages/database/prisma/seed-walnut-creek-demo.mjs" — with a commit
 *   message spelling out why: "untrack the Walnut Creek demo folder — it
 *   carries a live password" (commit b1203bb6). Verified absent via two
 *   independent methods: `git log --all` finds zero commits that ever
 *   added such a file, and .gitignore lists the exact paths with that
 *   commit message. So no slug/name pattern for Walnut Creek exists
 *   anywhere in tracked code for this endpoint to key off. Do NOT guess a
 *   pattern here — if Walnut Creek tenants need excluding, archive them
 *   (same one-line fix as Springfield above) rather than hardcoding a
 *   slug prefix nobody can verify from this worktree.
 * ══════════════════════════════════════════════════════════════════════
 */

/** Audit action written by SchedulesController.create() — see the big
 *  comment above for why this is preferred-but-not-guaranteed. */
const PUBLISH_AUDIT_ACTION = 'SCHEDULE_CREATED';

/** "Recent" window for the last-30-days activation-rate slice. */
const RECENT_WINDOW_DAYS = 30;

/** Web panel shows the N most-recently-signed-up tenants, worst-stuck-first. */
const RECENT_TABLE_LIMIT = 15;

export interface FunnelTenantRow {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  signedUpAt: Date;
  firstBoardAt: Date | null;
  firstScreenPairedAt: Date | null;
  firstPublishedAt: Date | null;
  lastRenderProofAt: Date | null;
  stage: FunnelStage;
  stageReachedAt: Date;
  daysInStage: number;
}

@Injectable()
export class ActivationFunnelService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the full funnel snapshot.
   *
   * QUERY COST — fixed at 5 DB round trips regardless of fleet size (no
   * per-tenant fan-out):
   *   1. tenant.findMany({ archivedAt: null })            — 1 query
   *   2-5. four groupBy aggregates scoped to `tenantId IN (…)`, run
   *        concurrently via Promise.all (template, screen x2-in-one,
   *        auditLog, schedule) — 4 queries in parallel.
   * Everything else (stage derivation, medians, the recent-15 slice) is
   * in-process JS over the already-fetched rows. See the PR/report for
   * the full breakdown; this comment is the short version.
   */
  async getFunnel() {
    const now = new Date();
    const nowMs = now.getTime();

    const allTenants = await this.prisma.client.tenant.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true, slug: true, vertical: true, createdAt: true, archivedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const tenants = allTenants.filter((t) => !isExcludedFromFunnel(t));
    const tenantIds = tenants.map((t) => t.id);
    const excludedCount = allTenants.length - tenants.length;

    if (tenantIds.length === 0) {
      return this.buildResponse([], excludedCount, now);
    }

    const [boardRows, screenRows, publishAuditRows, scheduleRows] = await Promise.all([
      this.prisma.client.template.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds }, isSystem: false },
        _min: { createdAt: true },
      }),
      // MIN(pairedAt) and MAX(lastRenderedAt) in ONE groupBy — SQL MIN/MAX
      // both ignore NULLs on their own, so no separate `not: null` filter
      // (and no separate query) is needed for either aggregate.
      this.prisma.client.screen.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds } },
        _min: { pairedAt: true },
        _max: { lastRenderedAt: true },
      }),
      this.prisma.client.auditLog.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds }, action: PUBLISH_AUDIT_ACTION },
        _min: { createdAt: true },
      }),
      this.prisma.client.schedule.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds } },
        _min: { startTime: true },
      }),
    ]);

    const boardMap = new Map<string, Date>();
    for (const r of boardRows as any[]) if (r._min?.createdAt) boardMap.set(r.tenantId, r._min.createdAt);

    const screenPairedMap = new Map<string, Date>();
    const renderProofMap = new Map<string, Date>();
    for (const r of screenRows as any[]) {
      if (r._min?.pairedAt) screenPairedMap.set(r.tenantId, r._min.pairedAt);
      if (r._max?.lastRenderedAt) renderProofMap.set(r.tenantId, r._max.lastRenderedAt);
    }

    const publishAuditMap = new Map<string, Date>();
    for (const r of publishAuditRows as any[]) if (r._min?.createdAt) publishAuditMap.set(r.tenantId, r._min.createdAt);

    const scheduleMap = new Map<string, Date>();
    for (const r of scheduleRows as any[]) if (r._min?.startTime) scheduleMap.set(r.tenantId, r._min.startTime);

    const rows: FunnelTenantRow[] = tenants.map((t) => {
      const firstBoardAt = boardMap.get(t.id) ?? null;
      const firstScreenPairedAt = screenPairedMap.get(t.id) ?? null;
      // Prefer the real publish event; fall back to the schedule's own
      // startTime when no audit row exists (pre-2026-08-03 tenants, or
      // fleet-publish-only tenants — see the definition comment above).
      const firstPublishedAt = publishAuditMap.get(t.id) ?? scheduleMap.get(t.id) ?? null;
      const lastRenderProofAt = renderProofMap.get(t.id) ?? null;

      const milestones: TenantMilestones = {
        signedUpAt: t.createdAt,
        firstBoardAt,
        firstScreenPairedAt,
        firstPublishedAt,
        lastRenderProofAt,
      };
      const { stage, stageReachedAt, daysInStage } = deriveStage(milestones, nowMs);

      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        vertical: t.vertical,
        signedUpAt: t.createdAt,
        firstBoardAt,
        firstScreenPairedAt,
        firstPublishedAt,
        lastRenderProofAt,
        stage,
        stageReachedAt,
        daysInStage,
      };
    });

    return this.buildResponse(rows, excludedCount, now);
  }

  private buildResponse(rows: FunnelTenantRow[], excludedCount: number, now: Date) {
    const nowMs = now.getTime();

    const stageCounts = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as Record<FunnelStage, number>;
    for (const r of rows) stageCounts[r.stage]++;

    const medianHoursTo = (pick: (r: FunnelTenantRow) => Date | null): number | null =>
      medianOf(
        rows
          .map((r) => {
            const at = pick(r);
            return at ? hoursBetween(r.signedUpAt, at) : null;
          })
          .filter((h): h is number => h !== null),
      );

    const isActivated = (r: FunnelTenantRow) => r.stage === 'PUBLISHED' || r.stage === 'RENDER_PROVEN';
    const activatedCount = rows.filter(isActivated).length;

    const recentCutoff = nowMs - RECENT_WINDOW_DAYS * 86_400_000;
    const recentRows = rows.filter((r) => r.signedUpAt.getTime() >= recentCutoff);
    const recentActivatedCount = recentRows.filter(isActivated).length;

    const recentTenants = [...rows]
      .sort((a, b) => b.signedUpAt.getTime() - a.signedUpAt.getTime())
      .slice(0, RECENT_TABLE_LIMIT)
      .sort((a, b) => b.daysInStage - a.daysInStage);

    return {
      tenants: rows,
      recentTenants,
      aggregate: {
        totalTenants: rows.length,
        excludedTenants: excludedCount,
        stageCounts,
        medianHoursToMilestone: {
          boardCreated: medianHoursTo((r) => r.firstBoardAt),
          screenPaired: medianHoursTo((r) => r.firstScreenPairedAt),
          published: medianHoursTo((r) => r.firstPublishedAt),
          // Caveat: this is "hours from signup to the MOST RECENT proof",
          // not "hours to first proof" — see the definition comment above.
          renderProven: medianHoursTo((r) => r.lastRenderProofAt),
        },
        activationRate: {
          overall: rateOf(activatedCount, rows.length),
          last30Days: rateOf(recentActivatedCount, recentRows.length),
        },
      },
      excluded: {
        count: excludedCount,
        note:
          'Archived tenants, the SYSTEM_TENANT_ID sentinel, and acme-* demo-seed tenants are excluded. ' +
          'Springfield seed tenants are deliberately kept (see archive-test-tenants.cjs precedent). ' +
          'Walnut Creek demo tenants could NOT be excluded — their seed script is gitignored in this ' +
          'worktree and no slug pattern for them exists in tracked code. Full evidence trail in the ' +
          'definition comment at the top of activation-funnel.service.ts.',
      },
      meta: {
        generatedAt: now,
        definition:
          'activated = first content published to a real screen; proven = render-proof received. ' +
          'See the comment at the top of activation-funnel.service.ts for the full definition.',
      },
    };
  }
}
