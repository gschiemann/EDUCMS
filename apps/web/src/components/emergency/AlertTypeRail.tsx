'use client';

import { useTranslations } from 'next-intl';
import { ContextModule, StatusPill } from '@/components/settings/shell';
import type { PanicKind } from '@/hooks/use-api';
import type { ReadinessReport } from './EmergencyReadinessCard';

/**
 * Readiness BY ALERT TYPE — read from the SAME readiness report the summary
 * card grades (Muse beta DEV-002, 2026-10-07). It used to run its own twelve
 * `panic-content` queries and count items while the summary counted playlist
 * ids, so the page said "wired" and "No content" about the same type. Now one
 * source: `contentByType` (live items, landscape + portrait). Drill content
 * is listed on its OWN line below — never mixed into the live verdict.
 */
export function AlertTypeRail({
  report,
  loading,
  kinds,
}: {
  report?: ReadinessReport;
  loading: boolean;
  kinds: readonly PanicKind[];
}) {
  const t = useTranslations();
  const byType = report?.contentByType;
  const drill = report?.drillContent;
  return (
    <>
      <ContextModule label={t('settings.cc.emergency.rail.byType')}>
        <ul className="mt-1 space-y-1.5">
          {kinds.map((kind) => {
            const row = byType?.find((c) => c.kind === kind);
            return (
              <li key={kind} className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-slate-600">{t(`settings.cc.emergency.types.${kind}.label`)}</span>
                {row ? (
                  <StatusPill
                    kind={row.liveItems > 0 ? 'ready' : 'notConfigured'}
                    label={
                      row.liveItems > 0
                        ? t('settings.cc.emergency.rail.typeConfigured')
                        : t('settings.cc.emergency.rail.typeNotConfigured')
                    }
                  />
                ) : (
                  <StatusPill
                    kind="unknown"
                    label={loading ? t('settings.cc.emergency.rail.typeChecking') : t('settings.cc.emergency.rail.typeUnknown')}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </ContextModule>
      {drill && (
        <ContextModule
          label={t('settings.cc.emergency.rail.drillContent')}
          title={t('settings.cc.emergency.rail.drillContentCount', {
            count: drill.typesWithDrillContent,
            total: drill.typesTotal,
          })}
        >
          {t('settings.cc.emergency.rail.drillContentBody')}
        </ContextModule>
      )}
    </>
  );
}
