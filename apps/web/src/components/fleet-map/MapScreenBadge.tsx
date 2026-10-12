'use client';

/**
 * One screen's map state as a small icon + label (2026-10-12). Both maps draw
 * their screen lists with this, from `gradeMapScreen`, so a screen reads the
 * same word on the organisation map and on the Screens map.
 */
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, MonitorX, RefreshCw } from 'lucide-react';
import type { MapScreenGrade, MapScreenState } from '@/components/dashboard/district/fleetCommand';

export const MAP_STATE_STYLE: Record<MapScreenState, { cls: string; Icon: typeof CheckCircle2 }> = {
  offline: { cls: 'text-rose-600', Icon: MonitorX },
  'no-picture': { cls: 'text-rose-600', Icon: MonitorX },
  behind: { cls: 'text-amber-600', Icon: AlertCircle },
  syncing: { cls: 'text-slate-500', Icon: RefreshCw },
  playing: { cls: 'text-emerald-600', Icon: CheckCircle2 },
  unconfirmed: { cls: 'text-slate-500', Icon: AlertCircle },
};

/** The label alone, for callers that lay out their own tile. */
export function useMapStateLabel() {
  const t = useTranslations('fleetMap');
  return (grade: MapScreenGrade) => ({
    label: t(`tile.${grade.state}`),
    /** Calm, self-healing note for a screen on the previous web player. */
    note: grade.state === 'playing' && grade.appUpdating ? t('tileAppUpdating') : null,
    ...MAP_STATE_STYLE[grade.state],
  });
}
