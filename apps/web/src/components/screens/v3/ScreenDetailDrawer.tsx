"use client";

/**
 * ScreenDetailDrawer — the v3 detail surface (handoff §10).
 *
 * The list finds the problem; THIS explains the evidence and offers the
 * safest next action. Three tabs only — Overview / Actions / History — and
 * every deeper diagnostic lives inside one of them rather than becoming a
 * fourth, fifth and sixth top-level tab.
 *
 * ── What it will and will not claim (§15) ────────────────────────────
 *   • "Reported content" is what the PLAYER said. It is never dressed up as
 *     a capture, and the Expected thumbnail is always labelled as expected.
 *   • The evidence chain has THREE steps. "Downloaded" is absent because no
 *     per-deployment download milestone exists to prove it.
 *   • "Physical display" is permanently gray: nothing is watching the panel.
 *   • The recovery card only appears while a real command is outstanding,
 *     and no timer can promote it to success.
 *
 * Dashboard surface (not player/widget), so CSS gap is fine. No backdrop
 * blur anywhere — a solid scrim reads the same and costs nothing on every
 * repaint of the slide-in (mobile-perf standard).
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, CircleDashed, Clock,
  ExternalLink, Loader2, Minus, RefreshCw, Settings2, Trash2, Wifi, WifiOff, X,
} from 'lucide-react';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import {
  useDeleteScreen, useForceApkUpdate, useRefreshWeb, useScreenEvents,
  useScreenDeviceInventory, useSetScreenOrientation, useUpdateScreen,
} from '@/hooks/use-api';
import { eventCopy } from '@/components/dashboard/district/screenEventCopy';
import { appConfirm } from '@/components/ui/app-dialog';
import {
  compactAge, deriveEvidenceChain, deriveRecovery, msOf, wordyAge,
  type EvidenceStep, type OpsRow,
} from './screenOps';

/**
 * The two heaviest panels in the drawer, and the ONLY two an operator has to
 * ask for: they live on the Actions tab, behind a click, and between them they
 * carry the ~1.8k-line display-capability world. Loading them on demand keeps
 * them out of every operator's first paint of the Screens page — and, because
 * the classic page imports the same modules, keeps ONE copy of them in the
 * build instead of one per route chunk (the bundle ratchet reads total bytes).
 */
const ScreenDisplayControls = dynamic(
  () => import('@/components/screens/ScreenDisplayControls').then((m) => m.ScreenDisplayControls),
  { ssr: false, loading: () => <div className="h-24 bg-slate-50 animate-pulse" /> },
);
const ScreenSetupSection = dynamic(
  () => import('@/components/screens/ScreenSetupSection').then((m) => m.ScreenSetupSection),
  { ssr: false, loading: () => null },
);

/** How long "Request sent ✓" stands before the button offers itself again. */
const SENT_CONFIRM_MS = 3000;
/** How long "Saved ✓" stands on a quick-setting control. */
const SAVED_CONFIRM_MS = 2500;

export type DrawerTab = 'overview' | 'actions' | 'history';

const TABS: Array<{ key: DrawerTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'actions', label: 'Actions' },
  { key: 'history', label: 'History' },
];

function toneClasses(tone: string) {
  switch (tone) {
    case 'bad':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'warn':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'ok':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'neutral':
      return 'bg-sky-50 text-sky-700 border-sky-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function EvidenceDot({ state }: { state: EvidenceStep['state'] }) {
  if (state === 'ok') {
    return (
      <span className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
        <CheckCircle2 className="w-4 h-4" aria-hidden />
      </span>
    );
  }
  if (state === 'pending') {
    return (
      <span className="w-7 h-7 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0">
        <Clock className="w-4 h-4" aria-hidden />
      </span>
    );
  }
  if (state === 'not-instrumented') {
    return (
      <span className="w-7 h-7 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center shrink-0">
        <Minus className="w-4 h-4" aria-hidden />
      </span>
    );
  }
  return (
    <span className="w-7 h-7 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center shrink-0">
      <CircleDashed className="w-4 h-4" aria-hidden />
    </span>
  );
}

function SectionLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-400">{children}</h3>
      {hint && <p className="text-[11px] font-semibold text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

export interface ScreenDetailDrawerProps {
  row: OpsRow;
  /** Name of the group / place this screen sits in — the header's second half. */
  placeName: string;
  /** Player preview URL for this screen (built by the page — it holds the token). */
  previewHref: string;
  /** The signed-in role may drive commands. */
  canControl: boolean;
  /** RESTRICTED_VIEWER — every write control inert. */
  readOnly: boolean;
  /** Groups this screen can be moved between. */
  groups: Array<{ id: string; name: string }>;
  now: number;
  initialTab?: DrawerTab;
  onClose: () => void;
  /** Re-pull the fleet payload after a write lands. */
  onChanged?: () => void;
  /** Opens the classic per-screen settings popover for this screen. */
  onOpenFullSettings: () => void;
  /** Opens the on/off schedule editor (the page owns the modal). */
  onOpenDisplaySchedule: () => void;
}

export function ScreenDetailDrawer({
  row, placeName, previewHref, canControl, readOnly, groups, now,
  initialTab = 'overview', onClose, onChanged, onOpenFullSettings, onOpenDisplaySchedule,
}: ScreenDetailDrawerProps) {
  useOverlayLock(); // mounts only while open — hides the mobile tab bar
  const { screen, status, expected, reported } = row;
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const refreshWeb = useRefreshWeb();
  const updateScreen = useUpdateScreen();
  const setOrientation = useSetScreenOrientation();
  const forceApk = useForceApkUpdate();
  const deleteScreen = useDeleteScreen();
  const events = useScreenEvents(screen.id);
  // Only while the Actions tab is showing — the setup section is the sole
  // reader, and a dormant query costs nothing (mobile-perf: no new poller).
  const inventory = useScreenDeviceInventory(screen.id, tab === 'actions');

  const [sent, setSent] = useState(false);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [nameDraft, setNameDraft] = useState(screen.name ?? '');
  const [nameSaved, setNameSaved] = useState(false);
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [orient, setOrient] = useState((screen.orientation ?? 'LANDSCAPE').toUpperCase());
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, screen.id]);
  useEffect(() => {
    setNameDraft(screen.name ?? '');
    setOrient((screen.orientation ?? 'LANDSCAPE').toUpperCase());
  }, [screen.id, screen.name, screen.orientation]);
  useEffect(
    () => () => {
      if (sentTimer.current) clearTimeout(sentTimer.current);
      if (nameTimer.current) clearTimeout(nameTimer.current);
    },
    [],
  );

  // ── Focus: trap inside, restore on close (§14) ────────────────────
  useEffect(() => {
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    closeRef.current?.focus();
    return () => {
      // Restoring focus to a node React has since unmounted throws; guard it.
      const el = restoreRef.current;
      if (el && document.body.contains(el)) el.focus();
    };
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = panelRef.current;
      if (!root) return;
      const focusables = [...root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  /** ARIA tabs pattern: arrow keys move between tabs (§14). */
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.key === tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
      setTab(TABS[next].key);
      // Move real focus with the selection — the pattern is manual-activation
      // free here because selection and focus stay together.
      const root = panelRef.current;
      root?.querySelector<HTMLElement>(`#screen-tab-${TABS[next].key}`)?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setTab(TABS[0].key);
    } else if (e.key === 'End') {
      e.preventDefault();
      setTab(TABS[TABS.length - 1].key);
    }
  };

  const online = screen.status === 'ONLINE';
  const evidence = useMemo(() => deriveEvidenceChain(screen, status, now), [screen, status, now]);
  const ackedAtMs = useMemo(() => {
    const ev = events.data?.events?.find((e) => e.kind === 'refresh-acked');
    return ev ? msOf(ev.createdAt) : null;
  }, [events.data]);
  const recovery = deriveRecovery({
    screen, status, sending: refreshWeb.isPending, justSent: sent, ackedAtMs, now,
  });

  const fireResync = () => {
    if (readOnly || refreshWeb.isPending || sent) return;
    refreshWeb.mutate(
      { screenId: screen.id },
      {
        onSuccess: () => {
          setAnnouncement('Resync request sent. Waiting for this screen to confirm it.');
          onChanged?.();
        },
        onError: (e: any) => setAnnouncement(`Couldn’t send the resync: ${e?.message || 'unknown error'}`),
      },
    );
    setSent(true);
    if (sentTimer.current) clearTimeout(sentTimer.current);
    sentTimer.current = setTimeout(() => setSent(false), SENT_CONFIRM_MS);
  };

  const nameDirty = nameDraft.trim() !== (screen.name ?? '') && nameDraft.trim().length > 0;
  const saveName = () => {
    if (!nameDirty || updateScreen.isPending || readOnly) return;
    updateScreen.mutate(
      { id: screen.id, name: nameDraft.trim() },
      {
        onSuccess: () => {
          setNameSaved(true);
          setAnnouncement('Screen renamed.');
          if (nameTimer.current) clearTimeout(nameTimer.current);
          nameTimer.current = setTimeout(() => setNameSaved(false), SAVED_CONFIRM_MS);
          onChanged?.();
        },
      },
    );
  };

  const applyOrientation = (target: 'LANDSCAPE' | 'PORTRAIT' | 'AUTO') => {
    if (target === orient || setOrientation.isPending || readOnly) return;
    const prev = orient;
    setOrient(target);
    setOrientation.mutate(
      { id: screen.id, orientation: target },
      { onSuccess: () => { setAnnouncement(`Orientation set to ${target.toLowerCase()}.`); onChanged?.(); },
        onError: () => setOrient(prev) },
    );
  };

  const moveToGroup = (groupId: string) => {
    if (readOnly) return;
    updateScreen.mutate(
      { id: screen.id, screenGroupId: groupId || null } as any,
      { onSuccess: () => { setAnnouncement('Group updated.'); onChanged?.(); } },
    );
  };

  const removeScreen = async () => {
    const ok = await appConfirm({
      title: `Remove “${screen.name ?? 'this screen'}”?`,
      message:
        'The screen stops receiving content and disappears from this list. The device keeps running until it is unplugged; pair it again to bring it back.',
      confirmLabel: 'Remove screen',
      tone: 'danger',
    });
    if (!ok) return;
    deleteScreen.mutate(screen.id, {
      onSuccess: () => { setAnnouncement('Screen removed.'); onChanged?.(); onClose(); },
    });
  };

  const isBrowserPlayer =
    !(screen.osInfo || '').toLowerCase().includes('android') &&
    (screen.hardwareModel ?? '') !== 'generic-android';

  return (
    <div className="fixed top-0 right-0 bottom-0 left-0 z-[9999]" onKeyDown={onKeyDown}>
      <div className="absolute top-0 right-0 bottom-0 left-0 bg-slate-900/40" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute top-0 right-0 bottom-0 w-full sm:w-[420px] lg:w-[436px] bg-white shadow-[0_0_40px_rgba(15,23,42,0.18)] flex flex-col animate-in slide-in-from-right duration-200 motion-reduce:animate-none will-change-transform"
      >
        {/* ─── Header ──────────────────────────────────────────── */}
        <div className="px-5 pt-4 pb-3 border-b border-slate-200 shrink-0">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[17px] leading-tight font-black text-slate-900 truncate">
                {screen.name || 'Unnamed screen'}
                <span className="text-slate-400 font-bold"> · {placeName}</span>
              </h2>
              <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-bold">
                {online ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden />
                    <span className="text-emerald-700">Online</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-slate-400" aria-hidden />
                    <span className="text-slate-500">
                      {screen.status === 'PENDING' ? 'Checking' : 'Offline'}
                      {screen.lastPingAt ? ` · last answered ${compactAge(msOf(screen.lastPingAt), now) ?? '—'} ago` : ''}
                    </span>
                  </>
                )}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close details"
              className="w-11 h-11 -mt-2 -mr-2 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus:ring-2 focus:ring-indigo-300 outline-none shrink-0"
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>

          {/* Dominant issue banner — connectivity stays separate above it so
              "online but wrong content" is legible at a glance (§10). */}
          {status.needsAttention && (
            <div className={`mt-3 rounded-xl border px-3 py-2 flex items-start gap-2 ${toneClasses(status.tone)}`}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
              <p className="text-[12.5px] font-bold min-w-0">
                {status.label}
                {status.age ? ` · ${wordyAge(
                  status.key === 'offline' ? msOf(screen.lastPingAt)
                    : status.key === 'content-behind' ? msOf(screen.pendingRefreshAt)
                      : status.key === 'push-delayed' ? msOf(screen.lastPushConnectedAt)
                        : msOf(screen.lastRenderedAt),
                  now,
                ) ?? status.age}` : ''}
              </p>
            </div>
          )}
        </div>

        {/* ─── Tabs ────────────────────────────────────────────── */}
        <div role="tablist" aria-label="Screen details" onKeyDown={onTabKeyDown}
          className="px-5 flex gap-6 border-b border-slate-200 shrink-0">
          {TABS.map((tb) => {
            const active = tab === tb.key;
            return (
              <button
                key={tb.key}
                id={`screen-tab-${tb.key}`}
                role="tab"
                type="button"
                aria-selected={active}
                aria-controls={`screen-panel-${tb.key}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(tb.key)}
                className={`relative py-2.5 text-[13px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 rounded-sm ${
                  active ? '' : 'text-slate-400 hover:text-slate-600'
                }`}
                style={active ? { color: 'var(--brand-primary, #4f46e5)' } : undefined}
              >
                {tb.label}
                {active && (
                  <span
                    className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full"
                    style={{ background: 'var(--brand-primary, #4f46e5)' }}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* ─── Scrolling body ──────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {/* ── OVERVIEW ───────────────────────────────────────── */}
          {tab === 'overview' && (
            <div id="screen-panel-overview" role="tabpanel" aria-labelledby="screen-tab-overview" className="p-5 space-y-5">
              {/* Expected vs REPORTED CONTENT — never "on screen" (§10). */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Expected</p>
                  <p className="mt-1 text-[13px] font-bold text-slate-800 leading-snug break-words">
                    {expected.name ?? 'Nothing scheduled'}
                  </p>
                  {expected.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={expected.thumbnailUrl}
                      alt={`First slide of ${expected.name ?? 'the scheduled content'}`}
                      className="mt-2 w-full aspect-video object-cover rounded-lg bg-slate-100"
                    />
                  ) : (
                    <div className="mt-2 w-full aspect-video rounded-lg bg-slate-100 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-slate-400">No preview image</span>
                    </div>
                  )}
                  <p className="mt-1.5 text-[10.5px] font-semibold text-slate-400 leading-snug">
                    {expected.name
                      ? `What you scheduled${expected.viaGroup ? ' for this group' : ''}${expected.windowClosed ? ' — outside its time window right now' : ''}.`
                      : 'No playlist is scheduled for this screen.'}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Reported content</p>
                  <p
                    className={`mt-1 text-[13px] font-bold leading-snug ${
                      reported.state === 'confirmed' ? 'text-emerald-700'
                        : reported.state === 'behind' ? 'text-rose-700' : 'text-slate-500'
                    }`}
                  >
                    {reported.line}
                  </p>
                  <div className="mt-2 w-full aspect-video rounded-lg bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center px-2 text-center">
                    <span className="text-[10px] font-bold text-slate-400 leading-tight">
                      No picture from the device
                    </span>
                  </div>
                  <p className="mt-1.5 text-[10.5px] font-semibold text-slate-400 leading-snug">
                    {reported.detail}
                  </p>
                </div>
              </div>
              <p className="text-[11px] font-semibold text-slate-400 -mt-2">
                This is what the player told us it is running — not a picture of the panel.
              </p>

              {/* Evidence chain — Sent → Rendered → Physical display. */}
              <div className="rounded-xl border border-slate-200 p-3.5">
                <SectionLabel>How far the update got</SectionLabel>
                <ol className="flex items-start">
                  {evidence.map((step, i) => (
                    <li key={step.key} className="flex-1 min-w-0 flex flex-col items-center text-center">
                      <div className="flex items-center w-full">
                        <span className={`h-0.5 flex-1 ${i === 0 ? 'bg-transparent' : evidence[i - 1].state === 'ok' ? 'bg-emerald-300' : 'bg-slate-200'}`} aria-hidden />
                        <EvidenceDot state={step.state} />
                        <span className={`h-0.5 flex-1 ${i === evidence.length - 1 ? 'bg-transparent' : step.state === 'ok' ? 'bg-emerald-300' : 'bg-slate-200'}`} aria-hidden />
                      </div>
                      <p className="mt-1.5 text-[11px] font-bold text-slate-700 leading-tight">{step.label}</p>
                      {step.state === 'not-instrumented' && (
                        <p className="text-[10px] font-bold text-slate-400">Not instrumented</p>
                      )}
                    </li>
                  ))}
                </ol>
                <ul className="mt-3 space-y-1">
                  {evidence.map((step) => (
                    <li key={step.key} className="text-[11px] font-semibold text-slate-500 leading-snug">
                      <span className="text-slate-700">{step.label}:</span> {step.note}
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 pt-2.5 border-t border-slate-100 text-[11px] font-semibold text-slate-400 leading-snug">
                  Software render evidence only · Physical display not verified. There is no separate
                  download step: this player does not report one, so we do not draw one.
                </p>
              </div>

              {/* Recovery — only while something is genuinely in flight. */}
              {recovery && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex items-start gap-3">
                  {recovery.state === 'recovered' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden />
                  ) : (
                    <Loader2
                      className="w-5 h-5 shrink-0 animate-spin motion-reduce:animate-none"
                      style={{ color: 'var(--brand-primary, #4f46e5)' }}
                      aria-hidden
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-slate-800">{recovery.heading}</p>
                    <p className="text-[11.5px] font-semibold text-slate-500 leading-snug mt-0.5">{recovery.body}</p>
                  </div>
                </div>
              )}

              {!status.needsAttention && (
                <p className="text-[12px] font-semibold text-slate-500 leading-snug">{status.detail}</p>
              )}
            </div>
          )}

          {/* ── ACTIONS ────────────────────────────────────────── */}
          {tab === 'actions' && (
            <div id="screen-panel-actions" role="tabpanel" aria-labelledby="screen-tab-actions" className="p-5 space-y-6">
              <section>
                <SectionLabel hint="Nothing here interrupts what is on the screen.">Safe</SectionLabel>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={fireResync}
                    disabled={readOnly || refreshWeb.isPending || sent}
                    className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border border-slate-200 text-left text-[13px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <RefreshCw className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                    <span className="flex-1 min-w-0">
                      {sent ? 'Request sent ✓' : 'Resync content'}
                      <span className="block text-[11px] font-semibold text-slate-400 mt-0.5">
                        Tells this screen to pick up the published content.
                      </span>
                    </span>
                  </button>
                  <a
                    href={previewHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border border-slate-200 text-left text-[13px] font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                    <span className="flex-1 min-w-0">
                      Open live preview
                      <span className="block text-[11px] font-semibold text-slate-400 mt-0.5">
                        Opens this screen’s player in a browser tab.
                      </span>
                    </span>
                  </a>
                </div>
              </section>

              <section>
                <SectionLabel hint="Changes what this screen does, reversibly.">Configuration</SectionLabel>
                <label htmlFor="v3-drawer-name" className="block text-[11px] font-bold text-slate-500 mb-1">
                  Screen name
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="v3-drawer-name"
                    value={nameDraft}
                    disabled={readOnly}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }}
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-200 text-[13px] font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={saveName}
                    disabled={!nameDirty || updateScreen.isPending || readOnly}
                    className="px-3.5 py-2 rounded-lg text-[12px] font-bold text-white disabled:opacity-50 min-w-[68px]"
                    style={{ background: nameSaved ? '#059669' : 'var(--brand-primary, #4f46e5)' }}
                  >
                    {updateScreen.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" aria-label="Saving" />
                      : nameSaved ? 'Saved ✓' : 'Save'}
                  </button>
                </div>

                <p className="mt-3 mb-1 text-[11px] font-bold text-slate-500" id="v3-drawer-orientation">Orientation</p>
                <div role="group" aria-labelledby="v3-drawer-orientation" className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                  {(['LANDSCAPE', 'PORTRAIT', 'AUTO'] as const).map((value) => {
                    const active = orient === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={active}
                        disabled={setOrientation.isPending || readOnly}
                        onClick={() => applyOrientation(value)}
                        className={`px-3.5 py-1.5 text-[12px] font-bold border-r border-slate-200 last:border-r-0 disabled:opacity-60 ${active ? 'text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                        style={active ? { background: 'var(--brand-primary, #4f46e5)' } : undefined}
                      >
                        {value.charAt(0) + value.slice(1).toLowerCase()}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] font-semibold text-slate-400 leading-snug">
                  A panel can’t tell it was mounted sideways — Portrait must be set here.
                </p>

                <label htmlFor="v3-drawer-group" className="block mt-3 mb-1 text-[11px] font-bold text-slate-500">
                  Group
                </label>
                <select
                  id="v3-drawer-group"
                  value={screen.screenGroupId ?? ''}
                  disabled={readOnly}
                  onChange={(e) => moveToGroup(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60 bg-white"
                >
                  <option value="">Not in a group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={onOpenFullSettings}
                  className="mt-3 w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border border-slate-200 text-left text-[13px] font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Settings2 className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                  <span className="flex-1 min-w-0">
                    Full settings
                    <span className="block text-[11px] font-semibold text-slate-400 mt-0.5">
                      LED canvas, console profile, sync trim, hardware and device details.
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" aria-hidden />
                </button>

                <button
                  type="button"
                  onClick={() => forceApk.mutate({ screenId: screen.id })}
                  disabled={readOnly || forceApk.isPending}
                  className="mt-2 w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border border-slate-200 text-left text-[13px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                  <span className="flex-1 min-w-0">
                    Push app update
                    <span className="block text-[11px] font-semibold text-slate-400 mt-0.5">
                      Tells this device to install the latest player app on its next check-in.
                    </span>
                  </span>
                </button>
              </section>

              {/* Display & power — includes the Restart control, which keeps
                  its own typed-confirm ceremony inside this component. */}
              <section>
                <SectionLabel hint="Restart lives here and asks you to type REBOOT first.">
                  Display &amp; power
                </SectionLabel>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <ScreenDisplayControls
                    screen={screen as any}
                    readOnly={!canControl}
                    browserPlayer={isBrowserPlayer}
                    onOpenSchedule={onOpenDisplaySchedule}
                  />
                </div>
              </section>

              <ScreenSetupSection
                screen={screen as any}
                inventoryReport={(inventory.data as any)?.report ?? null}
                readOnly={!canControl}
              />

              <section>
                <SectionLabel hint="These interrupt the screen or remove it. Each asks first.">
                  Disruptive
                </SectionLabel>
                <button
                  type="button"
                  onClick={removeScreen}
                  disabled={readOnly || deleteScreen.isPending}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border border-rose-200 text-left text-[13px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                >
                  <Trash2 className="w-4 h-4 shrink-0" aria-hidden />
                  <span className="flex-1 min-w-0">
                    Remove screen
                    <span className="block text-[11px] font-semibold text-rose-400 mt-0.5">
                      Stops content and unpairs it from this location.
                    </span>
                  </span>
                </button>
              </section>
            </div>
          )}

          {/* ── HISTORY ────────────────────────────────────────── */}
          {tab === 'history' && (
            <div id="screen-panel-history" role="tabpanel" aria-labelledby="screen-tab-history" className="p-5">
              <SectionLabel hint="Plain-language record of what happened to this screen.">
                What happened
              </SectionLabel>
              {events.isLoading ? (
                <Loader2 className="w-4 h-4 text-slate-300 animate-spin" aria-label="Loading recent activity" />
              ) : events.isError ? (
                // A read that failed is NOT evidence that nothing happened.
                <p className="text-[12.5px] font-semibold text-amber-700">
                  Couldn’t load this screen’s history just now.
                </p>
              ) : events.data?.events?.length ? (
                <ul className="space-y-2.5">
                  {events.data.events.map((ev) => (
                    <li key={ev.id} className="flex items-baseline gap-2 text-[12.5px]">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0 translate-y-[-2px]"
                        style={{ background: 'var(--brand-primary, #4f46e5)' }}
                        aria-hidden
                      />
                      <span className="font-semibold text-slate-700 flex-1 min-w-0">{eventCopy(ev.kind)}</span>
                      <span className="text-slate-400 shrink-0 text-[11.5px] font-semibold">
                        {compactAge(msOf(ev.createdAt), now) ?? ''} ago
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] font-semibold text-slate-400">
                  Nothing recorded for this screen yet.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ─── Sticky bottom actions ───────────────────────────── */}
        <div className="px-5 py-3.5 border-t border-slate-200 shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={fireResync}
            disabled={readOnly || refreshWeb.isPending || sent}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold text-white disabled:opacity-70"
            style={{ background: sent ? '#059669' : 'var(--brand-primary, #4f46e5)' }}
          >
            {refreshWeb.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" aria-label="Sending" />
              : <RefreshCw className="w-4 h-4" aria-hidden />}
            {sent ? 'Request sent ✓' : 'Resync content'}
          </button>
          <a
            href={previewHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 text-[13px] font-bold text-slate-600 hover:bg-slate-50"
          >
            Open live preview
          </a>
        </div>

        {!online && (
          <p className="px-5 pb-3 -mt-1 text-[11px] font-semibold text-slate-400 leading-snug">
            This screen isn’t answering, so a resync can’t land right now. It collects everything
            waiting the moment it reconnects.
          </p>
        )}

        <p aria-live="polite" className="sr-only">{announcement}</p>
      </div>
    </div>
  );
}
