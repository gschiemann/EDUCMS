'use client';

/**
 * Uptime · last 24h — Codex's card-only design, ported byte-faithful with
 * real data (2026-09-14; design source docs/design/proposals/2026-09-14-fleet-
 * reliability/uptime-card-only.html). Greg rejected two earlier versions of
 * this card; this is the one he chose.
 *
 *   hero      — % connected during scheduled hours (sleep excluded), or
 *               around the clock when no display schedule exists;
 *   timeline  — "Devices needing attention": 96 fifteen-minute bars, each the
 *               count of screens offline (rose) / playback unconfirmed (amber)
 *               / status unknown (grey) at that time; a slot with no recorded
 *               sample is hatched — "no observation", never counted healthy;
 *   scrubber  — inspect any 15-minute period; the current period's devices
 *               open the Screens list ("View N ↗"). Earlier periods carry
 *               counts only: the product keeps per-tick COUNTS, not per-device
 *               history (Codex's README names the telemetry that would add it);
 *   right now — live counts from the same screen list the pills read, each a
 *               way into the Screens page;
 *   footer    — telemetry coverage of the window.
 *
 * Deviations from the preview, both because the product has no data for
 * them: no per-device history filter, and the location filter is the page's
 * own scope control above the cards rather than a second one inside the card
 * (Codex's own README puts scope in the header).
 */
import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import type { UptimeSummary } from './uptime';

const ROSE = '#f43f5e';
const AMBER = '#f59e0b';
const GREY = '#94a3b8';
const PURPLE = 'var(--brand-primary, #4f46e5)';

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayWord = (ms: number, nowMs: number) => (new Date(ms).toDateString() === new Date(nowMs).toDateString() ? 'Today' : 'Yesterday');
const tzShort = () => {
  try {
    return new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch { return ''; }
};

export function UptimeCard({
  summary,
  screensHref,
  chart,
  nowMs = Date.now(),
}: {
  summary: UptimeSummary;
  screensHref: string;
  /** False while history is too thin to draw (the caller decides); the counts still show. */
  chart: boolean;
  nowMs?: number;
}) {
  const { cells, samples, ontimePct, denominator, sleepScreens, offlineNow, notPaintingNow, unknownNow, asleepNow, coveragePct } = summary;
  const last = cells.length - 1;
  const [selected, setSelected] = useState<number>(last);
  const sel = cells[Math.min(selected, last)];
  const patternId = useId().replace(/:/g, '');
  const devices = cells.reduce((m, c) => Math.max(m, c.total), 0);

  // ── chart geometry (Codex: 110px tall, 24/7/10/23 insets) ──
  const W = 390, H = 110, left = 24, right = 7, top = 10, bottom = 23;
  const plotW = W - left - right, plotH = H - top - bottom;
  const barW = plotW / cells.length;
  const maxStack = cells.reduce((m, c) => Math.max(m, c.state === 'none' ? 0 : Math.max(0, c.expected - c.online) + c.notPainting + c.unknown), 0);
  const axisMax = maxStack <= 2 ? 2 : maxStack <= 4 ? 4 : maxStack;
  const yFor = (n: number) => top + plotH - (n / axisMax) * plotH;

  const bars = useMemo(() => cells.map((c, i) => {
    const x = left + i * barW;
    if (c.state === 'none') return { x, gap: true as const };
    const off = Math.max(0, c.expected - c.online), unc = c.notPainting, unk = c.unknown;
    return { x, gap: false as const, off, unc, unk };
  }), [cells, barW]);

  const selOff = sel ? Math.max(0, sel.expected - sel.online) : 0;
  const selLine = !sel || sel.state === 'none'
    ? 'No observation · not counted as healthy'
    : sel.expected === 0 && sel.asleep > 0
      ? 'Scheduled off · no outage'
      : selOff + sel.notPainting + sel.unknown === 0
        ? 'No devices need attention'
        : [selOff ? `${selOff} offline` : '', sel.notPainting ? `${sel.notPainting} playback unconfirmed` : '', sel.unknown ? `${sel.unknown} unknown` : ''].filter(Boolean).join(' · ');
  const selCount = sel && sel.state !== 'none' ? selOff + sel.notPainting + sel.unknown : 0;
  const isNow = selected >= last;

  const stat = (key: string, n: number, label: string, tone: string, href?: string) => {
    const body = (
      <>
        <strong className={`block text-[22px] font-semibold leading-tight tabular-nums ${tone}`}>{n}</strong>
        <span className="block text-[10.5px] text-slate-500 mt-0.5 leading-snug">{label}{href ? ' ↗' : ''}</span>
      </>
    );
    return href ? (
      <Link key={key} href={href} className="text-left px-1 py-1.5 rounded-lg min-w-0 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" title={`${label} — open the Screens list`}>{body}</Link>
    ) : (
      <div key={key} className="px-1 py-1.5 min-w-0">{body}</div>
    );
  };

  return (
    <div className="w-full flex flex-col" data-testid="uptime-card">
      {/* hero */}
      <div className="flex items-baseline gap-2.5">
        <span className="text-[38px] leading-[1.15] font-semibold tracking-[-1.3px] tabular-nums text-slate-900" data-testid="ontime-pct">
          {ontimePct === null ? '—' : `${ontimePct}%`}
        </span>
        <span className="text-[12px] text-slate-500 max-w-[140px] leading-snug">
          {denominator === 'scheduled' ? 'connected during scheduled hours' : 'connected around the clock'}
        </span>
      </div>
      <p className="text-[11px] text-slate-500 mt-1 mb-2.5">
        {devices || summary.cells.length ? `${devices} device${devices === 1 ? '' : 's'}` : 'No devices yet'}
        {denominator === 'scheduled' ? ` · scheduled sleep excluded (${sleepScreens} on a schedule)` : ' · no sleep schedules set'}
      </p>

      {/* timeline */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 mb-1.5">
        <strong className="font-medium text-slate-900">Devices needing attention</strong>
        {chart && <span>Tap a time to inspect</span>}
      </div>
      {chart ? (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-[110px] block cursor-crosshair"
            role="img"
            aria-label={`Devices needing attention over the last 24 hours, ${samples} samples; vertical scale 0 to ${axisMax} devices. Hatched gaps mean no observation.`}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const frac = ((e.clientX - r.left) / r.width) * W;
              setSelected(Math.min(last, Math.max(0, Math.floor(((frac - left) / plotW) * cells.length))));
            }}
          >
            <defs>
              <pattern id={`gap-${patternId}`} width="5" height="5" patternUnits="userSpaceOnUse">
                <path d="M0 5L5 0" stroke={GREY} strokeWidth="1" opacity=".6" />
              </pattern>
            </defs>
            {[0, axisMax / 2, axisMax].map((n) => (
              <g key={n}>
                <line x1={left} x2={W - right} y1={yFor(n)} y2={yFor(n)} stroke="#e2e8f0" strokeWidth="1" />
                <text x={left - 6} y={yFor(n) + 4} textAnchor="end" fontSize="11" fill="#64748b">{n}</text>
              </g>
            ))}
            {bars.map((b, i) => {
              if (b.gap) return <rect key={i} x={b.x} y={top} width={Math.max(0.5, barW - 0.6)} height={plotH} fill={`url(#gap-${patternId})`} />;
              let y = top + plotH;
              const segs: Array<[number, string]> = [[b.off, ROSE], [b.unc, AMBER], [b.unk, GREY]];
              return (
                <g key={i}>
                  {segs.map(([n, color], k) => {
                    if (!n) return null;
                    const h = (n / axisMax) * plotH; y -= h;
                    return <rect key={k} x={b.x} y={y} width={Math.max(0.5, barW - 0.6)} height={h} fill={color} />;
                  })}
                </g>
              );
            })}
            {sel && (
              <g>
                <line x1={left + Math.min(selected, last) * barW + barW / 2} x2={left + Math.min(selected, last) * barW + barW / 2} y1={top - 3} y2={top + plotH + 3} stroke={PURPLE} strokeWidth="1.5" />
                <circle cx={left + Math.min(selected, last) * barW + barW / 2} cy={top - 3} r="3" fill={PURPLE} />
              </g>
            )}
            {[[0, cells[0] ? (dayWord(cells[0].ts, nowMs) === 'Today' ? clock(cells[0].ts) : 'Yesterday') : '', 'start'], [0.5, cells[Math.floor(cells.length / 2)] ? clock(cells[Math.floor(cells.length / 2)].ts) : '', 'middle'], [1, 'Now', 'end']].map(([f, label, anchor]) => (
              <text key={String(anchor)} x={left + (f as number) * plotW} y={H - 3} textAnchor={anchor as 'start' | 'middle' | 'end'} fontSize="11" fill="#64748b">{label as string}</text>
            ))}
          </svg>
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={Math.min(selected, last)}
            onChange={(e) => setSelected(Number(e.target.value))}
            aria-label="Inspect a 15-minute period"
            className="w-full mt-1.5 block h-[14px] cursor-pointer"
            style={{ accentColor: 'var(--brand-primary, #4f46e5)' }}
          />
          <div className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-[9px] px-2.5 py-1.5 mt-1.5 mb-2 min-h-[45px]">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-slate-900 m-0">{sel ? `${dayWord(sel.ts, nowMs)} · ${clock(sel.ts)} ${tzShort()}`.trim() : ''}</p>
              <p className="text-[11px] text-slate-500 m-0" data-testid="uptime-inspect">{selLine}</p>
            </div>
            {isNow && selCount > 0 && (
              <Link href={`${screensHref}?filter=attention`} className="text-[12px] font-medium shrink-0 inline-flex items-center gap-1 min-h-[32px]" style={{ color: 'var(--brand-primary, #4f46e5)' }}>
                View {selCount} ↗
              </Link>
            )}
          </div>
          <div className="flex gap-3 flex-wrap text-[11px] text-slate-500 mb-2">
            {[['Offline', ROSE], ['Playback', AMBER], ['Unknown', GREY]].map(([label, color]) => (
              <span key={label} className="inline-flex items-center gap-1">
                <span className="w-[7px] h-[7px] rounded-[2px] inline-block" style={{ background: color }} aria-hidden />
                {label}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="px-1 py-3 text-[12px] font-semibold text-slate-400">
          Building your first 24 hours of history — first samples land within the hour.
        </p>
      )}

      {/* right now */}
      <p className="text-[10px] tracking-[.1em] uppercase text-slate-500 font-medium border-t border-slate-200 pt-2 mb-1">Right now</p>
      <div className="grid grid-cols-4 gap-1">
        {stat('offline', offlineNow, 'Offline', offlineNow ? 'text-rose-600' : 'text-slate-900', `${screensHref}?filter=offline`)}
        {stat('unconfirmed', notPaintingNow, 'Playback unconfirmed', notPaintingNow ? 'text-amber-700' : 'text-slate-900', `${screensHref}?filter=attention`)}
        {stat('unknown', unknownNow, 'Unknown', 'text-slate-900', screensHref)}
        {stat('sleep', asleepNow, 'Scheduled off', 'text-slate-900')}
      </div>
      <p className="border-t border-slate-200 pt-2 mt-2 text-[10px] text-slate-500">
        {samples ? `${coveragePct}% telemetry coverage` : 'No telemetry recorded yet'}
      </p>
    </div>
  );
}
