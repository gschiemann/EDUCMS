'use client';

/**
 * ScreenDisplayControls — the per-screen display panel inside the gear
 * popover on /[schoolId]/screens.
 *
 * It replaces the "More coming soon — restart, orientation, cache clear."
 * footer stub that sat here since Sprint 11. Per CLAUDE.md §20, a stub is
 * not allowed to become a button that lies; so every control below is
 * gated on what THIS screen's probe actually reported
 * (see ./display-capabilities.ts for the resolver + the reasoning).
 *
 * The four honesty rules this component implements:
 *  1. No verdict yet → no controls at all, just an explainer. "Not
 *     reported" is never rendered as "unsupported" (tri-state discipline,
 *     copied from the APK-push row's upToDate === null branch).
 *  2. `brightness: software-dim` still gets a slider — the player's
 *     SoftwareDimProvider genuinely works — but the copy says out loud
 *     that it dims the image, not the backlight, so the panel keeps
 *     drawing full power. Same for `screenBlank: none`.
 *  3. `volume: none` / `reboot: none` have NO software floor, so no
 *     control renders. Reboot additionally explains WHY (the probe's
 *     deviceOwnerPath) instead of silently vanishing.
 *  4. We show what we SENT, never a fabricated device state. There is no
 *     "Blanking…" progress bar, because nothing on the wire tells us the
 *     panel went dark.
 *
 * Safety: brightness is floored at MIN_SAFE_BRIGHTNESS (a remote 0% on a
 * screen nobody can reach is a truck roll) and BLANK always carries a
 * dead-man revert so a forgotten click can't strand a screen dark. A
 * permanent nightly off is the schedule editor's job, not this button's.
 */

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Volume2,
  VolumeX,
  Sun,
  MonitorOff,
  Monitor,
  Power,
  CalendarClock,
  Info,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { appConfirm, appPrompt } from '@/components/ui/app-dialog';
import { useDisplayControl, type DisplayActionType } from '@/hooks/use-api';
import {
  resolveDisplayControls,
  clampBrightness,
  clampVolume,
  MIN_SAFE_BRIGHTNESS,
  BLANK_AUTO_WAKE_MS,
} from './display-capabilities';

/** The literal the operator must type to confirm a remote reboot. */
const REBOOT_TOKEN = 'REBOOT';

function ago(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/**
 * Slider row. `reported` is the device's own last-known level when the API
 * echoes one; when it doesn't, the readout shows "—" rather than parking
 * the thumb somewhere and implying that's where the hardware is.
 */
function LevelRow({
  icon,
  label,
  note,
  min,
  reported,
  disabled,
  onCommit,
  accentClass,
}: {
  icon: React.ReactNode;
  label: string;
  note: string | null;
  min: number;
  reported: number | null;
  disabled: boolean;
  onCommit: (percent: number) => void;
  accentClass: string;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const lastSent = useRef<number | null>(null);
  const shown = draft ?? reported ?? Math.max(min, 50);

  const commit = () => {
    if (draft === null) return;
    if (lastSent.current === draft) return;
    lastSent.current = draft;
    onCommit(draft);
  };

  return (
    <div className="px-3.5 py-2.5 border-t border-slate-100">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
          {icon}
          {label}
        </span>
        <span className="text-[10px] font-mono text-slate-500 tabular-nums">
          {draft !== null
            ? `${draft}% · sent`
            : reported !== null
              ? `${reported}%`
              : '—'}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={100}
        step={1}
        value={shown}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => setDraft(Number(e.target.value))}
        // stopPropagation mirrors the LED-canvas buttons a few rows up:
        // the popover closes on a document-level pointerdown, and a drag
        // that starts on this thumb must never be mistaken for one.
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        onBlur={commit}
        className={`w-full mt-1.5 ${accentClass} disabled:opacity-40 disabled:cursor-not-allowed`}
      />
      {note && <p className="text-[10px] text-slate-400 leading-snug mt-1">{note}</p>}
    </div>
  );
}

/**
 * The slice of the screen row this panel reads. Structural, so the page's
 * loosely-typed `screen` object still satisfies it — but narrow enough that
 * a rename on the API side shows up here as a type error instead of a
 * silently-undefined capability (which would render as "not reported").
 */
export interface DisplayControlScreen {
  id: string;
  name?: string | null;
  /** Last probe verdict — Prisma Json, so genuinely unknown until parsed. */
  displayCapabilities?: unknown;
  displayCapabilitiesAt?: string | null;
  /** Device-echoed levels, when the API has them. Absent = unknown. */
  displayState?: { volumePercent?: number; brightnessPercent?: number } | null;
}

export function ScreenDisplayControls({
  screen,
  readOnly,
  onOpenSchedule,
}: {
  screen: DisplayControlScreen;
  /** RESTRICTED_VIEWER — read-only, every control inert. */
  readOnly?: boolean;
  /** Opens the schedule modal (the parent closes the popover first). */
  onOpenSchedule: () => void;
}) {
  const t = useTranslations();
  const control = useDisplayControl();
  const caps = resolveDisplayControls(screen?.displayCapabilities);
  const reportedAt = ago(screen?.displayCapabilitiesAt);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  // Which action is in flight — the shared mutation's isPending can't tell
  // Blank from Wake, and a spinner on the wrong button is its own small lie.
  const [busy, setBusy] = useState<DisplayActionType | null>(null);

  // Device-echoed levels when the API provides them; otherwise unknown.
  const ds = screen?.displayState ?? null;
  const reportedVolume = typeof ds?.volumePercent === 'number' ? ds.volumePercent : null;
  const reportedBrightness =
    typeof ds?.brightnessPercent === 'number' ? ds.brightnessPercent : null;

  const send = async (
    action: DisplayActionType,
    opts: { percent?: number; revertAfterMs?: number; okMsg: string },
  ) => {
    setBusy(action);
    setStatus(null);
    try {
      await control.mutateAsync({
        screenId: screen.id,
        action,
        percent: opts.percent,
        revertAfterMs: opts.revertAfterMs,
      });
      setStatus({ ok: true, msg: opts.okMsg });
    } catch (e) {
      setStatus({
        ok: false,
        msg: (e instanceof Error && e.message) || t('screens.display.sendFailed'),
      });
    } finally {
      setBusy(null);
    }
  };

  const confirmReboot = async () => {
    const ok = await appConfirm({
      title: t('screens.display.rebootConfirmTitle'),
      message: t('screens.display.rebootConfirmBody', { name: screen?.name ?? '' }),
      tone: 'danger',
      confirmLabel: t('screens.display.rebootContinue'),
    });
    if (!ok) return;
    const typed = await appPrompt({
      title: t('screens.display.rebootTypeTitle', { token: REBOOT_TOKEN }),
      message: t('screens.display.rebootTypeBody', { token: REBOOT_TOKEN }),
      placeholder: REBOOT_TOKEN,
    });
    if (typed?.trim().toUpperCase() !== REBOOT_TOKEN) return;
    await send('reboot', { okMsg: t('screens.display.rebootSent') });
  };

  const header = (
    <div className="px-3.5 pt-3 pb-1 flex items-baseline justify-between gap-2 border-t border-slate-100">
      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
        {t('screens.display.title')}
      </span>
      {reportedAt && (
        <span className="text-[9px] text-slate-400">
          {t('screens.display.checkedAgo', { ago: reportedAt })}
        </span>
      )}
    </div>
  );

  // ── Nothing reported: explainer only. No control may be guessed at. ──
  if (!caps.reported) {
    return (
      <div className="bg-slate-50/60">
        {header}
        <div className="px-3.5 pb-3 pt-1 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-slate-500 leading-snug">
            {t('screens.display.notReported')}
          </p>
        </div>
      </div>
    );
  }

  const disabled = !!readOnly;

  return (
    <div className="bg-slate-50/60">
      {header}

      {/* ── Volume ─────────────────────────────────────────────── */}
      {caps.volume.available ? (
        <LevelRow
          icon={<Volume2 className="w-3.5 h-3.5 text-slate-400" />}
          label={t('screens.display.volume')}
          note={caps.volume.noteKey ? t(caps.volume.noteKey) : null}
          min={0}
          reported={reportedVolume}
          disabled={disabled || busy !== null}
          accentClass="accent-indigo-600"
          onCommit={(p) =>
            send('volume', {
              percent: clampVolume(p),
              okMsg: t('screens.display.volumeSent', { percent: clampVolume(p) }),
            })
          }
        />
      ) : (
        caps.volume.noteKey && (
          <div className="px-3.5 py-2.5 border-t border-slate-100 flex items-start gap-2">
            <VolumeX className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-slate-400">
                {t('screens.display.volume')}
              </div>
              <p className="text-[10px] text-slate-400 leading-snug">{t(caps.volume.noteKey)}</p>
            </div>
          </div>
        )
      )}

      {/* ── Brightness ─────────────────────────────────────────── */}
      {caps.brightness.available && (
        <LevelRow
          icon={<Sun className="w-3.5 h-3.5 text-slate-400" />}
          label={
            caps.brightness.softwareOnly
              ? t('screens.display.brightnessSoftwareLabel')
              : t('screens.display.brightness')
          }
          note={caps.brightness.noteKey ? t(caps.brightness.noteKey) : null}
          min={MIN_SAFE_BRIGHTNESS}
          reported={reportedBrightness}
          disabled={disabled || busy !== null}
          accentClass="accent-amber-500"
          onCommit={(p) =>
            send('brightness', {
              percent: clampBrightness(p),
              okMsg: t('screens.display.brightnessSent', { percent: clampBrightness(p) }),
            })
          }
        />
      )}

      {/* ── Blank / Wake ───────────────────────────────────────── */}
      {caps.blank.available && (
        <div className="px-3.5 py-2.5 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled || busy !== null}
              onClick={(e) => {
                e.stopPropagation();
                send('blank', {
                  revertAfterMs: BLANK_AUTO_WAKE_MS,
                  okMsg: t('screens.display.blankSent', {
                    minutes: Math.round(BLANK_AUTO_WAKE_MS / 60_000),
                  }),
                });
              }}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy === 'blank' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <MonitorOff className="w-3.5 h-3.5" />
              )}
              {t('screens.display.blank')}
            </button>
            <button
              type="button"
              disabled={disabled || busy !== null}
              onClick={(e) => {
                e.stopPropagation();
                send('wake', { okMsg: t('screens.display.wakeSent') });
              }}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy === 'wake' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Monitor className="w-3.5 h-3.5" />
              )}
              {t('screens.display.wake')}
            </button>
          </div>
          <p className="text-[10px] text-slate-400 leading-snug mt-1">
            {caps.blank.noteKey ? t(caps.blank.noteKey) : ''}{' '}
            {t('screens.display.blankAutoWake', {
              minutes: Math.round(BLANK_AUTO_WAKE_MS / 60_000),
            })}
          </p>
        </div>
      )}

      {/* ── Reboot ─────────────────────────────────────────────── */}
      {caps.reboot.available ? (
        <div className="px-3.5 py-2.5 border-t border-slate-100">
          <button
            type="button"
            disabled={disabled || busy !== null}
            onClick={(e) => {
              e.stopPropagation();
              void confirmReboot();
            }}
            // Fixed rose, not brand color: a destructive control must read
            // as danger on a tenant whose brand primary happens to be mint.
            className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-rose-200 bg-white text-[11px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy === 'reboot' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Power className="w-3.5 h-3.5" />
            )}
            {t('screens.display.reboot')}
          </button>
          <p className="text-[10px] text-slate-400 leading-snug mt-1">
            {t('screens.display.rebootHint')}
          </p>
        </div>
      ) : (
        // reboot: 'none' — per the spec there is NO button here at all. The
        // line below is text, and it tells the operator what would unlock it
        // instead of leaving a silent hole where a control used to be.
        caps.reboot.noteKey && (
          <div className="px-3.5 py-2.5 border-t border-slate-100 flex items-start gap-2">
            <Power className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-slate-400">
                {t('screens.display.reboot')}
              </div>
              <p className="text-[10px] text-slate-400 leading-snug">{t(caps.reboot.noteKey)}</p>
            </div>
          </div>
        )
      )}

      {/* ── On/off schedule ────────────────────────────────────── */}
      <button
        type="button"
        onClick={onOpenSchedule}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left text-xs font-semibold text-slate-700 hover:bg-white border-t border-slate-100 transition-colors"
      >
        <CalendarClock className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block">{t('screens.display.scheduleRow')}</span>
          <span className="block text-[10px] font-normal text-slate-400 mt-0.5">
            {t('screens.display.scheduleRowSub')}
          </span>
        </span>
      </button>

      {/* Result of the last command. "Sent" — not "done": the wire tells us
          the API accepted it, nothing more. */}
      {status && (
        <div
          className={`px-3.5 py-2 flex items-start gap-1.5 text-[10px] leading-snug border-t ${
            status.ok
              ? 'text-emerald-700 bg-emerald-50/60 border-emerald-100'
              : 'text-rose-700 bg-rose-50/60 border-rose-100'
          }`}
          role="status"
        >
          {status.ok ? (
            <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          )}
          <span className="min-w-0">{status.msg}</span>
        </div>
      )}
    </div>
  );
}
