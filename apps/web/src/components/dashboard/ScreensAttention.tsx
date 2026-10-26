"use client";

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, CloudOff, EyeOff, MoonStar, PlugZap } from 'lucide-react';
import type { AttentionEntry, SortedAttention } from '@/lib/activity/screenAttention';
import { useActivityTime } from '@/components/activity/RecentActivityCard';

/**
 * "Screens down" on Home (2026-10-24).
 *
 * The red card used to list every screen that was not answering. The owner's
 * own Home showed "Test 1 · Web App · last seen Aug 6" — a phone-browser test
 * screen silent for eleven weeks — beside a real outage, and a screen dark on
 * its on/off schedule read as down every night. Now:
 *
 *   red card      — real, recent outages only (`down`): longest-silent first,
 *                   each row opens that screen.
 *   quiet lines   — collapsed, never red: "Not seen in 30+ days" (also never
 *                   connected, and phone-browser test screens), and "off on
 *                   purpose" (on/off schedule, turned off from the dashboard,
 *                   standby, restarting). Same facts the alert emails use.
 *
 * Sorting lives in `@/lib/activity/screenAttention` (pure, tested); this file
 * only draws it.
 */
export function ScreensAttention({ sorted, tenantBase }: { sorted: SortedAttention; tenantBase: string }) {
  return (
    <>
      {sorted.down.length > 0 && <ScreensDownCard down={sorted.down} tenantBase={tenantBase} />}
      {(sorted.dormant.length > 0 || sorted.resting.length > 0) && (
        <QuietScreens dormant={sorted.dormant} resting={sorted.resting} tenantBase={tenantBase} />
      )}
    </>
  );
}

function placeOf(e: AttentionEntry): string | null {
  return e.location || e.groupName || null;
}

function ScreensDownCard({ down, tenantBase }: { down: AttentionEntry[]; tenantBase: string }) {
  const t = useTranslations('dashboard');
  const time = useActivityTime();
  return (
    <section
      data-testid="screens-down"
      className="bg-white rounded-2xl border border-red-200 overflow-hidden"
      aria-labelledby="screens-down-title"
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-red-100 flex items-center justify-between gap-3 bg-red-50/50">
        <div className="flex items-center gap-2 min-w-0">
          <CloudOff className="w-4 h-4 text-red-600 shrink-0" aria-hidden />
          <h2 id="screens-down-title" className="text-sm font-bold text-slate-800 truncate">{t('screensDown')}</h2>
          <span className="text-[11px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full tabular-nums">{down.length}</span>
        </div>
        <Link
          href={`${tenantBase}/screens?filter=offline`}
          className="shrink-0 inline-flex items-center min-h-[44px] -my-2 text-[12px] font-semibold text-red-700 hover:text-red-800"
        >
          {t('viewAll')}
        </Link>
      </div>
      <ul className="divide-y divide-slate-100">
        {down.slice(0, 5).map((s) => {
          const when = s.lastSeenAt ? time(s.lastSeenAt) : null;
          const place = placeOf(s);
          return (
            <li key={s.id}>
              <Link
                href={`${tenantBase}/screens?screen=${encodeURIComponent(s.id)}`}
                className="px-4 sm:px-5 py-3 min-h-[56px] flex items-center gap-3 hover:bg-slate-50 active:bg-slate-50 transition-colors"
              >
                <span className="relative flex w-2.5 h-2.5 shrink-0" aria-hidden>
                  <span className="absolute top-0 right-0 bottom-0 left-0 rounded-full bg-red-400 opacity-60 animate-ping" />
                  <span className="relative w-2.5 h-2.5 rounded-full bg-red-500" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-slate-800 truncate">{s.name}</span>
                  <span className="block text-[11.5px] text-slate-500 truncate">
                    {[place, when ? t('attention.lastSeen', { when: when.short }) : t('attention.neverSeen')]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
      {/* The fix, once, in plain words — not repeated on every row. */}
      <p className="px-4 sm:px-5 py-2.5 border-t border-red-100 bg-red-50/30 text-[12px] text-red-800 flex items-center gap-2">
        <PlugZap className="w-3.5 h-3.5 shrink-0" aria-hidden />
        {t('attention.downCheckFull')}
      </p>
    </section>
  );
}

function QuietScreens({ dormant, resting, tenantBase }: { dormant: AttentionEntry[]; resting: AttentionEntry[]; tenantBase: string }) {
  const t = useTranslations('dashboard.attention');
  const count = (reason: string) => dormant.filter((s) => s.reason === reason).length;
  const notSeen = count('not-seen-30-days');
  const never = count('never-connected');
  const test = count('test-screen');
  const dormantSummary = [
    notSeen ? t('notSeen30', { count: notSeen }) : null,
    never ? t('neverConnected', { count: never }) : null,
    test ? t('testScreens', { count: test }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-2" data-testid="screens-quiet">
      {dormant.length > 0 && (
        <QuietGroup
          testId="screens-dormant"
          icon={<EyeOff className="w-4 h-4 text-slate-400" aria-hidden />}
          summary={dormantSummary}
          hint={t('quietHint')}
          rows={dormant}
          tenantBase={tenantBase}
        />
      )}
      {resting.length > 0 && (
        <QuietGroup
          testId="screens-resting"
          icon={<MoonStar className="w-4 h-4 text-indigo-400" aria-hidden />}
          summary={t('restingTitle', { count: resting.length })}
          hint={t('restingHint')}
          rows={resting}
          tenantBase={tenantBase}
        />
      )}
    </div>
  );
}

/**
 * One collapsed line. A native <details>: keyboard, screen reader and
 * WebKit all get open / closed for free, and nothing on the page re-renders
 * when it toggles.
 */
function QuietGroup({
  testId, icon, summary, hint, rows, tenantBase,
}: {
  testId: string;
  icon: React.ReactNode;
  summary: string;
  hint: string;
  rows: AttentionEntry[];
  tenantBase: string;
}) {
  const t = useTranslations('dashboard.attention');
  const time = useActivityTime();
  return (
    <details data-testid={testId} className="group rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none px-4 sm:px-5 min-h-[52px] flex items-center gap-3 hover:bg-slate-50">
        {icon}
        <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-600">{summary}</span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-slate-100">
        <p className="px-4 sm:px-5 pt-3 text-[12px] leading-snug text-slate-500">{hint}</p>
        <ul className="divide-y divide-slate-100">
          {rows.slice(0, 20).map((s) => {
            const when = s.lastSeenAt ? time(s.lastSeenAt) : null;
            const place = s.location || s.groupName || null;
            return (
              <li key={s.id}>
                <Link
                  href={`${tenantBase}/screens?screen=${encodeURIComponent(s.id)}`}
                  className="px-4 sm:px-5 py-2.5 min-h-[52px] flex items-center gap-3 hover:bg-slate-50"
                >
                  <span className="w-2 h-2 rounded-full bg-slate-300 shrink-0" aria-hidden />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-slate-700 truncate">{s.name}</span>
                    <span className="block text-[11.5px] text-slate-500 truncate">
                      {[
                        s.reason ? (t as unknown as (key: string) => string)(`reason.${s.reason}`) : null,
                        place,
                        when ? t('lastSeen', { when: when.short }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="px-4 sm:px-5 py-2.5 border-t border-slate-100">
          <Link href={`${tenantBase}/screens`} className="dash-link inline-flex items-center min-h-[44px] text-[12px] font-semibold">
            {t('manage')}
          </Link>
        </div>
      </div>
    </details>
  );
}
