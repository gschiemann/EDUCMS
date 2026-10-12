"use client";

/**
 * AppZoneSetup — the app's own setup form, in PROPERTIES, for an app zone.
 *
 * 2026-10-12 (owner): an app lands on the canvas the moment its tile is
 * clicked or dropped (app-zone.ts), and "the app's setup opens immediately in
 * PROPERTIES — 'Paste your YouTube link', 'Connect Instagram'…". A zone still
 * waiting for its link gets the form open; a finished one gets a one-line
 * "Change link or account" that re-opens it with what was typed filled in.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Settings2 } from 'lucide-react';
import type { Zone } from '@/components/template-builder/types';
import { AppConfigForm } from './AppConfigForm';
import { AppIcon } from './ConciergeAppSuggestions';
import { appZoneInfo, removeAppZone } from './app-zone';

export function AppZoneSetup({ zone }: { zone: Zone }) {
  const t = useTranslations('builderApps');
  const info = appZoneInfo(zone);
  const [open, setOpen] = useState(false);
  if (!info) return null;
  const { app, pending, values } = info;

  if (pending || open) {
    return (
      <AppConfigForm
        app={app}
        zoneId={zone.id}
        embedded
        initialValues={values}
        cancelLabel={pending ? t('removeApp') : t('cancel')}
        onBack={() => (pending ? removeAppZone(zone.id) : setOpen(false))}
        onDone={() => setOpen(false)}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      data-app-change={app.id}
      className="w-full flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
    >
      <span className="shrink-0 text-indigo-500"><AppIcon appId={app.id} name={app.icon} className="w-5 h-5" /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-bold text-slate-700 truncate">{app.name}</span>
        <span className="block text-[11px] text-slate-500 truncate">{t('changeSetup')}</span>
      </span>
      <Settings2 className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
    </button>
  );
}
