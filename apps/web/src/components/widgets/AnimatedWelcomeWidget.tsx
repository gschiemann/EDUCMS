"use client";

/**
 * AnimatedWelcomeWidget — full-screen elementary welcome scene.
 *
 * ════════════════════════════════════════════════════════════════
 *  ✓ APPROVED 2026-04-19 — Integration Lead signed off on commit dc80f51
 *  This is the GOLD STANDARD reference for shape-based animated
 *  templates. Use this as the design + structural reference for
 *  every future animated theme.
 *
 *  Key patterns to copy:
 *  - Fixed 1920×1080 canvas + transform:scale via offsetWidth/Height
 *    measurement (never vw/%, never getBoundingClientRect — both
 *    break inside scaled parents).
 *  - z-index 8 on the foreground grid so widget text renders ABOVE
 *    the wavy ticker peaks.
 *  - Birthdays: cluster art + label + names below, dynamic font
 *    ladder 56→44→36→30 by name count, white-space:nowrap.
 *  - Teacher caption rides on the washi-tape banner above the
 *    polaroid (.aw-tWashi) — never below where it can collide
 *    with the ticker.
 *  - Clock + birthdays use React state, not document.getElementById
 *    (multiple widget instances on a page would fight over a
 *    shared DOM id otherwise).
 *
 *  DO NOT regress any of the above. See CLAUDE.md "Template Design
 *  Workflow" for the full reasoning.
 * ════════════════════════════════════════════════════════════════
 */

import { useEffect, useRef, useState } from 'react';

interface Cfg {
  // Logo — uploaded image preferred, emoji as fallback (used when no
  // image is set, e.g. on a fresh preset before the customer uploads
  // their school crest).
  logoUrl?: string;
  logoEmoji?: string;
  title?: string;
  subtitle?: string;
  // Clock timezone — IANA tz string (e.g. 'America/Chicago'). When
  // empty, the player's local browser timezone is used.
  clockTimeZone?: string;
  // Live weather config — temp + desc are auto-fetched from Open-Meteo
  // based on weatherLocation. The temp/desc strings are now overrides
  // for offline previews / explicit testing only; default behavior is
  // 100% pulled from the API.
  weatherLocation?: string;
  weatherUnits?: 'imperial' | 'metric';
  weatherTemp?: string;  // optional override
  weatherDesc?: string;  // optional override
  announcementLabel?: string;
  announcementMessage?: string;
  countdownLabel?: string;
  // Date-driven countdown (preferred) — ISO-8601 date string. The
  // widget computes days remaining from now until midnight of this
  // date. Falls back to countdownNumber if unset.
  countdownDate?: string;
  countdownNumber?: string | number;  // fallback / static override
  countdownUnit?: string;              // 'days' (auto-pluralized)
  // Teacher icon — 'female' (👩‍🏫) or 'male' (👨‍🏫). No more free-text
  // emoji input.
  teacherGender?: 'female' | 'male';
  teacherEmoji?: string;  // legacy support — overridden by teacherGender if set
  teacherName?: string;
  teacherRole?: string;
  // Birthday names — accepts either a string ("Maya, Eli, Sofia" or
  // "Maya · Eli · Sofia") or an array. Rendered with auto-shrinking
  // font so 1-8 names fit cleanly.
  birthdayNames?: string | string[];
  // Optional teacher photo URL — replaces the emoji face when set.
  teacherPhotoUrl?: string;
  tickerStamp?: string;
  tickerMessages?: string[] | string;
}

// Canonical canvas dimensions — every pixel size below is sized for
// this and the wrapper scales to fit. Match the HTML mockup exactly.
const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Kid-friendly cute weather phrases keyed by Open-Meteo WMO code.
// Tone matches the rainbow theme: warm, playful, never alarming.
// Uses temperature qualifier when relevant (cold/cool/warm/hot).
function cuteWeatherPhrase(wmoCode: number, tempF: number): string {
  const cold  = tempF < 35;
  const cool  = tempF >= 35 && tempF < 60;
  const warm  = tempF >= 60 && tempF < 80;
  const hot   = tempF >= 80;
  const tempWord = cold ? 'chilly' : cool ? 'crisp' : warm ? 'warm' : 'sizzling';

  switch (wmoCode) {
    case 0:                          return `~ sunny + ${tempWord} ~`;
    case 1:                          return `~ mostly sunny + ${tempWord} ~`;
    case 2:                          return `~ partly cloudy ~`;
    case 3:                          return `~ cloudy day ~`;
    case 45: case 48:                return `~ foggy + cozy ~`;
    case 51: case 53: case 55:       return `~ sprinkly day ~`;
    case 56: case 57:                return `~ icy drizzle, bundle up! ~`;
    case 61: case 80:                return `~ light rain, grab a hood ~`;
    case 63: case 81:                return `~ rainy day, splash safely ~`;
    case 65: case 82:                return `~ heavy rain, stay dry! ~`;
    case 66: case 67:                return `~ icy rain, careful out there ~`;
    case 71: case 85:                return `~ sprinkles of snow! ❄️ ~`;
    case 73:                         return `~ snowy day, build a fort! ⛄ ~`;
    case 75: case 86:                return `~ big snow day! ❄️❄️❄️ ~`;
    case 77:                         return `~ snowflakes falling ~`;
    case 95:                         return `~ thunder rumbles ⚡ ~`;
    case 96: case 99:                return `~ stormy + hail, stay inside! ~`;
    default:                         return hot ? `~ ${tempWord} day! ~` : `~ ${tempWord} ${cool || cold ? 'day' : 'and bright'} ~`;
  }
}

export function AnimatedWelcomeWidget({ config, live }: { config: Cfg; live?: boolean }) {
  const c = config || {};
  // `live` = true on the player and inside the full-screen preview modal.
  // `live` = undefined/false in gallery thumbnails (ScaledTemplateThumbnail
  // passes false). When NOT live we still render every shape so the tile
  // looks accurate, but we skip the expensive browser work:
  //   - clock setInterval (30s, harmless alone but × 60 tiles = 2 tps)
  //   - 3 external API fetches to resolve weather (ipapi.co is 1-3s and
  //     often rate-limits; firing it from 60 thumbnails on /templates is
  //     the #1 reason the gallery felt slow per 2026-04-19 audit)
  //   - 80-element confetti DOM spawn (repaints on every compositor frame)
  //   - 15-minute weather refetch setInterval
  const isLive = !!live;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const confettiRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [now, setNow] = useState<Date>(() => new Date());
  // Live weather state — fetched from Open-Meteo for the configured
  // location. Falls back to the temp/desc overrides if either fetch
  // fails OR the user has set explicit overrides.
  const [weather, setWeather] = useState<{ tempF: number; wmoCode: number } | null>(null);

  // Scale the 1920×1080 canvas to fit our zone. Use offsetWidth/Height
  // (LAYOUT size, unaffected by parent transforms) instead of
  // getBoundingClientRect (which returns the SCALED size when an
  // ancestor has transform:scale applied — e.g. ScaledTemplateThumbnail
  // wraps everything in scale(0.13), causing double-scale collapse and
  // a tiny dot in the thumbnail).
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const compute = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w <= 0 || h <= 0) return;
      const sx = w / CANVAS_W;
      const sy = h / CANVAS_H;
      setScale(Math.min(sx, sy));
    };
    compute();
    const raf1 = requestAnimationFrame(compute);
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(compute));
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); ro.disconnect(); };
  }, []);

  // Live clock — re-render every 30s. Uses state instead of
  // getElementById so multiple widget instances on a page (gallery
  // thumb + preview modal) don't fight over a shared DOM id.
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [isLive]);

  // Live weather — three-tier resolution:
  //   1. weatherLocation set on the widget    → ZIP-code lookup via zippopotam.us
  //   2. weatherLocation empty                → IP geolocation via ipapi.co
  //                                              (free, no key, returns lat/lng)
  //   3. Both fail OR weatherTemp override set → falls back to override / default
  // Open-Meteo gives current temp + WMO code from the resolved coords.
  useEffect(() => {
    // Skip all weather network work in thumbnail mode — the static "68°"
    // fallback below renders fine without any fetch.
    if (!isLive) return;
    if (c.weatherTemp) return;
    let cancelled = false;
    const isCelsius = c.weatherUnits === 'metric';

    const resolveCoords = async (): Promise<{ lat: number; lng: number } | null> => {
      const zip = (c.weatherLocation || '').trim();
      // Tier 1 — explicit ZIP
      if (zip) {
        try {
          const m = zip.match(/^([a-z]{2})\s+(\S+)/i);
          const country = m ? m[1].toLowerCase() : 'us';
          const code = m ? m[2] : zip;
          const r = await fetch(`https://api.zippopotam.us/${country}/${encodeURIComponent(code)}`);
          if (r.ok) {
            const j = await r.json();
            const p = j?.places?.[0];
            const lat = parseFloat(p?.latitude); const lng = parseFloat(p?.longitude);
            if (isFinite(lat) && isFinite(lng)) return { lat, lng };
          }
        } catch { /* fall through to IP */ }
      }
      // Tier 2 — IP geolocation (player's network location)
      try {
        const r = await fetch('https://ipapi.co/json/');
        if (r.ok) {
          const j = await r.json();
          const lat = parseFloat(j?.latitude); const lng = parseFloat(j?.longitude);
          if (isFinite(lat) && isFinite(lng)) return { lat, lng };
        }
      } catch { /* noop */ }
      return null;
    };

    const fetchWx = async () => {
      const coords = await resolveCoords();
      if (cancelled || !coords) return;
      try {
        const tempUnit = isCelsius ? 'celsius' : 'fahrenheit';
        const wxRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}` +
          `&current=temperature_2m,weather_code&temperature_unit=${tempUnit}`
        );
        if (!wxRes.ok) return;
        const wx = await wxRes.json();
        const tempVal = wx?.current?.temperature_2m;
        const code2 = wx?.current?.weather_code;
        if (cancelled || tempVal == null || code2 == null) return;
        const tempRound = Math.round(tempVal);
        const tempF = isCelsius ? Math.round(tempRound * 9/5 + 32) : tempRound;
        setWeather({ tempF, wmoCode: code2 });
      } catch { /* falls back to default */ }
    };
    fetchWx();
    const id = setInterval(fetchWx, 15 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isLive, c.weatherLocation, c.weatherUnits, c.weatherTemp]);

  // Spawn confetti once — skip entirely in thumbnail mode. 80 absolutely-
  // positioned elements with continuous keyframe animations × N gallery
  // tiles is a lot of compositor work for something the user can barely
  // see at thumbnail resolution.
  useEffect(() => {
    if (!isLive) return;
    const layer = confettiRef.current;
    if (!layer) return;
    layer.innerHTML = '';
    const colors = ['#ec4899','#f59e0b','#10b981','#6366f1','#f43f5e','#06b6d4','#fbbf24','#a78bfa'];
    for (let i = 0; i < 80; i++) {
      const el = document.createElement('div');
      el.className = 'aw-confetti';
      const color = colors[Math.floor(Math.random() * colors.length)];
      const size = 6 + Math.random() * 12;
      const dur = 5 + Math.random() * 7;
      const isCircle = Math.random() < 0.3;
      el.style.left = (Math.random() * 100) + '%';
      el.style.width = size + 'px';
      el.style.height = (size * (isCircle ? 1 : 1.6)) + 'px';
      el.style.background = color;
      el.style.borderRadius = isCircle ? '50%' : '2px';
      el.style.animationDuration = dur + 's';
      el.style.animationDelay = (-Math.random() * dur) + 's';
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      layer.appendChild(el);
    }
  }, [isLive]);

  const tickerList = Array.isArray(c.tickerMessages)
    ? c.tickerMessages
    : (typeof c.tickerMessages === 'string' ? c.tickerMessages.split(/\n+/) : []);
  const tickerText = tickerList.length
    ? tickerList.join('  ·  ')
    : 'Welcome back, Stars!  ·  Picture day is Friday  ·  Reading Challenge: 20 minutes a day';

  // Birthdays — accept array or string (split on commas / center dots /
  // newlines). Always render INLINE on a single line with " · " between
  // names. If the line overflows the cell width, the CSS marquee in
  // .aw-bdNames slowly scrolls it sideways. No carousel — single row,
  // big text, infinite scroll.
  const birthdayList: string[] = Array.isArray(c.birthdayNames)
    ? c.birthdayNames.filter(Boolean)
    : (typeof c.birthdayNames === 'string'
        ? c.birthdayNames.split(/[,·\n]+/).map(s => s.trim()).filter(Boolean)
        : ['Maya', 'Eli', 'Sofia']);
  const bdInline = birthdayList.join('  ·  ');

  // Hard rule: 1-3 names are STATIC and sprawl across the wide bottom
  // slot. 4+ names CONTINUOUSLY marquee — no pause at the end, just
  // loops directly back to the first name. Achieved by rendering the
  // inline text TWICE in the marquee track with a separator between
  // copies and animating translateX from 0 to -50%, which moves the
  // first copy completely off-screen exactly as the duplicate slides
  // into the original position. Visually seamless infinite loop.
  const bdShouldScroll = birthdayList.length >= 4;
  const bdSlotRef = useRef<HTMLDivElement>(null);
  const bdTextRef = useRef<HTMLSpanElement>(null);
  const [bdScrollDuration, setBdScrollDuration] = useState(20);
  useEffect(() => {
    if (!bdShouldScroll) return;
    const measure = () => {
      const txt = bdTextRef.current;
      if (!txt) return;
      // Pick a duration so scroll speed feels constant regardless of
      // how many names. ~80px per second keeps it readable.
      const halfWidth = txt.scrollWidth / 2;
      setBdScrollDuration(Math.max(15, halfWidth / 80));
    };
    measure();
    const r1 = requestAnimationFrame(measure);
    const r2 = requestAnimationFrame(() => requestAnimationFrame(measure));
    const ro = new ResizeObserver(measure);
    if (bdSlotRef.current) ro.observe(bdSlotRef.current);
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); ro.disconnect(); };
  }, [bdInline, bdShouldScroll]);

  // Clock time — local by default, or in a configured timezone.
  // Uses Intl.DateTimeFormat with the requested IANA tz so DST etc
  // is handled correctly without manual offset math.
  const tz = (c.clockTimeZone || '').trim();
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    ...(tz ? { timeZone: tz } : {}),
  });
  const parts = fmt.formatToParts(now);
  const hh = parts.find(p => p.type === 'hour')?.value || '12';
  const mm = parts.find(p => p.type === 'minute')?.value || '00';
  const ampm = parts.find(p => p.type === 'dayPeriod')?.value || 'AM';

  // Outer div fills the zone; inner div is the fixed 1920x1080 canvas
  // scaled by transform. transformOrigin top-left so it scales from
  // the corner cleanly.
  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'absolute', inset: 0,
        overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#BFE8FF',
      }}
    >
      <style>{CSS}</style>

      <div
        className="aw-stage"
        style={{
          width: CANVAS_W, height: CANVAS_H,
          transform: scale > 0 ? `scale(${scale})` : 'scale(0)',
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        <div className="aw-rainbow" />
        <div className="aw-confettiLayer" ref={confettiRef} />

        <div className="aw-bgBalloon" style={{ left: 154, background: '#f87171', animationDuration: '14s', animationDelay: '0s' }} />
        <div className="aw-bgBalloon" style={{ left: 422, background: '#fbbf24', animationDuration: '18s', animationDelay: '-6s' }} />
        <div className="aw-bgBalloon" style={{ left: 1498, background: '#60a5fa', animationDuration: '16s', animationDelay: '-3s' }} />
        <div className="aw-bgBalloon" style={{ left: 1766, background: '#a78bfa', animationDuration: '20s', animationDelay: '-10s' }} />

        <div className="aw-header">
          <div className="aw-logo">
            {c.logoUrl
              ? <img src={c.logoUrl} alt="" className="aw-logoImg" />
              : <span>{c.logoEmoji || '🍎'}</span>}
          </div>
          <div className="aw-titleBox">
            <h1>{c.title || 'Welcome, Friends!'}</h1>
            <div className="aw-sub">{c.subtitle || 'today is going to be amazing ✨'}</div>
          </div>
          <div className="aw-clock">
            <div className="aw-clockT">{hh}:{mm}</div>
            <div className="aw-clockAp">{ampm}</div>
          </div>
        </div>

        <div className="aw-grid">
          <div className="aw-weather">
            <div className="aw-sunDisc">
              <div className="aw-sunFace">
                {/* Live temp wins; explicit override second; static
                    placeholder last so editor previews always show
                    something even before the API call finishes. */}
                {c.weatherTemp || (weather ? `${weather.tempF}°` : '68°')}
              </div>
            </div>
            <div className="aw-weatherDesc">
              {c.weatherDesc || (weather ? cuteWeatherPhrase(weather.wmoCode, weather.tempF) : '~ sunny + crisp ~')}
            </div>
          </div>

          <div className="aw-announce">
            <div className="aw-stars">
              <span>⭐</span><span>✨</span><span>🌟</span><span>💫</span>
            </div>
            <div className="aw-megaphone">📣</div>
            <div className="aw-annLbl">{c.announcementLabel || 'Big News'}</div>
            <div className="aw-annMsg">{c.announcementMessage || 'Book Fair starts Monday! 📚 Come find your new favorite story.'}</div>
          </div>

          <div className="aw-countdown">
            <div className="aw-badge">
              <div className="aw-cdLbl">{c.countdownLabel || 'Field Trip in'}</div>
              {(() => {
                // Date-driven preferred. Compute whole days from
                // today (00:00 local) until the target date (00:00 local).
                // Falls back to the static countdownNumber if no date set.
                if (c.countdownDate) {
                  const target = new Date(c.countdownDate + 'T00:00:00');
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const days = Math.max(0, Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
                  return (
                    <>
                      <div className="aw-cdNum">{days}</div>
                      <div className="aw-cdUnit">{days === 1 ? 'day' : (c.countdownUnit || 'days')}</div>
                    </>
                  );
                }
                return (
                  <>
                    <div className="aw-cdNum">{c.countdownNumber ?? 3}</div>
                    <div className="aw-cdUnit">{c.countdownUnit || 'days'}</div>
                  </>
                );
              })()}
            </div>
          </div>

          <div className="aw-teacher">
            <div className="aw-polaroid">
              {/* Washi-tape banner with caption, then name, then photo —
                  caption + name read first, photo anchors the bottom. */}
              <div className="aw-tWashi">{c.teacherRole || 'Teacher of the Week'}</div>
              <div className="aw-tName">{c.teacherName || 'Mrs. Johnson'}</div>
              <div className="aw-tFace">
                {c.teacherPhotoUrl
                  ? <img src={c.teacherPhotoUrl} alt="" className="aw-tPhoto" />
                  : <span>{c.teacherGender === 'male' ? '👨‍🏫' : (c.teacherEmoji || '👩‍🏫')}</span>}
              </div>
            </div>
          </div>

          <div className="aw-birthdays">
            <div className="aw-cluster">
              <div className="aw-bal aw-bal1" />
              <div className="aw-bal aw-bal2" />
              <div className="aw-bal aw-bal3" />
              <div className="aw-cake">🎂</div>
            </div>
            <div className="aw-bdLbl">Today's Birthdays</div>
            {/* Single-line marquee — names join on one row with center dots
                and slowly scroll sideways if they overflow the cell width.
                Always big text; never compresses. The slot has a fixed
                height + overflow:hidden so neighboring widgets don't reflow. */}
            <div
              className="aw-bdNamesSlot"
              ref={bdSlotRef}
              style={{
                width: bdShouldScroll ? '380px' : '1100px',
                justifyContent: bdShouldScroll ? 'flex-start' : 'flex-end',
              }}
            >
              {bdShouldScroll ? (
                /* Doubled content + translateX(0 → -50%) gives a seamless
                   infinite loop with no pause. As the first copy exits
                   left, the duplicate is exactly where the first started. */
                <span
                  ref={bdTextRef}
                  className="aw-bdNames aw-bdNamesLoop"
                  style={{ animation: `aw-bdLoop ${bdScrollDuration}s linear infinite` }}
                >
                  <span>{bdInline}</span>
                  <span aria-hidden="true">&nbsp;&nbsp;·&nbsp;&nbsp;{bdInline}</span>
                </span>
              ) : (
                <span ref={bdTextRef} className="aw-bdNames">{bdInline}</span>
              )}
            </div>
          </div>
        </div>

        <div className="aw-ticker">
          <div className="aw-tickerStamp">{c.tickerStamp || 'SCHOOL NEWS'}</div>
          <div className="aw-tickerScrollWrap">
            <span className="aw-tickerScrollText">{tickerText}</span>
          </div>
        </div>

        {/* ───── Click hotspots ──────────────────────────────────────
            Transparent overlays sized to each visual section. Clicking
            one fires a CustomEvent the PropertiesPanel listens for, so
            the relevant editor section scrolls into view + briefly
            highlights. Lets the user click "the birthday cluster" in
            the preview and immediately see the names field, instead
            of hunting through 16 fields in the side panel.
            Positioned in canvas coordinates so they scale with the
            rest of the scene. */}
        {/* Logo (left of header) — small dedicated hotspot so a click
            on the apple opens the Header section without grabbing the
            whole top strip. */}
        <Hotspot section="header"       x={36}   y={28}  w={216}  h={195} />
        {/* Title block — center of the header */}
        <Hotspot section="header"       x={264}  y={28}  w={1392} h={195} />
        {/* Clock — small dedicated hotspot at the right of the header.
            Routes to 'header' because the clock has no editable config
            of its own; clicking it lands on the header section anyway. */}
        <Hotspot section="header"       x={1668} y={28}  w={216}  h={195} />
        <Hotspot section="weather"      x={36}   y={270} w={380}  h={310} />
        <Hotspot section="announcement" x={444}  y={270} w={1112} h={650} />
        <Hotspot section="countdown"    x={1504} y={270} w={380}  h={310} />
        <Hotspot section="teacher"      x={36}   y={608} w={380}  h={312} />
        <Hotspot section="birthdays"    x={1504} y={608} w={380}  h={312} />
        <Hotspot section="ticker"       x={0}    y={970} w={1920} h={110} />
      </div>
    </div>
  );
}

function Hotspot({ section, x, y, w, h }: { section: string; x: number; y: number; w: number; h: number }) {
  return (
    <div
      className="aw-hotspot"
      data-section={section}
      role="button"
      tabIndex={0}
      onPointerDown={(e) => {
        // Don't stopPropagation — the zone needs to be selected first
        // (which mounts the ANIMATED_WELCOME fields in the panel) before
        // we can scroll to a section. The CustomEvent fires after; the
        // panel listener retries until the target element exists.
        try {
          window.dispatchEvent(new CustomEvent('aw-edit-section', { detail: { section } }));
        } catch { /* noop */ }
      }}
      style={{
        position: 'absolute',
        left: x, top: y, width: w, height: h,
        cursor: 'pointer',
        zIndex: 50,
      }}
      aria-label={`Edit ${section}`}
    />
  );
}

// CSS is identical to scratch/design/animated-rainbow.html. All sizes
// in pixels — sized for the 1920×1080 canvas. Do NOT replace with vw/%.
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;700&family=Caveat:wght@700&family=Patrick+Hand&display=swap');

.aw-stage {
  position: relative;
  font-family: 'Fredoka', ui-rounded, system-ui, sans-serif;
  color: #2d1b4d;
  background:
    radial-gradient(ellipse at 50% 110%, #fef3c7 0%, transparent 50%),
    linear-gradient(180deg, #BFE8FF 0%, #FFE0EC 55%, #FFD8A8 100%);
  overflow: hidden;
}
.aw-stage::before, .aw-stage::after {
  content: ''; position: absolute; pointer-events: none;
  width: 200%; height: 100%;
  background-image:
    radial-gradient(ellipse 80px 30px at 10% 20%, rgba(255,255,255,.7), transparent 60%),
    radial-gradient(ellipse 120px 40px at 30% 35%, rgba(255,255,255,.6), transparent 60%),
    radial-gradient(ellipse 90px 32px at 55% 18%, rgba(255,255,255,.7), transparent 60%),
    radial-gradient(ellipse 110px 38px at 78% 28%, rgba(255,255,255,.6), transparent 60%);
  animation: aw-cloudDrift 90s linear infinite; top: 0; left: -100%;
}
.aw-stage::after { animation-duration: 130s; animation-delay: -40s; opacity: .65; }
@keyframes aw-cloudDrift { from { transform: translateX(0); } to { transform: translateX(50%); } }

.aw-confettiLayer { position: absolute; inset: 0; pointer-events: none; z-index: 4; overflow: hidden; }
.aw-confetti {
  position: absolute; top: -20px; width: 12px; height: 18px; border-radius: 2px;
  animation: aw-confettiFall linear infinite; will-change: transform;
}
@keyframes aw-confettiFall {
  0% { transform: translateY(-30px) rotate(0deg); opacity: 0; }
  8% { opacity: 1; }
  100% { transform: translateY(1180px) rotate(720deg); opacity: .8; }
}

.aw-rainbow {
  position: absolute; left: -200px; right: -200px; top: 200px; height: 90px; z-index: 1;
  background: repeating-linear-gradient(135deg,
    #ff5e7e 0 30px, #ffb950 30px 60px, #ffe66d 60px 90px,
    #6cd97e 90px 120px, #5cc5ff 120px 150px, #b48cff 150px 180px);
  background-size: 360px 100%;
  animation: aw-rainbowSlide 8s linear infinite;
  transform: rotate(-3deg);
  box-shadow: 0 6px 24px rgba(0,0,0,.18);
}
@keyframes aw-rainbowSlide { from { background-position: 0 0; } to { background-position: 360px 0; } }

.aw-header {
  position: absolute; top: 36px; left: 36px; right: 36px;
  display: grid; grid-template-columns: 180px 1fr 180px;
  gap: 36px; z-index: 5; align-items: center;
}
.aw-logo {
  width: 180px; height: 180px; background: #fff; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 96px;
  box-shadow: 0 6px 16px rgba(0,0,0,.18), inset 0 0 0 6px #fcd34d;
  animation: aw-bounceLogo 2.4s ease-in-out infinite;
  overflow: hidden;
}
.aw-logoImg {
  width: 100%; height: 100%; object-fit: cover;
  border-radius: 50%;
}
@keyframes aw-bounceLogo {
  0%, 100% { transform: translateY(0) rotate(-4deg); }
  50% { transform: translateY(-12px) rotate(4deg); }
}
.aw-titleBox {
  background: rgba(255,255,255,.85); backdrop-filter: blur(4px);
  border-radius: 28px; padding: 28px 36px; text-align: center;
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
  border: 5px dashed #ec4899;
  animation: aw-breathe 3.5s ease-in-out infinite;
}
@keyframes aw-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.025); } }
.aw-titleBox h1 {
  margin: 0; line-height: .95;
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 110px;
  background: linear-gradient(90deg, #ec4899 0%, #f59e0b 33%, #10b981 66%, #6366f1 100%);
  background-size: 300% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: aw-gradientShift 6s linear infinite;
}
@keyframes aw-gradientShift { from { background-position: 0% 50%; } to { background-position: 300% 50%; } }
.aw-sub { font-family: 'Caveat', cursive; font-size: 56px; color: #92400e; margin-top: 10px; }

.aw-clock {
  width: 180px; height: 180px;
  background: #fff; border-radius: 50%; border: 10px solid #fcd34d;
  box-shadow: 0 6px 16px rgba(0,0,0,.2);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: 'Fredoka', sans-serif; font-weight: 700;
  animation: aw-wiggle 4s ease-in-out infinite;
}
@keyframes aw-wiggle {
  0%, 7%, 100% { transform: rotate(0deg); }
  1%, 5% { transform: rotate(-12deg); }
  3% { transform: rotate(12deg); }
}
.aw-clockT { font-size: 56px; color: #be185d; line-height: 1; }
.aw-clockAp { font-size: 28px; color: #92400e; }

.aw-grid {
  position: absolute; top: 270px; left: 36px; right: 36px; bottom: 160px;
  display: grid; grid-template-columns: 380px 1fr 380px;
  grid-template-rows: 1fr 1fr; gap: 28px;
  /* z-index 8 puts the whole grid (incl. birthdays) above the ticker
     which is z-index 6, so the wavy ticker peaks no longer visually
     clip the bottom of widget text (especially Caveat's descenders). */
  z-index: 8;
}

/* WEATHER — sun with rays */
.aw-weather { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; padding: 12px; }
.aw-sunDisc { position: relative; width: 260px; height: 260px; display: flex; align-items: center; justify-content: center; }
.aw-sunDisc::before {
  content: ''; position: absolute; inset: -50px; border-radius: 50%;
  background:
    conic-gradient(from 0deg,
      transparent 0 18deg, #fcd34d 18deg 24deg,
      transparent 24deg 48deg, #fcd34d 48deg 54deg,
      transparent 54deg 78deg, #fcd34d 78deg 84deg,
      transparent 84deg 108deg, #fcd34d 108deg 114deg,
      transparent 114deg 138deg, #fcd34d 138deg 144deg,
      transparent 144deg 168deg, #fcd34d 168deg 174deg,
      transparent 174deg 198deg, #fcd34d 198deg 204deg,
      transparent 204deg 228deg, #fcd34d 228deg 234deg,
      transparent 234deg 258deg, #fcd34d 258deg 264deg,
      transparent 264deg 288deg, #fcd34d 288deg 294deg,
      transparent 294deg 318deg, #fcd34d 318deg 324deg,
      transparent 324deg 348deg, #fcd34d 348deg 354deg,
      transparent 354deg 360deg);
  -webkit-mask: radial-gradient(circle, transparent 130px, #000 130px, #000 165px, transparent 165px);
          mask: radial-gradient(circle, transparent 130px, #000 130px, #000 165px, transparent 165px);
  animation: aw-spin 18s linear infinite; opacity: .85;
}
@keyframes aw-spin { to { transform: rotate(360deg); } }
.aw-sunFace {
  width: 230px; height: 230px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 70%, #d97706);
  box-shadow: 0 0 60px rgba(251, 191, 36, .65), inset 0 -12px 20px rgba(180, 83, 9, .25);
  display: flex; align-items: center; justify-content: center;
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 76px; color: #7c2d12;
  text-shadow: 0 2px 0 rgba(255,255,255,.4);
}
/* Single-line, never wraps. Truncates with ellipsis if a phrase is
   too long for the column. Fixed height keeps the row from pushing
   the rest of the widget down (which previously shoved teacher down
   into the ticker). */
.aw-weatherDesc {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 52px;
  color: #78350f; margin-top: 18px; text-align: center;
  text-shadow: 0 2px 0 rgba(255,255,255,.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  height: 56px;
  line-height: 56px;
}

/* ANNOUNCEMENT — cloud puff */
.aw-announce {
  grid-column: 2; grid-row: 1 / span 2;
  display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;
  position: relative; padding: 50px 80px;
  animation: aw-floatUp 4s ease-in-out infinite;
}
@keyframes aw-floatUp { 0%, 100% { transform: translateY(0) rotate(-1deg); } 50% { transform: translateY(-10px) rotate(1deg); } }
.aw-announce::before {
  content: ''; position: absolute; left: 50%; top: 50%;
  width: 280px; height: 200px; transform: translate(-50%, -50%);
  background: #fff; border-radius: 50%;
  box-shadow:
    -190px 30px 0 -10px #fff, -130px -50px 0 -8px #fff, -50px -90px 0 -2px #fff,
    60px -90px 0 -4px #fff, 150px -50px 0 -8px #fff, 200px 30px 0 -10px #fff,
    120px 70px 0 -6px #fff, 0 90px 0 -2px #fff, -120px 70px 0 -6px #fff,
    0 0 0 4px #fcd34d,
    -190px 30px 0 -6px #fcd34d, -130px -50px 0 -4px #fcd34d, -50px -90px 0 2px #fcd34d,
    60px -90px 0 0 #fcd34d, 150px -50px 0 -4px #fcd34d, 200px 30px 0 -6px #fcd34d,
    120px 70px 0 -2px #fcd34d, 0 90px 0 2px #fcd34d, -120px 70px 0 -2px #fcd34d,
    0 16px 32px rgba(0,0,0,.18);
  z-index: -1;
}
.aw-stars { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.aw-stars span { position: absolute; font-size: 44px; opacity: .9; animation: aw-twinkle 1.4s ease-in-out infinite; }
.aw-stars span:nth-child(1) { top: 50px; left: 130px; }
.aw-stars span:nth-child(2) { top: 80px; right: 140px; animation-delay: .3s; }
.aw-stars span:nth-child(3) { bottom: 80px; left: 160px; animation-delay: .6s; }
.aw-stars span:nth-child(4) { bottom: 60px; right: 180px; animation-delay: .9s; }
@keyframes aw-twinkle {
  0%, 100% { opacity: .25; transform: scale(.8) rotate(0deg); }
  50% { opacity: 1; transform: scale(1.2) rotate(20deg); }
}
.aw-megaphone { font-size: 96px; line-height: 1; animation: aw-shake 1.6s ease-in-out infinite; transform-origin: 80% 80%; }
@keyframes aw-shake {
  0%, 100% { transform: rotate(-8deg); }
  20%, 60% { transform: rotate(10deg); }
  40%, 80% { transform: rotate(-10deg); }
}
.aw-annLbl { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 28px; letter-spacing: .25em; color: #b45309; text-transform: uppercase; margin-top: 12px; }
.aw-annMsg { font-family: 'Caveat', cursive; font-weight: 700; font-size: 90px; color: #be185d; line-height: 1.05; margin-top: 18px; text-shadow: 2px 2px 0 #fff; max-width: 800px; }

/* COUNTDOWN — starburst */
.aw-countdown { grid-column: 3; grid-row: 1; display: flex; align-items: center; justify-content: center; position: relative; }
.aw-badge {
  width: 280px; height: 280px;
  background: radial-gradient(circle at 35% 30%, #fef3c7, #fbbf24 75%, #d97706);
  clip-path: polygon(
    50% 0%, 60% 12%, 75% 8%, 73% 23%, 88% 25%, 80% 38%,
    96% 45%, 84% 55%, 96% 65%, 80% 70%, 88% 82%, 73% 80%,
    75% 96%, 60% 88%, 50% 100%, 40% 88%, 25% 96%, 27% 80%,
    12% 82%, 20% 70%, 4% 65%, 16% 55%, 4% 45%, 20% 38%,
    12% 25%, 27% 23%, 25% 8%, 40% 12%);
  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
  box-shadow: 0 12px 28px rgba(0,0,0,.18);
  animation: aw-bounceNum 1.6s ease-in-out infinite;
}
@keyframes aw-bounceNum {
  0%, 100% { transform: scale(1) rotate(-3deg); }
  50% { transform: scale(1.06) rotate(3deg); }
}
.aw-cdLbl { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 18px; letter-spacing: .08em; color: #7c2d12; text-transform: uppercase; max-width: 150px; line-height: 1.1; }
.aw-cdNum { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 84px; line-height: .9; color: #7c2d12; text-shadow: 0 3px 0 rgba(255,255,255,.5); margin: 6px 0; }
.aw-cdUnit { font-family: 'Caveat', cursive; font-size: 32px; color: #7c2d12; }

/* TEACHER — polaroid. Caption (washi tape) on top of the frame, then
   name, then photo — photo anchors the bottom of the polaroid.
   justify-content: flex-start + fixed padding anchors the polaroid
   at a known position so it doesn't drift when sibling cells re-render. */
.aw-teacher {
  grid-column: 1; grid-row: 2;
  display: flex; flex-direction: column; align-items: center;
  justify-content: flex-start;
  padding-top: 28px;
  position: relative;
}
.aw-polaroid {
  background: #fff; padding: 38px 18px 18px; width: 260px;
  box-shadow: 0 12px 24px rgba(0,0,0,.22);
  transform: rotate(-3deg); position: relative;
  animation: aw-slideX 5s ease-in-out infinite;
  display: flex; flex-direction: column; align-items: center;
}
@keyframes aw-slideX {
  0%, 100% { transform: rotate(-3deg) translateX(-4px); }
  50% { transform: rotate(-3deg) translateX(4px); }
}
/* The washi tape banner that sits ON TOP of the polaroid and carries
   the 'Teacher of the Week' caption. Replaces the old empty pseudo-
   element so the text can ride along with the tape. */
.aw-tWashi {
  position: absolute; top: -22px; left: 50%;
  transform: translateX(-50%) rotate(-3deg);
  min-width: 90%;
  padding: 8px 18px;
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 6px, transparent 6px 12px), #f9a8d4;
  box-shadow: 0 2px 6px rgba(0,0,0,.22);
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 18px;
  letter-spacing: .14em; text-transform: uppercase; color: #831843;
  text-align: center;
  text-shadow: 0 1px 0 rgba(255,255,255,.4);
  white-space: nowrap;
  z-index: 2;
}
/* New stack order: caption (washi) → name → photo. Name sits ABOVE
   the photo so it reads first. Photo anchors the bottom. */
.aw-tName {
  font-family: 'Caveat', cursive; font-weight: 700; font-size: 36px; color: #6d28d9;
  line-height: 1; text-align: center;
  margin-bottom: 10px;
}
.aw-tFace {
  width: 100%; aspect-ratio: 1;
  background: linear-gradient(135deg, #fce7f3, #ddd6fe);
  display: flex; align-items: center; justify-content: center; font-size: 120px;
  overflow: hidden;
}
.aw-tPhoto {
  width: 100%; height: 100%; object-fit: cover;
}
/* .aw-tRole removed — role text is now rendered inside .aw-tWashi
   on top of the polaroid, no longer a separate element below it. */

/* BIRTHDAYS — balloon cluster */
/* justify-content: flex-start + padding-top anchors the cluster at the
   top of the cell. Then the names slot below has a FIXED height so the
   cluster (and visually nearby cells) never shift between carousel
   rotations regardless of how many names show on the current page. */
.aw-birthdays {
  grid-column: 3; grid-row: 2;
  display: flex; flex-direction: column; align-items: center;
  justify-content: flex-start;
  padding: 18px 12px 12px;
  position: relative; z-index: 7;
}
.aw-cluster { position: relative; width: 200px; height: 160px; animation: aw-bob 1.4s ease-in-out infinite; }
@keyframes aw-bob {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50% { transform: translateY(-10px) rotate(3deg); }
}
.aw-bal { position: absolute; width: 70px; height: 88px; border-radius: 50% 50% 48% 48%; box-shadow: inset -8px -10px 12px rgba(0,0,0,.18), 0 4px 8px rgba(0,0,0,.18); }
.aw-bal::after { content: ''; position: absolute; left: 50%; top: 100%; width: 1px; height: 50px; background: rgba(0,0,0,.4); transform: translateX(-50%); }
.aw-bal1 { left: 10px; top: 0; background: #f87171; }
.aw-bal2 { left: 60px; top: 12px; background: #fbbf24; transform: rotate(-6deg); width: 64px; height: 80px; }
.aw-bal3 { left: 115px; top: 0; background: #ec4899; }
.aw-cake { position: absolute; bottom: -12px; left: 50%; transform: translateX(-50%); font-size: 50px; line-height: 1; }
.aw-bdLbl {
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 22px;
  letter-spacing: .12em; color: #be185d; text-transform: uppercase;
  margin-top: 12px; text-shadow: 0 2px 0 rgba(255,255,255,.7);
}
/* Names slot is positioned ABSOLUTELY relative to the birthdays cell
   so 1-3 names can extend LEFT beyond the narrow column — long single
   names get the full bottom width to breathe instead of being squished
   or scrolling unnecessarily. Anchored to the right edge so it visually
   belongs to the birthdays cell. Marquee only kicks in when 4+ names
   AND the text still doesn't fit even in this wider slot. */
.aw-bdNamesSlot {
  position: absolute;
  right: 14px;
  bottom: 16px;
  width: 1100px;
  max-width: 1100px;
  height: 90px;
  display: flex; align-items: center; justify-content: flex-end;
  overflow: hidden;
  pointer-events: none;
  z-index: 8;
}
.aw-bdNames {
  font-family: 'Caveat', cursive; font-weight: 700;
  font-size: 64px; line-height: 1; color: #831843;
  text-shadow: 0 2px 0 rgba(255,255,255,.7);
  white-space: nowrap;
  display: inline-block;
  /* Default: no animation. Component sets style.animation when the
     measured text overflows, with a duration proportional to scroll
     distance so the speed feels constant regardless of list length. */
}
/* Continuous loop marquee — content is duplicated in the JSX so
   translating by -50% slides the first copy completely off-screen
   exactly as the duplicate slides into the original position.
   Visually seamless, no pause, no snap-back glitch. */
@keyframes aw-bdLoop {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
.aw-bdNamesLoop {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  will-change: transform;
}

/* TICKER — wavy ribbon */
.aw-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 110px;
  background: linear-gradient(90deg, #fcd34d, #fbbf24);
  display: flex; align-items: center; overflow: hidden; z-index: 6;
  border-top: 5px solid #ec4899;
  box-shadow: 0 -4px 12px rgba(0,0,0,.12);
  clip-path: polygon(
    0% 16%, 5% 0%, 10% 16%, 15% 0%, 20% 16%, 25% 0%, 30% 16%, 35% 0%, 40% 16%,
    45% 0%, 50% 16%, 55% 0%, 60% 16%, 65% 0%, 70% 16%, 75% 0%, 80% 16%, 85% 0%,
    90% 16%, 95% 0%, 100% 16%, 100% 100%, 0% 100%);
}
.aw-tickerStamp {
  flex: 0 0 auto; padding: 0 36px; height: 100%;
  background: #ec4899; color: #fff; display: flex; align-items: center;
  font-family: 'Fredoka', sans-serif; font-weight: 700; letter-spacing: .15em; font-size: 26px;
  margin-top: 18px;
  position: relative; z-index: 2;
}
/* The scroll wrapper clips its OWN bounds so the text inside can never
   bleed past the stamp on the left. The text starts off-screen on the
   right and slides into view, then off the left edge of the wrapper. */
.aw-tickerScrollWrap {
  flex: 1; height: 100%; overflow: hidden;
  display: flex; align-items: center; margin-top: 18px;
  position: relative;
}
.aw-tickerScrollText {
  display: inline-block;
  font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 44px; color: #831843;
  white-space: nowrap; padding-left: 60px;
  animation: aw-scrollText 28s linear infinite;
  will-change: transform;
}
/* Start with the text shifted fully right (100% of wrapper width = off-screen),
   end with text shifted fully left (-100% of its own width = off-screen). */
@keyframes aw-scrollText {
  from { transform: translateX(100%); }
  to   { transform: translateX(-100%); }
}

.aw-bgBalloon {
  position: absolute; bottom: -120px; width: 60px; height: 76px; border-radius: 50% 50% 48% 48%;
  z-index: 2; animation: aw-balloonRise linear infinite; will-change: transform;
}
/* Click hotspots — invisible by default, soft pink ring on hover so
   the user knows the region is editable. Only visible when the
   pointer is over them; doesn't intrude on the rendered design. */
.aw-hotspot {
  outline: none;
  transition: box-shadow .15s ease, background-color .15s ease;
  border-radius: 12px;
}
.aw-hotspot:hover {
  background-color: rgba(236, 72, 153, .08);
  box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .55);
}
.aw-hotspot:focus-visible {
  background-color: rgba(236, 72, 153, .12);
  box-shadow: inset 0 0 0 3px rgba(236, 72, 153, .85);
}

.aw-bgBalloon::after {
  content: ''; position: absolute; left: 50%; top: 100%;
  width: 1px; height: 220px; background: rgba(0,0,0,.3); transform: translateX(-50%);
}
@keyframes aw-balloonRise {
  0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 0; }
  10% { opacity: 1; }
  50% { transform: translateY(-540px) translateX(20px) rotate(8deg); }
  100% { transform: translateY(-1300px) translateX(-20px) rotate(-8deg); opacity: .9; }
}
`;
