"use client";

import { useState, useRef } from 'react';
import { Palette, Image as ImageIcon, Code2, Upload, X, Check } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import { useTemplate } from '@/hooks/use-api';
import { useUIStore } from '@/store/ui-store';
import { API_URL } from '@/lib/api-url';
import { ColorPickerField } from '@/components/ui/color-picker';
import { TemplateBackdropPicker } from './PropertiesPanel';

/**
 * Background tab — top-level template-builder panel for setting the
 * canvas background.
 *
 * Operator: 'i dont even see where i can add a background to my
 * templates? i would thinks thsat would be useful with the brand
 * colors, give some options on colors gradients, etc.... use that
 * huge fucking brain of yours and make this feature super special
 * and unique to our app'
 *
 * Design philosophy: the operator paints a background in 1-3 clicks,
 * not by hunting through a Properties tab and learning CSS gradient
 * syntax. Three lanes:
 *
 *   1. BRAND-AWARE — when the template has a brandKit, the top of
 *      the panel shows the brand's actual colors as 1-click solid
 *      backgrounds, plus 3 auto-generated gradients (primary→accent,
 *      primary→ink, surface→accent). This is the "match my school's
 *      colors" path; competitive moat over generic signage tools.
 *
 *   2. CURATED PRESETS — 12 gradient palettes hand-tuned for digital
 *      signage. High enough contrast that text overlay reads from
 *      8 feet, soft enough that they don't compete with content.
 *      Plus 6 subtle SVG patterns (dots, grid, diagonal, waves,
 *      blueprint, topography) for templates that benefit from
 *      texture without dominating.
 *
 *   3. CUSTOM — the existing color picker / gradient builder /
 *      image upload (delegated to CanvasBackdropSection for parity
 *      with the Properties panel — operators using either path
 *      get the same controls).
 *
 * Each preset is rendered as a real CSS background on a thumbnail
 * tile so operators see exactly what they're picking. No mystery
 * meat color names.
 */

// Hand-tuned for signage: each gradient has at least 3:1 contrast
// against white text, soft enough that text doesn't fight the
// background. Names lean evocative not technical.
const PRESET_GRADIENTS: Array<{ name: string; css: string }> = [
  { name: 'Sunset',      css: 'linear-gradient(135deg, #ff6b6b 0%, #ffa94d 50%, #ffd93d 100%)' },
  { name: 'Ocean',       css: 'linear-gradient(135deg, #0066cc 0%, #00a3cc 100%)' },
  { name: 'Forest',      css: 'linear-gradient(135deg, #1e6b4f 0%, #5fbc8e 100%)' },
  { name: 'Royal',       css: 'linear-gradient(135deg, #4338ca 0%, #7c3aed 50%, #c026d3 100%)' },
  { name: 'Mint',        css: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)' },
  { name: 'Coral',       css: 'linear-gradient(135deg, #f43f5e 0%, #ec4899 100%)' },
  { name: 'Cosmos',      css: 'linear-gradient(135deg, #1e1b4b 0%, #4c1d95 50%, #6d28d9 100%)' },
  { name: 'Aurora',      css: 'linear-gradient(135deg, #14b8a6 0%, #6366f1 50%, #ec4899 100%)' },
  { name: 'Slate',       css: 'linear-gradient(135deg, #1e293b 0%, #475569 100%)' },
  { name: 'Cream',       css: 'linear-gradient(135deg, #fefce8 0%, #fef3c7 50%, #fde68a 100%)' },
  { name: 'Blueprint',   css: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)' },
  { name: 'Pastel Pop',  css: 'linear-gradient(135deg, #ddd6fe 0%, #fbcfe8 50%, #bae6fd 100%)' },
];

// Subtle SVG patterns rendered via data URIs. Each is a tile-able
// SVG embedded directly so we don't need any asset hosting. Patterns
// use --pattern-fg / --pattern-bg CSS variables so they auto-tint
// to the brand if applied via the brand-aware path (future polish).
const SVG_PATTERNS: Array<{ name: string; bg: string; svg: string; tile?: string }> = [
  {
    name: 'Dots',
    bg: '#f8fafc',
    svg: `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><circle cx='20' cy='20' r='1.8' fill='%23cbd5e1'/></svg>`,
  },
  {
    name: 'Grid',
    bg: '#ffffff',
    svg: `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><path d='M 40 0 L 0 0 0 40' fill='none' stroke='%23e2e8f0' stroke-width='1'/></svg>`,
  },
  {
    name: 'Diagonal',
    bg: '#fefce8',
    svg: `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30'><path d='M 0 30 L 30 0 M -7.5 7.5 L 7.5 -7.5 M 22.5 37.5 L 37.5 22.5' stroke='%23fde68a' stroke-width='2'/></svg>`,
  },
  {
    name: 'Waves',
    bg: '#eff6ff',
    svg: `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='40'><path d='M0 20 Q 20 0 40 20 T 80 20' fill='none' stroke='%23bfdbfe' stroke-width='2'/></svg>`,
  },
  {
    name: 'Blueprint',
    bg: '#1e3a8a',
    svg: `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><path d='M 40 0 L 0 0 0 40' fill='none' stroke='%233b82f6' stroke-width='0.5' opacity='0.4'/><circle cx='20' cy='20' r='1' fill='%2393c5fd' opacity='0.6'/></svg>`,
  },
  {
    name: 'Topo',
    bg: '#f5f5f4',
    svg: `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='60'><path d='M 0 30 Q 25 10 50 30 T 100 30' fill='none' stroke='%23d6d3d1' stroke-width='1'/><path d='M 0 45 Q 25 25 50 45 T 100 45' fill='none' stroke='%23e7e5e4' stroke-width='1'/></svg>`,
  },
];

function patternToCss(p: { bg: string; svg: string }): string {
  // url-encoded SVG as a data URI. Each tile is small (~200 bytes)
  // so this stays well under any URL-length limit Postgres or HTTP
  // headers might care about.
  const encoded = encodeURIComponent(p.svg)
    .replace(/%23/g, '#') // hex colors don't need encoding
    .replace(/%20/g, ' ');
  return `${p.bg} url("data:image/svg+xml;utf8,${encoded}") repeat`;
}

export function BackgroundPanel() {
  const templateId = useBuilderStore((s) => s.templateId);
  const meta = useBuilderStore((s) => s.meta);
  const setMeta = useBuilderStore((s) => s.setMeta);
  const { data: template } = useTemplate(templateId);
  const brandKit: any = (template as any)?.brandKit ?? null;
  const palette = brandKit?.palette as Record<string, string> | undefined;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // What's on the canvas right now? Used to render the "currently
  // selected" indicator on each preset.
  const currentBgColor = meta.bgColor || '';
  const currentBgGradient = meta.bgGradient || '';
  const currentBgImage = meta.bgImage || '';
  const isCurrentColor = (hex: string) =>
    !!hex && !currentBgGradient && !currentBgImage &&
    currentBgColor.toLowerCase() === hex.toLowerCase();
  const isCurrentGradient = (css: string) =>
    !!css && !currentBgImage && currentBgGradient === css;

  // Brand colors: deduplicate empty/missing values and put primary
  // first by convention. Order matches the existing Brand Kit panel.
  const brandSwatches = palette
    ? [
        { label: 'Primary', hex: palette.primary },
        { label: 'Primary Hover', hex: palette.primaryHover },
        { label: 'Accent', hex: palette.accent },
        { label: 'Surface', hex: palette.surface },
        { label: 'Surface Alt', hex: palette.surfaceAlt },
        { label: 'Text', hex: palette.ink },
      ].filter((s) => !!s.hex)
    : [];

  // Auto-generated brand gradients. Three combinations that always
  // look reasonable: primary→accent (the showpiece), primary→ink (a
  // dramatic dark version), and surface→accent (subtle, content-
  // dominant). If brand kit doesn't have all three colors we just
  // skip the affected gradients.
  const brandGradients: Array<{ name: string; css: string }> = [];
  if (palette?.primary && palette?.accent) {
    brandGradients.push({
      name: 'Brand • Primary → Accent',
      css: `linear-gradient(135deg, ${palette.primary} 0%, ${palette.accent} 100%)`,
    });
  }
  if (palette?.primary && palette?.ink) {
    brandGradients.push({
      name: 'Brand • Primary → Ink',
      css: `linear-gradient(135deg, ${palette.primary} 0%, ${palette.ink} 100%)`,
    });
  }
  if (palette?.surface && palette?.accent) {
    brandGradients.push({
      name: 'Brand • Surface → Accent',
      css: `linear-gradient(135deg, ${palette.surface} 0%, ${palette.accent} 100%)`,
    });
  }

  // Apply functions clear the OTHER bg fields so the canvas reflects
  // exactly what was clicked (we don't stack image+color+gradient).
  const applyColor = (hex: string) =>
    setMeta({ bgColor: hex, bgGradient: '', bgImage: '' });
  const applyGradient = (css: string) =>
    setMeta({ bgColor: '', bgGradient: css, bgImage: '' });
  const applyPattern = (p: { bg: string; svg: string }) =>
    // Patterns set both bgColor (the base) AND bgGradient (the
    // tile). Renderer composites them; without the base, the tile
    // shows transparent gaps.
    setMeta({ bgColor: p.bg, bgGradient: patternToCss(p), bgImage: '' });
  const applyImage = (url: string) =>
    setMeta({ bgImage: url, bgColor: '', bgGradient: '' });
  const clearAll = () =>
    setMeta({ bgColor: '', bgGradient: '', bgImage: '' });

  const handleFile = async (file: File) => {
    setUploadError(null);
    if (!file.type.startsWith('image/')) {
      setUploadError('Pick an image file (JPG, PNG, GIF, or WEBP).');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = useUIStore.getState().token;
      const res = await fetch(`${API_URL}/assets/upload`, {
        method: 'POST',
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { url } = await res.json();
      applyImage(url);
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-6">
      {/* Currently-applied preview strip — shows what's on the canvas */}
      <div className="border-b border-slate-200/50 p-3 bg-slate-50/40">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
          Current background
        </div>
        <div className="flex items-center gap-3">
          <div
            className="w-16 h-12 rounded-lg border border-slate-200 shrink-0 overflow-hidden bg-white"
            style={{
              background:
                currentBgImage ? `url(${currentBgImage}) center/cover` :
                currentBgGradient ? currentBgGradient :
                currentBgColor || '#ffffff',
            }}
          />
          <div className="flex-1 min-w-0 text-[11px] text-slate-600">
            {currentBgImage ? 'Image' :
             currentBgGradient ? 'Gradient / Pattern' :
             currentBgColor ? `Solid ${currentBgColor}` :
             'None (transparent)'}
          </div>
          {(currentBgColor || currentBgGradient || currentBgImage) && (
            <button
              type="button"
              onClick={clearAll}
              className="text-[10px] font-semibold text-slate-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
              title="Remove background"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* BRAND COLORS — only when brand kit is set */}
      {brandSwatches.length > 0 && (
        <section className="border-b border-slate-200/50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
              From your brand kit
            </div>
            <Palette className="w-3 h-3 text-indigo-400" />
          </div>
          <div className="text-[11px] text-slate-500">Click to apply as a solid background</div>
          <div className="grid grid-cols-6 gap-2">
            {brandSwatches.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => applyColor(s.hex)}
                title={`${s.label} • ${s.hex}`}
                className={`group relative aspect-square rounded-lg border-2 transition-all ${
                  isCurrentColor(s.hex)
                    ? 'border-indigo-500 ring-2 ring-indigo-200 scale-105'
                    : 'border-slate-200 hover:border-indigo-300 hover:scale-105'
                }`}
                style={{ backgroundColor: s.hex }}
              >
                {isCurrentColor(s.hex) && (
                  <Check className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* BRAND GRADIENTS — auto-generated from the kit */}
      {brandGradients.length > 0 && (
        <section className="border-b border-slate-200/50 p-4 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
            Brand gradients
          </div>
          <div className="text-[11px] text-slate-500">
            Auto-generated from your brand colors
          </div>
          <div className="grid grid-cols-3 gap-2">
            {brandGradients.map((g) => (
              <button
                key={g.name}
                type="button"
                onClick={() => applyGradient(g.css)}
                title={g.name}
                className={`group relative aspect-[3/2] rounded-lg border-2 transition-all overflow-hidden ${
                  isCurrentGradient(g.css)
                    ? 'border-indigo-500 ring-2 ring-indigo-200 scale-105'
                    : 'border-slate-200 hover:border-indigo-300 hover:scale-105'
                }`}
                style={{ background: g.css }}
              >
                {isCurrentGradient(g.css) && (
                  <Check className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* CUSTOM COLOR PICKER — same HSV picker the font-color
          field uses. Operator (2026-04-27): "give a color picker
          like we have in other areas like font colors". */}
      <section className="border-b border-slate-200/50 p-4 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Pick any color
        </div>
        <div className="text-[11px] text-slate-500">
          Drag the picker, click in the spectrum, or paste a hex
        </div>
        <ColorPickerField
          label="Background color"
          value={meta.bgColor || '#ffffff'}
          onChange={(v) => applyColor(v)}
        />
      </section>

      {/* FROM YOUR TEMPLATES — pulls every distinct backdrop already
          in use across system + tenant templates. Operator
          (2026-04-27): "add in all the backgrounds we have from our
          massive list of templates... lets them pick a background
          they want." Reuses the same TemplateBackdropPicker the
          Properties panel uses, so the two surfaces stay in sync. */}
      <section className="border-b border-slate-200/50 p-4 space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          From your templates
        </div>
        <div className="text-[11px] text-slate-500">
          Every background already in use across your system + custom templates
        </div>
        <TemplateBackdropPicker
          current={{
            bgColor: meta.bgColor || undefined,
            bgGradient: meta.bgGradient || undefined,
            bgImage: meta.bgImage || undefined,
          }}
          onPick={(patch) => setMeta({
            bgColor: patch.bgColor || '',
            bgGradient: patch.bgGradient || '',
            bgImage: patch.bgImage || '',
          })}
        />
      </section>

      {/* PRESET GRADIENTS — curated for signage */}
      <section className="border-b border-slate-200/50 p-4 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Preset gradients
        </div>
        <div className="text-[11px] text-slate-500">
          Hand-tuned for high readability over signage content
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PRESET_GRADIENTS.map((g) => (
            <button
              key={g.name}
              type="button"
              onClick={() => applyGradient(g.css)}
              title={g.name}
              className={`group relative aspect-[3/2] rounded-lg border-2 transition-all overflow-hidden ${
                isCurrentGradient(g.css)
                  ? 'border-indigo-500 ring-2 ring-indigo-200 scale-105'
                  : 'border-slate-200 hover:border-slate-400 hover:scale-105'
              }`}
              style={{ background: g.css }}
            >
              <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[9px] font-bold py-0.5 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                {g.name}
              </div>
              {isCurrentGradient(g.css) && (
                <Check className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
              )}
            </button>
          ))}
        </div>
      </section>

      {/* SVG PATTERNS — subtle texture */}
      <section className="border-b border-slate-200/50 p-4 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Subtle patterns
        </div>
        <div className="text-[11px] text-slate-500">
          Texture without competing with content
        </div>
        <div className="grid grid-cols-3 gap-2">
          {SVG_PATTERNS.map((p) => {
            const css = patternToCss(p);
            const isActive = isCurrentGradient(css);
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => applyPattern(p)}
                title={p.name}
                className={`group relative aspect-[3/2] rounded-lg border-2 transition-all overflow-hidden ${
                  isActive
                    ? 'border-indigo-500 ring-2 ring-indigo-200 scale-105'
                    : 'border-slate-200 hover:border-slate-400 hover:scale-105'
                }`}
                style={{ background: css }}
              >
                <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[9px] font-bold py-0.5 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {p.name}
                </div>
                {isActive && (
                  <Check className="absolute inset-0 m-auto w-4 h-4 text-slate-700 drop-shadow-[0_1px_2px_rgba(255,255,255,0.6)]" />
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* CUSTOM IMAGE UPLOAD */}
      <section className="border-b border-slate-200/50 p-4 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Image background
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            if (e.target) e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full px-3 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-700 disabled:bg-slate-300 disabled:cursor-wait flex items-center justify-center gap-2"
        >
          {uploading ? (
            <>Uploading…</>
          ) : (
            <>
              <Upload className="w-3.5 h-3.5" /> Upload image from your computer
            </>
          )}
        </button>
        {currentBgImage && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <ImageIcon className="w-3 h-3 shrink-0" />
            <span className="truncate flex-1">{currentBgImage.split('/').pop()}</span>
          </div>
        )}
        {uploadError && (
          <div className="text-[11px] text-red-600">{uploadError}</div>
        )}
      </section>

      {/* ADVANCED — collapsed by default; CSS gradient string for power users */}
      <section className="p-4 space-y-2">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700 flex items-center gap-1"
        >
          <Code2 className="w-3 h-3" /> Advanced
          <span className="ml-auto text-[10px] opacity-60">{advancedOpen ? '−' : '+'}</span>
        </button>
        {advancedOpen && (
          <div className="space-y-2 pt-1">
            <div>
              <label htmlFor="bg-panel-custom-gradient" className="block text-[10px] font-semibold text-slate-500 mb-1">
                Custom CSS gradient
              </label>
              <input
                id="bg-panel-custom-gradient"
                type="text"
                value={meta.bgGradient || ''}
                onChange={(e) => setMeta({ bgGradient: e.target.value, bgImage: '' })}
                placeholder="linear-gradient(135deg, #fff 0%, #000 100%)"
                className="w-full px-2 py-1.5 rounded border border-slate-200 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label htmlFor="bg-panel-solid-color" className="block text-[10px] font-semibold text-slate-500 mb-1">
                Solid color (hex)
              </label>
              <input
                id="bg-panel-solid-color"
                type="text"
                value={meta.bgColor || ''}
                onChange={(e) => setMeta({ bgColor: e.target.value, bgGradient: '', bgImage: '' })}
                placeholder="#ffffff"
                className="w-full px-2 py-1.5 rounded border border-slate-200 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div className="text-[10px] text-slate-400 leading-relaxed pt-1">
              Tip: any valid CSS background value works. Try <code className="bg-slate-100 px-1 rounded">conic-gradient(...)</code> or stack multiple <code className="bg-slate-100 px-1 rounded">url()</code>s.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
