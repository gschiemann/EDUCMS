import React, { useRef, useState, useEffect } from 'react';
import { CalendarDays, Cloud, CloudRain, CloudSnow, CloudLightning, Sun, Wind, Droplets } from 'lucide-react';
import { fetchWeather, getWMO } from '../weather-api';
import { sceneCss } from '../scene-css';

// ═══════════════════════════════════════════════════════════════════════════
// SUNSHINE ACADEMY THEME
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ── THE EM ANCHOR (2026-09-11) ────────────────────────────────────────
 * These variants size everything in `em`, but nothing above them sets a
 * font-size, so `em` resolved against the document's 16px: on a 3840x2160
 * wall the calendar's event rows painted at 22px and its header at 19px,
 * well under the signage floor. Each root now measures its own box and
 * sets the font-size the `em`s hang off; `ratio` is the per-variant knob,
 * smaller for the panels that stack many rows.
 *
 * TAURUS (CLAUDE.md #10): a ResizeObserver, not a container query —
 * Chromium 83 has no `cqh`, and this file's taurus baseline is cq=0.
 */
function useBoxEm(ratio = 0.07): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [em, setEm] = useState(16);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth || 0;
      const h = el.clientHeight || 0;
      if (!w || !h) return;
      const next = Math.max(9, Math.min(Math.min(w, h) * ratio, w * ratio * 0.62));
      setEm((prev) => (Math.abs(prev - next) < 0.4 ? prev : next));
    };
    measure();
    const RO = typeof ResizeObserver !== 'undefined' ? ResizeObserver : null;
    if (!RO) return;
    const ro = new RO(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);
  return [ref, em];
}

/**
 * ── TICKER SIZING (2026-09-11) ────────────────────────────────────────
 * A ticker is the one widget whose zone is normally a long, SHORT band, so
 * sizing it off the short edge — what every other variant here does — pins
 * it at ~20px on a 4K wall. And its marquee made that worse: a track that
 * starts at `padding-left: 100%` is wider than its own zone by definition,
 * so a single short message spent 30 seconds crawling across an otherwise
 * empty board, unreadable for most of it. A ticker's job is to be READ.
 *
 * So: fill the strip's height, shrink only as far as needed to fit the
 * message across the width, and become a marquee ONLY when even the floor
 * size will not fit. `one` always wraps exactly one copy of the message in
 * BOTH modes, and the fit is normalised by the span's own current font
 * size, so the measurement that drives the size cannot run away.
 *
 * TAURUS (CLAUDE.md #10): a ResizeObserver, not a container query.
 */
function useTickerFit(text: string, cap = 0.62, floorRatio = 0.3): {
  outer: React.RefObject<HTMLDivElement | null>;
  one: React.RefObject<HTMLSpanElement | null>;
  font: number;
  scroll: boolean;
} {
  const outer = useRef<HTMLDivElement | null>(null);
  const one = useRef<HTMLSpanElement | null>(null);
  const [font, setFont] = useState(16);
  const [scroll, setScroll] = useState(false);
  useEffect(() => {
    const o = outer.current;
    const i = one.current;
    if (!o || !i) return;
    const measure = () => {
      const w = o.clientWidth || 0;
      const h = o.clientHeight || 0;
      const cur = parseFloat(getComputedStyle(i).fontSize) || 16;
      const natural = i.getBoundingClientRect().width || 0;
      if (!w || !h || !natural) return;
      // A square zone is not a strip: bound the height term by the width so
      // a ticker dropped on a full-canvas zone does not render circus type.
      const unit = Math.min(h, w * 0.09);
      // `natural / cur` is the message's width in ems and does not move when
      // the font does, so this converges instead of oscillating.
      const fit = ((w - 4) / natural) * cur;
      const floor = Math.max(11, unit * floorRatio);
      const next = Math.max(floor, Math.min(unit * cap, fit));
      setFont((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
      setScroll(fit < floor - 0.5);
    };
    measure();
    const RO = typeof ResizeObserver !== 'undefined' ? ResizeObserver : null;
    if (!RO) return;
    const ro = new RO(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [text, cap, floorRatio]);
  return { outer, one, font, scroll };
}

export function SunshineAcademyClock({ config, compact }: { config: any; compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const h = config.format === '24h' ? now.getHours() : now.getHours() % 12 || 12;
  const m = now.getMinutes().toString().padStart(2, '0');
  const ampm = config.format === '24h' ? '' : now.getHours() >= 12 ? 'PM' : 'AM';
  
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center" style={{ color: '#3A2E2A' }}>
      <div style={{ fontSize: compact ? '4em' : '8em', fontWeight: 900, lineHeight: 1, textShadow: '0 4px 12px rgba(255,255,255,0.6)' }}>
        {h}:{m}
      </div>
      {ampm && <div style={{ fontSize: compact ? '1.5em' : '2.5em', fontWeight: 800, marginLeft: '0.2em', marginTop: '0.8em', opacity: 0.8 }}>{ampm}</div>}
    </div>
  );
}

export function SunshineAcademyWeather({ config, compact }: { config: any; compact?: boolean }) {
  const location = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const [weather, setWeather] = useState<any>(null);
  
  useEffect(() => {
    fetchWeather(location, isCelsius).then(setWeather);
  }, [location, isCelsius]);

  /**
   * 2026-09-12 — this used to `return null` until the forecast arrived, so with
   * no network (a picker thumbnail, a kiosk that has not reached the internet
   * yet, a slow first paint) the widget rendered NOTHING: an empty rectangle
   * where the operator expected weather, and a picker tile with 0% of its box
   * painted — the tile measurer found it at exactly 0.0% ink. Every other
   * weather variant already had a fallback; this one was the outlier.
   *
   * The placeholder shows the LAYOUT and the location, and an em-dash where the
   * temperature goes. It does NOT invent a number — a made-up 72° on a lobby
   * screen is worse than a blank one, which is the same rule the "NOW"/
   * availability audit finding turns on.
   */
  const wmo = weather ? getWMO(weather.weatherCode) : null;
  const Icon = wmo ? wmo.icon : Sun;

  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center" style={{ color: '#3A2E2A', textShadow: '0 4px 12px rgba(255,255,255,0.6)' }} data-weather-state={weather ? 'live' : 'pending'}>
      <div className="flex items-center gap-4">
        <Icon style={{ width: compact ? '2em' : '4em', height: compact ? '2em' : '4em', color: wmo ? wmo.iconColor : '#F59E0B', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.15))', opacity: weather ? 1 : 0.8 }} />
        <div style={{ fontSize: compact ? '3em' : '6em', fontWeight: 900, lineHeight: 1, opacity: weather ? 1 : 0.55 }}>{weather ? `${weather.temp}°` : '—°'}</div>
      </div>
      <div style={{ fontSize: compact ? '0.9em' : '1.5em', fontWeight: 800, opacity: 0.8, marginTop: '0.2em', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {location}
      </div>
    </div>
  );
}

export function SunshineAcademyCountdown({ config, compact }: { config: any; compact?: boolean } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const label = config.label || 'Event starts in';
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  
  const target = new Date(config.targetDate || new Date(Date.now() + 86400000 * 5));
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  const [ref, em] = useBoxEm(0.075);
  return (
    <div ref={ref} className="absolute top-0 right-0 bottom-0 left-0 flex flex-col items-center justify-center" style={{
      background: 'rgba(255,252,245,0.88)', backdropFilter: 'blur(8px)', fontSize: em,
      borderRadius: compact ? '12px' : '24px', padding: compact ? '10%' : '15%',
      boxShadow: '0 6px 24px rgba(90,70,50,0.12)', border: '2px solid rgba(255,220,180,0.5)', textAlign: 'center'
    }}>
      <div data-field="label" style={{ fontSize: compact ? '0.8em' : '1.2em', fontWeight: 800, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'pre-wrap' as const }}>{label}</div>
      <div style={{ fontSize: compact ? '3.5em' : '6em', fontWeight: 900, color: '#3A2E2A', lineHeight: 1, margin: '0.1em 0' }}>{days}</div>
      <div style={{ fontSize: compact ? '1em' : '1.4em', fontWeight: 700, color: '#7A6B63' }}>{days === 1 ? 'Day' : 'Days'}</div>
    </div>
  );
}

export function SunshineAcademyText({ config }: { config: any } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const content = config.content || 'Your text here';
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center text-center p-4" style={{
      color: '#3A2E2A', fontSize: '3em', fontWeight: 900, textShadow: '0 4px 12px rgba(255,255,255,0.8)'
    }}>
      <div data-field="content" style={{ whiteSpace: 'pre-wrap' as const }}>
        {content}
      </div>
    </div>
  );
}

export function SunshineAcademyAnnouncement({ config, compact }: { config: any; compact?: boolean } & { onConfigChange?: (p: Record<string, any>) => void }) {
  const title = config.title || 'Important Update';
  const content = config.message || config.content || 'Content goes here...';
  
  const [ref, em] = useBoxEm(0.062);
  // The card is TILTED, and a tilted box's bounding box is taller than the
  // box itself by width x sin(angle) — 33px at 4K. The pin, the padding and
  // the title/body gap are all in em now, so that overhead is always small
  // against them; at the old fixed 16px/2rem the title's tilted box reached
  // into the body's and the two lines of text collided.
  return (
    <div ref={ref} className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center" style={{ padding: '1.2%', fontSize: em }}>
      <div style={{
        width: '100%', height: '100%', borderRadius: compact ? '12px' : '24px',
        background: 'rgba(255,252,245,0.92)', backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 32px rgba(90,70,50,0.15), 0 2px 8px rgba(90,70,50,0.1)',
        border: '2px solid rgba(255,220,180,0.6)', padding: compact ? '1rem' : '0.7em',
        display: 'flex', flexDirection: 'column', transform: 'rotate(-0.5deg)', position: 'relative'
      }}>
        <div style={{ position: 'absolute', top: '-0.18em', left: '50%', marginLeft: '-0.18em', width: '0.36em', height: '0.36em', borderRadius: '50%', background: 'linear-gradient(135deg, #FF6B6B, #EE5A5A)', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }} />
        <div data-field="title" style={{ fontSize: compact ? '1em' : '1.5em', fontWeight: 800, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5em', whiteSpace: 'pre-wrap' as const }}>{title}</div>
        <div data-field="message" style={{ fontSize: compact ? '1.5em' : '2.8em', fontWeight: 800, color: '#3A2E2A', lineHeight: 1.2, flex: 1, display: 'flex', alignItems: 'center', whiteSpace: 'pre-wrap' as const }}>{content}</div>
      </div>
    </div>
  );
}

export function SunshineAcademyTicker({ config }: { config: any }) {
  const messages = config.messages?.length ? config.messages : ['Welcome back, Sunshine Stars!', 'Picture day is this Friday!'];
  const text = messages.join('     *     ');
  const { outer, one, font, scroll } = useTickerFit(text);
  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 flex items-center overflow-hidden" style={{ background: 'linear-gradient(90deg, #FF9A76, #FFBE88, #FF9A76)' }}>
      {/* §19 (2026-09-11): this text is `config.messages.join('     *     ')`, so
          an inline contenteditable would commit one flat string over the whole
          array and wipe every row. `data-field-jump` routes the click to the
          real list editor instead — see enterFieldEdit in BuilderZone.tsx. */}
      <div ref={outer} data-field-jump="messages" style={{ width: '100%', height: '100%', minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', fontSize: font, fontWeight: 800, color: '#3A2E2A' }}>
        <div style={scroll
          ? { whiteSpace: 'nowrap', animation: 'tickerScroll 30s linear infinite', paddingLeft: '100%' }
          : { whiteSpace: 'nowrap', textAlign: 'center', width: '100%' }}>
          <span ref={one}>{text}</span>
          {scroll && <span>     *     {text}</span>}
        </div>
      </div>
      <style>{sceneCss(`@keyframes tickerScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`)}</style>
    </div>
  );
}

// §19 (2026-09-11): kept verbatim as the FALLBACK so an unconfigured board
// renders exactly the four rows it always has.
const SUNSHINE_DEFAULT_EVENTS = ['Art Show - Friday', 'Spirit Week - Next Mon', 'Book Fair - Oct 15', 'Fall Break - Oct 20'];
const SUNSHINE_DOT_COLORS = ['#FF6B6B', '#4ECDC4', '#FFD93D', '#6C5CE7'];

export function SunshineAcademyCalendar({ config, compact }: { config: any; compact?: boolean }) {
  // §19 (2026-09-11): this list was a hard-coded const, so the Events editor in
  // Properties wrote into a void — putting a hotspot on it without this would
  // have been the silent no-op the standard exists to stop. Read `config.events`
  // (the key PropertiesPanel writes for CALENDAR) and accept BOTH shapes: the
  // panel's `{date, title, …}` rows and the plain strings this theme rendered.
  const raw = Array.isArray(config.events) && config.events.length ? config.events : SUNSHINE_DEFAULT_EVENTS;
  const events: string[] = raw
    .map((e: any) => (typeof e === 'string' ? e : [e?.title, e?.date].filter(Boolean).join(' - ')))
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(12, config.maxEvents ?? SUNSHINE_DEFAULT_EVENTS.length)));
  // Fault 4: the anchor has to know how many rows it is about to stack.
  // Four events and twelve events cannot share one type size.
  const rows = Math.max(1, events.length);
  const [ref, em] = useBoxEm(Math.max(0.026, Math.min(0.075, 0.26 / (rows + 1.6))));
  return (
    // §19 (2026-09-11): the whole widget IS the event list, so a contenteditable
    // would commit one flat string over the array and destroy every row.
    // `data-field-jump` on the existing root gives it a live affordance and
    // routes the click to the real Events editor — no extra DOM node, so the
    // layout is byte-for-byte what it was.
    <div ref={ref} data-field-jump="events" className="absolute top-0 right-0 bottom-0 left-0 flex flex-col" style={{
      background: 'rgba(255,252,245,0.88)', backdropFilter: 'blur(8px)', fontSize: em,
      borderRadius: compact ? '12px' : '24px', padding: compact ? '1rem' : '0.9em',
      boxShadow: '0 6px 24px rgba(90,70,50,0.12)', border: '2px solid rgba(255,220,180,0.5)'
    }}>
      <div style={{ fontSize: compact ? '1em' : '1.2em', fontWeight: 800, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5em' }}>Upcoming Events</div>
      {events.map((evt, i) => (
        <div key={i} style={{
          fontSize: compact ? '1em' : '1.4em', fontWeight: 600, color: '#3A2E2A', padding: '0.4em 0',
          borderBottom: i < events.length - 1 ? '1px solid rgba(200,180,150,0.3)' : 'none',
          display: 'flex', alignItems: 'center'
        }}>
          {/* em, and a per-child margin rather than a flex `gap` — this is a
              widget path and Chromium 83 has no flex gap (CLAUDE.md #10). */}
          <span style={{ width: '0.32em', height: '0.32em', marginRight: '0.34em', borderRadius: '50%', background: SUNSHINE_DOT_COLORS[i % SUNSHINE_DOT_COLORS.length], flexShrink: 0 }} />
          {evt}
        </div>
      ))}
    </div>
  );
}

export function SunshineAcademyStaffSpotlight({ config, compact }: { config: any; compact?: boolean }) {
  const staffName = config.staffName || 'Mrs. Johnson';
  const role = config.role || 'Teacher of the Week';
  const bio = config.bio || 'Inspiring 3rd graders every day with creativity and kindness!';
  const [ref, em] = useBoxEm(0.055);
  // The polaroid is TILTED 1.5deg, and a tilted box needs room for its own
  // corners: a full-bleed card rotated in a 3840-wide zone sweeps 3862px and
  // painted its edge (and the giant "*") outside the board. A PERCENTAGE
  // inset gives the rotation its clearance at every canvas size, where the
  // old fixed 16px only worked on a thumbnail.
  return (
    <div ref={ref} className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center" style={{ padding: '2.2%', fontSize: em }}>
      <div style={{
        width: '100%', height: '100%', background: 'white',
        borderRadius: compact ? '8px' : '16px', padding: compact ? '0.8rem' : '0.55em',
        boxShadow: '0 8px 28px rgba(90,70,50,0.18), 0 2px 8px rgba(90,70,50,0.1)',
        transform: 'rotate(1.5deg)', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{
          // `flex: 1` without `min-height: 0` cannot shrink below its own
          // content, so the decorative glyph held the photo panel at its
          // natural height and pushed the bio off the bottom of the card.
          flex: 1, minHeight: 0, overflow: 'hidden',
          borderRadius: compact ? '6px' : '10px', marginBottom: '0.8em',
          background: 'linear-gradient(135deg, #FFE0B2, #FFCCBC, #F8BBD0)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '4em'
        }}>
          *
        </div>
        {/* §19 (2026-09-11): name / role / bio are the operator's own words and
            carried no hotspot. Keys are what this component READS — the same
            three PropertiesPanel writes for STAFF_SPOTLIGHT.
            The role hotspot sits on an inner <span> so the decorative "*"
            prefix stays OUT of the node: BuilderZone commits `innerText`, so a
            hotspot on the pill itself would write "* Teacher of the Week" back
            into config.role and the asterisk would compound on every edit. */}
        <div style={{ textAlign: 'center' }}>
          <div data-field="staffName" style={{ fontSize: compact ? '1.2em' : '1.8em', fontWeight: 900, color: '#3A2E2A', whiteSpace: 'pre-wrap' as const }}>{staffName}</div>
          <div style={{
            fontSize: compact ? '0.8em' : '1em', fontWeight: 700, color: 'white',
            background: 'linear-gradient(135deg, #F472B6, #EC4899)', borderRadius: '999px',
            padding: '0.25em 0.75em', display: 'inline-block', marginTop: '0.25em'
          }}>
            <span aria-hidden>* </span><span data-field="role" style={{ whiteSpace: 'pre-wrap' as const }}>{role}</span>
          </div>
          <div data-field="bio" style={{ fontSize: compact ? '0.9em' : '1.1em', fontWeight: 600, color: '#7A6B63', marginTop: '0.35em', lineHeight: 1.3, whiteSpace: 'pre-wrap' as const }}>{bio}</div>
        </div>
      </div>
    </div>
  );
}

export function SunshineAcademyImageCarousel({ config }: { config: any }) {
  const [ref, em] = useBoxEm(0.075);
  return (
    <div ref={ref} className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center overflow-hidden" style={{
      borderRadius: '20px', background: 'linear-gradient(135deg, #E0F2FE, #DBEAFE, #EDE9FE)',
      boxShadow: '0 6px 24px rgba(90,70,50,0.12)', border: '4px solid white', fontSize: em
    }}>
      <div style={{ textAlign: 'center', color: '#7A6B63' }}>
        <div style={{ fontSize: '3em', marginBottom: '0.16em' }}>*</div>
        <div style={{ fontSize: '1.5em', fontWeight: 700 }}>School Photos</div>
        <div style={{ fontSize: '1em', fontWeight: 600, opacity: 0.7 }}>Add images to display here</div>
      </div>
    </div>
  );
}
