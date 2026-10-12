"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { appConfirm } from '@/components/ui/app-dialog';
import { useBuilderStore } from './useBuilderStore';
import { useTemplate, useAdoptTemplateBrandKit, useClearTemplateBrandKit } from '@/hooks/use-api';
import { cn } from '@/lib/utils';
import { logoBackdrop, readLogoBackground } from '@/components/branding/logo-backdrop';
import { readMediaDimensions } from './media-sizing';
import { BRAND_TEXT_WIDGETS, brandGradient, brandTextBox, logoCornerGeometry, nextBrandColor } from './brand-kit-actions';
import type { Zone } from './types';

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
    /** Backdrop treatment for the mark (branding wizard's third picker). */
    logoBackground?: string;
  } | null;
  fontHeading?: string | null;
  fontBody?: string | null;
  displayName?: string | null;
  sourceUrl?: string | null;
  scrapedAt?: string | null;
}

interface BrandApplySummary {
  /** Zones whose config actually changed. */
  widgets: number;
  /** Non-placeholder zones on the canvas. */
  total: number;
  background: 'gradient' | 'solid' | null;
  fonts: boolean;
  logos: number;
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
  // A9 — apply-brand-across-template is ONE undoable history step.
  const beginTransaction = useBuilderStore((s) => s.beginTransaction);
  const endTransaction = useBuilderStore((s) => s.endTransaction);
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

  const t = useTranslations('brandKitPanel');
  // Owner 2026-10-12: "picking colors and fonts I don't see anything happen".
  // Every Brand action now (a) changes the canvas visibly, (b) raises a
  // global toast (the inline one below the Apply button scrolls out of view
  // once the operator is down at the swatches) and (c) pulses the control.
  /** Swatch menu shown when a colour is clicked with nothing selected. */
  const [colorMenu, setColorMenu] = useState<{ hex: string; label: string } | null>(null);
  /** With a widget selected: does a swatch click colour its text or its background? */
  const [colorTarget, setColorTarget] = useState<'text' | 'background'>('text');
  /** The swatch / font that just did something — pulses for a moment. */
  const [pulse, setPulse] = useState<string | null>(null);
  const [placingLogo, setPlacingLogo] = useState(false);

  useEffect(() => {
    if (!colorMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setColorMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [colorMenu]);

  /** Show a one-shot toast under the panel actions AND in the global stack. */
  const flash = (kind: 'ok' | 'info', text: string, pulseKey?: string) => {
    setActionToast({ kind, text });
    setTimeout(() => setActionToast((cur) => (cur?.text === text ? null : cur)), 3000);
    if (kind === 'ok') toast.success(text, { duration: 2500 });
    else toast(text, { duration: 3500 });
    if (pulseKey) {
      setPulse(pulseKey);
      setTimeout(() => setPulse((cur) => (cur === pulseKey ? null : cur)), 900);
    }
  };

  /**
   * The zones a Brand click acts on. The seeded full-screen EMPTY
   * placeholder does not count — on a blank board "nothing selected" is
   * what the operator sees, so a font click must ADD a text box there.
   */
  const targetZones = (): Zone[] =>
    selectedIds
      .map((id) => zones.find((z) => z.id === id))
      .filter((z): z is Zone => !!z && z.widgetType !== 'EMPTY' && !z.locked);

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
   *
   * A9 (2026-07-02) — the whole apply is ONE undoable history step:
   * beginTransaction() pushes the single pre-apply snapshot, the inner
   * updateZones (commit=false) + setMeta calls coalesce into it via the
   * store's activeTransaction guard, and endTransaction() closes it.
   * Pre-fix, updateZones pushed NO snapshot (but still cleared the redo
   * stack) and the trailing setMeta snapshotted the ALREADY-recolored
   * zones — so Cmd-Z after brand-apply reverted only the background and
   * the widget recolor stuck.
   */
  const applyBrandToAllZones = (kit: BrandKit): BrandApplySummary => {
    beginTransaction();
    try {
      return applyBrandToAllZonesInner(kit);
    } finally {
      endTransaction();
    }
  };

  const applyBrandToAllZonesInner = (kit: BrandKit): BrandApplySummary => {
    const summary: BrandApplySummary = { widgets: 0, total: zones.filter((z) => z.widgetType !== 'EMPTY').length, background: null, fonts: false, logos: 0 };
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
        summary.background = 'gradient';
      } else if (primary) {
        setMeta({ bgGradient: '', bgColor: primary });
        summary.background = 'solid';
      }
      return summary;
    }

    updateZones(allIds, (z) => {
      const before = JSON.stringify(z.defaultConfig || {});
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

        case 'EXTERNAL_HTML': {
          // Self-contained signage / menu / kiosk boards (Domino's, the Touch
          // Kiosks pack, the 80 HS templates) don't have flat color/bgColor
          // keys — they read a `brand` OVERRIDE object that the in-iframe shim
          // maps to CSS vars (--bg / --surface / --text / --accent /
          // --font-display / --font-body). The `default` case below would skip
          // them (no matching keys), so a kiosk never picked up the brand kit
          // and "Apply brand across template" was a no-op on it. Map the kit's
          // palette + fonts into config.brand here; WidgetRenderer encodes it
          // as the ?brand= URL param the shim consumes. Only set keys we have,
          // so a partial brand kit still shows the template's own defaults
          // through for everything else.
          // Map ACCENT + FONTS only — NOT background/surface/text. Kiosk
          // templates ship a deliberate, contrast-balanced theme (often a
          // premium dark UI); forcing the brand's light surface + dark ink
          // onto it washes the design out and breaks header/text contrast
          // (observed live rebranding Domino's onto the dark QSR kiosk: the
          // brand's light surface flipped the page light while a dark header
          // bar kept dark text → low-contrast title). Accent + display/body
          // fonts are always safe and high-impact: they recolor prices,
          // active states, badges and CTAs to the brand color and swap the
          // type, so the board reads unmistakably on-brand without fighting
          // its own theme. (Background tinting for kiosks is a future,
          // contrast-aware enhancement, not this hammer.)
          const b: Record<string, string> = { ...(cfg.brand || {}) };
          if (primary) b.primary = primary;
          if (accent || primary) b.accent = (accent || primary) as string;
          if (fontHeading) b.fontDisplay = fontHeading;
          if (fontBody) b.fontBody = fontBody;
          if (Object.keys(b).length > 0) cfg.brand = b;
          break;
        }

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

      if (JSON.stringify(cfg) !== before) {
        summary.widgets += 1;
        if (fontHeading || fontBody) {
          if (cfg.fontFamily || cfg.brand?.fontDisplay || cfg.brand?.fontBody) summary.fonts = true;
        }
        if (wt === 'LOGO' && logoUrl) summary.logos += 1;
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
      summary.background = 'gradient';
    } else if (surface) {
      setMeta({ bgGradient: '', bgColor: surface, bgImage: '' });
      summary.background = 'solid';
    }

    // Apply the brand's heading font to the template name itself if
    // the operator hasn't customized it (cosmetic — name is shown in
    // the toolbar).
    void primaryHover; // reserved for future hover-state widgets
    return summary;
  };

  /** One sentence naming what "Apply brand" actually changed. */
  const describeApply = (sum: BrandApplySummary): string => {
    const parts: string[] = [];
    if (sum.total > 0) parts.push(t('applyWidgets', { count: sum.widgets, total: sum.total }));
    if (sum.logos > 0) parts.push(t('applyLogos', { count: sum.logos }));
    if (sum.fonts) parts.push(t('applyFonts'));
    if (sum.background === 'gradient') parts.push(t('applyBgGradient'));
    else if (sum.background === 'solid') parts.push(t('applyBgSolid'));
    if (parts.length === 0) return t('applyNothing');
    return t('applySummary', { parts: parts.join(' · ') });
  };

  /** Re-apply after manual tweaks. Idempotent. */
  const handleApplyAcrossTemplate = () => {
    if (!brandKit || isSystem) return;
    setApplyingBrand(true);
    try {
      const text = describeApply(applyBrandToAllZones(brandKit));
      setApplyToast(text);
      toast.success(text, { duration: 4000 });
      setTimeout(() => setApplyToast(null), 4000);
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
        throw new Error("We couldn't find a logo or palette on that site. Try your main homepage URL.");
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
        const text = describeApply(applyBrandToAllZones(adopted));
        setApplyToast(text);
        toast.success(text, { duration: 4000 });
        setTimeout(() => setApplyToast(null), 4000);
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
      title: 'Remove template brand kit?',
      // Codex T05: the endpoint clears only the kit — colors, fonts and backgrounds
      // already applied to widgets stay. Say exactly that.
      message: 'Colors, fonts and backgrounds already on this template stay as they are.',
      confirmLabel: 'Remove',
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

  /** Colour one zone's text or background (EXTERNAL_HTML boards read `brand`). */
  const colorPatch = (zone: Zone, hex: string, target: 'text' | 'background'): Partial<Zone> => {
    const cfg: Record<string, unknown> = { ...(zone.defaultConfig || {}) };
    if (zone.widgetType === 'EXTERNAL_HTML') {
      // The board shim maps brand.text → --text and brand.background → --bg.
      cfg.brand = { ...((cfg.brand as Record<string, unknown> | undefined) || {}), [target === 'text' ? 'text' : 'background']: hex };
    } else {
      cfg[target === 'text' ? 'color' : 'bgColor'] = hex;
    }
    return { defaultConfig: cfg };
  };

  /**
   * Swatch click.
   *   - widget(s) selected → colour them (text by default; the visible
   *     "Apply color to: Text | Background" toggle switches; Shift+click
   *     stays a shortcut for background). ONE undo step.
   *   - nothing selected → open the small menu: use as background,
   *     gradient with the next brand colour, colour every text widget.
   */
  const handleColorClick = (hex: string, label: string, e?: React.MouseEvent) => {
    const targets = targetZones();
    if (targets.length === 0) {
      if (e?.shiftKey) { applyAsBackground(hex); return; }
      setColorMenu((cur) => (cur?.hex === hex ? null : { hex, label }));
      return;
    }
    setColorMenu(null);
    const target = e?.shiftKey ? 'background' : colorTarget;
    if (targets.length === 1) {
      updateZone(targets[0].id, colorPatch(targets[0], hex, target), true); // committed: one undo step (Codex T05)
    } else {
      updateZones(targets.map((z) => z.id), (z) => colorPatch(z, hex, target), true);
    }
    const name = targets.length === 1 ? widgetLabel(targets[0].widgetType) : t('nWidgets', { count: targets.length });
    flash(
      'ok',
      target === 'text'
        ? t('textColorApplied', { color: label, widget: name })
        : t('bgColorApplied', { color: label, widget: name }),
      `swatch:${hex}`,
    );
  };

  const applyAsBackground = (hex: string) => {
    setMeta({ bgColor: hex, bgGradient: '', bgImage: '' });
    setColorMenu(null);
    flash('ok', t('bgSet', { color: hex }), `swatch:${hex}`);
  };

  const applyAsGradient = (hex: string, to: string) => {
    setMeta({ bgGradient: brandGradient(hex, to), bgColor: hex, bgImage: '' });
    setColorMenu(null);
    flash('ok', t('gradientSet'), `swatch:${hex}`);
  };

  const colorAllText = (hex: string) => {
    setColorMenu(null);
    const ids = zones
      .filter((z) => !z.locked && (BRAND_TEXT_WIDGETS.has(z.widgetType) || z.widgetType === 'EXTERNAL_HTML'))
      .map((z) => z.id);
    if (ids.length === 0) {
      flash('info', t('noTextYet'));
      return;
    }
    updateZones(ids, (z) => colorPatch(z, hex, 'text'), true);
    flash('ok', t('allTextColored', { count: ids.length }), `swatch:${hex}`);
  };

  /**
   * Font click.
   *   - widget(s) selected → apply the font ("Font applied" toast).
   *   - nothing selected → ADD a text box in that font ("Your headline" /
   *     "Your text here"), selected and ready to edit.
   */
  const handleFontClick = (fontName: string, fontType: 'heading' | 'body') => {
    const targets = targetZones();
    const pulseKey = `font:${fontType}`;
    if (targets.length === 0) {
      const box = brandTextBox(fontType);
      // addZone pushes the ONE undo snapshot and selects the new zone; the
      // follow-up placement/config patch rides along (commit=false), the
      // same shape as addMediaZone.
      const newId = addZone('TEXT', undefined, { w: box.width, h: box.height }, { replacePlaceholder: true });
      const seeded = useBuilderStore.getState().zones.find((z) => z.id === newId);
      updateZone(newId, {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        defaultConfig: {
          ...(seeded?.defaultConfig || {}),
          content: fontType === 'heading' ? t('sampleHeadline') : t('sampleBody'),
          fontFamily: fontName,
          fontSize: box.fontSize,
          ...(fontType === 'heading' ? { bold: true } : {}),
          ...(brandKit?.palette?.ink ? { color: brandKit.palette.ink } : {}),
        },
      }, false);
      select([newId]);
      flash('ok', t('textBoxAdded', { font: fontName }), pulseKey);
      return;
    }
    const patch = (z: Zone): Partial<Zone> => {
      const cfg: Record<string, unknown> = { ...(z.defaultConfig || {}) };
      if (z.widgetType === 'EXTERNAL_HTML') {
        cfg.brand = { ...((cfg.brand as Record<string, unknown> | undefined) || {}), [fontType === 'heading' ? 'fontDisplay' : 'fontBody']: fontName };
      } else {
        cfg.fontFamily = fontName;
      }
      return { defaultConfig: cfg };
    };
    if (targets.length === 1) updateZone(targets[0].id, patch(targets[0]), true);
    else updateZones(targets.map((z) => z.id), patch, true);
    flash('ok', t('fontApplied', { font: fontName }), pulseKey);
  };

  /**
   * "Insert as logo widget".
   *   - a LOGO zone exists (the selected one first, else the first on the
   *     canvas) → swap its image and select it.
   *   - otherwise → a new LOGO zone in the TOP-LEFT corner, sized to the
   *     logo's own aspect ratio, selected so the operator sees it at once.
   */
  const handleInsertLogoWidget = async () => {
    const url = brandKit?.logoUrl;
    if (!url || placingLogo) return;
    const selectedLogo = targetZones().find((z) => z.widgetType === 'LOGO');
    const existing = selectedLogo ?? zones.find((z) => z.widgetType === 'LOGO' && !z.locked);
    if (existing) {
      updateZone(existing.id, {
        defaultConfig: { ...(existing.defaultConfig || {}), assetUrl: url, logoUrl: url },
      }, true);
      select([existing.id]);
      flash('ok', t('logoSwapped'), 'logo');
      return;
    }
    setPlacingLogo(true);
    try {
      const dims = await readMediaDimensions(url, 'image');
      const st = useBuilderStore.getState();
      if (st.templateId !== templateId) return;
      const geo = logoCornerGeometry(dims, { width: st.meta.screenWidth, height: st.meta.screenHeight });
      const newId = st.addZone('LOGO', undefined, { w: geo.width, h: geo.height }, { replacePlaceholder: true });
      const seeded = useBuilderStore.getState().zones.find((z) => z.id === newId);
      useBuilderStore.getState().updateZone(newId, {
        ...geo,
        defaultConfig: {
          ...(seeded?.defaultConfig || {}),
          assetUrl: url,
          logoUrl: url,
          ...(dims ? { _mediaWidth: dims.width, _mediaHeight: dims.height } : {}),
        },
      }, false);
      useBuilderStore.getState().select([newId]);
      flash('ok', t('logoAdded'), 'logo');
    } finally {
      setPlacingLogo(false);
    }
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
            Paste your website URL to auto-detect colors, logo,
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

  // Populated state — per-template brand kit is set.
  // 2026-08-25 — the kit's logo preview honors the same logo-background
  // choice the tenant wizard writes (`palette.logoBackground`), so the
  // builder preview and the dashboard chrome agree. Tone is 'unknown'
  // here (no canvas read on this surface) and `logoBackdrop` falls back
  // to the historical treatment when nothing is stored.
  const logoChipBackdrop = logoBackdrop(readLogoBackground(brandKit), 'unknown');

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
            {/* 2026-08-25 — honor the brand kit's logo-background choice so
                this preview matches the sidebar / wizard treatment. With
                nothing stored it keeps the original slate-50 card. */}
            <div
              className={cn(
                'w-24 h-24 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 transition-shadow',
                logoChipBackdrop.className || 'border border-slate-200',
                logoChipBackdrop.inkClass,
                pulse === 'logo' && 'ring-2 ring-emerald-400 ring-offset-2',
              )}
              style={
                Object.keys(logoChipBackdrop.style).length
                  ? logoChipBackdrop.style
                  : { background: '#f8fafc' }
              }
            >
              <img
                src={brandKit.logoUrl}
                alt="School logo"
                className="max-w-full max-h-full object-contain"
                draggable={false}
              />
            </div>
            <div className="flex-1 space-y-2 min-w-0">
              <button
                type="button"
                onClick={() => void handleInsertLogoWidget()}
                disabled={isSystem || placingLogo}
                className="w-full px-2 py-1.5 rounded bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                title={t('logoHint')}
              >
                {placingLogo ? t('placingLogo') : 'Insert as logo widget'}
              </button>
              <div className="text-[10px] text-slate-500 leading-relaxed">
                {t('logoHint')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Palette */}
      {brandKit.palette && (() => {
        const swatches = [
          { label: 'Primary', hex: brandKit.palette.primary },
          { label: 'Primary Hover', hex: brandKit.palette.primaryHover },
          { label: 'Accent', hex: brandKit.palette.accent },
          { label: 'Text', hex: brandKit.palette.ink },
          { label: 'Surface', hex: brandKit.palette.surface },
          { label: 'Surface Alt', hex: brandKit.palette.surfaceAlt },
        ].filter((c): c is { label: string; hex: string } => !!c.hex);
        const hasSelection = targetZones().length > 0;
        const gradientTo = colorMenu ? nextBrandColor(swatches.map((c) => c.hex), colorMenu.hex) : null;
        return (
          <div className="border-b border-slate-200/50 p-4 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Brand colors
            </div>
            {hasSelection && (
              <div className="flex items-center gap-2" role="group" aria-label={t('applyColorTo')}>
                <span className="text-[10px] text-slate-500">{t('applyColorTo')}</span>
                <div className="inline-flex rounded-md border border-slate-200 p-0.5">
                  {(['text', 'background'] as const).map((target) => (
                    <button
                      key={target}
                      type="button"
                      aria-pressed={colorTarget === target}
                      onClick={() => setColorTarget(target)}
                      className={cn(
                        'px-2 py-0.5 rounded text-[10px] font-semibold transition-colors',
                        colorTarget === target ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100',
                      )}
                    >
                      {target === 'text' ? t('targetText') : t('targetBackground')}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-6 gap-2">
              {swatches.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={(e) => handleColorClick(item.hex, item.label, e)}
                  aria-haspopup={hasSelection ? undefined : 'menu'}
                  aria-expanded={hasSelection ? undefined : colorMenu?.hex === item.hex}
                  title={`${item.label}: ${item.hex}`}
                  className={cn(
                    'group relative w-8 h-8 rounded cursor-pointer border border-black/10 hover:ring-2 hover:ring-offset-1 hover:ring-indigo-400 transition-all',
                    (colorMenu?.hex === item.hex || pulse === `swatch:${item.hex}`) && 'ring-2 ring-offset-1 ring-indigo-500 scale-110',
                  )}
                  style={{ backgroundColor: item.hex }}
                >
                  <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-800 text-white text-[9px] px-1 py-0.5 rounded whitespace-nowrap pointer-events-none z-10">
                    {item.label}
                  </div>
                </button>
              ))}
            </div>
            {colorMenu && !hasSelection && (
              <div
                role="menu"
                aria-label={t('colorMenuTitle', { color: colorMenu.hex })}
                className="mt-1 rounded-lg border border-slate-200 bg-white shadow-md p-1 space-y-0.5"
              >
                <div className="flex items-center gap-2 px-2 py-1 text-[10px] font-semibold text-slate-600">
                  <span className="w-3 h-3 rounded-sm border border-black/10" style={{ backgroundColor: colorMenu.hex }} aria-hidden />
                  {t('colorMenuTitle', { color: colorMenu.hex })}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => applyAsBackground(colorMenu.hex)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[11px] text-slate-700 hover:bg-indigo-50"
                >
                  <span className="w-5 h-3.5 rounded-sm border border-black/10" style={{ backgroundColor: colorMenu.hex }} aria-hidden />
                  {t('useAsBackground')}
                </button>
                {gradientTo && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => applyAsGradient(colorMenu.hex, gradientTo)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[11px] text-slate-700 hover:bg-indigo-50"
                  >
                    <span className="w-5 h-3.5 rounded-sm border border-black/10" style={{ background: brandGradient(colorMenu.hex, gradientTo) }} aria-hidden />
                    {t('gradientWith', { color: gradientTo })}
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => colorAllText(colorMenu.hex)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[11px] text-slate-700 hover:bg-indigo-50"
                >
                  <span className="w-5 text-center text-[12px] font-bold" style={{ color: colorMenu.hex }} aria-hidden>A</span>
                  {t('allTextColor')}
                </button>
              </div>
            )}
            <div className="text-[10px] text-slate-500 leading-relaxed">
              {hasSelection ? t('swatchHintSelected') : t('swatchHint')}
            </div>
          </div>
        );
      })()}

      {/* Fonts */}
      {(brandKit.fontHeading || brandKit.fontBody) && (
        <div className="border-b border-slate-200/50 p-4 space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Brand fonts
          </div>
          <div className="space-y-2">
            {brandKit.fontHeading && (
              <button
                type="button"
                onClick={() => handleFontClick(brandKit.fontHeading!, 'heading')}
                className={cn(
                  'w-full px-3 py-3 rounded border border-slate-200 hover:bg-slate-50 transition-all text-left',
                  pulse === 'font:heading' && 'ring-2 ring-emerald-400 bg-emerald-50',
                )}
                title={t('fontHint')}
              >
                <div className="text-sm font-semibold" style={{ fontFamily: brandKit.fontHeading }}>
                  {brandKit.fontHeading}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Heading font</div>
              </button>
            )}
            {brandKit.fontBody && (
              <button
                type="button"
                onClick={() => handleFontClick(brandKit.fontBody!, 'body')}
                className={cn(
                  'w-full px-3 py-3 rounded border border-slate-200 hover:bg-slate-50 transition-all text-left',
                  pulse === 'font:body' && 'ring-2 ring-emerald-400 bg-emerald-50',
                )}
                title={t('fontHint')}
              >
                <div className="text-sm" style={{ fontFamily: brandKit.fontBody }}>
                  {brandKit.fontBody}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Body font</div>
              </button>
            )}
          </div>
          <div className="text-[10px] text-slate-500 leading-relaxed">
            {t('fontHint')}
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
