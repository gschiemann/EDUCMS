"use client";

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Copy, ImagePlus, Palette, Sparkles, Undo2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { appConfirm } from '@/components/ui/app-dialog';
import { useBuilderStore } from './useBuilderStore';
import { useTemplate, useAdoptTemplateBrandKit, useClearTemplateBrandKit, useTenantBranding } from '@/hooks/use-api';
import { cn } from '@/lib/utils';
import { logoBackdrop, readLogoBackground } from '@/components/branding/logo-backdrop';
import { readMediaDimensions } from './media-sizing';
import {
  BRAND_TEXT_STYLES,
  BRAND_TEXT_WIDGETS,
  LOGO_PLACEMENTS,
  backgroundBaseColor,
  brandBackgrounds,
  brandChecklist,
  brandColors,
  brandTemplateBackground,
  brandTextZone,
  brandZoneConfig,
  colorPatchConfig,
  currentPlacement,
  hasBrand,
  isTextZone,
  kitFromTenantBranding,
  logoSize,
  placeBox,
  readableOn,
  type BrandBackground,
  type BrandColorKey,
  type BrandKitLike,
  type BrandTextStyle,
  type LogoPlacement,
} from './brand-kit-actions';
import type { Zone } from './types';

/**
 * The template builder's Brand tab — ACTION-FIRST (owner, 2026-10-12:
 * "branding page is still useless, I can't do anything but add a logo … what
 * does Apply branding actually do?").
 *
 * Every control does ONE visible thing to the canvas, whatever is selected,
 * raises a toast, and is ONE undo step:
 *   - Logo: add it, or move it to a corner / the centre.
 *   - Backgrounds: ready-made from the brand colours → the TEMPLATE background.
 *   - Text: style tiles in the brand fonts + colours → ADD a text box.
 *     Text colour swatches act on the SELECTED text box only (disabled with a
 *     hint otherwise), plus "Recolor all text".
 *   - A selected non-text widget gets "Selected <widget>: Background".
 *   - "Brand this template" lists what it will do BEFORE the click, and offers
 *     Undo after.
 *
 * WHICH BRAND. The template's own kit (Template.brandKit — a per-template
 * website detection, or what a new template inherited at creation) wins;
 * otherwise the organisation brand from Settings → Brand & appearance. With
 * neither (no logo, colour or font) the tab shows only "Set up your brand".
 *
 * The per-template kit stays per-template (2026-04-27): detecting a brand
 * here writes ONLY Template.brandKit, never the tenant theme.
 */

type BrandKit = BrandKitLike & {
  palette?: (BrandKitLike['palette'] & { logoBackground?: string | null }) | null;
};

interface BrandApplySummary {
  widgets: number;
  total: number;
  background: 'gradient' | 'solid' | null;
  fonts: boolean;
  logos: number;
}

const SECTION = 'border-b border-slate-200/60 p-4 space-y-2.5';
const SECTION_TITLE = 'text-[10px] font-bold uppercase tracking-wider text-slate-500';
const HINT = 'text-[10px] text-slate-500 leading-relaxed';

/** Friendly widget name for toasts ("TICKER" → "Ticker"). */
function widgetLabel(wt?: string) {
  if (!wt) return 'widget';
  return wt.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function BrandKitPanel() {
  const t = useTranslations('brandKitPanel');
  const params = useParams<{ schoolId?: string }>();
  const schoolId = params?.schoolId;
  const settingsHref = schoolId ? `/${schoolId}/settings/branding` : '/settings/branding';

  const templateId = useBuilderStore((s) => s.templateId);
  const isSystem = useBuilderStore((s) => s.isSystem);
  const zones = useBuilderStore((s) => s.zones);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const meta = useBuilderStore((s) => s.meta);

  const { data: template, isLoading } = useTemplate(templateId);
  const tenantBrandingQuery = useTenantBranding();
  const adoptMutation = useAdoptTemplateBrandKit(templateId);
  const clearMutation = useClearTemplateBrandKit(templateId);

  const templateKit = ((template as { brandKit?: BrandKit | null } | undefined)?.brandKit ?? null) as BrandKit | null;
  const orgKit = kitFromTenantBranding(tenantBrandingQuery?.data as BrandKit | null | undefined) as BrandKit | null;
  const usingTemplateKit = hasBrand(templateKit);
  const kit: BrandKit | null = usingTemplateKit ? templateKit : hasBrand(orgKit) ? orgKit : null;

  const [placingLogo, setPlacingLogo] = useState(false);
  const [lastApply, setLastApply] = useState<string | null>(null);
  const [pulse, setPulse] = useState<string | null>(null);

  // Website detection (per-template brand).
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scrapePhase, setScrapePhase] = useState<'idle' | 'scanning' | 'applying'>('idle');
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const store = () => useBuilderStore.getState();
  const canvas = { width: meta.screenWidth || 1920, height: meta.screenHeight || 1080 };

  const flash = (text: string, pulseKey?: string) => {
    toast.success(text, { duration: 2500 });
    if (pulseKey) {
      setPulse(pulseKey);
      setTimeout(() => setPulse((cur) => (cur === pulseKey ? null : cur)), 900);
    }
  };
  const info = (text: string) => toast(text, { duration: 3500 });

  /** Selected zones a click may act on — never the seeded EMPTY placeholder, never locked. */
  const selectedZones: Zone[] = selectedIds
    .map((id) => zones.find((z) => z.id === id))
    .filter((z): z is Zone => !!z && z.widgetType !== 'EMPTY' && !z.locked);
  const selectedText = selectedZones.filter((z) => isTextZone(z));
  const selectedOther = selectedZones.filter((z) => !isTextZone(z));

  const colorName = (key: BrandColorKey) => t(`colorNames.${key}`);

  /**
   * addZone selects the new zone itself, and BuilderShell flips the rail to
   * Properties on any selection NOT made from a panel — which threw the
   * operator off the Brand tab after every Add logo / Add text (caught by the
   * browser spec, invisible to jsdom). Marking the selection as panel-made
   * first keeps them here, ready for the next brand action.
   */
  const addZoneFromPanel = (widgetType: string, size: { w: number; h: number }) => {
    useBuilderStore.setState({ selectionSource: 'panel' });
    return store().addZone(widgetType, undefined, size, { replacePlaceholder: true });
  };

  // ── Brand this template ──────────────────────────────────────────────
  const applyBrandToAll = (k: BrandKit): BrandApplySummary => {
    const st = store();
    const summary: BrandApplySummary = { widgets: 0, total: st.zones.filter((z) => z.widgetType !== 'EMPTY').length, background: null, fonts: false, logos: 0 };
    st.beginTransaction();
    try {
      const ids = st.zones.filter((z) => !z.locked).map((z) => z.id);
      if (ids.length > 0) {
        st.updateZones(ids, (z) => {
          const before = JSON.stringify(z.defaultConfig || {});
          const cfg = brandZoneConfig(z, k);
          if (JSON.stringify(cfg) !== before) {
            summary.widgets += 1;
            const brand = cfg.brand as Record<string, unknown> | undefined;
            if ((k.fontHeading || k.fontBody) && (cfg.fontFamily || brand?.fontDisplay || brand?.fontBody)) summary.fonts = true;
            if (z.widgetType === 'LOGO' && k.logoUrl) summary.logos += 1;
          }
          return { defaultConfig: cfg };
        });
      }
      const bg = brandTemplateBackground(k);
      if (bg) {
        st.setMeta(bg);
        summary.background = bg.bgGradient ? 'gradient' : 'solid';
      }
    } finally {
      st.endTransaction();
    }
    return summary;
  };

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

  const undoLast = () => {
    store().undo();
    setLastApply(null);
    toast(t('brandUndone'), { duration: 2500 });
  };

  const handleBrandTemplate = (k: BrandKit) => {
    if (isSystem) return;
    const text = describeApply(applyBrandToAll(k));
    setLastApply(text);
    toast.success(text, { duration: 6000, action: { label: t('undo'), onClick: undoLast } });
  };

  // ── Logo ─────────────────────────────────────────────────────────────
  const findLogoZone = (): Zone | undefined => {
    const st = store();
    const sel = st.selectedIds.map((id) => st.zones.find((z) => z.id === id)).find((z) => z?.widgetType === 'LOGO' && !z.locked);
    return sel ?? st.zones.find((z) => z.widgetType === 'LOGO' && !z.locked);
  };

  const addLogoAt = async (placement: LogoPlacement) => {
    const url = kit?.logoUrl;
    if (!url || placingLogo) return;
    setPlacingLogo(true);
    try {
      const dims = await readMediaDimensions(url, 'image');
      const st = store();
      if (st.templateId !== templateId) return;
      const c = { width: st.meta.screenWidth || 1920, height: st.meta.screenHeight || 1080 };
      const geo = placeBox(placement, logoSize(dims, c), c);
      // addZone pushes the ONE undo snapshot; the placement patch rides along.
      const newId = addZoneFromPanel('LOGO', { w: geo.width, h: geo.height });
      const seeded = store().zones.find((z) => z.id === newId);
      store().updateZone(newId, {
        ...geo,
        defaultConfig: {
          ...(seeded?.defaultConfig || {}),
          assetUrl: url,
          logoUrl: url,
          ...(dims ? { _mediaWidth: dims.width, _mediaHeight: dims.height } : {}),
        },
      }, false);
      store().select([newId], false, { source: 'panel' });
      flash(t('logoAdded', { place: t(`place.${placement}`) }), 'logo');
    } finally {
      setPlacingLogo(false);
    }
  };

  const handleAddLogo = () => {
    const url = kit?.logoUrl;
    if (!url) return;
    const existing = findLogoZone();
    if (existing) {
      store().updateZone(existing.id, { defaultConfig: { ...(existing.defaultConfig || {}), assetUrl: url, logoUrl: url } }, true);
      store().select([existing.id], false, { source: 'panel' });
      flash(t('logoSwapped'), 'logo');
      return;
    }
    void addLogoAt('top-left');
  };

  const handlePlaceLogo = (placement: LogoPlacement) => {
    const existing = findLogoZone();
    if (!existing) { void addLogoAt(placement); return; }
    const geo = placeBox(placement, { width: existing.width, height: existing.height }, canvas);
    store().updateZone(existing.id, { x: geo.x, y: geo.y }, true);
    store().select([existing.id], false, { source: 'panel' });
    flash(t('logoMoved', { place: t(`place.${placement}`) }), `place:${placement}`);
  };

  // ── Backgrounds ──────────────────────────────────────────────────────
  const bgLabel = (b: BrandBackground) =>
    b.labelKey === 'solid' && b.colorKey ? colorName(b.colorKey) : t(`bg.${b.labelKey}`);

  const handleBackground = (b: BrandBackground) => {
    const st = store();
    // A full-canvas packaged board covers the template background, so the
    // operator would see nothing happen: the board's own background follows.
    const boards = st.zones.filter((z) => z.widgetType === 'EXTERNAL_HTML' && !z.locked && z.width * z.height >= 5000);
    st.beginTransaction();
    try {
      st.setMeta({ bgColor: b.bgColor, bgGradient: b.bgGradient, bgImage: '' });
      if (boards.length > 0) {
        st.updateZones(boards.map((z) => z.id), (z) => ({ defaultConfig: colorPatchConfig(z, b.bgColor, 'background') }));
      }
    } finally {
      st.endTransaction();
    }
    flash(t('bgSet', { name: bgLabel(b) }), `bg:${b.id}`);
  };

  // ── Text ─────────────────────────────────────────────────────────────
  const handleAddText = (style: BrandTextStyle) => {
    if (!kit) return;
    const st = store();
    const bgHex = backgroundBaseColor(st.meta);
    const box = brandTextZone(style, kit, bgHex, t(`sample.${style}`), st.zones.filter((z) => z.widgetType === 'TEXT'));
    const newId = addZoneFromPanel('TEXT', { w: box.width, h: box.height });
    const seeded = store().zones.find((z) => z.id === newId);
    store().updateZone(newId, {
      x: box.x, y: box.y, width: box.width, height: box.height,
      name: t(`style.${style}`),
      defaultConfig: { ...(seeded?.defaultConfig || {}), ...box.config },
    }, false);
    // Selected from the PANEL: the operator stays on Brand to pick a colour.
    store().select([newId], false, { source: 'panel' });
    flash(t('textAdded', { style: t(`style.${style}`) }), `style:${style}`);
  };

  const handleTextColor = (hex: string, key: BrandColorKey) => {
    if (selectedText.length === 0) { info(t('textColorNeedsSelection')); return; }
    const ids = selectedText.map((z) => z.id);
    store().updateZones(ids, (z) => ({ defaultConfig: colorPatchConfig(z, hex, 'text') }), true);
    flash(t('textColorApplied', { color: colorName(key) }), `text:${hex}`);
  };

  const handleTextFont = (font: string) => {
    if (selectedText.length === 0) { info(t('textColorNeedsSelection')); return; }
    store().updateZones(selectedText.map((z) => z.id), (z) => ({ defaultConfig: { ...(z.defaultConfig || {}), fontFamily: font } }), true);
    flash(t('fontApplied', { font }), `font:${font}`);
  };

  const handleRecolorAll = () => {
    if (!kit) return;
    const st = store();
    const textZones = st.zones.filter((z) => !z.locked && BRAND_TEXT_WIDGETS.has(z.widgetType));
    if (textZones.length === 0) { info(t('noTextYet')); return; }
    const p = kit.palette || {};
    const pageBg = backgroundBaseColor(st.meta);
    st.updateZones(textZones.map((z) => z.id), (z) => {
      const cfg = z.defaultConfig || {};
      // Text sits on its own fill when it has one (a ticker, a pill), else the page.
      const own = typeof cfg.bgColor === 'string' && /^#[0-9a-f]{6}$/i.test(cfg.bgColor) ? cfg.bgColor : null;
      const bg = own ?? pageBg;
      const bold = cfg.bold === true || (typeof cfg.fontSize === 'number' && cfg.fontSize >= 34);
      const color = bold ? readableOn(bg, [p.primary, p.accent, p.ink], 3, p.ink) : readableOn(bg, [p.ink], 4.5, p.ink);
      return { defaultConfig: colorPatchConfig(z, color, 'text') };
    }, true);
    flash(t('allTextColored', { count: textZones.length }), 'recolor');
  };

  // ── Selected non-text widget: background ─────────────────────────────
  const handleSelectedBackground = (hex: string, key: BrandColorKey) => {
    if (selectedOther.length === 0) return;
    store().updateZones(selectedOther.map((z) => z.id), (z) => ({ defaultConfig: colorPatchConfig(z, hex, 'background') }), true);
    const name = selectedOther.length === 1 ? widgetLabel(selectedOther[0].widgetType) : t('nWidgets', { count: selectedOther.length });
    flash(t('selectedBgApplied', { widget: name, color: colorName(key) }), `sel:${hex}`);
  };

  // ── Palette copy ─────────────────────────────────────────────────────
  const copyText = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(done);
    } catch {
      info(t('copyFailed', { text }));
    }
  };

  // ── Website detection (per-template) ─────────────────────────────────
  const handleScrape = async () => {
    const raw = scrapeUrl.trim();
    if (!raw) return;
    if (!templateId) { setScrapeError(t('detectSaveFirst')); return; }
    if (isSystem) { setScrapeError(t('systemNote')); return; }
    const finalUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setScrapeError(null);
    setScrapePhase('scanning');
    try {
      const preview = await apiFetch<Record<string, unknown> & { palette?: unknown; colors?: unknown[]; logos?: unknown[] }>('/branding/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: finalUrl }),
      });
      if (!preview || (!preview.palette && !preview.colors?.length && !preview.logos?.length)) {
        throw new Error(t('detectNotFound'));
      }
      setScrapePhase('applying');
      const result = await adoptMutation.mutateAsync({ ...preview, palette: preview.palette });
      const adopted = ((result as { brandKit?: BrandKit } | undefined)?.brandKit ?? { ...preview }) as BrandKit;
      if (hasBrand(adopted)) handleBrandTemplate(adopted);
      setScrapeUrl('');
    } catch (err) {
      setScrapeError(err instanceof Error && err.message ? err.message : t('detectFailed'));
    } finally {
      setScrapePhase('idle');
    }
  };

  const handleClear = async () => {
    if (!templateId) return;
    if (!(await appConfirm({
      title: t('clearTitle'),
      // Codex T05: the endpoint clears only the kit; what is on the canvas stays.
      message: t('clearMessage'),
      confirmLabel: t('clearConfirm'),
      tone: 'danger',
    }))) return;
    try {
      await clearMutation.mutateAsync();
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : t('detectFailed'));
    }
  };

  const detectForm = (
    <div className="space-y-2">
      <input
        type="text"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-label={t('detectLabel')}
        placeholder={t('detectPlaceholder')}
        value={scrapeUrl}
        onChange={(e) => setScrapeUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void handleScrape(); }}
        disabled={scrapePhase !== 'idle' || isSystem}
        className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50 disabled:text-slate-400"
      />
      <button
        type="button"
        onClick={() => void handleScrape()}
        disabled={!scrapeUrl.trim() || scrapePhase !== 'idle' || isSystem}
        className="w-full px-2 py-1.5 rounded border border-indigo-200 bg-white text-indigo-700 text-xs font-semibold hover:bg-indigo-50 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed transition-colors"
      >
        {scrapePhase === 'scanning' ? t('detectScanning') : scrapePhase === 'applying' ? t('detectSaving') : t('detectButton')}
      </button>
      {scrapeError && <div className="text-[11px] text-red-600 leading-relaxed" role="alert">{scrapeError}</div>}
    </div>
  );

  if (isLoading || !templateId) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <div className="text-xs">{t('loading')}</div>
      </div>
    );
  }

  // ── No brand at all: one card, nothing else ──────────────────────────
  if (!kit) {
    return (
      <div className="flex flex-col h-full p-4 gap-4 overflow-y-auto" data-testid="brand-setup">
        <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-4 space-y-3 text-center">
          <div className="mx-auto w-10 h-10 rounded-full bg-white flex items-center justify-center text-indigo-600 shadow-sm">
            <Palette className="w-5 h-5" aria-hidden />
          </div>
          <h3 className="text-sm font-bold text-slate-800">{t('setupTitle')}</h3>
          <p className="text-[11px] text-slate-600 leading-relaxed">{t('setupBody')}</p>
          <a
            href={settingsHref}
            className="inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            {t('setupCta')}
          </a>
        </div>
        <details className="rounded-lg border border-slate-200 p-3 text-left">
          <summary className="cursor-pointer text-[11px] font-semibold text-slate-600">{t('setupOrDetect')}</summary>
          <div className="pt-3">{detectForm}</div>
        </details>
      </div>
    );
  }

  // ── Brand set up ─────────────────────────────────────────────────────
  const palette = kit.palette || {};
  const colors = brandColors(palette);
  const backgrounds = brandBackgrounds(palette);
  const checklist = brandChecklist(kit);
  const fontHeading = kit.fontHeading || kit.fontBody || undefined;
  const fontBody = kit.fontBody || kit.fontHeading || undefined;
  const logoChipBackdrop = logoBackdrop(readLogoBackground(kit), 'unknown');
  const logoZone = zones.find((z) => z.widgetType === 'LOGO' && !z.locked);
  const activePlacement = logoZone ? currentPlacement(logoZone, canvas) : null;
  const currentBg = `${meta.bgColor || ''}|${meta.bgGradient || ''}`;
  const pageBg = backgroundBaseColor(meta);
  const fontsLabel = [kit.fontHeading, kit.fontBody].filter((f, i, a): f is string => !!f && a.indexOf(f) === i).join(' + ');
  const otherName = selectedOther.length === 1 ? widgetLabel(selectedOther[0].widgetType) : t('nWidgets', { count: selectedOther.length });

  const swatchButton = (
    c: { key: BrandColorKey; hex: string },
    onClick: () => void,
    opts: { label: string; disabled?: boolean; pulseKey: string },
  ) => (
    <button
      key={c.hex}
      type="button"
      onClick={onClick}
      disabled={opts.disabled}
      aria-label={opts.label}
      title={opts.label}
      className={cn(
        'w-8 h-8 rounded-md border border-black/10 transition-all hover:ring-2 hover:ring-offset-1 hover:ring-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:ring-0',
        pulse === opts.pulseKey && 'ring-2 ring-offset-1 ring-emerald-500 scale-110',
      )}
      style={{ backgroundColor: c.hex }}
    />
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto" data-testid="brand-panel">
      {/* ── Live preview card + palette quick copy ── */}
      <div className="p-4 border-b border-slate-200/60 space-y-3">
        <div
          className="rounded-xl overflow-hidden border border-slate-200 shadow-sm"
          style={{ background: palette.surface || '#ffffff' }}
          data-testid="brand-preview"
        >
          <div className="h-1.5 flex" aria-hidden>
            {colors.map((c) => <span key={c.hex} className="flex-1" style={{ background: c.hex }} />)}
          </div>
          <div className="p-3 flex items-center gap-3">
            {kit.logoUrl && (
              <div
                className={cn('w-12 h-12 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0', logoChipBackdrop.className, logoChipBackdrop.inkClass)}
                style={Object.keys(logoChipBackdrop.style).length ? logoChipBackdrop.style : { background: '#f8fafc' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={kit.logoUrl} alt={t('logoAlt')} className="max-w-full max-h-full object-contain" draggable={false} />
              </div>
            )}
            <div className="min-w-0">
              <div
                className="text-base font-bold leading-tight truncate"
                style={{ fontFamily: fontHeading, color: readableOn(palette.surface || '#ffffff', [palette.primary, palette.ink], 3, palette.ink) }}
              >
                {kit.displayName || t('sample.heading')}
              </div>
              <div className="text-[11px] leading-snug" style={{ fontFamily: fontBody, color: readableOn(palette.surface || '#ffffff', [palette.ink], 4.5, palette.ink) }}>
                {t('previewBody')}
              </div>
            </div>
          </div>
        </div>
        {colors.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {colors.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => void copyText(c.hex, t('copied', { color: c.hex }))}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white pl-1 pr-2 py-0.5 text-[10px] font-mono text-slate-600 hover:border-indigo-300"
                  aria-label={t('copyHex', { name: colorName(c.key), color: c.hex })}
                  title={t('copyHex', { name: colorName(c.key), color: c.hex })}
                >
                  <span className="w-3 h-3 rounded-full border border-black/10" style={{ background: c.hex }} aria-hidden />
                  {c.hex}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void copyText(colors.map((c) => `${colorName(c.key)} ${c.hex}`).join('\n'), t('paletteCopied'))}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800"
            >
              <Copy className="w-3 h-3" aria-hidden />
              {t('copyPalette')}
            </button>
          </div>
        )}
        <div className="text-[10px] text-slate-400 leading-relaxed">
          {usingTemplateKit ? t('sourceTemplate') : t('sourceOrg')}{' '}
          <a href={settingsHref} className="underline text-indigo-600 hover:text-indigo-700">{t('editInSettings')}</a>
        </div>
      </div>

      {/* ── Brand this template ── */}
      <div className={cn(SECTION, 'bg-gradient-to-br from-indigo-50/70 to-violet-50/70')}>
        <div className={SECTION_TITLE}>{t('brandTitle')}</div>
        <div className={HINT}>{t('brandIntro')}</div>
        <ul className="space-y-1" data-testid="brand-checklist">
          {checklist.map((item) => (
            <li key={item} className="flex items-start gap-1.5 text-[11px] text-slate-700">
              <Check className="w-3.5 h-3.5 mt-px text-emerald-600 flex-shrink-0" aria-hidden />
              <span>{item === 'fonts' ? t('check.fonts', { fonts: fontsLabel }) : t(`check.${item}`)}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => handleBrandTemplate(kit)}
          disabled={isSystem}
          className="w-full px-3 py-2 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden />
          {t('brandButton')}
        </button>
        {lastApply && (
          <div className="flex items-start gap-2 text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5" role="status">
            <span className="flex-1 leading-relaxed">{lastApply}</span>
            <button type="button" onClick={undoLast} className="inline-flex items-center gap-1 font-semibold text-emerald-900 underline">
              <Undo2 className="w-3 h-3" aria-hidden />
              {t('undo')}
            </button>
          </div>
        )}
        {isSystem && <div className="text-[10px] text-amber-700 leading-relaxed">{t('systemNote')}</div>}
      </div>

      {/* ── Logo ── */}
      <div className={SECTION}>
        <div className={SECTION_TITLE}>{t('logoTitle')}</div>
        {kit.logoUrl ? (
          <button
            type="button"
            onClick={handleAddLogo}
            disabled={isSystem || placingLogo}
            className={cn(
              'w-full px-3 py-2 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2',
              pulse === 'logo' && 'ring-2 ring-emerald-400 ring-offset-1',
            )}
          >
            <ImagePlus className="w-3.5 h-3.5" aria-hidden />
            {placingLogo ? t('placingLogo') : logoZone ? t('swapLogo') : t('addLogo')}
          </button>
        ) : (
          <div className={HINT}>{t('noLogo')}</div>
        )}
        <div role="group" aria-label={t('placementLabel')} className="grid grid-cols-3 gap-1.5">
          {LOGO_PLACEMENTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => handlePlaceLogo(p)}
              disabled={isSystem || placingLogo || (!logoZone && !kit.logoUrl)}
              aria-pressed={activePlacement === p}
              className={cn(
                'px-1.5 py-1 rounded-md border text-[10px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                p === 'center' && 'col-start-2 row-start-2',
                p === 'bottom-left' && 'col-start-1 row-start-3',
                p === 'bottom-right' && 'col-start-3 row-start-3',
                p === 'top-right' && 'col-start-3 row-start-1',
                activePlacement === p ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                pulse === `place:${p}` && 'ring-2 ring-emerald-400',
              )}
            >
              {t(`place.${p}`)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Backgrounds ── */}
      {backgrounds.length > 0 && (
        <div className={SECTION}>
          <div className={SECTION_TITLE}>{t('bgTitle')}</div>
          <div className="grid grid-cols-4 gap-2" data-testid="brand-backgrounds">
            {backgrounds.map((b) => {
              const active = currentBg === `${b.bgColor}|${b.bgGradient}`;
              const label = bgLabel(b);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => handleBackground(b)}
                  aria-pressed={active}
                  aria-label={t('bgTile', { name: label })}
                  title={label}
                  data-bg-id={b.id}
                  className={cn(
                    'aspect-video rounded-md border border-black/10 transition-all hover:ring-2 hover:ring-offset-1 hover:ring-indigo-400',
                    active && 'ring-2 ring-offset-1 ring-indigo-600',
                    pulse === `bg:${b.id}` && 'ring-2 ring-offset-1 ring-emerald-500',
                  )}
                  style={{ background: b.preview }}
                />
              );
            })}
          </div>
          <div className={HINT}>{t('bgHint')}</div>
        </div>
      )}

      {/* ── Text ── */}
      <div className={SECTION}>
        <div className={SECTION_TITLE}>{t('textTitle')}</div>
        <div className="space-y-1.5" data-testid="brand-text-styles">
          {BRAND_TEXT_STYLES.map((style) => {
            const sample = brandTextZone(style, kit, pageBg, '').config;
            const isCta = style === 'cta';
            const sizePx = { heading: 20, subheading: 16, body: 13, caption: 11, cta: 13 }[style];
            return (
              <button
                key={style}
                type="button"
                onClick={() => handleAddText(style)}
                aria-label={t('addStyle', { style: t(`style.${style}`) })}
                className={cn(
                  'w-full rounded-md border border-slate-200 px-3 py-2 text-left transition-all hover:border-indigo-300 hover:shadow-sm',
                  pulse === `style:${style}` && 'ring-2 ring-emerald-400',
                )}
                style={{ background: isCta ? '#ffffff' : pageBg }}
              >
                {isCta ? (
                  <span
                    className="inline-block rounded-full px-3 py-1 font-bold"
                    style={{ background: String(sample.bgColor), color: String(sample.color), fontFamily: String(sample.fontFamily || '') || undefined, fontSize: sizePx }}
                  >
                    {t('style.cta')}
                  </span>
                ) : (
                  <span
                    className="block truncate"
                    style={{ color: String(sample.color), fontFamily: String(sample.fontFamily || '') || undefined, fontSize: sizePx, fontWeight: sample.bold ? 800 : 500 }}
                  >
                    {t(`style.${style}`)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className={HINT}>{t('textHint')}</div>

        <div className="pt-2 space-y-1.5" role="group" aria-label={t('textColorTitle')}>
          <div className="text-[10px] font-semibold text-slate-600">{t('textColorTitle')}</div>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => swatchButton(c, () => handleTextColor(c.hex, c.key), {
              label: t('textColorSwatch', { name: colorName(c.key), color: c.hex }),
              disabled: selectedText.length === 0,
              pulseKey: `text:${c.hex}`,
            }))}
          </div>
          {selectedText.length === 0 ? (
            <div className={HINT}>{t('textColorNeedsSelection')}</div>
          ) : (fontHeading || fontBody) && (
            <div className="flex flex-wrap gap-1.5">
              {[kit.fontHeading, kit.fontBody].filter((f, i, a): f is string => !!f && a.indexOf(f) === i).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => handleTextFont(f)}
                  className={cn('rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50', pulse === `font:${f}` && 'ring-2 ring-emerald-400')}
                  style={{ fontFamily: f }}
                >
                  {t('useFont', { font: f })}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={handleRecolorAll}
            className={cn('mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50', pulse === 'recolor' && 'ring-2 ring-emerald-400')}
          >
            {t('recolorAll')}
          </button>
          <div className={HINT}>{t('recolorAllHint')}</div>
        </div>
      </div>

      {/* ── Selected non-text widget: background ── */}
      {selectedOther.length > 0 && colors.length > 0 && (
        <div className={SECTION} data-testid="brand-selected-bg">
          <div className="text-[10px] font-semibold text-slate-600">{t('selectedBgTitle', { widget: otherName })}</div>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => swatchButton(c, () => handleSelectedBackground(c.hex, c.key), {
              label: t('selectedBgSwatch', { widget: otherName, name: colorName(c.key), color: c.hex }),
              pulseKey: `sel:${c.hex}`,
            }))}
          </div>
        </div>
      )}

      {/* ── Footer: per-template brand ── */}
      <div className="p-3 bg-slate-50 space-y-2 mt-auto">
        <details>
          <summary className="cursor-pointer text-[10px] font-semibold text-slate-500">{t('detectOther')}</summary>
          <div className="pt-2">{detectForm}</div>
        </details>
        {usingTemplateKit && (
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={clearMutation.isPending}
            className="w-full text-[10px] text-slate-500 hover:text-red-600 disabled:text-slate-300 transition-colors py-1"
          >
            {clearMutation.isPending ? t('clearing') : t('clearTemplateKit')}
          </button>
        )}
      </div>
    </div>
  );
}
