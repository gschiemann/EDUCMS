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

import {
  deriveRenderTrustGrade,
  IDLE_PROOF_PREFIX,
  PAUSED_PROOF_PREFIX,
  type RenderHealth,
  type RenderTrustGrade,
} from '../renderTrust';
import { deriveBundleSkew, type BundleSkewVariant } from '../bundleSkew';
import { contentBehindCause } from '@/components/dashboard/district/fleetCommand';
import { isWindowOpen } from '@/app/player/scheduleWindow';
import { templatePosterUrl } from '@/lib/template-poster';

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
  /**
   * 2026-09-16 — server-derived "this screen is frame-locked right now", from
   * `Playlist.syncPlayback` on whatever it is scheduled (plus the legacy group
   * flag). Replaces reading `screenGroup.syncMode` here: a group holds several
   * playlists, so it never answered this question for an individual screen.
   * Resolved by apps/api/src/screens/screen-sync.ts, the same helper the
   * player manifest uses, so the badge cannot disagree with the device.
   */
  syncActive?: boolean | null;
  lastPingAt?: string | null;
  renderHealth?: RenderHealth | null;
  renderStale?: boolean | null;
  lastRenderedAt?: string | null;
  lastRenderedHash?: string | null;
  lastBundleSha?: string | null;
  /**
   * `Screen.lastBundleId` — the identity the player actually decides to
   * RELOAD on (2026-09-21). The commit SHA above moves on every commit,
   * including ones that cannot change a downloaded byte; this only moves
   * when the client bundle can actually differ, so it is what "on the
   * published version" has to be graded against.
   */
  lastBundleId?: string | null;
  /**
   * `Screen.lastVideoReport` (2026-09-24) — the dropped-frame sample the
   * player took from the last <video> it played (`getVideoPlaybackQuality`).
   * The one fact that tells a bad FILE from a struggling PLAYER on the wall.
   */
  lastVideoReport?: VideoPlaybackSample | null;
  lastVideoReportAt?: string | null;
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
  /** `Screen.playerVersion` / `managerVersion` — the APK pair the device last reported. */
  playerVersion?: string | null;
  managerVersion?: string | null;
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

/**
 * One row of `GET /playlists` — a name, a first still, and (2026-09-24) the
 * item facts the player signs its render proof with, so the Overview can say
 * "Playing <name>" and mean it.
 */
export interface OpsPlaylist {
  id: string;
  name?: string | null;
  items?: Array<{
    /** `PlaylistItem.id` — the manifest's `item_id`, which the player signs. */
    id?: string | null;
    sequenceOrder?: number | null;
    durationMs?: number | null;
    asset?: {
      fileUrl?: string | null;
      mimeType?: string | null;
      /** A video's poster frame (`Asset.posterUrl`, 2026-09-11). */
      posterUrl?: string | null;
    } | null;
  }> | null;
  /** A playlist can BE a board — a template with no items of its own. */
  template?: {
    id?: string | null;
    name?: string | null;
    bgColor?: string | null;
    bgGradient?: string | null;
    bgImage?: string | null;
    zones?: Array<{ widgetType: string; defaultConfig?: unknown }> | null;
  } | null;
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
  'content-behind', // an update was SENT and the screen has not confirmed it
  'push-delayed', // live push degraded, polling backstop carrying it
  'app-updating', // playing correctly, on an older page bundle, self-healing
  'repair-required', // credential downgraded
  'pending', // paired but has never checked in
  'confirming', // brief self-healing render gap
  'stale-chronic', // documented long absence of picture proof
  'paused', // alive, content scheduled, paused on the screen by an operator
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
  /** `bundleId` `/api/build-info` reports as deployed (2026-09-21) — the
   *  identity the player actually reloads on; preferred over the SHA when
   *  both sides report one. */
  deployedBundleId?: string | null;
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
 *
 * 2026-09-04: rank 2 ('not painting') no longer beats it for a
 * REPAIR_REQUIRED screen, because the grade function no longer produces
 * 'not-painting' for one. Render proof is a WRITE, and SEC-001 refuses every
 * write from an unproven credential — so missing proof on a downgraded
 * screen is the credential, not the picture, and reporting it as a render
 * fault sent operators to the panel for a problem fixed from this page.
 */
export function deriveScreenStatus({
  screen,
  deployedSha,
  deployedBundleId,
  now,
}: DeriveStatusInput): StatusDescriptor {
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

  // 4 ── online, but something has not converged. WHICH something decides
  // whether this is an alarm (2026-09-16).
  //
  // Greg, twice in one afternoon: "why is every screen showing its behind? i
  // havent changed anything on the playlists", then "still getting content
  // behind on a few screens....they are online and rotating content right now".
  // Both times every row read "Content behind · Reported: older app version",
  // and both times the cause was a WEB DEPLOY — deployedSha moves out from
  // under the whole fleet at once, and every panel grades stale until it
  // reloads. One of those rows had NOTHING SCHEDULED and still claimed to be
  // behind on content.
  //
  // A stale page bundle is not a content failure. The screen is playing exactly
  // what it was told to play; it is doing so with older app code, and the drift
  // detector reloads it on its own. Calling that "Content behind" in red sends
  // the operator to look for a delivery problem that does not exist — twice, in
  // this case, during a live test.
  const cause = contentBehindCause(
    {
      status,
      lastBundleSha: screen.lastBundleSha ?? null,
      lastBundleId: screen.lastBundleId ?? null,
      pendingRefreshAtMs: msOf(screen.pendingRefreshAt),
      // No persisted ack column — a cleared pendingRefreshAt IS the ack.
      refreshAckMs: null,
    },
    deployedSha,
    deployedBundleId,
  );
  if (cause === 'push-unacked') {
    const pendingMs = msOf(screen.pendingRefreshAt);
    return {
      key: 'content-behind',
      tone: 'bad',
      label: 'Content behind',
      age: compactAge(pendingMs, now),
      evidence: 'Reported: update not confirmed',
      action: 'Resync',
      needsAttention: true,
      detail: `An update was sent ${wordyAge(pendingMs, now) ?? 'a moment'} ago and this screen has not confirmed it yet.`,
    };
  }
  if (cause === 'stale-bundle') {
    // NOT an exception. `needsAttention` is false on purpose: this screen is
    // showing its assigned content right now, and the only difference from a
    // green row is which build of the app is drawing it. It updates itself —
    // the drift detector polls, waits out a 60-300s spread so a fleet does not
    // stampede, then defers behind playback to a 12-minute cap and forces the
    // reload.
    //
    // NO ACTION ON THE ROW (2026-09-21). This used to offer Resync "for an
    // operator who does not want to wait". Every web deploy puts the WHOLE
    // fleet in this state for the length of that window, so on a day with a
    // few deploys every row on the Screens page carried a Resync button —
    // the operator, from his phone: "why does every screen say resync on
    // it…our app needs to self heal not … be asking me to do shit all the
    // time". A state that heals itself must not look like a request. The
    // drawer keeps its Resync button for the rare operator who wants it now.
    //
    // Keeping it visible but calm is the whole point: silent would hide a panel
    // genuinely stuck on old code (the 2026-06-27 launch blocker), and red sent
    // Greg hunting a delivery fault that was never there.
    return {
      key: 'app-updating',
      tone: 'muted',
      label: 'Player update pending',
      evidence: 'Content is playing on the previous player build',
      action: 'View',
      needsAttention: false,
      detail:
        'This screen is playing its scheduled content on an older build of the player app. It reloads onto the current build on its own, usually within half an hour. Nothing for you to do.',
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
      // 2026-09-01: this used to say "pair it again", which sent the operator
      // hunting for a pairing code a screen in this state never shows. The
      // drawer's Actions tab now carries a one-click Restore trust that arms
      // the server-side heal (POST /screens/:id/restore-trust).
      detail:
        'This screen is running on temporary keys, so the server is refusing its ' +
        'picture-proof reports — an absent proof here is the credential, not the panel. ' +
        'Content keeps playing. Open Actions and tap Restore trust; the screen proves ' +
        'its credential on its next check-in and picture proof resumes with it.',
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
  if (grade === 'paused') {
    // 2026-09-01 (TC22 field find): an operator paused playback on the
    // screen itself and this row said "nothing scheduled" while a playlist
    // was assigned — false information. The player now proves the pause
    // under its own prefix (see PAUSED_PROOF_PREFIX); say what it proves.
    return {
      key: 'paused',
      tone: 'neutral',
      label: 'Paused on the screen',
      age: compactAge(msOf(screen.lastRenderedAt), now),
      action: 'View',
      needsAttention: false,
      detail:
        'Someone paused playback on the screen itself (remote: Back, then Stop). The scheduled content is still assigned and plays again as soon as Resume is pressed on the screen.',
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

/** What the Expected preview is actually a picture of.
 *  'still'  — the first image in the playlist
 *  'frame'  — the first frame of the first video (browser-decoded, muted)
 *  'board'  — the template's pre-rendered poster: the board's PRISTINE look,
 *             so operator brand/text overrides are NOT reflected in it
 *  'tint'   — no image exists; the board's own background colour/gradient
 *  'none'   — there is genuinely nothing to show */
export type ExpectedThumbnailKind = 'still' | 'frame' | 'board' | 'tint' | 'none';

export interface ExpectedContent {
  /** The playlist scheduled to win on this screen right now, if any. */
  name: string | null;
  /** Its id (2026-09-24), so the player's render proof can be matched to it. */
  playlistId: string | null;
  /** The board it is laid onto, when the playlist is template-backed. */
  templateId: string | null;
  /**
   * The render proof the player would sign for exactly this content
   * (`pl:<sig>`, see `playlistRenderSignature`), rebuilt from the same item
   * facts the manifest serves — so `deriveReportedContent` can say "Playing
   * <name>" only when the screen's own report says so. Null when the items
   * cannot be signed (no item ids), in which case nothing is claimed.
   */
  renderSignature: string | null;
  /** An EXPECTED preview of that playlist, never a capture of the glass.
   *  `thumbnailKind` says what it actually is so the UI never implies a
   *  poster of a board is a photograph of the screen. */
  thumbnailUrl: string | null;
  thumbnailKind: ExpectedThumbnailKind;
  /** Paintable background of a board we have no poster for — last resort so a
   *  template-backed playlist is never a blank grey box. */
  thumbnailTint: string | null;
  /** A video's poster frame, when the preview is a video (`thumbnailKind`
   *  'frame'). Null = no poster yet; the tile falls back to a first frame. */
  posterUrl: string | null;
  /** True when the winning schedule targets the group, not the screen. */
  viaGroup: boolean;
  /** A schedule exists but its day/time window is closed right now. */
  windowClosed: boolean;
}

/** The honest empty answer: nothing scheduled, nothing to preview. */
const NOTHING_SCHEDULED: ExpectedContent = Object.freeze({
  name: null,
  playlistId: null,
  templateId: null,
  renderSignature: null,
  thumbnailUrl: null,
  thumbnailKind: 'none',
  thumbnailTint: null,
  posterUrl: null,
  viaGroup: false,
  windowClosed: false,
});

/**
 * The render proof the player signs for a playlist: `pl:` + one
 * `<sequence>|<durationMs>|<item id>` per item, in order, joined by `||` —
 * the recipe in apps/web/src/app/player/page.tsx (`currentPlaylistSigRef`),
 * fed by the same PlaylistItem facts the manifest serializes
 * (screens.controller.ts: `item_id` / `duration_ms` / `sequence`). Rebuilt
 * here from `GET /playlists` so the dashboard can recognise its own schedule
 * in `Screen.lastRenderedHash`. Null when an item has no id: then nothing
 * can be matched honestly, and the Overview says "a playlist" instead.
 *
 * If either side of this recipe changes, the other changes in the same
 * commit — otherwise every screen silently stops reading "Playing <name>".
 */
export function playlistRenderSignature(pl: OpsPlaylist | null | undefined): string | null {
  const items = pl?.items ?? [];
  if (items.length === 0) return null;
  const ordered = items
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => (a.it.sequenceOrder ?? a.idx) - (b.it.sequenceOrder ?? b.idx) || a.idx - b.idx);
  const parts: string[] = [];
  for (const { it, idx } of ordered) {
    if (!it.id) return null;
    parts.push(`${it.sequenceOrder ?? idx}|${it.durationMs ?? 0}|${it.id}`);
  }
  return `pl:${parts.join('||')}`;
}

/**
 * Does a stored render proof name this signature? The API keeps the first
 * 128 characters of what the player sent (64 on the legacy route), so a long
 * playlist's proof is a PREFIX of its signature. A prefix that covers at
 * least the whole first item is a match; anything shorter is not evidence.
 */
export function renderProofMatches(signature: string | null, proof: string | null | undefined): boolean {
  if (!signature || !proof) return false;
  if (proof === signature) return true;
  if (!signature.startsWith(proof)) return false;
  const firstItemEnd = signature.indexOf('||');
  const minimum = firstItemEnd === -1 ? signature.length : firstItemEnd;
  return proof.length >= minimum;
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
  if (!mine.length) return NOTHING_SCHEDULED;

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
  if (!winner) return NOTHING_SCHEDULED;

  const pl = winner.playlistId ? playlistById.get(winner.playlistId) : undefined;
  const preview = previewOf(pl);

  return {
    name: winner.playlist?.name ?? pl?.name ?? null,
    playlistId: winner.playlistId ?? pl?.id ?? null,
    templateId: pl?.template?.id ?? null,
    renderSignature: playlistRenderSignature(pl),
    thumbnailUrl: preview.url,
    thumbnailKind: preview.kind,
    thumbnailTint: preview.tint,
    posterUrl: preview.posterUrl,
    viaGroup: !winner.screenId,
    windowClosed: !open,
  };
}

/**
 * The best EXPECTED picture of a playlist, in descending order of directness.
 *
 * The operator's report (2026-09-01) was that only image playlists previewed:
 * a playlist that IS a board, or holds only video, showed a blank grey box.
 * Measured across the fleet at the time: 42 playlists previewed, 49 did not
 * (24 board-backed, 15 html/pdf, 10 video-only).
 *
 * Order matters. A playlist's OWN media outranks the board it is laid onto,
 * because that media is the thing that changes; the board poster is the
 * pristine template. Each step is honest about what it produced — see
 * ExpectedThumbnailKind — so no caller can present a board poster as evidence
 * of what is on the glass.
 */
export function previewOf(
  pl: OpsPlaylist | undefined,
): { url: string | null; kind: ExpectedThumbnailKind; tint: string | null; posterUrl: string | null } {
  const items = pl?.items ?? [];
  const still = items.find((i) => i.asset?.fileUrl && (i.asset.mimeType ?? '').startsWith('image/'))?.asset?.fileUrl;
  if (still) return { url: still, kind: 'still', tint: null, posterUrl: null };

  // A video previews as its poster frame when the API has cut one
  // (2026-09-24) — a plain image that paints on every browser and every
  // input; the tile falls back to a browser-decoded first frame without it.
  const videoItem = items.find((i) => i.asset?.fileUrl && (i.asset.mimeType ?? '').startsWith('video/'));
  const video = videoItem?.asset?.fileUrl;
  if (video) return { url: video, kind: 'frame', tint: null, posterUrl: videoItem?.asset?.posterUrl ?? null };

  // A board with no media of its own. `allowCustomized` because the caller's
  // only alternative is a blank box: a table row cannot mount a live 4K frame,
  // and "which board is this" is still worth answering. Callers label it as
  // the template's own look, never as the operator's customized result.
  const poster = templatePosterUrl(pl?.template?.zones, { allowCustomized: true });
  if (poster) return { url: poster, kind: 'board', tint: null, posterUrl: null };

  const t = pl?.template;
  const tint = t?.bgImage
    ? (t.bgImage.trim().startsWith('url(') ? t.bgImage : `url(${t.bgImage})`)
    : (t?.bgGradient || t?.bgColor || null);
  if (tint) return { url: null, kind: 'tint', tint, posterUrl: null };

  return { url: null, kind: 'none', tint: null, posterUrl: null };
}

/**
 * What the PLAYER told us it is running. Never physical — the dashboard
 * cannot see the panel, only the player's own report.
 *
 * 2026-09-24 rewrite. Greg, on the old "Reported content · On the published
 * version" card: "what is this menu even telling me? it doesnt show that the
 * content was pushed but i know its playing". That card answered a different
 * question (is the player APP current?) under a heading about content. This
 * one reads the render proof the player signs every ~30 s
 * (`Screen.lastRenderedHash`): which KIND of thing is on the glass — a
 * playlist, a board, the waiting screen, a pause, a stuck video, an alert —
 * and, for a playlist or board, whether it is THE scheduled one, by matching
 * the proof against the signature rebuilt from the schedule
 * (`ExpectedContent.renderSignature`). It claims "Playing <name>" only on a
 * match; anything it cannot match is "a playlist", never an accusation. The
 * app-version fact survives as its own line (`app`).
 */
export type ReportedState =
  | 'confirmed' // playing exactly what is scheduled
  | 'playing' // playing a playlist or board that cannot be matched to the schedule
  | 'behind' // an update is outstanding, or the schedule is not on the glass yet
  | 'idle' // the waiting screen, with nothing scheduled (or the window closed)
  | 'paused' // paused on the screen itself
  | 'stalled' // the current video is not advancing; the player is recovering
  | 'emergency' // an alert is on the glass
  | 'unknown'; // offline, or no proof at all

export interface ReportedContent {
  state: ReportedState;
  /** One plain line — the exact fact, never a guess. */
  line: string;
  /** Secondary evidence, when there is any. */
  detail?: string;
  /** The player APP's version — a separate fact, never dressed up as content. */
  app: { state: 'current' | 'updating' | 'unknown'; line: string | null };
}

function deriveAppVersion(
  screen: OpsScreen,
  deployedSha: string | null,
  deployedBundleId?: string | null,
): ReportedContent['app'] {
  const skew: BundleSkewVariant = deriveBundleSkew({
    status: screen.status,
    reportedSha: screen.lastBundleSha ?? null,
    deployedSha,
    reportedBundleId: screen.lastBundleId ?? null,
    deployedBundleId,
  });
  if (skew === 'stale') return { state: 'updating', line: 'Player app: update pending — it reloads onto the current build on its own.' };
  if (skew === 'unknown') return { state: 'unknown', line: null };
  return { state: 'current', line: 'Player app: current build.' };
}

export function deriveReportedContent(
  screen: OpsScreen,
  deployedSha: string | null,
  now: number,
  deployedBundleId?: string | null,
  expected?: ExpectedContent | null,
): ReportedContent {
  const app = deriveAppVersion(screen, deployedSha, deployedBundleId);
  if (screen.status !== 'ONLINE') {
    const heard = wordyAge(msOf(screen.lastPingAt), now);
    return {
      state: 'unknown',
      line: 'Not reporting',
      detail: heard
        ? `This screen isn’t answering, so it can’t say what it is playing. Last heard from ${heard} ago.`
        : 'This screen isn’t answering, so it can’t say what it is playing.',
      app,
    };
  }

  const proof = screen.lastRenderedHash ?? '';
  const confirmedAgo = wordyAge(msOf(screen.lastRenderedAt), now);
  const dated = (text: string) => (confirmedAgo ? `${text} Confirmed ${confirmedAgo} ago.` : text);
  const pendingMs = msOf(screen.pendingRefreshAt);
  const scheduled = expected?.name ?? null;

  // The alert proofs first — the same precedence the status grade uses.
  if (proof.startsWith('unconfirmed|em:')) {
    return {
      state: 'emergency',
      line: 'Showing an emergency alert',
      detail: 'The screen is holding an alert it has not been able to re-confirm with the server.',
      app,
    };
  }
  if (proof.startsWith('em:')) {
    return { state: 'emergency', line: 'Showing an emergency alert', detail: dated('The alert is on the glass.'), app };
  }
  if (proof.startsWith('stall|')) {
    return {
      state: 'stalled',
      line: 'Video stuck',
      detail: 'The current video stopped advancing; the player is restarting it on its own.',
      app,
    };
  }
  if (proof.startsWith(PAUSED_PROOF_PREFIX)) {
    return {
      state: 'paused',
      line: 'Paused on the screen',
      detail: 'Someone paused playback on the screen itself. It resumes from the screen.',
      app,
    };
  }
  // An outstanding update outranks whatever is on the glass: until the screen
  // echoes it back, what it shows may be the previous content.
  if (pendingMs != null) {
    return {
      state: 'behind',
      line: 'Update not confirmed',
      detail: `Sent ${wordyAge(pendingMs, now) ?? 'a moment'} ago; the screen has not echoed it back yet.`,
      app,
    };
  }
  if (proof.startsWith(IDLE_PROOF_PREFIX)) {
    if (scheduled && !expected?.windowClosed) {
      return {
        state: 'behind',
        line: 'Not showing the schedule yet',
        detail: dated('The screen is on its waiting screen and has not picked up the scheduled playlist.'),
        app,
      };
    }
    return {
      state: 'idle',
      line: 'Nothing playing',
      detail: dated(
        scheduled
          ? 'The scheduled playlist is outside its time window, so the screen shows its waiting screen.'
          : 'No playlist is scheduled, so the screen shows its waiting screen.',
      ),
      app,
    };
  }
  if (proof.startsWith('tpl:')) {
    const boardId = proof.slice('tpl:'.length).split(':')[0];
    if (expected?.templateId && boardId === expected.templateId) {
      return { state: 'confirmed', line: `Playing ${scheduled}`, detail: dated('The board on the glass is the one you scheduled.'), app };
    }
    return {
      state: 'playing',
      line: 'Playing a board',
      detail: dated(
        scheduled
          ? 'Not the board scheduled right now — the screen re-checks on its own; Resync hurries it.'
          : 'Nothing is scheduled for this screen, yet a board is playing.',
      ),
      app,
    };
  }
  if (proof.startsWith('pl:')) {
    if (renderProofMatches(expected?.renderSignature ?? null, proof)) {
      return { state: 'confirmed', line: `Playing ${scheduled}`, detail: dated('Item for item, what you scheduled.'), app };
    }
    return {
      state: 'playing',
      line: 'Playing a playlist',
      detail: dated(
        scheduled
          ? `Can’t confirm it is ${scheduled} yet — it may be an older version of it. The screen re-checks on its own; Resync hurries it.`
          : 'Nothing is scheduled for this screen, yet a playlist is playing.',
      ),
      app,
    };
  }
  // A dated proof in a shape this dashboard does not know (an older bundle),
  // or none at all. Say exactly that.
  if (confirmedAgo) {
    return {
      state: 'playing',
      line: 'Showing content',
      detail: `The screen confirmed a picture ${confirmedAgo} ago, but this player version does not say what it is showing.`,
      app,
    };
  }
  return { state: 'unknown', line: 'No picture confirmation yet', detail: 'The player has not reported what it is showing.', app };
}

/**
 * §10 delivery, in one sentence (2026-09-24).
 *
 * This replaced a three-step "How far the update got" stepper (Sent →
 * Rendered → Physical display) that tracked only a pending resync command,
 * drew a permanently grey "Physical display · Not instrumented" step, and left
 * its first dot hollow whenever nothing was pending — Greg: "wtf is how far
 * update got, again its not correct and doesnt make sense to an average
 * user". The facts it drew are still here, as prose an operator can read: is
 * an update outstanding, and when did the screen last confirm a picture. The
 * §15 rule stands — no Downloaded milestone is invented, and nothing here
 * claims to have seen the panel.
 */
export interface Delivery {
  state: 'ok' | 'pending' | 'unknown';
  /** One plain sentence. */
  line: string;
}

export function deriveDelivery(screen: OpsScreen, status: StatusDescriptor, now: number): Delivery {
  const pendingMs = msOf(screen.pendingRefreshAt);
  const renderedMs = msOf(screen.lastRenderedAt);
  if (screen.status !== 'ONLINE') {
    return { state: 'unknown', line: 'This screen isn’t answering, so nothing can be confirmed until it comes back.' };
  }
  if (pendingMs != null) {
    return {
      state: 'pending',
      line: `An update was sent ${wordyAge(pendingMs, now) ?? 'a moment'} ago and the screen hasn’t confirmed it yet.`,
    };
  }
  // A screen on an older app build is still showing its content and still
  // confirming pictures; the app updates itself, so that is not a delivery gap.
  const confirmed =
    renderedMs != null &&
    (status.key === 'current' || status.key === 'idle' || status.key === 'paused' || status.key === 'app-updating');
  if (confirmed) {
    return { state: 'ok', line: `Nothing waiting. The screen confirmed its picture ${wordyAge(renderedMs, now) ?? 'just now'} ago.` };
  }
  if (status.key === 'confirming') return { state: 'pending', line: 'Waiting for the screen to confirm its picture.' };
  return { state: 'unknown', line: 'No picture confirmation from this screen.' };
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
    // Acknowledged. Only a fresh picture confirmation completes it (a paused
    // screen still confirms its own picture — the pause is the operator's).
    if (status.key === 'current' || status.key === 'idle' || status.key === 'paused') {
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
  /** The last video's dropped-frame verdict, or null when the player never sent one. */
  video: VideoPlayback | null;
  /** Sort key — lower is worse. */
  rank: number;
}

// ── Video playback quality ─────────────────────────────────────────────

export interface VideoPlaybackSample {
  url?: string | null;
  totalFrames?: number | null;
  droppedFrames?: number | null;
  elapsedMs?: number | null;
  width?: number | null;
  height?: number | null;
  /**
   * Rebuffer pauses in the same stretch — times playback stopped mid-clip for
   * lack of data, and the wall-clock ms it spent stopped. Absent on samples
   * from a player that does not count them ("not counted", not "none").
   */
  stalls?: number | null;
  stalledMs?: number | null;
  at?: string | null;
}

export type VideoPlaybackGrade = 'smooth' | 'hitching' | 'stuttering' | 'short';

export interface VideoPlayback {
  grade: VideoPlaybackGrade;
  /** The file, as the player saw it — its last path segment, decoded. */
  name: string;
  /** "Played smoothly" / "Hitched" / "Stuttered" / "Too short to judge". */
  headline: string;
  /** "12 of 1,830 frames dropped (0.7%) · 1920 × 1080 · 2m ago", then " · paused 4 times to buffer (9 s)" when it did. */
  detail: string;
  droppedPct: number;
  totalFrames: number;
  droppedFrames: number;
  /** Compact age of the sample, e.g. "2m". */
  age?: string;
}

/** Below this many frames a sample says nothing reliable (5 s at 30 fps). */
export const VIDEO_SAMPLE_MIN_FRAMES = 150;
/** Dropped-frame share thresholds. Under 1% is invisible; over 5% is what an operator calls choppy. */
export const VIDEO_HITCHING_PCT = 1;
export const VIDEO_STUTTERING_PCT = 5;
/**
 * Rebuffer thresholds. A pause to buffer is a FREEZE on the glass, which no
 * dropped-frame share can express — a file whose MP4 index sits at the end
 * drops nothing and still stops while its bytes arrive. So pauses grade the
 * sample whatever its dropped-frame share: pauses adding up to a second or
 * more are at least a hitch; three pauses, or five seconds spent waiting,
 * are a stutter.
 */
export const VIDEO_STALL_HITCHING_MS = 1_000;
export const VIDEO_STALL_STUTTERING_COUNT = 3;
export const VIDEO_STALL_STUTTERING_MS = 5_000;

const VIDEO_HEADLINE: Record<VideoPlaybackGrade, string> = {
  smooth: 'Played smoothly on this screen',
  hitching: 'Hitched a little on this screen',
  stuttering: 'Stuttered on this screen',
  short: 'Too short to judge',
};

/** A reported counter as a non-negative int, or null when absent or garbage. */
const sampleCount = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;

/** "9 s", "0.8 s", "125.4 s" — one decimal at most; a blip that rounds to nothing reads "<0.1 s", never "0 s". */
function stallSeconds(ms: number): string {
  const tenths = Math.round(ms / 100);
  if (tenths < 1) return '<0.1 s';
  return `${(tenths / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })} s`;
}

export function videoSampleName(url: string | null | undefined): string {
  const raw = (url ?? '').split('?')[0].split('#')[0];
  const last = raw.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last) || 'video';
  } catch {
    return last || 'video';
  }
}

/**
 * The player's playback sample as a verdict. Pure. `null` when the screen
 * has never reported one. Copy states only what the counters prove — a share
 * of frames dropped and the pauses to buffer, never "the file is bad": the
 * file's own grade lives in the Media Library, and the two together tell
 * file from player.
 */
export function deriveVideoPlayback(screen: OpsScreen, now: number): VideoPlayback | null {
  const s = screen.lastVideoReport;
  if (!s || typeof s !== 'object') return null;
  const total = typeof s.totalFrames === 'number' && Number.isFinite(s.totalFrames) ? Math.max(0, Math.floor(s.totalFrames)) : 0;
  if (total <= 0) return null;
  const dropped = Math.min(
    total,
    typeof s.droppedFrames === 'number' && Number.isFinite(s.droppedFrames) ? Math.max(0, Math.floor(s.droppedFrames)) : 0,
  );
  const droppedPct = Math.round((dropped / total) * 1000) / 10;
  const name = videoSampleName(s.url);
  const atMs = s.at ? new Date(s.at).getTime() : msOf(screen.lastVideoReportAt);
  const age = compactAge(atMs, now);
  const size = s.width && s.height ? `${s.width} × ${s.height}` : null;
  const framesLine = `${dropped.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} frames dropped (${droppedPct}%)`;
  // Rebuffer pauses. Waiting time with no pause behind it is incoherent (the
  // player never sends it) and is ignored, rather than graded with no reason
  // on screen.
  const stalls = sampleCount(s.stalls) ?? 0;
  const stalledMs = stalls > 0 ? sampleCount(s.stalledMs) : null;
  const pausedLine =
    stalls > 0
      ? `paused ${stalls === 1 ? 'once' : `${stalls.toLocaleString('en-US')} times`} to buffer${stalledMs !== null ? ` (${stallSeconds(stalledMs)})` : ''}`
      : null;
  const detail = [framesLine, size, age ? `${age} ago` : null, pausedLine].filter(Boolean).join(' · ');
  let grade: VideoPlaybackGrade;
  if (total < VIDEO_SAMPLE_MIN_FRAMES) grade = 'short';
  else if (droppedPct >= VIDEO_STUTTERING_PCT) grade = 'stuttering';
  else if (droppedPct >= VIDEO_HITCHING_PCT) grade = 'hitching';
  else grade = 'smooth';
  // Pauses grade the sample whatever its dropped-frame share. A pause needs
  // no frame floor to be believed, so it lifts "too short to judge" as well.
  const waitedMs = stalledMs ?? 0;
  if (stalls >= VIDEO_STALL_STUTTERING_COUNT || waitedMs >= VIDEO_STALL_STUTTERING_MS) {
    grade = 'stuttering';
  } else if (stalls >= 1 && waitedMs >= VIDEO_STALL_HITCHING_MS && (grade === 'smooth' || grade === 'short')) {
    grade = 'hitching';
  }
  return { grade, name, headline: VIDEO_HEADLINE[grade], detail, droppedPct, totalFrames: total, droppedFrames: dropped, age };
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
  chips: FilterChip[];
  /** Groups that start expanded: every group with at least one screen (2026-09-14). */
  autoExpanded: Set<string>;
  totals: { screens: number; online: number; attention: number };
}


export const UNGROUPED_ID = '__ungrouped__';

export function buildScreenOps(input: {
  screens: OpsScreen[];
  schedules: OpsSchedule[];
  playlists: OpsPlaylist[];
  deployedSha: string | null;
  /** Deployed client-bundle identity (2026-09-21) — see `DeriveStatusInput`. */
  deployedBundleId?: string | null;
  /** Keeps the selected screen's group open even when it is healthy (§8). */
  selectedScreenId?: string | null;
  now: number;
}): ScreenOps {
  const { screens, schedules, playlists, deployedSha, deployedBundleId, now } = input;

  const playlistById = new Map<string, OpsPlaylist>();
  for (const p of playlists) if (p?.id) playlistById.set(p.id, p);

  const rows: OpsRow[] = screens.map((screen) => {
    const status = deriveScreenStatus({ screen, deployedSha, deployedBundleId, now });
    const expected = deriveExpectedContent(screen, schedules, playlistById, now);
    return {
      screen,
      status,
      expected,
      // Matched against the schedule, so a row can say "Playing <name>".
      reported: deriveReportedContent(screen, deployedSha, now, deployedBundleId, expected),
      video: deriveVideoPlayback(screen, now),
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

  // Default expansion (2026-09-14, twice): first "show the groups like we did
  // in classic, just collapsed by default so it's not too busy" — then, once
  // every group became its own card, "expand the ones that have screens in
  // them and keep the others closed by default". So every group with a screen
  // starts open; an empty group is just its bar and has nothing to open. The
  // operator can still collapse any card (manual state wins in the view).
  const autoExpanded = new Set<string>();
  for (const g of groups) if (g.rows.length > 0) autoExpanded.add(g.id);
  if (input.selectedScreenId) {
    const sel = rows.find((r) => r.screen.id === input.selectedScreenId);
    if (sel) autoExpanded.add(sel.screen.screenGroupId || UNGROUPED_ID);
  }

  // §6 assurance strip: REMOVED 2026-09-14 (Greg: "the top items are all
  // unactionable"). The chips below are the only fleet-level counts on the page;
  // emergency readiness stays on the Overview pill, which drills into settings.
  const total = screens.length;
  const online = screens.filter((s) => s.status === 'ONLINE').length;
  const attention = rows.filter((r) => r.status.needsAttention).length;
  const behind = rows.filter((r) => r.status.key === 'content-behind').length;

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
      // Deliberately NOT app-updating: that screen is not behind on content.
      // It is reachable through "All", and it is not an exception.
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


// ── Frame-lock status (2026-09-14, ported from the classic row chip before
// classic was retired). Only meaningful for an ONLINE screen that is actually
// frame-locked; null otherwise. 2026-09-16: that is `syncActive` — derived by
// the server from the playlist's own "keep screens in sync" — not the group's
// retired syncMode. Mirrors the player's own report:
//   locked   — clock agreement ±ms (worst of flip error / clock uncertainty),
//              flagged jittery when the network is what's fighting it;
//   diverged — this screen's content signature differs from the group's
//              modal signature (a per-screen schedule likely overrides);
//   locking  — sync is on but no fresh (<2 min) locked report yet.
export type SyncStatus =
  | { kind: 'locked'; ms: number; jittery: boolean; detail: string }
  | { kind: 'diverged' }
  | { kind: 'locking' };

export function syncStatusFor(screen: OpsScreen, fleet: OpsScreen[], nowMs: number): SyncStatus | null {
  if (screen.syncActive !== true || screen.status !== 'ONLINE') return null;
  const r = (screen as any).lastSyncReport as Record<string, unknown> | null | undefined;
  const atRaw = (screen as any).lastSyncReportAt as string | null | undefined;
  const at = atRaw ? new Date(atRaw).getTime() : 0;
  const fresh = !!at && nowMs - at < 120_000;
  if (fresh && r) {
    const sigs = fleet
      .filter((s) => s.screenGroupId === screen.screenGroupId)
      .map((s) => (s as any)?.lastSyncReport?.contentSig)
      .filter(Boolean) as string[];
    const counts = new Map<string, number>();
    for (const sg of sigs) counts.set(sg, (counts.get(sg) ?? 0) + 1);
    let modalSig: string | null = null; let best = 0;
    for (const [sg, c] of counts) if (c > best) { best = c; modalSig = sg; }
    if (r.contentSig && modalSig && sigs.length > 1 && r.contentSig !== modalSig) return { kind: 'diverged' };
    if (r.locked) {
      const err = Number(r.errMs) || 0, unc = Number(r.clockUncertaintyMs) || 0, rtt = Number(r.rttMs) || 0;
      const ms = Math.max(1, Math.round(Math.max(err, unc)));
      const jittery = rtt > 150 || unc > 25;
      return { kind: 'locked', ms, jittery, detail: `flip ${r.errMs ?? '—'}ms · clock ±${r.clockUncertaintyMs ?? '—'}ms · rtt ${r.rttMs ?? '—'}ms` };
    }
  }
  return { kind: 'locking' };
}
