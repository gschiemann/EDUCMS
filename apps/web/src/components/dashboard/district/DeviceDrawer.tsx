"use client";

/**
 * DeviceDrawer — fix one screen without leaving the dashboard (2026-08-31).
 *
 * Operator ask, verbatim: "clicking open on a device that needs attention
 * should take you right into that devices settings, it would be great if you
 * didnt even leave the dashboard so you could knock out all issues right from
 * the main screen."
 *
 * So "Open" no longer switches tenant and navigates — it slides this panel in
 * over the Atlas. The operator can work the whole exception inbox from one
 * page and never lose the map behind them.
 *
 * ── WHAT IT CAN PROVE ────────────────────────────────────────────────
 * Four INDEPENDENT chips, never merged into one health word:
 *   Reachable        — the heartbeat (answering / not answering)
 *   Showing content  — the render-proof verdict (RenderTrustChip)
 *   Content          — is this screen on the published content
 *   Updates          — instant channel, or the ~10s check-in backstop
 * A screen can be reachable, on an instant channel and showing yesterday's
 * content; the whole point of four chips is that none of them can stand in
 * for another.
 *
 * Dashboard surface (not player/widget) → CSS gap is fine here. No
 * backdrop-blur anywhere (mobile standard): a solid scrim reads the same and
 * costs nothing on every repaint of the slide-in.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Clock, CloudOff, Loader2, RefreshCw, Wifi, WifiOff, X } from 'lucide-react';
import { RenderTrustChip } from '@/components/screens/RenderTrustChip';
import { useRefreshWeb, useScreenEvents, useSetScreenOrientation, useUpdateScreen } from '@/hooks/use-api';
import { useTenantSwitch } from '@/hooks/use-tenant-switch';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { eventCopy } from './screenEventCopy';
import { timeAgo } from './ProofDrawer';

/** The fleet-row subset this drawer renders. The caller maps fleet.screens. */
export interface DeviceDrawerScreen {
  id: string;
  name: string;
  status: string;
  renderHealth?: 'OK' | 'STALE' | 'UNKNOWN' | null;
  renderStale?: boolean | null;
  pushChannel?: 'live' | 'stale' | 'unknown' | null;
  lastPingAt?: string | null;
  /** Already graded by the caller — the SAME call the map and table make. */
  contentBehind: boolean;
  /** Outstanding update this screen has not confirmed. */
  pendingRefreshAtMs?: number | null;
  locationName: string;
  locationSlug: string;
  /** The screen's OWN tenant — quick settings write across the fleet window,
   *  and "Screen settings" must switch into this tenant when it isn't the
   *  session's own. */
  locationTenantId: string;
  /** True when the screen lives at a DIFFERENT location than the session —
   *  "Screen settings" then rides the tenant switch instead of a plain link. */
  isRemote?: boolean;
  orientation?: string | null;
}

/** How long "Saved ✓" stands on a quick-setting control. */
const SAVED_CONFIRM_MS = 2500;

/** How long "Sent ✓" stands before the button offers itself again. */
const SENT_CONFIRM_MS = 3000;

function Chip({
  tone, Icon, children,
}: { tone: 'ok' | 'warn' | 'bad' | 'muted'; Icon: typeof Wifi; children: React.ReactNode }) {
  const cls = {
    ok: 'bg-emerald-50 text-emerald-700',
    warn: 'bg-amber-50 text-amber-700',
    bad: 'bg-rose-50 text-rose-700',
    muted: 'bg-slate-100 text-slate-500',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg ${cls}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
      {children}
    </span>
  );
}

export function DeviceDrawer({
  screen,
  onClose,
  onChanged,
}: {
  screen: DeviceDrawerScreen;
  onClose: () => void;
  /** Called after a quick-setting write lands, so the page can re-pull the
   *  fleet payload this drawer renders from. */
  onChanged?: () => void;
}) {
  useOverlayLock(); // mounts only while open — hides the mobile tab bar
  const closeRef = useRef<HTMLButtonElement>(null);
  const refreshWeb = useRefreshWeb();
  const [sent, setSent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const events = useScreenEvents(screen.id);
  const { switchToTenant } = useTenantSwitch();

  // ── Quick settings (2026-08-31 — operator: "cant we add more basic
  // settings right here in this menu so i dont have to go to screens
  // menu?"). The BASICS only: name + orientation. Everything deeper stays
  // on the screens page, one click away via Screen settings.
  const updateScreen = useUpdateScreen();
  const setOrientation = useSetScreenOrientation();
  const [nameDraft, setNameDraft] = useState(screen.name);
  const [nameSaved, setNameSaved] = useState(false);
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Local echo so the segmented control flips instantly; the fleet payload
  // catches up on the onChanged re-pull.
  const [orient, setOrient] = useState((screen.orientation ?? 'LANDSCAPE').toUpperCase());
  useEffect(() => {
    setNameDraft(screen.name);
    setOrient((screen.orientation ?? 'LANDSCAPE').toUpperCase());
  }, [screen.id, screen.name, screen.orientation]);
  useEffect(() => () => { if (nameTimer.current) clearTimeout(nameTimer.current); }, []);

  const nameDirty = nameDraft.trim() !== screen.name && nameDraft.trim().length > 0;
  const saveName = () => {
    if (!nameDirty || updateScreen.isPending) return;
    updateScreen.mutate(
      { id: screen.id, name: nameDraft.trim() },
      {
        onSuccess: () => {
          setNameSaved(true);
          if (nameTimer.current) clearTimeout(nameTimer.current);
          nameTimer.current = setTimeout(() => setNameSaved(false), SAVED_CONFIRM_MS);
          onChanged?.();
        },
      },
    );
  };
  const applyOrientation = (target: 'LANDSCAPE' | 'PORTRAIT' | 'AUTO') => {
    if (target === orient || setOrientation.isPending) return;
    const prev = orient;
    setOrient(target);
    setOrientation.mutate(
      { id: screen.id, orientation: target },
      {
        onSuccess: () => onChanged?.(),
        onError: () => setOrient(prev),
      },
    );
  };

  /** Deep-links straight into THIS screen's settings on the screens page. */
  const settingsHref = `/${screen.locationSlug}/screens?screen=${screen.id}`;

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const online = screen.status === 'ONLINE';
  const push = screen.pushChannel ?? 'unknown';

  const fire = () => {
    refreshWeb.mutate({ screenId: screen.id });
    setSent(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSent(false), SENT_CONFIRM_MS);
  };

  return (
    <div
      className="fixed top-0 right-0 bottom-0 left-0 z-[9999]"
      role="dialog"
      aria-modal="true"
      aria-label={`${screen.name} — device details`}
    >
      <div className="absolute top-0 right-0 bottom-0 left-0 bg-slate-900/40" onClick={onClose} aria-hidden />
      <div className="absolute top-0 right-0 bottom-0 w-full md:w-[420px] bg-white shadow-[0_0_40px_rgba(15,23,42,0.18)] flex flex-col animate-in slide-in-from-right duration-200 will-change-transform">
        {/* ─── Header ────────────────────────────────────────────── */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-200 shrink-0">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p
                className="text-[11px] font-black uppercase tracking-wider truncate"
                style={{ color: 'var(--brand-primary, #4f46e5)' }}
              >
                {screen.locationName}
              </p>
              <h2 className="mt-1 text-[19px] leading-tight font-black text-slate-900 truncate" title={screen.name}>
                {screen.name}
              </h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-9 h-9 -mt-1 -mr-1 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus:ring-2 focus:ring-indigo-300 outline-none shrink-0"
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>

          {/* Four independent truths. None of them stands in for another. */}
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            {online
              ? <Chip tone="ok" Icon={Wifi}>Reachable</Chip>
              : <Chip tone="bad" Icon={WifiOff}>Not answering</Chip>}
            <RenderTrustChip
              status={screen.status}
              renderHealth={screen.renderHealth ?? null}
              renderStale={screen.renderStale ?? null}
            />
            {screen.contentBehind
              ? <Chip tone="warn" Icon={Clock}>Behind on content</Chip>
              : online ? <Chip tone="ok" Icon={CheckCircle2}>Content current</Chip> : null}
            {online && push === 'stale' && <Chip tone="warn" Icon={CloudOff}>Slow updates</Chip>}
            {online && push === 'live' && <Chip tone="ok" Icon={CheckCircle2}>Instant updates</Chip>}
          </div>

          {!online && screen.lastPingAt && (
            <p className="mt-2 text-[12px] font-semibold text-slate-500">
              Last answered {timeAgo(screen.lastPingAt)}.
            </p>
          )}
        </div>

        {/* ─── Actions ───────────────────────────────────────────── */}
        <div className="px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={fire}
              // Held through the confirmation window too: a control reading
              // "Sent ✓" that fires another update on click is a trap.
              disabled={refreshWeb.isPending || sent}
              title="Send this screen the reload command so it picks up the published content."
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12.5px] font-bold text-white disabled:opacity-70"
              style={{ background: sent ? '#059669' : 'var(--brand-primary, #4f46e5)' }}
            >
              {refreshWeb.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" aria-label="Sending" />
                : <RefreshCw className="w-4 h-4" aria-hidden />}
              {sent ? 'Update sent ✓' : 'Resync this screen'}
            </button>
            {screen.isRemote ? (
              // A different location than the session — the screens page
              // there needs its tenant context, so ride the switch.
              <button
                type="button"
                onClick={() => switchToTenant({ id: screen.locationTenantId, slug: screen.locationSlug }, settingsHref)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-[12.5px] font-bold text-slate-600 hover:bg-slate-50"
              >
                Screen settings <ArrowRight className="w-3.5 h-3.5" aria-hidden />
              </button>
            ) : (
              <Link
                href={settingsHref}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-[12.5px] font-bold text-slate-600 hover:bg-slate-50"
              >
                Screen settings <ArrowRight className="w-3.5 h-3.5" aria-hidden />
              </Link>
            )}
          </div>
          <p className="mt-2 text-[11.5px] font-semibold text-slate-400">
            {online
              ? 'The reload command rides both the live connection and the screen’s own check-in, so it lands even when the instant channel is down.'
              : 'This screen isn’t answering, so a reload can’t reach it. Check its power and network at the site — it will pick up everything waiting the moment it comes back.'}
          </p>
        </div>

        {/* ─── Quick settings ────────────────────────────────────── */}
        <div className="px-6 py-4 border-b border-slate-100 shrink-0">
          <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2.5">
            Quick settings
          </h3>
          <label htmlFor="device-drawer-name" className="block text-[11px] font-bold text-slate-500 mb-1">
            Screen name
          </label>
          <div className="flex items-center gap-2">
            <input
              id="device-drawer-name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }}
              className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-200 text-[13px] font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              type="button"
              onClick={saveName}
              disabled={!nameDirty || updateScreen.isPending}
              className="px-3.5 py-2 rounded-lg text-[12px] font-bold text-white disabled:opacity-50"
              style={{ background: nameSaved ? '#059669' : 'var(--brand-primary, #4f46e5)' }}
            >
              {updateScreen.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label="Saving" />
                : nameSaved ? 'Saved ✓' : 'Save'}
            </button>
          </div>

          <p className="mt-3 mb-1 text-[11px] font-bold text-slate-500" id="device-drawer-orientation-label">
            Orientation
          </p>
          <div
            role="group"
            aria-labelledby="device-drawer-orientation-label"
            className="inline-flex rounded-lg border border-slate-200 overflow-hidden"
          >
            {([
              ['LANDSCAPE', 'Landscape'],
              ['PORTRAIT', 'Portrait'],
              ['AUTO', 'Auto'],
            ] as const).map(([value, label]) => {
              const active = orient === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  disabled={setOrientation.isPending}
                  onClick={() => applyOrientation(value)}
                  className={`px-3.5 py-1.5 text-[12px] font-bold border-r border-slate-200 last:border-r-0 disabled:opacity-60 ${active ? 'text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  style={active ? { background: 'var(--brand-primary, #4f46e5)' } : undefined}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] font-semibold text-slate-400">
            A panel can’t tell it was mounted sideways — Portrait must be set here. Applies on the screen within seconds.
          </p>
        </div>

        {/* ─── What happened ─────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
            What happened
          </h3>
          {events.isLoading ? (
            <Loader2 className="w-4 h-4 text-slate-300 animate-spin" aria-label="Loading recent activity" />
          ) : events.isError ? (
            // NEVER CRY WOLF, in the quiet direction too: a read that failed
            // is not evidence that nothing happened. Saying "nothing recorded"
            // here would be the drawer inventing a clean history.
            <p className="text-[12.5px] font-semibold text-amber-700">
              Couldn&rsquo;t load this screen&rsquo;s history just now.
            </p>
          ) : events.data?.events?.length ? (
            <ul className="space-y-2">
              {events.data.events.map((ev) => (
                <li key={ev.id} className="flex items-baseline gap-2 text-[12.5px]">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0 translate-y-[-2px]"
                    style={{ background: 'var(--brand-primary, #4f46e5)' }}
                    aria-hidden
                  />
                  <span className="font-semibold text-slate-700 flex-1 min-w-0">{eventCopy(ev.kind)}</span>
                  <span className="text-slate-400 shrink-0 text-[11.5px] font-semibold">{timeAgo(ev.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] font-semibold text-slate-400">
              Nothing recorded for this screen yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
