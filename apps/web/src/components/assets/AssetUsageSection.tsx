"use client";

/**
 * AssetUsageSection — "where is this asset actually playing?"
 *
 * Media Library v1 handoff §15 calls this the highest-value missing piece of
 * product information, and §22 makes the truth rules non-negotiable:
 *
 *   - counts come from real references (GET /assets/:id/usage), never from
 *     whatever happened to be loaded in the client;
 *   - UNKNOWN usage says "can't check", NEVER "0" and never "unused" — a
 *     missing/erroring endpoint must not read as permission to delete;
 *   - "currently reaching N screens" requires real active-schedule evidence,
 *     so it only renders when the server reports screensReached > 0;
 *   - protected emergency content is visually AND semantically distinct.
 *
 * Purely presentational: the caller owns the query so the same component
 * serves the detail modal and the in-use deletion block.
 */

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, Loader2, MonitorPlay, RefreshCw, ShieldAlert } from 'lucide-react';
import type { AssetUsage } from '@/hooks/use-api';

export function pluralize(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function AssetUsageSection({
  usage,
  isLoading,
  isError,
  onRetry,
  compact,
}: {
  usage: AssetUsage | null | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
  /** Deletion-block rendering: drop the section heading and the expander. */
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const heading = compact ? null : (
    <div className="flex items-center gap-1.5">
      <MonitorPlay className="w-3.5 h-3.5 text-slate-400" />
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Usage and impact</h3>
    </div>
  );

  // ── Loading ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <section className="space-y-2" aria-busy="true" data-testid="asset-usage">
        {heading}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin motion-reduce:animate-none" />
          <p className="text-xs text-slate-600">Checking where this asset is used…</p>
        </div>
      </section>
    );
  }

  // ── Unknown (endpoint missing / errored) — never "0", never "unused" ──
  if (isError || !usage) {
    return (
      <section className="space-y-2" data-testid="asset-usage">
        {heading}
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            <HelpCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-amber-900">Can&apos;t check usage right now</p>
              <p className="text-[11px] text-amber-800 leading-relaxed mt-0.5">
                We couldn&apos;t reach the usage service, so we don&apos;t know which playlists or screens
                are using this file. Check your playlists before you remove it.
              </p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border border-amber-300 text-amber-900 text-[11px] font-bold hover:bg-amber-100"
                >
                  <RefreshCw className="w-3 h-3" /> Try again
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ── Protected emergency content ───────────────────────────────────
  if (usage.protectedEmergency) {
    return (
      <section className="space-y-2" data-testid="asset-usage">
        {heading}
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-rose-900">Protected emergency content</p>
              <p className="text-[11px] text-rose-800 leading-relaxed mt-0.5">
                This asset is protected emergency content and cannot be removed here. Open Emergency
                settings to review it.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const { playlists, totals } = usage;
  const playlistCount = totals?.playlists ?? playlists.length;

  // ── Known, and used by nothing ────────────────────────────────────
  if (playlistCount === 0) {
    return (
      <section className="space-y-2" data-testid="asset-usage">
        {heading}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-slate-700">Not used by any playlist</p>
            <p className="text-[11px] text-slate-600 leading-relaxed mt-0.5">
              Nothing on your screens is pointing at this file right now.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // ── Known, and in use ─────────────────────────────────────────────
  const reach = totals?.screensReached ?? 0;
  const locations = totals?.locations ?? 0;

  return (
    <section className="space-y-2" data-testid="asset-usage">
      {heading}
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
        <div className="flex items-start gap-2">
          <MonitorPlay className="w-4 h-4 text-indigo-700 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-indigo-900">
              Used in {pluralize(playlistCount, 'playlist', 'playlists')}
            </p>
            <p className="text-[11px] text-indigo-800 leading-relaxed mt-0.5">
              {reach > 0
                ? `Currently reaching ${pluralize(reach, 'screen', 'screens')}${
                    locations > 0 ? ` across ${pluralize(locations, 'location', 'locations')}` : ''
                  }`
                : 'Not on any screen right now — no active schedule uses these playlists.'}
            </p>
          </div>
        </div>

        {!compact && playlists.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 hover:text-indigo-900"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {expanded ? 'Hide the playlists' : 'Show the playlists'}
          </button>
        )}

        {(compact || expanded) && playlists.length > 0 && (
          <ul className="mt-2 space-y-1.5 list-none p-0 m-0">
            {playlists.map((p) => (
              <li key={p.id} className="rounded-md bg-white border border-indigo-100 px-2.5 py-2">
                <p className="text-[11px] font-bold text-slate-800 truncate">{p.name}</p>
                <p className="text-[10px] text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span>{pluralize(p.itemCount ?? 0, 'item', 'items')}</span>
                  <span aria-hidden="true">·</span>
                  <span>{p.scheduled ? 'Scheduled' : 'Not scheduled'}</span>
                  {p.activeNow && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-bold text-emerald-700">On screen now</span>
                    </>
                  )}
                  {p.screensReached > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{pluralize(p.screensReached, 'screen', 'screens')}</span>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * The §16 "this asset is currently in use" block — shown INSTEAD of a
 * delete confirmation when the server (or a pre-flight usage check) says the
 * asset is referenced. There is deliberately no force-delete affordance.
 */
export function AssetInUseBlock({
  assetName,
  usage,
  onReviewUsage,
  onCancel,
}: {
  assetName: string;
  usage: AssetUsage;
  onReviewUsage: () => void;
  onCancel: () => void;
}) {
  const playlistCount = usage.totals?.playlists ?? usage.playlists.length;
  const reach = usage.totals?.screensReached ?? 0;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="asset-in-use-title"
      data-testid="asset-in-use-block"
      className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4"
    >
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-4.5 h-4.5 text-amber-700" />
        </span>
        <div className="min-w-0">
          <h2 id="asset-in-use-title" className="text-sm font-bold text-slate-900">
            This asset is currently in use
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed mt-1">
            It appears in {pluralize(playlistCount, 'playlist', 'playlists')}
            {reach > 0 ? ` reaching ${pluralize(reach, 'screen', 'screens')}` : ''}. Remove or replace
            those references before deleting it.
          </p>
          <p className="text-[11px] text-slate-500 mt-1 break-all">{assetName}</p>
        </div>
      </div>

      <AssetUsageSection usage={usage} isLoading={false} isError={false} compact />

      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onReviewUsage}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"
        >
          Review usage
        </button>
      </div>
    </div>
  );
}
