/**
 * renderLead — the frame-locked sync conductor's estimate of this device's
 * decision-to-paint latency, as a pure function (2026-11-23).
 *
 * The conductor leads every flip DECISION by this number so the painted frame,
 * not the decision, lands on the shared boundary. page.tsx measures one sample
 * per boundary flip (double-rAF after the decision) and feeds it here.
 *
 * THE BUG IT FIXES. The estimate was a plain EWMA (alpha 0.2) that accepted any
 * sample up to 400 ms. One stalled sample moved it by a fifth of the stall: in
 * CI a screen's lead went from 16 to 65 ms after two samples taken across a
 * post-boot stall (about 197 and 118 ms), and that screen then decided its
 * flips tens of ms early for about ten flips. The lead is persisted to
 * localStorage every 10 s, so the error could survive a reboot.
 *
 * THE RULE NOW: a sample is capped at twice the current lead plus one 60 Hz
 * frame before it enters the EWMA. Chosen over the alternatives because:
 *   - Rejecting such a sample outright could lock a genuinely slow device out
 *     of calibration forever (every sample above the bar, the lead never
 *     moves). With the cap the lead still climbs at least 1.2x per flip, plus
 *     a third of a frame, so a device that really needs 100 ms gets there from
 *     the 16 ms seed in about ten flips.
 *   - A short median needs a ring buffer that has to be seeded, reset and
 *     reasoned about at boot, and two stalls in a row (what CI showed) get
 *     through a median of three anyway.
 *   - The cap is stateless: it only reads the lead the page already holds.
 * Normal jitter is untouched: at a typical 33 ms lead the cap is about 83 ms,
 * above a sample with one dropped frame (about 50 ms), so the steady-state
 * estimate is not biased. One stall now moves the lead by at most
 * 0.2 x (lead + one frame), about 10 ms at a 33 ms lead, instead of up to 73.
 *
 * A sample outside [0, 400] ms is still discarded (a hidden or frozen tab), and
 * the lead stays clamped to [0, 150] ms as before.
 *
 * No React, no DOM: page.tsx feeds it the measured latency and stores the answer.
 */

/** Starting lead before any measurement: one 60 Hz frame. */
export const RENDER_LEAD_SEED_MS = 16;
/** The lead never goes above this (the decision can lead the boundary by 8 + this). */
export const RENDER_LEAD_MAX_MS = 150;
/** A sample above this is a stalled or hidden tab and is discarded. */
export const RENDER_LEAD_MAX_SAMPLE_MS = 400;
/** EWMA weight of a new sample. */
export const RENDER_LEAD_ALPHA = 0.2;
/** One frame at 60 Hz. */
export const RENDER_LEAD_FRAME_MS = 1000 / 60;

function clampLead(v: number): number {
  return Math.max(0, Math.min(RENDER_LEAD_MAX_MS, v));
}

/** The largest sample that may enter the EWMA at this lead. */
export function renderLeadSampleCap(leadMs: number): number {
  return 2 * clampLead(Number.isFinite(leadMs) ? leadMs : RENDER_LEAD_SEED_MS) + RENDER_LEAD_FRAME_MS;
}

/**
 * The new lead after one decision-to-paint sample, or null when the sample is
 * discarded (not finite, negative, or above RENDER_LEAD_MAX_SAMPLE_MS) and the
 * lead must stay as it is.
 */
export function nextRenderLead(prevLeadMs: number, sampleMs: number): number | null {
  if (!Number.isFinite(sampleMs) || sampleMs < 0 || sampleMs > RENDER_LEAD_MAX_SAMPLE_MS) return null;
  const prev = clampLead(Number.isFinite(prevLeadMs) ? prevLeadMs : RENDER_LEAD_SEED_MS);
  const sample = Math.min(sampleMs, renderLeadSampleCap(prev));
  return clampLead(prev * (1 - RENDER_LEAD_ALPHA) + sample * RENDER_LEAD_ALPHA);
}
