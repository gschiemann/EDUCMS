/**
 * ScreenAttentionService (2026-10-24) — sorts a tenant's offline screens into
 * down / resting / dormant (`screen-attention-policy.ts`), for the dashboard's
 * "Screens down" card (`GET /api/v1/screens/attention`) and the customer
 * bell (which counts an offline notification only while its screen is DOWN).
 *
 * The intended-downtime facts are read by `CustomerAlertEmailsService.loadFacts`
 * — the very reads the alert emails defer on, so "off on schedule" means the
 * same thing in the inbox, on the dashboard and in an email. Read-only.
 *
 * Cost: one indexed screen read for the scope; the four fact reads run only
 * for offline screens that are not already dormant (usually a handful), and
 * the answer is cached per scope for 20 s — the bell polls every 30 s per open
 * tab and the dashboard once a minute, and neither needs a fresher verdict
 * than the 60-second offline scanner produces anyway.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerAlertEmailsService } from '../customer-alerts/customer-alert-emails.service';
import { SCREEN_ONLINE_GRACE_MS } from '../../telemetry/online-grace';
import { classifyOfflineScreen, type AttentionVerdict } from './screen-attention-policy';

export interface AttentionEntry {
  id: string;
  name: string;
  tenantId: string | null;
  location: string | null;
  groupName: string | null;
  lastSeenAt: string | null;
  reason: string | null;
}

export interface ScreenAttention {
  generatedAt: string;
  down: AttentionEntry[];
  resting: AttentionEntry[];
  dormant: AttentionEntry[];
}

/** The screen columns the classifier reads. */
const ATTENTION_SELECT = {
  id: true,
  name: true,
  tenantId: true,
  status: true,
  location: true,
  lastPingAt: true,
  hardwareModel: true,
  osInfo: true,
  playerVersion: true,
  screenGroup: { select: { name: true } },
} as const;

interface AttentionRow {
  id: string;
  name: string;
  tenantId: string | null;
  status: string;
  location: string | null;
  lastPingAt: Date | null;
  hardwareModel: string | null;
  osInfo: string | null;
  playerVersion: string | null;
  screenGroup?: { name: string } | null;
}

const CACHE_TTL_MS = 20_000;
const CACHE_MAX = 500;
/** Bound on the scope read — far above any one tenant's fleet. */
const SCOPE_MAX = 5_000;

@Injectable()
export class ScreenAttentionService {
  private readonly logger = new Logger(ScreenAttentionService.name);
  private readonly cache = new Map<string, { at: number; value: Map<string, AttentionVerdict> }>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly alerts?: CustomerAlertEmailsService,
  ) {}

  /** Is this screen answering (the fleet list's own ONLINE rule)? */
  static isAlive(lastPingAt: Date | null | undefined, nowMs: number): boolean {
    return !!lastPingAt && nowMs - lastPingAt.getTime() < SCREEN_ONLINE_GRACE_MS;
  }

  /**
   * The dashboard read: every offline screen in the caller's scope, bucketed.
   * `where` is the same tenant + user-scope predicate the screens list uses.
   */
  async forScope(where: Record<string, unknown>, nowMs: number = Date.now()): Promise<ScreenAttention> {
    const rows = (await this.prisma.client.screen.findMany({
      where: { ...where, status: { notIn: ['REVOKED', 'PENDING'] } },
      select: ATTENTION_SELECT,
      orderBy: { name: 'asc' },
      take: SCOPE_MAX,
    })) as AttentionRow[];
    const offline = rows.filter((r) => !ScreenAttentionService.isAlive(r.lastPingAt, nowMs));
    const verdicts = await this.classify(offline, nowMs);
    const out: ScreenAttention = { generatedAt: new Date(nowMs).toISOString(), down: [], resting: [], dormant: [] };
    for (const r of offline) {
      const v = verdicts.get(r.id) ?? { bucket: 'down' as const };
      const entry: AttentionEntry = {
        id: r.id,
        name: r.name,
        tenantId: r.tenantId,
        location: r.location ?? null,
        groupName: r.screenGroup?.name ?? null,
        lastSeenAt: r.lastPingAt ? r.lastPingAt.toISOString() : null,
        reason: v.bucket === 'down' ? null : v.reason,
      };
      out[v.bucket].push(entry);
    }
    // Longest silent first in the red card — the oldest outage is the one to act on.
    const silentFirst = (a: AttentionEntry, b: AttentionEntry) =>
      (a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0) - (b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0);
    out.down.sort(silentFirst);
    return out;
  }

  /**
   * Verdicts for offline screens already read by the caller (the bell reads
   * its own rows). Screens that are answering are not passed in.
   */
  async classify(
    offline: ReadonlyArray<Pick<AttentionRow, 'id' | 'tenantId' | 'lastPingAt' | 'hardwareModel' | 'osInfo' | 'playerVersion'>>,
    nowMs: number = Date.now(),
  ): Promise<Map<string, AttentionVerdict>> {
    const out = new Map<string, AttentionVerdict>();
    if (offline.length === 0) return out;
    const key = offline
      .map((s) => `${s.id}@${s.lastPingAt ? s.lastPingAt.getTime() : 0}`)
      .sort()
      .join(',');
    const hit = this.cache.get(key);
    if (hit && nowMs - hit.at < CACHE_TTL_MS) return hit.value;

    // Dormant needs only the row; facts are read for the rest.
    const needFacts = offline.filter((s) => {
      const v = classifyOfflineScreen(s, null, nowMs);
      if (v.bucket === 'dormant') {
        out.set(s.id, v);
        return false;
      }
      return !!s.tenantId;
    });
    let facts = new Map<string, { facts: any }>();
    if (needFacts.length > 0 && this.alerts) {
      try {
        const tenants = await this.alerts.loadTenants(needFacts.map((s) => s.tenantId as string));
        facts = await this.alerts.loadFacts(
          needFacts.map((s) => ({ screenId: s.id, tenantId: s.tenantId as string })),
          tenants,
          nowMs,
        );
      } catch (e) {
        // A failed read shows the screen as DOWN — never hides an outage.
        this.logger.warn(`[screen-attention] facts read failed: ${(e as Error)?.message ?? e}`);
      }
    }
    for (const s of needFacts) out.set(s.id, classifyOfflineScreen(s, facts.get(s.id)?.facts ?? null, nowMs));
    for (const s of offline) if (!out.has(s.id)) out.set(s.id, { bucket: 'down' });

    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: nowMs, value: out });
    return out;
  }
}
