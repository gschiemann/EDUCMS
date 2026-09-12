"use client";
/**
 * PHOTOS pack — 5 photo-presentation widgets (polaroid stacks, mosaics, etc).
 * PHOTO_NEON_GLITCH, PHOTO_POLAROID_PIN, PHOTO_CRAYON_SCRAPBOOK, PHOTO_GLASS_MOSAIC, PHOTO_OPS_CONTACT_SHEET
 */
import { useEffect, useState } from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';
import { useElementSize } from './_shared/useElementSize';
import { sceneCss } from '../scene-css';

/**
 * useZoneFont — the base font-size every `em` in this file resolves against.
 *
 * 2026-09-11. `frameStyle()` resolves a `fontSize` and never applies it to the
 * frame, so the captions here were measured against the browser's inherited
 * 16px: on a 3840x2160 board a mosaic tile's caption rendered at 11.2px and a
 * contact-sheet filename at 12px. Measured in JS rather than with `cqh` —
 * these ship to Chromium 83 on a NovaStar Taurus, which has no container
 * queries (CLAUDE.md rule #10).
 */
function useZoneFont(design: number) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const base = width > 0 && height > 0
    ? Math.max(13, Math.min(height / 18, width / 36))
    : design;
  return { ref, fontSize: `${Math.round(base * 10) / 10}px` };
}

interface PhotoCfg { style?: WidgetStyle; photos?: { url?: string; caption?: string }[]; title?: string; rotateMs?: number; }
const Placeholder = ({ accent, label = 'photo' }: { accent: string; label?: string }) => (
  <div style={{ width: '100%', height: '100%', background: `repeating-linear-gradient(45deg, ${accent}22, ${accent}22 8px, ${accent}11 8px, ${accent}11 16px)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, fontFamily: 'monospace', fontSize: '0.7em', letterSpacing: '0.2em', overflow: 'hidden' }}><span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label.toUpperCase()}</span></div>
);
function useRotate(n: number, ms: number) { const [i, setI] = useState(0); useEffect(() => { if (n <= 1) return; const id = setInterval(() => setI(p => (p + 1) % n), ms); return () => clearInterval(id); }, [n, ms]); return i; }

// 1. NEON GLITCH
export function PhotoNeonGlitchWidget({ config }: WidgetProps<PhotoCfg>) {
  const c = config || {}; const photos = c.photos?.length ? c.photos : [{ caption: 'Game Night' }, { caption: 'Pep Rally' }, { caption: 'Robotics' }];
  const r = resolveStyle({ fontFamily: "'Audiowide', sans-serif", fontSize: 22, textColor: '#fff', bgColor: '#0a0014', padding: 16, borderRadius: 12, accentColor: '#ff2bd6', accentColor2: '#00f0ff', ...(c.style || {}) });
  const idx = useRotate(photos.length, c.rotateMs || 4000); const dur = animDurationSec(r.anim.speed, 0.4);
  const z = useZoneFont(22);
  return (
    <div ref={z.ref} style={{ ...frameStyle(r), fontSize: z.fontSize }}>
      {r.anim.on && <style>{sceneCss(`@keyframes glitch { 0%,90%,100% { transform: translate(0); } 92% { transform: translate(-3px,2px); } 95% { transform: translate(2px,-2px); } }`)}</style>}
      <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 8, overflow: 'hidden', border: `2px solid ${r.accent.primary}`, boxShadow: `0 0 24px ${r.accent.primary}88`, animation: r.anim.on ? `glitch ${dur * 6}s steps(2) infinite` : 'none' }}>
        {photos[idx]?.url ? <img src={photos[idx].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(1.4) contrast(1.1)' }} /> : <Placeholder accent={r.accent.primary} label={photos[idx]?.caption || 'photo'} />}
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: `linear-gradient(180deg, transparent 50%, rgba(255,43,214,0.15) 100%)`, mixBlendMode: 'screen' }} />
        <div style={{ position: 'absolute', bottom: '0.55em', left: '0.55em', right: '0.55em', color: r.accent.primary, fontSize: '1em', letterSpacing: '0.2em', textShadow: `0 0 12px ${r.accent.primary}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>● {photos[idx]?.caption || c.title || 'GALLERY'}</div>
        <div style={{ position: 'absolute', top: '0.36em', right: '0.55em', color: r.accent.secondary, fontSize: '0.75em', letterSpacing: '0.2em' }}>{idx + 1} / {photos.length}</div>
      </div>
    </div>
  );
}

// 2. POLAROID PIN
export function PhotoPolaroidPinWidget({ config }: WidgetProps<PhotoCfg>) {
  const c = config || {}; const photos = c.photos?.length ? c.photos : [{ caption: 'Field Trip!' }, { caption: 'Art Class' }, { caption: 'Concert' }];
  const r = resolveStyle({ fontFamily: "'Patrick Hand', cursive", fontSize: 28, textColor: '#1c1917', bgColor: '#a16207', bgGradient: 'repeating-radial-gradient(circle at 30% 20%, #b45309 0px, #a16207 4px, #92400e 8px)', padding: 24, borderRadius: 8, accentColor: '#dc2626', ...(c.style || {}) });
  const z = useZoneFont(28);
  return (
    <div ref={z.ref} style={{ ...frameStyle(r), fontSize: z.fontSize }}>
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', gap: '0.43em' }}>
        {photos.slice(0, 3).map((p, i) => (
          <div key={i} style={{ background: '#fff', padding: '0.36em 0.36em 1.14em', boxShadow: '0 12px 24px rgba(0,0,0,0.3)', transform: `rotate(${[-4, 2, -2][i] || 0}deg)`, position: 'relative', flex: 1, maxWidth: '32%' }}>
            <span style={{ position: 'absolute', top: '-0.21em', left: '50%', transform: 'translateX(-50%) rotate(45deg)', width: '0.64em', height: '0.64em', background: r.accent.primary, borderRadius: 2, boxShadow: '0 2px 4px rgba(0,0,0,0.3)' }} />
            <div style={{ aspectRatio: '1/1', overflow: 'hidden', filter: 'sepia(0.1)' }}>{p.url ? <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder accent="#94a3b8" label="snapshot" />}</div>
            <div style={{ textAlign: 'center', fontSize: '1em', marginTop: '0.21em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.caption}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 3. CRAYON SCRAPBOOK — elementary
export function PhotoCrayonScrapbookWidget({ config }: WidgetProps<PhotoCfg>) {
  const c = config || {}; const photos = c.photos?.length ? c.photos : [{ caption: 'Recess!' }, { caption: 'Reading Buddies' }, { caption: 'Science' }, { caption: 'Music' }];
  const r = resolveStyle({ fontFamily: "'Fredoka', sans-serif", fontSize: 22, textColor: '#1c1917', bgColor: '#fff8e7', padding: 24, borderRadius: 32, accentColor: '#ff6b9d', accentColor2: '#4ecdc4', highlightColor: '#ffd93d', ...(c.style || {}) });
  const colors = [r.accent.primary, r.accent.secondary, r.accent.highlight, '#a78bfa'];
  const z = useZoneFont(22);
  return (
    /* The card grid used to be an unbounded `aspect-ratio: 4/3` 2x2 — on a
       3840x2160 board each cell computed 1422px tall, so the second row (and
       its captions) fell off the bottom of the zone. The frame is now a flex
       column and the grid owns the leftover height, with each photo filling
       its card instead of dictating the card's size. */
    <div ref={z.ref} style={{ ...frameStyle(r), fontSize: z.fontSize, display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ margin: 0, marginBottom: '0.55em', fontSize: '1.6em', fontWeight: 800, textAlign: 'center', flex: '0 0 auto' }}>📸 {c.title || 'Our Memories!'}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridTemplateRows: 'repeat(2, minmax(0, 1fr))', gap: '0.64em', flex: '1 1 0', minHeight: 0 }}>
        {photos.slice(0, 4).map((p, i) => (
          <div key={i} style={{ background: colors[i], padding: '0.36em', borderRadius: 16, transform: `rotate(${[-3, 2, -1, 3][i] || 0}deg)`, boxShadow: '0 6px 0 rgba(0,0,0,0.15)', minHeight: 0, display: 'flex' }}>
            <div style={{ background: '#fff', padding: '0.27em', borderRadius: 12, flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', borderRadius: 8 }}>{p.url ? <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder accent={colors[i]} label={p.caption || 'fun'} />}</div>
              <div style={{ flex: '0 0 auto', textAlign: 'center', fontSize: '1em', fontWeight: 800, padding: '0.18em 0', color: colors[i], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>★ {p.caption} ★</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 4. GLASS MOSAIC
export function PhotoGlassMosaicWidget({ config }: WidgetProps<PhotoCfg>) {
  const c = config || {}; const photos = c.photos?.length ? c.photos : [{ caption: 'Spring Concert' }, { caption: 'Lab' }, { caption: 'Athletics' }, { caption: 'Service' }, { caption: 'Arts' }];
  const r = resolveStyle({ fontFamily: "'Inter', sans-serif", fontSize: 18, textColor: '#0f172a', bgColor: 'rgba(255,255,255,0.7)', padding: 20, borderRadius: 24, accentColor: '#6366f1', ...(c.style || {}) });
  const z = useZoneFont(18);
  return (
    <div ref={z.ref} style={{ ...frameStyle(r), fontSize: z.fontSize, backdropFilter: 'blur(20px)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gridTemplateRows: 'repeat(2, minmax(0, 1fr))', gap: '0.44em', height: '100%' }}>
        {photos.slice(0, 5).map((p, i) => (
          <div key={i} style={{ borderRadius: 16, overflow: 'hidden', position: 'relative', gridColumn: i === 0 ? '1' : undefined, gridRow: i === 0 ? '1 / 3' : undefined, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
            {p.url ? <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder accent={r.accent.primary} label={p.caption || 'photo'} />}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0.55em', background: 'linear-gradient(transparent, rgba(0,0,0,0.6))', color: '#fff', fontSize: i === 0 ? '0.95em' : '0.7em', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.caption}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 5. OPS CONTACT SHEET
export function PhotoOpsContactSheetWidget({ config }: WidgetProps<PhotoCfg>) {
  const c = config || {}; const photos = c.photos?.length ? c.photos : [{ caption: 'IMG_0421' }, { caption: 'IMG_0422' }, { caption: 'IMG_0423' }, { caption: 'IMG_0424' }, { caption: 'IMG_0425' }, { caption: 'IMG_0426' }];
  const r = resolveStyle({ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textColor: '#fafafa', bgColor: '#0a0e14', padding: 20, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', accentColor: '#22d3ee', ...(c.style || {}) });
  const z = useZoneFont(13);
  return (
    <div ref={z.ref} style={{ ...frameStyle(r), fontSize: z.fontSize }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.44em', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px dashed ${r.accent.primary}55`, paddingBottom: '0.22em', fontSize: '1em', flex: '0 0 auto' }}><b style={{ color: r.accent.primary, letterSpacing: '0.2em' }}>● {(c.title || 'CONTACT_SHEET').toUpperCase()}</b><span>{photos.length} ASSETS</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridTemplateRows: 'repeat(2, minmax(0, 1fr))', gap: '0.33em', flex: '1 1 0', minHeight: 0 }}>
          {photos.slice(0, 6).map((p, i) => (
            <div key={i} style={{ position: 'relative', borderRadius: 4, overflow: 'hidden', border: `1px solid ${r.accent.primary}55`, filter: 'grayscale(0.5) contrast(1.2)' }}>
              {p.url ? <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <Placeholder accent={r.accent.primary} label={`#${i + 1}`} />}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#0a0e14', padding: '0.15em 0.3em', fontSize: '0.8em', color: r.accent.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.caption}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
