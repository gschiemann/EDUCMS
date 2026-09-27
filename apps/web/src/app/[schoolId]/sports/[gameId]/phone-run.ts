/**
 * phone-run — pure helpers behind the phone Run view trays (K12-F15).
 *
 * `scoringSource` answers the question a phone operator cannot see from the
 * desktop-only Setup card: when I tap +2, does the crowd see it? A live
 * scoreboard console (CTS) overrides the operator's score and clock on every
 * public surface; a machine score feed writes over them with its next
 * packet. Copy states what the evidence proves: "live" only while the
 * heartbeat is inside its freshness window, and a silent source says how
 * long it has been silent.
 */
import {
  computeCtsStatus,
  computeFeedStatus,
} from '@/lib/cts-merge';

export type ScoringSource =
  | { kind: 'manual' }
  | { kind: 'cts-live' }
  | { kind: 'cts-stale'; seconds: number }
  | { kind: 'feed-live' }
  | { kind: 'feed-stale'; seconds: number };

/**
 * Who is driving the score right now. A CTS console heartbeat is checked
 * first (it overlays the public surfaces); the generic feed second (its
 * stamp also covers CTS / swim packets, so a CTS-sourced stamp is not
 * reported twice).
 */
export function scoringSource(stats: unknown, nowMs: number): ScoringSource {
  const cts = computeCtsStatus(stats, nowMs);
  if (cts.kind === 'fresh') return { kind: 'cts-live' };
  if (cts.kind === 'stale') {
    return { kind: 'cts-stale', seconds: Math.max(0, Math.round((cts.ageMs ?? 0) / 1000)) };
  }
  const feed = computeFeedStatus(stats, nowMs);
  if (feed.source === 'feed') {
    if (feed.kind === 'fresh') return { kind: 'feed-live' };
    if (feed.kind === 'stale') {
      return { kind: 'feed-stale', seconds: Math.max(0, Math.round((feed.ageMs ?? 0) / 1000)) };
    }
  }
  return { kind: 'manual' };
}
