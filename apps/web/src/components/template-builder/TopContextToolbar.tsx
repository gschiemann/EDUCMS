"use client";

/**
 * TopContextToolbar — Canva-style contextual editor with SCOPE control.
 *
 * Three scopes for every styling change:
 *   - "This text"     → applies only to the most-recently-clicked
 *                       data-field inside the selected zone. Stored
 *                       under cfg._styles[fieldKey][prop]. BuilderZone
 *                       emits one scoped CSS rule per field.
 *   - "This zone"     → applies to the entire zone (stored at the
 *                       top-level cfg.prop). Existing behavior.
 *   - "Whole template"→ iterates every zone in the template and
 *                       writes the prop on each zone's top-level cfg.
 *
 * Default scope auto-picks "This text" if a field is currently active
 * (operator just clicked or hovered a hotspot), else "This zone."
 *
 * The active-field tracking listens to the `template-edit-field`
 * CustomEvent that BuilderZone dispatches on every click or
 * double-click of a data-field hotspot — so when the operator clicks
 * the headline of an MS_PLAYLIST template, only the headline gets
 * restyled, not the song titles + artist names + ticker.
 */

import { useEffect, useState, useCallback } from 'react';
import { useBuilderStore } from './useBuilderStore';
import {
  FontFamilyField,
  FontSizeField,
  FormatToggles,
  ColorField,
  measureZoneFontSize,
} from './PropertiesPanel';

type Scope = 'field' | 'zone' | 'template';

export function TopContextToolbar() {
  const zones        = useBuilderStore((s) => s.zones);
  const selectedIds  = useBuilderStore((s) => s.selectedIds);
  const updateZone   = useBuilderStore((s) => s.updateZone);
  const previewMode  = useBuilderStore((s) => s.previewMode);

  const zone = selectedIds.length === 1 ? zones.find((z) => z.id === selectedIds[0]) : undefined;
  const isText  = zone?.widgetType === 'TEXT' || zone?.widgetType === 'RICH_TEXT';
  const isImage = zone?.widgetType === 'IMAGE' || zone?.widgetType === 'IMAGE_CAROUSEL' || zone?.widgetType === 'LOGO' || zone?.widgetType === 'STAFF_SPOTLIGHT';
  const isClock = zone?.widgetType === 'CLOCK';
  const isWeather = zone?.widgetType === 'WEATHER';
  const isAnnouncement = zone?.widgetType === 'ANNOUNCEMENT';
  const isCalendar = zone?.widgetType === 'CALENDAR';
  const isCountdown = zone?.widgetType === 'COUNTDOWN';
  const cfg = (zone?.defaultConfig || {}) as any;

  // ── Active-field + scope tracking ────────────────────────────────
  // activeFieldKey is the most-recent [data-field] the operator
  // touched inside the selected zone. Updated when BuilderZone
  // dispatches `template-edit-field`. When the zone changes we reset.
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('field');

  useEffect(() => {
    setActiveFieldKey(null);
    setScope('field');
  }, [zone?.id]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { zoneId?: string; fieldKey?: string } | undefined;
      if (!detail?.fieldKey) return;
      // Only track fields inside the currently-selected zone.
      if (zone && detail.zoneId === zone.id) {
        setActiveFieldKey(detail.fieldKey);
        setScope('field');
      }
    };
    window.addEventListener('template-edit-field', handler);
    return () => window.removeEventListener('template-edit-field', handler);
  }, [zone?.id]);

  // Effective scope — `field` falls back to `zone` if no field is
  // currently active (otherwise the toolbar would silently no-op).
  const effectiveScope: Exclude<Scope, 'field'> | 'field' =
    scope === 'field' && !activeFieldKey ? 'zone' : scope;

  /** Read the CURRENT value for a given property, respecting scope. */
  const readVal = (prop: string): any => {
    if (effectiveScope === 'field' && activeFieldKey) {
      return cfg._styles?.[activeFieldKey]?.[prop];
    }
    return cfg[prop];
  };

  /**
   * DOM-measured font size for the +/− stepper. Scope-aware:
   *  - field: measure the active hotspot
   *  - zone/template: measure the largest text inside the zone
   * useCallback so the FontSizeField effect doesn't refire on every
   * render — only when zoneId / scope / activeField actually shift.
   */
  const getMeasuredFontSize = useCallback((): number | null => {
    if (!zone) return null;
    const fk = effectiveScope === 'field' ? activeFieldKey : null;
    return measureZoneFontSize(zone.id, fk);
  }, [zone?.id, effectiveScope, activeFieldKey]);

  /**
   * Write a property, respecting the active scope.
   * - field: updates cfg._styles[activeFieldKey] (CSS rule scoped to one data-field)
   * - zone:  updates top-level cfg.prop. ALSO clears any per-field
   *   overrides of the same prop so the zone-wide value actually
   *   takes effect everywhere (per-field rules win specificity, so
   *   leaving them in place would silently mask the zone change —
   *   the original "selected text didn't change" bug).
   * - template: same as zone, repeated on every zone in the template.
   */
  const stripPerFieldKeys = (styles: any, keys: string[]): any => {
    if (!styles || typeof styles !== 'object') return styles;
    const next: any = {};
    for (const [k, v] of Object.entries(styles)) {
      if (!v || typeof v !== 'object') continue;
      const cleaned = { ...(v as any) };
      for (const key of keys) delete cleaned[key];
      // Drop empty {} entries entirely
      if (Object.keys(cleaned).length > 0) next[k] = cleaned;
    }
    return next;
  };

  const setField = (patch: Record<string, any>) => {
    if (!zone) return;
    if (effectiveScope === 'field' && activeFieldKey) {
      const styles = { ...(cfg._styles || {}) };
      styles[activeFieldKey] = { ...(styles[activeFieldKey] || {}), ...patch };
      updateZone(zone.id, { defaultConfig: { ...cfg, _styles: styles } }, true);
      return;
    }
    const propKeys = Object.keys(patch);
    if (effectiveScope === 'template') {
      for (const z of zones) {
        const c = (z.defaultConfig || {}) as any;
        const cleanedStyles = stripPerFieldKeys(c._styles, propKeys);
        updateZone(z.id, { defaultConfig: { ...c, ...patch, _styles: cleanedStyles } }, true);
      }
      return;
    }
    // Default: zone-wide. Clear matching per-field overrides on this
    // zone so the new value is actually visible.
    const cleanedStyles = stripPerFieldKeys(cfg._styles, propKeys);
    updateZone(zone.id, { defaultConfig: { ...cfg, ...patch, _styles: cleanedStyles } }, true);
  };

  // Cmd+B / Cmd+I / Cmd+U / Cmd+Shift+X — text format keyboard
  // shortcuts. Canva-standard. Active for ANY zone with text content
  // (not just TEXT widget) — for non-text widgets the toggles affect
  // the universal-style override that propagates to all text
  // descendants of the zone.
  useEffect(() => {
    if (!zone || isImage) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName) || t?.isContentEditable) return;
      if (!document.activeElement?.closest?.('[data-zone-id]') && document.activeElement !== document.body) return;
      const k = e.key.toLowerCase();
      // Read CURRENT value via readVal so the toggle respects the
      // active scope (field/zone/template) — without this Cmd+B
      // would always toggle the zone-level value regardless of scope.
      if (k === 'b') { e.preventDefault(); setField({ bold: readVal('bold') !== true }); }
      else if (k === 'i') { e.preventDefault(); setField({ italic: readVal('italic') !== true }); }
      else if (k === 'u') { e.preventDefault(); setField({ underline: readVal('underline') !== true }); }
      else if (e.shiftKey && k === 'x') { e.preventDefault(); setField({ strikethrough: readVal('strikethrough') !== true }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isImage, zone?.id, cfg.bold, cfg.italic, cfg.underline, cfg.strikethrough]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide only in previewMode or with no selection. EVERY widget
  // type with a single zone selected gets a universal text-styling
  // row at minimum (font / size / format / color) — the controls
  // operate on `cfg.fontFamily`, `cfg.fontSize`, `cfg.color`,
  // `cfg.bold`, `cfg.italic`, `cfg.underline`. For TEXT widgets
  // these flow directly into the renderer; for every other widget
  // type BuilderZone wraps the rendered output with a scoped <style>
  // override that inherits these into all text descendants.
  if (previewMode) return null;
  if (!zone) return null;
  // Image-family widgets get their own row (Fit / Opacity / Radius)
  // INSTEAD of the universal styling row — text styling on images
  // makes no sense.
  const showUniversalText = !isImage;

  return (
    <div
      className="shrink-0 border-b border-slate-200 bg-white/80 backdrop-blur-sm px-4 py-3"
      role="toolbar"
      aria-label="Selection-context toolbar"
    >
      {showUniversalText && (
        <div className="flex items-end gap-3 flex-wrap">
          {/* Scope selector — Canva pattern. "This text" only enabled
              when an active field is tracked; falls back to "This zone"
              when no field has been clicked yet. "Whole template"
              writes to every zone in one mutation burst. */}
          <ScopeSelector
            scope={scope}
            effectiveScope={effectiveScope}
            activeFieldKey={activeFieldKey}
            zoneName={zone.name}
            zoneCount={zones.length}
            onChange={setScope}
          />
          {/* Visible scope indicator — shows EXACTLY what the next
              edit will affect. Operators reported losing track of
              which scope was active when the controls were doing
              different things at different times. */}
          <ScopeBadge
            effectiveScope={effectiveScope}
            activeFieldKey={activeFieldKey}
            zoneName={zone.name}
            zoneCount={zones.length}
          />
          <div className="min-w-[180px]">
            <FontFamilyField
              label="Font"
              value={readVal('fontFamily') || ''}
              onChange={(v) => setField({ fontFamily: v })}
            />
          </div>
          <div>
            <FontSizeField
              label="Size"
              value={readVal('fontSize') ?? null}
              onChange={(v) => setField({ fontSize: v })}
              // Anchor the +/− stepper on the actual rendered px so the
              // operator's "make this bigger" click steps from what
              // they SEE — including theme-default text, zone-wide
              // overrides, and per-field overrides. Scope-aware:
              // measures the active hotspot when scope = field, else
              // the largest text in the zone.
              getMeasuredSize={getMeasuredFontSize}
            />
          </div>
          <div className="min-w-[200px]">
            <FormatToggles
              bold={readVal('bold') === true}
              italic={readVal('italic') === true}
              underline={readVal('underline') === true}
              strikethrough={readVal('strikethrough') === true}
              onChange={(patch) => setField(patch)}
            />
          </div>
          <div className="min-w-[180px]">
            <ColorField
              label="Color"
              value={readVal('color') || '#1e293b'}
              onChange={(v) => setField({ color: v })}
            />
          </div>
        </div>
      )}
      {isImage && (
        <div className="flex items-end gap-3 flex-wrap">
          {/* Fit toggles — match background-size CSS values. */}
          <div className="min-w-[180px]">
            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Fit</label>
            <div className="flex gap-1">
              {(['cover', 'contain'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setField({ fit: opt })}
                  className={`flex-1 h-9 rounded-lg text-xs font-bold transition-colors border shadow-sm ${
                    (cfg.fit || 'cover') === opt
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-slate-200/60 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {opt === 'cover' ? 'Fill' : 'Fit'}
                </button>
              ))}
            </div>
          </div>
          {/* Opacity 0-100. */}
          <div className="min-w-[180px]">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-semibold text-slate-500">Opacity</label>
              <span className="text-[10px] font-mono text-slate-500">{Math.round((cfg.opacity ?? 1) * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={cfg.opacity ?? 1}
              onChange={(e) => setField({ opacity: parseFloat(e.target.value) })}
              aria-label="Image opacity"
              className="w-full accent-indigo-600"
            />
          </div>
          {/* Corner radius slider — pure CSS, doesn't touch the asset. */}
          <div className="min-w-[180px]">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-semibold text-slate-500">Corner radius</label>
              <span className="text-[10px] font-mono text-slate-500">{cfg.borderRadius ?? 0}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={64}
              step={1}
              value={cfg.borderRadius ?? 0}
              onChange={(e) => setField({ borderRadius: parseInt(e.target.value, 10) })}
              aria-label="Corner radius"
              className="w-full accent-indigo-600"
            />
          </div>
        </div>
      )}
      {isClock && (
        <div className="flex items-end gap-3 flex-wrap">
          {/* Format toggle: 12h / 24h */}
          <div className="min-w-[180px]">
            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Format</label>
            <div className="flex gap-1">
              {(['12h', '24h'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setField({ format: opt })}
                  className={`flex-1 h-9 rounded-lg text-xs font-bold transition-colors border shadow-sm ${
                    (cfg.format || '12h') === opt
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-slate-200/60 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          {/* Show seconds toggle */}
          <div className="min-w-[180px]">
            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Seconds</label>
            <button
              type="button"
              onClick={() => setField({ showSeconds: !cfg.showSeconds })}
              className={`w-full h-9 rounded-lg text-xs font-bold transition-colors border shadow-sm ${
                cfg.showSeconds === true
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-slate-200/60 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {cfg.showSeconds === true ? 'Show' : 'Hide'}
            </button>
          </div>
        </div>
      )}
      {isWeather && (
        <div className="flex items-end gap-3 flex-wrap">
          {/* Zip code input */}
          <div className="min-w-[180px]">
            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Zip Code</label>
            <input
              type="text"
              value={cfg.zipCode || ''}
              onChange={(e) => setField({ zipCode: e.target.value })}
              placeholder="e.g., 90210"
              className="w-full h-9 px-2.5 rounded-lg text-sm border border-slate-200/60 shadow-sm focus:ring-2 focus:ring-indigo-600 focus:border-transparent"
            />
          </div>
          {/* Units toggle: F / C */}
          <div className="min-w-[180px]">
            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Units</label>
            <div className="flex gap-1">
              {(['F', 'C'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setField({ units: opt })}
                  className={`flex-1 h-9 rounded-lg text-xs font-bold transition-colors border shadow-sm ${
                    (cfg.units || 'F') === opt
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-slate-200/60 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {opt}°
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {isAnnouncement && (
        <div className="flex items-end gap-3 flex-wrap">
          {/* Priority toggle: low / normal / high */}
          <div className="min-w-[180px]">
            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Priority</label>
            <div className="flex gap-1">
              {(['low', 'normal', 'high'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setField({ priority: opt })}
                  className={`flex-1 h-9 rounded-lg text-xs font-bold transition-colors border shadow-sm ${
                    (cfg.priority || 'normal') === opt
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-slate-200/60 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          {/* Color field */}
          <div className="min-w-[180px]">
            <ColorField
              label="Color"
              value={cfg.color || '#f59e0b'}
              onChange={(v) => setField({ color: v })}
            />
          </div>
        </div>
      )}
      {isCalendar && (
        <div className="flex items-end gap-3 flex-wrap">
          {/* Max events numeric stepper */}
          <div className="min-w-[180px]">
            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Max Events</label>
            <div className="flex gap-1 items-center">
              <button
                type="button"
                onClick={() => setField({ maxEvents: Math.max(1, (cfg.maxEvents ?? 5) - 1) })}
                className="h-9 px-2.5 rounded-lg border border-slate-200/60 bg-white hover:bg-slate-50 shadow-sm font-bold text-slate-700"
              >
                −
              </button>
              <span className="w-12 text-center text-sm font-semibold text-slate-700">{cfg.maxEvents ?? 5}</span>
              <button
                type="button"
                onClick={() => setField({ maxEvents: Math.min(20, (cfg.maxEvents ?? 5) + 1) })}
                className="h-9 px-2.5 rounded-lg border border-slate-200/60 bg-white hover:bg-slate-50 shadow-sm font-bold text-slate-700"
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}
      {isCountdown && (
        <div className="flex items-end gap-3 flex-wrap">
          {/* Target date input */}
          <div className="min-w-[180px]">
            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Target Date</label>
            <input
              type="date"
              value={cfg.targetDate || ''}
              onChange={(e) => setField({ targetDate: e.target.value })}
              className="w-full h-9 px-2.5 rounded-lg text-sm border border-slate-200/60 shadow-sm focus:ring-2 focus:ring-indigo-600 focus:border-transparent"
            />
          </div>
          {/* Label input */}
          <div className="min-w-[180px]">
            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Label</label>
            <input
              type="text"
              value={cfg.label || ''}
              onChange={(e) => setField({ label: e.target.value })}
              placeholder="e.g., Days Until..."
              className="w-full h-9 px-2.5 rounded-lg text-sm border border-slate-200/60 shadow-sm focus:ring-2 focus:ring-indigo-600 focus:border-transparent"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Scope selector — three-button group that decides where styling
 *  changes land. "This text" auto-disables when no specific field has
 *  been clicked yet (falls back visually to a hint that operator should
 *  click a hotspot to scope changes more tightly). */
function ScopeSelector({
  scope, effectiveScope, activeFieldKey, zoneName, zoneCount, onChange,
}: {
  scope: Scope;
  effectiveScope: 'field' | 'zone' | 'template';
  activeFieldKey: string | null;
  zoneName: string;
  zoneCount: number;
  onChange: (s: Scope) => void;
}) {
  const opts: Array<{ key: Scope; label: string; hint: string; enabled: boolean }> = [
    {
      key: 'field',
      label: 'This text',
      hint: activeFieldKey ? `Just the "${activeFieldKey}" text` : 'Click a text on the canvas first',
      enabled: !!activeFieldKey,
    },
    {
      key: 'zone',
      label: 'This zone',
      hint: `Every text inside ${zoneName}`,
      enabled: true,
    },
    {
      key: 'template',
      label: 'Whole template',
      hint: `Every text in all ${zoneCount} zones of the template`,
      enabled: true,
    },
  ];
  return (
    <div className="min-w-[280px]">
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Apply to</label>
      <div className="flex rounded-lg border border-slate-200/60 overflow-hidden shadow-sm" role="radiogroup" aria-label="Style scope">
        {opts.map((opt) => {
          const active = effectiveScope === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => opt.enabled && onChange(opt.key)}
              disabled={!opt.enabled}
              title={opt.hint}
              className={`flex-1 h-9 text-[11px] font-bold uppercase tracking-wide transition-colors px-2 ${
                active
                  ? 'bg-indigo-600 text-white'
                  : opt.enabled
                    ? 'bg-white text-slate-600 hover:bg-slate-50'
                    : 'bg-slate-50 text-slate-300 cursor-not-allowed'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Inline indicator showing the operator EXACTLY what the next edit
 *  will affect. Operator reported losing track of which scope was
 *  active when controls were doing different things at different times.
 *  Now there's an unmissable chip next to the scope selector. */
function ScopeBadge({
  effectiveScope, activeFieldKey, zoneName, zoneCount,
}: {
  effectiveScope: 'field' | 'zone' | 'template';
  activeFieldKey: string | null;
  zoneName: string;
  zoneCount: number;
}) {
  const colorMap = {
    field: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    zone: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    template: 'bg-violet-50 text-violet-700 border-violet-200',
  };
  const label =
    effectiveScope === 'field' && activeFieldKey
      ? `Editing: ${activeFieldKey}`
      : effectiveScope === 'zone'
        ? `Editing: every text in ${zoneName}`
        : `Editing: every zone (${zoneCount}) in the template`;
  return (
    <div className="self-end pb-2">
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-bold ${colorMap[effectiveScope]}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        {label}
      </div>
    </div>
  );
}
