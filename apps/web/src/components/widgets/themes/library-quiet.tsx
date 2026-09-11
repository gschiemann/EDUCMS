import React, { useState, useEffect } from 'react';
import { sanitizeWidgetHtml } from '@/lib/sanitize-html';
import { sceneCss } from '../scene-css';

// ═══════════════════════════════════════════════════════════════════════════
// LIBRARY QUIET THEME - Elegant Wood, Brass & Leather
// ═══════════════════════════════════════════════════════════════════════════

export function LibraryQuietText({ config, compact }: { config: any; compact?: boolean } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const content = config.content || 'Media Center';
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center p-8" style={{
      background: 'linear-gradient(180deg, #f8f4eb 0%, #e8dec3 100%)',
      borderRadius: '8px',
      border: '4px solid #4a2818',
      boxShadow: 'inset 0 0 20px rgba(0,0,0,0.1), 0 10px 30px rgba(0,0,0,0.5)',
      containerType: 'size'
    }}>
      <h1 data-field="content" style={{
        fontSize: 'clamp(2rem, 15cqi, 8rem)',
        color: '#2a1610',
        fontFamily: '"Playfair Display", Georgia, serif',
        textShadow: '1px 2px 0px rgba(255,255,255,0.8)',
        textAlign: 'center',
        margin: 0,
        whiteSpace: 'pre-wrap' as const
      }}>
        {content}
      </h1>
    </div>
  );
}

export function LibraryQuietClock({ config, compact }: { config: any; compact?: boolean }) {
  const [time, setTime] = useState('');
  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
    update();
    const int = setInterval(update, 1000);
    return () => clearInterval(int);
  }, []);
  
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center p-4" style={{
      background: '#2a1610',
      borderRadius: '8px',
      border: '3px solid #d4af37',
      boxShadow: '0 10px 25px rgba(0,0,0,0.6)',
      containerType: 'size'
    }}>
      <div data-field="time" style={{
        fontSize: 'clamp(2rem, 25cqi, 10rem)',
        color: '#f8f4eb',
        fontFamily: 'Georgia, serif',
        letterSpacing: '0.05em',
        whiteSpace: 'pre-wrap' as const
      }}>
        {time}
      </div>
    </div>
  );
}

export function LibraryQuietImage({ config, compact }: { config: any; compact?: boolean }) {
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 p-6 flex flex-col items-center justify-center" style={{ containerType: 'size' }}>
      <div style={{
        background: '#fff',
        padding: '3cqh',
        paddingBottom: '12cqh',
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        transform: 'rotate(2deg)',
        borderRadius: '2px',
        width: '80cqi',
        height: '90cqh',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{
          flex: 1,
          border: '1px solid #e5e5e5',
          background: '#f5f5f5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}>
          {config.url ? (
            <img src={config.url} alt="Book" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ color: '#a8a29e', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: '5cqi' }}>Book of the Month</div>
          )}
        </div>
        <div style={{
          position: 'absolute',
          bottom: '3cqh',
          left: 0,
          width: '100%',
          textAlign: 'center',
          fontFamily: 'Georgia, serif',
          color: '#444',
          fontSize: '6cqh',
          letterSpacing: '0.05em'
        }}>
          Featured Title
        </div>
      </div>
    </div>
  );
}

export function LibraryQuietRichText({ config, compact }: { config: any; compact?: boolean } & { onConfigChange?: (p: Record<string, any>) => void }) {
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 p-8 flex flex-col" style={{
      background: 'rgba(248, 244, 235, 0.9)',
      backdropFilter: 'blur(10px)',
      borderRadius: '8px',
      border: '1px solid #d4af37',
      borderTopWidth: '8px',
      boxShadow: '0 15px 35px rgba(0,0,0,0.3)',
      overflow: 'hidden',
      containerType: 'size'
    }}>
      {/* §19 (2026-09-11) — this block is `config.html`, real MARKUP. A
          contenteditable commits innerText, which would flatten <h3>/<p>
          into one unstyled line the first time anyone clicked it, so the
          hotspot JUMPS to the RICH_TEXT "HTML (advanced)" editor instead of
          accepting typing. Key matches that field exactly (cfg.html) — note
          this variant reads `html`, NOT the `content` the plain TEXT
          variants use. */}
      <div
        data-field-jump="html"
        className="prose prose-stone max-w-none font-serif flex-1"
        style={{ color: '#2a1610', fontSize: 'clamp(1rem, 5cqi, 2.5rem)' }}
        dangerouslySetInnerHTML={{ __html: sanitizeWidgetHtml(config.html || '<h3>Library Hours</h3><p>Quiet Study: 8:00 — 11:00 AM</p>') }}
      />
    </div>
  );
}


/** First editor-backed shape that actually has content wins. */
function resolveLibraryMeal(config: any): { label: string; items: string[] } {
  const legacy = config?.meals?.[0];
  if (legacy?.items?.length) return { label: String(legacy.label || 'Today'), items: legacy.items.map(String) };

  // `days` — what PropertiesPanel writes and the v2 LunchMenu pack reads.
  const day = Array.isArray(config?.days) ? config.days[0] : undefined;
  if (day) {
    const sides = Array.isArray(day.sides) ? day.sides : (day.sides ? [day.sides] : []);
    const items = [day.entree, ...sides, day.dessert].filter(Boolean).map(String);
    if (items.length) return { label: String(day.day || 'Today'), items };
  }

  // `menu` — the raw newline-delimited textarea, "Monday: Pizza, Salad".
  if (typeof config?.menu === 'string' && config.menu.trim()) {
    const [first] = config.menu.split('\n').filter(Boolean);
    if (first) {
      const [label, ...rest] = first.split(':');
      const items = rest.join(':').split(/[,·•]+/).map((x: string) => x.trim()).filter(Boolean);
      if (items.length) return { label: label.trim() || 'Today', items };
    }
  }

  return { label: 'Today', items: ['Chef Salad', 'Tomato Soup'] };
}

/**
 * §19 (2026-09-11) — this widget was UNREACHABLE by any editor, and a hotspot
 * alone would not have fixed it.
 *
 * It rendered `config.meals`, and NOTHING writes `meals`. Across all of
 * apps/web/src the key appeared exactly twice: read here, and CLEARED
 * (`meals: undefined`) by PropertiesPanel's LUNCH_MENU paste handler. So every
 * board showed the hard-coded "Chef Salad / Tomato Soup" fallback — invented
 * food on a school lunch board that no operator could change. That is both
 * halves of §19 failing at once: not editable, and not true.
 *
 * Now it reads the keys the editor actually writes — `days` (the structured
 * rows the panel builds, and what the v2 LunchMenu widgets read) falling back
 * to the raw `menu` text — and the rows carry `data-field-jump="menu"` so a
 * click lands on the real menu editor. `meals` is still honoured first so any
 * board that somehow carries one keeps rendering exactly as it did.
 */
export function LibraryQuietLunch({ config, compact }: { config: any; compact?: boolean }) {
  const meal = resolveLibraryMeal(config);
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 p-8 flex flex-col" style={{
      background: 'rgba(42, 22, 16, 0.9)',
      backdropFilter: 'blur(10px)',
      borderRadius: '8px',
      border: '2px solid #d4af37',
      boxShadow: '0 15px 35px rgba(0,0,0,0.4)',
      containerType: 'size'
    }}>
      <h3 style={{
        fontSize: 'clamp(1.5rem, 8cqi, 3rem)',
        fontFamily: 'Georgia, serif',
        color: '#d4af37',
        borderBottom: '1px solid rgba(212, 175, 55, 0.3)',
        paddingBottom: '2cqh',
        marginBottom: '4cqh',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        textAlign: 'center'
      }}>Cafe Express</h3>
      <div data-field-jump="menu" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3cqh', justifyContent: 'center', alignItems: 'center' }}>
        {meal.items.map((item: string, i: number) => (
          <div key={i} style={{ color: '#f8f4eb', fontFamily: 'Georgia, serif', fontSize: 'clamp(1.2rem, 6cqi, 2.5rem)', textAlign: 'center', width: '100%' }}>
            • {item}
          </div>
        ))}
        {meal.items.length === 0 && <div style={{ color: '#a8a29e', fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>Menu unavailable</div>}
      </div>
    </div>
  );
}

export function LibraryQuietTicker({ config, compact }: { config: any; compact?: boolean }) {
  const messages = config.messages || ['Please keep voices low.', 'Return books to the front desk.'];
  const text = messages.join('   ✦   ');
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center overflow-hidden" style={{
      background: '#1f100a',
      color: '#d4af37',
      borderTop: '2px solid #4a2818',
      borderBottom: '2px solid #4a2818'
    }}>
      <div style={{ padding: '0 30px', background: '#d4af37', color: '#1f100a', height: '100%', display: 'flex', alignItems: 'center', fontWeight: 'bold', fontFamily: 'Georgia, serif', textTransform: 'uppercase', letterSpacing: '0.1em', zIndex: 10 }}>
        Notes
      </div>
      <div style={{ flex: 1, position: 'relative', height: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
        {/* §19 (2026-09-11) — `config.messages.join(' ✦ ')`: a list, so the
            click opens the Messages editor rather than committing one flat
            string over the array. The "Notes" pill is hard-coded chrome. */}
        <div data-field-jump="messages" style={{
          whiteSpace: 'nowrap',
          animation: 'libraryTicker 40s linear infinite',
          fontSize: '4vh',
          fontFamily: 'Georgia, serif',
          paddingLeft: '100%',
          letterSpacing: '0.05em'
        }}>
          {text}   ✦   {text}
        </div>
      </div>
      <style>{sceneCss(`@keyframes libraryTicker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`)}</style>
    </div>
  );
}
