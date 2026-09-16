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
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2, PauseCircle, PlayCircle, Plus } from 'lucide-react';
import { DeliveryPanel } from './DeliveryPanel';
import {
  describeReach, exactStamp, timeAgo,
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
   * "Add screens" (Greg, 2026-09-16). Opens the publish sheet the editor
   * already owns, rather than dropping the operator on another tab to go
   * find it themselves.
   */
  onAddScreens: () => void;
}

export function PlaylistWorkspace(props: PlaylistWorkspaceProps) {
  const { row, tab } = props;
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
                className="inline-flex items-center gap-1.5 h-10 px-3 rounded-[10px] border border-emerald-300 bg-white text-[13px] font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
              >
                <PlayCircle className="w-4 h-4" aria-hidden />
                {props.pausePending ? 'Starting…' : 'Play everywhere'}
              </button>
            ) : (
              <button
                type="button"
                onClick={props.onPauseEverywhere}
                disabled={props.pausePending}
                className="inline-flex items-center gap-1.5 h-10 px-3 rounded-[10px] border border-amber-300 bg-white text-[13px] font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
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
        <>
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
        <DeliveryPanel
          playlistName={row.name}
          payload={props.delivery.payload}
          loading={props.delivery.loading}
          derived={props.delivery.derived}
          targetScreens={props.targetScreens}
          onRetry={props.delivery.onRetry}
          onRefreshScreen={props.onRefreshScreen}
          refreshingScreenId={props.refreshingScreenId}
          onOpenScreen={props.onOpenScreen}
          isViewer={props.isViewer}
        />
        </>
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
