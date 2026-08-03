/**
 * INJ-003 (2026-08-02) — the live-bound content gate.
 *
 * ─── The hole this closes ────────────────────────────────────────────
 *
 * `schedules.controller.create()` states the product rule plainly:
 *
 *     "CONTRIBUTOR (Editor) schedules are ALWAYS staged as drafts — they
 *      cannot push content live directly."
 *
 * That gate only ever intercepted the creation of a NEW schedule. It said
 * nothing about EDITING content a schedule is ALREADY pointing at. Both
 * `PUT /templates/:id/zones` and `PUT /playlists/:id/items` allow
 * CONTRIBUTOR and checked only tenant ownership (+ `isSystem` on
 * templates) — so an Editor could take a board that was already on a wall,
 * rewrite it, and have the change reach every screen at the next manifest
 * poll with zero review. Same "push content live directly", through the
 * back door, and it is what made the content-injection chain reachable
 * without an admin ever clicking anything.
 *
 * ─── What "live-bound" means ─────────────────────────────────────────
 *
 * Traced against `packages/database/prisma/schema.prisma` and the manifest
 * resolver's own query (`screens.controller.ts` ~line 3186), content
 * reaches a screen through exactly one relation chain:
 *
 *     Schedule.isActive
 *       └─ Schedule.playlistId ──▶ Playlist
 *                                    └─ Playlist.templateId ──▶ Template
 *
 * The resolver additionally filters `startTime <= now` and
 * `endTime >= now OR endTime IS NULL`. We deliberately DROP the
 * `startTime <= now` half (a schedule that goes live at 3pm will publish
 * this content with no further review, so an edit to it is just as
 * un-reviewed) but KEEP the end-of-window half: a schedule whose window
 * has already ENDED can never reach a screen again, and freezing every
 * template a contributor ever bound to an expired campaign would make
 * last season's boards permanently un-editable by their own author. See
 * the residual-risk note at the bottom of this file.
 *
 * ─── Why this REJECTS instead of auto-filing a Submission ────────────
 *
 * The obvious "correct" move is to route the edit into the existing
 * submit-for-review queue (`submissions.controller.ts`) the way
 * `schedules.controller.routeScheduleThroughReview()` does. It was
 * evaluated in full and does not work here, for reasons that are about
 * the data model, not effort:
 *
 *   1. `Submission` (schema.prisma:1482) carries exactly three content
 *      dimensions — `assetIds`, `playlistIds`, `scheduleIds`. There is no
 *      template dimension and, more fundamentally, no payload column: the
 *      queue references content that ALREADY EXISTS in a not-yet-published
 *      state. It publishes by flipping `Asset.status` and
 *      `Schedule.isActive` (submissions.controller.ts:284-324). It has
 *      nowhere to PARK a proposed zone array, because a zone save is a
 *      destructive in-place delete-all-and-recreate.
 *
 *   2. The copy-on-write variant (clone the template + its playlist, stage
 *      an inactive Schedule, bundle THAT into a Submission, let approval
 *      flip it live) does fit the queue's shape — but it silently switches
 *      the id the operator's builder is editing. The builder would keep
 *      PUTting to the original id and keep re-reading the original,
 *      un-edited row, so every reload would look like "my changes
 *      vanished" — the exact silent-data-loss UX class this codebase has
 *      been burned by. Making it correct requires the client to follow the
 *      server's identity switch, i.e. changes in `apps/web`, which is
 *      outside this change's blast radius.
 *
 *   3. Even if 2 were solved, the reviewer could not actually REVIEW it:
 *      `GET /submissions/:id` embeds assets / playlists / schedules, and
 *      the review screen renders those. A proposed template layout would
 *      be approved blind. A review queue that cannot show the reviewer
 *      what they are approving is worse than an honest block.
 *
 * The correct full fix is a follow-up with a real schema dimension
 * (`Submission.templateIds` + a pending-payload pointer — `TemplateVersion`
 * already stores exactly the right `zones`/`meta` JSON shape) plus a
 * reviewer diff view. Until that exists, this gate is the honest
 * enforcement: the Editor is told precisely what is blocking them and what
 * to do instead, and no un-reviewed byte reaches a screen.
 *
 * ─── Residual risk (documented, accepted) ────────────────────────────
 *
 * A schedule whose window has expired is treated as not-live, so an Editor
 * may edit content bound only to expired schedules. If an admin later
 * EXTENDS that schedule's window, they re-publish content whose edits were
 * never reviewed. That is an admin publish decision (the admin IS the
 * approver) and every such edit is audit-logged, so it is a
 * defence-in-depth gap behind a hard precondition, not an open door.
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { AppRole } from '@cms/database';

/** The three roles that ARE the approvers — they bypass the gate. */
const APPROVER_ROLES: ReadonlySet<string> = new Set<string>([
  AppRole.SUPER_ADMIN,
  AppRole.DISTRICT_ADMIN,
  AppRole.SCHOOL_ADMIN,
]);

/**
 * True when this actor must NOT be able to change already-live content.
 *
 * Deliberately fail-CLOSED: anything that is not one of the three approver
 * roles is gated, rather than testing `role === CONTRIBUTOR`. If a new
 * non-admin role is ever added to a route's `@RequireRoles`, it inherits
 * the restriction instead of silently inheriting the hole. This also
 * covers the machine identity (`kind: 'api-key'`, `jwt-auth.guard.ts:46`),
 * whose role comes from the key's own grant.
 */
export function actorNeedsApprovalToEditLiveContent(user: any): boolean {
  return !APPROVER_ROLES.has(String(user?.role ?? ''));
}

/** What is holding this content live, for a human-readable 403. */
export interface LiveBinding {
  /** Why it counts as live: a published schedule, or emergency content. */
  reason: 'schedule' | 'emergency';
  /** The pinning schedule — null when the binding is an emergency one. */
  scheduleId: string | null;
  /** Screen or group name when we can resolve one — for the error copy. */
  target: string | null;
}

/**
 * Schedules that can still put content on a screen: published, and either
 * open-ended or not yet past their end. Mirrors the manifest resolver's
 * `isActive` + end-of-window filter (screens.controller.ts:3186-3195).
 */
function liveScheduleWindow(now: Date) {
  return {
    isActive: true,
    OR: [{ endTime: null }, { endTime: { gte: now } }],
  };
}

function shapeBinding(row: any): LiveBinding | null {
  if (!row) return null;
  return {
    reason: 'schedule',
    scheduleId: row.id,
    target: row.screen?.name ?? row.screenGroup?.name ?? null,
  };
}

/**
 * EMERGENCY BINDING — the second way content reaches a screen, and the one
 * a Schedule lookup can never see.
 *
 * Panic content is bound by ID on the tenant row
 * (`Tenant.panicLockdownPlaylistId` / `panicWeatherPlaylistId` /
 * `panicEvacuatePlaylistId` / … / `emergencyPlaylistId`, plus the portrait
 * twins — schema.prisma:35-59) and by `Screen.emergency*PlaylistId`
 * (schema.prisma:859-861). NONE of those create a `Schedule` row, so a
 * schedule-only gate leaves the single most load-bearing content in the
 * product — what every screen shows during a real lockdown — writable by a
 * non-approver.
 *
 * Rather than enumerate ~20 nullable tenant/screen columns (a list that
 * silently rots the moment a new panic type is added), key off the flag the
 * schema already defines for exactly this: `Playlist.isProtected` — "owned
 * by the system (e.g. emergency content bound to
 * Tenant.panicLockdownPlaylistId)… managed only through that surface"
 * (schema.prisma:1058-1065). It is set by the panic-content endpoints when
 * they create the playlist, so it is true for precisely the rows that need
 * this protection.
 *
 * Note this is NOT window-scoped: emergency content is "live" the instant a
 * panic button is pressed, so it is always treated as live.
 */
const EMERGENCY_BINDING: LiveBinding = { reason: 'emergency', scheduleId: null, target: null };

const BINDING_SELECT = {
  id: true,
  screen: { select: { name: true } },
  screenGroup: { select: { name: true } },
};

/**
 * What is holding this PLAYLIST live: emergency ownership first (it can
 * never be reviewed away), then an active schedule.
 *
 * `isProtected` is passed in by the caller because the write paths have
 * already loaded the playlist row — no extra query.
 */
export async function findLivePlaylistBinding(
  prisma: any,
  tenantId: string,
  playlistId: string,
  opts: { isProtected?: boolean; now?: Date } = {},
): Promise<LiveBinding | null> {
  if (opts.isProtected) return EMERGENCY_BINDING;
  const row = await prisma.client.schedule.findFirst({
    where: { tenantId, playlistId, ...liveScheduleWindow(opts.now ?? new Date()) },
    select: BINDING_SELECT,
  });
  return shapeBinding(row);
}

/**
 * The active schedule pinning this TEMPLATE to a screen, if any — resolved
 * through the playlist that carries `templateId` (the only path a Template
 * has to a screen; see the chain in this file's header).
 */
export async function findLiveTemplateBinding(
  prisma: any,
  tenantId: string,
  templateId: string,
  now: Date = new Date(),
): Promise<LiveBinding | null> {
  // Emergency first: a template rendering the lockdown board is live the
  // moment someone presses panic, schedule or no schedule.
  const emergencyPlaylist = await prisma.client.playlist.findFirst({
    where: { tenantId, templateId, isProtected: true },
    select: { id: true },
  });
  if (emergencyPlaylist) return EMERGENCY_BINDING;

  const row = await prisma.client.schedule.findFirst({
    where: {
      tenantId,
      playlist: { is: { templateId } },
      ...liveScheduleWindow(now),
    },
    select: BINDING_SELECT,
  });
  return shapeBinding(row);
}

/**
 * The 403. `code: 'REQUIRES_APPROVAL'` is the machine-readable contract;
 * the message is what the operator actually reads in the save toast, so it
 * names the blocking screen when we know it and states the unblocking move
 * (Duplicate — a route a CONTRIBUTOR already has:
 * `POST /templates/:id/duplicate`).
 */
export function requiresApprovalException(
  kind: 'template' | 'playlist',
  binding: LiveBinding,
): HttpException {
  const message =
    binding.reason === 'emergency'
      ? `This ${kind} holds emergency (panic) content, so only an admin can change it. ` +
        `Manage it from Settings → Panic Button Integrations.`
      : `This ${kind} is live${binding.target ? ` on “${binding.target}”` : ' on screens'} right now, ` +
        `so an Editor cannot change it directly. Duplicate it, edit the copy, and send that for review — ` +
        `or ask an admin to make the change.`;
  return new HttpException(
    {
      code: 'REQUIRES_APPROVAL',
      message,
      kind,
      reason: binding.reason,
      scheduleId: binding.scheduleId,
      target: binding.target,
    },
    HttpStatus.FORBIDDEN,
  );
}

/**
 * Forensic trail for a blocked publish attempt (Standard Audit Surface
 * §16 — a privileged action that was DENIED is exactly the row a district
 * security review asks for). Best-effort: a logging failure must never
 * turn a clean 403 into a 500.
 */
export async function auditBlockedLiveEdit(
  prisma: any,
  req: any,
  kind: 'template' | 'playlist',
  targetId: string,
  binding: LiveBinding,
): Promise<void> {
  try {
    await prisma.client.auditLog.create({
      data: {
        tenantId: req?.user?.tenantId,
        userId: req?.user?.id ?? req?.user?.userId ?? null,
        action: 'CONTENT_EDIT_BLOCKED_REQUIRES_APPROVAL',
        targetType: kind === 'template' ? 'Template' : 'Playlist',
        targetId,
        details: JSON.stringify({
          role: req?.user?.role ?? null,
          reason: binding.reason,
          scheduleId: binding.scheduleId,
          target: binding.target,
        }),
      },
    });
  } catch {
    /* best-effort — never mask the 403 */
  }
}
