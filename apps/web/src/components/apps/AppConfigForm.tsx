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
 */

import { useMemo, useState } from 'react';
import { ChevronLeft, ExternalLink, AlertTriangle } from 'lucide-react';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';
import { useBuilderStore } from '@/components/template-builder/useBuilderStore';
import type { AppDefinition, AppFieldSchema } from './app-registry';

function defaultValues(app: AppDefinition): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of app.configSchema) {
    if (f.defaultValue !== undefined) out[f.key] = String(f.defaultValue);
  }
  return out;
}

export function AppConfigForm({ app, onBack, onDone }: { app: AppDefinition; onBack: () => void; onDone: () => void }) {
  const addZone = useBuilderStore((s) => s.addZone);
  const updateZone = useBuilderStore((s) => s.updateZone);

  const [values, setValues] = useState<Record<string, string>>(() => defaultValues(app));
  const [touched, setTouched] = useState(false);

  const setField = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

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

  const requiredFields = app.configSchema.filter((f) => f.required);
  const missingRequired = requiredFields.filter((f) => !values[f.key]?.trim());
  const canConfirm = !app.comingSoon && missingRequired.length === 0;

  const handleConfirm = () => {
    if (!canConfirm) { setTouched(true); return; }
    const id = addZone(built.widgetType);
    updateZone(id, { defaultConfig: built.defaultConfig });
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
        <h2 className="text-sm font-bold text-slate-800 truncate flex-1">{app.name}</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Live preview — same WidgetPreview the canvas renders, so this is
            a truthful preview, not a mockup that can drift from reality. */}
        <div className="p-3 border-b border-slate-100 bg-slate-50/60">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Live preview</div>
          <div className="relative w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-900" style={{ aspectRatio: '16 / 9' }}>
            <WidgetPreview
              widgetType={built.widgetType}
              config={built.defaultConfig}
              width={100}
              height={100}
              live={false}
            />
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
              {app.setupNote && (
                <div className="text-[11px] text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 leading-snug">
                  {app.setupNote}
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
          className={`flex-[2] py-2 rounded-lg text-xs font-bold text-white transition-colors flex items-center justify-center gap-1.5 ${
            canConfirm ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-300 cursor-not-allowed'
          }`}
        >
          Add to canvas
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
          type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'}
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
