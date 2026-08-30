/**
 * Single-flight manifest gate (2026-08-30 player reliability program).
 * Encodes the audit's P0-8 acceptance criteria: overlapping triggers
 * serialize; a slow older request can never finish after (and clobber) a
 * newer one, because a newer one never starts until it's done.
 */
import { createManifestGate } from '../manifestGate';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createManifestGate', () => {
  it('runs a single job to completion', async () => {
    const gate = createManifestGate();
    let runs = 0;
    await gate.run(async () => { runs += 1; });
    expect(runs).toBe(1);
    expect(gate.busy()).toBe(false);
  });

  it('coalesces N mid-flight triggers into exactly one follow-up', async () => {
    const gate = createManifestGate();
    const order: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });

    let call = 0;
    const job = async () => {
      call += 1;
      order.push(`start${call}`);
      if (call === 1) await blocked;
      order.push(`end${call}`);
    };

    const p1 = gate.run(job);
    // Ten triggers land while run 1 is in flight (SYNC burst + timers).
    for (let i = 0; i < 10; i++) void gate.run(job);
    expect(gate.busy()).toBe(true);
    release();
    await p1;
    await tick();
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2']);
    expect(gate.coalescedCount()).toBe(10);
  });

  it('serialization makes stale-response inversion impossible: the second run starts only after the first fully settles', async () => {
    const gate = createManifestGate();
    const applied: string[] = [];
    let releaseSlow!: () => void;
    const slow = new Promise<void>((r) => { releaseSlow = r; });

    let n = 0;
    const job = async () => {
      n += 1;
      if (n === 1) { await slow; applied.push('old-response'); }
      else { applied.push('new-response'); }
    };

    const first = gate.run(job);
    void gate.run(job); // "newer" trigger while old request is slow
    releaseSlow();
    await first;
    await tick();
    // The newer state is what the screen is left holding.
    expect(applied[applied.length - 1]).toBe('new-response');
  });

  it('a throwing job neither wedges the gate nor cancels the queued follow-up', async () => {
    const gate = createManifestGate();
    let firstRuns = 0;
    const p = gate.run(async () => {
      firstRuns += 1;
      throw new Error('network');
    });
    let second = false;
    void gate.run(async () => { second = true; });
    await p;
    await tick();
    expect(gate.busy()).toBe(false);
    expect(firstRuns).toBe(1);
    // B-P2-13: the coalesced follow-up runs the LATEST job handed to run()
    // — after TENANT_CHANGED rebuilds fetchContent's closure, the follow-up
    // must fetch the NEW screen's manifest, not re-run the stale closure.
    expect(second).toBe(true);
  });

  it('B-P2-13: mid-flight triggers supersede the running closure for the follow-up', async () => {
    const gate = createManifestGate();
    const ran: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; });
    const p = gate.run(async () => { ran.push('old-screen'); await blocked; });
    void gate.run(async () => { ran.push('new-screen'); });
    release();
    await p;
    await tick();
    expect(ran).toEqual(['old-screen', 'new-screen']);
  });
});
