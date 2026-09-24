/**
 * Per-organisation STORAGE ALLOWANCE for the media library (2026-09-24, Greg).
 *
 * WHAT. `includedBytes = max(STORAGE_GB_FLOOR, STORAGE_GB_PER_SCREEN × paired screens)`,
 * POOLED at the organisation — the root of the tenant tree, exactly like the AI allowance
 * (ai/ai-allowance.service.ts `orgTenantIdFor`): a district's schools and a chain's locations
 * share one allowance sized by every screen they own. Usage is what the organisation actually
 * stores: `sum(Asset.fileSize)` for every tenant in the org, PLUS any swapped-out video
 * ORIGINAL the signage transcode is still holding (storage/video-transcode keeps it ≥ 7 days,
 * longer while a template still names it) — the stored total is the optimized file and the
 * original while both exist, and saying otherwise would under-count.
 *
 * WHERE IT IS ENFORCED — the three media-library upload entry points, each against the best
 * size it has:
 *   • `POST /assets/presign`         — the DECLARED size (fast-fail before any byte moves);
 *   • `POST /assets/upload`          — the REAL bytes in hand (multipart);
 *   • `POST /assets/complete-upload` — the REAL stored size; over → the object is deleted and
 *                                      the request refused (the BUG #6 pattern).
 * NOT enforced on `POST /assets/emergency-upload`: lockdown / evacuate media must always be
 * uploadable, whatever the organisation has stored.
 *
 * No settings, no packs: two constants. Soft at the edges by design — two uploads racing each
 * other can both pass and land slightly over; the next one is refused. Usage reads are cached
 * 30 s per organisation and dropped when this replica accepts an upload.
 */
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  collectDescendantTenantIds,
  MAX_TENANT_TREE_DEPTH,
  type TenantHierarchyDelegate,
} from '../emergency/tenant-hierarchy';

export const STORAGE_GB_PER_SCREEN = 5;
export const STORAGE_GB_FLOOR = 10;
/** At or above this share of the allowance the library says so (amber). */
export const STORAGE_WARN_PERCENT = 80;

const GiB = 1024 * 1024 * 1024;
const ORG_CACHE_MS = 10 * 60_000;
const USAGE_CACHE_MS = 30_000;

export const STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED';

export interface StorageUsage {
  orgTenantId: string;
  usedBytes: number;
  includedBytes: number;
  screens: number;
  /** Rounded; can exceed 100 when an organisation is over. */
  percent: number;
  warn: boolean;
}

/** Pure allowance math. */
export function includedStorageBytesFor(screens: number): number {
  const byScreens =
    Math.max(0, Math.floor(Number(screens) || 0)) * STORAGE_GB_PER_SCREEN;
  return Math.max(STORAGE_GB_FLOOR, byScreens) * GiB;
}

/** "0.9 GB" / "412 MB" — binary units, one decimal for GB (the library's own formatting). */
export function formatStorageBytes(bytes: number): string {
  const b = Math.max(0, Number(bytes) || 0);
  if (b >= GiB) {
    const gb = b / GiB;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  if (b >= 100 * 1024 * 1024) return `${(b / GiB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(b / (1024 * 1024)))} MB`;
}

export function storagePercent(used: number, included: number): number {
  if (!(included > 0)) return 100;
  return Math.round((Math.max(0, used) / included) * 100);
}

/** The refusal, naming the numbers: "This file needs 0.9 GB; 0.4 GB of your 50 GB is left — …". */
export function storageQuotaError(
  needBytes: number,
  usage: StorageUsage,
): HttpException {
  const left = Math.max(0, usage.includedBytes - usage.usedBytes);
  return new HttpException(
    {
      code: STORAGE_QUOTA_EXCEEDED,
      message:
        `This file needs ${formatStorageBytes(needBytes)}; ${formatStorageBytes(left)} of your ` +
        `${formatStorageBytes(usage.includedBytes)} is left — delete unused media or add screens.`,
      usedBytes: usage.usedBytes,
      includedBytes: usage.includedBytes,
      neededBytes: needBytes,
    },
    HttpStatus.PAYLOAD_TOO_LARGE,
  );
}

@Injectable()
export class StorageQuotaService {
  private readonly logger = new Logger(StorageQuotaService.name);
  private readonly orgCache = new Map<string, { org: string; at: number }>();
  private readonly usageCache = new Map<
    string,
    { usage: StorageUsage; at: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  /** Root of the tenant tree (the tenant itself when it has no parent). Cached 10 min. */
  async orgTenantIdFor(tenantId: string): Promise<string> {
    const hit = this.orgCache.get(tenantId);
    if (hit && Date.now() - hit.at < ORG_CACHE_MS) return hit.org;
    let current = tenantId;
    const seen = new Set<string>([tenantId]);
    for (let depth = 0; depth < MAX_TENANT_TREE_DEPTH; depth++) {
      // ten-ok: walks UP the caller's OWN tenant chain to find its organisation root (same walk as
      // AiAllowanceService.orgTenantIdFor); reads only parentId, and the id is the authenticated
      // tenant or its ancestor, never caller input.
      const row = (await this.prisma.client.tenant.findUnique({
        where: { id: current },
        select: { parentId: true },
      })) as { parentId?: string | null } | null;
      const parent = row?.parentId || null;
      if (!parent || seen.has(parent)) break;
      seen.add(parent);
      current = parent;
    }
    this.orgCache.set(tenantId, { org: current, at: Date.now() });
    return current;
  }

  /**
   * The organisation's allowance and what it stores now. `fresh` skips the 30 s cache (the
   * complete-upload check, which decides whether stored bytes stay).
   */
  async usage(
    tenantId: string,
    opts: { fresh?: boolean } = {},
  ): Promise<StorageUsage> {
    const orgTenantId = await this.orgTenantIdFor(tenantId);
    const cached = this.usageCache.get(orgTenantId);
    if (!opts.fresh && cached && Date.now() - cached.at < USAGE_CACHE_MS)
      return cached.usage;

    const descendants = await collectDescendantTenantIds(
      this.prisma.client.tenant as unknown as TenantHierarchyDelegate,
      orgTenantId,
    );
    const orgTenants = [orgTenantId, ...descendants];
    const [screens, assetBytes, retainedOriginals] = await Promise.all([
      this.prisma.client.screen.count({
        where: { tenantId: { in: orgTenants }, pairedAt: { not: null } },
      }),
      this.prisma.client.asset.aggregate({
        _sum: { fileSize: true },
        where: { tenantId: { in: orgTenants } },
      }),
      // Originals the transcode swapped out but still holds (not yet deleted).
      this.prisma.client.videoTranscodeJob.aggregate({
        _sum: { sourceBytes: true },
        where: {
          tenantId: { in: orgTenants },
          status: 'done',
          originalDeletedAt: null,
        },
      }),
    ]);
    const usedBytes =
      Number(assetBytes?._sum?.fileSize || 0) +
      Number(retainedOriginals?._sum?.sourceBytes || 0);
    const includedBytes = includedStorageBytesFor(screens);
    const percent = storagePercent(usedBytes, includedBytes);
    const usage: StorageUsage = {
      orgTenantId,
      usedBytes,
      includedBytes,
      screens,
      percent,
      warn: percent >= STORAGE_WARN_PERCENT,
    };
    this.usageCache.set(orgTenantId, { usage, at: Date.now() });
    return usage;
  }

  /**
   * Refuse (413 STORAGE_QUOTA_EXCEEDED) when `addBytes` more would take the organisation past
   * its allowance. A read failure never blocks an upload — it logs and lets it through (the
   * next successful read enforces), because a DB blip must not stop a school posting a notice.
   */
  async assertRoomFor(
    tenantId: string,
    addBytes: number,
    opts: { fresh?: boolean } = {},
  ): Promise<void> {
    const need = Math.max(0, Number(addBytes) || 0);
    if (!tenantId || need === 0) return;
    let usage: StorageUsage;
    try {
      usage = await this.usage(tenantId, opts);
    } catch (e) {
      this.logger.warn(
        `[storage] usage read failed for ${tenantId} — not enforcing this once: ${(e as Error)?.message ?? e}`,
      );
      return;
    }
    if (usage.usedBytes + need > usage.includedBytes)
      throw storageQuotaError(need, usage);
  }

  /** Forget this organisation's cached usage (after this replica accepted an upload). */
  async invalidate(tenantId: string): Promise<void> {
    try {
      this.usageCache.delete(await this.orgTenantIdFor(tenantId));
    } catch {
      /* best-effort */
    }
  }
}
