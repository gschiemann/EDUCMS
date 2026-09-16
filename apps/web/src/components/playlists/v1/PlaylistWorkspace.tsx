"use client";

/**
 * PlaylistWorkspace — the URL-addressable playlist detail surface
 * (handoff §3 level 2, §12–§16).
 *
 * The old workspace lived in the list page's `selectedId` state: not
 * bookmarkable, not shareable, lost on refresh (§6.8). This one is a real
 * route — /{schoolId}/playlists/{playlistId} — with `?tab=` for the section, so
 * refresh, browser Back, copy-link and direct navigation all work.
 *
 * ── HOW CONTENT AND PUBLISHING ARE BUILT, AND WHY ────────────────────
 *
 * They are the CLASSIC EDITOR, embedded. Not a re-implementation.
 *
 * The handoff's §5 is a list of behaviours the redesign "must retain": drag
 * ordering, keyboard reorder, per-item duration, per-item day/time windows,
 * per-item transition, per-video audio, schedule-level mute override, screen
 * and group targeting, replace/append modes, save-as-inactive, contributor
 * submit-for-review, blast radius, unsaved-change protection. Rebuilding that
 * list in a second component is how one of them quietly goes missing. So the
 * workspace mounts the editor that already runs in production and supplies
 * only what it never had: a durable route, a header that separates scheduling
 * intent from delivery truth, and the two tabs that did not exist at all.
 *
 * The classic detail view already split content from scheduling as internal
 * `editor` / `schedules` tabs — exactly the Content / Publishing split asked
 * for here — so `embedSection` selects between them and its own chrome hides.
 *
 * ONE INSTANCE, ALWAYS MOUNTED. Switching to Delivery or Activity hides the
 * editor rather than unmounting it, so a half-finished edit survives a look at
 * the Delivery tab — and its unsaved-change protection stays armed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Loader2, Monitor, PauseCircle, PlayCircle, Plus, Power, Settings, Trash2 } from 'lucide-react';
import {
  deriveTargetsFromScreens, describeReach, exactStamp, timeAgo,
  type DeliveryPayload, type DeliverySummary, type OpsScreenRef, type PlaylistSummaryRow,
} from './playlistOps';

const INK = 'text-[#111A3A]';
const INK_2 = 'text-[#536181]';
const INK_3 = 'text-[#7B87A4]';
const HAIRLINE = 'border-[#E4E8F1]';
const SURFACE = `bg-white border ${HAIRLINE}`;

/**
 * Three sections, named for what an operator is doing (Greg, 2026-09-16: "i
 * dont think we need 4 buttons here… keep it simple and easy for customer to
 * use"). Publishing became SCHEDULE — the thing you go there to change — and
 * Delivery became SCREENS, which now answers both "where does this play" and
 * "did it arrive" in one place. Activity is gone.
 */
export const WORKSPACE_TABS = ['content', 'screens', 'schedule'] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export function isWorkspaceTab(v: unknown): v is WorkspaceTab {
  return typeof v === 'string' && (WORKSPACE_TABS as readonly string[]).includes(v);
}

/**
 * What the sections used to be called, so a link someone saved — or the
 * library's own menu items — lands where that section went instead of falling
 * back to Content and looking like the page forgot.
 */
const RENAMED_TABS: Record<string, WorkspaceTab> = {
  publishing: 'schedule',
  delivery: 'screens',
  activity: 'screens',
};

/** The section a `?tab=` value addresses, old name or new. Null if neither. */
export function resolveWorkspaceTab(v: unknown): WorkspaceTab | null {
  if (isWorkspaceTab(v)) return v;
  return typeof v === 'string' && RENAMED_TABS[v] ? RENAMED_TABS[v] : null;
}

const TAB_LABELS: Record<WorkspaceTab, string> = {
  content: 'Content',
  screens: 'Screens',
  schedule: 'Schedule',
};

export interface PlaylistWorkspaceProps {
  row: PlaylistSummaryRow | null;
  loading: boolean;
  notFound: boolean;
  tab: WorkspaceTab;
  onTab: (t: WorkspaceTab) => void;
  onBack: () => void;
  /** Renders the embedded classic editor for Content / Publishing. */
  editor: React.ReactNode;
  /** The classic page's own offline-export control, hoisted into the header. */
  exportControl?: React.ReactNode;
  ruleCount: number;
  targetScreens: OpsScreenRef[];
  delivery: { payload: DeliveryPayload | null | undefined; loading: boolean; derived: boolean; onRetry: () => void };
  /** Row-level rollup shown under the header when degraded (§12). */
  deliverySummary: DeliverySummary;
  onPauseEverywhere: () => void;
  onResumeEverywhere: () => void;
  pausePending: boolean;
  onRefreshScreen: (screenId: string) => void;
  refreshingScreenId: string | null;
  onOpenScreen: (screenId: string) => void;
  isViewer: boolean;
  /**
   * "Keep screens in sync" (2026-09-16). The setting used to live on the
   * screen group; the operator's objection was that a group holds several
   * different playlists, so the group could not say anything coherent about
   * any of them. It belongs to the content you want mirrored.
   */
  onToggleSync: (next: boolean) => void;
  syncPending: boolean;
  /**
   * "Add screens" (Greg, 2026-09-16), rather than dropping the operator on
   * another tab to go find it themselves.
   *
   * ⚠️ This docblock used to say it opens the publish sheet. It does not, and
   * has not since the dialogs landed: the route wires it to AddScreensDialog
   * (the wizard's own screen picker). Corrected 2026-09-16 — a comment about
   * where something is mounted is hearsay; the mount site is the authority,
   * and this one sent me looking in the wrong file while chasing a live bug.
   */
  onAddScreens: () => void;
  /**
   * One row per screen this playlist plays on (Greg, 2026-09-16: "the screens
   * menu should look like the old schedule menu...a list of every screen and
   * the little power on/off button to disable that screen...not this ugly text
   * mess"). Resolved in the route, which is the only place that holds the
   * rules AND the groups.
   */
  screenRows: Array<{
    id: string;
    name: string;
    online: boolean;
    /** This screen's OWN rule — the only thing a per-screen switch may touch. */
    scheduleId: string | null;
    /** Set when the screen is reached only through a group rule. */
    viaGroupName: string | null;
    active: boolean;
  }>;
  onToggleScreen: (scheduleId: string) => void;
  /**
   * Take one screen off this playlist (Greg, 2026-09-16: "how do i delete
   * screens out of the playlist?" — there was no way). Deletes that screen's
   * own rule; the route confirms first.
   */
  onRemoveScreen: (scheduleId: string, screenName: string) => void;
}

export function PlaylistWorkspace(props: PlaylistWorkspaceProps) {
  const { row, tab } = props;
  // Delivery evidence per screen, keyed for the Screens tab's cards. The list
  // is a SCREEN list now, but each row still carries what that screen reports
  // about itself — dropping that was how the G43 "not received" signal briefly
  // disappeared from the one tab that exists to show it.
  const evidenceById = new Map(
    deriveTargetsFromScreens(props.targetScreens).map((t) => [t.screenId, t]),
  );
  const screenById = new Map(props.targetScreens.map((s) => [s.id, s]));
  /**
   * The gear goes to the Screens page focused on that screen
   * (`?screen=<id>`), where the real settings drawer lives — rather than
   * mounting ScreenDetailDrawer here. That drawer is built from
   * ScreenOperationsV3's own row model, APK push state and sync state, none of
   * which exists in this workspace; rebuilding it here is how the two would
   * drift apart and stop being the same settings.
   */
  // The editor is what Content and Schedule both show — its item list and its
  // schedule rows. Screens is the only section it is not behind.
  const editorVisible = tab === 'content' || tab === 'schedule';

  if (props.notFound) {
    return (
      <div className={`rounded-[14px] px-6 py-14 text-center ${SURFACE}`}>
        <h1 className={`text-[16px] font-bold ${INK}`}>That playlist isn’t here</h1>
        <p className={`text-[13px] ${INK_2} mt-1`}>
          It may have been removed, or it belongs to another location.
        </p>
        <button
          type="button"
          onClick={props.onBack}
          className="mt-4 h-10 px-4 rounded-[10px] text-[13px] font-bold text-white"
          style={{ background: 'var(--brand-primary, #3515E8)' }}
        >
          Back to Playlists
        </button>
      </div>
    );
  }

  if (props.loading && !row) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-8 w-64 rounded-lg bg-slate-100 animate-pulse" />
        <div className="h-11 w-full max-w-md rounded-xl bg-slate-100 animate-pulse" />
        <div className="h-[420px] w-full rounded-2xl bg-slate-100 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── §12 header. No global on/off switch lives here. ── */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <button
            type="button"
            onClick={props.onBack}
            aria-label="Back to Playlists"
            className={`shrink-0 mt-1 p-2 rounded-[10px] ${INK_3} hover:bg-slate-100 hover:${INK_2} transition-colors`}
          >
            <ArrowLeft className="w-5 h-5" aria-hidden />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className={`text-[22px] font-extrabold tracking-tight ${INK} truncate`}>
                {row?.name ?? 'Playlist'}
              </h1>
              {row && (
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                  {row.kind === 'template' ? 'Template' : 'Media'}
                </span>
              )}
              {row && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-[#F0ECFF] border border-[#CFC4FF]"
                  style={{ color: 'var(--brand-primary, #3515E8)' }}
                  data-testid="workspace-status"
                >
                  {row.statusLabel}
                </span>
              )}
            </div>
            {row && (
              <p className={`text-[13px] ${INK_2} mt-0.5`}>
                {describeReach(row.reach)} · {row.scheduleSummary} ·{' '}
                <span title={exactStamp(row.updatedAt)}>updated {timeAgo(row.updatedAt)}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {props.exportControl}
          {/* §19.2 — labelled, never an unlabelled switch, and only offered
              when there is a publishing rule to act on.

              Greg, 2026-09-16: "there should be the same button that says
              pause only if its not playing it says play right...you just
              removed the button from non active playlists". It used to render
              ONLY while playing, so a paused playlist had no control at all
              and could not be started again from here. One button, both
              directions. */}
          {!props.isViewer && props.ruleCount > 0 && (
            row?.scheduleState === 'PAUSED' ? (
              <button
                type="button"
                onClick={props.onResumeEverywhere}
                disabled={props.pausePending}
                /* Greg, 2026-09-16: "i dont like the pause everywhere button
                   having its own square shape, make it fit in with the same
                   rounded pill and color scheme and size as the others". Same
                   pill, border and height as Download beside it — the state is
                   carried by the icon and the word, not by a shape and a colour
                   nothing else on the row uses. */
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full border border-slate-200 bg-white text-[13px] font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                <PlayCircle className="w-4 h-4" aria-hidden />
                {props.pausePending ? 'Starting…' : 'Play everywhere'}
              </button>
            ) : (
              <button
                type="button"
                onClick={props.onPauseEverywhere}
                disabled={props.pausePending}
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full border border-slate-200 bg-white text-[13px] font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                <PauseCircle className="w-4 h-4" aria-hidden />
                {props.pausePending ? 'Pausing…' : 'Pause everywhere'}
              </button>
            )
          )}
        </div>
      </div>

      {/* ── §12 exception summary — only when delivery is degraded, and only
             on the tabs that are NOT already showing it. The Screens tab
             leads with the same block; printing it twice on one screen reads
             as two problems. ── */}
      {row && tab !== 'screens'
        && props.deliverySummary.tone !== 'ok' && props.deliverySummary.tone !== 'muted' && (
        <div
          className="flex items-start gap-3 rounded-[12px] border border-amber-200 bg-amber-50/70 px-4 py-3"
          role="status"
          data-testid="workspace-exception"
        >
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-amber-900">{props.deliverySummary.label}</p>
            {props.deliverySummary.detail && (
              <p className="text-[13px] text-amber-800/90 mt-0.5">{props.deliverySummary.detail}</p>
            )}
          </div>
          {/* Unconditional: the block above already only renders off the
              Screens tab, so this action always has somewhere to go. */}
          <button
            type="button"
            onClick={() => props.onTab('screens')}
            className="shrink-0 text-[13px] font-bold hover:underline"
            style={{ color: 'var(--brand-primary, #3515E8)' }}
          >
            Review screens
          </button>
        </div>
      )}

      {/* ── Tabs (§3 level 2) ── */}
      <div role="tablist" aria-label="Playlist sections" className="flex items-center gap-1 overflow-x-auto">
        {WORKSPACE_TABS.map((t) => {
          const on = t === tab;
          return (
            <button
              key={t}
              role="tab"
              aria-selected={on}
              onClick={() => props.onTab(t)}
              className={`shrink-0 h-10 px-4 rounded-[10px] text-[13px] font-semibold transition-colors ${
                on ? `bg-white border ${HAIRLINE} shadow-sm ${INK}` : `${INK_2} hover:bg-white/70`
              }`}
              style={on ? { borderColor: 'var(--brand-soft, #CFC4FF)' } : undefined}
            >
              {TAB_LABELS[t]}
            </button>
          );
        })}
      </div>

      {/* ── Panels ── */}
      {/* Content + Schedule: the embedded editor. Hidden, never unmounted, so
          an unsaved edit survives a trip to Screens. */}
      <div className={editorVisible ? '' : 'hidden'} data-testid="workspace-editor">
        {props.editor}
      </div>

      {tab === 'screens' && row && (
        /* Greg, 2026-09-16: "give this same white background to the screens
           menu as well". The Schedule tab sits on a white panel (the embedded
           editor's own card) while Screens floated straight on the page, so the
           two tabs read as different surfaces. Same panel, same radius. */
        <div className="rounded-[20px] bg-white shadow-sm p-5 sm:p-6 space-y-4">
        {/* ── Keep screens in sync (2026-09-16) ──────────────────────────
            Moved here from the screen group's ⋮ menu. Greg: "if i have
            different playlists assigned to screens in the same group it doesnt
            make sense saying to keep them in sync...the feature works amazing
            so we just need to move the setting into playlist and not screen
            groups". It sits on Screens because that is the tab where "how does
            this behave across screens" is the question being asked. */}
        <div className={`rounded-[14px] px-4 py-3.5 flex items-start justify-between gap-4 ${SURFACE}`}>
          <div className="min-w-0">
            <h2 className={`text-[13px] font-bold ${INK}`}>Keep screens in sync</h2>
            <p className={`text-[12.5px] ${INK_2} mt-0.5 leading-snug`}>
              {row.syncPlayback
                ? 'Every screen playing this playlist changes slides at the same instant. Screens pick this up on their next check-in.'
                : 'Turn this on for a video wall or side-by-side boards, and every screen playing this playlist will change slides at the same instant.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={row.syncPlayback}
            aria-label="Keep screens in sync"
            disabled={props.isViewer || props.syncPending}
            onClick={() => props.onToggleSync(!row.syncPlayback)}
            className={`shrink-0 relative h-7 w-12 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              row.syncPlayback ? '' : 'bg-[#D7DCE8]'
            }`}
            style={row.syncPlayback ? { background: 'var(--brand-primary, #3515E8)' } : undefined}
          >
            <span
              aria-hidden
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] ${
                row.syncPlayback ? 'left-6' : 'left-1'
              }`}
            />
          </button>
        </div>

        {/* Greg, 2026-09-16: "this should be the screens and i should be able
            to see what screens its published to and add more screens easily".
            The table below says which screens it reaches; this is the way to
            add another, on the tab where the question gets asked.

            It used to only switch to the Schedule tab and leave the operator
            to find "Add schedule" for themselves — two hops to do the thing
            the button is named after. It now opens the picker directly. */}
        {!props.isViewer && (
          <div className="flex items-center justify-between gap-3">
            <p className={`text-[13px] ${INK_2}`}>
              Every screen this playlist is published to.
            </p>
            <button
              type="button"
              onClick={props.onAddScreens}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-[10px] text-[13px] font-bold text-white shadow-sm"
              style={{ background: 'var(--brand-primary, #3515E8)' }}
            >
              <Plus className="w-4 h-4" aria-hidden />
              Add screens
            </button>
          </div>
        )}
        {/* THE SCREEN LIST. This was a REACHABLE / PICTURE / UPDATE table —
            Greg, twice: "does this look like screens?" / "not this ugly text
            mess". It was a delivery report wearing the word Screens. It is a
            card per screen now, in the same shape as the Schedule cards, with
            the power switch he asked for. */}
        {/* §22.5 — a FAILED delivery read is its own state. Without this the
            list would render calmly while the platform had no idea whether any
            of it is true. Restored deliberately: replacing the old panel
            wholesale had deleted it. */}
        {props.deliverySummary.tone === 'unavailable' && (
          <div className="rounded-[12px] border border-amber-200 bg-amber-50/60 p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-700" aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-amber-700">{props.deliverySummary.label}</p>
              <button
                type="button"
                onClick={props.delivery.onRetry}
                className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-[9px] border border-amber-300 bg-white text-[13px] font-bold text-amber-800"
              >
                Retry delivery status
              </button>
            </div>
          </div>
        )}

        {/* THE ROLLUP. The header deliberately suppresses its exception box on
            this tab because the list is supposed to lead with the same fact —
            so when I replaced the old panel and did not carry this line over,
            "G43 not updated · 3 of 4 received" stopped appearing ANYWHERE for
            an operator on Screens. Restored. Only for a degraded state: a
            healthy playlist opens straight onto its screens. */}
        {props.deliverySummary.tone !== 'ok'
          && props.deliverySummary.tone !== 'muted'
          && props.deliverySummary.tone !== 'unavailable' && (
          <div className="flex items-start gap-3 rounded-[12px] border border-amber-200 bg-amber-50/70 px-4 py-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" aria-hidden />
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-amber-900">{props.deliverySummary.label}</p>
              {props.deliverySummary.detail && (
                <p className="text-[13px] text-amber-800/90 mt-0.5">{props.deliverySummary.detail}</p>
              )}
            </div>
          </div>
        )}

        {/* Greg, 2026-09-16: "dump all that dumb ass fine print about the
            screen status". The provenance and signature-gap paragraphs are
            gone from the face of the tab.
            The honesty they carried is NOT gone: every row still states what
            that screen reports about itself ("Not received", "No picture
            confirmed", "Instant commands not arriving", "Re-pair required"),
            and a failed read still raises its own banner above. What is gone is
            the standing disclaimer that repeated the same caveat on every visit
            whether or not anything was wrong. */}
        {props.screenRows.length === 0 ? (
          <div className={`rounded-[12px] px-6 py-10 text-center ${SURFACE}`}>
            <p className={`text-[14px] font-bold ${INK}`}>Not published to any screen</p>
            <p className={`text-[13px] ${INK_2} mt-1`}>
              Use Add screens above and this list will show every screen it reaches.
            </p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="delivery-table">
            {props.screenRows.map((s) => {
              // data-state carries the DELIVERY grade, not on/off. Overwriting
              // it with the switch position deleted the one signal that says a
              // screen is not getting the content — the G43 case this tab was
              // built for.
              const ev = evidenceById.get(s.id);
              const sc = screenById.get(s.id);
              return (
              <div
                key={s.id}
                data-testid="delivery-row"
                data-state={ev?.state ?? 'unknown'}
                className={`p-4 rounded-2xl border flex items-center justify-between gap-4 transition-all ${
                  s.active ? 'bg-emerald-50/50 border-emerald-100' : 'bg-slate-50 border-slate-100 opacity-60'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${s.active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <Monitor className={`w-4 h-4 shrink-0 ${INK_3}`} aria-hidden />
                  <p className={`text-[14px] font-bold ${INK} truncate`}>{s.name}</p>
                  <span className={`text-[11px] font-semibold shrink-0 ${s.online ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {s.online ? 'Online' : 'Offline'}
                  </span>
                  {s.viaGroupName && (
                    <span className="text-[11px] font-semibold text-slate-400 truncate shrink-0">
                      via {s.viaGroupName}
                    </span>
                  )}
                  {/* Evidence, but only when there IS something to say. A
                      healthy screen stays a clean row; a screen that is not
                      getting the content still says so, which is the whole
                      reason this tab exists. */}
                  {ev && ev.state === 'not-updated' && (
                    <span className="text-[11px] font-bold text-amber-700 shrink-0">Not received</span>
                  )}
                  {ev && ev.state === 'no-picture' && (
                    <span className="text-[11px] font-bold text-rose-700 shrink-0">No picture confirmed</span>
                  )}
                  {sc?.pushChannel === 'stale' && (
                    <span className={`text-[11px] ${INK_3} shrink-0`}>Instant commands not arriving</span>
                  )}
                  {sc?.authState === 'REPAIR_REQUIRED' && (
                    <span className="text-[11px] font-bold text-rose-700 shrink-0">Re-pair required</span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* A screen reached only through a GROUP rule has no rule of
                      its own, so switching it off would take every screen in
                      that group dark. Say that instead of doing it. */}
                  <button
                    type="button"
                    disabled={props.isViewer || !s.scheduleId}
                    onClick={() => s.scheduleId && props.onToggleScreen(s.scheduleId)}
                    title={
                      props.isViewer ? 'Read-only — viewer role'
                        : s.scheduleId ? (s.active ? `Stop this playlist on ${s.name}` : `Play this playlist on ${s.name}`)
                          : `${s.name} is covered by the ${s.viaGroupName} group — switch the group's schedule instead`
                    }
                    aria-label={s.active ? `Stop this playlist on ${s.name}` : `Play this playlist on ${s.name}`}
                    className={`p-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      s.active ? 'text-emerald-600 hover:bg-emerald-100' : 'text-slate-400 hover:bg-slate-100'
                    }`}
                  >
                    <Power className="w-4 h-4" aria-hidden />
                  </button>
                  {/* Remove, in the same place the Schedule card puts it. Only
                      for a screen with its OWN rule — one reached through a
                      group would take the whole group with it, which is not
                      what removing a screen means. */}
                  <button
                    type="button"
                    disabled={props.isViewer || !s.scheduleId}
                    onClick={() => s.scheduleId && props.onRemoveScreen(s.scheduleId, s.name)}
                    aria-label={`Remove ${s.name} from this playlist`}
                    title={
                      props.isViewer ? 'Read-only — viewer role'
                        : s.scheduleId ? `Remove ${s.name} from this playlist`
                          : `${s.name} comes from the ${s.viaGroupName} group — remove it there`
                    }
                    className="p-2 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </button>
                  {/* Greg, 2026-09-16: "should have the power button, the trash
                      and then a gear for settings not a pencil for the screens".
                      A gear straight to that screen's settings — no kebab, no
                      menu to open first. The Schedule card's third icon edits a
                      schedule, so it is a pencil; a screen's is a gear. */}
                  <button
                    type="button"
                    onClick={() => props.onOpenScreen(s.id)}
                    aria-label={`Settings for ${s.name}`}
                    title={`Settings for ${s.name}`}
                    className="p-2 rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                  >
                    <Settings className="w-4 h-4" aria-hidden />
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )}
        </div>
      )}

    </div>
  );
}

/** ACTION_TOKEN → "Action token", with the handful worth naming properly. */
function humaniseAction(action: string): string {
  const known: Record<string, string> = {
    PLAYLIST_CREATED: 'Playlist created',
    PLAYLIST_UPDATED: 'Playlist updated',
    PLAYLIST_DELETED: 'Playlist removed',
    PLAYLIST_ITEMS_REORDERED: 'Content changed',
    PLAYLIST_ACTIVE_TOGGLED: 'Publishing switched on or off',
    SCHEDULE_CREATED: 'Publishing rule created',
    SCHEDULE_DELETED: 'Publishing rule removed',
    SCHEDULE_TOGGLED: 'Publishing rule paused or resumed',
    PLAYLIST_PUBLISHED_TO_FLEET: 'Distributed to locations',
    SUBMISSION_CREATED: 'Sent for review',
    SUBMISSION_APPROVED: 'Approved',
    SUBMISSION_REJECTED: 'Sent back',
  };
  if (known[action]) return known[action];
  const words = action.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default PlaylistWorkspace;
