/**
 * BrandingLivePreview — a faux-admin dashboard mockup that re-skins
 * whenever the wizard changes the palette. Intentionally resembles our
 * actual dashboard (sidebar + header + cards + buttons + chart strip)
 * so the demo viewer immediately sees "oh, this is what our real CMS
 * will look like in our colors."
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { cn } from '@/lib/utils';
import { LayoutDashboard, MonitorPlay, LayoutTemplate, Folders, Settings, Bell, ShieldAlert, Search, ChevronDown } from 'lucide-react';
import { useLogoTone } from './useLogoTone';

// Natural width of the faux-desktop scene below. The whole mock is built
// at this fixed pixel width (180px sidebar + ~700px content) so it always
// reads as a real desktop dashboard. ScaleToFit then measures the actual
// container and shrinks the WHOLE thing proportionally via transform:
// scale() — the same pattern ScaledTemplateThumbnail / the player
// TemplateScaler use. Without this, the fixed 180px sidebar ate half a
// 360px phone and the chrome was illegibly small (mobile-UX audit P1).
const PREVIEW_NATURAL_WIDTH = 880;

// Defense-in-depth: the API now sanitizes on write, but rows written
// before the fix (or injected via a different code path) could still
// contain hostile <svg onload=...>. Every render goes through this.
function sanitizeSvg(raw: string): string {
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'style', 'foreignObject'],
  }) as unknown as string;
}

export interface BrandingLivePreviewProps {
  branding: {
    displayName?: string | null;
    tagline?: string | null;
    palette: any;
    logoUrl?: string | null;
    logoSvgInline?: string | null;
    faviconUrl?: string | null;
    fontHeading?: string | null;
    fontBody?: string | null;
  } | null;
}

export function BrandingLivePreview({ branding }: BrandingLivePreviewProps) {
  const p = branding?.palette || {};
  const safeLogoSvg = useMemo(
    () => (branding?.logoSvgInline ? sanitizeSvg(branding.logoSvgInline) : ''),
    [branding?.logoSvgInline],
  );
  // CSS custom properties aren't part of React.CSSProperties; widen the type
  // to allow `--*` keys instead of suppressing the whole object with @ts-ignore.
  const style: React.CSSProperties & Record<`--${string}`, string> = {
    // Scope all brand tokens to just this preview
    '--bp-primary': p.primary || '#4f46e5',
    '--bp-primary-hover': p.primaryHover || '#4338ca',
    '--bp-primary-soft': p.primarySoft || '#e0e7ff',
    '--bp-primary-ink': p.primaryInk || '#ffffff',
    '--bp-accent': p.accent || '#ec4899',
    '--bp-accent-soft': p.accentSoft || '#fce7f3',
    '--bp-accent-ink': p.accentInk || '#ffffff',
    '--bp-ink': p.ink || '#0f172a',
    '--bp-ink-muted': p.inkMuted || '#475569',
    '--bp-surface': p.surface || '#ffffff',
    '--bp-surface-alt': p.surfaceAlt || '#f8fafc',
    '--bp-border': p.border || '#e2e8f0',
    '--bp-font-heading': branding?.fontHeading ? `"${branding.fontHeading}", ui-sans-serif, system-ui, sans-serif` : 'ui-sans-serif, system-ui, sans-serif',
    '--bp-font-body': branding?.fontBody ? `"${branding.fontBody}", ui-sans-serif, system-ui, sans-serif` : 'ui-sans-serif, system-ui, sans-serif',
  };

  // Vertical-neutral default — "District" only fits K-12. Real tenants set
  // branding.displayName; this placeholder shows before they do, so it must
  // read right for a gym / restaurant / arena too.
  const name = branding?.displayName || 'Your Venue Signage';

  // Detect whether the picked logo is light-toned (e.g., the white
  // Dodgers wordmark). When it is, wrap it in a brand-color chip so
  // it has contrast against the otherwise-light sidebar surface;
  // otherwise render it on a plain transparent backdrop so dark
  // logos sit naturally on the surface.
  const logoTone = useLogoTone(
    branding?.logoUrl || null,
    branding?.logoSvgInline || null,
  );
  const needsDarkBacking = logoTone === 'light' || logoTone === 'unknown';

  return (
    <ScaleToFit naturalWidth={PREVIEW_NATURAL_WIDTH}>
    <div className="preview-root relative bg-white" style={{ ...style, width: PREVIEW_NATURAL_WIDTH }}>
      <style>{`
        .preview-root { font-family: var(--bp-font-body); color: var(--bp-ink); transition: color .15s; }
        .preview-root .preview-heading { font-family: var(--bp-font-heading); }
        .preview-root .preview-btn-primary { background: var(--bp-primary); color: var(--bp-primary-ink); transition: background .15s; }
        .preview-root .preview-btn-primary:hover { background: var(--bp-primary-hover); }
        .preview-root .preview-btn-accent { background: var(--bp-accent); color: var(--bp-accent-ink); }
        .preview-root .preview-sidebar { background: var(--bp-surface-alt); border-color: var(--bp-border); }
        .preview-root .preview-sidebar-active { background: var(--bp-primary-soft); color: var(--bp-primary); font-weight: 600; }
        .preview-root .preview-card { background: var(--bp-surface); border-color: var(--bp-border); }
        .preview-root .preview-chip { background: var(--bp-primary-soft); color: var(--bp-primary); }
        .preview-root .preview-chip-accent { background: var(--bp-accent-soft); color: var(--bp-accent); }
        .preview-root .preview-hero-gradient { background: linear-gradient(135deg, var(--bp-primary) 0%, var(--bp-accent) 120%); }
        .preview-root .preview-bar { background: var(--bp-primary); }
        .preview-root .preview-bar-accent { background: var(--bp-accent); }
      `}</style>

      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 bg-slate-50">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </div>
        <div className="flex-1 px-3 py-0.5 rounded-md bg-white border border-slate-200 text-[11px] text-slate-500 font-mono">
          edusignage.app/{(name || '').toLowerCase().replace(/\s+/g, '-').slice(0, 20)}/dashboard
        </div>
      </div>

      {/* App layout */}
      <div className="grid grid-cols-[180px_1fr]">
        {/* Sidebar */}
        <aside className="preview-sidebar border-r min-h-[540px] p-3">
          <div className="flex items-center gap-2 px-2 py-2 mb-3 rounded-md">
            {/* Light-toned logos (white wordmarks etc.) get wrapped in
                a primary-color chip so they have contrast against the
                light sidebar surface. Dark logos sit on transparent. */}
            {safeLogoSvg || branding?.logoUrl ? (
              <div
                className={cn(
                  'h-8 w-8 rounded-md flex items-center justify-center overflow-hidden shrink-0',
                  needsDarkBacking ? 'p-1' : '',
                )}
                style={needsDarkBacking ? { background: 'var(--bp-primary)' } : undefined}
              >
                {safeLogoSvg ? (
                  <div
                    className={cn(
                      'h-full w-full flex items-center justify-center [&_svg]:max-h-full [&_svg]:max-w-full',
                      needsDarkBacking ? 'text-white' : 'text-slate-800',
                    )}
                    dangerouslySetInnerHTML={{ __html: safeLogoSvg }}
                  />
                ) : branding?.logoUrl ? (
                  <img
                    src={branding.logoUrl}
                    alt="logo"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : null}
              </div>
            ) : (
              <div className="h-8 w-8 rounded-md preview-btn-primary flex items-center justify-center text-xs font-bold shrink-0">
                {(name?.[0] || 'E').toUpperCase()}
              </div>
            )}
            <div className="leading-tight min-w-0">
              {/* 2026-05-25 — was truncate + max-w-[110px], which
                  guillotined names longer than ~13 chars on a 180px
                  sidebar ("Los Angeles Do…"). Now wraps to at most
                  2 lines with line-clamp-2. Hover still shows the
                  full name via title attr. */}
              <div className="preview-heading text-[10px] font-bold line-clamp-2 leading-tight max-w-[110px]" title={name}>{name}</div>
              <div className="text-[9px] text-slate-500">Signage</div>
            </div>
          </div>
          <nav className="space-y-1 text-[12px]">
            <SideLink active icon={<LayoutDashboard className="h-3.5 w-3.5" />}>Dashboard</SideLink>
            <SideLink icon={<MonitorPlay className="h-3.5 w-3.5" />}>Screens</SideLink>
            <SideLink icon={<LayoutTemplate className="h-3.5 w-3.5" />}>Templates</SideLink>
            <SideLink icon={<Folders className="h-3.5 w-3.5" />}>Playlists</SideLink>
            <SideLink icon={<Settings className="h-3.5 w-3.5" />}>Settings</SideLink>
          </nav>

          <button className="preview-btn-accent w-full mt-5 rounded-md text-[11px] py-1.5 font-semibold flex items-center justify-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5" />
            Emergency
          </button>
        </aside>

        {/* Main */}
        <main className="p-5 bg-white min-h-[540px]">
          {/* Header bar */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="preview-heading text-lg font-bold" style={{ color: 'var(--bp-ink)' }}>Dashboard</h2>
              <div className="text-[11px]" style={{ color: 'var(--bp-ink-muted)' }}>
                {/* 2026-05-25 — vertical-neutral default. The old
                    "Your district signage at a glance" was K-12-
                    specific copy bleeding into a Sports tenant
                    preview. */}
                {branding?.tagline || 'Your signage at a glance'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                <input className="preview-card border rounded-md text-[11px] pl-6 pr-2 py-1 w-28" placeholder="Search…" />
              </div>
              <button className="preview-btn-primary rounded-md text-[11px] px-3 py-1.5 font-medium">New playlist</button>
              <div className="relative">
                <Bell className="h-4 w-4" style={{ color: 'var(--bp-primary)' }} />
                <div className="absolute -top-1 -right-1 preview-bar-accent h-2 w-2 rounded-full" />
              </div>
            </div>
          </div>

          {/* Hero card */}
          <div className="preview-hero-gradient rounded-xl p-4 text-white mb-5 relative overflow-hidden">
            <div className="preview-heading text-lg font-bold">Welcome back to {name}</div>
            <div className="text-[11px] opacity-90 mt-0.5">Emergency system green · 23 screens online · 2 playlists scheduled</div>
            <div className="absolute right-4 top-3 flex gap-1">
              <div className="preview-bar h-1.5 w-14 rounded-full opacity-70" />
              <div className="preview-bar-accent h-1.5 w-6 rounded-full" />
            </div>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Kpi label="Active screens" value="23" trend="+2" positive />
            <Kpi label="Scheduled" value="7" trend="—" />
            <Kpi label="Emergency drills" value="4" trend="+1" positive />
          </div>

          {/* Chip row */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {['All','Hallways','Cafeteria','Auditorium','Entry'].map((t, i) => (
              <span key={t} className={cn('px-2.5 py-1 rounded-full text-[10px] font-medium', i === 0 ? 'preview-chip' : 'bg-slate-100 text-slate-600')}>{t}</span>
            ))}
          </div>

          {/* Table preview */}
          <div className="preview-card border rounded-xl overflow-hidden">
            <div className="px-3 py-2 text-[11px] font-semibold flex items-center justify-between border-b" style={{ borderColor: 'var(--bp-border)' }}>
              Screens <ChevronDown className="h-3 w-3" />
            </div>
            {[
              { name: 'Main Lobby', status: 'Live', ok: true },
              { name: 'East Hallway', status: 'Live', ok: true },
              { name: 'Gym Entry', status: 'Offline', ok: false },
              { name: 'Cafeteria A', status: 'Live', ok: true },
            ].map(row => (
              <div key={row.name} className="px-3 py-2 text-[11px] flex items-center justify-between border-b last:border-0" style={{ borderColor: 'var(--bp-border)' }}>
                <span className="flex items-center gap-2">
                  <span className={cn('h-1.5 w-1.5 rounded-full', row.ok ? 'bg-emerald-500' : 'bg-red-400')} />
                  {row.name}
                </span>
                <span className={cn('px-2 py-0.5 rounded-full text-[9px]', row.ok ? 'preview-chip' : 'bg-red-50 text-red-700')}>
                  {row.status}
                </span>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
    </ScaleToFit>
  );
}

/**
 * ScaleToFit — measures its own width and shrinks a fixed-`naturalWidth`
 * child via CSS `transform: scale()`, exactly like ScaledTemplateThumbnail
 * and the player's TemplateScaler. The child keeps every px size intact
 * (so the faux-desktop mock never reflows into a cramped phone layout);
 * the whole scene just renders smaller. We cap scale at 1 so the mock
 * never upscales past its natural size on a wide desktop pane.
 *
 * The wrapper reports the SCALED height back to its own box so the
 * surrounding <Card> collapses flush to the shrunk preview with no dead
 * space below it.
 */
function ScaleToFit({ naturalWidth, children }: { naturalWidth: number; children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const w = outer.getBoundingClientRect().width;
      if (w <= 0) return;
      // Never upscale: a desktop pane wider than naturalWidth renders at 1:1.
      const next = Math.min(1, w / naturalWidth);
      setScale(next);
      // offsetHeight is the UNSCALED layout box (transforms don't affect
      // it), so multiplying by `next` gives the on-screen scaled height —
      // no dependency on the previous scale value.
      const naturalHeight = inner.offsetHeight;
      if (naturalHeight > 0) setScaledHeight(naturalHeight * next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalWidth]);

  return (
    <div ref={outerRef} style={{ width: '100%', height: scaledHeight, overflow: 'hidden' }}>
      <div
        ref={innerRef}
        style={{
          width: naturalWidth,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function SideLink({ active, icon, children }: { active?: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-center gap-2 px-2 py-1.5 rounded-md text-slate-600', active && 'preview-sidebar-active')}>
      {icon}<span>{children}</span>
    </div>
  );
}

function Kpi({ label, value, trend, positive }: { label: string; value: string; trend: string; positive?: boolean }) {
  return (
    <div className="preview-card border rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--bp-ink-muted)' }}>{label}</div>
      <div className="preview-heading text-2xl font-bold mt-0.5" style={{ color: 'var(--bp-primary)' }}>{value}</div>
      <div className={cn('text-[10px] mt-0.5', positive ? 'text-emerald-600' : 'text-slate-400')}>{trend}</div>
    </div>
  );
}
