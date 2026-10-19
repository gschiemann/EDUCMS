"use client";

/**
 * ScreenInterruptionsSection — "Interruptions, last 24 h / 72 h" (2026-10-18,
 * player rock-solid plan §4B / §7).
 *
 * The launch gate reads "interruptions per launch screen, 72 h = 0
 * (emergency drills excluded)" off the interruption ledger
 * (`GET /screens/:id/events?hours=24|72`). This section shows that number for
 * one screen — always as a line, "0 in 72 h" included — and the rows behind
 * it: when, what, and why in plain words. Rows that do not count (a hardware
 * video session starting, an update downloading, an alert ending, any
 * emergency drill) are listed too, marked "not counted", so the number is
 * never a mystery.
 *
 * Copy states what the evidence proves (Player Reliability rule 10): a reload
 * VenueOS or a person ASKED for says so ("asked by VenueOS", "sent from the
 * dashboard"); the ledger is the screen's own reports and our records, never
 * a view of the glass. Admins only (the API allows admins; others see nothing
 * rather than an error). Fetched when the Overview is open — never polled
 * (mobile-perf standard). Dashboard surface, so CSS gap is fine.
 */

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useScreenInterruptions, type ScreenInterruptionsResponse } from '@/hooks/use-api';
import { RoleGate } from '@/components/RoleGate';

const ADMIN_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'];

type LedgerEvent = ScreenInterruptionsResponse['events'][number];

/** The message key naming what happened. Unknown kinds still get an honest line. */
export function interruptionKindKey(ev: Pick<LedgerEvent, 'kind' | 'drill'>): string {
  switch (ev.kind) {
    case 'page-reload': return 'kindPageReload';
    case 'app-relaunch': return 'kindAppRelaunch';
    case 'engine-start': return 'kindEngineStart';
    case 'engine-stop': return 'kindEngineStop';
    case 'engine-swap': return 'kindEngineSwap';
    case 'rendition-swap': return 'kindRenditionSwap';
    case 'demotion': return 'kindDemotion';
    case 'ota-download': return 'kindOtaDownload';
    case 'ota-install': return 'kindOtaInstall';
    case 'ota-installed': return 'kindOtaInstalled';
    case 'ota-needs-tap': return 'kindOtaNeedsTap';
    case 'ota-failed': return 'kindOtaFailed';
    case 'emergency-start': return ev.drill ? 'kindDrillStart' : 'kindEmergencyStart';
    case 'emergency-clear': return ev.drill ? 'kindDrillClear' : 'kindEmergencyClear';
    default: return 'kindOther';
  }
}

/** Why the hardware video engine stopped — the APK's own reason codes. */
const STOP_REASON_KEYS: Record<string, string> = {
  'activity-paused': 'stopActivityPaused',
  'content-changed': 'stopContentChanged',
  'emergency-held': 'stopEmergencyHeld',
  'output-stalled': 'stopOutputStalled',
  'process-ended': 'stopProcessEnded',
  'device-rebooted': 'stopDeviceRebooted',
  'page-stopped': 'stopPageStopped',
  'host-detached': 'stopHostDetached',
  'document-retired': 'stopDocumentRetired',
  'credential-changed': 'stopCredentialChanged',
  'page-lease-expired': 'stopPageLeaseExpired',
  'engine-switched': 'stopEngineSwitched',
  'peer-stopped': 'stopPeerStopped',
  failed: 'stopFailed',
};

const CAUSE_KEYS: Record<string, Record<string, string>> = {
  'page-reload': {
    operator: 'causeOperator',
    'wedge-detector': 'causeWedgeDetector',
    'server-displacement': 'causeServerDisplacement',
    'bundle-apply': 'causeBundleApply',
  },
  'app-relaunch': {
    reboot: 'causeReboot',
    'process-restart': 'causeProcessRestart',
    'update-install': 'causeUpdateInstall',
    'boot-diagnostic': 'causeBootDiagnostic',
  },
  'engine-swap': { 'web-to-native': 'causeWebToNative', 'native-to-web': 'causeNativeToWeb' },
  'rendition-swap': { 'demotion-cleared': 'causeDemotionCleared' },
  demotion: { 'visible-stutter': 'causeVisibleStutter' },
  'ota-installed': { 'version-change': 'causeVersionChange', 'push-satisfied': 'causePushSatisfied' },
  'ota-failed': { relaunch_blocked: 'causeRelaunchBlocked', error: 'causeOtaError' },
  'emergency-start': {
    lockdown: 'typeLockdown',
    evacuate: 'typeEvacuate',
    hold: 'typeHold',
    secure: 'typeSecure',
    weather: 'typeWeather',
    medical: 'typeMedical',
    custom: 'typeCustom',
    alert: 'typeAlert',
  },
};

/**
 * The plain-words cause: a message key and its values, or null when the
 * kind already says it all (an update downloading, a session starting, an
 * alert ending).
 */
export function interruptionCause(
  ev: Pick<LedgerEvent, 'kind' | 'cause' | 'detail'>,
): { key: string; values?: Record<string, string> } | null {
  const cause = ev.cause ?? '';
  if (ev.kind === 'page-reload' && cause === 'operator') {
    const publish = !!ev.detail && typeof ev.detail === 'object' && (ev.detail as Record<string, unknown>).publish === true;
    return { key: publish ? 'causeOperatorPublish' : 'causeOperator' };
  }
  if (ev.kind === 'engine-stop') {
    const key = STOP_REASON_KEYS[cause];
    return key ? { key } : cause ? { key: 'stopUnknown', values: { code: cause } } : null;
  }
  if (ev.kind === 'ota-failed' && /^failed_/.test(cause)) {
    return { key: 'causeOtaFailedCode', values: { code: cause.toUpperCase() } };
  }
  const key = CAUSE_KEYS[ev.kind]?.[cause];
  return key ? { key } : null;
}

const isEvent = (e: unknown): e is LedgerEvent => {
  if (!e || typeof e !== 'object') return false;
  const v = e as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.kind === 'string' && typeof v.at === 'string' && Number.isFinite(Date.parse(v.at));
};

/**
 * The answer as this section can read it, or null. Anything else — a list, a
 * timeline-only `{ events }` from an older API, a missing summary — is null,
 * and the section then renders nothing rather than throwing inside the drawer.
 */
export function readInterruptions(body: unknown): ScreenInterruptionsResponse | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const summary = b.summary as Record<string, unknown> | null | undefined;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  if (typeof summary.interruptions !== 'number' || !Number.isFinite(summary.interruptions)) return null;
  if (typeof summary.drills !== 'number' || !Number.isFinite(summary.drills)) return null;
  if (!Array.isArray(b.events)) return null;
  return {
    screenId: typeof b.screenId === 'string' ? b.screenId : '',
    hours: typeof b.hours === 'number' ? b.hours : 0,
    since: typeof b.since === 'string' ? b.since : '',
    summary: {
      interruptions: Math.max(0, Math.floor(summary.interruptions)),
      drills: Math.max(0, Math.floor(summary.drills)),
      byKind: summary.byKind && typeof summary.byKind === 'object' ? (summary.byKind as Record<string, number>) : {},
    },
    events: b.events.filter(isEvent),
    truncated: b.truncated === true,
  };
}

function formatAt(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function InterruptionsCard({ screenId }: { screenId: string }) {
  const t = useTranslations('screens.interruptions');
  const locale = useLocale();
  const [hours, setHours] = useState<24 | 72>(24);
  const q = useScreenInterruptions(screenId, hours);
  const data = readInterruptions(q.data);
  // An answer this section cannot read is not "0": render nothing, never throw.
  if (q.data !== undefined && !data) return null;

  return (
    <div className="rounded-xl border border-slate-200 p-3.5" data-testid="screen-interruptions" data-hours={hours}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{t('title', { hours })}</p>
        <div role="group" aria-label={t('windowLabel')} className="inline-flex rounded-md border border-slate-200 overflow-hidden">
          {([24, 72] as const).map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={hours === h}
              onClick={() => setHours(h)}
              className={`min-h-[28px] px-2 text-[10.5px] font-bold ${
                hours === h ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
              data-testid={`screen-interruptions-window-${h}`}
            >
              {t(h === 24 ? 'window24' : 'window72')}
            </button>
          ))}
        </div>
      </div>

      {q.isError ? (
        <p className="mt-2 text-[11px] font-semibold text-amber-700" role="status">{t('loadFailed')}</p>
      ) : !data ? (
        <p className="mt-2 text-[11px] font-semibold text-slate-400" aria-busy="true">{t('loading')}</p>
      ) : (
        <>
          <p
            className={`mt-2 text-[13px] font-bold leading-snug ${data.summary.interruptions > 0 ? 'text-amber-800' : 'text-slate-800'}`}
            data-testid="screen-interruptions-count"
            data-count={data.summary.interruptions}
          >
            {t('count', { count: data.summary.interruptions, hours })}
          </p>
          {data.summary.drills > 0 && (
            <p className="mt-0.5 text-[10.5px] font-semibold text-slate-500 leading-snug" data-testid="screen-interruptions-drills">
              {t('drills', { count: data.summary.drills })}
            </p>
          )}
          {data.events.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5" data-testid="screen-interruptions-list">
              {data.events.map((ev) => {
                const cause = interruptionCause(ev);
                return (
                  <li
                    key={ev.id}
                    className="flex items-baseline gap-2 min-w-0"
                    data-kind={ev.kind}
                    data-counted={ev.interruption ? 'true' : 'false'}
                  >
                    <span className="shrink-0 whitespace-nowrap min-w-[92px] text-[10.5px] font-semibold tabular-nums text-slate-400">
                      {formatAt(ev.at, locale)}
                    </span>
                    <span className="min-w-0">
                      <span className={`text-[11.5px] font-semibold leading-snug break-words ${ev.interruption ? 'text-slate-800' : 'text-slate-500'}`}>
                        {t(interruptionKindKey(ev))}
                      </span>
                      {cause && (
                        <span className="text-[10.5px] font-semibold text-slate-500 leading-snug break-words">
                          {' — '}{t(cause.key, cause.values)}
                        </span>
                      )}
                      {!ev.interruption && (
                        <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-px text-[9.5px] font-bold text-slate-500">
                          {t('notCounted')}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {data.truncated && (
            <p className="mt-1 text-[10.5px] font-semibold text-slate-400">{t('truncated', { count: data.events.length })}</p>
          )}
        </>
      )}
      <p className="mt-2 text-[10.5px] font-semibold text-slate-400 leading-snug">{t('note')}</p>
    </div>
  );
}

export function ScreenInterruptionsSection({ screenId, enabled }: { screenId: string; enabled: boolean }) {
  if (!enabled) return null;
  return (
    <RoleGate allowedRoles={ADMIN_ROLES} fallback={null}>
      <InterruptionsCard screenId={screenId} />
    </RoleGate>
  );
}
