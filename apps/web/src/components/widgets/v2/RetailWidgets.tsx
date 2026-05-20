"use client";
/**
 * VenueOS · Retail widgets.
 * ─────────────────────────────────────────────
 * APPROVED 2026-05-19 — matches scratch/design/retail/retail-pack-v2.html
 * Reviewed by user (picked "Clean / Minimal" over bold v1, all 8 kept),
 * ported via the v2 height-relative model, live render screenshot-
 * verified against the mockup. DO NOT regress to fixed-px / vw units.
 *
 * Clean / minimal storefront pack — the Apple-store-calm direction the
 * operator picked over the bold v1.
 *
 * 8 widgets: Sale Seal · Price-Drop Tag · Product Spotlight ·
 * Flash-Sale Countdown · Store Hours · Loyalty QR · New-Arrivals ·
 * Promo Strip. Scoped to the RETAIL vertical in registry.ts.
 *
 * Sizing model: every widget fills its zone (frameStyle → 100%/100%)
 * and sizes its content off the measured `height` prop via px(height,f)
 * + percentage layout — same contract as the Healthcare / Corporate /
 * Hospitality / Worship packs (each Component is withMeasuredHeight()-
 * wrapped at registration).
 *
 * Chromium-83 / NovaStar-Taurus SAFE — the operator ships to LED
 * controllers on Chromium 83, so this file deliberately avoids:
 *   • `inset` shorthand          → long-hand top/right/bottom/left
 *   • flex `gap`                 → explicit margins
 *   • `aspect-ratio`             → explicit px width+height for circles
 *   • `backdrop-filter`, `:has()`, container queries
 * clip-path polygon (Chrome 55) and conic-gradient (Chrome 69) ARE
 * safe on Chromium 83 and are used for the tag silhouette + faux QR.
 */
import React from 'react';
import { resolveStyle, frameStyle } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

const ACCENT = '#ff4f47';

/* ════════════════ 1 · SALE SEAL ════════════════ */

export interface SaleSealCfg extends BaseCfg {
  pct?: string;       // "50%"
  label?: string;     // "OFF"
  discColor?: string;
}

export function SaleSealWidget({ config, height = 480 }: WidgetProps<SaleSealCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: 'transparent', padding: 0, ...c.style });
  const disc = px(height, 0.84);
  const ring = Math.max(1, Math.round(disc * 0.06));
  return (
    <div style={frameStyle(r)}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: disc, height: disc, maxWidth: '100%', borderRadius: '50%',
          background: c.discColor ?? '#1d1d1f', color: '#fff',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 20px 50px rgba(29,29,31,.22)', position: 'relative',
        }}>
          <div style={{
            position: 'absolute', top: ring * 2, right: ring * 2, bottom: ring * 2, left: ring * 2,
            border: `1px solid rgba(255,255,255,.25)`, borderRadius: '50%',
          }} />
          <div style={{ fontSize: px(height, 0.32), fontWeight: 300, lineHeight: 0.9, letterSpacing: '-2px' }}>
            {c.pct ?? '50%'}
          </div>
          <div style={{ fontSize: px(height, 0.075), fontWeight: 600, letterSpacing: '6px', marginTop: px(height, 0.025), paddingLeft: 6 }}>
            {c.label ?? 'OFF'}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ 2 · PRICE-DROP TAG ════════════════ */

export interface PriceTagCfg extends BaseCfg {
  was?: string;
  now?: string;
  label?: string;
}

export function PriceTagWidget({ config, height = 480 }: WidgetProps<PriceTagCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: 'transparent', padding: 0, ...c.style });
  const tagH = px(height, 0.92);
  const tagW = px(height, 0.8);
  return (
    <div style={frameStyle(r)}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ position: 'relative', paddingTop: px(height, 0.16) }}>
          {/* string */}
          <div style={{
            position: 'absolute', top: 0, left: '50%', width: 2, height: px(height, 0.2),
            background: '#c7c7cf', transform: 'translateX(-50%) rotate(6deg)', transformOrigin: 'top',
          }} />
          {/* tag body */}
          <div style={{
            width: tagW, height: tagH, background: '#fff', position: 'relative',
            clipPath: 'polygon(50% 0%, 100% 15%, 100% 100%, 0% 100%, 0% 15%)',
            WebkitClipPath: 'polygon(50% 0%, 100% 15%, 100% 100%, 0% 100%, 0% 15%)',
            boxShadow: '0 16px 40px rgba(0,0,0,.10)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            transform: 'rotate(6deg)',
          }}>
            <div style={{
              position: 'absolute', top: px(height, 0.08), left: '50%', width: px(height, 0.066), height: px(height, 0.066),
              borderRadius: '50%', background: '#f5f5f7', border: '1.5px solid #d8d8de', transform: 'translateX(-50%)',
            }} />
            <div style={{ fontSize: px(height, 0.083), fontWeight: 400, color: '#aeaeb6', textDecoration: 'line-through', marginTop: px(height, 0.1) }}>
              {c.was ?? '$129'}
            </div>
            <div style={{ fontSize: px(height, 0.23), fontWeight: 600, color: '#1d1d1f', lineHeight: 0.95, letterSpacing: '-1px' }}>
              {c.now ?? '$79'}
            </div>
            <div style={{ fontSize: px(height, 0.046), fontWeight: 700, letterSpacing: '3px', color: ACCENT, marginTop: px(height, 0.033) }}>
              {c.label ?? 'LIMITED'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ 3 · PRODUCT SPOTLIGHT ════════════════ */

export interface ProductSpotlightCfg extends BaseCfg {
  brand?: string;
  name?: string;
  price?: string;
  badge?: string;
  imageUrl?: string;   // operator product photo; falls back to line-art
}

export function ProductSpotlightWidget({ config, height = 480 }: WidgetProps<ProductSpotlightCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#ffffff', padding: 0, borderRadius: px(height, 0.07), shadow: '0 18px 50px rgba(0,0,0,.08)', ...c.style });
  return (
    <div style={frameStyle(r)}>
      {/* image well — top ~60% */}
      <div style={{
        position: 'absolute', top: 0, right: 0, left: 0, height: '60%',
        background: '#f5f5f7', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {c.badge !== '' && (
          <div style={{
            position: 'absolute', top: '8%', left: '6%', fontSize: px(height, 0.05),
            fontWeight: 700, letterSpacing: '2px', color: '#86868b', textTransform: 'uppercase',
          }}>{c.badge ?? 'New'}</div>
        )}
        {c.imageUrl ? (
          <img src={c.imageUrl} alt={c.name ?? ''} style={{ maxWidth: '70%', maxHeight: '78%', objectFit: 'contain' }} />
        ) : (
          /* clean headphones line-art so the well is never an empty grey box */
          <div style={{ width: px(height, 0.36), height: px(height, 0.36), position: 'relative' }}>
            <div style={{
              position: 'absolute', top: '5%', left: '12%', right: '12%', height: '46%',
              border: `${Math.max(3, px(height, 0.018))}px solid #1d1d1f`, borderBottom: 0,
              borderRadius: '60px 60px 0 0',
            }} />
            <div style={{ position: 'absolute', top: '42%', left: '9%', width: '23%', height: '35%', background: '#1d1d1f', borderRadius: 10 }} />
            <div style={{ position: 'absolute', top: '42%', right: '9%', width: '23%', height: '35%', background: '#1d1d1f', borderRadius: 10 }} />
          </div>
        )}
      </div>
      {/* meta — bottom ~40% */}
      <div style={{
        position: 'absolute', bottom: 0, right: 0, left: 0, height: '40%',
        padding: '0 6%', display: 'flex', flexDirection: 'column', justifyContent: 'center',
      }}>
        <div style={{ fontSize: px(height, 0.05), fontWeight: 700, letterSpacing: '2px', color: '#aeaeb6', textTransform: 'uppercase' }}>
          {c.brand ?? 'Aurio'}
        </div>
        <div style={{ fontSize: px(height, 0.092), fontWeight: 600, marginTop: '2%', letterSpacing: '-0.3px', color: '#1d1d1f' }}>
          {c.name ?? 'Studio Wireless'}
        </div>
        <div style={{ fontSize: px(height, 0.11), fontWeight: 500, marginTop: '4%', letterSpacing: '-0.5px', color: '#1d1d1f' }}>
          {c.price ?? '$149'}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ 4 · FLASH-SALE COUNTDOWN ════════════════ */

export interface FlashCountdownCfg extends BaseCfg {
  kicker?: string;
  endsAt?: string;     // ISO; when set + live, ticks down. Else shows the static hh/mm/ss.
  hrs?: string; min?: string; sec?: string;
}

export function FlashCountdownWidget({ config, live = true, height = 480 }: WidgetProps<FlashCountdownCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: 'transparent', padding: 0, ...c.style });

  // Live tick from endsAt if provided; otherwise show static config values.
  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (!live || !c.endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live, c.endsAt]);

  let hrs = c.hrs ?? '02', min = c.min ?? '47', sec = c.sec ?? '19';
  if (c.endsAt) {
    const end = new Date(c.endsAt).getTime();
    const diff = Math.max(0, end - now);
    const totalSec = Math.floor(diff / 1000);
    hrs = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    min = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    sec = String(totalSec % 60).padStart(2, '0');
  }

  const Cell = ({ n, u }: { n: string; u: string }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ fontSize: px(height, 0.26), fontWeight: 300, color: '#1d1d1f', lineHeight: 1, letterSpacing: '-2px' }}>{n}</div>
      <div style={{ fontSize: px(height, 0.05), fontWeight: 600, letterSpacing: '2px', color: '#aeaeb6', marginTop: px(height, 0.05), textTransform: 'uppercase' }}>{u}</div>
    </div>
  );
  const Sep = () => (
    <div style={{ fontSize: px(height, 0.2), fontWeight: 200, color: '#d8d8de', lineHeight: 1.1, margin: `0 ${px(height, 0.04)}px` }}>:</div>
  );

  return (
    <div style={frameStyle(r)}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontSize: px(height, 0.052), fontWeight: 600, letterSpacing: '3px', color: ACCENT, textTransform: 'uppercase', marginBottom: px(height, 0.09) }}>
          {c.kicker ?? 'Flash sale ends in'}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
          <Cell n={hrs} u="Hrs" /><Sep /><Cell n={min} u="Min" /><Sep /><Cell n={sec} u="Sec" />
        </div>
      </div>
    </div>
  );
}

/* ════════════════ 5 · STORE HOURS ════════════════ */

export interface StoreHoursRow { day: string; hours: string; today?: boolean; }
export interface StoreHoursCfg extends BaseCfg {
  state?: string;       // "Open · closes 9 PM"
  open?: boolean;
  rows?: StoreHoursRow[];
}

export function StoreHoursWidget({ config, height = 480 }: WidgetProps<StoreHoursCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#ffffff', padding: px(height, 0.055), borderRadius: px(height, 0.06), shadow: '0 12px 36px rgba(0,0,0,.06)', ...c.style });
  const open = c.open ?? true;
  const rows: StoreHoursRow[] = c.rows ?? [
    { day: 'Today · Fri', hours: '9 – 9', today: true },
    { day: 'Saturday', hours: '10 – 8' },
    { day: 'Sunday', hours: '11 – 6' },
  ];
  return (
    <div style={frameStyle(r)}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: px(height, 0.04) }}>
        <div style={{ width: px(height, 0.022), height: px(height, 0.022), borderRadius: '50%', background: open ? '#34c759' : '#aeaeb6', marginRight: px(height, 0.02) }} />
        <div style={{ fontSize: px(height, 0.07), fontWeight: 600, color: '#1d1d1f' }}>{c.state ?? 'Open · closes 9 PM'}</div>
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: px(height, 0.06), fontWeight: row.today ? 600 : 400,
          color: row.today ? '#1d1d1f' : '#86868b',
          padding: `${px(height, 0.022)}px 0`,
          borderBottom: i < rows.length - 1 ? '1px solid #f0f0f3' : 'none',
        }}>
          <span>{row.day}</span><span>{row.hours}</span>
        </div>
      ))}
    </div>
  );
}

/* ════════════════ 6 · LOYALTY QR ════════════════ */

export interface LoyaltyQrCfg extends BaseCfg {
  heading?: string;
  sub?: string;
  cta?: string;
  qrImageUrl?: string;   // real scannable QR; falls back to a faux pattern
}

export function LoyaltyQrWidget({ config, height = 480 }: WidgetProps<LoyaltyQrCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#ffffff', padding: px(height, 0.06), borderRadius: px(height, 0.07), shadow: '0 14px 40px rgba(0,0,0,.07)', ...c.style });
  const qr = px(height, 0.42);
  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: px(height, 0.06) }}>
        <div style={{ fontSize: px(height, 0.085), fontWeight: 700, letterSpacing: '-0.3px', color: '#1d1d1f' }}>{c.heading ?? 'Join Rewards'}</div>
        <div style={{ fontSize: px(height, 0.052), fontWeight: 400, color: '#86868b', marginTop: px(height, 0.02), textAlign: 'center' }}>{c.sub ?? 'Scan · earn points · save more'}</div>
        {c.qrImageUrl ? (
          <img src={c.qrImageUrl} alt="QR" style={{ width: qr, height: qr, margin: `${px(height, 0.05)}px 0`, borderRadius: 10 }} />
        ) : (
          <div style={{
            width: qr, height: qr, margin: `${px(height, 0.05)}px 0`, borderRadius: 10, position: 'relative',
            background: 'repeating-conic-gradient(#1d1d1f 0% 25%, #fff 0% 50%) 0 0 / 24px 24px',
            border: '1px solid #f0f0f3',
          }}>
            <div style={{ position: 'absolute', top: 8, left: 8, width: '24%', height: '24%', border: '6px solid #1d1d1f', background: '#fff' }} />
            <div style={{ position: 'absolute', top: 8, right: 8, width: '24%', height: '24%', border: '6px solid #1d1d1f', background: '#fff' }} />
          </div>
        )}
        <div style={{ fontSize: px(height, 0.058), fontWeight: 600, color: ACCENT, marginTop: 'auto' }}>{c.cta ?? '10% off your first scan →'}</div>
      </div>
    </div>
  );
}

/* ════════════════ 7 · NEW-ARRIVALS RIBBON ════════════════ */

export interface NewArrivalsCfg extends BaseCfg {
  eyebrow?: string;
  title?: string;
  items?: string[];
}

export function NewArrivalsWidget({ config, live = true, height = 480 }: WidgetProps<NewArrivalsCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#ffffff', padding: 0, borderRadius: px(height, 0.06), shadow: '0 12px 36px rgba(0,0,0,.06)', ...c.style });
  const items = c.items ?? ['FALL DROP', 'OUTERWEAR', 'KNITWEAR', 'DENIM'];
  const strip = [...items, ...items].join(' · ') + ' · ';
  const animOn = r.anim.on && live;
  return (
    <div style={frameStyle(r)}>
      {animOn && <style>{`@keyframes retailMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>}
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: px(height, 0.05), fontWeight: 700, letterSpacing: '3px', color: '#aeaeb6', textTransform: 'uppercase' }}>{c.eyebrow ?? 'Just In'}</div>
        <div style={{ fontSize: px(height, 0.13), fontWeight: 700, letterSpacing: '-0.5px', margin: `${px(height, 0.035)}px 0 ${px(height, 0.075)}px`, color: '#1d1d1f' }}>{c.title ?? 'New Arrivals'}</div>
        <div style={{ width: '100%', overflow: 'hidden', borderTop: '1px solid #f0f0f3', paddingTop: px(height, 0.07) }}>
          <div style={{
            display: 'inline-block', whiteSpace: 'nowrap', fontSize: px(height, 0.055), fontWeight: 600,
            letterSpacing: '2px', color: '#86868b', textTransform: 'uppercase',
            animation: animOn ? 'retailMarquee 14s linear infinite' : undefined,
          }}>{strip}</div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ 8 · PROMO STRIP ════════════════ */

export interface PromoStripCfg extends BaseCfg {
  big?: string;
  small?: string;
  accentColor?: string;
}

export function PromoStripWidget({ config, height = 480 }: WidgetProps<PromoStripCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#ffffff', padding: 0, borderRadius: px(height, 0.08), shadow: '0 12px 36px rgba(0,0,0,.06)', ...c.style });
  const accent = c.accentColor ?? ACCENT;
  return (
    <div style={frameStyle(r)}>
      {/* left accent rule */}
      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: px(height, 0.04), background: accent }} />
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontSize: px(height, 0.14), fontWeight: 700, letterSpacing: '-0.5px', color: '#1d1d1f' }}>{c.big ?? 'Buy 1, Get 1 50%'}</div>
        <div style={{ fontSize: px(height, 0.06), fontWeight: 600, letterSpacing: '2px', color: '#86868b', textTransform: 'uppercase', marginTop: px(height, 0.02) }}>{c.small ?? 'This weekend only'}</div>
      </div>
    </div>
  );
}
