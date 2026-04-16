"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Clock, Cloud, Sun, CloudRain, CloudSnow, CloudLightning, Wind, Droplets,
  Megaphone, CalendarDays, Bell, UtensilsCrossed, Users, Globe, Rss, Share2,
  Image as ImageIcon, Play, ArrowRight, Timer, Shield, FileText, Square,
  ChevronRight, Thermometer, Eye, Sunrise, Sunset, MapPin,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════
// Helper — resolve relative asset URLs to full URLs
// ═══════════════════════════════════════════════════════
const API_BASE = (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_API_URL)
  ? process.env.NEXT_PUBLIC_API_URL.replace('/api/v1', '')
  : 'http://localhost:8080';

function resolveUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${API_BASE}${url}`;
}

// ═══════════════════════════════════════════════════════
// Master renderer — picks the right widget by type
// ═══════════════════════════════════════════════════════

export function WidgetPreview({ widgetType, config, width, height, live }: {
  widgetType: string;
  config: any;
  width: number;   // percentage width of zone
  height: number;  // percentage height of zone
  live?: boolean;  // true on the player page — enables autoplay, iframes, etc.
}) {
  const cfg = config || {};
  const compact = height < 20 || width < 25;

  switch (widgetType) {
    case 'CLOCK':        return <ClockWidget config={cfg} compact={compact} />;
    case 'WEATHER':      return <WeatherWidget config={cfg} compact={compact} />;
    case 'COUNTDOWN':    return <CountdownWidget config={cfg} compact={compact} />;
    case 'TEXT':         return <TextWidget config={cfg} />;
    case 'RICH_TEXT':    return <TextWidget config={cfg} />;
    case 'ANNOUNCEMENT': return <AnnouncementWidget config={cfg} compact={compact} />;
    case 'TICKER':       return <TickerWidget config={cfg} />;
    case 'BELL_SCHEDULE': return <BellScheduleWidget config={cfg} compact={compact} />;
    case 'LUNCH_MENU':   return <LunchMenuWidget config={cfg} compact={compact} />;
    case 'CALENDAR':     return <CalendarWidget config={cfg} compact={compact} />;
    case 'STAFF_SPOTLIGHT': return <StaffSpotlightWidget config={cfg} compact={compact} />;
    case 'IMAGE':        return <ImageWidget config={cfg} />;
    case 'IMAGE_CAROUSEL': return <ImageCarouselWidget config={cfg} />;
    case 'VIDEO':        return <VideoWidget config={cfg} live={live} />;
    case 'LOGO':         return <LogoWidget config={cfg} />;
    case 'WEBPAGE':      return <WebpageWidget config={cfg} live={live} />;
    case 'RSS_FEED':     return <RSSWidget config={cfg} compact={compact} />;
    case 'SOCIAL_FEED':  return <SocialWidget config={cfg} />;
    case 'PLAYLIST':     return <PlaylistWidget config={cfg} />;
    default:             return null;
  }
}

// ═══════════════════════════════════════════════════════
// CLOCK — Real-time with timezone support
// ═══════════════════════════════════════════════════════

function ClockWidget({ config, compact }: { config: any; compact: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tz = config.timezone || undefined; // e.g. "America/Chicago"
  const is24 = config.format === '24h';

  // Use Intl to get timezone-aware values
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(now);

  const rawHour = parseInt(fmt({ hour: 'numeric', hour12: false }), 10);
  const ampm = rawHour >= 12 ? 'PM' : 'AM';
  const hours = is24 ? rawHour : (rawHour % 12 || 12);
  const mins = fmt({ minute: '2-digit' }).padStart(2, '0');
  const secs = fmt({ second: '2-digit' }).padStart(2, '0');
  const dateStr = fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const color = config.color || '#1e293b';
  const bg = config.bgColor || 'transparent';

  // Show timezone abbreviation if explicitly set
  const tzLabel = tz ? fmt({ timeZoneName: 'short' }).split(', ').pop() : null;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden" style={{ backgroundColor: bg }}>
      <div className="flex items-baseline gap-[0.1em] tabular-nums" style={{ color }}>
        <span style={{ fontSize: compact ? '1.8em' : '3.5em', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 }}>
          {hours}:{mins}
        </span>
        <span style={{ fontSize: compact ? '0.7em' : '1.2em', fontWeight: 600, opacity: 0.4 }}>{secs}</span>
        {!is24 && <span style={{ fontSize: compact ? '0.6em' : '1em', fontWeight: 700, opacity: 0.5, marginLeft: '0.15em' }}>{ampm}</span>}
      </div>
      {!compact && (
        <div style={{ fontSize: '0.65em', fontWeight: 500, opacity: 0.45, marginTop: '0.3em', color, letterSpacing: '0.05em' }}>
          {dateStr}
        </div>
      )}
      {tzLabel && !compact && (
        <div style={{ fontSize: '0.45em', fontWeight: 600, opacity: 0.35, marginTop: '0.15em', color, letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>
          {tzLabel}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// WEATHER — Live weather via Open-Meteo (free, no key)
// ═══════════════════════════════════════════════════════

// WMO weather code → description + icon + gradient
const WMO_MAP: Record<number, { label: string; icon: typeof Sun; gradient: string; iconColor: string; glow: string }> = {
  0:  { label: 'Clear Sky',       icon: Sun,            gradient: 'linear-gradient(135deg, #3b82f6, #1d4ed8, #6366f1)', iconColor: '#fbbf24', glow: 'rgba(251,191,36,0.5)' },
  1:  { label: 'Mainly Clear',    icon: Sun,            gradient: 'linear-gradient(135deg, #3b82f6, #2563eb, #6366f1)', iconColor: '#fbbf24', glow: 'rgba(251,191,36,0.4)' },
  2:  { label: 'Partly Cloudy',   icon: Cloud,          gradient: 'linear-gradient(135deg, #6b7280, #4b5563, #6366f1)', iconColor: '#e2e8f0', glow: 'rgba(226,232,240,0.3)' },
  3:  { label: 'Overcast',        icon: Cloud,          gradient: 'linear-gradient(135deg, #64748b, #475569, #334155)', iconColor: '#cbd5e1', glow: 'rgba(203,213,225,0.3)' },
  45: { label: 'Fog',             icon: Wind,           gradient: 'linear-gradient(135deg, #94a3b8, #64748b, #475569)', iconColor: '#e2e8f0', glow: 'rgba(226,232,240,0.3)' },
  48: { label: 'Rime Fog',        icon: Wind,           gradient: 'linear-gradient(135deg, #94a3b8, #64748b, #475569)', iconColor: '#e2e8f0', glow: 'rgba(226,232,240,0.3)' },
  51: { label: 'Light Drizzle',   icon: CloudRain,      gradient: 'linear-gradient(135deg, #475569, #334155, #1e293b)', iconColor: '#93c5fd', glow: 'rgba(147,197,253,0.4)' },
  53: { label: 'Drizzle',         icon: CloudRain,      gradient: 'linear-gradient(135deg, #475569, #334155, #1e293b)', iconColor: '#93c5fd', glow: 'rgba(147,197,253,0.4)' },
  55: { label: 'Dense Drizzle',   icon: CloudRain,      gradient: 'linear-gradient(135deg, #334155, #1e293b, #0f172a)', iconColor: '#60a5fa', glow: 'rgba(96,165,250,0.4)' },
  61: { label: 'Light Rain',      icon: CloudRain,      gradient: 'linear-gradient(135deg, #1e40af, #1e3a8a, #312e81)', iconColor: '#93c5fd', glow: 'rgba(147,197,253,0.4)' },
  63: { label: 'Rain',            icon: CloudRain,      gradient: 'linear-gradient(135deg, #1e3a8a, #312e81, #1e1b4b)', iconColor: '#60a5fa', glow: 'rgba(96,165,250,0.5)' },
  65: { label: 'Heavy Rain',      icon: CloudRain,      gradient: 'linear-gradient(135deg, #0f172a, #1e1b4b, #0c0a09)', iconColor: '#3b82f6', glow: 'rgba(59,130,246,0.5)' },
  71: { label: 'Light Snow',      icon: CloudSnow,      gradient: 'linear-gradient(135deg, #e0e7ff, #c7d2fe, #a5b4fc)', iconColor: '#6366f1', glow: 'rgba(99,102,241,0.3)' },
  73: { label: 'Snow',            icon: CloudSnow,      gradient: 'linear-gradient(135deg, #c7d2fe, #a5b4fc, #818cf8)', iconColor: '#4f46e5', glow: 'rgba(79,70,229,0.4)' },
  75: { label: 'Heavy Snow',      icon: CloudSnow,      gradient: 'linear-gradient(135deg, #a5b4fc, #818cf8, #6366f1)', iconColor: '#312e81', glow: 'rgba(49,46,129,0.4)' },
  80: { label: 'Rain Showers',    icon: CloudRain,      gradient: 'linear-gradient(135deg, #1e40af, #1d4ed8, #2563eb)', iconColor: '#bfdbfe', glow: 'rgba(191,219,254,0.4)' },
  95: { label: 'Thunderstorm',    icon: CloudLightning, gradient: 'linear-gradient(135deg, #1e1b4b, #0f172a, #0c0a09)', iconColor: '#fbbf24', glow: 'rgba(251,191,36,0.6)' },
  96: { label: 'T-Storm + Hail',  icon: CloudLightning, gradient: 'linear-gradient(135deg, #0f172a, #0c0a09, #000000)', iconColor: '#f59e0b', glow: 'rgba(245,158,11,0.6)' },
};

function getWMO(code: number) {
  // Find the closest known code
  if (WMO_MAP[code]) return WMO_MAP[code];
  const keys = Object.keys(WMO_MAP).map(Number).sort((a, b) => a - b);
  for (let i = keys.length - 1; i >= 0; i--) {
    if (keys[i] <= code) return WMO_MAP[keys[i]];
  }
  return WMO_MAP[0];
}

// Simple in-memory cache so we don't spam the API
const weatherCache: Record<string, { data: any; ts: number }> = {};
const CACHE_MS = 15 * 60 * 1000; // 15 minutes

async function fetchWeather(location: string, isCelsius: boolean) {
  const cacheKey = `${location}|${isCelsius}`;
  const cached = weatherCache[cacheKey];
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  try {
    // Open-Meteo geocoder only handles city names — strip ", STATE" suffixes
    const cityName = location.replace(/,\s*\w{2,}$/i, '').trim();

    // Step 1: Geocode location name → lat/lng
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en`);
    const geoData = await geoRes.json();
    if (!geoData.results?.length) return null;
    const { latitude, longitude, name, admin1 } = geoData.results[0];

    // Step 2: Fetch current weather + daily high/low
    const tempUnit = isCelsius ? 'celsius' : 'fahrenheit';
    const wxRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min&temperature_unit=${tempUnit}&wind_speed_unit=mph&forecast_days=1`
    );
    const wxData = await wxRes.json();

    const result = {
      temp: Math.round(wxData.current.temperature_2m),
      feelsLike: Math.round(wxData.current.apparent_temperature),
      humidity: wxData.current.relative_humidity_2m,
      wind: Math.round(wxData.current.wind_speed_10m),
      weatherCode: wxData.current.weather_code,
      high: Math.round(wxData.daily.temperature_2m_max[0]),
      low: Math.round(wxData.daily.temperature_2m_min[0]),
      locationName: admin1 ? `${name}, ${admin1}` : name,
    };
    weatherCache[cacheKey] = { data: result, ts: Date.now() };
    return result;
  } catch (err) {
    console.error('[WeatherWidget] fetch failed:', err);
    return null;
  }
}

function WeatherWidget({ config, compact }: { config: any; compact: boolean }) {
  const location = config.location || 'Springfield';
  const isCelsius = config.units === 'celsius';
  const unit = isCelsius ? '°C' : '°F';
  const [weather, setWeather] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchWeather(location, isCelsius).then(data => {
      if (!cancelled) { setWeather(data); setLoading(false); }
    });
    // Refresh every 15 minutes
    const t = setInterval(() => {
      fetchWeather(location, isCelsius).then(data => {
        if (!cancelled) setWeather(data);
      });
    }, CACHE_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [location, isCelsius]);

  const wmo = getWMO(weather?.weatherCode ?? 0);
  const WeatherIcon = wmo.icon;
  const gradient = weather ? wmo.gradient : 'linear-gradient(135deg, #3b82f6, #1d4ed8, #6366f1)';

  // Loading / error state
  if (loading || !weather) {
    return (
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden" style={{ background: gradient }}>
        <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/10 rounded-full" />
        <div className="flex flex-col items-center gap-1">
          <Cloud style={{ width: '2em', height: '2em', color: 'rgba(255,255,255,0.4)', animation: 'pulse 2s ease-in-out infinite' }} />
          <span style={{ fontSize: '0.5em', color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
            {loading ? 'Loading weather...' : 'Location not found'}
          </span>
        </div>
        <style>{`@keyframes pulse { 0%,100% { opacity:0.4 } 50% { opacity:1 } }`}</style>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex overflow-hidden" style={{ background: gradient }}>
      {/* Decorative circles */}
      <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/10 rounded-full" />
      <div className="absolute bottom-4 -left-4 w-16 h-16 bg-white/5 rounded-full" />

      <div className="relative flex-1 flex flex-col justify-center px-[8%] py-[5%]">
        <div className="flex items-center gap-[4%]">
          <div className="shrink-0">
            <WeatherIcon style={{
              width: compact ? '1.5em' : '2.8em', height: compact ? '1.5em' : '2.8em',
              color: wmo.iconColor, filter: `drop-shadow(0 0 8px ${wmo.glow})`,
            }} />
          </div>
          <div>
            <div className="flex items-start">
              <span style={{ fontSize: compact ? '2em' : '3.2em', fontWeight: 800, color: 'white', lineHeight: 1 }}>{weather.temp}</span>
              <span style={{ fontSize: compact ? '0.7em' : '1em', fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginTop: '0.2em' }}>{unit}</span>
            </div>
            {!compact && (
              <div style={{ fontSize: '0.6em', color: 'rgba(255,255,255,0.7)', fontWeight: 500, marginTop: '0.1em' }}>{wmo.label}</div>
            )}
          </div>
        </div>
        {!compact && (
          <>
            <div className="flex items-center gap-[6%] mt-[5%]">
              <div className="flex items-center gap-[2%]">
                <MapPin style={{ width: '0.6em', height: '0.6em', color: 'rgba(255,255,255,0.5)' }} />
                <span style={{ fontSize: '0.55em', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{weather.locationName}</span>
              </div>
              <span style={{ fontSize: '0.5em', color: 'rgba(255,255,255,0.5)' }}>H:{weather.high}° L:{weather.low}°</span>
            </div>
            <div className="flex items-center gap-[8%] mt-[3%]">
              <div className="flex items-center gap-[2%]">
                <Droplets style={{ width: '0.45em', height: '0.45em', color: 'rgba(255,255,255,0.4)' }} />
                <span style={{ fontSize: '0.42em', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>{weather.humidity}%</span>
              </div>
              <div className="flex items-center gap-[2%]">
                <Wind style={{ width: '0.45em', height: '0.45em', color: 'rgba(255,255,255,0.4)' }} />
                <span style={{ fontSize: '0.42em', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>{weather.wind} mph</span>
              </div>
              <div className="flex items-center gap-[2%]">
                <Thermometer style={{ width: '0.45em', height: '0.45em', color: 'rgba(255,255,255,0.4)' }} />
                <span style={{ fontSize: '0.42em', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>Feels {weather.feelsLike}°</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// COUNTDOWN — Animated flip-style countdown
// ═══════════════════════════════════════════════════════

function CountdownWidget({ config, compact }: { config: any; compact: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const target = config.targetDate ? new Date(config.targetDate + 'T00:00:00') : new Date(Date.now() + 30 * 86400000);
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const label = config.label || 'Days Remaining';

  const digitBox = (val: number, lbl: string) => (
    <div className="flex flex-col items-center">
      <div style={{
        background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: compact ? 4 : 8,
        padding: compact ? '0.2em 0.4em' : '0.3em 0.6em',
        minWidth: compact ? '1.8em' : '2.5em',
        textAlign: 'center' as const,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
      }}>
        <span style={{ fontSize: compact ? '1.2em' : '2.2em', fontWeight: 800, color: 'white', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {val.toString().padStart(2, '0')}
        </span>
      </div>
      <span style={{ fontSize: compact ? '0.35em' : '0.5em', fontWeight: 600, color: '#64748b', marginTop: '0.3em', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
        {lbl}
      </span>
    </div>
  );

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden" style={{ background: 'linear-gradient(135deg, #f8fafc, #e2e8f0)' }}>
      {!compact && (
        <div style={{ fontSize: '0.6em', fontWeight: 700, color: '#475569', marginBottom: '0.6em', textTransform: 'uppercase' as const, letterSpacing: '0.1em' }}>
          {label}
        </div>
      )}
      <div className="flex items-center" style={{ gap: compact ? '0.3em' : '0.5em' }}>
        {digitBox(days, 'Days')}
        <span style={{ fontSize: compact ? '1em' : '1.8em', fontWeight: 800, color: '#cbd5e1', lineHeight: 1 }}>:</span>
        {digitBox(hours, 'Hrs')}
        <span style={{ fontSize: compact ? '1em' : '1.8em', fontWeight: 800, color: '#cbd5e1', lineHeight: 1 }}>:</span>
        {digitBox(mins, 'Min')}
        {!compact && (
          <>
            <span style={{ fontSize: '1.8em', fontWeight: 800, color: '#cbd5e1', lineHeight: 1 }}>:</span>
            {digitBox(secs, 'Sec')}
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// TEXT — Renders actual styled text
// ═══════════════════════════════════════════════════════

function TextWidget({ config }: { config: any }) {
  const content = config.content || 'Your text here';
  const fontSize = config.fontSize || 24;
  const alignment = config.alignment || 'center';
  const color = config.color || '#1e293b';
  const bgColor = config.bgColor || 'transparent';

  return (
    <div className="absolute inset-0 flex items-center justify-center p-[5%] overflow-hidden" style={{ backgroundColor: bgColor }}>
      <p style={{
        fontSize: `${Math.min(fontSize / 16, 3)}em`,
        fontWeight: 600,
        color,
        textAlign: alignment as any,
        lineHeight: 1.4,
        width: '100%',
        wordWrap: 'break-word' as const,
      }}>
        {content}
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ANNOUNCEMENT — Priority-styled announcement
// ═══════════════════════════════════════════════════════

function AnnouncementWidget({ config, compact }: { config: any; compact: boolean }) {
  const message = config.message || 'Important announcement will appear here';
  const priority = config.priority || 'normal';

  const themes: Record<string, { bg: string; accent: string; icon: string; text: string; badge: string }> = {
    low:    { bg: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)', accent: '#0ea5e9', icon: '#0284c7', text: '#0c4a6e', badge: '#bae6fd' },
    normal: { bg: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', accent: '#22c55e', icon: '#16a34a', text: '#14532d', badge: '#bbf7d0' },
    high:   { bg: 'linear-gradient(135deg, #fffbeb, #fef3c7)', accent: '#f59e0b', icon: '#d97706', text: '#78350f', badge: '#fde68a' },
    urgent: { bg: 'linear-gradient(135deg, #fef2f2, #fecaca)', accent: '#ef4444', icon: '#dc2626', text: '#7f1d1d', badge: '#fca5a5' },
  };
  const t = themes[priority] || themes.normal;

  return (
    <div className="absolute inset-0 flex overflow-hidden" style={{ background: t.bg }}>
      {/* Accent bar */}
      <div style={{ width: '3%', minWidth: 3, background: t.accent, flexShrink: 0 }} />
      <div className="flex-1 flex flex-col justify-center px-[5%] py-[4%]">
        <div className="flex items-center gap-[3%] mb-[3%]">
          <Megaphone style={{ width: compact ? '0.8em' : '1.1em', height: compact ? '0.8em' : '1.1em', color: t.icon }} />
          <span style={{
            fontSize: compact ? '0.4em' : '0.55em', fontWeight: 800,
            textTransform: 'uppercase' as const, letterSpacing: '0.1em',
            color: t.icon, background: t.badge, padding: '0.15em 0.5em', borderRadius: 99,
          }}>
            {priority}
          </span>
        </div>
        <p style={{
          fontSize: compact ? '0.65em' : '1em',
          fontWeight: 600, color: t.text, lineHeight: 1.5,
          display: '-webkit-box', WebkitLineClamp: compact ? 2 : 4, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
        }}>
          {message}
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// TICKER — Animated scrolling marquee
// ═══════════════════════════════════════════════════════

function TickerWidget({ config }: { config: any }) {
  const messages = config.messages?.length ? config.messages : ['Welcome to our school!', 'Stay tuned for updates', 'Have a great day!'];
  const speed = config.speed === 'slow' ? 40 : config.speed === 'fast' ? 15 : 25;
  const text = messages.join('     •     ');
  const repeated = `${text}     •     ${text}`;

  return (
    <div className="absolute inset-0 flex items-center overflow-hidden" style={{ background: 'linear-gradient(90deg, #1e293b, #334155)' }}>
      <div style={{
        display: 'flex', whiteSpace: 'nowrap' as const,
        animation: `ticker-scroll ${speed}s linear infinite`,
      }}>
        <span style={{ fontSize: '0.85em', fontWeight: 600, color: '#fbbf24', paddingLeft: '100%' }}>
          {repeated}
        </span>
      </div>
      <style>{`@keyframes ticker-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// BELL SCHEDULE — Beautiful schedule display
// ═══════════════════════════════════════════════════════

function BellScheduleWidget({ config, compact }: { config: any; compact: boolean }) {
  const schedule = config.schedule || 'Period 1: 8:00 - 8:50\nPeriod 2: 8:55 - 9:45\nPeriod 3: 9:50 - 10:40\nLunch: 10:45 - 11:15\nPeriod 4: 11:20 - 12:10\nPeriod 5: 12:15 - 1:05\nPeriod 6: 1:10 - 2:00';
  const lines = schedule.split('\n').filter(Boolean);
  const now = new Date();
  const currentHour = now.getHours();

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #eef2ff, #e0e7ff)' }}>
      <div style={{
        background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
        padding: compact ? '3% 5%' : '4% 6%',
        display: 'flex', alignItems: 'center', gap: '3%',
      }}>
        <Bell style={{ width: compact ? '0.6em' : '0.8em', height: compact ? '0.6em' : '0.8em', color: 'white' }} />
        <span style={{ fontSize: compact ? '0.5em' : '0.7em', fontWeight: 700, color: 'white', letterSpacing: '0.05em' }}>Bell Schedule</span>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ padding: '3% 5%' }}>
        {lines.map((line: string, i: number) => {
          const isActive = i === Math.min(Math.floor((currentHour - 8) / 1), lines.length - 1) && currentHour >= 8 && currentHour < 15;
          return (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: compact ? '2% 3%' : '3% 4%',
              borderRadius: 6,
              marginBottom: '1%',
              background: isActive ? 'rgba(99,102,241,0.1)' : 'transparent',
              borderLeft: isActive ? '3px solid #6366f1' : '3px solid transparent',
            }}>
              <span style={{
                fontSize: compact ? '0.4em' : '0.58em',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#4338ca' : '#475569',
              }}>
                {line}
              </span>
              {isActive && <span style={{ fontSize: '0.35em', fontWeight: 700, color: '#6366f1', background: '#e0e7ff', padding: '0.1em 0.4em', borderRadius: 99 }}>NOW</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// LUNCH MENU — Styled cafeteria menu
// ═══════════════════════════════════════════════════════

function LunchMenuWidget({ config, compact }: { config: any; compact: boolean }) {
  const menu = config.menu || 'Monday: Pizza, Garden Salad, Fruit Cup\nTuesday: Chicken Tacos, Spanish Rice\nWednesday: Pasta Bar, Garlic Bread\nThursday: Grilled Chicken, Mashed Potatoes\nFriday: Burgers, Fries, Coleslaw';
  const lines = menu.split('\n').filter(Boolean);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #f0fdf4, #dcfce7)' }}>
      <div style={{
        background: 'linear-gradient(135deg, #16a34a, #22c55e)',
        padding: compact ? '3% 5%' : '4% 6%',
        display: 'flex', alignItems: 'center', gap: '3%',
      }}>
        <UtensilsCrossed style={{ width: compact ? '0.6em' : '0.8em', height: compact ? '0.6em' : '0.8em', color: 'white' }} />
        <span style={{ fontSize: compact ? '0.5em' : '0.7em', fontWeight: 700, color: 'white' }}>Lunch Menu</span>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ padding: '3% 5%' }}>
        {lines.map((line: string, i: number) => {
          const isToday = line.toLowerCase().startsWith(today.toLowerCase());
          const [day, ...rest] = line.split(':');
          return (
            <div key={i} style={{
              padding: compact ? '2% 3%' : '3% 4%',
              borderRadius: 6, marginBottom: '1%',
              background: isToday ? 'rgba(34,197,94,0.1)' : 'transparent',
              borderLeft: isToday ? '3px solid #22c55e' : '3px solid transparent',
            }}>
              <div style={{ fontSize: compact ? '0.4em' : '0.55em', fontWeight: 700, color: isToday ? '#15803d' : '#475569' }}>{day}</div>
              {rest.length > 0 && <div style={{ fontSize: compact ? '0.35em' : '0.48em', color: '#64748b', marginTop: '0.1em' }}>{rest.join(':').trim()}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// CALENDAR — Events display
// ═══════════════════════════════════════════════════════

function CalendarWidget({ config, compact }: { config: any; compact: boolean }) {
  const maxEvents = config.maxEvents || 5;
  const now = new Date();
  // Sample events for preview
  const events = [
    { title: 'Spring Assembly', date: 'Today, 10:00 AM', color: '#6366f1' },
    { title: 'PTA Meeting', date: 'Tomorrow, 6:30 PM', color: '#f59e0b' },
    { title: 'Science Fair', date: `${now.toLocaleDateString('en-US', { month: 'short' })} ${now.getDate() + 3}`, color: '#22c55e' },
    { title: 'Staff Development Day', date: `${now.toLocaleDateString('en-US', { month: 'short' })} ${now.getDate() + 7}`, color: '#ec4899' },
    { title: 'Spring Break Begins', date: `${now.toLocaleDateString('en-US', { month: 'short' })} ${now.getDate() + 14}`, color: '#0ea5e9' },
  ].slice(0, maxEvents);

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #eff6ff, #dbeafe)' }}>
      <div style={{
        background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
        padding: compact ? '3% 5%' : '4% 6%',
        display: 'flex', alignItems: 'center', gap: '3%',
      }}>
        <CalendarDays style={{ width: compact ? '0.6em' : '0.8em', height: compact ? '0.6em' : '0.8em', color: 'white' }} />
        <span style={{ fontSize: compact ? '0.5em' : '0.7em', fontWeight: 700, color: 'white' }}>Upcoming Events</span>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ padding: '3% 4%' }}>
        {events.map((ev, i) => (
          <div key={i} className="flex items-center" style={{ padding: compact ? '2% 2%' : '3% 3%', gap: '4%', borderBottom: i < events.length - 1 ? '1px solid #e2e8f0' : 'none' }}>
            <div style={{ width: compact ? 4 : 6, height: compact ? 4 : 6, borderRadius: 99, background: ev.color, flexShrink: 0 }} />
            <div className="min-w-0 flex-1">
              <div style={{ fontSize: compact ? '0.4em' : '0.58em', fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.title}</div>
              <div style={{ fontSize: compact ? '0.3em' : '0.45em', color: '#94a3b8', fontWeight: 500 }}>{ev.date}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// STAFF SPOTLIGHT
// ═══════════════════════════════════════════════════════

function StaffSpotlightWidget({ config, compact }: { config: any; compact: boolean }) {
  const name = config.staffName || 'Mrs. Johnson';
  const role = config.role || 'Teacher of the Month';
  const bio = config.bio || 'Inspiring students every day with creativity and passion for learning.';

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden" style={{ background: 'linear-gradient(135deg, #fdf4ff, #fae8ff, #f5f3ff)' }}>
      <div style={{
        width: compact ? '2em' : '3.5em', height: compact ? '2em' : '3.5em',
        borderRadius: 999, background: 'linear-gradient(135deg, #a855f7, #6366f1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 20px rgba(168,85,247,0.3)',
        marginBottom: '0.4em',
      }}>
        {config.photoUrl ? (
          <img src={resolveUrl(config.photoUrl)} style={{ width: '100%', height: '100%', borderRadius: 999, objectFit: 'cover' }} />
        ) : (
          <Users style={{ width: '50%', height: '50%', color: 'white' }} />
        )}
      </div>
      <div style={{ fontSize: compact ? '0.6em' : '0.9em', fontWeight: 800, color: '#581c87', textAlign: 'center' as const }}>{name}</div>
      <div style={{ fontSize: compact ? '0.35em' : '0.5em', fontWeight: 600, color: '#a855f7', marginTop: '0.1em', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>{role}</div>
      {!compact && (
        <p style={{ fontSize: '0.5em', color: '#6b7280', textAlign: 'center' as const, maxWidth: '80%', marginTop: '0.4em', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' }}>
          {bio}
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MEDIA WIDGETS — Image, Video, Carousel, Logo
// ═══════════════════════════════════════════════════════

function ImageWidget({ config }: { config: any }) {
  if (config.assetUrl) {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <img src={resolveUrl(config.assetUrl)} alt="" className="w-full h-full" style={{ objectFit: config.fitMode || 'cover' }} />
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)' }}>
      <ImageIcon style={{ width: '2em', height: '2em', color: '#93c5fd', opacity: 0.5 }} />
      <span style={{ fontSize: '0.5em', color: '#93c5fd', fontWeight: 600, marginTop: '0.3em' }}>Add Image</span>
    </div>
  );
}

function ImageCarouselWidget({ config }: { config: any }) {
  const urls = config.assetUrls || [];
  const [idx, setIdx] = useState(0);
  const interval = config.intervalMs || 5000;

  useEffect(() => {
    if (urls.length < 2) return;
    const t = setInterval(() => setIdx(i => (i + 1) % urls.length), interval);
    return () => clearInterval(t);
  }, [urls.length, interval]);

  if (urls.length > 0) {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <img src={resolveUrl(urls[idx % urls.length])} alt="" className="w-full h-full transition-opacity duration-500" style={{ objectFit: config.fitMode || 'cover' }} />
        {urls.length > 1 && (
          <div className="absolute bottom-[5%] left-1/2 -translate-x-1/2 flex gap-1">
            {urls.map((_: string, i: number) => (
              <div key={i} style={{ width: 6, height: 6, borderRadius: 99, background: i === idx % urls.length ? 'white' : 'rgba(255,255,255,0.4)', transition: 'background 0.3s' }} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)' }}>
      <ImageIcon style={{ width: '2em', height: '2em', color: '#93c5fd', opacity: 0.5 }} />
      <span style={{ fontSize: '0.5em', color: '#93c5fd', fontWeight: 600, marginTop: '0.3em' }}>Add Photos</span>
    </div>
  );
}

function VideoWidget({ config, live }: { config: any; live?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shouldAutoplay = live && (config.autoplay !== false);  // default true in live mode
  const shouldLoop = config.loop !== false;                     // default true
  const shouldMute = config.muted !== false;                    // default true (required for autoplay)

  // Force autoplay when in live mode — browsers require muted for autoplay
  useEffect(() => {
    if (shouldAutoplay && videoRef.current) {
      videoRef.current.play().catch(() => {
        // Autoplay blocked — try muted
        if (videoRef.current) {
          videoRef.current.muted = true;
          videoRef.current.play().catch(() => {});
        }
      });
    }
  }, [shouldAutoplay, config.assetUrl]);

  if (config.assetUrl) {
    return (
      <div className="absolute inset-0 overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={resolveUrl(config.assetUrl)}
          className="w-full h-full"
          style={{ objectFit: config.fitMode || 'contain' }}
          autoPlay={shouldAutoplay}
          muted={shouldMute}
          loop={shouldLoop}
          preload={live ? 'auto' : 'metadata'}
          playsInline
        />
        {/* Play button overlay — only show in editor preview, not on live player */}
        {!live && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div style={{
              width: '2.5em', height: '2.5em', borderRadius: 999,
              background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Play style={{ width: '1em', height: '1em', color: 'white', marginLeft: '0.1em' }} />
            </div>
          </div>
        )}
        {/* Name badge — only in editor */}
        {!live && config.assetName && (
          <div className="absolute bottom-[5%] left-[5%] right-[5%]">
            <div style={{
              background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
              borderRadius: 6, padding: '0.2em 0.4em',
              fontSize: '0.4em', color: 'rgba(255,255,255,0.8)', fontWeight: 500,
              whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {config.assetName}
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'linear-gradient(135deg, #faf5ff, #f3e8ff)' }}>
      <div style={{ width: '2.5em', height: '2.5em', borderRadius: 999, background: 'linear-gradient(135deg, #8b5cf6, #a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 15px rgba(139,92,246,0.3)' }}>
        <Play style={{ width: '1em', height: '1em', color: 'white', marginLeft: '0.15em' }} />
      </div>
      <span style={{ fontSize: '0.5em', color: '#a78bfa', fontWeight: 600, marginTop: '0.3em' }}>Add Video</span>
    </div>
  );
}

function LogoWidget({ config }: { config: any }) {
  if (config.assetUrl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-[8%]">
        <img src={resolveUrl(config.assetUrl)} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)' }}>
      <Shield style={{ width: '2em', height: '2em', color: '#818cf8', opacity: 0.5 }} />
      <span style={{ fontSize: '0.5em', color: '#818cf8', fontWeight: 600, marginTop: '0.3em' }}>Add Logo</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// WEB / CONTENT WIDGETS
// ═══════════════════════════════════════════════════════

function WebpageWidget({ config, live }: { config: any; live?: boolean }) {
  // Auto-prefix bare domains with https://
  const rawUrl = config.url || '';
  const url = rawUrl && !rawUrl.startsWith('http://') && !rawUrl.startsWith('https://') && !rawUrl.startsWith('//')
    ? `https://${rawUrl}`
    : rawUrl;
  const refreshInterval = config.refreshIntervalMs || 0;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // In live mode, route through our API proxy to bypass X-Frame-Options / CSP
  // so any website can be embedded in digital signage screens
  const proxyUrl = useMemo(() => {
    if (!live || !url) return '';
    return `${API_BASE}/api/v1/proxy/web?url=${encodeURIComponent(url)}`;
  }, [live, url]);

  // Auto-refresh the iframe at the configured interval
  useEffect(() => {
    if (!live || !proxyUrl || !refreshInterval || refreshInterval < 5000) return;
    const t = setInterval(() => {
      if (iframeRef.current) {
        iframeRef.current.src = proxyUrl;
      }
    }, refreshInterval);
    return () => clearInterval(t);
  }, [live, proxyUrl, refreshInterval]);

  // Live mode — render an actual iframe routed through proxy
  // No sandbox attribute — the proxy already strips X-Frame-Options and injects
  // anti-frame-busting code. Sandbox would break many sites' internal scripts.
  if (live && proxyUrl) {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <iframe
          ref={iframeRef}
          src={proxyUrl}
          className="w-full h-full border-0"
          style={{ overflow: config.scrollEnabled ? 'auto' : 'hidden' }}
          allow="autoplay; encrypted-media"
          loading="eager"
          title="Web content"
        />
      </div>
    );
  }

  // Editor preview — show browser mockup
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: '#f8fafc' }}>
      {/* Browser chrome */}
      <div style={{ background: '#f1f5f9', padding: '2% 3%', display: 'flex', alignItems: 'center', gap: '2%', borderBottom: '1px solid #e2e8f0' }}>
        <div className="flex gap-[2px]">
          <div style={{ width: 5, height: 5, borderRadius: 99, background: '#fca5a5' }} />
          <div style={{ width: 5, height: 5, borderRadius: 99, background: '#fcd34d' }} />
          <div style={{ width: 5, height: 5, borderRadius: 99, background: '#86efac' }} />
        </div>
        <div style={{ flex: 1, background: 'white', borderRadius: 4, padding: '1% 3%', fontSize: '0.35em', color: '#94a3b8', overflow: 'hidden', whiteSpace: 'nowrap' as const, textOverflow: 'ellipsis' }}>
          {url || 'https://...'}
        </div>

      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Globe style={{ width: '1.5em', height: '1.5em', color: '#10b981', opacity: 0.4, margin: '0 auto' }} />
          <div style={{ fontSize: '0.45em', color: '#94a3b8', marginTop: '0.3em' }}>{url ? 'Web content will load here' : 'Set URL in properties'}</div>
        </div>
      </div>
    </div>
  );
}

function RSSWidget({ config, compact }: { config: any; compact: boolean }) {
  const maxItems = config.maxItems || 5;
  const items = [
    { title: 'School District Announces New STEM Program', time: '2h ago' },
    { title: 'Local Students Win State Science Competition', time: '4h ago' },
    { title: 'Spring Sports Season Registration Opens', time: '6h ago' },
    { title: 'Board Meeting Highlights: Budget Approved', time: '1d ago' },
    { title: 'Community Service Day This Saturday', time: '1d ago' },
  ].slice(0, maxItems);

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #fff7ed, #ffedd5)' }}>
      <div style={{
        background: 'linear-gradient(135deg, #ea580c, #f97316)',
        padding: compact ? '3% 5%' : '4% 6%',
        display: 'flex', alignItems: 'center', gap: '3%',
      }}>
        <Rss style={{ width: compact ? '0.6em' : '0.8em', height: compact ? '0.6em' : '0.8em', color: 'white' }} />
        <span style={{ fontSize: compact ? '0.5em' : '0.7em', fontWeight: 700, color: 'white' }}>News Feed</span>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ padding: '3% 4%' }}>
        {items.map((item, i) => (
          <div key={i} style={{ padding: compact ? '2% 2%' : '3% 2%', borderBottom: i < items.length - 1 ? '1px solid #fed7aa' : 'none' }}>
            <div style={{ fontSize: compact ? '0.4em' : '0.55em', fontWeight: 600, color: '#1e293b', lineHeight: 1.4 }}>{item.title}</div>
            <div style={{ fontSize: compact ? '0.3em' : '0.4em', color: '#94a3b8', marginTop: '0.15em' }}>{item.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SocialWidget({ config }: { config: any }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'linear-gradient(135deg, #fdf2f8, #fce7f3)' }}>
      <Share2 style={{ width: '1.5em', height: '1.5em', color: '#ec4899', opacity: 0.4 }} />
      <span style={{ fontSize: '0.45em', color: '#f472b6', fontWeight: 600, marginTop: '0.3em' }}>Social Feed</span>
      {config.embedUrl && <span style={{ fontSize: '0.35em', color: '#94a3b8', marginTop: '0.15em' }}>Connected</span>}
    </div>
  );
}

function PlaylistWidget({ config }: { config: any }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)' }}>
      <Play style={{ width: '2em', height: '2em', color: '#8b5cf6', opacity: 0.5 }} />
      <span style={{ fontSize: '0.5em', color: '#8b5cf6', fontWeight: 600, marginTop: '0.3em' }}>
        {config.playlistId ? 'Playlist Assigned' : 'Assign Playlist'}
      </span>
    </div>
  );
}
