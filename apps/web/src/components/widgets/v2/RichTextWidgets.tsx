"use client";
/**
 * RICH TEXT pack — 5 widgets for formatted/styled prose blocks.
 * RT_NEON_TERMINAL, RT_PAPER_LETTER, RT_CRAYON_NOTEBOOK, RT_GLASS_DOC, RT_OPS_README
 */
import { resolveStyle, frameStyle } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';
import { sanitizeWidgetHtml } from '@/lib/sanitize-html';

interface RTCfg { style?: WidgetStyle; title?: string; eyebrow?: string; signature?: string; body?: string; }
const FALLBACK = 'Welcome to a brand new term. We are thrilled to share the great things our students and staff have been working on. Read on for the latest from every corner of campus.';

// Naive markdown-lite: **bold**, *italic*, --- hr, "> quote", paragraph splits on blank lines.
function renderRich(body: string, accent: string) {
  const blocks = body.split(/\n\s*\n/);
  return blocks.map((b, i) => {
    const t = b.trim();
    if (t === '---') return <hr key={i} style={{ border: 0, borderTop: `1px dashed ${accent}66`, margin: '12px 0' }} />;
    if (t.startsWith('> ')) return <blockquote key={i} style={{ margin: '8px 0', padding: '6px 14px', borderLeft: `3px solid ${accent}`, fontStyle: 'italic', color: accent }}>{t.slice(2)}</blockquote>;
    const html = sanitizeWidgetHtml(
      t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>'),
    );
    return <p key={i} style={{ margin: '0 0 10px 0' }} dangerouslySetInnerHTML={{ __html: html }} />;
  });
}

// 1. NEON TERMINAL
export function RichTextNeonTerminalWidget({ config }: WidgetProps<RTCfg>) {
  const c = config || {}; const r = resolveStyle({ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, textColor: '#a5f3fc', bgColor: '#0a0014', padding: 24, borderRadius: 12, accentColor: '#ff2bd6', accentColor2: '#00f0ff', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', letterSpacing: '0.2em', borderBottom: `1px dashed ${r.accent.primary}55`, paddingBottom: 6, marginBottom: 12 }}><b style={{ color: r.accent.primary, textShadow: `0 0 8px ${r.accent.primary}` }}>● {(c.eyebrow || 'BROADCAST').toUpperCase()}</b><span style={{ color: r.accent.secondary }}>{c.signature || 'admin'}</span></div>
        {c.title && <h2 style={{ margin: '0 0 12px 0', fontFamily: "'Audiowide', sans-serif", fontSize: '1.7em', color: r.accent.primary, textShadow: `0 0 16px ${r.accent.primary}`, letterSpacing: '0.05em' }}>&gt; {c.title}</h2>}
        <div style={{ flex: 1, overflow: 'hidden', fontSize: r.font.size, lineHeight: 1.6 }}>{renderRich(c.body || FALLBACK, r.accent.secondary)}</div>
      </div>
    </div>
  );
}

// 2. PAPER LETTER
export function RichTextPaperLetterWidget({ config }: WidgetProps<RTCfg>) {
  const c = config || {}; const r = resolveStyle({ fontFamily: "'Crimson Pro', Georgia, serif", fontSize: 20, textColor: '#0a0a0a', bgColor: '#f5f1e8', bgGradient: 'linear-gradient(180deg, #fbf7ee, #f5f1e8)', padding: 36, accentColor: '#7c1d1d', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ textAlign: 'center', borderBottom: '4px double #0a0a0a', paddingBottom: 12, marginBottom: 16 }}>
        {c.eyebrow && <div style={{ fontSize: '0.7em', letterSpacing: '0.4em', color: r.accent.primary, fontWeight: 700, textTransform: 'uppercase' }}>{c.eyebrow}</div>}
        {c.title && <h1 style={{ margin: '6px 0 0', fontSize: '2em', fontWeight: 900, fontFamily: "'Playfair Display', Georgia, serif" }}>{c.title}</h1>}
      </div>
      <div style={{ fontSize: r.font.size, lineHeight: 1.6, color: r.font.color }}>{renderRich(c.body || FALLBACK, r.accent.primary)}</div>
      {c.signature && <div style={{ marginTop: 16, fontFamily: 'cursive', fontSize: '1.4em', textAlign: 'right', color: r.accent.primary }}>— {c.signature}</div>}
    </div>
  );
}

// 3. CRAYON NOTEBOOK — elementary
export function RichTextCrayonNotebookWidget({ config }: WidgetProps<RTCfg>) {
  const c = config || {}; const r = resolveStyle({ fontFamily: "'Patrick Hand', cursive", fontSize: 26, textColor: '#1c1917', bgColor: '#fff8e7', bgGradient: 'linear-gradient(transparent 27px, #c7e3f5 28px, transparent 29px), #fff8e7', padding: 28, borderRadius: 8, borderWidth: 2, borderColor: '#0c4a6e', borderStyle: 'solid', accentColor: '#ff6b9d', ...(c.style || {}) });
  return (
    <div style={{ ...frameStyle(r), backgroundSize: '100% 28px', backgroundRepeat: 'repeat-y' }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 50, width: 2, background: '#dc2626', opacity: 0.3 }} />
      <div style={{ paddingLeft: 36, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {c.eyebrow && <div style={{ fontSize: '0.7em', color: r.accent.primary, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>★ {c.eyebrow} ★</div>}
        {c.title && <h2 style={{ margin: '0 0 8px 0', fontSize: '1.6em', fontWeight: 800, color: r.accent.primary, textDecoration: 'underline wavy' }}>{c.title}</h2>}
        <div style={{ fontSize: r.font.size, lineHeight: 1.4, flex: 1 }}>{renderRich(c.body || FALLBACK, r.accent.primary)}</div>
        {c.signature && <div style={{ fontSize: '1em', textAlign: 'right', color: r.accent.primary, fontWeight: 700 }}>♥ {c.signature}</div>}
      </div>
    </div>
  );
}

// 4. GLASS DOC
export function RichTextGlassDocWidget({ config }: WidgetProps<RTCfg>) {
  const c = config || {}; const r = resolveStyle({ fontFamily: "'Inter', sans-serif", fontSize: 18, textColor: '#0f172a', bgColor: 'rgba(255,255,255,0.75)', bgGradient: 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(168,85,247,0.06))', padding: 32, borderRadius: 24, accentColor: '#6366f1', ...(c.style || {}) });
  return (
    <div style={{ ...frameStyle(r), backdropFilter: 'blur(20px)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {c.eyebrow && <div style={{ fontSize: '0.75em', fontWeight: 700, letterSpacing: '0.2em', color: r.accent.primary, textTransform: 'uppercase', marginBottom: 4 }}>{c.eyebrow}</div>}
        {c.title && <h2 style={{ margin: '0 0 12px 0', fontSize: '2em', fontWeight: 600, letterSpacing: '-0.02em', color: r.font.color }}>{c.title}</h2>}
        <div style={{ flex: 1, fontSize: r.font.size, lineHeight: 1.65, color: '#334155' }}>{renderRich(c.body || FALLBACK, r.accent.primary)}</div>
        {c.signature && <div style={{ marginTop: 12, fontSize: '0.8em', color: '#64748b' }}>— {c.signature}</div>}
      </div>
    </div>
  );
}

// 5. OPS README
export function RichTextOpsReadmeWidget({ config }: WidgetProps<RTCfg>) {
  const c = config || {}; const r = resolveStyle({ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, textColor: '#cbd5e1', bgColor: '#0a0e14', padding: 24, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', accentColor: '#22d3ee', accentColor2: '#fbbf24', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ef4444' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#fbbf24' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#22c55e' }} />
          <span style={{ marginLeft: 12, fontSize: '0.85em', color: r.accent.primary }}>{c.eyebrow || 'README.md'}</span>
        </div>
        {c.title && <h2 style={{ margin: 0, fontSize: '1.5em', fontWeight: 700, color: r.accent.secondary }}># {c.title}</h2>}
        <div style={{ flex: 1, fontSize: r.font.size, lineHeight: 1.6 }}>{renderRich(c.body || FALLBACK, r.accent.primary)}</div>
        <div style={{ borderTop: `1px dashed ${r.accent.primary}55`, paddingTop: 6, fontSize: '0.85em', color: r.accent.primary }}>$ commit by {c.signature || 'admin'}_</div>
      </div>
    </div>
  );
}
