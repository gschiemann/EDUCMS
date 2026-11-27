/**
 * Which emergency SURFACE the player shows (2026-10-23, launch QA B3).
 *
 * THE BUG THIS CLOSES. The native-to-overlay hand-off (dbe1a48d, 2026-10-21)
 * swaps the WHOLE player for a protective red "transition" surface whenever
 * ANY emergency state is set — the display hold, a manifest override, a
 * pushed message, a poll-only message. That is right for a lockdown-type
 * alert: content must leave the glass and nothing regular may mount in the
 * gap the removed native video left. It was wrong for a routine INFO / WARN
 * TEXT_BROADCAST: the product has always drawn those as a BANNER on top of
 * the running content (`EmergencyOverlay.isBanner`), yet the transition took
 * the content down and showed a blank red screen under an orange banner.
 *
 * THE RULE
 *   takeover — content leaves the glass; the red transition surface hosts
 *              the alert (or the protective "EMERGENCY" pending text until the
 *              alert's identity is known):
 *                • a manifest override (lockdown / evacuate / weather / …),
 *                • a pushed or poll-only message that renders FULL-SCREEN
 *                  (SOS, MEDIA_ALERT, CRITICAL text),
 *                • a pending signed OVERRIDE awaiting its manifest confirm,
 *                • the display hold raised with NO identified reason (a WS
 *                  OVERRIDE raised it eagerly, or the page just reloaded under
 *                  a persisted hold) — protective, fail-safe toward alerting.
 *   overlay  — content keeps playing; the banner-style message is drawn over
 *              it (INFO / WARN TEXT_BROADCAST, pushed or polled). The display
 *              hold may be raised for it too — a WARN banner still refuses
 *              blanking — but it is not a reason to take content down.
 *   content  — nothing emergency is on, or the emergency PLAYLIST itself is
 *              the content (it renders through the normal branch).
 *
 * Never weakens a real takeover: every input that took the glass before
 * still does, except a banner whose ONLY companion is the hold it raised
 * itself. PURE — unit-tested per shape in `emergencySurface.test.ts`.
 */

/**
 * `hold` (2026-10-26): the display hold is engaged — the page observed it on
 * the APK at boot, or raised it itself — and the page cannot yet say WHICH
 * alert it is for (no manifest alert, no pushed message, no pending signed
 * OVERRIDE). Content must not mount under an engaged hold (player rule 11: a
 * page that reloads under a persisted hold used to boot onto its cached
 * NORMAL manifest), but the page also cannot claim an emergency it has no
 * evidence for (rule 10) — least of all a RED one during a drill. So: a
 * black protective surface, no words, until the live manifest decides.
 */
export type EmergencySurface = 'takeover' | 'overlay' | 'content' | 'hold';

export interface SurfaceMessage {
  type: string;
  severity: string;
}

/** The overlay's own rule: an INFO / WARN text broadcast is a top banner. */
export function isBannerEmergencyMessage(m: SurfaceMessage | null | undefined): boolean {
  return !!m && m.type === 'TEXT_BROADCAST' && m.severity !== 'CRITICAL';
}

export interface EmergencySurfaceInput {
  /** The manifest's own alert (tenant / per-screen override). */
  activeEmergency: boolean;
  /** The WS / SSE pushed message currently held by the page. */
  pushed: SurfaceMessage | null | undefined;
  /** A poll-only message is displayed by the overlay … */
  polledActive: boolean;
  /** … and it is a full-screen one (SOS / media / CRITICAL), not a banner. */
  polledTakeover: boolean;
  /** `displayEmergencyHoldRaised()` — the eager hold (also persisted natively). */
  renderHold: boolean;
  /** Known banner awaiting the same server-confirmed hold release. */
  playbackHeld?: boolean;
  /** The APK refused banner posture (its native video could not be proven
   * correct under a banner): a banner message is shown as a full takeover. */
  bannerRefused?: boolean;
  /** A signed OVERRIDE is still being confirmed by the manifest. */
  pendingOverrideConfirm: boolean;
  /** The current playlist IS the emergency content. */
  playlistIsEmergency: boolean;
}

export function decideEmergencySurface(i: EmergencySurfaceInput): EmergencySurface {
  if (i.playlistIsEmergency) return 'content';
  if (i.activeEmergency || i.pendingOverrideConfirm) return 'takeover';
  if (i.pushed && !isBannerEmergencyMessage(i.pushed)) return 'takeover';
  if (i.polledActive && i.polledTakeover) return 'takeover';
  const bannerShown = isBannerEmergencyMessage(i.pushed) || (i.polledActive && !i.polledTakeover);
  if (bannerShown) return i.bannerRefused ? 'takeover' : 'overlay';
  // Hold engaged with nothing identified yet: protective, but unattributed —
  // black, never a red claim the page cannot back (see `hold` above).
  if (i.renderHold && i.playbackHeld !== false) return 'hold';
  return 'content';
}

/**
 * 2026-11-23 — A TENANT ALERT OUTRANKS A BANNER (the owner's demo: "I pushed a
 * broadcast, then pushed an emergency drill but it left the banner up …
 * emergency alert overrides everything").
 *
 * A manifest override (lockdown / weather / evacuate / hold / secure /
 * medical — live or drill), a signed OVERRIDE still being confirmed, or the
 * staged emergency board on the glass each take the WHOLE screen. An INFO /
 * WARN broadcast banner is still HELD (the pushed set, the 12 s reconcile and
 * the overlay poll keep it exactly as before — nothing here mutates them) but
 * it is not DRAWN: it used to portal over the takeover at z-index 9999, one
 * layer above the alert, scale the staged board down beneath it, and own the
 * paint receipt. At the all-clear it comes back by itself, because nothing
 * dropped it.
 *
 * Only the banner class is affected. A full-screen SOS / MEDIA_ALERT /
 * CRITICAL text keeps today's draw over a tenant alert — which of those two
 * outranks the other is the owner's call, and a drill must never hide a real
 * SOS. PURE — `emergencySurface.test.ts`.
 */
export interface TenantAlertInput {
  /** The manifest's own alert (tenant / per-screen override), drill or live. */
  activeEmergency: boolean;
  /** A signed OVERRIDE is still being confirmed by the manifest. */
  pendingOverrideConfirm: boolean;
  /** The current playlist IS the emergency content (the staged board). */
  playlistIsEmergency: boolean;
}

export function tenantAlertOnGlass(i: TenantAlertInput): boolean {
  return i.activeEmergency || i.pendingOverrideConfirm || i.playlistIsEmergency;
}

/**
 * The pushed message actually DRAWN, given the tenant alert: a banner-class
 * message under a tenant alert is held but not drawn (null); anything else is
 * drawn as before. The paint receipt's expected identity follows this.
 */
export function drawnPushedMessage<T extends SurfaceMessage>(pushed: T | null | undefined, tenantAlert: boolean): T | null {
  if (!pushed) return null;
  return tenantAlert && isBannerEmergencyMessage(pushed) ? null : pushed;
}

/**
 * The protective pending surface's words ("EMERGENCY" / the drill mark, while
 * a signed OVERRIDE awaits its manifest) are hidden by a FULL-SCREEN pushed
 * message, which paints its own alert over them. Under a tenant alert a banner
 * never hides them: it is not drawn there. With NO tenant alert a banner-class
 * message still hides them, as before 2026-11-23: the takeover surface is then
 * only the full-screen form of an INFO / WARN broadcast (the app refused banner
 * posture), and the words would claim an emergency that is not there.
 */
export function pendingTextHiddenBy(pushed: SurfaceMessage | null | undefined, tenantAlert: boolean): boolean {
  if (!pushed) return false;
  if (!isBannerEmergencyMessage(pushed)) return true;
  return !tenantAlert;
}
