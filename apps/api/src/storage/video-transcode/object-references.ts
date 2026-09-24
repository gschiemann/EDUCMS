/**
 * object-references.ts — "does ANY row anywhere still name this storage
 * object?" (2026-09-23). The gate in front of deleting a swapped-out ORIGINAL.
 *
 * WHY A WHOLE-DATABASE SCAN. Swapping an asset's `fileUrl` only moves the
 * references that go THROUGH the asset row (playlist items, the manifest's
 * `item.asset.fileUrl`). Many surfaces store an asset's URL BY VALUE instead:
 * template zone configs (`defaultConfig.assetUrl` / `urls[]` — the builder's
 * media picker writes the URL it was handed), template backgrounds, screen
 * emergency-media columns, an active emergency override's `mediaUrl`, sports
 * cues and sponsors, board history, template versions… A list of "the columns
 * that hold asset URLs" is out of date the day someone adds one, and the
 * failure it would cause — deleting media a screen still plays — is silent.
 *
 * So the scan is SCHEMA-DRIVEN: every text / varchar / json / jsonb / array
 * column of every table in `public` is searched for the object's file name
 * (`<uuid>.<ext>` — unique, and it survives every URL form: public, signed,
 * render/transform, percent-encoded, a bare path). A new table is covered the
 * day it exists. Only append-only history/telemetry tables are excluded — a
 * log line that mentions a URL is not something a screen will fetch.
 *
 * FAIL CLOSED. Any error, timeout or unexpected identifier returns `unknown`,
 * and the caller keeps the original. The worst this can do is keep a file.
 */
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Tables that record HISTORY or TELEMETRY, never a live reference a screen
 * could fetch — plus this feature's own table (it names the original by
 * design). Everything else is scanned.
 */
export const REFERENCE_SCAN_EXCLUDED_TABLES = new Set<string>([
  '_prisma_migrations',
  'video_transcode_jobs',
  'audit_logs',
  'email_logs',
  'clever_sync_logs',
  'webhook_deliveries',
  'processed_stripe_events',
  'processed_pos_events',
  'usb_ingest_events',
  'playback_samples',
  'playback_sample_hours',
  'playback_rollup_state',
  'touch_events',
  'ad_impressions',
  'ad_revenue_daily',
  'sponsor_impressions',
  'fleet_samples',
  'screen_events',
  'game_events',
  'ai_usage_events',
  'bugs',
  'notifications',
  'revoked_credentials',
  'session_refresh_tokens',
  'password_reset_tokens',
  'passkeys',
  'user_invites',
  'deployments',
]);

/** Postgres types we search (anything that can carry a URL as text). */
const SCANNED_DATA_TYPES = new Set([
  'text',
  'character varying',
  'json',
  'jsonb',
  'ARRAY',
]);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export type ReferenceScanResult =
  | { status: 'referenced'; table: string; column: string }
  | { status: 'unreferenced'; tablesScanned: number }
  | { status: 'unknown'; reason: string };

/** The needle for an object path: its file name, e.g. `0f6b…5d.mp4`. */
export function objectNeedle(storagePath: string): string | null {
  const base =
    String(storagePath || '')
      .split('/')
      .pop() || '';
  // Only a presign-shaped name is unique enough to search for.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[A-Za-z0-9]{1,8})?$/.test(
    base,
  )
    ? base
    : null;
}

/** Escape LIKE wildcards so the needle matches literally. */
export function likeLiteral(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Search every scanned column for `needle`. One statement per table
 * (`… WHERE c1::text LIKE $1 OR c2::text LIKE $1 … LIMIT 1`), each in its own
 * transaction with a statement timeout, stopping at the first hit.
 */
export async function scanForObjectReference(
  prisma: PrismaService,
  needle: string,
  opts: { statementTimeoutMs?: number } = {},
): Promise<ReferenceScanResult> {
  if (!needle || needle.length < 12)
    return { status: 'unknown', reason: 'needle-too-short' };
  const timeout = Math.max(
    1000,
    Math.min(60_000, Math.trunc(opts.statementTimeoutMs ?? 15_000)),
  );
  let cols: Array<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>;
  try {
    cols = await prisma.client.$queryRawUnsafe(
      `SELECT c.table_name, c.column_name, c.data_type
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_name, c.ordinal_position`,
    );
  } catch (e) {
    return {
      status: 'unknown',
      reason: `catalog: ${(e as Error)?.message ?? e}`,
    };
  }
  const byTable = new Map<string, string[]>();
  for (const c of cols || []) {
    if (REFERENCE_SCAN_EXCLUDED_TABLES.has(c.table_name)) continue;
    if (!SCANNED_DATA_TYPES.has(c.data_type)) continue;
    if (!IDENT.test(c.table_name) || !IDENT.test(c.column_name)) {
      return {
        status: 'unknown',
        reason: `unexpected identifier ${c.table_name}.${c.column_name}`,
      };
    }
    const list = byTable.get(c.table_name) ?? [];
    list.push(c.column_name);
    byTable.set(c.table_name, list);
  }
  if (byTable.size === 0)
    return { status: 'unknown', reason: 'no-scannable-tables' };

  const pattern = likeLiteral(needle);
  for (const [table, columns] of byTable) {
    const where = columns
      .map((c) => `"${c}"::text LIKE $1 ESCAPE '\\'`)
      .join(' OR ');
    // Identifiers come from the catalog and passed IDENT above; the needle is a
    // bound parameter. The per-table transaction scopes the statement timeout.
    const sql = `SELECT 1 FROM "public"."${table}" WHERE ${where} LIMIT 1`;
    try {
      const hit = await prisma.client.$transaction(
        async (tx: any) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL statement_timeout = ${timeout}`,
          );
          return tx.$queryRawUnsafe(sql, pattern) as Promise<unknown[]>;
        },
        // Prisma's interactive-transaction budget defaults to 5 s — it must
        // outlast the statement timeout, or Prisma aborts first.
        { maxWait: 5_000, timeout: timeout + 5_000 },
      );
      if (Array.isArray(hit) && hit.length > 0) {
        // Name the exact column for the retained-reason (a second cheap probe).
        const column = await firstMatchingColumn(
          prisma,
          table,
          columns,
          pattern,
          timeout,
        );
        return {
          status: 'referenced',
          table,
          column: column ?? columns.join('|'),
        };
      }
    } catch (e) {
      return {
        status: 'unknown',
        reason: `${table}: ${(e as Error)?.message ?? e}`.slice(0, 300),
      };
    }
  }
  return { status: 'unreferenced', tablesScanned: byTable.size };
}

async function firstMatchingColumn(
  prisma: PrismaService,
  table: string,
  columns: string[],
  pattern: string,
  timeout: number,
): Promise<string | null> {
  for (const c of columns) {
    try {
      const rows = await prisma.client.$transaction(
        async (tx: any) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL statement_timeout = ${timeout}`,
          );
          return tx.$queryRawUnsafe(
            `SELECT 1 FROM "public"."${table}" WHERE "${c}"::text LIKE $1 ESCAPE '\\' LIMIT 1`,
            pattern,
          ) as Promise<unknown[]>;
        },
        { maxWait: 5_000, timeout: timeout + 5_000 },
      );
      if (Array.isArray(rows) && rows.length > 0) return c;
    } catch {
      return null;
    }
  }
  return null;
}
