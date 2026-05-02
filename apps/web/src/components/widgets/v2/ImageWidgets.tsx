"use client";
/**
 * IMAGES pack — 5 single-image widgets with treatments (full-bleed, framed, etc).
 * IMG_NEON_BANNER, IMG_PAPER_FRAMED, IMG_CRAYON_STICKER, IMG_GLASS_HERO, IMG_OPS_ASSET
 */
import { resolveStyle, frameStyle } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';

interface ImgCfg { style?: WidgetStyle; url?: string; alt?: string; caption?: string; eyebrow?: string; fit?: 'cover' | 'contain'; }
const Placeholder = ({ color, label }: { color: string; label?: string }) => (
  <div style={{ width: '100%', height: '100%', background: `repeating-linear-gradient(45deg, ${color}33, ${color}33 12px, ${color}1a 12px, ${color}1a 24px)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, fontFamily: 'monospace', fontSize: 14, letterSpacing: '0.3em' }}>{(label || 'IMAGE').toUpperCase()}</div>
);

// 1. NEON BANNER
export function ImageNeonBannerWidget({ config }: WidgetProps<ImgCfg>) {
  const c = config || {}; const r = resolveStyle({ fontFamily: "'Audiowide', sans-serif", fontSize: 22, textColor: '#fff', bgColor: '#0a0014', padding: 0, borderRadius: 12, accentColor: '#ff2bd6', accentColor2: '#00f0ff', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 10, border: `2px solid ${r.accent.primary}`, boxShadow: `0 0 24px ${r.accent.primary}88, inset 0 0 60px ${r.accent.primary}22` }}>
        {c.url ? <img src={c.url} alt={c.alt || ''} style={{ width: '100%', height: '100%', objectFit: c.fit || 'cover', filter: 'saturate(1.3) contrast(1.1)' }} /> : <Placeholder color={r.accent.primary} label={c.alt} />}
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, transparent 40%, rgba(10,0,20,0.85))`, pointerEvents: 'none' }} />
        {c.eyebrow && <div style={{ position: 'absolute', top: 14, left: 14, padding: '4px 12px', background: r.accent.primary, color: '#0a0014', fontSize: '0.7em', letterSpacing: '0.3em', fontWeight: 800, boxShadow: `0 0 16px ${r.accent.primary}` }}>● {c.eyebrow}</div>}
        {c.caption && <div style={{ position: 'absolute', bottom: 18, left: 18, right: 18, color: r.accent.primary, fontSize: r.font.size, letterSpacing: '0.1em', textShadow: `0 0 12px ${r.accent.primary}` }}>{c.caption}</div>}
      </div>
    </div>
  );
}

// 2. PAPER FRAMED
export function ImagePaperFramedWidget({ config }: WidgetProps<ImgCfg>) {
  const c = config || {}; const r = resolveStyle({ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, textColor: '#0a0a0a', bgColor: '#f5f1e8', padding: 16, accentColor: '#7c1d1d', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ background: '#fff', padding: 14, height: '100%', display: 'flex', flexDirection: 'column', boxShadow: 'inset 0 0 0 1px #d6d3d1' }}>
        <div style={{ flex: 1, overflow: 'hidden', border: '1px solid #d6d3d1' }}>{c.url ? <img src={c.url} alt={c.alt || ''} style={{ width: '100%', height: '100%', objectFit: c.fit || 'cover', filter: 'sepia(0.15)' }} /> : <Placeholder color="#94a3b8" label={c.alt} />}</div>
        {(c.caption || c.eyebrow) && (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            {c.eyebrow && <div style={{ fontSize: '0.65em', letterSpacing: '0.4em', color: r.accent.primary, fontWeight: 700, textTransform: 'uppercase' }}>{c.eyebrow}</div>}
            {c.caption && <div style={{ fontStyle: 'italic', fontSize: r.font.size, marginTop: 4 }}>{c.caption}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// 3. CRAYON STICKER — elementary
export function ImageCrayonStickerWidget({ config }: WidgetProps<ImgCfg>) {
  const c = config || {}; const r = resolveStyle({ fontFamily: "'Fredoka', sans-serif", fontSize: 22, textColor: '#1c1917', bgColor: '#fff8e7', padding: 24, borderRadius: 32, accentColor: '#ff6b9d', accentColor2: '#4ecdc4', highlightColor: '#ffd93d', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ background: r.accent.primary, padding: 10, borderRadius: 24, transform: 'rotate(-2deg)', boxShadow: '0 8px 0 rgba(0,0,0,0.15)', height: 'calc(100% - 16px)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, background: '#fff', padding: 8, borderRadius: 18, position: 'relative', overflow: 'hidden' }}>
          <div style={{ width: '100%', height: c.caption ? 'calc(100% - 36px)' : '100%', overflow: 'hidden', borderRadius: 12 }}>{c.url ? <img src={c.url} alt={c.alt || ''} style={{ width: '100%', height: '100%', objectFit: c.fit || 'cover' }} /> : <Placeholder color={r.accent.primary} label={c.alt || 'photo'} />}</div>
          {c.caption && <div style={{ height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: r.font.size, fontWeight: 800, color: r.accent.primary }}>★ {c.caption} ★</div>}
        </div>
      </div>
    </div>
  );
}

// 4. GLASS HERO
export function ImageGlassHeroWidget({ config }: WidgetProps<ImgCfg>) {
  const c = config || {}; const r = resolveStyle({ fontFamily: "'Inter', sans-serif", fontSize: 22, textColor: '#fff', bgColor: 'rgba(255,255,255,0.7)', padding: 0, borderRadius: 24, accentColor: '#6366f1', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: r.box.radius, overflow: 'hidden' }}>
        {c.url ? <img src={c.url} alt={c.alt || ''} style={{ width: '100%', height: '100%', objectFit: c.fit || 'cover' }} /> : <Placeholder color={r.accent.primary} label={c.alt} />}
        {(c.caption || c.eyebrow) && (
          <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, padding: '12px 16px', background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(20px)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.25)', color: '#fff' }}>
            {c.eyebrow && <div style={{ fontSize: '0.7em', letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.85, fontWeight: 600 }}>{c.eyebrow}</div>}
            {c.caption && <div style={{ fontSize: r.font.size, fontWeight: 600, marginTop: 2 }}>{c.caption}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// 5. OPS ASSET
export function ImageOpsAssetWidget({ config }: WidgetProps<ImgCfg>) {
  const c = config || {}; const r = resolveStyle({ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, textColor: '#cbd5e1', bgColor: '#0a0e14', padding: 16, borderRadius: 6, borderWidth: 1, borderColor: '#1e293b', accentColor: '#22d3ee', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px dashed ${r.accent.primary}55`, paddingBottom: 4 }}>
          <span style={{ color: r.accent.primary, letterSpacing: '0.2em' }}>● ASSET</span>
          <span style={{ color: r.accent.secondary }}>{(c.eyebrow || 'IMG/01').toUpperCase()}</span>
        </div>
        <div style={{ flex: 1, border: `1px solid ${r.accent.primary}55`, overflow: 'hidden', position: 'relative' }}>
          {c.url ? <img src={c.url} alt={c.alt || ''} style={{ width: '100%', height: '100%', objectFit: c.fit || 'cover', filter: 'grayscale(0.3) contrast(1.1)' }} /> : <Placeholder color={r.accent.primary} label={c.alt} />}
          <div style={{ position: 'absolute', top: 4, left: 4, fontSize: '0.85em', color: r.accent.primary, background: 'rgba(10,14,20,0.7)', padding: '2px 6px', letterSpacing: '0.15em' }}>+CROP</div>
        </div>
        {c.caption && <div style={{ fontSize: r.font.size, color: r.accent.secondary }}>// {c.caption}</div>}
      </div>
    </div>
  );
}
