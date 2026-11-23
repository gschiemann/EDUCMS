/** Bulk template delete — partition, plan, run, tally (pure). */

import {
  buildDeletePlan, classifyTargets, declineUsageChanged, defaultChecked, emptyTally,
  needsUsageRead, outcomeFromError, parseUsage, readUsages, runBounded, runDeletePlan,
  summarise, tallyRound, type BulkDeleteTarget, type UsageRead,
} from '../template-bulk-delete';

const usage = (total: number, over: Record<string, unknown> = {}) => ({
  playlists: Array.from({ length: Math.min(total, 6) }, (_, i) => ({ id: `p${i}`, name: `Loop ${i}` })),
  total, screensReached: total * 2, locations: 1, protectedEmergency: false, ...over,
});
const err = (code: string | undefined, message?: string) => Object.assign(new Error(message ?? ''), { code });

describe('needsUsageRead', () => {
  it('skips the read only when the list positively says 0 playlists', () => {
    expect(needsUsageRead({ id: 'a', name: 'A', listedPlaylists: 0 })).toBe(false);
    expect(needsUsageRead({ id: 'a', name: 'A', listedPlaylists: 2 })).toBe(true);
    expect(needsUsageRead({ id: 'a', name: 'A' })).toBe(true);
    expect(needsUsageRead({ id: 'a', name: 'A', listedPlaylists: NaN })).toBe(true);
  });
});

describe('parseUsage', () => {
  it('accepts a well-formed answer', () => {
    expect(parseUsage(usage(2))).toMatchObject({ total: 2, screensReached: 4, protectedEmergency: false });
  });
  it.each([
    ['null', null],
    ['no playlists', { total: 1, protectedEmergency: false }],
    ['negative total', { playlists: [], total: -1, protectedEmergency: false }],
    ['missing emergency flag', { playlists: [], total: 0 }],
  ])('rejects %s (never arms a destructive action)', (_label, raw) => {
    expect(parseUsage(raw)).toBeNull();
  });
});

describe('classifyTargets + buildDeletePlan', () => {
  const targets: BulkDeleteTarget[] = [
    { id: 'free', name: 'Free', listedPlaylists: 0 },
    { id: 'used', name: 'Used', listedPlaylists: 2 },
    { id: 'sos', name: 'Lockdown layout', listedPlaylists: 1 },
    { id: 'stale', name: 'Stale count', listedPlaylists: 1 },
    { id: 'broken', name: 'Broken read', listedPlaylists: 1 },
  ];
  const reads = new Map<string, UsageRead>([
    ['used', { ok: true, usage: parseUsage(usage(2))! }],
    ['sos', { ok: true, usage: parseUsage(usage(1, { protectedEmergency: true }))! }],
    ['stale', { ok: true, usage: parseUsage(usage(0))! }],
    ['broken', { ok: false, message: 'Usage unavailable' }],
  ]);
  const rows = classifyTargets(targets, reads, 'unknown');

  it('partitions into free / in-use / emergency / unknown, keeping order', () => {
    expect(rows.map((r) => [r.id, r.kind])).toEqual([
      ['free', 'free'], ['used', 'in-use'], ['sos', 'emergency'], ['stale', 'free'], ['broken', 'unknown'],
    ]);
  });

  it('pre-checks every in-use row, never an emergency one', () => {
    expect([...defaultChecked(rows)]).toEqual(['used']);
  });

  it('forces only the checked in-use rows; the emergency row is never in the plan', () => {
    const plan = buildDeletePlan(rows, defaultChecked(rows));
    expect(plan.ops).toEqual([
      { id: 'free', name: 'Free', force: false },
      { id: 'used', name: 'Used', force: true },
      { id: 'stale', name: 'Stale count', force: false },
    ]);
    expect(plan.keptEmergency.map((r) => r.id)).toEqual(['sos']);
    expect(plan.failed).toEqual([{ id: 'broken', name: 'Broken read', message: 'Usage unavailable' }]);
    expect(plan.ops.some((o) => o.id === 'sos')).toBe(false);
  });

  it('an unticked in-use row is kept by choice', () => {
    const plan = buildDeletePlan(rows, new Set());
    expect(plan.ops.map((o) => o.id)).toEqual(['free', 'stale']);
    expect(plan.keptByChoice.map((r) => r.id)).toEqual(['used']);
  });

  it('a target that needed a read but has none is unknown, not free', () => {
    expect(classifyTargets([{ id: 'x', name: 'X' }], new Map(), 'no read')[0]).toEqual({ id: 'x', name: 'X', kind: 'unknown', message: 'no read' });
  });
});

describe('outcomeFromError', () => {
  it('TEMPLATE_IN_USE on a plain delete is usage-changed (asked again, never forced silently)', () => {
    expect(outcomeFromError(err('TEMPLATE_IN_USE'), false, 'x')).toEqual({ kind: 'usage-changed' });
  });
  it('TEMPLATE_EMERGENCY_IN_USE is kept as emergency, forced or not', () => {
    expect(outcomeFromError(err('TEMPLATE_EMERGENCY_IN_USE'), true, 'x')).toEqual({ kind: 'emergency' });
    expect(outcomeFromError(err('TEMPLATE_EMERGENCY_IN_USE'), false, 'x')).toEqual({ kind: 'emergency' });
  });
  it('anything else is failed with its own message — never "in use"', () => {
    expect(outcomeFromError(err(undefined, 'Server exploded'), false, 'fallback')).toEqual({ kind: 'failed', message: 'Server exploded' });
    expect(outcomeFromError(err('TEMPLATE_IN_USE', 'odd'), true, 'fallback')).toEqual({ kind: 'failed', message: 'odd' });
    expect(outcomeFromError(null, false, 'fallback')).toEqual({ kind: 'failed', message: 'fallback' });
  });
  it('already gone counts as deleted', () => {
    expect(outcomeFromError(err('TEMPLATE_NOT_FOUND', 'Not found'), false, 'x')).toEqual({ kind: 'deleted' });
  });
});

describe('runBounded', () => {
  it('never runs more than the limit at once and keeps input order', async () => {
    let inFlight = 0, peak = 0;
    const out = await runBounded([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, (8 - n) * 2));
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBe(3);
  });
  it('handles an empty list', async () => {
    expect(await runBounded([], 3, async () => 1)).toEqual([]);
  });
});

describe('readUsages', () => {
  it('reads only the targets that may be in use, and records failures as unknown', async () => {
    const calls: string[] = [];
    const reads = await readUsages(
      [{ id: 'free', name: 'F', listedPlaylists: 0 }, { id: 'a', name: 'A', listedPlaylists: 1 }, { id: 'b', name: 'B', listedPlaylists: 3 }, { id: 'c', name: 'C' }],
      async (id) => {
        calls.push(id);
        if (id === 'b') throw new Error('Usage unavailable');
        if (id === 'c') return { nonsense: true };
        return usage(1);
      },
      'unknown',
    );
    expect(calls.sort()).toEqual(['a', 'b', 'c']);
    expect(reads.get('a')).toMatchObject({ ok: true });
    expect(reads.get('b')).toEqual({ ok: false, message: 'Usage unavailable' });
    expect(reads.get('c')).toEqual({ ok: false, message: 'unknown' });
    expect(reads.has('free')).toBe(false);
  });
});

describe('runDeletePlan + tally + summarise', () => {
  it('runs every op, reports progress, and tallies honestly', async () => {
    const rows = classifyTargets(
      [
        { id: 'f1', name: 'F1', listedPlaylists: 0 },
        { id: 'f2', name: 'F2', listedPlaylists: 0 },
        { id: 'f3', name: 'F3', listedPlaylists: 0 },
        { id: 'u1', name: 'U1', listedPlaylists: 1 },
        { id: 'u2', name: 'U2', listedPlaylists: 1 },
        { id: 'sos', name: 'SOS', listedPlaylists: 1 },
      ],
      new Map<string, UsageRead>([
        ['u1', { ok: true, usage: parseUsage(usage(1))! }],
        ['u2', { ok: true, usage: parseUsage(usage(1))! }],
        ['sos', { ok: true, usage: parseUsage(usage(1, { protectedEmergency: true }))! }],
      ]),
      'unknown',
    );
    const checked = defaultChecked(rows);
    checked.delete('u2'); // the operator keeps one
    const plan = buildDeletePlan(rows, checked);
    const deletes: string[] = [];
    const progress: Array<[number, number]> = [];
    const results = await runDeletePlan(plan.ops, async (id, force) => {
      deletes.push(`${id}${force ? ' force' : ''}`);
      if (id === 'f2') throw err('TEMPLATE_IN_USE', 'now in use');
      if (id === 'f3') throw err(undefined, 'Network down');
    }, { fallbackMessage: 'x', onProgress: (d, t) => progress.push([d, t]) });

    expect(deletes.sort()).toEqual(['f1', 'f2', 'f3', 'u1 force']);
    expect(progress[0]).toEqual([0, 4]);
    expect(progress[progress.length - 1]).toEqual([4, 4]);

    const tally = tallyRound(emptyTally(), plan, results);
    expect(tally.deleted.sort()).toEqual(['f1', 'u1']);
    expect(tally.keptEmergency).toEqual(['sos']);
    expect(tally.keptByChoice).toEqual(['u2']);
    expect(tally.failed).toEqual([{ id: 'f3', message: 'Network down' }]);
    expect(tally.usageChanged).toEqual([{ id: 'f2', name: 'F2' }]);

    // Follow-up confirmed: f2 now forced.
    const follow = classifyTargets([{ id: 'f2', name: 'F2' }], new Map<string, UsageRead>([['f2', { ok: true, usage: parseUsage(usage(1))! }]]), 'unknown');
    const followPlan = buildDeletePlan(follow, defaultChecked(follow));
    expect(followPlan.ops).toEqual([{ id: 'f2', name: 'F2', force: true }]);
    const after = tallyRound(tally, followPlan, await runDeletePlan(followPlan.ops, async () => undefined, { fallbackMessage: 'x' }));
    expect(summarise(after)).toEqual({
      deleted: 3, keptEmergency: 1, keptByChoice: 1, failed: 1, firstError: 'Network down',
      handled: expect.arrayContaining(['f1', 'u1', 'f2', 'sos', 'u2']),
    });
    expect(summarise(after).handled).not.toContain('f3');

    // Follow-up declined instead: f2 is kept by choice.
    expect(summarise(declineUsageChanged(tally))).toMatchObject({ deleted: 2, keptByChoice: 2, failed: 1 });
  });
});
