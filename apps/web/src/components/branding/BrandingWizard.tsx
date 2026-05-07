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
import DOMPurify from 'isomorphic-dompurify';
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
import { BrandingLivePreview } from './BrandingLivePreview';
import { Search, Palette, Sparkles, Check, Loader2, ExternalLink, AlertTriangle, RefreshCw, Monitor, Wand2, Eye } from 'lucide-react';

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

const EXAMPLES = [
  { label: 'Lincoln County (NC)', url: 'https://www.lcsnc.org/' },
  { label: 'NYC DOE', url: 'https://www.schools.nyc.gov/' },
  { label: 'LAUSD', url: 'https://www.lausd.org/' },
];

export function BrandingWizard({ mode, initial, onAdopted }: BrandingWizardProps) {
  const router = useRouter();
  // BrandStyleInjector reads the LS cache per-tenant as
  // `edu-cms-branding-cache-v1:<tenantId>` (see commit 14a91fa which
  // fixed a cross-tenant theme bleed). We must write to the same key on
  // adopt or the next route render reads nothing and paints defaults
  // (the "every deploy wipes my custom logo" bug). Fall back to the
  // legacy single key in demo mode where there is no user.
  const user = useAppStore((s) => s.user);
  const [url, setUrl] = useState<string>(initial?.sourceUrl || '');
  const [scraping, setScraping] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [preview, setPreview] = useState<BrandingPreview | null>((initial as any) || null);
  const [error, setError] = useState<string | null>(null);
  const [selectedLogoIdx, setSelectedLogoIdx] = useState(0);
  const [displayName, setDisplayName] = useState(initial?.displayName || '');
  const [tagline, setTagline] = useState(initial?.tagline || '');
  const [primary, setPrimary] = useState<string>((initial as any)?.palette?.primary || '#4f46e5');
  const [accent, setAccent] = useState<string>((initial as any)?.palette?.accent || '#ec4899');
  const [derivedPalette, setDerivedPalette] = useState<any>((initial as any)?.palette || null);

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
    } catch (e: any) {
      setError(e?.message || 'Scrape failed');
      setPreview(null);
    } finally {
      setScraping(false);
    }
  }, [url, mode]);

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

  // ── Adopt ──────────────────────────────────────────────────────
  const adopt = useCallback(async () => {
    if (!preview || !derivedPalette) return;
    setAdopting(true);
    try {
      const chosen = preview.logos[selectedLogoIdx];
      const payload = {
        ...preview,
        displayName: displayName || preview.displayName,
        tagline: tagline || preview.tagline,
        palette: derivedPalette,
        logoOverride: chosen ? { url: chosen.url, svgInline: chosen.svgInline } : undefined,
      };
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
      onAdopted?.(res.branding);
    } catch (e: any) {
      setError(e?.message || 'Adopt failed');
    } finally {
      setAdopting(false);
    }
  }, [preview, derivedPalette, selectedLogoIdx, displayName, tagline, onAdopted]);

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
    <div className="mx-auto max-w-[1600px] px-4 py-8 grid grid-cols-1 lg:grid-cols-[minmax(380px,560px)_1fr] gap-6">
      {/* ── LEFT PANE — Controls ─────────────────────────── */}
      <div className="space-y-4">
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-indigo-600" />
            <h1 className="text-xl font-bold">
              {mode === 'demo' ? 'Try auto-branding' : 'Brand your CMS'}
            </h1>
          </div>
          <p className="text-sm text-slate-600">
            Paste your school or district website. In about 10 seconds we&apos;ll pull your logo,
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
              {scraping ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Scanning</> : <><Sparkles className="h-4 w-4 mr-2" />Scan</>}
            </Button>
          </form>

          {!preview && !scraping && (
            <div className="text-xs text-slate-500">
              Try an example:{' '}
              {EXAMPLES.map((ex, i) => (
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

            {/* Logos */}
            <Card className="p-4 space-y-3">
              <div className="text-sm font-medium">Logos found <span className="text-slate-400">({preview.logos.length})</span></div>
              <div className="grid grid-cols-3 gap-2">
                {preview.logos.map((l, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedLogoIdx(i)}
                    className={cn(
                      'relative aspect-square rounded-md border-2 p-2 bg-slate-50 hover:border-indigo-400 flex items-center justify-center overflow-hidden transition',
                      selectedLogoIdx === i ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-slate-200'
                    )}
                    aria-label={`Choose logo ${i+1}`}
                  >
                    {l.svgInline ? (
                      // Many SVG wordmarks fill="currentColor" — set a dark
                      // text color on the wrapper so the mark actually shows
                      // against the light tile background.
                      // XSS defense: sanitize before render; the SVG was
                      // scraped from an untrusted URL.
                      <div
                        className="max-h-full max-w-full text-slate-800 [&_svg]:max-h-full [&_svg]:max-w-full [&_svg]:h-full [&_svg]:w-full"
                        dangerouslySetInnerHTML={{ __html: sanitizeSvg(l.svgInline) }}
                      />
                    ) : l.url ? (
                      <img src={l.url} alt="logo option" className="max-h-full max-w-full object-contain" loading="lazy" />
                    ) : null}
                    {selectedLogoIdx === i && <Check className="absolute top-1 right-1 h-4 w-4 bg-indigo-600 text-white rounded-full p-0.5" />}
                    <div className="absolute bottom-0 inset-x-0 text-[10px] bg-white/80 py-0.5 text-slate-600 truncate">{l.kind}</div>
                  </button>
                ))}
              </div>
            </Card>

            {/* Colors */}
            <Card className="p-4 space-y-3">
              <div className="text-sm font-medium">Palette</div>
              <div className="space-y-2">
                <PaletteRow label="Primary" value={primary} onChange={setPrimary} />
                <PaletteRow label="Accent" value={accent} onChange={setAccent} />
              </div>
              <div className="pt-1">
                <div className="text-xs text-slate-500 mb-1.5">All colors discovered — click to promote to primary</div>
                <div className="flex flex-wrap gap-1.5">
                  {preview.colors.map((c, i) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setPrimary(c.hex)}
                      className={cn('h-8 w-8 rounded-md border border-slate-200 hover:scale-110 transition relative', primary.toLowerCase() === c.hex.toLowerCase() && 'ring-2 ring-indigo-500 ring-offset-2')}
                      style={{ background: c.hex }}
                      title={`${c.hex} · score ${c.score.toFixed(1)}${c.isCustomProp ? ' · CSS var' : ''}`}
                    >
                      {c.isCustomProp && <span className="absolute -top-1 -right-1 text-[9px] bg-amber-400 text-amber-900 rounded-full px-1">★</span>}
                    </button>
                  ))}
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

            {/* Actions */}
            <div className="sticky bottom-0 bg-slate-50/80 backdrop-blur rounded-md p-3 -mx-2 border border-slate-200 shadow-sm flex gap-2 items-center">
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

      {/* ── RIGHT PANE — Live preview ────────────────────── */}
      <div className="lg:sticky lg:top-6 h-fit">
        <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-700">
          <Eye className="h-4 w-4" /> Live preview
          <span className="text-xs text-slate-400">— repaints as you tweak</span>
        </div>
        <Card className="p-0 overflow-hidden shadow-lg border-slate-300">
          <BrandingLivePreview branding={previewBranding} />
        </Card>
        {!preview && (
          <div className="mt-6 rounded-xl border-2 border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 bg-white">
            <Monitor className="h-10 w-10 mx-auto mb-3 text-slate-300" />
            Paste a URL and click <b>Scan</b> to see the CMS re-skin in real time.
          </div>
        )}
      </div>
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
