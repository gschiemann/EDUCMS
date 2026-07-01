"use client";

/**
 * AppConfigForm — per-app config form + live preview + confirm.
 *
 * Renders generic fields from `app.configSchema`, builds a live zone config
 * on every keystroke via `app.build(values)`, and shows that config through
 * the SAME WidgetPreview component the canvas itself uses — so "what you
 * see in this form" and "what lands on the canvas" cannot drift apart.
 *
 * Confirm calls the identical addZone + updateZone sequence
 * VariantPicker.handlePick uses (apps/web/src/components/template-builder/
 * VariantPicker.tsx), so an Apps-added zone is a completely normal zone to
 * the rest of the builder — undo/redo, Properties panel, layers, save.
 *
 * World-class build (2026-07-01, see docs/research/2026-06-30-app-library/
 * 20-WORLDCLASS-BUILD-PLAN.md Tier 1): accepts `initialValues` for the
 * paste-first handoff, renders the WEBPAGE preview LIVE (debounced) instead
 * of a fake mockup, shows a numbered setup checklist instead of one prose
 * paragraph, and threads a smart `defaultSize` into addZone so an app
 * doesn't land as the same generic 40x30 box every time.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ExternalLink, AlertTriangle, Loader2 } from 'lucide-react';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';
import { useBuilderStore } from '@/components/template-builder/useBuilderStore';
import { useTenant } from '@/hooks/use-api';
import type { AppDefinition, AppFieldSchema } from './app-registry';

function defaultValues(app: AppDefinition, initialValues?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of app.configSchema) {
    if (f.defaultValue !== undefined) out[f.key] = String(f.defaultValue);
  }
  // Paste-first handoff (AppLibraryPanel's detectApp match) and Concierge
  // seed values win over the schema's static defaults.
  if (initialValues) Object.assign(out, initialValues);
  return out;
}

// Smart-placement fallback for apps that don't set an explicit
// `defaultSize` in the registry — keyed by widgetType so it still applies
// sanely to any future app built on top of an existing widget. Lives here
// (not in useBuilderStore.addZone) because it's an App Library concern only
// — the plain Widgets palette / drag-drop path never passes a `size` at
// all, so this can never regress that unrelated flow.
const WIDGET_TYPE_DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  STREAMING: { w: 60, h: 45 },
  WEBPAGE: { w: 60, h: 55 },
  WEATHER: { w: 28, h: 22 },
  CLOCK: { w: 28, h: 22 },
  COUNTDOWN: { w: 28, h: 22 },
};

const URL_DEBOUNCE_MS = 600;

function isValidHttpsUrl(u: string): boolean {
  if (!u) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function AppConfigForm({
  app, onBack, onDone, initialValues,
}: {
  app: AppDefinition;
  onBack: () => void;
  onDone: () => void;
  /** Seed values from the paste-first detector or a Concierge suggestion —
   *  merged over the schema's own defaults so e.g. a pasted YouTube link
   *  arrives already in the `url` field and "Add to canvas" is instantly
   *  live (required field already satisfied). */
  initialValues?: Record<string, string>;
}) {
  const addZone = useBuilderStore((s) => s.addZone);
  const updateZone = useBuilderStore((s) => s.updateZone);
  const select = useBuilderStore((s) => s.select);

  const [values, setValues] = useState<Record<string, string>>(() => defaultValues(app, initialValues));
  const [touched, setTouched] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // a11y — focus the form heading on open so a keyboard/SR user's reading
  // position isn't orphaned on a card that just unmounted (2026-07-01
  // discovery/mobile/a11y workstream).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const setField = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  // Cheap Concierge seed (zero-typing) — Weather's `location` and Maps'
  // `query` are literally already on file from onboarding (Tenant.address).
  // Only fills an EMPTY field the operator hasn't touched yet — never
  // clobbers a paste-first prefill or anything they've already typed.
  const { data: tenant } = useTenant() as { data?: { address?: string | null } };
  const tenantAddress = tenant?.address ?? undefined;
  useEffect(() => {
    if (!tenantAddress) return;
    if (app.id === 'weather' && !values.location?.trim()) {
      setField('location', tenantAddress);
    } else if (app.id === 'google-maps' && !values.query?.trim()) {
      setField('query', tenantAddress);
    }
    // Only re-run if the tenant address or the target app changes — not on
    // every keystroke (setField intentionally omitted from deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id, tenantAddress]);

  const built = useMemo(() => {
    try {
      return app.build(values);
    } catch {
      // build() must not throw per the registry contract, but a config form
      // is exactly the kind of place a defensive catch earns its keep —
      // a bad regex match on partial operator input should never crash the
      // whole panel mid-typing.
      return { widgetType: app.configSchema.length ? 'WEBPAGE' : 'WEBPAGE', defaultConfig: {} };
    }
  }, [app, values]);

  // Live-preview truthfulness — for WEBPAGE-backed apps (Slides, Sheets,
  // Canva, PowerPoint, Maps, Calendar, Web URL) the config-form preview used
  // to always render a FAKE browser mockup ("Web content will load here"),
  // never the operator's actual page. Debounce so we don't hammer the
  // SSRF-guarded proxy on every keystroke — only fire once the built URL is
  // a real https URL and has settled for URL_DEBOUNCE_MS.
  const builtUrl = built.defaultConfig.url;
  const previewUrl: string = built.widgetType === 'WEBPAGE' && typeof builtUrl === 'string' ? builtUrl : '';
  const [debouncedPreviewUrl, setDebouncedPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    if (built.widgetType !== 'WEBPAGE') { setDebouncedPreviewUrl(''); setPreviewLoading(false); return; }
    if (!isValidHttpsUrl(previewUrl)) { setDebouncedPreviewUrl(''); setPreviewLoading(false); return; }
    setPreviewLoading(true);
    const t = setTimeout(() => {
      setDebouncedPreviewUrl(previewUrl);
      setPreviewLoading(false);
    }, URL_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [previewUrl, built.widgetType]);

  const showLiveWebpagePreview = built.widgetType === 'WEBPAGE' && !!debouncedPreviewUrl;
  // STREAMING (YouTube/Vimeo/Twitch) already renders a real iframe at
  // live=false too (IframeStream only gates autoplay on `live`), so it's
  // truthful without any of this — only WEBPAGE needed the live flag.
  const previewLive = built.widgetType === 'WEBPAGE' ? showLiveWebpagePreview : false;

  const requiredFields = app.configSchema.filter((f) => f.required);
  const missingRequired = requiredFields.filter((f) => !values[f.key]?.trim());
  const canConfirm = !app.comingSoon && missingRequired.length === 0;
  const firstMissingLabel = missingRequired[0]?.label;

  const handleConfirm = () => {
    if (!canConfirm) { setTouched(true); return; }
    const size = app.defaultSize ?? WIDGET_TYPE_DEFAULT_SIZE[built.widgetType];
    const id = addZone(built.widgetType, undefined, size);
    updateZone(id, { defaultConfig: built.defaultConfig });
    // Keep the new zone selected (addZone already does this) and make sure
    // it's the one the operator's eyes land on — post-add focus-race fix
    // (placement-post-add workstream): ONE deterministic outcome instead of
    // a panel-reset racing an implicit properties-switch. Selecting here
    // again (cheap no-op if unchanged) plus onDone() closing the Apps form
    // is what hands off to BuilderShell's selection-subscription, which
    // switches to Properties — the operator lands directly on the field
    // editor for what they just added.
    select(id);
    onDone();
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 shrink-0 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="p-1 rounded hover:bg-slate-100 text-slate-500"
          aria-label="Back to Apps"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden />
        </button>
        <h2 ref={headingRef} tabIndex={-1} className="text-sm font-bold text-slate-800 truncate flex-1 focus:outline-none">{app.name}</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Live preview — same WidgetPreview the canvas renders, so this is
            a truthful preview, not a mockup that can drift from reality.
            For WEBPAGE apps this now renders the operator's ACTUAL page
            (through the SSRF-guarded proxy) once the URL is valid, instead
            of a fake browser-chrome placeholder. */}
        <div className="p-3 border-b border-slate-100 bg-slate-50/60">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Live preview</div>
          <div className="relative w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-900" style={{ aspectRatio: '16 / 9' }}>
            {built.widgetType === 'WEBPAGE' && !isValidHttpsUrl(previewUrl) ? (
              <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center text-center px-4">
                <p className="text-[11px] text-slate-400">Paste a link above to preview it here.</p>
              </div>
            ) : built.widgetType === 'WEBPAGE' && previewLoading ? (
              <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center gap-1.5 text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                <span className="text-[11px]">Loading preview…</span>
              </div>
            ) : (
              <WidgetPreview
                key={built.widgetType === 'WEBPAGE' ? debouncedPreviewUrl : app.id}
                widgetType={built.widgetType}
                config={built.widgetType === 'WEBPAGE' ? { ...built.defaultConfig, url: debouncedPreviewUrl || previewUrl } : built.defaultConfig}
                width={100}
                height={100}
                live={previewLive}
              />
            )}
          </div>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-xs text-slate-500 leading-snug">{app.blurb}</p>

          {app.comingSoon ? (
            <div className="flex gap-2 items-start text-[11px] text-violet-800 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2.5 leading-snug">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
              <span>
                This app isn’t buildable as a reliable standalone integration in 2026 — the network’s free embed
                either shut down or requires a paid aggregator. It’s listed here for visibility; it’ll light up
                when the Social Wall / aggregator integration ships. Nothing will be added to your canvas from
                this screen.
              </span>
            </div>
          ) : (
            <>
              {app.setupSteps && app.setupSteps.length > 0 ? (
                <div className="text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                  <ol className="list-decimal list-inside space-y-1 text-[11px] leading-snug">
                    {app.setupSteps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                  {app.helpUrl && (
                    <a
                      href={app.helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700"
                    >
                      Open it now <ExternalLink className="w-3 h-3" aria-hidden />
                    </a>
                  )}
                </div>
              ) : app.setupNote ? (
                <div className="text-[11px] text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 leading-snug">
                  {app.setupNote}
                </div>
              ) : null}

              {app.publicExposureWarning && (
                <div className="flex gap-2 items-start text-[11px] text-amber-800 bg-amber-50/70 border border-amber-200 rounded-lg px-3 py-2 leading-snug">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
                  <span>{app.publicExposureWarning}</span>
                </div>
              )}

              {app.configSchema.map((field) => (
                <AppField
                  key={field.key}
                  field={field}
                  value={values[field.key] ?? ''}
                  onChange={(v) => setField(field.key, v)}
                  showError={!!(touched && field.required && !values[field.key]?.trim())}
                />
              ))}

              {app.taurusNote && (
                <p className="text-[10px] text-slate-400 leading-snug">{app.taurusNote}</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer confirm — same visual weight as VariantPicker's implicit
          "click a tile to add" gesture, but Apps need an explicit confirm
          since there's a form to fill first. */}
      <div className="border-t border-slate-100 p-3 shrink-0 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2 rounded-lg text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canConfirm}
          title={!canConfirm && firstMissingLabel ? `${firstMissingLabel} is required` : undefined}
          className={`flex-[2] py-2 rounded-lg text-xs font-bold text-white transition-colors flex items-center justify-center gap-1.5 px-2 text-center ${
            canConfirm ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-300 cursor-not-allowed'
          }`}
        >
          {canConfirm || !firstMissingLabel ? 'Add to canvas' : `Paste your ${firstMissingLabel.replace(/^Your\s+/i, '')} to continue`}
        </button>
      </div>
    </div>
  );
}

function AppField({
  field, value, onChange, showError,
}: {
  field: AppFieldSchema;
  value: string;
  onChange: (v: string) => void;
  showError: boolean;
}) {
  const labelId = `app-field-${field.key}`;
  return (
    <div>
      <label htmlFor={labelId} className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
        {field.label}{field.required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {field.type === 'textarea' ? (
        <textarea
          id={labelId}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={`w-full px-2.5 py-1.5 text-xs border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400 ${showError ? 'border-rose-400' : 'border-slate-200'}`}
        />
      ) : field.type === 'select' ? (
        <select
          id={labelId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full px-2.5 py-1.5 text-xs border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white ${showError ? 'border-rose-400' : 'border-slate-200'}`}
        >
          {(field.options || []).map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : field.type === 'checkbox' ? (
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={value === 'true' || value === '1'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
            className="w-3.5 h-3.5"
          />
          {field.help || 'Enabled'}
        </label>
      ) : (
        <input
          id={labelId}
          type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : field.type === 'date' ? 'date' : 'text'}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full px-2.5 py-1.5 text-xs border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400 ${showError ? 'border-rose-400' : 'border-slate-200'}`}
        />
      )}
      {field.help && field.type !== 'checkbox' && (
        <p className="mt-1 text-[10px] text-slate-400 leading-snug flex items-start gap-1">
          {field.help}
        </p>
      )}
      {showError && (
        <p className="mt-1 text-[10px] text-rose-500 font-semibold">This field is required.</p>
      )}
      {field.type === 'url' && value.trim() && /^https?:\/\//i.test(value.trim()) === false && !value.includes('@') && (
        <p className="mt-1 text-[10px] text-slate-400 flex items-center gap-1">
          <ExternalLink className="w-2.5 h-2.5" aria-hidden /> We’ll add https:// automatically if you leave it off.
        </p>
      )}
    </div>
  );
}
