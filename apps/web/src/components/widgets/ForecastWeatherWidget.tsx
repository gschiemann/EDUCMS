import { useElementSize } from './v2/_shared/useElementSize';
import { Cloud, CloudRain, CloudSnow, CloudSun, CloudLightning, Sun, Wind } from 'lucide-react';
import { usePolledFeed } from './use-live-feed';
import { useRenderSurface } from './render-surface';
import { SampleStamp } from './v2/_shared/live-data-truth';

interface Day { date: string; high: number; low: number | null; condition: string; rain: number | null }
interface Forecast { location: string; days: Day[]; fetchedAt: string; source: string; geocoded: boolean }
const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace(/\/$/, '');
export const forecastDayCount = (value: unknown) => Math.max(2, Math.min(5, Math.round(Number(value) || 5)));
function weatherIcon(condition: string) {
  if (/thunder|storm/i.test(condition)) return CloudLightning;
  if (/snow|ice|sleet/i.test(condition)) return CloudSnow;
  if (/rain|shower|drizzle/i.test(condition)) return CloudRain;
  if (/partly|mostly sunny/i.test(condition)) return CloudSun;
  if (/cloud|fog/i.test(condition)) return Cloud;
  if (/wind/i.test(condition)) return Wind;
  return Sun;
}
export function ForecastWeatherWidget({ config = {} }: { config?: Record<string, any> }) {
  const count = forecastDayCount(config.forecastDays);
  const location = String(config.location || config.zipCode || '').trim();
  const metric = ['metric', 'celsius', 'c'].includes(String(config.units || '').toLowerCase());
  const url = `${API}/feeds/forecast?location=${encodeURIComponent(location)}&units=${metric ? 'metric' : 'imperial'}`;
  const { data, loading, error } = usePolledFeed<Forecast>(!!location, () => url, 15 * 60 * 1000, 60 * 60 * 1000);
  const player = useRenderSurface() === 'player';
  const { ref: root, width, height } = useElementSize<HTMLDivElement>();
  const size = { w: width || 1000, h: height || 400 };
  const sample = !data && !player;
  const samples: Day[] = Array.from({ length: count }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10), high: metric ? 23 + i : 74 + i, low: metric ? 16 + i : 60 + i, condition: i % 2 ? 'Partly cloudy' : 'Sunny', rain: i % 2 ? 20 : 0 }));
  const days = data?.days.slice(0, count) || (sample ? samples : []);
  const cols = size.w / size.h < 1.4 ? Math.min(2, count) : count;
  const rows = Math.ceil(count / cols);
  const font = Math.max(6, Math.min(128, size.w / (cols * 7), size.h / (rows * 9 + 6)) * .85);
  const bg = config.style?.bgColor || config.bgColor || '#102b3c', ink = config.style?.textColor || config.textColor || '#f1f7f9';
  return <div ref={root} data-weather-outlook data-days={count} style={{ width: '100%', height: '100%', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', padding: '1.2em', rowGap: '.8em', overflow: 'hidden', position: 'relative', background: bg, color: ink, fontFamily: config.style?.fontFamily || 'Inter, sans-serif', fontSize: font, boxSizing: 'border-box' }}>
    <header style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', justifyContent: 'space-between', alignItems: 'baseline', columnGap: '1em' }}><div><div style={{ fontSize: '.65em', opacity: .65, textTransform: 'uppercase', letterSpacing: '.15em' }}>{count}-day outlook</div><div style={{ fontWeight: 650, fontSize: '1.05em', overflowWrap: 'anywhere' }}>{data?.location || location || 'Local forecast'}</div></div><span style={{ fontSize: '.7em', opacity: .7 }}>{metric ? '°C' : '°F'}</span></header>
    {days.length ? <div data-forecast-grid style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, rowGap: '.55em', columnGap: '.55em' }}>{days.map((d, i) => { const Icon = weatherIcon(d.condition); return <article key={d.date} data-forecast-day style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '.7em', borderRadius: '.35em', background: '#ffffff0d', borderTop: '2px solid #8ec9e4',  overflow: 'hidden' }}>
      <div style={{ fontWeight: 650 }}>{sample ? ['Mon','Tue','Wed','Thu','Fri'][i] : new Date(d.date + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}<div style={{ opacity: .55, fontSize: '.6em', fontWeight: 400 }}>{sample ? 'Sample' : new Date(d.date + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}</div></div>
      <Icon aria-hidden style={{ width: '1.7em', height: '1.7em', color: '#b3dcf0', flexShrink: 0 }} strokeWidth={1.3} />
      <div style={{ fontSize: '.63em', lineHeight: 1.2, overflowWrap: 'anywhere' }}>{d.condition}</div>
      <div><span style={{ fontSize: '1.3em', fontWeight: 600 }}>{d.high}°</span> <span style={{ opacity: .6 }}>{d.low == null ? '—' : `${d.low}°`}</span><div style={{ fontSize: '.52em', opacity: .6 }}>High / Low{d.rain != null ? ` · ${d.rain}% rain` : ''}</div></div>
    </article>; })}</div> : <div role="status" style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: '.8em' }}>{!location ? 'Set a U.S. city or ZIP code' : loading ? 'Loading forecast…' : 'Forecast temporarily unavailable'}</div>}
    <footer style={{ display: 'block', fontSize: '.45em', opacity: .7 }}><a href="https://www.weather.gov/" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', marginRight: '.7em' }}>National Weather Service</a>{data?.geocoded && <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', marginRight: '.7em' }}>© OpenStreetMap contributors</a>}{data && <span>{error ? 'Refresh delayed · ' : ''}Refreshed {new Date(data.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}</footer>
    {sample && <SampleStamp />}
  </div>;
}
