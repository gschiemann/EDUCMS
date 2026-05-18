'use client';

/**
 * Proof of Play — content / sponsor display-time report.
 *
 * Reads GET /analytics/proof-of-play, which aggregates the
 * PlaybackSample stream the API's ProofOfPlaySampler writes every
 * ~10 minutes from every online screen. Shows how long each playlist,
 * asset and screen was live — the report sponsors ask for.
 */

import { useState, type ComponentType } from 'react';
import { BarChart3, Loader2, ListVideo, MonitorPlay, ImageIcon, Database } from 'lucide-react';
import { useProofOfPlay, type ProofOfPlayEntry } from '@/hooks/use-api';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

function fmtHours(h: number): string {
  if (h <= 0) return '0h';
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
    </div>
  );
}

/** A ranked list of display-time entries with a proportional bar. */
function RankTable({
  title,
  icon: Icon,
  rows,
  emptyLabel,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  rows: ProofOfPlayEntry[];
  emptyLabel: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.estimatedHours), 0) || 1;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
        <Icon className="h-4 w-4 text-indigo-500" />
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={`${r.name}-${i}`} className="flex items-center gap-3">
              <span className="w-1/3 shrink-0 truncate text-sm font-medium text-slate-700">
                {r.name}
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${Math.max(3, (r.estimatedHours / max) * 100)}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">
                {fmtHours(r.estimatedHours)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(7);
  const { data, isLoading, isError } = useProofOfPlay(days);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <BarChart3 className="h-6 w-6 text-indigo-500" />
            Proof of Play
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            How long your content and sponsors were live on screen.
          </p>
        </div>
        <div className="flex gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                days === r.days
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-slate-200 text-slate-600 hover:border-indigo-300'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-500">
          Couldn&apos;t load the proof-of-play report. Try again shortly.
        </div>
      ) : data && !data.ready ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <Database className="mx-auto h-8 w-8 text-slate-300" />
          <h3 className="mt-3 text-base font-bold text-slate-900">
            Proof-of-play isn&apos;t switched on yet
          </h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            The analytics table hasn&apos;t been created on the database yet. Apply the
            latest migration (<code className="rounded bg-slate-100 px-1">pnpm db:push</code>)
            and tracking starts automatically — a sample is taken from every online screen
            about every 10 minutes.
          </p>
        </div>
      ) : data && data.totalSamples === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center">
          <MonitorPlay className="mx-auto h-8 w-8 text-slate-300" />
          <h3 className="mt-3 text-base font-bold text-slate-900">No playback recorded yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Samples are collected from online screens about every 10 minutes. Once your
            screens have been playing scheduled content, their display time shows up here.
          </p>
        </div>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Screen-hours of content" value={fmtHours(data.estimatedScreenHours)} />
            <StatCard label="Playlists on air" value={String(data.playlists.length)} />
            <StatCard label="Tracked window" value={`${data.sinceDays} days`} />
          </div>
          <RankTable
            title="Playlists"
            icon={ListVideo}
            rows={data.playlists}
            emptyLabel="No playlist playback in this window."
          />
          <RankTable
            title="Content & sponsor assets"
            icon={ImageIcon}
            rows={data.assets}
            emptyLabel="No asset playback in this window."
          />
          <RankTable
            title="Screens"
            icon={MonitorPlay}
            rows={data.screens}
            emptyLabel="No screen playback in this window."
          />
          <p className="text-center text-xs text-slate-400">
            Display time is estimated from {data.sampleMinutes}-minute samples of online
            screens — an industry-standard proof-of-display measure.
          </p>
        </>
      ) : null}
    </div>
  );
}
