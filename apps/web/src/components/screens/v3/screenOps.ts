/**
 * screenOps.ts — Calm Operations v3 derivation for the Screens page.
 *
 * Design source: scratch/design/screens-menu/SCREEN-OPERATIONS-V3-DESIGN-HANDOFF.md
 * (§3.1 worst-first priority, §6 assurance strip, §7 filter chips, §8 one
 * dominant status per row, §9 status taxonomy, §15 evidence boundary).
 *
 * ── Why a separate pure module ───────────────────────────────────────
 * Same discipline as `dashboard/district/fleetCommand.ts`: the table, the
 * assurance strip, the filter chips and the drawer are four drawings of ONE
 * derivation, so they can never disagree with each other. Nothing in here
 * touches React, the network, or the wall clock (the single `now` a caller
 * needs is injected, so every age on one render is measured against one
 * instant and every case is unit-testable).
 *
 * ── It invents no new semantics ──────────────────────────────────────
 * Render trust comes from `renderTrust.ts::deriveRenderTrustGrade`; bundle
 * currency from `bundleSkew.ts::deriveBundleSkew`; "behind on content" from
 * `fleetCommand.ts::isContentBehind`. This module's ONLY job is to collapse
 * those independent truths into the ONE dominant, plain-language status the
 * v3 row shows — and to keep the underlying truths separately addressable
 * for the drawer, which is where §3.3 says they belong.
 *
 * ── Evidence honesty (§15) ───────────────────────────────────────────
 *   • Missing data is 'unknown', never green and never zero.
 *   • "Reported content" is what the PLAYER said, never physical proof.
 *   • There is no Downloaded step: `Screen.lastCacheReport` is a
 *     service-worker asset-COVERAGE report (`{playlist:{count,bytes},
 *     emergency:{count,bytes}}`, apps/api/src/screens/screens.controller.ts
 *     `reportCacheStatus`) — it carries no revision identity, so it cannot
 *     acknowledge a specific deployment. §10 says omit rather than infer.
 *   • Physical display is always 'not-instrumented'.
 */

import { deriveRenderTrustGrade, type RenderHealth, type RenderTrustGrade } from '../renderTrust';
import { deriveBundleSkew, type BundleSkewVariant } from '../bundleSkew';
import { isContentBehind } from '@/components/dashboard/district/fleetCommand';
import { isWindowOpen } from '@/app/player/scheduleWindow';

// ═══════════════════════════════════════════════════════════════════
// Inputs — the subset of `GET /screens` this surface reads
// ═══════════════════════════════════════════════════════════════════

/** One row of `GET /screens` (apps/api/src/screens/screens.controller.ts list()). */
export interface OpsScreen {
  id: string;
  name?: string | null;
  status?: string | null;
  screenGroupId?: string | null;
  screenGroup?: { id: string; name: string; syncMode?: string | null } | null;
  lastPingAt?: string | null;
  renderHealth?: RenderHealth | null;
  renderStale?: boolean | null;
  lastRenderedAt?: string | null;
  lastRenderedHash?: string | null;
  lastBundleSha?: string | null;
  /**
   * `Screen.pendingRefreshAt` — an outstanding refresh command this screen
   * has NOT acknowledged. There is no persisted ack column: the server
   * CLEARS this field on the value-identity ack (screens.controller.ts
   * `reportRenderProof`), so "not null" IS "not yet confirmed".
   */
  pendingRefreshAt?: string | null;
  /** `Screen.lastPushConnectedAt` — dates a degraded push channel. */
  lastPushConnectedAt?: string | null;
  pushChannel?: 'live' | 'stale' | 'unknown' | null;
  authState?: string | null;
  hardwareModel?: string | null;
  resolution?: string | null;
  osInfo?: string | null;
  browserInfo?: string | null;
  orientation?: string | null;
  deviceFingerprint?: string | null;
  emergencyStatus?: string | null;
}

/** One row of `GET /schedules` (schedules.controller.ts list()). */
export interface OpsSchedule {
  id: string;
  playlistId?: string | null;
  screenId?: string | null;
  screenGroupId?: string | null;
  priority?: number | null;
  mode?: string | null;
  isActive?: boolean | null;
  startTime?: string | null;
  endTime?: string | null;
  daysOfWeek?: string | null;
  timeStart?: string | null;
  timeEnd?: string | null;
  playlist?: { id: string; name: string } | null;
}

/** One row of `GET /playlists` — read only for a name + a first still. */
export interface OpsPlaylist {
  id: string;
  name?: string | null;
  items?: Array<{ asset?: { fileUrl?: string | null; mimeType?: string | null } | null }> | null;
}

// ═══════════════════════════════════════════════════════════════════
// §9 status taxonomy
// ═══════════════════════════════════════════════════════════════════

export type StatusTone = 'ok' | 'warn' | 'bad' | 'neutral' | 'muted';

/**
 * The ONE dominant condition a row reports (§8: never stack five badges).
 * Ordered here worst-first — `STATUS_RANK` below is derived from this list,
 * so the table's sort order and the taxonomy can never drift apart.
 */
export const STATUS_ORDER = [
  'alert-unconfirmed', // emergency on glass, server contact lost
  'not-painting', // reachable, no confirmed picture
  'media-stalled', // video frame frozen, watchdog recovering
  'offline', // heartbeat stale
  'revoked', // access removed — cannot be told anything
  'content-behind', // assigned content has not converged
  'push-delayed', // live push degraded, polling backstop carrying it
  'repair-required', // credential downgraded
  'pending', // paired but has never checked in
  'confirming', // brief self-healing render gap
  'stale-chronic', // documented long absence of picture proof
  'idle', // alive, nothing scheduled
  'unknown', // no evidence capability
  'current', // earned positive evidence
] as const;

export type StatusKey = (typeof STATUS_ORDER)[number];

const STATUS_RANK: Record<StatusKey, number> = STATUS_ORDER.reduce(
  (acc, k, i) => { acc[k] = i; return acc; },
  {} as Record<StatusKey, number>,
);

/** Action verb offered on the row (§8) — one primary, never a menu. */
export type ActionVerb = 'Resync' | 'Retry' | 'Troubleshoot' | 'Re-pair' | 'Set up' | 'View';

export interface StatusDescriptor {
  key: StatusKey;
  tone: StatusTone;
  /** Plain-language dominant status (§9 "Default copy"). */
  label: string;
  /** Optional short age appended after a middot ("18m"). */
  age?: string;
  /** Optional second line of evidence, ONLY when it adds a fact (§8). */
  evidence?: string;
  /** The row's primary action verb. */
  action: ActionVerb;
  /** True when this screen belongs in the "Needs attention" bucket (§7). */
  needsAttention: boolean;
  /** Longer plain-English explanation for the tooltip / drawer banner. */
  detail: string;
}

// ═══════════════════════════════════════════════════════════════════
// Time helpers (pure — `now` is always injected)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compact age ("42s" / "18m" / "3h" / "2d"), or undefined when it cannot be
 * dated. A FUTURE stamp returns undefined on purpose: signage boxes run
 * minutes of clock skew and "-4m" is worse than silence. Copied in spirit
 * from fleetCommand.ts so both surfaces speak one age vocabulary.
 */
export function compactAge(atMs: number | null | undefined, now: number): string | undefined {
  if (atMs == null || !Number.isFinite(atMs)) return undefined;
  const sec = Math.floor((now - atMs) / 1000);
  if (sec < 0) return undefined;
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/** The same age spelled out for a sentence ("18 minutes"). */
export function wordyAge(atMs: number | null | undefined, now: number): string | undefined {
  if (atMs == null || !Number.isFinite(atMs)) return undefined;
  const sec = Math.floor((now - atMs) / 1000);
  if (sec < 0) return undefined;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (sec < 60) return plural(sec, 'second');
  const min = Math.floor(sec / 60);
  if (min < 60) return plural(min, 'minute');
  const hr = Math.floor(min / 60);
  if (hr < 24) return plural(hr, 'hour');
  return plural(Math.floor(hr / 24), 'day');
}

/** Parsed timestamp, or null — an unparseable stamp is no evidence. */
export function msOf(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// ═══════════════════════════════════════════════════════════════════
// The dominant status (§3.1 order, §9 copy)
// ═══════════════════════════════════════════════════════════════════

export interface DeriveStatusInput {
  screen: OpsScreen;
  /** SHA `/api/build-info` reports as deployed. Null → skew grades unknown. */
  deployedSha: string | null;
  now: number;
}

/**
 * Collapse every independent truth about one screen into the single
 * dominant condition its row reports.
 *
 * PRECEDENCE — §3.1, verbatim:
 *   1. Emergency delivery or all-clear risk
 *   2. Online but not painting / frozen media
 *   3. Offline
 *   4. Content behind
 *   5. Push channel degraded
 *   6. Re-pair or setup issue
 *   7. Healthy (and the calm not-an-alarm states)
 *
 * Note the deliberate re-ordering against `deriveRenderTrustGrade`, which
 * returns 'repair-required' INSTEAD of a green state. Here credential trust
 * is a rank-6 fact, so a screen that is both behind on content and needs
 * re-pairing reports the content problem — the one the operator can fix
 * from this page — and the drawer still shows both.
 */
export function deriveScreenStatus({ screen, deployedSha, now }: DeriveStatusInput): StatusDescriptor {
  const status = screen.status ?? null;
  const grade = deriveRenderTrustGrade({
    status,
    renderHealth: screen.renderHealth ?? null,
    renderStale: screen.renderStale ?? null,
    lastRenderedAtMs: msOf(screen.lastRenderedAt),
    lastRenderedHash: screen.lastRenderedHash ?? null,
    authState: screen.authState ?? null,
    nowMs: now,
  });

  // 1 ── an alert is on the glass that the server cannot re-confirm.
  if (grade === 'alert-unconfirmed') {
    return {
      key: 'alert-unconfirmed',
      tone: 'bad',
      label: 'Showing alert · server contact lost',
      age: compactAge(msOf(screen.lastRenderedAt), now),
      action: 'Troubleshoot',
      needsAttention: true,
      detail:
        'This screen is holding an emergency alert it has not been able to re-confirm with the server. Holding is correct — but an all-clear cannot reach it until it reconnects.',
    };
  }

  // 2 ── reachable, but the picture is not advancing.
  if (grade === 'not-painting') {
    return {
      key: 'not-painting',
      tone: 'bad',
      label: 'No picture confirmed',
      age: compactAge(msOf(screen.lastRenderedAt), now),
      action: 'Resync',
      needsAttention: true,
      detail:
        'The screen is answering, but it has not confirmed a picture for over five minutes. Send it a resync; if that does not help, someone should look at the panel.',
    };
  }
  if (grade === 'media-stalled') {
    return {
      key: 'media-stalled',
      tone: 'warn',
      label: 'Video stuck · fixing itself',
      age: compactAge(msOf(screen.lastRenderedAt), now),
      action: 'View',
      needsAttention: true,
      detail:
        'The screen is alive, but its current video has not advanced. The player is recovering on its own — reload, then skip the item.',
    };
  }

  // 3 ── not answering at all. The heartbeat owns this row's message.
  if (status === 'REVOKED') {
    return {
      key: 'revoked',
      tone: 'muted',
      label: 'Access removed',
      action: 'View',
      needsAttention: false,
      detail: 'This screen’s access was revoked. Pair it again to bring it back.',
    };
  }
  if (status === 'PENDING') {
    return {
      key: 'pending',
      tone: 'neutral',
      label: 'Waiting for first check-in',
      action: 'Set up',
      needsAttention: false,
      detail: 'This screen is paired but has not checked in yet. Finish setup on the device.',
    };
  }
  if (status !== 'ONLINE') {
    const pingMs = msOf(screen.lastPingAt);
    const words = wordyAge(pingMs, now);
    return {
      key: 'offline',
      tone: 'bad',
      label: 'Offline',
      age: compactAge(pingMs, now),
      action: 'Troubleshoot',
      needsAttention: true,
      detail: words
        ? `This screen last answered ${words} ago. Check its power and network at the site — it will pick up everything waiting the moment it comes back.`
        : 'This screen is not answering. Check its power and network at the site.',
    };
  }

  // 4 ── online, but the assigned content has not converged.
  const behind = isContentBehind(
    {
      status,
      lastBundleSha: screen.lastBundleSha ?? null,
      pendingRefreshAtMs: msOf(screen.pendingRefreshAt),
      // No persisted ack column — a cleared pendingRefreshAt IS the ack.
      refreshAckMs: null,
    },
    deployedSha,
  );
  if (behind) {
    const pendingMs = msOf(screen.pendingRefreshAt);
    const skew = deriveBundleSkew({
      status,
      reportedSha: screen.lastBundleSha ?? null,
      deployedSha,
    });
    return {
      key: 'content-behind',
      tone: 'bad',
      label: 'Content behind',
      age: compactAge(pendingMs, now),
      evidence:
        pendingMs != null
          ? 'Reported: update not confirmed'
          : skew === 'stale'
            ? 'Reported: older app version'
            : undefined,
      action: 'Resync',
      needsAttention: true,
      detail:
        pendingMs != null
          ? `An update was sent ${wordyAge(pendingMs, now) ?? 'a moment'} ago and this screen has not confirmed it yet.`
          : 'This screen is running an older version of the player app than the one published.',
    };
  }

  // 5 ── delivery is degraded but not absent.
  if (screen.pushChannel === 'stale') {
    const pushMs = msOf(screen.lastPushConnectedAt);
    return {
      key: 'push-delayed',
      tone: 'warn',
      label: 'Push delayed',
      age: compactAge(pushMs, now),
      evidence: 'Polling backstop active',
      action: 'Retry',
      needsAttention: true,
      detail:
        'The instant connection to this screen is down, so updates arrive on its own check-in instead — roughly every ten seconds. Content still lands, just slower.',
    };
  }

  // 6 ── credential trust needs an operator.
  if (grade === 'repair-required') {
    return {
      key: 'repair-required',
      tone: 'warn',
      label: 'Re-pair required',
      action: 'Re-pair',
      needsAttention: true,
      detail:
        'This screen is running on temporary keys. Content keeps playing, but pair it again to restore full trust and instant delivery.',
    };
  }

  // 7 ── the calm tier. None of these is an alarm.
  if (grade === 'checking') {
    return {
      key: 'confirming',
      tone: 'warn',
      label: 'Confirming picture…',
      age: compactAge(msOf(screen.lastRenderedAt), now),
      action: 'View',
      needsAttention: false,
      detail:
        'The screen paused its picture check-ins a moment ago — usually a reload or an update in progress. This becomes an alert only if it stays quiet past five minutes.',
    };
  }
  if (grade === 'stale-chronic') {
    return {
      key: 'stale-chronic',
      tone: 'muted',
      label: 'No picture confirmed',
      age: compactAge(msOf(screen.lastRenderedAt), now),
      action: 'View',
      needsAttention: false,
      detail:
        'This screen has not confirmed a picture in over 48 hours. Long-idle screens and older player versions both land here — worth a look when convenient.',
    };
  }
  if (grade === 'idle') {
    return {
      key: 'idle',
      tone: 'neutral',
      label: 'Screen on · nothing scheduled',
      action: 'View',
      needsAttention: false,
      detail: 'The screen is on and working — there is just no content scheduled for it yet.',
    };
  }
  if (grade === 'unknown') {
    return {
      key: 'unknown',
      tone: 'muted',
      label: 'Can’t confirm picture yet',
      action: 'View',
      needsAttention: false,
      detail:
        'This screen’s player app is too old to confirm its picture, or it just paired. Not a failure — update the player app to get picture confirmations.',
    };
  }
  return {
    key: 'current',
    tone: 'ok',
    label: 'Current',
    age: compactAge(msOf(screen.lastRenderedAt), now),
    action: 'View',
    needsAttention: false,
    // 2026-09-01 (Codex truth audit): this used to say "confirmed the
    // published content is on the glass" — the app version + a fresh
    // picture are both real evidence, but there is no expected-content-
    // signature to compare against yet, so this must stop short of
    // claiming the exact intended revision is proven on screen.
    detail: 'This screen is running the latest app version and confirmed a fresh picture.',
  };
}

// ═══════════════════════════════════════════════════════════════════
// §10 Overview — expected vs REPORTED content, and the evidence chain
// ═══════════════════════════════════════════════════════════════════

export interface ExpectedContent {
  /** The playlist scheduled to win on this screen right now, if any. */
  name: string | null;
  /** First still from that playlist — an EXPECTED image, never a capture. */
  thumbnailUrl: string | null;
  /** True when the winning schedule targets the group, not the screen. */
  viaGroup: boolean;
  /** A schedule exists but its day/time window is closed right now. */
  windowClosed: boolean;
}

/**
 * Which playlist is scheduled to be on this screen right now.
 *
 * Mirrors `apps/api/src/screens/effective-schedule.ts::orderSchedulesForManifest`
 * EXACTLY — replace rows before append, screen-pin before group, higher
 * priority, newest startTime, stable id — and then applies the player's own
 * rule: the first replace winner whose window is open. Two implementations of
 * one precedence is how a dashboard ends up naming content the glass never
 * shows, so if that file changes, change this in the same commit.
 */
export function deriveExpectedContent(
  screen: OpsScreen,
  schedules: OpsSchedule[],
  playlistById: Map<string, OpsPlaylist>,
  now: number,
): ExpectedContent {
  const mine = schedules.filter(
    (s) =>
      s.isActive !== false &&
      ((s.screenId && s.screenId === screen.id) ||
        (s.screenGroupId && screen.screenGroupId && s.screenGroupId === screen.screenGroupId)),
  );
  if (!mine.length) return { name: null, thumbnailUrl: null, viaGroup: false, windowClosed: false };

  const startMs = (s: OpsSchedule) => msOf(s.startTime) ?? 0;
  const ranked = [...mine].sort((a, b) => {
    const aAppend = (a.mode ?? 'replace') === 'append' ? 1 : 0;
    const bAppend = (b.mode ?? 'replace') === 'append' ? 1 : 0;
    if (aAppend !== bAppend) return aAppend - bAppend;
    const aPin = a.screenId ? 0 : 1;
    const bPin = b.screenId ? 0 : 1;
    if (aPin !== bPin) return aPin - bPin;
    const ap = a.priority ?? 0;
    const bp = b.priority ?? 0;
    if (ap !== bp) return bp - ap;
    const at = startMs(a);
    const bt = startMs(b);
    if (at !== bt) return bt - at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const nowDate = new Date(now);
  const replaceRows = ranked.filter((s) => (s.mode ?? 'replace') !== 'append');
  const open = replaceRows.find((s) => isWindowOpen(s, nowDate));
  const winner = open ?? replaceRows[0] ?? ranked[0];
  if (!winner) return { name: null, thumbnailUrl: null, viaGroup: false, windowClosed: false };

  const pl = winner.playlistId ? playlistById.get(winner.playlistId) : undefined;
  const firstStill =
    pl?.items?.find((i) => i.asset?.fileUrl && (i.asset.mimeType ?? '').startsWith('image/'))?.asset
      ?.fileUrl ?? null;

  return {
    name: winner.playlist?.name ?? pl?.name ?? null,
    thumbnailUrl: firstStill,
    viaGroup: !winner.screenId,
    windowClosed: !open,
  };
}

/** What the PLAYER told us about the content it is running. Never physical. */
export interface ReportedContent {
  state: 'confirmed' | 'behind' | 'unknown';
  /** One plain line — the exact fact, never a guess. */
  line: string;
  /** Secondary evidence, when there is any. */
  detail?: string;
}

export function deriveReportedContent(
  screen: OpsScreen,
  deployedSha: string | null,
  now: number,
): ReportedContent {
  if (screen.status !== 'ONLINE') {
    return {
      state: 'unknown',
      line: 'Not reported',
      detail: 'This screen isn’t answering, so it can’t tell us what it is running.',
    };
  }
  const pendingMs = msOf(screen.pendingRefreshAt);
  if (pendingMs != null) {
    return {
      state: 'behind',
      line: 'Update not confirmed',
      detail: `Sent ${wordyAge(pendingMs, now) ?? 'a moment'} ago; the screen has not echoed it back.`,
    };
  }
  const skew: BundleSkewVariant = deriveBundleSkew({
    status: screen.status,
    reportedSha: screen.lastBundleSha ?? null,
    deployedSha,
  });
  if (skew === 'stale') {
    return {
      state: 'behind',
      line: 'Older app version',
      detail: 'The screen is running a previous build of the player app; it reloads onto the new one on its own.',
    };
  }
  if (skew === 'unknown') {
    return {
      state: 'unknown',
      line: 'Not reported',
      detail: 'This screen hasn’t reported which version it is running.',
    };
  }
  return {
    state: 'confirmed',
    line: 'On the published version',
    detail: 'The screen reported the current app version and has no update outstanding.',
  };
}

/**
 * §10 evidence chain. THREE steps, not four.
 *
 * "Downloaded" is deliberately absent: the player emits no per-deployment
 * download milestone. The nearest field, `Screen.lastCacheReport`, is a
 * service-worker coverage count with no revision identity, so a green
 * Downloaded step would be inferred, not proven — and §15 forbids inferring
 * Downloaded from Online, or Rendered from Downloaded.
 */
export type EvidenceState = 'ok' | 'pending' | 'unknown' | 'not-instrumented';

export interface EvidenceStep {
  key: 'sent' | 'rendered' | 'physical';
  label: string;
  state: EvidenceState;
  /** What this step actually proves — shown under the chain, never implied. */
  note: string;
}

export function deriveEvidenceChain(
  screen: OpsScreen,
  status: StatusDescriptor,
  now: number,
): EvidenceStep[] {
  const pendingMs = msOf(screen.pendingRefreshAt);
  const renderedMs = msOf(screen.lastRenderedAt);
  const online = screen.status === 'ONLINE';

  const sent: EvidenceStep =
    pendingMs != null
      ? {
          key: 'sent',
          label: 'Sent',
          state: 'ok',
          note: `Update recorded ${wordyAge(pendingMs, now) ?? 'just now'} ago.`,
        }
      : {
          key: 'sent',
          label: 'Sent',
          state: 'unknown',
          note: 'No update is waiting on this screen.',
        };

  const renderedOk =
    online && renderedMs != null && (status.key === 'current' || status.key === 'idle');
  const rendered: EvidenceStep = renderedOk
    ? {
        key: 'rendered',
        label: 'Rendered',
        state: 'ok',
        note: `Screen confirmed a picture ${wordyAge(renderedMs, now) ?? 'just now'} ago.`,
      }
    : online && (pendingMs != null || status.key === 'confirming')
      ? {
          key: 'rendered',
          label: 'Rendered',
          state: 'pending',
          note: 'Waiting for the screen to confirm its picture.',
        }
      : {
          key: 'rendered',
          label: 'Rendered',
          state: 'unknown',
          note: 'No picture confirmation from this screen.',
        };

  const physical: EvidenceStep = {
    key: 'physical',
    label: 'Physical display',
    state: 'not-instrumented',
    note: 'Not instrumented — nothing is watching the actual panel.',
  };

  return [sent, rendered, physical];
}

/**
 * §10 recovery card. Renders ONLY while a real command is in flight, and
 * every state is derived from a durable event — never from a timer.
 */
export type RecoveryState =
  | 'sending'
  | 'accepted'
  | 'waiting-ack'
  | 'waiting-render'
  | 'recovered'
  | 'none';

export interface RecoveryCard {
  state: RecoveryState;
  heading: string;
  body: string;
}

export function deriveRecovery(input: {
  screen: OpsScreen;
  status: StatusDescriptor;
  /** The resync mutation is in flight in THIS tab right now. */
  sending: boolean;
  /** This tab's send returned 2xx and we have not re-read the fleet yet. */
  justSent: boolean;
  /** A `refresh-acked` event newer than the last send, if the history loaded. */
  ackedAtMs?: number | null;
  now: number;
}): RecoveryCard | null {
  const { screen, status, sending, justSent, ackedAtMs, now } = input;
  if (sending) {
    return {
      state: 'sending',
      heading: 'Sending request…',
      body: 'Passing the resync to this screen.',
    };
  }
  const pendingMs = msOf(screen.pendingRefreshAt);
  if (pendingMs != null) {
    // The command is recorded on the screen; the player has not echoed it.
    return {
      state: 'waiting-ack',
      heading: 'Resync in progress',
      body: `Request recorded ${wordyAge(pendingMs, now) ?? 'just now'} ago; waiting for this screen to confirm it.`,
    };
  }
  if (justSent) {
    return {
      state: 'accepted',
      heading: 'Request accepted',
      body: 'The server took the request. Waiting for this screen to confirm it.',
    };
  }
  if (ackedAtMs != null) {
    // Acknowledged. Only a fresh picture confirmation completes it.
    if (status.key === 'current' || status.key === 'idle') {
      return {
        state: 'recovered',
        heading: 'Recovered',
        body: `Screen confirmed the update ${wordyAge(ackedAtMs, now) ?? 'just now'} ago.`,
      };
    }
    return {
      state: 'waiting-render',
      heading: 'Update confirmed',
      body: 'The screen took the update. Waiting for a picture confirmation.',
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// §6 assurance strip · §7 filter chips · §8 grouped table
// ═══════════════════════════════════════════════════════════════════

export type AssuranceState = 'ok' | 'warn' | 'bad' | 'unknown';

export interface AssuranceItem {
  key: 'screens' | 'content' | 'online' | 'action' | 'emergency';
  /** Rendered as "9 Content current" — the value is already formatted. */
  value: string;
  label: string;
  state: AssuranceState;
  /** Tooltip — says what the denominator actually is. */
  detail: string;
}

export type FilterKey = 'all' | 'attention' | 'content-behind' | 'push-delayed' | 'offline';

export interface FilterChip {
  key: FilterKey;
  label: string;
  count: number;
}

export interface OpsRow {
  screen: OpsScreen;
  status: StatusDescriptor;
  expected: ExpectedContent;
  reported: ReportedContent;
  /** Sort key — lower is worse. */
  rank: number;
}

export interface OpsGroup {
  id: string;
  name: string;
  rows: OpsRow[];
  /** Screens in this group needing attention — drives auto-expand. */
  attention: number;
  /** Worst rank in the group (sort key). */
  rank: number;
  /** One quiet summary line when nothing is wrong (§8). */
  summary: string;
  /** Rolled-up connectivity for the collapsed row. */
  online: number;
  /** Newest last-contact in the group, for the collapsed row. */
  lastContactMs: number | null;
}

export interface ScreenOps {
  /** Every row, worst-first, ungrouped — the filter chips count off this. */
  rows: OpsRow[];
  groups: OpsGroup[];
  assurance: AssuranceItem[];
  chips: FilterChip[];
  /** Groups that must start expanded (problems + the selected screen's). */
  autoExpanded: Set<string>;
  totals: { screens: number; online: number; attention: number };
}

/** Location-level emergency readiness, exactly as the API reports it (§6). */
export interface ReadinessInput {
  /** False when the read never answered — the pill must stay gray. */
  known: boolean;
  locationsReady: number;
  locationsTotal: number;
  /** True when at least one location has nothing wired at all. */
  anyNotConfigured: boolean;
  anyNeedsAttention: boolean;
}

export const UNGROUPED_ID = '__ungrouped__';

export function buildScreenOps(input: {
  screens: OpsScreen[];
  schedules: OpsSchedule[];
  playlists: OpsPlaylist[];
  deployedSha: string | null;
  readiness: ReadinessInput;
  /** Keeps the selected screen's group open even when it is healthy (§8). */
  selectedScreenId?: string | null;
  now: number;
}): ScreenOps {
  const { screens, schedules, playlists, deployedSha, readiness, now } = input;

  const playlistById = new Map<string, OpsPlaylist>();
  for (const p of playlists) if (p?.id) playlistById.set(p.id, p);

  const rows: OpsRow[] = screens.map((screen) => {
    const status = deriveScreenStatus({ screen, deployedSha, now });
    return {
      screen,
      status,
      expected: deriveExpectedContent(screen, schedules, playlistById, now),
      reported: deriveReportedContent(screen, deployedSha, now),
      rank: STATUS_RANK[status.key],
    };
  });

  /** Worst first; oldest problem first inside a rank; then name; then id. */
  const compareRows = (a: OpsRow, b: OpsRow) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const an = (a.screen.name ?? '').toLowerCase();
    const bn = (b.screen.name ?? '').toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.screen.id < b.screen.id ? -1 : a.screen.id > b.screen.id ? 1 : 0;
  };
  const sortedRows = [...rows].sort(compareRows);

  // ── grouping ───────────────────────────────────────────────────
  const byGroup = new Map<string, OpsRow[]>();
  for (const r of sortedRows) {
    const gid = r.screen.screenGroupId || UNGROUPED_ID;
    const bucket = byGroup.get(gid);
    if (bucket) bucket.push(r);
    else byGroup.set(gid, [r]);
  }
  const groups: OpsGroup[] = [...byGroup.entries()].map(([id, groupRows]) => {
    const attention = groupRows.filter((r) => r.status.needsAttention).length;
    const online = groupRows.filter((r) => r.screen.status === 'ONLINE').length;
    const lastContactMs = groupRows.reduce<number | null>((acc, r) => {
      const t = msOf(r.screen.lastPingAt);
      if (t == null) return acc;
      return acc == null || t > acc ? t : acc;
    }, null);
    const name =
      id === UNGROUPED_ID
        ? 'Not in a group'
        : groupRows[0]?.screen.screenGroup?.name || 'Group';
    // A quiet summary the collapsed row can carry (§8). It must not claim
    // more than the rows do: "All screens current" only when every row
    // actually earned the green state.
    const allCurrent = groupRows.every((r) => r.status.key === 'current');
    const summary = attention > 0
      ? `${attention} need${attention === 1 ? 's' : ''} attention`
      : allCurrent
        ? 'All screens current'
        : 'No action needed';
    return {
      id,
      name,
      rows: groupRows,
      attention,
      rank: groupRows.length ? Math.min(...groupRows.map((r) => r.rank)) : STATUS_RANK.current,
      summary,
      online,
      lastContactMs,
    };
  });
  groups.sort((a, b) => {
    // Ungrouped parks last among equals so named groups read first.
    if (a.rank !== b.rank) return a.rank - b.rank;
    const aU = a.id === UNGROUPED_ID ? 1 : 0;
    const bU = b.id === UNGROUPED_ID ? 1 : 0;
    if (aU !== bU) return aU - bU;
    return a.name.localeCompare(b.name);
  });

  const autoExpanded = new Set<string>();
  for (const g of groups) if (g.attention > 0) autoExpanded.add(g.id);
  if (input.selectedScreenId) {
    const sel = rows.find((r) => r.screen.id === input.selectedScreenId);
    if (sel) autoExpanded.add(sel.screen.screenGroupId || UNGROUPED_ID);
  }

  // ── §6 assurance strip ─────────────────────────────────────────
  const total = screens.length;
  const online = screens.filter((s) => s.status === 'ONLINE').length;
  const attention = rows.filter((r) => r.status.needsAttention).length;
  // "Content current" is measured only over screens whose content state can
  // actually be graded — a screen that reported nothing is not evidence of
  // health, and §13 forbids showing it as green or zero.
  const gradeable = screens.filter(
    (s) =>
      s.status === 'ONLINE' &&
      ((!!deployedSha && !!s.lastBundleSha) || s.pendingRefreshAt != null),
  );
  const behind = rows.filter((r) => r.status.key === 'content-behind').length;
  const contentCurrent = Math.max(0, gradeable.length - behind);

  const assurance: AssuranceItem[] = [
    {
      key: 'screens',
      value: String(total),
      label: total === 1 ? 'Screen' : 'Screens',
      state: total === 0 ? 'unknown' : 'ok',
      detail: 'Every screen paired to this location.',
    },
    gradeable.length === 0
      ? {
          key: 'content' as const,
          value: '—',
          label: 'Content not reported',
          state: 'unknown' as const,
          detail:
            'No screen has reported which version it is running, so content currency can’t be graded yet.',
        }
      : {
          key: 'content' as const,
          value: String(contentCurrent),
          // "App current" (2026-09-01, Codex truth audit) — this measures
          // player-app version + any pending push landing, not that the
          // exact intended revision is proven on screen. See the row-level
          // "Current" status detail for the same correction.
          label: 'App current',
          state: behind === 0 ? ('ok' as const) : ('warn' as const),
          detail: `${contentCurrent} of ${gradeable.length} screens that report their version have the app up to date. Does not confirm the exact picture on screen.`,
        },
    {
      key: 'online',
      value: String(online),
      label: 'Online',
      state: total === 0 ? 'unknown' : online === total ? 'ok' : online === 0 ? 'bad' : 'warn',
      detail: 'Screens that are answering. Online does not prove current content.',
    },
    {
      key: 'action',
      value: String(attention),
      label: 'Need action',
      state: attention === 0 ? 'ok' : 'bad',
      detail: 'Unique screens with an actionable problem — never the sum of problem types.',
    },
    readiness.known
      ? {
          key: 'emergency' as const,
          value: `${readiness.locationsReady}/${readiness.locationsTotal}`,
          label: readiness.locationsTotal === 1 ? 'Location emergency ready' : 'Locations emergency ready',
          state: readiness.anyNotConfigured
            ? ('bad' as const)
            : readiness.anyNeedsAttention
              ? ('warn' as const)
              : ('ok' as const),
          detail:
            'Emergency readiness is graded per location, not per screen — this is the location-level verdict. Does not check that alert media is freshly cached on each device.',
        }
      : {
          key: 'emergency' as const,
          value: '—',
          label: 'Emergency readiness unknown',
          state: 'unknown' as const,
          detail: 'The readiness check didn’t answer, so this stays unknown rather than green.',
        },
  ];

  // ── §7 filter chips (single-select, "All" always present) ───────
  const chips: FilterChip[] = [
    { key: 'all', label: 'All', count: total },
    { key: 'attention', label: 'Needs attention', count: attention },
    { key: 'content-behind', label: 'Content behind', count: behind },
    { key: 'push-delayed', label: 'Push delayed', count: rows.filter((r) => r.status.key === 'push-delayed').length },
    { key: 'offline', label: 'Offline', count: rows.filter((r) => r.status.key === 'offline').length },
  ];

  return {
    rows: sortedRows,
    groups,
    assurance,
    chips,
    autoExpanded,
    totals: { screens: total, online, attention },
  };
}

/** Does this row survive the selected chip? (§7 — search composes on top.) */
export function matchesFilter(row: OpsRow, filter: FilterKey): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'attention':
      return row.status.needsAttention;
    case 'content-behind':
      return row.status.key === 'content-behind';
    case 'push-delayed':
      return row.status.key === 'push-delayed';
    case 'offline':
      return row.status.key === 'offline';
    default:
      return true;
  }
}

/**
 * §7 search — name, group, hardware model. The device fingerprint is
 * deliberately NOT searched here: it is support/advanced vocabulary and the
 * list route strips it for low-privilege roles anyway.
 */
export function matchesQuery(row: OpsRow, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const s = row.screen;
  const hay = [s.name, s.screenGroup?.name, s.hardwareModel, row.expected.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(normalizedQuery);
}

/** Grade helper re-exported so the drawer reads the SAME call the row made. */
export function gradeOf(screen: OpsScreen, now: number): RenderTrustGrade {
  return deriveRenderTrustGrade({
    status: screen.status ?? null,
    renderHealth: screen.renderHealth ?? null,
    renderStale: screen.renderStale ?? null,
    lastRenderedAtMs: msOf(screen.lastRenderedAt),
    lastRenderedHash: screen.lastRenderedHash ?? null,
    authState: screen.authState ?? null,
    nowMs: now,
  });
}
