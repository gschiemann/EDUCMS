import {
  RENDER_LEAD_FRAME_MS,
  RENDER_LEAD_MAX_MS,
  RENDER_LEAD_SEED_MS,
  nextRenderLead,
  renderLeadSampleCap,
} from '../renderLead';

/** The estimator as it was before 2026-11-23: plain EWMA, any sample up to 400 ms. */
function oldNextLead(prev: number, sample: number): number | null {
  if (!Number.isFinite(sample) || sample < 0 || sample > 400) return null;
  return Math.max(0, Math.min(150, prev * 0.8 + sample * 0.2));
}

function run(step: (prev: number, s: number) => number | null, seed: number, samples: number[]): number[] {
  const out: number[] = [];
  let lead = seed;
  for (const s of samples) {
    const n = step(lead, s);
    if (n !== null) lead = n;
    out.push(lead);
  }
  return out;
}

describe('renderLead — the decision-to-paint estimate the conductor leads flips by', () => {
  it('converges on a steady sample exactly as the plain EWMA does', () => {
    const samples = Array.from({ length: 60 }, () => 33.4);
    const leads = run(nextRenderLead, RENDER_LEAD_SEED_MS, samples);
    const old = run(oldNextLead, RENDER_LEAD_SEED_MS, samples);
    expect(leads[leads.length - 1]).toBeCloseTo(33.4, 1);
    // From the 16 ms seed every sample is under the cap, so nothing changes.
    for (let i = 0; i < samples.length; i++) expect(leads[i]).toBeCloseTo(old[i], 9);
  });

  it('normal jitter (one dropped frame) is under the cap and is not biased', () => {
    const lead = 33.4;
    expect(renderLeadSampleCap(lead)).toBeGreaterThan(50.1);
    expect(nextRenderLead(lead, 50.1)).toBeCloseTo(lead * 0.8 + 50.1 * 0.2, 9);
  });

  it('the CI case: two stalled samples after boot no longer move the lead by tens of ms', () => {
    // Attempt 137982301334: lead 16, then a ~197 ms and a ~118 ms sample taken
    // across a post-engage stall, and the old EWMA landed at 65.4 ms.
    const old = run(oldNextLead, 16, [197, 118]);
    expect(old[1]).toBeGreaterThan(60);
    const now = run(nextRenderLead, 16, [197, 118]);
    // Cap at 16 is 48.7 ms → 22.5 ms; cap at 22.5 is 61.7 ms → 30.3 ms.
    expect(now[0]).toBeCloseTo(0.8 * 16 + 0.2 * (2 * 16 + RENDER_LEAD_FRAME_MS), 9);
    expect(now[1]).toBeLessThan(31);
  });

  it('one stall moves the lead by at most a fifth of (lead + one frame)', () => {
    for (const lead of [0, 16, 33.4, 80, 150]) {
      const n = nextRenderLead(lead, 399)!;
      expect(n - lead).toBeLessThanOrEqual(0.2 * (lead + RENDER_LEAD_FRAME_MS) + 1e-9);
    }
  });

  it('a stall is forgotten within a few normal flips', () => {
    const leads = run(nextRenderLead, 33.4, [380, 33.4, 33.4, 33.4, 33.4, 33.4]);
    expect(leads[0] - 33.4).toBeLessThan(10.1);
    expect(leads[leads.length - 1] - 33.4).toBeLessThan(3.5);
  });

  it('never locks out a genuinely slow device: it still climbs to its real latency', () => {
    // A device that really needs 100 ms decision-to-paint, starting from the seed.
    const leads = run(nextRenderLead, RENDER_LEAD_SEED_MS, Array.from({ length: 40 }, () => 100));
    // Grows at least 1.2x per flip while capped…
    expect(leads[0]).toBeGreaterThanOrEqual(1.2 * RENDER_LEAD_SEED_MS);
    expect(leads[9]).toBeGreaterThan(80);
    // …and settles on the real value.
    expect(leads[39]).toBeCloseTo(100, 0);
    // Even from zero.
    const fromZero = run(nextRenderLead, 0, Array.from({ length: 60 }, () => 100));
    expect(fromZero[59]).toBeCloseTo(100, 0);
  });

  it('still discards a sample from a hidden or frozen tab, and garbage', () => {
    expect(nextRenderLead(33, 401)).toBeNull();
    expect(nextRenderLead(33, -1)).toBeNull();
    expect(nextRenderLead(33, Number.NaN)).toBeNull();
    expect(nextRenderLead(33, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('keeps the lead inside [0, 150] and survives a garbage stored lead', () => {
    expect(nextRenderLead(150, 400)).toBeLessThanOrEqual(RENDER_LEAD_MAX_MS);
    expect(nextRenderLead(500, 400)).toBeLessThanOrEqual(RENDER_LEAD_MAX_MS);
    expect(nextRenderLead(-20, 0)).toBe(0);
    expect(nextRenderLead(Number.NaN, 16)).toBeCloseTo(16, 9);
  });
});
