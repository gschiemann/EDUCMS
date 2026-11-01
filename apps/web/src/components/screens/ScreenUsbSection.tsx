"use client";

/**
 * ScreenUsbSection — "USB drive" in the screen drawer's Technical details
 * (2026-10-26, M43 on site: "inserted a USB … nothing happens").
 *
 * What this screen last did with a USB drive, in plain words, from its own
 * reports (`GET /screens/:id/usb-events`): plugged in, needs permission, no
 * playlist on it, waiting to connect once, refused (and why), imported.
 * Before player 1.1.55 a screen reported only a finished or refused import,
 * so "nothing happened" left no line at all — the note says so.
 *
 * Copy states what the evidence proves (Player Reliability rule 10): these
 * are the screen's own reports, never a view of the glass. Admins only (the
 * API allows admins; others see nothing rather than an error). Fetched when
 * Technical details is open — never polled (mobile-perf standard). Dashboard
 * surface, so CSS gap is fine.
 */

import { useLocale, useTranslations } from 'next-intl';
import { useScreenUsbEvents, type ScreenUsbEvent } from '@/hooks/use-api';
import { RoleGate } from '@/components/RoleGate';

const ADMIN_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'];

/** Problems an operator can act on: said in amber. */
const PROBLEM_KEYS = new Set(['needsAccess', 'noAccessPage', 'noPackage', 'waitingKey', 'otherOrg', 'unverified', 'noSpace', 'unreadable', 'rejected']);

/**
 * The message key for one report. The APK's reason starts with a stable code
 * (`other-organization: …`); older APKs sent ACCEPTED / REJECTED_SIGNATURE /
 * REJECTED_HASH. Anything unknown still gets an honest line.
 */
export function usbOutcomeKey(outcome: string, reason: string | null | undefined): string {
  const code = (reason ?? '').split(':')[0].trim();
  switch (outcome) {
    case 'DETECTED':
      return 'detected';
    case 'NEEDS_ACCESS':
      return code === 'no-settings-page' ? 'noAccessPage' : 'needsAccess';
    case 'NO_PACKAGE':
      return 'noPackage';
    case 'WAITING_KEY':
      return 'waitingKey';
    case 'IMPORTED':
    case 'ACCEPTED':
      return 'imported';
    case 'REJECTED_SIGNATURE':
    case 'REJECTED_HASH':
      return 'unverified';
    case 'REJECTED_TENANT':
      return 'otherOrg';
    case 'REJECTED':
      switch (code) {
        case 'other-organization':
          return 'otherOrg';
        case 'unverified':
          return 'unverified';
        case 'no-space':
          return 'noSpace';
        case 'unreadable':
          return 'unreadable';
        default:
          return 'rejected';
      }
    default:
      return 'unknown';
  }
}

const isEvent = (e: unknown): e is ScreenUsbEvent => {
  if (!e || typeof e !== 'object') return false;
  const v = e as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.outcome === 'string' && typeof v.createdAt === 'string' && Number.isFinite(Date.parse(v.createdAt));
};

/** The events this section can read, newest first; null for an answer it cannot read. */
export function readUsbEvents(body: unknown): ScreenUsbEvent[] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const events = (body as Record<string, unknown>).events;
  if (!Array.isArray(events)) return null;
  return events.filter(isEvent);
}

function formatAt(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function UsbCard({ screenId }: { screenId: string }) {
  const t = useTranslations('screens.usb');
  const locale = useLocale();
  const q = useScreenUsbEvents(screenId);
  const events = readUsbEvents(q.data);
  // An answer this section cannot read is not "nothing happened": render nothing, never throw.
  if (q.data !== undefined && !events) return null;
  const [latest, ...earlier] = events ?? [];

  return (
    <div className="rounded-xl border border-slate-200 p-3.5" data-testid="screen-usb">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{t('title')}</p>
      {q.isError ? (
        <p className="mt-2 text-[11px] font-semibold text-amber-700" role="status">{t('loadFailed')}</p>
      ) : !events ? (
        <p className="mt-2 text-[11px] font-semibold text-slate-400" aria-busy="true">{t('loading')}</p>
      ) : !latest ? (
        <p className="mt-2 text-[12px] font-semibold text-slate-600" data-testid="screen-usb-none">{t('none')}</p>
      ) : (
        <>
          {(() => {
            const key = usbOutcomeKey(latest.outcome, latest.reason);
            return (
              <p
                className={`mt-2 text-[13px] font-bold leading-snug ${PROBLEM_KEYS.has(key) ? 'text-amber-800' : 'text-slate-800'}`}
                data-testid="screen-usb-latest"
                data-outcome={latest.outcome}
              >
                {t(key, { code: latest.outcome })}
                <span className="ml-1.5 text-[10.5px] font-semibold text-slate-400 tabular-nums">{formatAt(latest.createdAt, locale)}</span>
              </p>
            );
          })()}
          {earlier.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1" data-testid="screen-usb-list">
              {earlier.map((ev) => (
                <li key={ev.id} className="flex items-baseline gap-2 min-w-0" data-outcome={ev.outcome}>
                  <span className="shrink-0 whitespace-nowrap min-w-[92px] text-[10.5px] font-semibold tabular-nums text-slate-400">
                    {formatAt(ev.createdAt, locale)}
                  </span>
                  <span className="min-w-0 text-[11.5px] font-semibold leading-snug break-words text-slate-600">
                    {t(usbOutcomeKey(ev.outcome, ev.reason), { code: ev.outcome })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="mt-2 text-[10.5px] font-semibold text-slate-400 leading-snug">{t('note')}</p>
    </div>
  );
}

export function ScreenUsbSection({ screenId, enabled }: { screenId: string; enabled: boolean }) {
  if (!enabled) return null;
  return (
    <RoleGate allowedRoles={ADMIN_ROLES} fallback={null}>
      <UsbCard screenId={screenId} />
    </RoleGate>
  );
}
