/**
 * BrandingWizard — the flagship "paste your school's URL and watch the
 * CMS re-skin itself in real time" experience. Reused across:
 *   • /demo/branding      — public, no auth, non-persisting
 *   • /onboarding/branding — first-run wizard
 *   • /settings/branding  — re-run / tweak later
 *
 * The left pane is the scrape + manual tweaker. The right pane is a
 * live mini-admin-chrome preview that repaints on every palette change
 * within a debounced 120ms. On adopt, we POST /branding/adopt and fire
 * a `branding:update` event so BrandStyleInjector repaints the real
 * admin UI instantly.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import DOMPurify from 'dompurify';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import { API_URL } from '@/lib/api-url';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { pushBrandingPreview } from './BrandStyleInjector';
import { useAppStore } from '@/lib/store';
import { useInvalidateTenantBranding, useApplyBrandToTemplates } from '@/hooks/use-api';
import { BrandingLivePreview } from './BrandingLivePreview';
import { useLogoTone } from './useLogoTone';
// 2026-05-25 — Operator chose to remove both AI sparkle icons +
// the Wand2 magic icons here. The /settings/branding page header
// has the Paintbrush; the wizard inside doesn't need to repeat
// any icon vocabulary.
// 2026-05-26 — Wand2 re-added: operator asked to relocate the
// "Apply brand to all templates" action OUT of the bottom card
// and INTO the wizard as a compact inline row above the Re-scan /
// Adopt toolbar. Wand2 = "magic auto-paint" (non-AI automation),
// matches the icon used previously in BrandingSettingsCard.
import { Search, Palette, Check, Loader2, ExternalLink, AlertTriangle, RefreshCw, Monitor, Eye, Wand2, Upload, Link2, X } from 'lucide-react';

// Scraped SVGs come from arbitrary third-party URLs — treat every one
// as hostile until proven otherwise. Server also sanitizes on adopt,
// but we must not render dirty markup even in the preview step.
const SVG_SANITIZE_OPTS = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'style', 'foreignObject'],
} as const;
function sanitizeSvg(raw: string): string {
  return DOMPurify.sanitize(raw, SVG_SANITIZE_OPTS as any) as unknown as string;
}

export interface BrandingWizardProps {
  /** If 'demo', we hit /branding/demo/scrape and disable the Adopt button. */
  mode: 'demo' | 'authed';
  /** Initial values (e.g. existing branding when editing from /settings). */
  initial?: Partial<BrandingPreview> | null;
  /** After a successful adopt. */
  onAdopted?: (b: any) => void;
  /**
   * Tenant vertical — drives which industry-appropriate sample URLs we
   * show under the input. Falls back to K12 (the default vertical) so
   * old call sites + demo mode still get useful examples. The verticals
   * align with packages/api-types/src/verticals.ts.
   */
  vertical?: string | null;
}

// ── Types (mirror of server BrandingPreview) ──────────────────────

export type BrandingPreview = {
  sourceUrl: string;
  finalUrl: string;
  displayName: string | null;
  tagline: string | null;
  logos: Array<{ url: string; kind: string; score: number; isSvg?: boolean; svgInline?: string; width?: number; height?: number }>;
  favicon: string | null;
  ogImage: string | null;
  colors: Array<{ hex: string; score: number; isCustomProp?: boolean; sampleSelector?: string }>;
  palette: any;
  fonts: {
    heading: { family: string; googleFont: string | null; score: number } | null;
    body: { family: string; googleFont: string | null; score: number } | null;
    all: Array<{ family: string; googleFont: string | null; score: number }>;
  };
  fontsCssUrl: string | null;
  heroImages: Array<{ url: string }>;
  confidence: { logo: number; palette: number; fonts: number; displayName: number; overall: number };
  warnings: string[];
  rawSnapshot?: unknown;
  scrapedAt: string;
  durationMs: number;
};

/**
 * Industry-specific sample URLs. Hand-curated for sites known to allow
 * static scraping (favoring `.edu`, `.org`, and brands without aggressive
 * Cloudflare/Akamai bot protection — the ones that DO block us return
 * the friendly BRANDING_BLOCKED error from branding-scraper.service.ts
 * with actionable copy, so even a sample fail is graceful).
 *
 * 2026-05-25 — operator: "im giving lausd as a sample url but that wont
 * even work so thats not great, also your only giving schools, give
 * samples based on what industry is selected." LAUSD (Cloudflare) +
 * NYC DOE (also Cloudflare) removed; per-vertical lists added below.
 *
 * Verified scrape OK on 2026-05-25 against the live demo endpoint:
 *   • lcsnc.org (K12, 48% confidence, 4 colors)
 *   • harvard.edu (K12, 82% confidence, 8 colors)
 *   • stanford.edu (K12, 86% confidence, 8 colors)
 * Other entries are best-effort picks based on the scraper's known-
 * friendly patterns; if one is blocked the operator sees the
 * "Cloudflare bot protection" message and can pick another or paste
 * their own. When adding NEW samples to this map, run the URL through
 * `POST /branding/demo/scrape` first — silent-fail URLs make the
 * feature feel broken at first impression.
 */
type SampleUrl = { label: string; url: string };
const EXAMPLES_BY_VERTICAL: Record<string, SampleUrl[]> = {
  K12: [
    { label: 'Lincoln County (NC)', url: 'https://www.lcsnc.org/' },
    { label: 'Harvard', url: 'https://www.harvard.edu/' },
    { label: 'Stanford', url: 'https://www.stanford.edu/' },
  ],
  GYM: [
    { label: 'Equinox', url: 'https://www.equinox.com/' },
    { label: 'Crunch Fitness', url: 'https://www.crunch.com/' },
    { label: 'CorePower Yoga', url: 'https://www.corepoweryoga.com/' },
  ],
  RETAIL: [
    { label: 'Patagonia', url: 'https://www.patagonia.com/' },
    { label: 'REI', url: 'https://www.rei.com/' },
    { label: 'Warby Parker', url: 'https://www.warbyparker.com/' },
  ],
  CORPORATE: [
    { label: 'IBM', url: 'https://www.ibm.com/' },
    { label: 'Salesforce', url: 'https://www.salesforce.com/' },
    { label: 'HubSpot', url: 'https://www.hubspot.com/' },
  ],
  QSR: [
    { label: 'Chipotle', url: 'https://www.chipotle.com/' },
    { label: 'Five Guys', url: 'https://www.fiveguys.com/' },
    { label: 'Shake Shack', url: 'https://www.shakeshack.com/' },
  ],
  FASHION: [
    { label: 'Madewell', url: 'https://www.madewell.com/' },
    { label: 'Everlane', url: 'https://www.everlane.com/' },
    { label: 'Bonobos', url: 'https://bonobos.com/' },
  ],
  BAR: [
    { label: 'Sam Adams', url: 'https://www.samueladams.com/' },
    { label: 'Stone Brewing', url: 'https://www.stonebrewing.com/' },
    { label: 'Dogfish Head', url: 'https://www.dogfish.com/' },
  ],
  HEALTHCARE: [
    // 2026-05-25 spot-check: mayoclinic.org returns BRANDING_BLOCKED
    // (Cloudflare bot protection). Swapped for Johns Hopkins (academic
    // medical center, lighter WAF) + One Medical (consumer health,
    // open marketing site). Cleveland Clinic / Kaiser kept; if either
    // turns out to also be blocked the operator gets the friendly
    // "bot protection" message and can try the next one.
    { label: 'Johns Hopkins', url: 'https://www.hopkinsmedicine.org/' },
    { label: 'Cleveland Clinic', url: 'https://my.clevelandclinic.org/' },
    { label: 'One Medical', url: 'https://www.onemedical.com/' },
  ],
  HOSPITALITY: [
    // 2026-05-25 spot-check: marriott.com returns BRANDING_BLOCKED
    // (Akamai bot protection). Swapped for Wyndham (lighter WAF) +
    // Kimpton (mid-scale, brand subdomain). Hyatt kept; if blocked,
    // the friendly fallback covers it.
    { label: 'Hyatt', url: 'https://www.hyatt.com/' },
    { label: 'Wyndham', url: 'https://www.wyndhamhotels.com/' },
    { label: 'Kimpton Hotels', url: 'https://www.kimptonhotels.com/' },
  ],
  RESTAURANT: [
    { label: 'Olive Garden', url: 'https://www.olivegarden.com/' },
    { label: 'Texas Roadhouse', url: 'https://www.texasroadhouse.com/' },
    { label: 'Cracker Barrel', url: 'https://www.crackerbarrel.com/' },
  ],
  SPORTS: [
    { label: 'MLB', url: 'https://www.mlb.com/' },
    { label: 'NBA', url: 'https://www.nba.com/' },
    { label: 'NCAA', url: 'https://www.ncaa.com/' },
  ],
  WORSHIP: [
    { label: 'Life.Church', url: 'https://www.life.church/' },
    { label: 'Saddleback', url: 'https://saddleback.com/' },
    { label: "The Potter's House", url: 'https://thepottershouse.org/' },
  ],
};

function examplesForVertical(vertical?: string | null): SampleUrl[] {
  const key = (vertical || 'K12').toUpperCase();
  return EXAMPLES_BY_VERTICAL[key] || EXAMPLES_BY_VERTICAL.K12;
}

export function BrandingWizard({ mode, initial, onAdopted, vertical }: BrandingWizardProps) {
  const router = useRouter();
  const examples = useMemo(() => examplesForVertical(vertical), [vertical]);
  // 2026-05-25 — operator: "i can only select the primary color from
  // [the swatches] and not the secondary, that can only be selected
  // from the picker and not from the main colors we find and present."
  // Added a toggle above the swatch grid that decides which slot the
  // NEXT swatch click writes to. Default = Primary (matches old
  // behavior). Toggle to Accent → next click fills accent. The two
  // picker rows above keep working unchanged.
  const [swatchTarget, setSwatchTarget] = useState<'primary' | 'accent'>('primary');
  // BrandStyleInjector reads the LS cache per-tenant as
  // `edu-cms-branding-cache-v1:<tenantId>` (see commit 14a91fa which
  // fixed a cross-tenant theme bleed). We must write to the same key on
  // adopt or the next route render reads nothing and paints defaults
  // (the "every deploy wipes my custom logo" bug). Fall back to the
  // legacy single key in demo mode where there is no user.
  const user = useAppStore((s) => s.user);
  // Refresh the shared `/branding/me` cache after a successful Adopt
  // so the Sidebar header, dashboard hero, BrandingSettingsCard, and
  // BrandStyleInjector repaint with the new row in lockstep — no
  // staleTime wait, no per-component fetch.
  const invalidateBranding = useInvalidateTenantBranding();
  // 2026-05-26 — scan-cache: persist the FULL BrandingPreview shape
  // (logos[], colors[], fonts.all[]) per tenant in localStorage so the
  // "Logos found" grid + "Colors discovered" swatches stay visible
  // after Adopt, after page reload, until the operator re-scrapes a
  // new URL OR resets the brand. Operator: "i adopt it and those go
  // away, dont have them go away, keep this visible always until i
  // rescan a new site or i revert the branding."
  //
  // `initial` carries the TenantBranding shape (logoUrl, palette,
  // fonts) but NOT the rich BrandingPreview (logos array, color
  // candidates). Before this cache, those rich fields lived only in
  // React state for the lifetime of the wizard mount — gone the
  // moment you closed the page.
  const scanCacheKey = useMemo(() => {
    const tid = user?.tenantId || 'demo';
    return `edu-cms-branding-scan-cache-v1:${tid}`;
  }, [user?.tenantId]);
  // Read cached scan ONCE on mount; subsequent renders use React state.
  const hydratedScan = useMemo<BrandingPreview | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(scanCacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Sanity-check the shape so a corrupted cache doesn't crash render.
      if (!parsed || typeof parsed !== 'object') return null;
      if (!Array.isArray(parsed.logos) && !Array.isArray(parsed.colors)) return null;
      return parsed as BrandingPreview;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run-once on mount

  const [url, setUrl] = useState<string>(initial?.sourceUrl || hydratedScan?.sourceUrl || '');
  const [scraping, setScraping] = useState(false);
  const [adopting, setAdopting] = useState(false);
  // Prefer initial (just-adopted brand from /branding/me) for palette/logo,
  // BUT merge in the cached scan results so logos[] + colors[] survive.
  const [preview, setPreview] = useState<BrandingPreview | null>(() => {
    const base = (initial as any) || null;
    if (!base && !hydratedScan) return null;
    if (!base) return hydratedScan;
    if (!hydratedScan) return base;
    return {
      ...hydratedScan,
      ...base,
      // initial wins for ALREADY-ADOPTED fields (palette, displayName)
      // hydratedScan wins for RICH-SCAN fields (logos, colors candidates,
      // fonts.all). This way the wizard shows the adopted brand on the
      // left + the picker grids on the right.
      logos: (base.logos && base.logos.length) ? base.logos : hydratedScan.logos || [],
      colors: (base.colors && base.colors.length) ? base.colors : hydratedScan.colors || [],
      fonts: base.fonts || hydratedScan.fonts || { heading: null, body: null, all: [] },
    };
  });
  const [error, setError] = useState<string | null>(null);
  const [selectedLogoIdx, setSelectedLogoIdx] = useState(0);
  // Manual logo escape hatch — for sites that block our scraper (e.g.
  // Cloudflare-protected dominos.com). `uploadedLogo` is a data URL from a
  // file picker (wins); `manualLogoUrl` is a pasted direct image URL.
  const [uploadedLogo, setUploadedLogo] = useState<string | null>(null);
  const [manualLogoUrl, setManualLogoUrl] = useState('');
  const [displayName, setDisplayName] = useState(initial?.displayName || '');
  const [tagline, setTagline] = useState(initial?.tagline || '');
  const [primary, setPrimary] = useState<string>((initial as any)?.palette?.primary || '#4f46e5');
  const [accent, setAccent] = useState<string>((initial as any)?.palette?.accent || '#ec4899');
  const [derivedPalette, setDerivedPalette] = useState<any>((initial as any)?.palette || null);

  // 2026-05-26 — Apply-to-templates (Wand2) state. Lives inside the
  // wizard now (was in BrandingSettingsCard's bottom card) so the
  // re-paint-templates action sits immediately above Re-scan / Adopt
  // where the operator's eye already is. Only rendered when `initial`
  // is set (= a brand has already been adopted — applying to templates
  // before adoption would race the Adopt POST).
  const applyBrand = useApplyBrandToTemplates();
  const [applyMode, setApplyMode] = useState<'fill-blanks' | 'override'>('fill-blanks');
  const [applyDoneMsg, setApplyDoneMsg] = useState<string | null>(null);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  // 2026-05-26 — operator wants to see WHICH templates got branded,
  // not just a count. Server now returns the list; we stash it here
  // to render below the success toast.
  const [appliedTemplates, setAppliedTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const isEditingAdopted = mode === 'authed' && !!initial;

  const debounceRef = useRef<any>(null);

  // ── Scrape handler ──────────────────────────────────────────────
  const runScrape = useCallback(async (targetUrl?: string) => {
    const u = (targetUrl ?? url).trim();
    if (!u) { setError('Paste a URL first'); return; }
    // Auto-prepend https:// if missing
    const finalUrl = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    setError(null);
    setScraping(true);
    try {
      // API_URL already includes /api/v1, so just append the route segment
      const path = mode === 'demo' ? '/branding/demo/scrape' : '/branding/scrape';
      const body = JSON.stringify({ url: finalUrl });
      // demo endpoint is unauth'd; skip apiFetch's auth header to avoid 401 loop
      const res = mode === 'demo'
        ? await fetch(`${API_URL}${path}`, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })
        : { ok: true, json: () => apiFetch<BrandingPreview>(path, { method: 'POST', body }) };
      const data = mode === 'demo'
        ? (res as Response).ok ? await (res as Response).json() : await (async () => { throw new Error((await (res as Response).text()) || 'Scrape failed'); })()
        : await (res as any).json();
      setPreview(data);
      setDisplayName(data.displayName || '');
      setTagline(data.tagline || '');
      setSelectedLogoIdx(0);
      const p = data.palette?.primary || data.colors?.[0]?.hex || '#4f46e5';
      const a = data.palette?.accent || data.colors?.[1]?.hex;
      setPrimary(p);
      if (a) setAccent(a);
      setDerivedPalette(data.palette);
      // Persist the rich scan to localStorage so the "Logos found" +
      // "Colors discovered" grids survive page reloads and post-Adopt
      // re-renders. Operator can come back later to swap logo or pick
      // a different accent without re-scraping.
      try {
        if (typeof window !== 'undefined' && mode === 'authed') {
          localStorage.setItem(scanCacheKey, JSON.stringify(data));
        }
      } catch {
        // QuotaExceededError, etc. — non-fatal, just lose the cache.
      }
    } catch (e: any) {
      setError(e?.message || 'Scrape failed');
      setPreview(null);
    } finally {
      setScraping(false);
    }
  }, [url, mode, scanCacheKey]);

  // ── Debounced palette recompute when user tweaks primary/accent ──
  useEffect(() => {
    if (!preview) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = mode === 'demo'
          ? await (async () => {
              // Demo mode runs math client-side so we don't need auth
              const { derivePaletteClient } = await import('./palette-client');
              return derivePaletteClient(primary, accent);
            })()
          : await apiFetch<any>('/branding/derive-palette', {
              method: 'POST',
              body: JSON.stringify({ primaryHex: primary, accentHex: accent }),
            });
        setDerivedPalette(res);
      } catch {}
    }, 120);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [primary, accent, preview, mode]);

  // ── Manual logo (upload) — escape hatch when the scraper is blocked
  // (Cloudflare) or returns no usable logo. dominos.com, 2026-05-31. ──
  const handleLogoFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!/^image\//.test(file.type)) { setError('Please choose an image file (PNG, JPG, SVG, or WebP).'); return; }
    if (file.size > 2 * 1024 * 1024) { setError('That logo is too large — max 2MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      setManualLogoUrl('');
      setUploadedLogo(typeof reader.result === 'string' ? reader.result : null);
    };
    reader.onerror = () => setError('Could not read that file — try another.');
    reader.readAsDataURL(file);
  }, []);

  // ── Adopt ──────────────────────────────────────────────────────
  const adopt = useCallback(async () => {
    if (!preview || !derivedPalette) return;
    setAdopting(true);
    try {
      const chosen = preview.logos[selectedLogoIdx];
      const manualUrl = manualLogoUrl.trim();
      const payload: Record<string, unknown> = {
        ...preview,
        displayName: displayName || preview.displayName,
        tagline: tagline || preview.tagline,
        palette: derivedPalette,
      };
      // Logo precedence: uploaded file → pasted URL → scraped candidate.
      if (uploadedLogo) {
        payload.logoDataUrl = uploadedLogo;
      } else if (manualUrl) {
        payload.logoOverride = { url: manualUrl };
      } else if (chosen) {
        payload.logoOverride = { url: chosen.url, svgInline: chosen.svgInline };
      }
      const res = await apiFetch<any>('/branding/adopt', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      // Belt-and-suspenders: dispatch the live-update event AND seed the
      // LS cache BrandStyleInjector reads on mount. Previously, if the
      // user navigated before the event fired (e.g. onAdopted redirect),
      // the next render repainted from empty cache and fell back to
      // defaults until the next /branding/me poll. Writing the cache
      // here guarantees the next route renders with the new theme.
      //
      // KEY: scope by tenantId (matches BrandStyleInjector + Sidebar).
      // The legacy global key is ALSO written as a demo-mode fallback
      // and for tabs whose user hydration races the adopt call.
      try {
        const json = JSON.stringify(res.branding);
        const tenantId = user?.tenantId;
        if (tenantId) localStorage.setItem(`edu-cms-branding-cache-v1:${tenantId}`, json);
        else localStorage.setItem('edu-cms-branding-cache-v1', json);
      } catch {}
      pushBrandingPreview(res.branding);
      // Tell the shared `/branding/me` cache to refetch so every
      // subscriber (Sidebar, dashboard hero, settings card, brand
      // style injector) gets the post-adopt row from the server — not
      // a 60-second-stale view of the pre-adopt state.
      invalidateBranding();
      onAdopted?.(res.branding);
    } catch (e: any) {
      setError(e?.message || 'Adopt failed');
    } finally {
      setAdopting(false);
    }
  }, [preview, derivedPalette, selectedLogoIdx, displayName, tagline, uploadedLogo, manualLogoUrl, onAdopted, invalidateBranding, user?.tenantId]);

  // 2026-05-26 — Apply-to-templates: repaint every template the tenant
  // owns with the current palette + fonts. Fill-blanks (default) only
  // touches zones still on stock generic defaults; override force-paints
  // every zone. Same backend mutation BrandingSettingsCard used to call.
  const onApplyToTemplates = useCallback(async () => {
    setApplyDoneMsg(null);
    setApplyErr(null);
    setAppliedTemplates([]);
    try {
      const res: any = await applyBrand.mutateAsync({ mode: applyMode });
      setApplyDoneMsg(`Applied to ${res.count} template${res.count === 1 ? '' : 's'} · ${res.zonesPatched} zone${res.zonesPatched === 1 ? '' : 's'} updated.`);
      setAppliedTemplates(Array.isArray(res.templates) ? res.templates : []);
    } catch (e: any) {
      setApplyErr(e?.message || 'Apply failed — try again.');
    }
  }, [applyBrand, applyMode]);

  // Load fonts into this page too for the live preview
  useEffect(() => {
    if (!preview?.fontsCssUrl) return;
    const id = `wizard-gf-${btoa(preview.fontsCssUrl).slice(0, 16)}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = preview.fontsCssUrl;
    document.head.appendChild(link);
  }, [preview?.fontsCssUrl]);

  const previewBranding = useMemo(() => {
    if (!preview || !derivedPalette) return null;
    const chosen = preview.logos[selectedLogoIdx];
    return {
      displayName: displayName || preview.displayName,
      tagline: tagline || preview.tagline,
      palette: derivedPalette,
      logoUrl: chosen?.url,
      logoSvgInline: chosen?.svgInline,
      faviconUrl: preview.favicon,
      fontHeading: preview.fonts.heading?.googleFont || preview.fonts.heading?.family,
      fontBody: preview.fonts.body?.googleFont || preview.fonts.body?.family,
    };
  }, [preview, derivedPalette, selectedLogoIdx, displayName, tagline]);

  return (
    <div
      className={cn(
        'mx-auto max-w-[1600px] px-4 pt-8 grid grid-cols-1 lg:grid-cols-[minmax(380px,560px)_1fr] gap-6',
        // Mobile (<lg) gets bottom padding so the fixed Adopt bar
        // (rendered at the end, lg:hidden) never covers the last
        // controls. Desktop keeps the original py-8 bottom spacing.
        preview ? 'pb-28 lg:pb-8' : 'pb-8',
      )}
    >
      {/* ── LEFT PANE — Controls ─────────────────────────────
          2026-05-29 (mobile-UX P0-7): on <lg the columns stack to one.
          Once a scan/brand exists, the live preview must come FIRST so
          the operator sees the "repaints as you tweak" moment without
          scrolling ~2 screens past every control. We reorder via
          `order-*` only when there's a preview to surface; on the blank
          first-load state the URL input stays on top. Desktop ordering
          (controls left, preview right) is untouched via lg:order-*. */}
      <div className={cn('space-y-4', preview ? 'order-2 lg:order-1' : 'order-1')}>
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            {/* 2026-05-25 — Wand2 dropped here per operator: "in this
                page we have multiple icon going on that are the same
                thing, no need to two and just keep the paint brush
                one." The page header above already shows Paintbrush
                next to "Branding"; repeating an icon next to "Brand
                your CMS" is just chrome. */}
            <h1 className="text-xl font-bold">
              {mode === 'demo' ? 'Try auto-branding' : 'Brand your CMS'}
            </h1>
          </div>
          <p className="text-sm text-slate-600">
            Paste your website. In about 10 seconds we&apos;ll pull your logo,
            colors, and fonts so the CMS looks like yours — not ours.
          </p>

          <form
            onSubmit={(e) => { e.preventDefault(); runScrape(); }}
            className="flex gap-2"
          >
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.yourschool.org"
                className="pl-9"
                disabled={scraping}
                autoFocus
              />
            </div>
            <Button type="submit" disabled={scraping || !url.trim()} className="min-w-[110px]">
              {scraping ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Scanning</> : 'Scan'}
            </Button>
          </form>

          {!preview && !scraping && (
            <div className="text-xs text-slate-500 space-y-1">
              <div>
                Try an example:{' '}
                {examples.map((ex) => (
                  <button
                    key={ex.url}
                    type="button"
                    className="underline decoration-dotted text-indigo-600 hover:text-indigo-800 mr-2"
                    onClick={() => { setUrl(ex.url); runScrape(ex.url); }}
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-slate-400">
                If a sample is blocked by the site&rsquo;s bot protection, try a different one — or paste your own URL.
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive" className="text-sm">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </Alert>
          )}
        </Card>

        {preview && (
          <>
            {/* Confidence + warnings */}
            <Card className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Confidence</div>
                <Badge variant={preview.confidence.overall >= 0.75 ? 'default' : 'secondary'}>
                  {Math.round(preview.confidence.overall * 100)}%
                </Badge>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                {(['logo','palette','fonts','displayName'] as const).map(k => (
                  <div key={k} className="space-y-1">
                    <div className="text-slate-500 capitalize">{k}</div>
                    <ConfidenceBar value={(preview.confidence as any)[k]} />
                  </div>
                ))}
              </div>
              {preview.warnings.length > 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2">
                  {preview.warnings.map((w, i) => <div key={i} className="flex gap-1"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{w}</div>)}
                </div>
              )}
            </Card>

            {/* Logos. Each tile renders on a checkerboard backdrop so
                white-on-transparent wordmarks (e.g., MLB/Dodgers script)
                stay readable — the gray squares give the white pixels
                contrast. Universal fix that also handles dark logos +
                colorful logos without per-logo logic. */}
            <Card className="p-4 space-y-3">
              <div className="text-sm font-medium">Logos found <span className="text-slate-400">({preview.logos.length})</span></div>
              {preview.logos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {preview.logos.map((l, i) => (
                    <LogoGalleryTile
                      key={i}
                      logo={l}
                      selected={!uploadedLogo && !manualLogoUrl.trim() && selectedLogoIdx === i}
                      onSelect={() => { setUploadedLogo(null); setManualLogoUrl(''); setSelectedLogoIdx(i); }}
                      index={i}
                    />
                  ))}
                </div>
              )}

              {/* Manual logo escape hatch. Always available — and the ONLY
                  path when a site blocks our scraper (Cloudflare returns a
                  404/challenge for the logo, e.g. dominos.com). Uploaded /
                  pasted logo wins over any scraped candidate. */}
              {(uploadedLogo || manualLogoUrl.trim()) && (
                <div className="flex items-center gap-2 rounded-lg border-2 border-indigo-400 bg-indigo-50/60 p-2">
                  <div className="h-10 w-10 shrink-0 rounded bg-white border border-slate-200 flex items-center justify-center overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={uploadedLogo || manualLogoUrl.trim()}
                      alt="your logo"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="text-xs font-semibold text-indigo-700 flex-1 min-w-0">
                    Using your {uploadedLogo ? 'uploaded' : 'pasted'} logo
                  </div>
                  <button
                    type="button"
                    onClick={() => { setUploadedLogo(null); setManualLogoUrl(''); }}
                    className="text-slate-400 hover:text-slate-700"
                    aria-label="Remove your logo"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors">
                  <Upload className="h-3.5 w-3.5" /> Upload your logo
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                    className="hidden"
                    onChange={handleLogoFile}
                  />
                </label>
                <div className="relative flex-1 min-w-[180px]">
                  <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                  <Input
                    value={manualLogoUrl}
                    onChange={(e) => { setManualLogoUrl(e.target.value); if (e.target.value) setUploadedLogo(null); }}
                    placeholder="…or paste a direct image URL"
                    className="pl-8 h-9 text-xs"
                  />
                </div>
              </div>
              {preview.logos.length === 0 && !uploadedLogo && !manualLogoUrl.trim() && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  We couldn&rsquo;t pull a logo from this site — some sites (like dominos.com)
                  block automated access. Upload your logo or paste a direct image link above.
                </p>
              )}
            </Card>

            {/* Colors */}
            <Card className="p-4 space-y-3">
              <div className="text-sm font-medium">Palette</div>
              <div className="space-y-2">
                <PaletteRow label="Primary" value={primary} onChange={setPrimary} />
                <PaletteRow label="Accent" value={accent} onChange={setAccent} />
              </div>
              <div className="pt-1 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-slate-500">Colors discovered — click to apply</div>
                  <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setSwatchTarget('primary')}
                      className={cn(
                        'px-2 py-0.5 rounded transition-colors',
                        swatchTarget === 'primary'
                          ? 'bg-white text-indigo-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700',
                      )}
                      aria-pressed={swatchTarget === 'primary'}
                    >
                      Primary
                    </button>
                    <button
                      type="button"
                      onClick={() => setSwatchTarget('accent')}
                      className={cn(
                        'px-2 py-0.5 rounded transition-colors',
                        swatchTarget === 'accent'
                          ? 'bg-white text-pink-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700',
                      )}
                      aria-pressed={swatchTarget === 'accent'}
                    >
                      Accent
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {preview.colors.map((c) => {
                    const isPrimary = primary.toLowerCase() === c.hex.toLowerCase();
                    const isAccent = accent.toLowerCase() === c.hex.toLowerCase();
                    return (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => {
                          if (swatchTarget === 'primary') setPrimary(c.hex);
                          else setAccent(c.hex);
                        }}
                        className={cn(
                          'h-9 w-9 rounded-md border border-slate-200 hover:scale-110 transition relative',
                          isPrimary && 'ring-2 ring-indigo-500 ring-offset-2',
                          isAccent && !isPrimary && 'ring-2 ring-pink-500 ring-offset-2',
                        )}
                        style={{ background: c.hex }}
                        title={`${c.hex} · score ${c.score.toFixed(1)}${c.isCustomProp ? ' · CSS var' : ''} · click to set ${swatchTarget}`}
                        aria-label={`${c.hex} — click to set as ${swatchTarget}`}
                      >
                        {/* Slot badge — shows which palette slot this swatch
                            currently fills, so the operator can SEE that
                            multiple swatches are wired up (not just primary).
                            If a swatch is BOTH primary and accent (same hex),
                            primary wins for display since it's the dominant
                            slot in the contrast checks below. */}
                        {(isPrimary || isAccent) && (
                          <span
                            className={cn(
                              'absolute -top-1 -left-1 text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center text-white shadow',
                              isPrimary ? 'bg-indigo-600' : 'bg-pink-600',
                            )}
                            aria-hidden
                          >
                            {isPrimary ? 'P' : 'A'}
                          </span>
                        )}
                        {c.isCustomProp && (
                          <span
                            className="absolute -top-1 -right-1 text-[9px] bg-amber-400 text-amber-900 rounded-full px-1"
                            aria-hidden
                          >
                            ★
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Contrast warnings */}
              <ContrastChecks palette={derivedPalette} />
            </Card>

            {/* Fonts */}
            <Card className="p-4 space-y-2">
              <div className="text-sm font-medium">Typography</div>
              <FontRow label="Heading" font={preview.fonts.heading} />
              <FontRow label="Body" font={preview.fonts.body} />
              {(!preview.fonts.heading?.googleFont && !preview.fonts.body?.googleFont) && (
                <div className="text-xs text-slate-500">No Google Font match — falling back to system stack.</div>
              )}
            </Card>

            {/* Identity */}
            <Card className="p-4 space-y-3">
              <div className="text-sm font-medium">Name & tagline</div>
              <div className="space-y-2">
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" />
                <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Tagline (shown on login page)" />
              </div>
            </Card>

            {/* Apply brand to templates — 2026-05-26 operator: "put
                apply branding to templates right above the rescan and
                adopt branding and make the menu small to fit in with
                the rest." Only rendered when editing an already-
                adopted brand (`isEditingAdopted`) — applying before
                adoption would race the Adopt POST, and there's
                nothing to apply yet. The bottom card's
                ApplyBrandToTemplatesRow was removed in the matching
                edit to BrandingSettingsCard so this is now the single
                home for the action. Compact-row style mirrors the
                Re-scan / Adopt toolbar below: slate-50 card, p-3,
                small icons, mode toggle + apply button on one line. */}
            {isEditingAdopted && (
              <div className="bg-slate-50 rounded-md p-3 border border-slate-200 shadow-sm space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Wand2 className="h-4 w-4 text-indigo-500 shrink-0" />
                  <span className="text-xs font-bold text-slate-700 shrink-0">Apply brand to templates</span>
                  <div className="flex-1 min-w-[120px]" />
                  <div className="inline-flex bg-white rounded-md p-0.5 border border-slate-200 shrink-0">
                    <button
                      type="button"
                      onClick={() => setApplyMode('fill-blanks')}
                      className={cn(
                        'px-2 py-1 text-[10px] font-bold rounded transition-colors',
                        applyMode === 'fill-blanks' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                      )}
                      title="Only zones still using stock generic colors"
                    >
                      Fill blanks
                    </button>
                    <button
                      type="button"
                      onClick={() => setApplyMode('override')}
                      className={cn(
                        'px-2 py-1 text-[10px] font-bold rounded transition-colors',
                        applyMode === 'override' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                      )}
                      title="Force-repaint every zone"
                    >
                      Override
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={onApplyToTemplates}
                    disabled={applyBrand.isPending}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {applyBrand.isPending ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Applying…</>
                    ) : (
                      <><Wand2 className="h-3 w-3" /> Apply</>
                    )}
                  </button>
                </div>
                {applyDoneMsg && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1 inline-flex items-center gap-1.5">
                      <Check className="h-3 w-3" /> {applyDoneMsg}
                    </div>
                    {/* 2026-05-26 — show WHICH templates got branded.
                        Operator: "it says it applied to 5 templates
                        but i have no idea what templates". List the
                        names with clickable deep-links into each
                        template editor so they can verify the brand
                        landed. Capped to ~15 to avoid eating the panel
                        on big tenants. */}
                    {appliedTemplates.length > 0 && (
                      <div className="text-[11px] text-emerald-700 bg-emerald-50/40 border border-emerald-100 rounded-md px-2 py-1.5">
                        <p className="font-bold mb-1 uppercase tracking-wider text-[10px]">
                          Templates updated
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {appliedTemplates.slice(0, 15).map((t) => (
                            <a
                              key={t.id}
                              href={`/${user?.tenantId ? user.tenantId : ''}/templates/${t.id}`}
                              onClick={(e) => {
                                // Use router so we don't lose React Query cache
                                // on navigation. SchoolId comes from the user's
                                // currently active tenant.
                                e.preventDefault();
                                if (user?.tenantId) {
                                  router.push(`/${user.tenantId}/templates/${t.id}`);
                                }
                              }}
                              className="inline-flex items-center px-2 py-0.5 rounded-md bg-white border border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50 text-emerald-800 font-semibold transition-colors"
                            >
                              {t.name}
                            </a>
                          ))}
                          {appliedTemplates.length > 15 && (
                            <span className="text-[10px] text-emerald-600 self-center">
                              +{appliedTemplates.length - 15} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {applyErr && (
                  <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1">
                    {applyErr}
                  </div>
                )}
              </div>
            )}

            {/* Actions — 2026-05-26 operator screenshot showed the
                Re-scan / Adopt toolbar floating over page content
                underneath. It was `sticky bottom-0` + `backdrop-blur`,
                which landed on top of the source / duration footer
                below. Switched to a normal-flow card sitting inline
                at the bottom of the left column. `backdrop-blur`
                also dropped — Chromium 83 (NovaStar Taurus) doesn't
                honor it reliably and modern engines render this fine
                with a solid bg. See CLAUDE.md rule #10. */}
            <div className="bg-slate-50 rounded-md p-3 border border-slate-200 shadow-sm flex gap-2 items-center">
              <Button variant="outline" onClick={() => runScrape()} disabled={scraping}>
                <RefreshCw className={cn('h-4 w-4 mr-1.5', scraping && 'animate-spin')} />
                Re-scan
              </Button>
              <div className="flex-1" />
              {mode === 'demo' ? (
                <Button disabled title="Sign in to adopt this branding">
                  Adopt (login required)
                </Button>
              ) : (
                <Button onClick={adopt} disabled={adopting} className="min-w-[160px]">
                  {adopting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Applying</> : <><Check className="h-4 w-4 mr-2" />Adopt branding</>}
                </Button>
              )}
            </div>

            <div className="text-xs text-slate-500 px-1">
              Source: <a href={preview.finalUrl} target="_blank" rel="noopener noreferrer" className="underline">{preview.finalUrl}</a>
              <ExternalLink className="inline h-3 w-3 ml-0.5" />
              {' · '}
              Scanned in {preview.durationMs}ms
            </div>
          </>
        )}
      </div>

      {/* ── RIGHT PANE — Live preview ──────────────────────
          On <lg this jumps ABOVE the controls (order-1) when a preview
          exists so the repaint is the first thing the operator sees;
          on desktop it stays in the right column and is sticky. */}
      <div className={cn('lg:sticky lg:top-6 h-fit', preview ? 'order-1 lg:order-2' : 'order-2')}>
        <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-700">
          <Eye className="h-4 w-4" /> Live preview
          <span className="text-xs text-slate-400">— repaints as you tweak</span>
        </div>
        <Card className="p-0 overflow-hidden shadow-lg border-slate-300">
          <BrandingLivePreview branding={previewBranding} />
        </Card>
        {/* 2026-05-25 — dropped the "Paste a URL and click Scan to
            see the CMS re-skin in real time" empty-state box per
            operator: "dump this weird box we have at the bottom."
            The form on the left side and the live preview above
            already telegraph what to do — the dashed box was
            redundant chrome. */}
      </div>

      {/* ── Mobile sticky Adopt bar (mobile-UX P0-7) ──────────────
          On <lg the Adopt action otherwise sits a full scroll below
          the controls. This pins it to the bottom of the viewport so
          the operator can preview-then-adopt without a 2-screen scroll.
          Only shown once a preview exists. Sits ABOVE the MobileTabBar
          (<md, min-h-56px + safe-area) by offsetting bottom; in the
          md–lg band (no tab bar) it goes flush with its own safe-area
          padding. lg:hidden so the desktop inline toolbar stays the
          single Adopt control on wide screens. */}
      {preview && (
        <div
          className="lg:hidden fixed right-0 left-0 bottom-[calc(56px+env(safe-area-inset-bottom))] md:bottom-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur-md px-4 py-3 md:pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
        >
          {mode === 'demo' ? (
            <Button disabled className="w-full" title="Sign in to adopt this branding">
              Adopt (login required)
            </Button>
          ) : (
            <Button onClick={adopt} disabled={adopting} className="w-full">
              {adopting ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Applying</>
              ) : (
                <><Check className="h-4 w-4 mr-2" />Adopt branding</>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? 'bg-emerald-500' : value >= 0.55 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className="h-1.5 bg-slate-200 rounded overflow-hidden">
      <div className={cn('h-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function PaletteRow({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-slate-500 w-16">{label}</label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-12 rounded border border-slate-300 cursor-pointer"
        aria-label={`${label} color`}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => {
          const v = e.target.value.trim();
          if (/^#?[0-9a-fA-F]{6}$/.test(v)) onChange(v.startsWith('#') ? v : `#${v}`);
        }}
        className="font-mono text-xs px-2 py-1 border border-slate-300 rounded w-28"
      />
    </div>
  );
}

function FontRow({ label, font }: { label: string; font: { family: string; googleFont: string | null } | null }) {
  if (!font) return <div className="text-xs text-slate-400">{label}: none detected</div>;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500 text-xs w-16">{label}</span>
      <span className="font-medium" style={{ fontFamily: `"${font.googleFont || font.family}", sans-serif` }}>
        {font.googleFont || font.family}
      </span>
      {font.googleFont ? <Badge variant="secondary" className="text-[10px]">Google Fonts</Badge> : <Badge variant="outline" className="text-[10px]">System</Badge>}
    </div>
  );
}

function ContrastChecks({ palette }: { palette: any }) {
  if (!palette) return null;
  const pairs = [
    ['primary → primary ink', palette.primary, palette.primaryInk],
    ['accent → accent ink', palette.accent, palette.accentInk],
  ] as const;
  return (
    <div className="text-xs text-slate-600 space-y-1 pt-2 border-t border-slate-200">
      {pairs.map(([label, a, b]) => {
        if (!a || !b) return null;
        const ratio = contrast(a, b);
        const grade = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA-large' : 'fail';
        const warn = grade === 'fail' || grade === 'AA-large';
        return (
          <div key={label} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded border" style={{ background: a }} />
            <span className="inline-block h-3 w-3 rounded border" style={{ background: b }} />
            <span className="flex-1">{label}</span>
            <span className={cn('font-mono', warn ? 'text-red-600 font-semibold' : 'text-emerald-700')}>{ratio.toFixed(1)}:1 {grade}</span>
          </div>
        );
      })}
    </div>
  );
}

// Lightweight client-side contrast. Mirrors server color-utils for
// speed of iteration; WCAG 2.1 formula is standard.
function hexToRgb(hex: string) { const h = hex.replace('#',''); return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) }; }
function channel(c: number) { const s = c/255; return s <= 0.03928 ? s/12.92 : Math.pow((s + 0.055)/1.055, 2.4); }
function luminance(hex: string) { const { r, g, b } = hexToRgb(hex); return 0.2126*channel(r) + 0.7152*channel(g) + 0.0722*channel(b); }
function contrast(a: string, b: string) { const la = luminance(a), lb = luminance(b); const [L1, L2] = la > lb ? [la, lb] : [lb, la]; return (L1 + 0.05) / (L2 + 0.05); }

/**
 * LogoGalleryTile — one card in the "Logos found" grid. The default
 * white-tile backdrop made white-on-transparent wordmarks (Dodgers
 * script, etc.) invisible (operator caught it on the MLB scrape on
 * 2026-05-25). Fix: render every tile on a subtle 4×4-px checkerboard
 * pattern so:
 *   • Light/white logos sit against the gray squares → readable
 *   • Dark logos sit against the white squares → readable
 *   • Transparent/empty PNGs reveal the pattern → user sees nothing
 *     is there (instead of looking like the tile loaded successfully)
 *
 * This is the industry-standard transparency indicator (Photoshop,
 * Figma, Sketch). For SVG logos using fill="currentColor" we still
 * force `text-slate-800` so the line art shows up against the white
 * squares.
 */
type GalleryLogo = BrandingPreview['logos'][number];
function LogoGalleryTile({
  logo,
  selected,
  onSelect,
  index,
}: {
  logo: GalleryLogo;
  selected: boolean;
  onSelect: () => void;
  index: number;
}) {
  // 2026-05-25 — Operator: "the one highlighted is transparent here
  // but looks good on the preview" — the Dodgers white wordmark
  // disappeared into the WHITE squares of the gallery's white+gray
  // checkerboard. Same root cause as the preview, same fix: detect
  // the logo's tone and swap to a DARK checkerboard for light logos
  // so white pixels always sit against a dark surface.
  const tone = useLogoTone(logo.url || null, logo.svgInline || null);
  const isLight = tone === 'light' || tone === 'unknown';
  // For SVG logos that use currentColor, the wrapper's text color
  // controls the line-art color. Dark backdrop → white text; light
  // backdrop → slate-800 text.
  const svgInkClass = isLight ? 'text-white' : 'text-slate-800';
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative aspect-square rounded-md border-2 p-2 hover:border-indigo-400 flex items-center justify-center overflow-hidden transition',
        selected ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-slate-200',
      )}
      style={{
        // 12px checkerboard, two flavors:
        //  • light logos → slate-700 base + slate-800 gradient squares
        //    (dark checkerboard) so white wordmarks show up everywhere
        //  • dark logos  → white base + slate-200 gradient squares
        //    (classic light checkerboard) so dark logos show up
        backgroundColor: isLight ? '#334155' : '#ffffff',
        backgroundImage: isLight
          ? (
              'linear-gradient(45deg, #1e293b 25%, transparent 25%), ' +
              'linear-gradient(-45deg, #1e293b 25%, transparent 25%), ' +
              'linear-gradient(45deg, transparent 75%, #1e293b 75%), ' +
              'linear-gradient(-45deg, transparent 75%, #1e293b 75%)'
            )
          : (
              'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), ' +
              'linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), ' +
              'linear-gradient(45deg, transparent 75%, #e2e8f0 75%), ' +
              'linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)'
            ),
        backgroundSize: '12px 12px',
        backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px',
      }}
      aria-label={`Choose logo ${index + 1}`}
    >
      {logo.svgInline ? (
        // SVG wordmarks using fill="currentColor" inherit from this
        // wrapper. Use a contrasting color so currentColor SVGs are
        // visible against the picked backdrop.
        // XSS defense: sanitize before render; SVG came from an
        // untrusted URL.
        <div
          className={cn(
            'max-h-full max-w-full [&_svg]:max-h-full [&_svg]:max-w-full [&_svg]:h-full [&_svg]:w-full',
            svgInkClass,
          )}
          dangerouslySetInnerHTML={{ __html: sanitizeSvg(logo.svgInline) }}
        />
      ) : logo.url ? (
        <img
          src={logo.url}
          alt="logo option"
          className="max-h-full max-w-full object-contain"
          loading="lazy"
        />
      ) : null}
      {selected && (
        <Check className="absolute top-1 right-1 h-4 w-4 bg-indigo-600 text-white rounded-full p-0.5" />
      )}
      {/* Kind chip — adapts to backdrop so the label stays readable. */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 text-[10px] py-0.5 truncate backdrop-blur-sm',
          isLight ? 'bg-slate-900/70 text-white' : 'bg-white/85 text-slate-600',
        )}
      >
        {logo.kind}
      </div>
    </button>
  );
}
