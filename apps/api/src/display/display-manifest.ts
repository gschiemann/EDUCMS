/**
 * The player manifest's `display` block (2026-08-13).
 *
 * ⚠️ READ CLAUDE.md → "Manifest content cache (2026-07-30)" BEFORE TOUCHING
 * THIS FILE. The manifest is served from a per-screen in-process cache and
 * carries an ETag hashed over the whole payload minus `generatedAt`. Two
 * rules follow, and both are load-bearing:
 *
 *   1. EVERY FIELD IN THIS BLOCK MUST BE STABLE. No clock reads, no "ms
 *      until the next off window", no telemetry echo, nothing per-request.
 *      A single volatile field changes the hash on every poll, every screen
 *      re-downloads its full manifest instead of 304-ing, and the 25 GB/mo
 *      Supabase egress bill this cache was built to kill comes straight
 *      back. The player owns "what time is it"; the server only says what
 *      the windows ARE.
 *
 *   2. THE BLOCK MUST NOT VARY WITH `Screen.displayCapabilities`. That
 *      column is written by a device report and is registered in
 *      SCREEN_TELEMETRY_ONLY_FIELDS precisely so a report cannot bust the
 *      cache. If the manifest derived anything from it, that registration
 *      would become a correctness bug (stale manifests) instead of an
 *      optimisation. Hence vendor-recipe MATCHING happens on the device
 *      against its own Build.* identity — we ship the catalog, it picks.
 *
 * The queries below are memoised per screen against the manifest content
 * rev, because the EMERGENCY and SPORTS manifest branches return BEFORE the
 * manifest hot cache and would otherwise pay them on every 5 s poll. Any
 * write to DisplaySchedule / DisplayVendorRecipe bumps the rev via the
 * Prisma `$use` hook (both models are in MANIFEST_FED_MODELS), so an
 * operator's edit is visible on the next poll, not after a TTL.
 */

import { Logger } from '@nestjs/common';

import {
  MIN_SAFE_BRIGHTNESS_PERCENT,
  type DisplayManifestBlock,
  type DisplayScheduleManifestEntry,
} from '@cms/api-types';

const logger = new Logger('DisplayManifest');

/** Minimal Prisma surface — keeps this unit-testable without Nest. */
export interface DisplayManifestPrisma {
  client: {
    displaySchedule: { findMany: (args: any) => Promise<any[]> };
    displayVendorRecipe: { findMany: (args: any) => Promise<any[]> };
  };
}

export interface DisplayManifestScreen {
  id: string;
  tenantId: string | null;
  screenGroupId: string | null;
}

interface CacheEntry {
  block: DisplayManifestBlock;
  rev: number;
  at: number;
}

/**
 * Short backstop TTL. The rev check is the real invalidation; this only
 * bounds the window in which a *raw-SQL* edit (which bypasses the Prisma
 * hook, same caveat as the manifest hot cache itself) stays invisible.
 */
const DISPLAY_BLOCK_TTL_MS = 60_000;
const DISPLAY_BLOCK_MAX_ENTRIES = 1_000;
/** Defensive cap — the catalog is a handful of SKUs, not a content feed. */
export const DISPLAY_RECIPE_CATALOG_LIMIT = 50;
/** A screen with more than this many on/off windows is a misconfiguration. */
export const DISPLAY_SCHEDULE_LIMIT = 50;

const blockCache = new Map<string, CacheEntry>();

/**
 * Last successfully-built block per screen, kept independently of the
 * rev-checked memo above and never expired.
 *
 * This exists because this builder is now reachable from the EMERGENCY
 * manifest branch. A transient DB failure there must not be able to (a) 500
 * the life-safety manifest, or (b) hand a fleet an empty `display` block
 * that could disarm its blank/wake alarms. On a failed read we serve the
 * last known-good block — same "known-good beats nothing" discipline the
 * player applies to cached content — and only fall through to `null` when
 * we have genuinely never built one for this screen.
 */
const lastGoodBlock = new Map<string, DisplayManifestBlock>();

/** Test seam + a hard reset for anything that mutates recipes out-of-band. */
export function clearDisplayManifestCache(): void {
  blockCache.clear();
}

/** Test seam. Production never discards known-good state deliberately. */
export function _resetDisplayManifestLastGood(): void {
  lastGoodBlock.clear();
}

/** Normalise a DB row into the stable manifest entry shape. */
export function toManifestSchedule(row: {
  id: string;
  daysOfWeek: number[] | null;
  onTime: string;
  offTime: string;
  timezone: string;
}): DisplayScheduleManifestEntry {
  return {
    id: row.id,
    // Sorted so two logically-identical rows can never hash differently
    // just because they were written in a different click order.
    daysOfWeek: [...(row.daysOfWeek ?? [])].sort((a, b) => a - b),
    onTime: row.onTime,
    offTime: row.offTime,
    timezone: row.timezone,
  };
}

/**
 * Build the `display` block for one screen.
 *
 * Returns `null` for a screen with no tenant (unpaired) — there is nothing
 * tenant-scoped to serve and emitting an empty block would only add bytes.
 */
export async function buildDisplayManifestBlock(
  prisma: DisplayManifestPrisma,
  screen: DisplayManifestScreen,
  contentRev: number,
): Promise<DisplayManifestBlock | null> {
  if (!screen.tenantId) return null;

  const cached = blockCache.get(screen.id);
  if (
    cached &&
    cached.rev === contentRev &&
    Date.now() - cached.at < DISPLAY_BLOCK_TTL_MS
  ) {
    return cached.block;
  }

  // A schedule targets EXACTLY ONE thing — this screen, or the group it is
  // in. The group clause is only added when the screen actually has a group:
  // Prisma reads `{ screenGroupId: null }` as "every row whose group IS
  // null", and every screen-pinned row carries a null group — so a groupless
  // screen would otherwise inherit every screen-pinned schedule in the
  // table. Same trap, same fix as the playlist Schedule query in
  // screens.controller.getManifest. Tenant-scoped as defence in depth.
  const targetOr: any[] = [{ screenId: screen.id }];
  if (screen.screenGroupId)
    targetOr.push({ screenGroupId: screen.screenGroupId });

  let scheduleRows: any[];
  let recipeRows: any[];
  try {
    [scheduleRows, recipeRows] = await Promise.all([
      prisma.client.displaySchedule.findMany({
        where: { tenantId: screen.tenantId, isActive: true, OR: targetOr },
        select: {
          id: true,
          daysOfWeek: true,
          onTime: true,
          offTime: true,
          timezone: true,
        },
        // Deterministic order — the payload is hashed, so an unordered read
        // could flip the ETag between polls for identical data.
        orderBy: { id: 'asc' },
        take: DISPLAY_SCHEDULE_LIMIT,
      }),
      prisma.client.displayVendorRecipe.findMany({
        where: { isActive: true },
        select: { vendorId: true, priority: true, recipe: true },
        orderBy: [{ priority: 'desc' }, { vendorId: 'asc' }],
        take: DISPLAY_RECIPE_CATALOG_LIMIT,
      }),
    ]);
  } catch (e) {
    // FAIL SAFE — this builder is reachable from the EMERGENCY manifest
    // branch. A pool blip must never cost a screen its lockdown alert, and
    // must never look like "this screen has no display schedule" (which
    // could disarm its overnight blank/wake alarms). Serve the last
    // known-good block; only a screen we have never built one for gets null.
    // NOT memoised, so the very next poll retries the read.
    const known = lastGoodBlock.get(screen.id) ?? null;
    logger.warn(
      `[display] manifest block read failed for screen=${screen.id} ` +
        `(serving ${known ? 'last known-good' : 'null'}): ${e}`,
    );
    return known;
  }

  const block: DisplayManifestBlock = {
    schedules: scheduleRows.map(toManifestSchedule),
    brightness: {
      // Server-tunable so the floor can move without an APK release. The
      // player enforces its own native floor too — belt and braces on a
      // screen nobody can reach.
      minSafePercent: MIN_SAFE_BRIGHTNESS_PERCENT,
      // Scheduled/automatic paths NEVER blank the panel to 0. Only an
      // explicit operator action carrying allowBlack can, and that goes
      // through POST /display-control, not through this block.
      allowBlack: false,
    },
    vendorRecipes: recipeRows.map((r) => ({
      vendorId: r.vendorId,
      priority: r.priority ?? 0,
      recipe: r.recipe,
    })),
  };

  if (blockCache.size >= DISPLAY_BLOCK_MAX_ENTRIES) blockCache.clear();
  blockCache.set(screen.id, { block, rev: contentRev, at: Date.now() });
  if (lastGoodBlock.size >= DISPLAY_BLOCK_MAX_ENTRIES) lastGoodBlock.clear();
  lastGoodBlock.set(screen.id, block);
  return block;
}
