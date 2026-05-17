"use client";
/**
 * VenueOS · Hospitality widgets.
 */
import React from 'react';
import { resolveStyle, frameStyle } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

/* ════════════════ HOTEL WELCOME ════════════════ */

export interface HotelWelcomeCfg extends BaseCfg {
  hotel?: string;
  guest?: string;
  room?: string;
  checkin?: string;
  checkout?: string;
}

export function HotelWelcomeWidget({ config, live = true, height = 480 }: WidgetProps<HotelWelcomeCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a1410', textColor: '#fff7ee', accentColor: '#a87432', highlightColor: '#d4a36a', ...c.style });
  const hotel = c.hotel ?? 'THE COPPERLEAF';
  const guest = c.guest ?? 'The Park family';
  const room = c.room ?? 'Pinecrest 412';
  const checkin = c.checkin ?? '3:18 PM';
  const checkout = c.checkout ?? 'Sun, May 19';

  return (
    <div style={frameStyle(r)}>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'linear-gradient(135deg, #3a2a1a, #1a1410)', opacity: 0.95 }} />
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0 8px, rgba(255,255,255,0) 8px 16px)' }} />

      <div style={{ position: 'absolute', top: '5%', left: '6%', display: 'flex', alignItems: 'baseline' }}>
        <div style={{ width: px(height, 0.13), height: px(height, 0.13), borderRadius: '50%', background: r.accent.primary, border: `2px solid ${r.accent.highlight}`, marginRight: '3%' }} />
        <div style={{ fontWeight: 800, fontSize: px(height, 0.1), letterSpacing: '0.02em' }}>{hotel}</div>
      </div>

      <div style={{ position: 'absolute', top: '32%', left: '6%', right: '6%' }}>
        <div style={{ color: r.accent.highlight, fontWeight: 600, fontSize: px(height, 0.1), letterSpacing: '0.04em' }}>Welcome home,</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.46), lineHeight: 0.95, letterSpacing: '-0.02em' }}>{guest}.</div>
        <div style={{ color: '#dfcfb8', fontSize: px(height, 0.075), fontWeight: 600, marginTop: '4%' }}>Your suite, <strong>{room}</strong>, is ready.</div>
      </div>

      <div style={{ position: 'absolute', bottom: '5%', left: '6%', right: '6%', color: '#dfcfb8', fontSize: px(height, 0.05), fontWeight: 600, display: 'flex' }}>
        <span style={{ marginRight: '5%' }}>Check-in · {checkin}</span>
        <span style={{ marginRight: '5%' }}>Check-out · {checkout}</span>
        <span>Concierge · ext. 8000</span>
      </div>
    </div>
  );
}

/* ════════════════ DAILY EVENTS BOARD ════════════════ */

export interface HotelEvent { time: string; category: string; title: string; where: string; host: string; access?: string; }
export interface DailyEventsBoardCfg extends BaseCfg { property?: string; events?: HotelEvent[]; }

export function DailyEventsBoardWidget({ config, live = true, height = 480 }: WidgetProps<DailyEventsBoardCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fdfaf3', textColor: '#1a1410', accentColor: '#a87432', ...c.style });
  const property = c.property ?? 'THE COPPERLEAF';
  const events: HotelEvent[] = c.events ?? [
    { time: '7:00 AM', category: 'Wellness', title: 'Mountain Sunrise Yoga', where: 'Garden Pavilion · Level 3', host: 'with Marisol', access: 'GUESTS' },
    { time: '11:00 AM', category: 'Tasting', title: 'Coffee Cupping Experience', where: 'Lobby Café', host: 'with Roastmaster Daniel', access: 'OPEN' },
    { time: '2:30 PM', category: 'Family', title: 'Make-Your-Own Trail Mix', where: 'Kids\' Lounge', host: 'with Chef Tomás', access: 'KIDS' },
    { time: '7:30 PM', category: 'Music', title: 'Live Jazz · Trio Maple', where: 'Library Bar', host: 'Reservations welcome', access: 'GUESTS' },
  ];

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '4%', left: '4%', right: '4%' }}>
        <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.062), letterSpacing: '0.08em' }}>TODAY AT {property}</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.21), letterSpacing: '-0.02em' }}>Daily Events</div>
      </div>

      <div style={{ position: 'absolute', top: '36%', bottom: '4%', left: '4%', right: '4%', display: 'flex', flexWrap: 'wrap' }}>
        {events.slice(0, 4).map((e, i) => {
          const col = i % 2;
          return (
            <div key={i} style={{ width: '49%', marginRight: col === 1 ? 0 : '2%', marginBottom: '2%', background: '#fff', border: '1px solid #e7e6e1', borderRadius: 18, padding: '3%', display: 'flex' }}>
              <div style={{ width: px(height, 0.25), background: '#fff7ee', borderRadius: 14, padding: '3%', textAlign: 'center', marginRight: '4%' }}>
                <div style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.046), letterSpacing: '0.06em' }}>{e.time.split(':')[0]}</div>
                <div style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.096), lineHeight: 1 }}>{e.time.split(':')[1]?.split(' ')[0]}</div>
              </div>
              <div style={{ flex: '1 0 0' }}>
                <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.042), letterSpacing: '0.06em' }}>{e.category.toUpperCase()}</div>
                <div style={{ fontWeight: 800, fontSize: px(height, 0.075), lineHeight: 1.15 }}>{e.title}</div>
                <div style={{ color: '#594631', fontSize: px(height, 0.046), fontWeight: 600, marginTop: '1%' }}>{e.where}</div>
                <div style={{ color: '#74767d', fontSize: px(height, 0.038), fontWeight: 600, marginTop: '2%' }}>{e.host}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════ AMENITY HOURS ════════════════ */

export interface Amenity { name: string; icon: string; hours: string; status: 'OPEN' | 'CLOSED'; }
export interface AmenityHoursCfg extends BaseCfg { amenities?: Amenity[]; }

export function AmenityHoursWidget({ config, live = true, height = 480 }: WidgetProps<AmenityHoursCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fff', textColor: '#1a1410', accentColor: '#a87432', ...c.style });
  const amenities: Amenity[] = c.amenities ?? [
    { name: 'Heated Outdoor Pool', icon: '🏊', hours: '7 AM – 11 PM', status: 'OPEN' },
    { name: 'Fitness Center', icon: '🏋️', hours: '24 hours', status: 'OPEN' },
    { name: 'Frost Creek Spa', icon: '💆', hours: '9 AM – 9 PM', status: 'OPEN' },
    { name: 'Mountain View Sauna', icon: '🧖', hours: '7 AM – 10 PM', status: 'OPEN' },
    { name: 'Business Center', icon: '💻', hours: '24 hours', status: 'OPEN' },
    { name: 'Ski Concierge', icon: '⛷️', hours: '6 AM – 6 PM', status: 'CLOSED' },
  ];

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '4%', left: '4%', right: '4%' }}>
        <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.058), letterSpacing: '0.08em' }}>HOURS & ACCESS</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.21), letterSpacing: '-0.02em' }}>Amenities</div>
      </div>

      <div style={{ position: 'absolute', top: '36%', bottom: '4%', left: '4%', right: '4%', display: 'flex', flexWrap: 'wrap' }}>
        {amenities.slice(0, 6).map((a, i) => {
          const col = i % 2;
          const open = a.status === 'OPEN';
          return (
            <div key={i} style={{ width: '49%', marginRight: col === 1 ? 0 : '2%', marginBottom: '2%', background: open ? '#fff7ee' : '#fafaf7', border: '1px solid #efeeea', borderRadius: 14, padding: '3%', display: 'flex', alignItems: 'center' }}>
              <div style={{ width: px(height, 0.13), height: px(height, 0.13), borderRadius: 14, background: open ? r.accent.primary : '#aaa', color: '#fff', fontSize: px(height, 0.058), display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '4%' }}>{a.icon}</div>
              <div style={{ flex: '1 0 0' }}>
                <div style={{ fontWeight: 700, fontSize: px(height, 0.058) }}>{a.name}</div>
                <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.042) }}>{a.hours}</div>
              </div>
              <div style={{ background: open ? '#22c55e' : '#a3a3a3', color: '#fff', fontWeight: 800, fontSize: px(height, 0.038), padding: '1.5% 3%', borderRadius: 8, letterSpacing: '0.06em' }}>{a.status}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════ CHECK-IN / CHECK-OUT TIMES ════════════════ */

export interface CheckInOutCfg extends BaseCfg {
  checkinTime?: string;
  checkoutTime?: string;
  checkinNote?: string;
  checkoutNote?: string;
}

export function CheckInOutTimesWidget({ config, live = true, height = 480 }: WidgetProps<CheckInOutCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fff7ee', textColor: '#1a1410', accentColor: '#a87432', ...c.style });
  const checkinTime = c.checkinTime ?? '3:00 PM';
  const checkoutTime = c.checkoutTime ?? '11:00 AM';
  const checkinNote = c.checkinNote ?? 'Early check-in based on availability. Welcome drinks 4-6 PM in the lobby.';
  const checkoutNote = c.checkoutNote ?? 'Late check-out until 1 PM by request. Bag storage available.';

  const cell = (label: string, big: string, note: string, tone: string, leftPct: string) => (
    <div style={{ position: 'absolute', top: '5%', bottom: '5%', left: leftPct, width: '46%', background: '#fff', border: '1px solid #e7e6e1', borderRadius: 24, padding: '4%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div>
        <div style={{ color: tone, fontWeight: 700, fontSize: px(height, 0.062), letterSpacing: '0.1em' }}>{label}</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.42), letterSpacing: '-0.04em', lineHeight: 0.9, marginTop: '4%' }}>{big}</div>
      </div>
      <div style={{ color: '#594631', fontWeight: 600, fontSize: px(height, 0.063), lineHeight: 1.35 }}>{note}</div>
    </div>
  );

  return (
    <div style={frameStyle(r)}>
      {cell('CHECK-IN', checkinTime, checkinNote, r.accent.primary, '3%')}
      {cell('CHECK-OUT', checkoutTime, checkoutNote, '#5b2a4a', '51%')}
    </div>
  );
}

/* ════════════════ LOCAL ATTRACTIONS ════════════════ */

export interface Attraction { name: string; category: string; distance: string; travel: string; rating: string; price: string; tint?: string; }
export interface LocalAttractionsCfg extends BaseCfg { property?: string; attractions?: Attraction[]; }

export function LocalAttractionsWidget({ config, live = true, height = 480 }: WidgetProps<LocalAttractionsCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0e2226', textColor: '#fff', accentColor: '#13a6ad', ...c.style });
  const property = c.property ?? 'THE COPPERLEAF';
  const list: Attraction[] = c.attractions ?? [
    { name: 'Vail Mountain', category: 'OUTDOORS', distance: '0.4 mi', travel: 'Free shuttle', rating: '4.9', price: '$$$' },
    { name: 'Sweet Basil', category: 'DINING', distance: '0.6 mi', travel: '8 min walk', rating: '4.7', price: '$$$' },
    { name: 'Frost Creek Spa', category: 'WELLNESS', distance: 'In-house', travel: 'Take elevator', rating: '4.9', price: '$$' },
    { name: 'Eagle Bahn Gondola', category: 'OUTDOORS', distance: '0.3 mi', travel: '5 min walk', rating: '4.8', price: '$$' },
    { name: 'Manor Vail Cellar', category: 'TASTING', distance: '0.9 mi', travel: '12 min walk', rating: '4.8', price: '$$$' },
    { name: 'Betty Ford Gardens', category: 'CULTURE', distance: '1.1 mi', travel: '3 min drive', rating: '4.8', price: 'Free' },
  ];

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '4%', left: '4%', right: '4%' }}>
        <div style={{ color: '#9bb2b4', fontWeight: 700, fontSize: px(height, 0.058), letterSpacing: '0.08em' }}>NEAR {property}</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.2), letterSpacing: '-0.02em' }}>Local favorites</div>
      </div>

      <div style={{ position: 'absolute', top: '36%', bottom: '4%', left: '4%', right: '4%', display: 'flex', flexWrap: 'wrap' }}>
        {list.slice(0, 6).map((a, i) => {
          const col = i % 3;
          return (
            <div key={i} style={{ width: '32%', marginRight: col === 2 ? 0 : '2%', marginBottom: '2%', background: '#11363a', border: '1px solid #1a3a3e', borderRadius: 18, padding: '3%' }}>
              <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.038), letterSpacing: '0.06em' }}>{a.category}</div>
              <div style={{ fontWeight: 700, fontSize: px(height, 0.062), marginTop: '1%' }}>{a.name}</div>
              <div style={{ color: '#9bb2b4', fontSize: px(height, 0.042), fontWeight: 600, marginTop: '0.5%' }}>{a.distance} · {a.travel}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '3%' }}>
                <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.042) }}>★ {a.rating}</div>
                <div style={{ color: '#9bb2b4', fontSize: px(height, 0.038), fontWeight: 600 }}>{a.price}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
