"use client";

/**
 * LIVE | DRILL — the one switch on every trigger surface (2026-10-10).
 *
 * Owner's ask: "an easy switch in the web and mobile app to flip between drill
 * and live emergency." The lead's rule on top of it, which this component is
 * built around: it DEFAULTS TO LIVE EVERY TIME the surface opens and is never
 * persisted. The value lives in the parent's `useState(DEFAULT_EMERGENCY_MODE)`
 * — not in a store, not in localStorage, not in the URL — so a real lockdown
 * can never go out as a drill because someone left a toggle on yesterday.
 *
 * Big, obvious, two segments; DRILL is indigo (never red), LIVE is red. The
 * hint under it states in words what the next alert will be.
 *
 * Dark-surface styling (the trigger modal and /panic are always dark).
 * Taurus-safe for free: this never ships to a player.
 */
import { useTranslations } from 'next-intl';
import { ShieldAlert, FlaskConical } from 'lucide-react';
import type { EmergencyMode } from '@/lib/emergency-target';

interface Props {
  mode: EmergencyMode;
  onChange: (mode: EmergencyMode) => void;
  disabled?: boolean;
  /** Compact variant for the phone header. */
  size?: 'default' | 'compact';
}

export function LiveDrillSwitch({ mode, onChange, disabled, size = 'default' }: Props) {
  const t = useTranslations();
  const compact = size === 'compact';
  const seg = (value: EmergencyMode, Icon: typeof ShieldAlert, label: string, accent: string, rgb: string) => {
    const on = mode === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        data-testid={`emergency-mode-${value}`}
        data-state={on ? 'on' : 'off'}
        disabled={disabled}
        onClick={() => onChange(value)}
        className={`flex-1 min-w-0 flex items-center justify-center font-black uppercase tracking-[0.18em] rounded-xl transition-all outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50 ${
          compact ? 'min-h-[40px] text-[11px] px-2' : 'min-h-[52px] text-sm px-4'
        }`}
        style={{
          background: on ? `linear-gradient(160deg, ${accent} 0%, rgba(${rgb},0.75) 100%)` : 'transparent',
          color: on ? '#ffffff' : 'rgba(255,255,255,0.55)',
          boxShadow: on ? `0 0 22px rgba(${rgb},0.45)` : 'none',
        }}
      >
        <Icon className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} shrink-0`} aria-hidden />
        <span className="ml-2 truncate">{label}</span>
      </button>
    );
  };
  return (
    <div data-testid="emergency-mode-switch" data-mode={mode} className="w-full">
      <div
        role="radiogroup"
        aria-label={t('emergency.drill.switchLabel')}
        className={`flex w-full rounded-2xl border p-1 ${compact ? '' : 'gap-1'}`}
        style={{
          borderColor: mode === 'drill' ? 'rgba(129,140,248,0.6)' : 'rgba(255,255,255,0.14)',
          background: 'rgba(0,0,0,0.35)',
        }}
      >
        {seg('live', ShieldAlert, t('emergency.drill.live'), '#ef4444', '239,68,68')}
        {seg('drill', FlaskConical, t('emergency.drill.drill'), '#4f46e5', '99,102,241')}
      </div>
      {!compact && (
        <p
          className="mt-1.5 text-[11px] leading-snug"
          data-testid="emergency-mode-hint"
          style={{ color: mode === 'drill' ? '#c7d2fe' : 'rgba(255,255,255,0.6)' }}
        >
          {mode === 'drill' ? t('emergency.drill.drillHint') : t('emergency.drill.liveHint')}
        </p>
      )}
    </div>
  );
}
