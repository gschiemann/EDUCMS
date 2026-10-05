"use client";

/**
 * "Send to: All screens (24) · Choose screens" — the one line that says where
 * an emergency alert will go (alert targeting, 2026-10-05).
 *
 * The default needs no tap: it reads "All screens", which is what every
 * trigger has always done. "Choose screens" is secondary on purpose; once a
 * group or screen is chosen the line names it, and a one-tap control puts it
 * back to All screens. Used by /panic and the dashboard trigger modal (both
 * always-dark surfaces).
 */

import { useTranslations } from 'next-intl';
import { MonitorSmartphone, Users, X } from 'lucide-react';
import { isAllScreens, targetChipLabel, type EmergencyTarget } from '@/lib/emergency-target';

export interface EmergencyTargetBarProps {
  target: EmergencyTarget;
  onChoose: () => void;
  onReset: () => void;
  disabled?: boolean;
}

export function EmergencyTargetBar({ target, onChoose, onReset, disabled }: EmergencyTargetBarProps) {
  const t = useTranslations();
  const all = isAllScreens(target);
  const Icon = target.scopeType === 'group' ? Users : MonitorSmartphone;
  return (
    <div
      className="flex items-center gap-2 rounded-2xl border px-3 py-2 min-h-[56px]"
      style={{
        background: all ? 'rgba(255,255,255,0.03)' : 'rgba(239,68,68,0.12)',
        borderColor: all ? 'rgba(255,255,255,0.10)' : 'rgba(248,113,113,0.70)',
      }}
      data-testid="emergency-target-bar"
    >
      <Icon className="w-5 h-5 shrink-0 text-white/70" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">
          {t('emergency.target.sendTo')}
        </div>
        <div className="text-sm font-bold text-white truncate" data-testid="emergency-target-label">
          {targetChipLabel(t, target)}
        </div>
      </div>
      <button
        type="button"
        onClick={onChoose}
        disabled={disabled}
        className="shrink-0 min-h-[44px] px-3 rounded-xl bg-white/[0.06] border border-white/15 text-xs font-bold text-white/90 hover:bg-white/[0.12] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        data-testid="emergency-choose-screens"
      >
        {all ? t('emergency.target.chooseScreens') : t('emergency.target.change')}
      </button>
      {!all && (
        <button
          type="button"
          onClick={onReset}
          disabled={disabled}
          aria-label={t('emergency.target.resetToAll')}
          title={t('emergency.target.resetToAll')}
          className="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-xl text-white/75 hover:text-white hover:bg-white/10 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          data-testid="emergency-target-reset"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
