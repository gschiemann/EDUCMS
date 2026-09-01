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
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2, PauseCircle } from 'lucide-react';
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

export const WORKSPACE_TABS = ['content', 'publishing', 'delivery', 'activity'] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export function isWorkspaceTab(v: unknown): v is WorkspaceTab {
  return typeof v === 'string' && (WORKSPACE_TABS as readonly string[]).includes(v);
}

const TAB_LABELS: Record<WorkspaceTab, string> = {
  content: 'Content',
  publishing: 'Publishing',
  delivery: 'Delivery',
  activity: 'Activity',
};

export interface ActivityEntry {
  id: string;
  action: string;
  actor: string | null;
  createdAt: string;
  detail: string | null;
}

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
  activity: { entries: ActivityEntry[]; loading: boolean; permitted: boolean; complete: boolean };
  onPauseEverywhere: () => void;
  pausePending: boolean;
  onOpenClassicEditor: () => void;
  onRefreshScreen: (screenId: string) => void;
  refreshingScreenId: string | null;
  onOpenScreen: (screenId: string) => void;
  isViewer: boolean;
}

export function PlaylistWorkspace(props: PlaylistWorkspaceProps) {
  const { row, tab } = props;
  const editorVisible = tab === 'content' || tab === 'publishing';

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
          <button
            type="button"
            onClick={props.onOpenClassicEditor}
            className={`inline-flex items-center gap-1.5 h-10 px-3 rounded-[10px] text-[13px] font-semibold ${SURFACE} ${INK_2} hover:bg-slate-50`}
            title="Open this playlist in the previous full-page editor"
          >
            Open full editor
            <ExternalLink className="w-3.5 h-3.5" aria-hidden />
          </button>
          {/* §19.2 — labelled, never an unlabelled switch, and only offered
              when there is something to pause. */}
          {!props.isViewer && props.ruleCount > 0 && row?.scheduleState !== 'PAUSED' && (
            <button
              type="button"
              onClick={props.onPauseEverywhere}
              disabled={props.pausePending}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-[10px] border border-amber-300 bg-white text-[13px] font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
            >
              <PauseCircle className="w-4 h-4" aria-hidden />
              {props.pausePending ? 'Pausing…' : 'Pause everywhere'}
            </button>
          )}
        </div>
      </div>

      {/* ── §12 exception summary — only when delivery is degraded, and only
             on the tabs that are NOT already showing it. The Delivery tab
             leads with the same block; printing it twice on one screen reads
             as two problems. ── */}
      {row && tab !== 'delivery'
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
              Delivery tab, so this action always has somewhere to go. */}
          <button
            type="button"
            onClick={() => props.onTab('delivery')}
            className="shrink-0 text-[13px] font-bold hover:underline"
            style={{ color: 'var(--brand-primary, #3515E8)' }}
          >
            Review delivery
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
      {/* Content + Publishing: the embedded editor. Hidden, never unmounted,
          so an unsaved edit survives a trip to Delivery. */}
      <div className={editorVisible ? '' : 'hidden'} data-testid="workspace-editor">
        {props.editor}
      </div>

      {tab === 'delivery' && row && (
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
      )}

      {tab === 'activity' && <ActivityPanel {...props.activity} />}
    </div>
  );
}

/**
 * §16 Activity. The audit log has no per-target query parameter, so this reads
 * the recent tenant page and keeps the rows that name this playlist. That is
 * a real limit, so the panel says it rather than presenting a filtered page as
 * the complete history — "audit completeness is an implementation dependency;
 * the designer should still specify the complete state so missing events
 * cannot hide behind layout ambiguity".
 */
function ActivityPanel({
  entries, loading, permitted, complete,
}: { entries: ActivityEntry[]; loading: boolean; permitted: boolean; complete: boolean }) {
  if (!permitted) {
    return (
      <div className={`rounded-[12px] px-6 py-10 text-center ${SURFACE}`}>
        <p className={`text-[14px] font-bold ${INK}`}>Activity is available to administrators</p>
        <p className={`text-[13px] ${INK_2} mt-1`}>
          Your role can view and edit this playlist, but not its audit history.
        </p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className={`rounded-[12px] p-10 flex items-center justify-center ${SURFACE}`} aria-busy="true">
        <Loader2 className={`w-5 h-5 animate-spin ${INK_3}`} aria-hidden />
        <span className="sr-only">Loading activity…</span>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {entries.length === 0 ? (
        <div className={`rounded-[12px] px-6 py-10 text-center ${SURFACE}`}>
          <p className={`text-[14px] font-bold ${INK}`}>No recorded activity for this playlist</p>
          <p className={`text-[13px] ${INK_2} mt-1`}>
            Changes are recorded as they happen. Older entries may be beyond the range read here.
          </p>
        </div>
      ) : (
        <ol className={`rounded-[12px] overflow-hidden ${SURFACE}`}>
          {entries.map((e) => (
            <li key={e.id} className={`px-4 py-3 border-b last:border-b-0 ${HAIRLINE}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-[13px] font-semibold ${INK}`}>{humaniseAction(e.action)}</p>
                  <p className={`text-[12px] ${INK_3}`}>
                    {e.actor ?? 'Unknown user'}
                    {e.detail ? ` · ${e.detail}` : ''}
                  </p>
                </div>
                <span className={`text-[12px] ${INK_3} shrink-0`} title={exactStamp(e.createdAt)}>
                  {timeAgo(e.createdAt)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {!complete && (
        <p className={`text-[12px] ${INK_3}`}>
          Showing recent entries that name this playlist. The full audit trail,
          including entries beyond this range, is in Settings → Audit log.
        </p>
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
