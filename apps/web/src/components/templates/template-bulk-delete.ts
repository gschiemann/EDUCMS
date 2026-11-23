/**
 * Bulk template delete — the planning half. Pure: no React, no network.
 *
 * The owner, 2026-11-23: "it should delete all not in use then pop up for
 * each one in use and ask me if I want to delete anyways… don't make me work
 * to remove what I want to." So one dialog covers the whole selection:
 *
 *   1. partition — a template the list reports with 0 playlists is free; every
 *      other one gets a fresh `GET /templates/:id/usage` (bounded, parallel)
 *      and lands as in-use, emergency-protected, or unknown (the read failed);
 *   2. plan — free ones delete plainly, CHECKED in-use ones delete with
 *      `force=true`, everything else is kept and says why;
 *   3. run — bounded concurrency; a plain delete that answers TEMPLATE_IN_USE
 *      (usage changed after the read) is never forced silently: it comes back
 *      as `usage-changed` for one follow-up confirmation;
 *   4. tally — deleted / kept (emergency) / kept by choice / failed.
 *
 * The emergency guard is the server's (`TEMPLATE_EMERGENCY_IN_USE`, even with
 * force). Nothing here offers a path past it: an emergency-protected template
 * is never put in a plan at all.
 */

export interface TemplateUsageAnswer {
  playlists: Array<{ id: string; name: string }>;
  total: number;
  screensReached?: number;
  locations?: number;
  protectedEmergency: boolean;
}

export interface BulkDeleteTarget {
  id: string;
  name: string;
  /**
   * How many playlists the gallery's own data says use it (`_count.playlists`,
   * or the usage summary when it says more). Undefined when nothing said.
   */
  listedPlaylists?: number;
}

export type UsageRead =
  | { ok: true; usage: TemplateUsageAnswer }
  | { ok: false; message: string };

export type BulkDeleteRow =
  | { id: string; name: string; kind: 'free' }
  | { id: string; name: string; kind: 'in-use'; usage: TemplateUsageAnswer }
  | { id: string; name: string; kind: 'emergency'; usage: TemplateUsageAnswer }
  | { id: string; name: string; kind: 'unknown'; message: string };

export interface BulkDeleteOp { id: string; name: string; force: boolean }

export interface BulkDeletePlan {
  ops: BulkDeleteOp[];
  keptEmergency: Array<{ id: string; name: string }>;
  keptByChoice: Array<{ id: string; name: string }>;
  /** Rows whose usage could not be read: never deleted blind. */
  failed: Array<{ id: string; name: string; message: string }>;
}

export type DeleteOutcome =
  | { kind: 'deleted' }
  | { kind: 'usage-changed' }
  | { kind: 'emergency' }
  | { kind: 'failed'; message: string };

export interface BulkDeleteResult extends BulkDeleteOp { outcome: DeleteOutcome }

export interface BulkDeleteTally {
  deleted: string[];
  keptEmergency: string[];
  keptByChoice: string[];
  failed: Array<{ id: string; message: string }>;
  /** Plain deletes that met TEMPLATE_IN_USE — the follow-up confirmation's rows. */
  usageChanged: Array<{ id: string; name: string }>;
}

/** Concurrency for the deletes and the usage reads (small: one admin, one API replica). */
export const BULK_DELETE_CONCURRENCY = 3;

/** Only a template the list positively reports with 0 playlists skips the usage read. */
export function needsUsageRead(t: BulkDeleteTarget): boolean {
  return !(typeof t.listedPlaylists === 'number' && Number.isFinite(t.listedPlaylists) && t.listedPlaylists <= 0);
}

/**
 * Validate a `/usage` answer. An absent or malformed one returns null — it must
 * never arm a destructive action (the same rule as the single delete dialog).
 */
export function parseUsage(raw: unknown): TemplateUsageAnswer | null {
  const u = raw as Partial<TemplateUsageAnswer> | null | undefined;
  if (!u || !Array.isArray(u.playlists) || !Number.isInteger(u.total) || (u.total as number) < 0
    || typeof u.protectedEmergency !== 'boolean') return null;
  return {
    playlists: u.playlists.filter((p) => p && typeof p.id === 'string')
      .map((p) => ({ id: p.id, name: typeof p.name === 'string' ? p.name : '' })),
    total: u.total as number,
    screensReached: typeof u.screensReached === 'number' ? u.screensReached : undefined,
    locations: typeof u.locations === 'number' ? u.locations : undefined,
    protectedEmergency: u.protectedEmergency,
  };
}

/** Partition the selection. Order is kept, so the dialog lists rows as the gallery showed them. */
export function classifyTargets(
  targets: BulkDeleteTarget[],
  reads: ReadonlyMap<string, UsageRead>,
  unknownMessage: string,
): BulkDeleteRow[] {
  return targets.map((t): BulkDeleteRow => {
    if (!needsUsageRead(t)) return { id: t.id, name: t.name, kind: 'free' };
    const read = reads.get(t.id);
    if (!read) return { id: t.id, name: t.name, kind: 'unknown', message: unknownMessage };
    if (!read.ok) return { id: t.id, name: t.name, kind: 'unknown', message: read.message || unknownMessage };
    // Emergency first: a protected template is listed as kept whatever its count.
    if (read.usage.protectedEmergency) return { id: t.id, name: t.name, kind: 'emergency', usage: read.usage };
    if (read.usage.total > 0) return { id: t.id, name: t.name, kind: 'in-use', usage: read.usage };
    return { id: t.id, name: t.name, kind: 'free' };
  });
}

/** Every in-use row starts checked: deleting what they selected is the default. */
export function defaultChecked(rows: BulkDeleteRow[]): Set<string> {
  return new Set(rows.filter((r) => r.kind === 'in-use').map((r) => r.id));
}

export function buildDeletePlan(rows: BulkDeleteRow[], checked: ReadonlySet<string>): BulkDeletePlan {
  const plan: BulkDeletePlan = { ops: [], keptEmergency: [], keptByChoice: [], failed: [] };
  for (const r of rows) {
    if (r.kind === 'free') plan.ops.push({ id: r.id, name: r.name, force: false });
    else if (r.kind === 'in-use') {
      if (checked.has(r.id)) plan.ops.push({ id: r.id, name: r.name, force: true });
      else plan.keptByChoice.push({ id: r.id, name: r.name });
    } else if (r.kind === 'emergency') plan.keptEmergency.push({ id: r.id, name: r.name });
    else plan.failed.push({ id: r.id, name: r.name, message: r.message });
  }
  return plan;
}

/** What one DELETE's rejection means. `forced` = the request carried force=true. */
export function outcomeFromError(err: unknown, forced: boolean, fallbackMessage: string): DeleteOutcome {
  const e = (err ?? {}) as { code?: unknown; status?: unknown; message?: unknown };
  if (e.code === 'TEMPLATE_EMERGENCY_IN_USE') return { kind: 'emergency' };
  if (e.code === 'TEMPLATE_IN_USE' && !forced) return { kind: 'usage-changed' };
  // Already gone (another admin, another tab): what the operator asked for is true.
  if (e.code === 'TEMPLATE_NOT_FOUND') return { kind: 'deleted' };
  const message = typeof e.message === 'string' && e.message.trim() ? e.message : fallbackMessage;
  return { kind: 'failed', message };
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function runBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return out;
}

/** Read usage for the targets that need it; the rest need no request. */
export async function readUsages(
  targets: BulkDeleteTarget[],
  loadUsage: (id: string) => Promise<unknown>,
  unknownMessage: string,
  concurrency = BULK_DELETE_CONCURRENCY,
): Promise<Map<string, UsageRead>> {
  const need = targets.filter(needsUsageRead);
  const reads = new Map<string, UsageRead>();
  await runBounded(need, concurrency, async (t) => {
    try {
      const usage = parseUsage(await loadUsage(t.id));
      reads.set(t.id, usage ? { ok: true, usage } : { ok: false, message: unknownMessage });
    } catch (err) {
      const m = (err as { message?: unknown } | null)?.message;
      reads.set(t.id, { ok: false, message: typeof m === 'string' && m.trim() ? m : unknownMessage });
    }
  });
  return reads;
}

/** Execute the plan's deletes. `deleteOne` resolves on success and rejects with the API error. */
export async function runDeletePlan(
  ops: BulkDeleteOp[],
  deleteOne: (id: string, force: boolean) => Promise<unknown>,
  opts: { concurrency?: number; fallbackMessage: string; onProgress?: (done: number, total: number) => void },
): Promise<BulkDeleteResult[]> {
  let done = 0;
  opts.onProgress?.(0, ops.length);
  return runBounded(ops, opts.concurrency ?? BULK_DELETE_CONCURRENCY, async (op) => {
    let outcome: DeleteOutcome;
    try {
      await deleteOne(op.id, op.force);
      outcome = { kind: 'deleted' };
    } catch (err) {
      outcome = outcomeFromError(err, op.force, opts.fallbackMessage);
    }
    done += 1;
    opts.onProgress?.(done, ops.length);
    return { ...op, outcome };
  });
}

export function emptyTally(): BulkDeleteTally {
  return { deleted: [], keptEmergency: [], keptByChoice: [], failed: [], usageChanged: [] };
}

/** Fold one round (its plan's kept/failed rows plus the delete results) into the running tally. */
export function tallyRound(prev: BulkDeleteTally, plan: BulkDeletePlan, results: BulkDeleteResult[]): BulkDeleteTally {
  const t: BulkDeleteTally = {
    deleted: [...prev.deleted],
    keptEmergency: [...prev.keptEmergency, ...plan.keptEmergency.map((r) => r.id)],
    keptByChoice: [...prev.keptByChoice, ...plan.keptByChoice.map((r) => r.id)],
    failed: [...prev.failed, ...plan.failed.map((r) => ({ id: r.id, message: r.message }))],
    // A new round replaces the follow-up list: the previous one was this round's input.
    usageChanged: [],
  };
  for (const r of results) {
    if (r.outcome.kind === 'deleted') t.deleted.push(r.id);
    else if (r.outcome.kind === 'emergency') t.keptEmergency.push(r.id);
    else if (r.outcome.kind === 'usage-changed') t.usageChanged.push({ id: r.id, name: r.name });
    else t.failed.push({ id: r.id, message: r.outcome.message });
  }
  return t;
}

/** The operator declined the follow-up: those become kept by choice. */
export function declineUsageChanged(t: BulkDeleteTally): BulkDeleteTally {
  return { ...t, keptByChoice: [...t.keptByChoice, ...t.usageChanged.map((r) => r.id)], usageChanged: [] };
}

export interface BulkDeleteSummary {
  deleted: number;
  keptEmergency: number;
  keptByChoice: number;
  failed: number;
  firstError?: string;
  /** Ids whose fate is settled (deleted or deliberately kept) — the selection drops these. */
  handled: string[];
}

export function summarise(t: BulkDeleteTally): BulkDeleteSummary {
  return {
    deleted: t.deleted.length,
    keptEmergency: t.keptEmergency.length,
    keptByChoice: t.keptByChoice.length + t.usageChanged.length,
    failed: t.failed.length,
    firstError: t.failed[0]?.message,
    handled: [...t.deleted, ...t.keptEmergency, ...t.keptByChoice, ...t.usageChanged.map((r) => r.id)],
  };
}
