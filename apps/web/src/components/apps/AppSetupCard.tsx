"use client";

/**
 * AppSetupCard — what an app zone that still needs its link / account looks
 * like ON THE CANVAS (builder only; never rendered on a screen).
 *
 * 2026-10-12 (owner): "an app zone that is not configured shows a clear
 * 'Set up <App>' state on the canvas (button that opens the same setup)
 * instead of an empty box." The button selects the zone (the builder's
 * selection subscription opens Properties on it) AND focuses the app's first
 * field — selecting an already-selected zone changed nothing on screen, which
 * is what "i click setup and nothing happens" was (2026-10-12).
 */
import { useTranslations } from 'next-intl';
import { AppIcon } from './ConciergeAppSuggestions';
import { BRAND_COLORS } from './brand-icons';
import { openAppSetup } from './app-zone';

export function AppSetupCard({ zoneId, appId, appName, icon }: { zoneId: string; appId: string; appName: string; icon: string }) {
  const t = useTranslations('builderApps');
  const tint = BRAND_COLORS[appId];
  return (
    <div
      data-app-setup-card={appId}
      className="flex flex-col items-center justify-center text-center rounded-[inherit] border-2 border-dashed border-indigo-300 bg-indigo-50/90 px-3 py-2 overflow-hidden"
      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
    >
      <span style={tint ? { color: tint } : undefined} className={tint ? '' : 'text-indigo-500'}>
        <AppIcon appId={appId} name={icon} className="w-8 h-8" />
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openAppSetup(zoneId);
        }}
        className="mt-2 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        {t('setUpApp', { app: appName })}
      </button>
      <p className="mt-1 text-[11px] text-indigo-700/80 leading-snug max-w-[24ch]">{t('setUpHint')}</p>
    </div>
  );
}
