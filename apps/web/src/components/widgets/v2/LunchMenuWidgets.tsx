"use client";
/**
 * LUNCH MENUS pack — 5 widgets for daily / weekly cafeteria menus.
 * LUNCH_NEON_DRIVEIN, LUNCH_PAPER_CHALK, LUNCH_CRAYON_TRAY, LUNCH_GLASS_BISTRO, LUNCH_OPS_INVENTORY
 *
 * §19 CLICK-TO-EDIT (2026-09-11) — all five rendered the operator's words with
 * NO hotspot on the canvas. Two affordances, chosen per shape:
 *   • `c.title` is ONE string every variant always paints, so it gets a true
 *     inline `data-field="title"` (the panel's LUNCH_MENU case writes the same
 *     key). Where a literal emoji sits beside it, the hotspot wraps only the
 *     expression — a commit takes the element's WHOLE innerText.
 *   • the meal rows come from the `days[]` ARRAY of { day, entree, sides[],
 *     dessert } objects. A contentEditable there would commit one flat string
 *     over the structure and wipe every row, so they get
 *     `data-field-jump="weekMenu"` — the click opens the panel's real Mon-Fri
 *     WeekMenuEditor, which is what writes `days` (PropertiesPanel translates
 *     its CafeWeek shape into this pack's `days` on every keystroke).
 */
import { useEffect, useMemo, useState } from 'react';
import { resolveStyle, frameStyle } from './_shared/styleSystem';
import type { WidgetStyle } from './_shared/styleSystem';
import type { WidgetProps } from './_shared/types';

interface MenuDay { day?: string; date?: string; entree?: string; sides?: string | string[]; dessert?: string; }
interface LunchCfg { style?: WidgetStyle; title?: string; days?: MenuDay[]; mode?: 'today' | 'week'; clockTimeZone?: string; }

const FALLBACK: MenuDay[] = [
  { day: 'MON', entree: 'Cheese Pizza', sides: ['Garden Salad', 'Apple Slices'], dessert: 'Cookie' },
  { day: 'TUE', entree: 'Chicken Tenders', sides: ['Mashed Potatoes', 'Corn'], dessert: 'Brownie' },
  { day: 'WED', entree: 'Tacos', sides: ['Rice', 'Beans'], dessert: 'Churro' },
  { day: 'THU', entree: 'Pasta Marinara', sides: ['Garlic Bread', 'Steamed Broccoli'], dessert: 'Pudding' },
  { day: 'FRI', entree: 'Hamburger', sides: ['Fries', 'Pickles'], dessert: 'Ice Cream' },
];
function toArr(s?: string | string[]) { if (!s) return []; return Array.isArray(s) ? s : s.split(/[,·•]+/).map(x => x.trim()).filter(Boolean); }
function todayIdx(tz?: string) { const d = new Date(); const opts: Intl.DateTimeFormatOptions = { weekday: 'short', ...(tz ? { timeZone: tz } : {}) }; const w = new Intl.DateTimeFormat('en-US', opts).format(d).toUpperCase().slice(0, 3); return ['MON', 'TUE', 'WED', 'THU', 'FRI'].indexOf(w); }

// 1. NEON DRIVE-IN — vintage diner sign
export function LunchNeonDriveInWidget({ config, live }: WidgetProps<LunchCfg>) {
  const c = config || {}; const days = c.days?.length ? c.days : FALLBACK;
  const r = resolveStyle({ fontFamily: "'Audiowide', sans-serif", fontSize: 20, textColor: '#fff', bgColor: '#0a0014', padding: 28, borderRadius: 16, accentColor: '#ff2bd6', accentColor2: '#ffd60a', highlightColor: '#00f0ff', ...(c.style || {}) });
  const idx = useMemo(() => Math.max(0, todayIdx(c.clockTimeZone)), [c.clockTimeZone]);
  const today = days[Math.min(idx, days.length - 1)] || days[0];
  return (
    <div style={frameStyle(r)}>
      <div style={{ textAlign: 'center', borderBottom: `2px solid ${r.accent.primary}`, paddingBottom: 8, marginBottom: 12 }}>
        <div style={{ color: r.accent.highlight, fontSize: '0.7em', letterSpacing: '0.4em', textShadow: `0 0 8px ${r.accent.highlight}` }}>★ TODAY'S SPECIAL ★</div>
        <div style={{ color: r.accent.primary, fontSize: '1.6em', textShadow: `0 0 16px ${r.accent.primary}`, letterSpacing: '0.1em' }} data-field="title">{c.title || 'EAT HERE'}</div>
      </div>
      <div data-field-jump="weekMenu" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ color: r.accent.secondary, fontSize: '2em', fontFamily: "'Bungee', sans-serif", textShadow: `0 0 16px ${r.accent.secondary}` }}>{today?.entree}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>{toArr(today?.sides).map((s, i) => <span key={i} style={{ border: `1px solid ${r.accent.highlight}`, color: r.accent.highlight, padding: '4px 12px', fontSize: '0.85em', letterSpacing: '0.15em', borderRadius: 999, textShadow: `0 0 6px ${r.accent.highlight}` }}>+ {s}</span>)}</div>
        {today?.dessert && <div style={{ color: r.accent.primary, fontSize: r.font.size, letterSpacing: '0.2em' }}>♥ {today.dessert} ♥</div>}
      </div>
    </div>
  );
}

// 2. PAPER CHALK — chalkboard cafe
export function LunchPaperChalkWidget({ config }: WidgetProps<LunchCfg>) {
  const c = config || {}; const days = c.days?.length ? c.days : FALLBACK;
  const r = resolveStyle({ fontFamily: "'Caveat', cursive", fontSize: 22, textColor: '#fef3c7', bgColor: '#1c2618', bgGradient: 'radial-gradient(ellipse at 30% 20%, #2a3322, #1c2618 80%)', padding: 28, borderRadius: 8, borderWidth: 8, borderColor: '#78350f', borderStyle: 'solid', accentColor: '#fde68a', accentColor2: '#f87171', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ textAlign: 'center', borderBottom: `2px dashed ${r.accent.primary}`, paddingBottom: 6, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: '2em', fontFamily: "'Caveat', cursive", color: r.accent.primary, fontWeight: 700 }} data-field="title">{c.title || "Today's Menu"}</h2>
      </div>
      <div data-field-jump="weekMenu" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, fontSize: r.font.size }}>
        {days.slice(0, 5).map((d, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr auto', alignItems: 'baseline', gap: 10, borderBottom: `1px dotted ${r.accent.primary}55`, paddingBottom: 4 }}>
            <span style={{ color: r.accent.secondary, fontWeight: 700, fontSize: '1.1em' }}>{d.day}</span>
            <span><b style={{ color: r.accent.primary }}>{d.entree}</b><span style={{ opacity: 0.7, marginLeft: 8, fontSize: '0.85em' }}>{toArr(d.sides).join(' · ')}</span></span>
            <span style={{ color: r.accent.secondary, fontSize: '0.85em' }}>{d.dessert}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 3. CRAYON TRAY — elementary
export function LunchCrayonTrayWidget({ config, live }: WidgetProps<LunchCfg>) {
  const c = config || {}; const days = c.days?.length ? c.days : FALLBACK;
  const idx = useMemo(() => Math.max(0, todayIdx(c.clockTimeZone)), [c.clockTimeZone]);
  const today = days[Math.min(idx, days.length - 1)] || days[0];
  const r = resolveStyle({ fontFamily: "'Fredoka', sans-serif", fontSize: 22, textColor: '#1c1917', bgColor: '#fff8e7', padding: 24, borderRadius: 32, accentColor: '#ff6b9d', accentColor2: '#4ecdc4', highlightColor: '#ffd93d', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.6em', fontWeight: 800 }}>🍽️ <span data-field="title">{c.title || "Today's Lunch!"}</span></h2>
        <div style={{ fontSize: '0.85em', fontWeight: 700, color: r.accent.primary, letterSpacing: '0.2em' }}>YUMMY YUMMY!</div>
      </div>
      <div data-field-jump="weekMenu" style={{ marginTop: 16, background: '#fff', border: `4px solid ${r.accent.secondary}`, borderRadius: 24, padding: 16, transform: 'rotate(-1deg)', boxShadow: '0 8px 0 rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{ background: r.accent.primary, color: '#fff', width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🍕</div>
          <div><div style={{ fontSize: '0.7em', color: r.accent.primary, fontWeight: 700, letterSpacing: '0.15em' }}>MAIN</div><div style={{ fontSize: '1.6em', fontWeight: 800 }}>{today?.entree}</div></div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>{toArr(today?.sides).map((s, i) => <span key={i} style={{ background: [r.accent.secondary, r.accent.highlight, '#a78bfa'][i % 3], color: '#fff', padding: '6px 14px', borderRadius: 999, fontWeight: 800, fontSize: '0.9em' }}>+ {s}</span>)}</div>
        {today?.dessert && <div style={{ background: r.accent.highlight, color: '#1c1917', padding: '6px 14px', borderRadius: 999, fontWeight: 800, fontSize: '0.95em', display: 'inline-block' }}>🍪 {today.dessert}</div>}
      </div>
    </div>
  );
}

// 4. GLASS BISTRO
export function LunchGlassBistroWidget({ config }: WidgetProps<LunchCfg>) {
  const c = config || {}; const days = c.days?.length ? c.days : FALLBACK;
  const r = resolveStyle({ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 20, textColor: '#0f172a', bgColor: 'rgba(255,255,255,0.75)', bgGradient: 'linear-gradient(135deg, rgba(212,175,55,0.08), rgba(99,102,241,0.05))', padding: 32, borderRadius: 24, accentColor: '#a16207', ...(c.style || {}) });
  const idx = useMemo(() => Math.max(0, todayIdx(c.clockTimeZone)), [c.clockTimeZone]);
  const today = days[Math.min(idx, days.length - 1)] || days[0];
  return (
    <div style={{ ...frameStyle(r), backdropFilter: 'blur(20px)' }}>
      <div style={{ textAlign: 'center', borderBottom: `1px solid ${r.accent.primary}`, paddingBottom: 10, marginBottom: 14 }}>
        <div style={{ fontSize: '0.7em', letterSpacing: '0.4em', color: r.accent.primary, fontWeight: 700, textTransform: 'uppercase' }}>{today?.day || 'TODAY'} · PRIX FIXE</div>
        <h2 style={{ margin: '4px 0 0 0', fontSize: '2em', fontStyle: 'italic', fontWeight: 500 }} data-field="title">{c.title || 'Cafeteria'}</h2>
      </div>
      <div data-field-jump="weekMenu" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, fontSize: r.font.size }}>
        <div><div style={{ fontSize: '0.65em', letterSpacing: '0.3em', color: r.accent.primary, textTransform: 'uppercase', fontWeight: 600 }}>Plat principal</div><div style={{ fontSize: '1.5em', fontStyle: 'italic', fontWeight: 500 }}>{today?.entree}</div></div>
        <div><div style={{ fontSize: '0.65em', letterSpacing: '0.3em', color: r.accent.primary, textTransform: 'uppercase', fontWeight: 600 }}>Accompagnements</div><div style={{ fontSize: '1.05em' }}>{toArr(today?.sides).join(' · ')}</div></div>
        {today?.dessert && <div><div style={{ fontSize: '0.65em', letterSpacing: '0.3em', color: r.accent.primary, textTransform: 'uppercase', fontWeight: 600 }}>Dessert</div><div style={{ fontSize: '1.1em', fontStyle: 'italic' }}>{today.dessert}</div></div>}
      </div>
    </div>
  );
}

// 5. OPS INVENTORY — week table
export function LunchOpsInventoryWidget({ config }: WidgetProps<LunchCfg>) {
  const c = config || {}; const days = c.days?.length ? c.days : FALLBACK;
  const r = resolveStyle({ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, textColor: '#cbd5e1', bgColor: '#0a0e14', padding: 20, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', accentColor: '#22d3ee', accentColor2: '#fbbf24', ...(c.style || {}) });
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px dashed ${r.accent.primary}55`, paddingBottom: 6, marginBottom: 8, fontSize: '1.1em' }}><b style={{ color: r.accent.primary, letterSpacing: '0.2em' }}>● MENU.WEEK_PLAN</b><span style={{ color: r.accent.secondary }} data-field="title">{c.title || 'CAFE'}</span></div>
      <div data-field-jump="weekMenu" style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr auto', columnGap: 8, rowGap: 4, fontSize: r.font.size }}>
        <b style={{ color: r.accent.primary }}>DAY</b><b style={{ color: r.accent.primary }}>ENTREE</b><b style={{ color: r.accent.primary }}>SIDES</b><b style={{ color: r.accent.primary }}>DESSERT</b>
        {days.slice(0, 5).map((d, i) => (
          <>
            <span key={`d${i}`} style={{ color: r.accent.secondary, fontWeight: 700 }}>{d.day}</span>
            <span key={`e${i}`}>{d.entree}</span>
            <span key={`s${i}`} style={{ color: '#94a3b8' }}>{toArr(d.sides).join(', ')}</span>
            <span key={`x${i}`} style={{ color: r.accent.secondary }}>{d.dessert || '—'}</span>
          </>
        ))}
      </div>
      <div style={{ borderTop: `1px dashed ${r.accent.primary}55`, paddingTop: 6, marginTop: 8, fontSize: '0.9em', color: r.accent.primary }}>$ inv.sync_ok · {days.length}_records</div>
    </div>
  );
}
