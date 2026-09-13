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
 *
 * Tier 2 (2026-07-01, see 20-WORLDCLASS-BUILD-PLAN.md Tier 2 "Finished-
 * board-per-app"): below the plain "Add to canvas" fast path, this form now
 * offers (a) 2-3 curated `app.starterLayouts` thumbnails that drop a WHOLE
 * multi-zone, on-brand board instead of one bare zone, and (b) a "✨ Design
 * one with AI" button that calls the SAME AI Designer pipeline the
 * Templates page's full-template generator uses (generate-designer/
 * candidates) to author a bespoke board featuring this app's content, then
 * adds the winning candidate as a single EXTERNAL_HTML zone. Both are
 * pure additions to the existing addZone/updateZone confirm path — neither
 * touches how "Add to canvas" already works.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ExternalLink, AlertTriangle, Loader2, Sparkles, LayoutTemplate } from 'lucide-react';
import dynamic from 'next/dynamic';

// Bundle-split step 2 (2026-07-20): WidgetRenderer is the widget world —
// a ~3.4 MB chunk when bundled statically. Load it on demand so this
// dashboard surface's first paint doesn't parse every widget theme. Same
// pattern as ScaledTemplateThumbnail (the repo's blessed dynamic mount).
// Player + board routes intentionally keep STATIC imports (offline
// life-safety rendering must never wait on a lazy chunk).
const WidgetPreview = dynamic(
  () => import('@/components/widgets/WidgetRenderer').then((m) => ({ default: m.WidgetPreview })),
  { ssr: false, loading: () => null },
);
import { useBuilderStore } from '@/components/template-builder/useBuilderStore';
import { useTenant, useGenerateDesignerCandidates } from '@/hooks/use-api';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { getAiStatusSource } from '@/components/ai/AiGenerateButton';
import type { AppDefinition, AppFieldSchema, AppStarterLayout } from './app-registry';
import { buildApp } from './build-app';
import { isUsableWebUrl } from './url-transforms';
import {
  fetchGoogleReviewsStatus,
  searchGooglePlaces,
  type GoogleReviewCandidate,
} from '@/lib/reviews/google-reviews-client';

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

  // M6-1 (2026-09-12): this used to be a bare `app.build(values)` in a
  // try/catch that returned `{ widgetType:'WEBPAGE', defaultConfig:{} }` —
  // a parse ERROR became a "successful" EMPTY config, and the green Add
  // button wrote it to the canvas. `buildApp` returns ok/not-ok instead, so
  // a link that can't work is a visible reason, never a blank zone.
  const outcome = useMemo(() => buildApp(app, values), [app, values]);
  // Preview-only view of what build() produced. `outcome.preview` exists
  // solely so a half-filled form still previews; it is NEVER written to a
  // zone (every write path below re-runs buildApp and uses ITS payload).
  const built: { widgetType: string; defaultConfig: Record<string, unknown> } | null =
    outcome.ok
      ? { widgetType: outcome.widgetType, defaultConfig: outcome.defaultConfig }
      : outcome.code === 'missing' && outcome.preview
        ? outcome.preview
        : null;
  /** The one sentence that explains why Add is disabled, when the operator
   *  has actually typed something. 'missing' keeps the form's existing
   *  "Paste your X to continue" copy; 'coming-soon' has its own panel. */
  const blockingReason = !outcome.ok && outcome.code === 'invalid' ? outcome.reason : null;
  /** What the preview pane says when there is nothing truthful to draw.
   *  Only read when `built` is null. */
  const previewNotice: { text: string; tone: 'calm' | 'warn' } =
    outcome.ok || outcome.code === 'missing'
      ? { text: 'Paste a link above to preview it here.', tone: 'calm' }
      : { text: outcome.reason, tone: 'warn' };

  // Live-preview truthfulness — for WEBPAGE-backed apps (Slides, Sheets,
  // Canva, PowerPoint, Maps, Calendar, Web URL) the config-form preview used
  // to always render a FAKE browser mockup ("Web content will load here"),
  // never the operator's actual page. Debounce so we don't hammer the
  // SSRF-guarded proxy on every keystroke — only fire once the built URL is
  // a real https URL and has settled for URL_DEBOUNCE_MS.
  const builtUrl = built?.defaultConfig.url;
  const previewUrl: string = built?.widgetType === 'WEBPAGE' && typeof builtUrl === 'string' ? builtUrl : '';
  const isWebpagePreview = built?.widgetType === 'WEBPAGE';
  const [debouncedPreviewUrl, setDebouncedPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    if (!isWebpagePreview) { setDebouncedPreviewUrl(''); setPreviewLoading(false); return; }
    if (!isUsableWebUrl(previewUrl)) { setDebouncedPreviewUrl(''); setPreviewLoading(false); return; }
    setPreviewLoading(true);
    const t = setTimeout(() => {
      setDebouncedPreviewUrl(previewUrl);
      setPreviewLoading(false);
    }, URL_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [previewUrl, isWebpagePreview]);

  const showLiveWebpagePreview = isWebpagePreview && !!debouncedPreviewUrl;
  // STREAMING (YouTube/Vimeo/Twitch) already renders a real iframe at
  // live=false too (IframeStream only gates autoplay on `live`), so it's
  // truthful without any of this — only WEBPAGE needed the live flag.
  const previewLive = isWebpagePreview ? showLiveWebpagePreview : false;

  const requiredFields = app.configSchema.filter((f) => f.required);
  const missingRequired = requiredFields.filter((f) => !values[f.key]?.trim());
  const canConfirm = outcome.ok;
  const firstMissingLabel = missingRequired[0]?.label;

  const handleConfirm = () => {
    // Re-validate at the boundary that WRITES the zone. `canConfirm` is UI
    // state; UI state is not enforcement (M6-1).
    const fresh = buildApp(app, values);
    if (!fresh.ok) { setTouched(true); return; }
    const size = app.defaultSize ?? WIDGET_TYPE_DEFAULT_SIZE[fresh.widgetType];
    const id = addZone(fresh.widgetType, undefined, size);
    updateZone(id, { defaultConfig: fresh.defaultConfig });
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

  // ── Tier 2: Finished layouts (curated) ─────────────────────────────────
  // Adds the WHOLE multi-zone composition in one click instead of a bare
  // zone. Each zone in `layout.zones` either carries its own widgetType
  // (the complementary title bar / clock / accent strip) or omits it to
  // mean "this app's own widget here" — in which case it gets the app's
  // live `built` config (so the operator's already-typed URL/location/etc.
  // rides straight into the layout, exactly like plain "Add to canvas").
  const applyStarterLayout = (layout: AppStarterLayout) => {
    // Same boundary rule as handleConfirm — this writes zones too.
    const fresh = buildApp(app, values);
    if (!fresh.ok) { setTouched(true); return; }
    let firstId: string | null = null;
    for (const z of layout.zones) {
      const widgetType = z.widgetType ?? fresh.widgetType;
      const isAppsOwnZone = !z.widgetType || z.widgetType === fresh.widgetType;
      const id = addZone(widgetType, undefined, { w: z.width, h: z.height });
      updateZone(id, {
        x: z.x,
        y: z.y,
        width: z.width,
        height: z.height,
        zIndex: z.zIndex ?? 1,
        defaultConfig: isAppsOwnZone ? { ...fresh.defaultConfig, ...z.defaultConfig } : z.defaultConfig,
      });
      if (!firstId) firstId = id;
    }
    if (firstId) select(firstId);
    onDone();
  };

  // ── Tier 2: "Design one with AI" ────────────────────────────────────────
  // Reuses the EXISTING AI Designer pipeline (the same generate-designer/
  // candidates endpoint the Templates page's full-template generator
  // calls) — no new AI plumbing. Runs on the tenant's BYOK creative-tier
  // key (never the platform Tier-1 key), so it degrades to a hidden button
  // exactly like the sparkle button when no provider is configured.
  const tenantCopy = useTenantCopy();
  const screenWidth = useBuilderStore((s) => s.meta.screenWidth);
  const screenHeight = useBuilderStore((s) => s.meta.screenHeight);
  const [aiStatus, setAiStatus] = useState<'loading' | 'none' | 'available'>('loading');
  useEffect(() => {
    let alive = true;
    getAiStatusSource().then((src) => { if (alive) setAiStatus(src === 'none' ? 'none' : 'available'); });
    return () => { alive = false; };
  }, []);
  const generateDesigner = useGenerateDesignerCandidates();
  const [aiDesignError, setAiDesignError] = useState<string | null>(null);
  const handleDesignWithAi = async () => {
    if (!buildApp(app, values).ok) { setTouched(true); return; }
    setAiDesignError(null);
    try {
      const res = await generateDesigner.mutateAsync({
        prompt: `A finished, on-brand signage board featuring ${app.name}: ${app.blurb}`,
        screenWidth,
        screenHeight,
        vertical: (tenantCopy.vertical || 'venue').toLowerCase(),
        count: 1,
      });
      const board = res?.candidates?.[0];
      if (!board?.html) {
        setAiDesignError('The AI returned no design. Try again in a moment.');
        return;
      }
      const id = addZone('EXTERNAL_HTML', undefined, { w: 100, h: 100 });
      updateZone(id, { x: 0, y: 0, width: 100, height: 100, zIndex: 1, defaultConfig: { html: board.html } });
      select(id);
      onDone();
    } catch (e: unknown) {
      const status = e && typeof e === 'object' && 'status' in e ? (e as { status?: number }).status : undefined;
      if (status === 402) setAiDesignError('AI generation limit reached for now — try again later.');
      else if (status === 403) setAiDesignError("Your role can't generate AI boards — ask an admin.");
      else setAiDesignError('Could not reach the AI service. Try again.');
    }
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
            of a fake browser-chrome placeholder.

            task #290 (2026-07-03): `live={previewLive}` is a BUILDER
            signal here (gates WEBPAGE iframe autoplay-equivalent loading),
            not a player one — this pane is the App Library's config-time
            preview, never a scheduled screen. Deliberately NO
            `renderSurface` prop: that's reserved for the two components
            that render a REAL screen (player/page.tsx, TouchOverlay.tsx).
            Today no App Library entry builds a SCOREBOARD/CTS widgetType
            (see app-registry.ts), so this can't yet reach a sport widget
            — but if one is added, omitting `renderSurface` (defaulting to
            'builder' via RenderSurfaceContext) is what keeps this preview
            on the alive SAMPLE instead of a real screen's neutral/"no
            game bound" state. Do not add `renderSurface="player"` here. */}
        <div className="p-3 border-b border-slate-100 bg-slate-50/60">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Live preview</div>
          <div className="relative w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-900" style={{ aspectRatio: '16 / 9' }}>
            {/* A link that can't work gets the REASON here, not a spinner
                that resolves into an empty frame (M6-1). */}
            {!built ? (
              <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center text-center px-4">
                <p className={`text-[11px] leading-snug ${previewNotice.tone === 'warn' ? 'text-amber-300' : 'text-slate-400'}`}>
                  {previewNotice.text}
                </p>
              </div>
            ) : isWebpagePreview && !isUsableWebUrl(previewUrl) ? (
              <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center text-center px-4">
                <p className="text-[11px] text-slate-400">Paste a link above to preview it here.</p>
              </div>
            ) : isWebpagePreview && previewLoading ? (
              <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center gap-1.5 text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                <span className="text-[11px]">Loading preview…</span>
              </div>
            ) : (
              <WidgetPreview
                key={isWebpagePreview ? debouncedPreviewUrl : app.id}
                widgetType={built.widgetType}
                config={isWebpagePreview ? { ...built.defaultConfig, url: debouncedPreviewUrl || previewUrl } : built.defaultConfig}
                width={100}
                height={100}
                live={previewLive}
              />
            )}
          </div>
        </div>

        {/* Tier 2 — Finished layouts + "Design one with AI" (2026-07-01).
            Never shown for comingSoon apps (nothing to add). The plain
            "Add to canvas" footer button below stays the fast/default
            path — this row is a richer alternative, not a required step. */}
        {!app.comingSoon && (app.starterLayouts?.length || aiStatus === 'available') && (
          <div className="p-3 border-b border-slate-100 space-y-2">
            {app.starterLayouts && app.starterLayouts.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Finished layouts
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {app.starterLayouts.map((layout) => (
                    <button
                      key={layout.id}
                      type="button"
                      onClick={() => applyStarterLayout(layout)}
                      disabled={!canConfirm}
                      title={!canConfirm ? (blockingReason ?? 'Fill in the required field above first') : `Add "${layout.name}"`}
                      className={`group text-left rounded-lg border-2 overflow-hidden transition-colors ${
                        canConfirm ? 'border-slate-200 hover:border-indigo-300 cursor-pointer' : 'border-slate-100 opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <StarterLayoutThumbnail layout={layout} />
                      <div className="px-2 py-1.5 bg-white border-t border-slate-100 flex items-center gap-1">
                        <LayoutTemplate className="w-3 h-3 text-slate-400 shrink-0" aria-hidden />
                        <span className="text-[10px] font-semibold text-slate-600 truncate">{layout.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {aiStatus === 'available' && (
              <div>
                <button
                  type="button"
                  onClick={handleDesignWithAi}
                  disabled={!canConfirm || generateDesigner.isPending}
                  title={!canConfirm ? (blockingReason ?? 'Fill in the required field above first') : 'Design a bespoke on-brand board with AI'}
                  className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors ${
                    canConfirm && !generateDesigner.isPending
                      ? 'bg-violet-50 text-violet-700 border-2 border-violet-200 hover:bg-violet-100 hover:border-violet-300'
                      : 'bg-slate-50 text-slate-400 border-2 border-slate-100 cursor-not-allowed'
                  }`}
                >
                  {generateDesigner.isPending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                      Designing your board…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" aria-hidden />
                      Design one with AI
                    </>
                  )}
                </button>
                {aiDesignError && (
                  <p className="mt-1.5 text-[10px] text-rose-500 font-semibold">{aiDesignError}</p>
                )}
              </div>
            )}
          </div>
        )}

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
                  // `google-place` writes TWO keys at once (the opaque id plus
                  // the human name the board's header shows), which a single
                  // string `onChange` cannot express.
                  onChangeMany={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
                  pickedLabel={field.type === 'google-place' ? (values.placeName ?? '') : ''}
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
      <div className="border-t border-slate-100 p-3 shrink-0">
        {/* Why Add is off, in the operator's language and where they're
            about to click (M6-1). A blank required field keeps its own
            "Paste your X to continue" button copy instead. */}
        {blockingReason && (
          <p
            role="status"
            className="mb-2 text-[11px] leading-snug text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5"
          >
            {blockingReason}
          </p>
        )}
        <div className="flex gap-2">
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
            title={!canConfirm ? (blockingReason ?? (firstMissingLabel ? `${firstMissingLabel} is required` : undefined)) : undefined}
            className={`flex-[2] py-2 rounded-lg text-xs font-bold text-white transition-colors flex items-center justify-center gap-1.5 px-2 text-center ${
              canConfirm ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-300 cursor-not-allowed'
            }`}
          >
            {canConfirm || !firstMissingLabel ? 'Add to canvas' : `Paste your ${firstMissingLabel.replace(/^Your\s+/i, '')} to continue`}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A cheap, static-CSS scaled mock-up of a starter layout's zone rects —
 * NOT a live WidgetPreview per zone (that would mean rendering up to 3
 * real widgets, incl. an iframe-based WEBPAGE/STREAMING preview, per
 * thumbnail, per app, every time the config form opens — a mobile-perf
 * cost with no payoff since the operator is choosing a LAYOUT, not
 * previewing live content here). Each zone renders as a plain colored
 * block sized/positioned from its percentages, giving an honest at-a-
 * glance sense of the composition. Complementary zones (title bar, clock,
 * accent strip) get a brand-tinted block; the app's own zone (the
 * majority of the canvas) gets a neutral placeholder block.
 */
function StarterLayoutThumbnail({ layout }: { layout: AppStarterLayout }) {
  return (
    <div className="relative w-full bg-slate-100" style={{ aspectRatio: '16 / 9' }}>
      {layout.zones.map((z, i) => {
        const isComplementary = !!z.widgetType;
        return (
          <div
            key={i}
            className={`absolute rounded-[1px] ${isComplementary ? 'bg-[var(--brand-primary,#4f46e5)]/70' : 'bg-slate-300'}`}
            style={{
              left: `${z.x}%`,
              top: `${z.y}%`,
              width: `${z.width}%`,
              height: `${z.height}%`,
            }}
          />
        );
      })}
    </div>
  );
}

function AppField({
  field, value, onChange, onChangeMany, pickedLabel, showError,
}: {
  field: AppFieldSchema;
  value: string;
  onChange: (v: string) => void;
  /** Only `google-place` uses this — it writes an id AND a display name. */
  onChangeMany?: (patch: Record<string, string>) => void;
  /** Only `google-place` uses this — the name of the currently picked row. */
  pickedLabel?: string;
  showError: boolean;
}) {
  const labelId = `app-field-${field.key}`;
  if (field.type === 'google-place') {
    return (
      <GooglePlaceField
        field={field}
        value={value}
        pickedLabel={pickedLabel ?? ''}
        onPick={(placeId, placeName) => {
          if (onChangeMany) onChangeMany({ [field.key]: placeId, placeName });
          else onChange(placeId);
        }}
      />
    );
  }
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

/**
 * `google-place` — the one field whose value the operator cannot type.
 *
 * A Google place id looks like `ChIJj61dQgK6j4AR4GeTYWZsKWw`. Asking for it in
 * a text box would mean sending an operator to Google's developer docs to find
 * a token, which is exactly the "you need an IT consultant" experience the
 * Concierge exists to delete. So this searches by BUSINESS NAME through
 * `POST /api/v1/integrations/google-reviews/places/search` (server-side, our
 * key) and stores the id plus the name behind the scenes.
 *
 * WHEN THE DEPLOY HAS NO KEY it shows the prerequisite INSTEAD of the search
 * box. A search box that can only ever return nothing is worse than no search
 * box: it makes a missing API key look like a business that Google has never
 * heard of. The status call answering `null` (we could not find out) still
 * shows the box — not knowing is not the same as knowing it is off.
 */
function GooglePlaceField({
  field,
  value,
  pickedLabel,
  onPick,
}: {
  field: AppFieldSchema;
  value: string;
  pickedLabel: string;
  onPick: (placeId: string, placeName: string) => void;
}) {
  const inputId = `app-field-${field.key}`;
  const [enabled, setEnabled] = useState<boolean | null | 'loading'>('loading');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GoogleReviewCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchGoogleReviewsStatus().then((v) => {
      if (alive) setEnabled(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Debounced so a typed business name is one search, not one per keystroke —
  // each search is a billed Google Text Search call.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    setError(null);
    const t = setTimeout(() => {
      searchGooglePlaces(q)
        .then((rows) => {
          setResults(rows);
          setSearching(false);
        })
        .catch(() => {
          setResults([]);
          setSearching(false);
          setError('Couldn’t reach Google just now. Try that search again in a moment.');
        });
    }, 450);
    return () => clearTimeout(t);
  }, [query]);

  if (enabled === false) {
    return (
      <div>
        <p className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{field.label}</p>
        <div className="flex gap-2 items-start text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 leading-snug">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
          <span>Ask your admin to add a Google Maps API key with Places API (New) enabled.</span>
        </div>
      </div>
    );
  }

  if (value && pickedLabel) {
    return (
      <div>
        <p className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{field.label}</p>
        <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
          <span className="text-xs font-semibold text-slate-800 truncate">{pickedLabel}</span>
          <button
            type="button"
            onClick={() => {
              onPick('', '');
              setQuery('');
              setResults([]);
            }}
            className="ml-2 shrink-0 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={inputId} className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
        {field.label}
      </label>
      <input
        id={inputId}
        type="text"
        value={query}
        placeholder={field.placeholder}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />
      {field.help && <p className="mt-1 text-[10px] text-slate-400 leading-snug">{field.help}</p>}
      {searching && (
        <p className="mt-1.5 text-[10px] text-slate-400 flex items-center gap-1">
          <Loader2 className="w-2.5 h-2.5 animate-spin" aria-hidden /> Searching Google…
        </p>
      )}
      {error && <p className="mt-1.5 text-[10px] text-rose-500 font-semibold">{error}</p>}
      {!searching && !error && query.trim().length >= 3 && results.length === 0 && (
        <p className="mt-1.5 text-[10px] text-slate-400">
          Google found nothing for that. Try the business name plus the town.
        </p>
      )}
      {results.length > 0 && (
        <ul className="mt-1.5 border border-slate-200 rounded-md overflow-hidden">
          {results.map((r) => (
            <li key={r.placeId}>
              <button
                type="button"
                onClick={() => {
                  onPick(r.placeId, r.name);
                  setResults([]);
                }}
                className="w-full text-left px-2.5 py-2 hover:bg-indigo-50 border-b border-slate-100 last:border-b-0"
              >
                <span className="block text-xs font-semibold text-slate-800">{r.name}</span>
                {r.address && <span className="block text-[10px] text-slate-500">{r.address}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
