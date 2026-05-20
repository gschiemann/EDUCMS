"use client";

import { useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { appConfirm } from '@/components/ui/app-dialog';
import { useBuilderStore } from './useBuilderStore';
import { useTemplate, useAdoptTemplateBrandKit, useClearTemplateBrandKit } from '@/hooks/use-api';

/**
 * Per-template Brand Kit panel.
 *
 * IMPORTANT — operator feedback 2026-04-27:
 *   "you are suppose to bring in colors, logos, etc TO US ON THE
 *   CUSTOM TEMPLATE MAKER but what you really do is update the
 *   overall page brand from the template … those are two separate
 *   things — one for the template making and one for the overall
 *   CMS software."
 *
 * Pre-fix: this panel called /branding/scrape THEN /branding/adopt,
 * the second of which writes to the tenant-wide TenantBranding row
 * — the same row that themes the entire CMS dashboard chrome via
 * BrandStyleInjector. So one click here re-skinned the whole CMS
 * for the entire tenant, which was never the intent.
 *
 * Post-fix (this file):
 *   - Scrape stays at /branding/scrape (no persistence — correct).
 *   - Adopt now goes to /branding/templates/{id}/adopt — writes
 *     ONLY to Template.brandKit JSON column. The global tenant
 *     branding is untouched.
 *   - Reads brandKit FROM the loaded template (via useTemplate),
 *     not from the tenant branding query.
 *   - Does NOT call pushBrandingPreview / BrandStyleInjector.
 *   - Does NOT seed the global LS branding cache.
 *
 * The "skin the whole CMS dashboard" lever stays at
 * `/settings/branding` — that's its intended home.
 */

interface BrandKit {
  logoUrl?: string | null;
  logoSvgInline?: string | null;
  palette?: {
    primary?: string;
    primaryHover?: string;
    accent?: string;
    ink?: string;
    surface?: string;
    surfaceAlt?: string;
  } | null;
  fontHeading?: string | null;
  fontBody?: string | null;
  displayName?: string | null;
  sourceUrl?: string | null;
  scrapedAt?: string | null;
}

export function BrandKitPanel() {
  const templateId = useBuilderStore((s) => s.templateId);
  const isSystem = useBuilderStore((s) => s.isSystem);
  const { data: template, isLoading } = useTemplate(templateId);
  const brandKit: BrandKit | null = (template as any)?.brandKit ?? null;

  const adoptMutation = useAdoptTemplateBrandKit(templateId);
  const clearMutation = useClearTemplateBrandKit(templateId);

  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapePhase, setScrapePhase] = useState<'idle' | 'scanning' | 'applying'>('idle');
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const updateZone = useBuilderStore((s) => s.updateZone);
  const updateZones = useBuilderStore((s) => s.updateZones);
  const setMeta = useBuilderStore((s) => s.setMeta);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const zones = useBuilderStore((s) => s.zones);
  const addZone = useBuilderStore((s) => s.addZone);
  const select = useBuilderStore((s) => s.select);

  const [applyingBrand, setApplyingBrand] = useState(false);
  const [applyToast, setApplyToast] = useState<string | null>(null);
  // Always-visible per-action toast: "Applied teal to Ticker" /
  // "Select a widget first" / "Hex copied". Lives separately from
  // applyToast (which is the bigger "applied to N widgets" message
  // tied to the Apply-across button) so we can fire one without
  // clobbering the other.
  const [actionToast, setActionToast] = useState<{ kind: 'ok' | 'info'; text: string } | null>(null);

  /** Show a one-shot toast under the panel actions. */
  const flash = (kind: 'ok' | 'info', text: string) => {
    setActionToast({ kind, text });
    setTimeout(() => setActionToast((t) => (t?.text === text ? null : t)), 3000);
  };

  /** Friendly name for a widget type so toasts read naturally. */
  const widgetLabel = (wt?: string) => {
    if (!wt) return 'widget';
    return wt
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  };

  /**
   * 2026-05-04 — operator feedback: "i added a braning to the template
   * and the only thing i saw that got updated was the ability to pick
   * a background...shouldnt we do more than that? shouldnt we update
   * the widgets to fit their branding so its more drag and drop"
   *
   * Pre-fix: BrandKitPanel was a passive swatch picker — operator had
   * to click each color/font and manually apply to selected zones.
   * Post-fix: applyBrandToAllZones walks every zone and patches the
   * fields each widget actually consumes:
   *
   *   - LOGO        → assetUrl + logoUrl get the brand logo
   *   - TEXT/RICH   → fontFamily ← brand heading; color ← brand ink
   *   - ANNOUNCE    → fontFamily ← brand body/heading; color/bgColor
   *   - TICKER      → bgColor ← primary; color ← primary-ink
   *   - CLOCK       → color ← brand primary; accentColor ← primary
   *   - WEATHER     → color ← brand ink; accentColor ← primary
   *   - COUNTDOWN   → color ← brand primary; bgColor ← surface
   *   - BELL/LUNCH/CALENDAR/STAFF — header bgs ← primary; text ← ink
   *   - Generic any-widget — color/bgColor where present in defaults
   *
   * Template-level meta also gets a brand-derived gradient bg.
   *
   * Runs automatically right after a successful /adopt and is exposed
   * via a "Re-apply across template" button so operators can refresh
   * after manual tweaks.
   */
  const applyBrandToAllZones = (kit: BrandKit) => {
    const palette = kit.palette || {};
    const fontHeading = kit.fontHeading || null;
    const fontBody = kit.fontBody || fontHeading;
    const logoUrl = kit.logoUrl || null;
    const primary = palette.primary || null;
    const accent = palette.accent || null;
    const ink = palette.ink || null;
    const surface = palette.surface || null;
    const surfaceAlt = palette.surfaceAlt || null;
    const primaryHover = palette.primaryHover || null;

    // Helper: contrast-aware "ink on this bg" — returns white on dark,
    // dark on light. Cheap luminance check; perfect-WCAG would need
    // sRGB-linear math but for solid brand colors this is plenty.
    const contrastOn = (hex?: string | null) => {
      if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return ink || '#1e293b';
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return lum > 0.6 ? (ink || '#1e293b') : '#ffffff';
    };

    const allIds = zones.map((z) => z.id);
    if (allIds.length === 0) {
      // No zones yet — still set the bg meta so the empty canvas
      // gets the brand's gradient ready for the first drop.
      if (primary && accent) {
        setMeta({ bgGradient: `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`, bgColor: surface || '' });
      } else if (primary) {
        setMeta({ bgGradient: '', bgColor: primary });
      }
      return;
    }

    updateZones(allIds, (z) => {
      const cfg: Record<string, any> = { ...(z.defaultConfig || {}) };
      const wt = z.widgetType;

      switch (wt) {
        case 'LOGO':
          // Logo wins over the demo "SE" initials only if we actually
          // got a brand logo. assetUrl + logoUrl are mirrored fields.
          if (logoUrl) {
            cfg.assetUrl = logoUrl;
            cfg.logoUrl = logoUrl;
          }
          if (primary) cfg.accentColor = primary;
          if (ink) cfg.color = ink;
          break;

        case 'TEXT':
        case 'RICH_TEXT':
          if (fontHeading) cfg.fontFamily = fontHeading;
          if (ink) cfg.color = ink;
          break;

        case 'ANNOUNCEMENT':
          if (fontBody) cfg.fontFamily = fontBody;
          if (ink) cfg.color = ink;
          if (surfaceAlt || surface) cfg.bgColor = surfaceAlt || surface;
          if (primary) cfg.accentColor = primary;
          break;

        case 'TICKER':
          // Tickers read best as bright stripe with high-contrast text.
          if (primary) cfg.bgColor = primary;
          if (primary) cfg.color = contrastOn(primary);
          if (fontBody) cfg.fontFamily = fontBody;
          break;

        case 'CLOCK':
          if (primary) cfg.accentColor = primary;
          if (ink) cfg.color = ink;
          break;

        case 'WEATHER':
          if (ink) cfg.color = ink;
          if (primary) cfg.accentColor = primary;
          if (surface) cfg.bgColor = surface;
          break;

        case 'COUNTDOWN':
          if (primary) cfg.color = primary;
          if (surface) cfg.bgColor = surface;
          if (fontHeading) cfg.fontFamily = fontHeading;
          break;

        case 'BELL_SCHEDULE':
        case 'LUNCH_MENU':
        case 'CALENDAR':
        case 'STAFF_SPOTLIGHT':
          if (primary) cfg.headerBg = primary;
          if (primary) cfg.headerColor = contrastOn(primary);
          if (ink) cfg.color = ink;
          if (surface) cfg.bgColor = surface;
          if (fontBody) cfg.fontFamily = fontBody;
          break;

        case 'SCOREBOARD':
        case 'SCORE_HOME':
        case 'SCORE_AWAY':
        case 'GAME_CLOCK':
        case 'GAME_SEGMENT':
        case 'GAME_STAT':
          // Composable scoreboard widgets. A website brand-scrape themes
          // the board: the brand heading font flows to every element, the
          // accent recolors widgets that use one, and the brand (school)
          // logo drops onto the HOME team-logo element. Score/clock keep
          // their high-contrast white on the dark board — we don't wash
          // those out with brand ink. (Board bg gets the brand gradient
          // via setMeta below.)
          if (fontHeading) cfg.fontFamily = fontHeading;
          if (primary && Object.prototype.hasOwnProperty.call(cfg, 'accentColor')) cfg.accentColor = primary;
          if (logoUrl && String(cfg.variant || '') === 'sb-team-logo-home') cfg.logoUrl = logoUrl;
          break;

        default:
          // For any other widget type, only patch keys the existing
          // config already declares (no new keys added → no surprise
          // visual changes for widgets the brand kit doesn't model).
          if (ink && Object.prototype.hasOwnProperty.call(cfg, 'color')) cfg.color = ink;
          if (surface && Object.prototype.hasOwnProperty.call(cfg, 'bgColor')) cfg.bgColor = surface;
          if (fontBody && Object.prototype.hasOwnProperty.call(cfg, 'fontFamily')) cfg.fontFamily = fontBody;
          if (primary && Object.prototype.hasOwnProperty.call(cfg, 'accentColor')) cfg.accentColor = primary;
          break;
      }

      return { defaultConfig: cfg };
    });

    // Template-level bg — gradient from primary→accent if both exist,
    // solid surface otherwise. Set bgGradient (which BackgroundPanel
    // also writes), clear bgImage.
    if (primary && accent) {
      setMeta({
        bgGradient: `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`,
        bgColor: surface || '',
        bgImage: '',
      });
    } else if (surface) {
      setMeta({ bgGradient: '', bgColor: surface, bgImage: '' });
    }

    // Apply the brand's heading font to the template name itself if
    // the operator hasn't customized it (cosmetic — name is shown in
    // the toolbar).
    void primaryHover; // reserved for future hover-state widgets
  };

  /** Re-apply after manual tweaks. Idempotent. */
  const handleApplyAcrossTemplate = () => {
    if (!brandKit || isSystem) return;
    setApplyingBrand(true);
    try {
      applyBrandToAllZones(brandKit);
      const widgetCount = zones.length;
      setApplyToast(
        widgetCount === 0
          ? 'Brand applied to template background. Add widgets to see more.'
          : `Brand applied to ${widgetCount} ${widgetCount === 1 ? 'widget' : 'widgets'}.`,
      );
      setTimeout(() => setApplyToast(null), 3500);
    } finally {
      setApplyingBrand(false);
    }
  };

  /**
   * One-click "detect brand from URL" — scrapes the URL preview, then
   * persists ONLY to this template (not the global CMS theme).
   */
  const handleScrape = async () => {
    const raw = scrapeUrl.trim();
    if (!raw) return;
    if (!templateId) {
      setScrapeError('Save the template first, then detect brand.');
      return;
    }
    if (isSystem) {
      setScrapeError('System presets can\'t carry per-template brand kits. Duplicate this preset, then customize the copy.');
      return;
    }
    // Accept "e-arc.com" or "www.e-arc.com" without the scheme.
    const finalUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

    setScraping(true);
    setScrapeError(null);
    setScrapePhase('scanning');
    try {
      const preview = await apiFetch<any>('/branding/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: finalUrl }),
      });

      if (!preview || (!preview.palette && !preview.colors?.length && !preview.logos?.length)) {
        throw new Error("We couldn't find a logo or palette on that site. Try the school's main homepage URL.");
      }

      setScrapePhase('applying');

      // Persist to THIS TEMPLATE ONLY. Same body shape as the global
      // /branding/adopt endpoint — the server uses the same logo
      // rehost + sanitize logic, just scoped to a per-template
      // Supabase prefix.
      const result = await adoptMutation.mutateAsync({
        ...preview,
        palette: preview.palette,
      });

      // 2026-05-04 — auto-apply across template right after adopt so
      // the operator sees the brand take effect immediately on every
      // widget, not just as a swatch palette they have to click.
      // Uses the server-rehosted logo + sanitized SVG from `result`,
      // not the raw scrape preview, so we get the proper Supabase
      // URLs the player can render.
      const adopted: BrandKit = (result as any)?.brandKit ?? {
        ...preview,
        palette: preview.palette,
      };
      try {
        applyBrandToAllZones(adopted);
        setApplyToast(
          zones.length === 0
            ? 'Brand applied to template background. Add widgets to see more.'
            : `Brand applied to ${zones.length} ${zones.length === 1 ? 'widget' : 'widgets'}.`,
        );
        setTimeout(() => setApplyToast(null), 3500);
      } catch {
        // Non-fatal — operator can hit "Re-apply" manually.
      }

      setScrapeUrl('');
    } catch (err) {
      setScrapeError(
        err instanceof Error ? err.message : 'Failed to detect brand. Try the homepage URL.'
      );
    } finally {
      setScraping(false);
      setScrapePhase('idle');
    }
  };

  /** Wipe this template's brand kit. Doesn't touch the tenant theme. */
  const handleClear = async () => {
    if (!templateId) return;
    if (!(await appConfirm({
      title: 'Clear template brand kit?',
      message: 'This template will revert to the system defaults. Your global CMS theme is not affected.',
      confirmLabel: 'Clear',
      tone: 'danger',
    }))) return;
    try {
      await clearMutation.mutateAsync();
    } catch (err) {
      setScrapeError(
        err instanceof Error ? err.message : 'Failed to clear brand kit.'
      );
    }
  };

  /**
   * 2026-05-04 — operator: "i tried to drag the logo didnt work, i
   * tried to select a color didnt work, make this a useful window
   * here....i still can only apply a background, what else can i
   * test?"
   *
   * Pre-fix: handleColorClick only applied if zone.defaultConfig.color
   * was already defined (which is rare — most widgets render with
   * inline-styled colors and never declare cfg.color). Falsely silent.
   *
   * Post-fix: applies cfg.color to ANY selected widget. Most widgets
   * either consume cfg.color directly, or have a brand-fallback path
   * that picks it up. If shift is held when clicking, applies as
   * background instead (cfg.bgColor) — covers tickers, callouts,
   * announcement zones where the user wants a colored stripe.
   * Always shows a toast confirming what happened.
   */
  const handleColorClick = (hex: string, label: string, e?: React.MouseEvent) => {
    const wantsBg = !!e?.shiftKey;
    if (selectedIds.length === 1) {
      const zoneId = selectedIds[0];
      const zone = zones.find((z) => z.id === zoneId);
      if (zone) {
        const key = wantsBg ? 'bgColor' : 'color';
        updateZone(zoneId, {
          defaultConfig: { ...(zone.defaultConfig || {}), [key]: hex },
        });
        flash('ok', `Applied ${label.toLowerCase()} to ${widgetLabel(zone.widgetType)} ${wantsBg ? 'background' : 'text'}.`);
        return;
      }
    }
    // No selection → fall back to copying the hex so the operator can
    // paste it into a custom field manually.
    navigator.clipboard.writeText(hex).then(
      () => flash('info', `${hex} copied. Select a widget on the canvas first to apply directly.`),
      () => flash('info', `Select a widget on the canvas first to apply this color.`),
    );
  };

  /**
   * Pre-fix: handleFontClick only applied if widgetType === 'TEXT'.
   * Skipped RICH_TEXT, ANNOUNCEMENT, TICKER, COUNTDOWN — every other
   * text-bearing widget the operator might select.
   *
   * Post-fix: applies fontFamily to ANY selected widget. Widgets that
   * don't honor fontFamily simply ignore it (no visible regression).
   */
  const handleFontClick = (fontName: string, fontType: 'heading' | 'body') => {
    if (selectedIds.length !== 1) {
      flash('info', `Select a widget on the canvas first, then click a font.`);
      return;
    }
    const zoneId = selectedIds[0];
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return;
    updateZone(zoneId, {
      defaultConfig: { ...(zone.defaultConfig || {}), fontFamily: fontName },
    });
    flash('ok', `Applied ${fontType} font (${fontName}) to ${widgetLabel(zone.widgetType)}.`);
  };

  /**
   * 2026-05-04 — "i tried to drag the logo didnt work". HTML5 drag
   * isn't wired to the canvas's drop handler so dragging a brand-kit
   * logo into a zone is currently a no-op. Until that's plumbed
   * through (separate change), the explicit button below is the
   * working path:
   *
   *   - If the operator has a LOGO zone selected, replace its
   *     assetUrl + logoUrl with the brand logo.
   *   - Else create a new LOGO zone pre-filled with the brand logo,
   *     select it (so the operator can immediately reposition).
   */
  const handleInsertLogoWidget = () => {
    const url = brandKit?.logoUrl;
    if (!url) return;
    // Selected logo zone → fill it with the brand logo
    if (selectedIds.length === 1) {
      const zoneId = selectedIds[0];
      const zone = zones.find((z) => z.id === zoneId);
      if (zone && zone.widgetType === 'LOGO') {
        updateZone(zoneId, {
          defaultConfig: { ...(zone.defaultConfig || {}), assetUrl: url, logoUrl: url },
        });
        flash('ok', `Logo applied to existing LOGO widget.`);
        return;
      }
    }
    // Else create a fresh LOGO zone pre-filled and select it.
    const newId = addZone('LOGO');
    updateZone(newId, {
      defaultConfig: { assetUrl: url, logoUrl: url },
    });
    select([newId]);
    flash('ok', `Logo widget added to canvas. Drag to reposition.`);
  };

  if (isLoading || !templateId) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <div className="text-xs">Loading brand kit…</div>
      </div>
    );
  }

  // Empty state — no per-template brand kit yet
  if (!brandKit) {
    return (
      <div className="flex flex-col h-full p-4 gap-4 overflow-y-auto">
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <div className="text-xs font-semibold text-slate-600">
            No brand kit on this template
          </div>
          <div className="text-[11px] text-slate-500 leading-relaxed">
            Paste your school's website URL to auto-detect colors, logo,
            and fonts to use <em>inside this template</em>. Your global
            CMS theme is separate.
          </div>
          <div className="w-full space-y-2">
            <input
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="yourschool.org or https://www.yourschool.org"
              value={scrapeUrl}
              onChange={(e) => setScrapeUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
              disabled={scraping || isSystem}
              className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50 disabled:text-slate-400"
            />
            <button
              onClick={handleScrape}
              disabled={!scrapeUrl.trim() || scraping || isSystem}
              className="w-full px-2 py-1.5 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              {scrapePhase === 'scanning' ? 'Scanning website…' :
               scrapePhase === 'applying' ? 'Saving brand kit…' :
               'Detect brand for this template'}
            </button>
            {isSystem && (
              <div className="text-[11px] text-amber-600 leading-relaxed">
                System presets can't carry brand kits. Duplicate this preset, then add a brand kit to the copy.
              </div>
            )}
            {scrapeError && (
              <div className="text-[11px] text-red-600 leading-relaxed">{scrapeError}</div>
            )}
            <div className="text-[10px] text-slate-400 leading-relaxed pt-1">
              Want to skin the whole CMS dashboard instead? Open
              {' '}<a href="/settings/branding" className="underline text-indigo-600 hover:text-indigo-700">Settings → Branding</a>
              {' '}— that page is for the global theme.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Populated state — per-template brand kit is set
  return (
    <div className="flex flex-col h-full gap-0 overflow-y-auto">
      {/* Header — make it crystal clear this is per-template */}
      <div className="border-b border-slate-200/50 p-3 bg-indigo-50/50">
        <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
          This template's brand kit
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
          Used as design tokens inside this template only. Doesn't change the dashboard theme.
        </div>
      </div>

      {/* 2026-05-04 — primary "make it match" call-to-action.
          Re-applies the brand to every widget on the canvas (logo
          slots, fonts, text colors, header chips, ticker stripes,
          template bg). Idempotent — operator can re-run after manual
          tweaks to reset to brand defaults. */}
      <div className="border-b border-slate-200/50 p-3 space-y-2 bg-gradient-to-br from-indigo-50 to-violet-50">
        <button
          onClick={handleApplyAcrossTemplate}
          disabled={applyingBrand || isSystem}
          className="w-full px-3 py-2 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          title="Re-applies the brand kit to every widget: logo, fonts, colors, ticker stripe, header chips, template background."
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12.5V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1.5z" />
            <path d="M5 7l2 2 4-4" />
          </svg>
          {applyingBrand ? 'Applying brand…' : 'Apply brand across template'}
        </button>
        <div className="text-[10px] text-slate-600 leading-relaxed">
          Pushes logos to LOGO zones, brand fonts to text, primary
          color to tickers + countdowns, and a brand gradient to the
          template background.
        </div>
        {applyToast && (
          <div className="text-[10px] text-emerald-700 font-medium leading-relaxed bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
            ✓ {applyToast}
          </div>
        )}
        {actionToast && (
          <div className={`text-[10px] font-medium leading-relaxed border rounded px-2 py-1 ${
            actionToast.kind === 'ok'
              ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
              : 'text-slate-700 bg-slate-50 border-slate-200'
          }`}>
            {actionToast.kind === 'ok' ? '✓ ' : 'ℹ '} {actionToast.text}
          </div>
        )}
        {isSystem && (
          <div className="text-[10px] text-amber-600 leading-relaxed">
            System presets can't be re-styled. Duplicate first.
          </div>
        )}
      </div>

      {/* Logo */}
      {brandKit.logoUrl && (
        <div className="border-b border-slate-200/50 p-4 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Logo
          </div>
          <div className="flex items-start gap-3">
            <div className="w-24 h-24 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden flex-shrink-0">
              <img
                src={brandKit.logoUrl}
                alt="School logo"
                className="max-w-full max-h-full object-contain"
                draggable={false}
              />
            </div>
            <div className="flex-1 space-y-2 min-w-0">
              <button
                onClick={handleInsertLogoWidget}
                disabled={isSystem}
                className="w-full px-2 py-1.5 rounded bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                title="If a LOGO widget is selected, fills it with this logo. Otherwise adds a new LOGO widget to the canvas."
              >
                Insert as logo widget
              </button>
              <div className="text-[10px] text-slate-500 leading-relaxed">
                Adds a LOGO widget pre-filled with this image. Or select an existing LOGO widget first to swap its image.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Palette */}
      {brandKit.palette && (
        <div className="border-b border-slate-200/50 p-4 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Brand colors
          </div>
          <div className="grid grid-cols-6 gap-2">
            {[
              { label: 'Primary', hex: brandKit.palette.primary },
              { label: 'Primary Hover', hex: brandKit.palette.primaryHover },
              { label: 'Accent', hex: brandKit.palette.accent },
              { label: 'Text', hex: brandKit.palette.ink },
              { label: 'Surface', hex: brandKit.palette.surface },
              { label: 'Surface Alt', hex: brandKit.palette.surfaceAlt },
            ].filter((c) => !!c.hex).map((item) => (
              <button
                key={item.label}
                onClick={(e) => handleColorClick(item.hex as string, item.label, e)}
                title={`${item.label}: ${item.hex} — click to set selected widget's text color, Shift+click for background, or copy the hex.`}
                className="group relative w-8 h-8 rounded cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-indigo-400 transition-all"
                style={{ backgroundColor: item.hex }}
              >
                <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-800 text-white text-[9px] px-1 py-0.5 rounded whitespace-nowrap pointer-events-none z-10">
                  {item.label}
                </div>
              </button>
            ))}
          </div>
          <div className="text-[10px] text-slate-500 leading-relaxed space-y-0.5">
            <div>Select a widget on the canvas first, then:</div>
            <div className="pl-2"><span className="font-mono bg-slate-100 px-1 rounded">click</span> a swatch → set text color</div>
            <div className="pl-2"><span className="font-mono bg-slate-100 px-1 rounded">shift+click</span> a swatch → set background color</div>
            <div className="pl-2">No selection? The hex copies to your clipboard.</div>
          </div>
        </div>
      )}

      {/* Fonts */}
      {(brandKit.fontHeading || brandKit.fontBody) && (
        <div className="border-b border-slate-200/50 p-4 space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Brand fonts
          </div>
          <div className="space-y-2">
            {brandKit.fontHeading && (
              <button
                onClick={() => handleFontClick(brandKit.fontHeading!, 'heading')}
                className="w-full px-3 py-3 rounded border border-slate-200 hover:bg-slate-50 transition-colors text-left"
                title="Click to apply this font to the selected widget."
              >
                <div className="text-sm font-semibold" style={{ fontFamily: brandKit.fontHeading }}>
                  {brandKit.fontHeading}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Heading font</div>
              </button>
            )}
            {brandKit.fontBody && (
              <button
                onClick={() => handleFontClick(brandKit.fontBody!, 'body')}
                className="w-full px-3 py-3 rounded border border-slate-200 hover:bg-slate-50 transition-colors text-left"
                title="Click to apply this font to the selected widget."
              >
                <div className="text-sm" style={{ fontFamily: brandKit.fontBody }}>
                  {brandKit.fontBody}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Body font</div>
              </button>
            )}
          </div>
          <div className="text-[10px] text-slate-500 leading-relaxed">
            Select a widget on the canvas, then click a font to apply it.
          </div>
        </div>
      )}

      {/* Footer — display name + clear button */}
      <div className="border-t border-slate-200/50 p-3 bg-slate-50 space-y-2">
        {brandKit.displayName && (
          <div className="text-[10px] font-semibold text-slate-600">
            {brandKit.displayName}
          </div>
        )}
        {brandKit.sourceUrl && (
          <div className="text-[9px] text-slate-400 truncate" title={brandKit.sourceUrl}>
            From {brandKit.sourceUrl}
          </div>
        )}
        <button
          onClick={handleClear}
          disabled={clearMutation.isPending}
          className="w-full text-[10px] text-slate-500 hover:text-red-600 disabled:text-slate-300 transition-colors py-1"
        >
          {clearMutation.isPending ? 'Clearing…' : 'Clear brand kit for this template'}
        </button>
      </div>
    </div>
  );
}
