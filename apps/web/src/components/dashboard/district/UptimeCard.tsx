'use client';

/**
 * Uptime · last 24h — replaces the stacked online/degraded/offline area chart
 * (Greg, 2026-09-14: "basically a useless graph that shows me nothing").
 *
 * What a signage fleet manager acts on, in one narrow card (~300px):
 *   · ON-TIME % over the last 24h, with the denominator named (scheduled
 *     sleep excluded where display schedules exist; around the clock
 *     otherwise);
 *   · a 96-slot strip — one cell per 15 minutes on a FIXED time axis —
 *     coloured by the worst thing true in that slot (offline / not painting /
 *     asleep / ok), empty where nothing was recorded; every cell carries its
 *     counts on hover;
 *   · four numbers with a way in: offline now and not painting now (live,
 *     the same counts as the pills above, each linking to the Screens page
 *     pre-filtered), asleep now (scheduled), outages (count · longest ·
 *     screen-minutes lost).
 * The maths is `uptime.ts` (unit-tested); this file only draws it.
 */
import Link from 'next/link';
import type { UptimeSummary, UptimeCell } from './uptime';

const CELL_COLOR: Record<UptimeCell['state'], string> = {
  ok: '#10b981',
  'not-painting': '#f59e0b',
  offline: '#f43f5e',
  asleep: '#94a3b8',
  none: '#e2e8f0',
};

const LEGEND: Array<{ label: string; color: string }> = [
  { label: 'Online', color: CELL_COLOR.ok },
  { label: 'Not painting', color: CELL_COLOR['not-painting'] },
  { label: 'Offline', color: CELL_COLOR.offline },
  { label: 'Asleep', color: CELL_COLOR.asleep },
];

const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function UptimeLegend() {
  return (
    <span className="ml-auto flex items-center gap-2 flex-wrap">
      {LEGEND.map(({ label, color }) => (
        <span key={label} className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-500">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} aria-hidden />
          {label}
        </span>
      ))}
    </span>
  );
}

function cellTitle(c: UptimeCell): string {
  if (c.state === 'none') return `${fmtClock(c.ts)} · no sample recorded`;
  const parts = [`${c.online}/${c.total} online`];
  const short = Math.max(0, c.expected - c.online);
  if (short) parts.push(`${short} offline`);
  if (c.notPainting) parts.push(`${c.notPainting} not painting`);
  if (c.asleep) parts.push(`${c.asleep} asleep`);
  return `${fmtClock(c.ts)} · ${parts.join(' · ')}`;
}

export function UptimeCard({ summary, screensHref }: { summary: UptimeSummary; screensHref: string }) {
  const {
    cells, samples, ontimePct, denominator, outages, longestOutageMin, offlineScreenMinutes,
    offlineNow, notPaintingNow, asleepNow, sleepScreens,
  } = summary;
  const first = cells[0]?.ts;

  const metric = (label: string, value: string, sub: string, opts: { href?: string; tone?: string } = {}) => {
    const body = (
      <>
        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">{label}</span>
        <span className={`block text-[16px] font-black leading-tight ${opts.tone ?? 'text-slate-900'}`}>{value}</span>
        <span className="block text-[10.5px] font-semibold leading-snug text-slate-400">{sub}</span>
      </>
    );
    return opts.href ? (
      <Link
        href={opts.href}
        className="block min-w-0 rounded-lg px-2 py-1.5 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        title={`${label} — see the list`}
      >
        {body}
      </Link>
    ) : (
      <div className="min-w-0 px-2 py-1.5">{body}</div>
    );
  };

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="px-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[30px] font-black leading-none text-slate-900" data-testid="ontime-pct">
            {ontimePct === null ? '—' : `${ontimePct}%`}
          </span>
          <span className="text-[12px] font-bold text-slate-600 whitespace-nowrap">on-time</span>
        </div>
        <p className="mt-0.5 text-[10.5px] font-semibold leading-snug text-slate-400">
          {ontimePct === null
            ? 'Nothing expected on yet — no verdict'
            : denominator === 'scheduled'
              ? `Scheduled sleep excluded · ${plural(sleepScreens, 'screen')} on a schedule`
              : 'Around the clock · no sleep schedules set'}
        </p>
      </div>

      <div className="px-1">
        <div
          role="img"
          aria-label={`Uptime over the last 24 hours, ${samples} samples`}
          className="flex gap-px h-7 rounded-md overflow-hidden"
        >
          {cells.map((c) => (
            <span
              key={c.ts}
              className="flex-1 min-w-0"
              style={{ background: CELL_COLOR[c.state], opacity: c.state === 'none' ? 0.55 : 1 }}
              title={cellTitle(c)}
            />
          ))}
        </div>
        {first !== undefined && (
          <div className="mt-1 flex justify-between text-[10px] font-semibold text-slate-400">
            <span>{fmtClock(first)}</span>
            <span>Now</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-1">
        {metric('Offline now', String(offlineNow), offlineNow ? 'power or network' : 'all answering', {
          href: `${screensHref}?filter=offline`, tone: offlineNow ? 'text-rose-600' : undefined,
        })}
        {metric('Not painting now', String(notPaintingNow), notPaintingNow ? 'online, no picture' : 'all confirmed', {
          href: `${screensHref}?filter=attention`, tone: notPaintingNow ? 'text-amber-600' : undefined,
        })}
        {metric('Asleep now', String(asleepNow), denominator === 'scheduled' ? 'scheduled off' : 'no schedules')}
        {metric('Outages · 24h', String(outages), outages ? `longest ${fmtMin(longestOutageMin)} · ${fmtMin(offlineScreenMinutes)} lost` : 'none', {
          tone: outages ? 'text-rose-600' : undefined,
        })}
      </div>
    </div>
  );
}
