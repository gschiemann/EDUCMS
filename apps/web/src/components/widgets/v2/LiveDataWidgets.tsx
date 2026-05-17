"use client";
/**
 * VenueOS · Live Data widgets — universal across every vertical.
 * Ported 1:1 from industry-widget-pack/lib/widgets-live-data.jsx.
 * "Live data" is rendered from `config` fields with sample defaults —
 * no network calls; the real fetch happens server-side per widget.
 */
import React from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

/* ════════════════ SPORTS SCOREBOARD ════════════════ */

export interface ScoreTeam { name: string; score: number; logo?: string; }
export interface ScoreGame {
  status: string;
  clock?: string;
  kickoff?: string;
  venue?: string;
  away: ScoreTeam;
  home: ScoreTeam;
}
export interface SportsScoreboardCfg extends BaseCfg {
  league?: string;
  refreshSec?: number;
  accent?: string;
  games?: ScoreGame[];
}

const DEFAULT_GAMES: ScoreGame[] = [
  { status: 'LIVE', clock: 'Q3 4:21', away: { name: 'Lakers', score: 78, logo: '#552583' }, home: { name: 'Celtics', score: 82, logo: '#007a33' } },
  { status: 'LIVE', clock: 'Q2 1:08', away: { name: 'Warriors', score: 54, logo: '#1d428a' }, home: { name: 'Nuggets', score: 49, logo: '#fec524' } },
  { status: 'FINAL', clock: '', away: { name: 'Heat', score: 102, logo: '#98002e' }, home: { name: 'Knicks', score: 108, logo: '#f58426' } },
  { status: '7:00 PM', clock: '', away: { name: 'Bucks', score: 0, logo: '#00471b' }, home: { name: 'Sixers', score: 0, logo: '#006bb6' } },
];

function ScoreboardTeam({ name, score, logo, accent, winning, height }: { name: string; score: number; logo?: string; accent: string; winning: boolean; height: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${px(height, 0.011)}px 0` }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ width: px(height, 0.052), height: px(height, 0.052), borderRadius: px(height, 0.011), background: logo || '#243042', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: px(height, 0.022), marginRight: px(height, 0.017) }}>{name.split(' ').slice(-1)[0].slice(0, 3).toUpperCase()}</div>
        <div style={{ color: '#fff', fontWeight: winning ? 800 : 600, fontSize: px(height, 0.031) }}>{name}</div>
      </div>
      <div style={{ color: winning ? accent : '#cfd8e3', fontWeight: 800, fontSize: px(height, 0.05), fontFamily: 'JetBrains Mono', letterSpacing: '-0.02em' }}>{score}</div>
    </div>
  );
}

export function SportsScoreboardWidget({ config, live = true, height = 480 }: WidgetProps<SportsScoreboardCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#11171f', textColor: '#ffd23a', accentColor: '#e7142b', ...c.style });
  const games = c.games ?? DEFAULT_GAMES;
  const accent = c.accent ?? '#ffd23a';
  const league = c.league ?? 'NBA';

  return (
    <div style={{ ...frameStyle(r), padding: 0, backgroundColor: '#0b0f15' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${px(height, 0.037)}px ${px(height, 0.056)}px`, borderBottom: '1px solid #1f2630' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: px(height, 0.017), height: px(height, 0.017), borderRadius: '50%', background: '#e7142b', boxShadow: '0 0 0 6px #e7142b22', marginRight: px(height, 0.022) }} />
            <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.043), fontFamily: 'Plus Jakarta Sans', letterSpacing: '-0.02em', marginRight: px(height, 0.022) }}>LIVE SCOREBOARD</div>
            <div style={{ color: '#8aa', fontSize: px(height, 0.022), fontWeight: 600 }}>{league.toUpperCase()}</div>
          </div>
          <div style={{ color: '#8aa', fontSize: px(height, 0.022), fontWeight: 600, fontFamily: 'JetBrains Mono' }}>7:00 PM ET</div>
        </div>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', padding: px(height, 0.056) }}>
          {games.slice(0, 4).map((g, i) => (
            <div key={i} style={{ background: '#11171f', border: '1px solid #1f2630', borderRadius: px(height, 0.017), padding: `${px(height, 0.028)}px ${px(height, 0.033)}px`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0, margin: px(height, 0.014) }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ width: px(height, 0.0093), height: px(height, 0.0093), borderRadius: '50%', background: g.status === 'LIVE' ? '#e7142b' : '#445', display: 'inline-block', boxShadow: g.status === 'LIVE' ? '0 0 0 4px #e7142b22' : 'none', marginRight: px(height, 0.011) }} />
                  <span style={{ color: g.status === 'LIVE' ? '#ff5664' : '#8aa', fontWeight: 700, fontSize: px(height, 0.0185), letterSpacing: '0.06em' }}>{g.status}</span>
                  <span style={{ color: '#8aa', fontWeight: 600, fontSize: px(height, 0.0185), marginLeft: px(height, 0.0056) }}>{g.clock || g.kickoff || ''}</span>
                </div>
                <span style={{ color: '#8aa', fontWeight: 600, fontSize: px(height, 0.0185) }}>{g.venue || ''}</span>
              </div>
              <ScoreboardTeam name={g.away.name} score={g.away.score} logo={g.away.logo} accent={accent} winning={g.away.score > g.home.score} height={height} />
              <ScoreboardTeam name={g.home.name} score={g.home.score} logo={g.home.logo} accent={accent} winning={g.home.score > g.away.score} height={height} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ STOCK TICKER ════════════════ */

export interface StockSymbol { symbol: string; price: number; change: number; pct: number; }
export interface StockTickerCfg extends BaseCfg {
  symbols?: StockSymbol[];
  exchange?: string;
  refreshSec?: number;
  showSparkline?: boolean;
}

const DEFAULT_STOCKS: StockSymbol[] = [
  { symbol: 'AAPL', price: 232.18, change: +2.41, pct: +1.05 },
  { symbol: 'MSFT', price: 449.92, change: -1.62, pct: -0.36 },
  { symbol: 'NVDA', price: 132.55, change: +5.12, pct: +4.02 },
  { symbol: 'GOOGL', price: 178.24, change: +0.84, pct: +0.47 },
  { symbol: 'AMZN', price: 198.66, change: -2.10, pct: -1.04 },
  { symbol: 'TSLA', price: 312.05, change: +12.6, pct: +4.20 },
  { symbol: 'META', price: 588.41, change: +6.31, pct: +1.08 },
  { symbol: 'JPM', price: 251.07, change: -0.93, pct: -0.37 },
];

export function StockTickerWidget({ config, live = true, height = 480 }: WidgetProps<StockTickerCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0d12', textColor: '#22d39b', accentColor: '#22d39b', ...c.style });
  const symbols = c.symbols ?? DEFAULT_STOCKS;
  const exchange = c.exchange ?? 'NYSE / NASDAQ';
  const scrollDur = animDurationSec(r.anim.speed, 30);

  return (
    <div style={{ ...frameStyle(r), padding: 0, backgroundColor: '#0a0d12' }}>
      <style>{`@keyframes ldw_tickerScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: `${px(height, 0.044)}px ${px(height, 0.056)}px ${px(height, 0.022)}px` }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', color: '#fff', fontSize: px(height, 0.05), fontWeight: 800, letterSpacing: '-0.02em' }}>Markets</div>
          <div style={{ color: '#7d8a98', fontSize: px(height, 0.022), fontWeight: 600, marginTop: px(height, 0.0074) }}>{exchange} · delayed 15 min</div>
        </div>
        <div style={{ flex: 1, padding: `${px(height, 0.028)}px ${px(height, 0.056)}px ${px(height, 0.037)}px`, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {symbols.slice(0, 8).map((s, i) => {
            const up = s.change >= 0;
            return (
              <div key={i} style={{ background: '#11161e', border: '1px solid #1d2530', borderRadius: px(height, 0.013), padding: `${px(height, 0.02)}px ${px(height, 0.022)}px`, margin: px(height, 0.011) }}>
                <div style={{ color: '#7d8a98', fontWeight: 600, fontSize: px(height, 0.0167), letterSpacing: '0.08em' }}>{s.symbol}</div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: px(height, 0.039), fontFamily: 'JetBrains Mono', marginTop: px(height, 0.0056) }}>{s.price.toFixed(2)}</div>
                <div style={{ display: 'flex', alignItems: 'center', marginTop: px(height, 0.0056), color: up ? '#22d39b' : '#ff5664', fontWeight: 700, fontSize: px(height, 0.0204) }}>
                  <span style={{ marginRight: px(height, 0.0074) }}>{up ? '▲' : '▼'}</span>
                  <span style={{ marginRight: px(height, 0.0074) }}>{up ? '+' : ''}{s.change.toFixed(2)}</span>
                  <span style={{ opacity: .7 }}>({up ? '+' : ''}{s.pct.toFixed(2)}%)</span>
                </div>
              </div>
            );
          })}
        </div>
        {/* Scrolling band */}
        <div style={{ height: px(height, 0.074), borderTop: '1px solid #1d2530', background: '#0f141c', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
          <div style={{ display: 'flex', whiteSpace: 'nowrap', willChange: 'transform', animation: live ? `ldw_tickerScroll ${scrollDur}s linear infinite` : 'none' }}>
            {[...symbols, ...symbols].map((s, i) => (
              <span key={i} style={{ color: '#cfd8e3', fontSize: px(height, 0.022), fontWeight: 600, fontFamily: 'JetBrains Mono', marginRight: px(height, 0.056) }}>
                {s.symbol} <span style={{ marginLeft: px(height, 0.0074), marginRight: px(height, 0.0074) }}>{s.price.toFixed(2)}</span>
                <span style={{ color: s.change >= 0 ? '#22d39b' : '#ff5664' }}>{s.change >= 0 ? '+' : ''}{s.pct.toFixed(2)}%</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ CRYPTO TICKER ════════════════ */

export interface CryptoCoin { name: string; symbol: string; price: number; pct: number; color: string; }
export interface CryptoTickerCfg extends BaseCfg {
  coins?: CryptoCoin[];
  currency?: string;
  refreshSec?: number;
}

const DEFAULT_COINS: CryptoCoin[] = [
  { name: 'Bitcoin', symbol: 'BTC', price: 96420, pct: +2.10, color: '#f7931a' },
  { name: 'Ethereum', symbol: 'ETH', price: 3210, pct: -1.24, color: '#627eea' },
  { name: 'Solana', symbol: 'SOL', price: 198.20, pct: +4.81, color: '#14f195' },
  { name: 'XRP', symbol: 'XRP', price: 2.18, pct: +0.61, color: '#22272e' },
  { name: 'Dogecoin', symbol: 'DOGE', price: 0.41, pct: +5.42, color: '#c2a633' },
  { name: 'Cardano', symbol: 'ADA', price: 1.04, pct: -0.94, color: '#0033ad' },
];

export function CryptoTickerWidget({ config, live = true, height = 480 }: WidgetProps<CryptoTickerCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#11141c', textColor: '#f7931a', accentColor: '#22d39b', ...c.style });
  const coins = c.coins ?? DEFAULT_COINS;

  return (
    <div style={{ ...frameStyle(r), padding: 0, backgroundColor: '#08090c' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.056), display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: '#fff', fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: px(height, 0.05), letterSpacing: '-0.02em' }}>Crypto · 24h</div>
          <div style={{ color: '#9aa3b2', fontSize: px(height, 0.0204), fontWeight: 600 }}>via CoinGecko</div>
        </div>
        <div style={{ flex: 1, marginTop: px(height, 0.033), display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          {coins.slice(0, 6).map((coin, i) => {
            const up = coin.pct >= 0;
            return (
              <div key={i} style={{ background: 'linear-gradient(180deg,#11141c,#0c1018)', border: '1px solid #1e2231', borderRadius: px(height, 0.017), padding: `${px(height, 0.022)}px ${px(height, 0.026)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: px(height, 0.01) }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ width: px(height, 0.056), height: px(height, 0.056), borderRadius: '50%', background: coin.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0b0c0e', fontWeight: 800, fontSize: px(height, 0.022), marginRight: px(height, 0.0185) }}>{coin.symbol.slice(0, 1)}</div>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: px(height, 0.028) }}>{coin.name}</div>
                    <div style={{ color: '#9aa3b2', fontSize: px(height, 0.0167), fontWeight: 600, letterSpacing: '0.06em' }}>{coin.symbol}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.037), fontFamily: 'JetBrains Mono' }}>${coin.price.toLocaleString(undefined, { maximumFractionDigits: coin.price > 100 ? 0 : 2 })}</div>
                  <div style={{ color: up ? '#22d39b' : '#ff5664', fontSize: px(height, 0.0204), fontWeight: 700 }}>{up ? '+' : ''}{coin.pct.toFixed(2)}%</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ NEWS HEADLINES ════════════════ */

export interface NewsItem { cat: string; time: string; headline: string; }
export interface NewsHeadlinesCfg extends BaseCfg {
  source?: string;
  rssUrl?: string;
  categories?: string[];
  refreshMin?: number;
  accent?: string;
  items?: NewsItem[];
}

const DEFAULT_NEWS: NewsItem[] = [
  { cat: 'WORLD', time: '12 min ago', headline: 'Global summit reaches climate accord ahead of schedule' },
  { cat: 'BUSINESS', time: '34 min ago', headline: 'Markets close at record highs on stronger consumer data' },
  { cat: 'TECH', time: '1 hr ago', headline: 'New chip generation cuts AI training costs by half, vendors say' },
  { cat: 'SPORTS', time: '2 hr ago', headline: 'Underdog stuns champs in overtime thriller' },
  { cat: 'LOCAL', time: '3 hr ago', headline: 'Springfield breaks ground on new community center' },
];

export function NewsHeadlinesWidget({ config, live = true, height = 480 }: WidgetProps<NewsHeadlinesCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0d1018', textColor: '#e7142b', accentColor: '#e7142b', ...c.style });
  const items = c.items ?? DEFAULT_NEWS;
  const accent = c.accent ?? '#e7142b';
  const source = c.source ?? 'AP · Reuters · BBC';

  return (
    <div style={{ ...frameStyle(r), padding: 0, backgroundColor: '#0d1018' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${px(height, 0.037)}px ${px(height, 0.056)}px`, borderBottom: '2px solid #1c2230' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ background: accent, color: '#fff', padding: `${px(height, 0.0093)}px ${px(height, 0.0167)}px`, borderRadius: px(height, 0.0056), fontWeight: 800, fontFamily: 'Plus Jakarta Sans', fontSize: px(height, 0.028), letterSpacing: '0.04em', marginRight: px(height, 0.022) }}>BREAKING</div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.043), fontFamily: 'Plus Jakarta Sans', letterSpacing: '-0.02em' }}>Top Headlines</div>
          </div>
          <div style={{ color: '#8a93a4', fontSize: px(height, 0.022), fontWeight: 600 }}>{source}</div>
        </div>
        <div style={{ flex: 1, padding: `${px(height, 0.037)}px ${px(height, 0.056)}px`, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly' }}>
          {items.slice(0, 5).map((n, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start' }}>
              <div style={{ width: px(height, 0.0074), height: px(height, 0.056), background: i === 0 ? accent : '#3b4252', borderRadius: px(height, 0.0037), marginTop: px(height, 0.0056), marginRight: px(height, 0.022) }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: px(height, 0.0056) }}>
                  <span style={{ color: accent, fontWeight: 700, fontSize: px(height, 0.0167), letterSpacing: '0.06em', marginRight: px(height, 0.013) }}>{n.cat}</span>
                  <span style={{ color: '#5d6678', fontSize: px(height, 0.0167), marginRight: px(height, 0.013) }}>·</span>
                  <span style={{ color: '#8a93a4', fontSize: px(height, 0.0167), fontWeight: 600 }}>{n.time}</span>
                </div>
                <div style={{ color: '#fff', fontWeight: i === 0 ? 800 : 700, fontSize: i === 0 ? px(height, 0.041) : px(height, 0.031), lineHeight: 1.15, letterSpacing: '-0.01em' }}>{n.headline}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ AIR QUALITY ════════════════ */

export interface AirQualityCfg extends BaseCfg {
  location?: string;
  zip?: string;
  lat?: string;
  lon?: string;
  aqi?: number;
  pm25?: number;
  pm10?: number;
  o3?: number;
  no2?: number;
  refreshMin?: number;
}

function Pollutant({ label, val, unit, height }: { label: string; val: number; unit: string; height: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: px(height, 0.013) }}>
      <div style={{ color: '#8a93a4', fontSize: px(height, 0.022), fontWeight: 600, width: px(height, 0.102), marginRight: px(height, 0.017) }}>{label}</div>
      <div style={{ height: px(height, 0.013), background: '#1c2230', borderRadius: px(height, 0.0065), overflow: 'hidden', width: px(height, 0.278), marginRight: px(height, 0.017) }}>
        <div style={{ height: '100%', width: Math.min(100, val) + '%', background: '#22c55e' }} />
      </div>
      <div style={{ color: '#fff', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: px(height, 0.024), width: px(height, 0.148), textAlign: 'right' }}>{val} <span style={{ color: '#8a93a4', fontSize: px(height, 0.0167) }}>{unit}</span></div>
    </div>
  );
}

export function AirQualityWidget({ config, live = true, height = 480 }: WidgetProps<AirQualityCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0d12', textColor: '#22c55e', accentColor: '#22c55e', ...c.style });
  const aqi = c.aqi ?? 62;
  const location = c.location ?? 'Springfield, IL';
  const band = aqi <= 50 ? { color: '#22c55e', t: 'Good', sub: 'Air quality is satisfactory' }
    : aqi <= 100 ? { color: '#eab308', t: 'Moderate', sub: 'Acceptable for most people' }
      : aqi <= 150 ? { color: '#f97316', t: 'Unhealthy SG', sub: 'Sensitive groups limit exposure' }
        : aqi <= 200 ? { color: '#ef4444', t: 'Unhealthy', sub: 'Everyone may experience effects' }
          : aqi <= 300 ? { color: '#a855f7', t: 'Very unhealthy', sub: 'Health alert — limit outdoor activity' }
            : { color: '#7f1d1d', t: 'Hazardous', sub: 'Health warning — stay indoors' };

  return (
    <div style={{ ...frameStyle(r), padding: 0, backgroundColor: '#0a0d12' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.056), display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: '#fff', fontFamily: 'Plus Jakarta Sans', fontSize: px(height, 0.05), fontWeight: 800, letterSpacing: '-0.02em' }}>Air Quality</div>
          <div style={{ color: '#8a93a4', fontSize: px(height, 0.022), fontWeight: 600 }}>{location}</div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: px(height, 0.315), height: px(height, 0.315), borderRadius: '50%', background: `conic-gradient(${band.color} ${aqi / 3.5}%, #1c2230 0)`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: px(height, 0.044), flexShrink: 0 }}>
              <div style={{ width: px(height, 0.259), height: px(height, 0.259), borderRadius: '50%', background: '#0a0d12', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ color: '#8a93a4', fontSize: px(height, 0.0204), fontWeight: 600, letterSpacing: '0.06em' }}>AQI</div>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.13), fontFamily: 'JetBrains Mono', lineHeight: 1 }}>{aqi}</div>
                <div style={{ color: band.color, fontWeight: 700, fontSize: px(height, 0.028) }}>{band.t}</div>
              </div>
            </div>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: px(height, 0.043), lineHeight: 1.1, maxWidth: px(height, 0.556) }}>{band.sub}</div>
              <div style={{ marginTop: px(height, 0.028), display: 'flex', flexDirection: 'column' }}>
                <Pollutant label="PM2.5" val={c.pm25 ?? 14} unit="µg/m³" height={height} />
                <Pollutant label="PM10" val={c.pm10 ?? 28} unit="µg/m³" height={height} />
                <Pollutant label="O₃" val={c.o3 ?? 52} unit="ppb" height={height} />
                <Pollutant label="NO₂" val={c.no2 ?? 12} unit="ppb" height={height} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ WORLD CLOCKS ════════════════ */

export interface ClockZone { label: string; tz: string; }
export interface WorldClocksCfg extends BaseCfg {
  zones?: ClockZone[];
  hour12?: boolean;
}

const DEFAULT_ZONES: ClockZone[] = [
  { label: 'San Francisco', tz: 'America/Los_Angeles' },
  { label: 'New York', tz: 'America/New_York' },
  { label: 'London', tz: 'Europe/London' },
  { label: 'Tokyo', tz: 'Asia/Tokyo' },
];

function fmtTime(d: Date, tz: string, hour12: boolean): string {
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12, timeZone: tz || undefined }).format(d);
  } catch { return d.toLocaleTimeString(); }
}
function fmtWeekday(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz || undefined }).format(d);
  } catch { return ''; }
}

export function WorldClocksWidget({ config, live = true, height = 480 }: WidgetProps<WorldClocksCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0f1320', textColor: '#fff', accentColor: '#7b5cff', ...c.style });
  const zones = c.zones ?? DEFAULT_ZONES;
  const hour12 = !!c.hour12;

  const [now, setNow] = React.useState<Date>(() => new Date());
  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [live]);

  const cols = Math.min(zones.length, 4);

  return (
    <div style={{ ...frameStyle(r), padding: 0, backgroundColor: '#0b0c0e' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.056), display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: px(height, 0.037) }}>
          <div style={{ color: '#fff', fontFamily: 'Plus Jakarta Sans', fontSize: px(height, 0.05), fontWeight: 800, letterSpacing: '-0.02em' }}>World Clocks</div>
          <div style={{ color: '#74767d', fontSize: px(height, 0.022), fontWeight: 600 }}>Office locations · live</div>
        </div>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {zones.slice(0, 4).map((z, i) => {
            let hours = 12;
            try { hours = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: z.tz }).format(now)); } catch { /* keep default */ }
            const isNight = hours < 7 || hours >= 19;
            return (
              <div key={i} style={{ background: isNight ? '#0f1320' : '#fff7ef', color: isNight ? '#fff' : '#0b0c0e', borderRadius: px(height, 0.022), padding: `${px(height, 0.037)}px ${px(height, 0.033)}px`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', margin: px(height, 0.014) }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: px(height, 0.026), opacity: .7 }}>{z.label}</div>
                  <div style={{ fontWeight: 700, fontSize: px(height, 0.0204), opacity: .45, marginTop: px(height, 0.0056) }}>{z.tz}</div>
                </div>
                <div style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: px(height, 0.089), letterSpacing: '-0.02em', lineHeight: 1 }}>
                  {fmtTime(now, z.tz, hour12)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 600, fontSize: px(height, 0.0204), opacity: .55 }}>{fmtWeekday(now, z.tz)}</div>
                  <div style={{ fontSize: px(height, 0.035) }}>{isNight ? '🌙' : '☀️'}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ FX RATES ════════════════ */

export interface FxPair { code: string; name: string; flag: string; rate: number; delta: number; }
export interface FxRatesCfg extends BaseCfg {
  base?: string;
  pairs?: FxPair[];
  refreshMin?: number;
}

const DEFAULT_FX: FxPair[] = [
  { code: 'EUR', name: 'Euro', flag: '🇪🇺', rate: 0.9241, delta: +0.002 },
  { code: 'GBP', name: 'British Pound', flag: '🇬🇧', rate: 0.7912, delta: -0.001 },
  { code: 'JPY', name: 'Japanese Yen', flag: '🇯🇵', rate: 155.42, delta: +0.214 },
  { code: 'CAD', name: 'Canadian Dollar', flag: '🇨🇦', rate: 1.3825, delta: -0.006 },
  { code: 'AUD', name: 'Australian Dollar', flag: '🇦🇺', rate: 1.5104, delta: +0.011 },
  { code: 'CHF', name: 'Swiss Franc', flag: '🇨🇭', rate: 0.8807, delta: -0.002 },
  { code: 'CNY', name: 'Chinese Yuan', flag: '🇨🇳', rate: 7.2410, delta: +0.018 },
  { code: 'MXN', name: 'Mexican Peso', flag: '🇲🇽', rate: 17.6824, delta: -0.043 },
];

export function FxRatesWidget({ config, live = true, height = 480 }: WidgetProps<FxRatesCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0d1018', textColor: '#22d39b', accentColor: '#22d39b', ...c.style });
  const base = c.base ?? 'USD';
  const pairs = c.pairs ?? DEFAULT_FX;

  return (
    <div style={{ ...frameStyle(r), padding: 0, backgroundColor: '#0d1018' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.056), display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#fff', fontFamily: 'Plus Jakarta Sans', fontSize: px(height, 0.05), fontWeight: 800, letterSpacing: '-0.02em' }}>FX · 1 {base} =</div>
            <div style={{ color: '#8a93a4', fontSize: px(height, 0.0204), fontWeight: 600, marginTop: px(height, 0.0056) }}>Mid-market · refreshed every 5 min</div>
          </div>
          <div style={{ color: '#8a93a4', fontSize: px(height, 0.0204), fontWeight: 600 }}>via Wise / OpenExchangeRates</div>
        </div>
        <div style={{ flex: 1, marginTop: px(height, 0.033), display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          {pairs.slice(0, 8).map((p, i) => {
            const up = p.delta >= 0;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${px(height, 0.0167)}px ${px(height, 0.024)}px`, background: '#11161f', border: '1px solid #1c2230', borderRadius: px(height, 0.013), margin: px(height, 0.0083) }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ fontSize: px(height, 0.033), marginRight: px(height, 0.0167) }}>{p.flag}</div>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: px(height, 0.028) }}>{p.code}</div>
                    <div style={{ color: '#8a93a4', fontSize: px(height, 0.0167), fontWeight: 600 }}>{p.name}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#fff', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: px(height, 0.035) }}>{p.rate.toFixed(p.rate < 10 ? 4 : 2)}</div>
                  <div style={{ color: up ? '#22d39b' : '#ff5664', fontSize: px(height, 0.0167), fontWeight: 700 }}>{up ? '+' : ''}{p.delta.toFixed(3)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ TRAFFIC CAMERAS ════════════════ */

export interface TrafficCam { name: string; note: string; status: string; tint?: string; }
export interface TrafficCamCfg extends BaseCfg {
  city?: string;
  cams?: TrafficCam[];
  refreshSec?: number;
}

const DEFAULT_CAMS: TrafficCam[] = [
  { name: 'I-5 NB · Exit 168', note: 'San Diego · downtown approach', status: 'HEAVY', tint: '#2a3850' },
  { name: 'I-405 SB · Mile 31', note: 'LAX · airport offramp', status: 'SLOW', tint: '#3a3050' },
  { name: 'US-101 NB · Sunset', note: 'Hollywood · 0.5 mi to exit', status: 'CLEAR', tint: '#22383a' },
  { name: 'I-10 EB · La Cienega', note: 'Mid-Wilshire · 3 lanes open', status: 'CLEAR', tint: '#2a4032' },
];

export function TrafficCamWidget({ config, live = true, height = 480 }: WidgetProps<TrafficCamCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0e1320', textColor: '#22c55e', accentColor: '#dc2626', ...c.style });
  const cams = c.cams ?? DEFAULT_CAMS;
  const city = c.city ?? 'I-5 Corridor';

  return (
    <div style={{ ...frameStyle(r), padding: 0, backgroundColor: '#080a0d' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.056), display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ color: '#fff', fontFamily: 'Plus Jakarta Sans', fontWeight: 800, fontSize: px(height, 0.05), letterSpacing: '-0.02em' }}>Traffic · {city}</div>
          <div style={{ color: '#9aa3b2', fontSize: px(height, 0.0204), fontWeight: 600 }}>Updated 30s ago · via DOT cameras</div>
        </div>
        <div style={{ flex: 1, marginTop: px(height, 0.033), display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          {cams.slice(0, 4).map((cam, i) => (
            <div key={i} style={{ position: 'relative', borderRadius: px(height, 0.013), overflow: 'hidden', border: '1px solid #1c2230', background: `linear-gradient(135deg,${cam.tint || '#243046'},#0e1320)`, margin: px(height, 0.011) }}>
              <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'repeating-linear-gradient(135deg, #ffffff0a 0, #ffffff0a 2px, transparent 2px, transparent 14px)' }} />
              <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: px(height, 0.0204) }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: px(height, 0.026) }}>{cam.name}</div>
                  <div style={{ color: '#cfd8e3', fontSize: px(height, 0.0185), fontWeight: 600 }}>{cam.note}</div>
                </div>
                <div style={{ background: cam.status === 'HEAVY' ? '#dc2626' : cam.status === 'SLOW' ? '#f59e0b' : '#22c55e', color: '#fff', fontWeight: 800, fontSize: px(height, 0.0167), padding: `${px(height, 0.0074)}px ${px(height, 0.013)}px`, borderRadius: px(height, 0.0074), letterSpacing: '0.04em' }}>{cam.status}</div>
              </div>
              <div style={{ position: 'absolute', top: px(height, 0.0167), left: px(height, 0.0167), color: '#fff', fontWeight: 700, fontSize: px(height, 0.0148), background: '#0006', padding: `${px(height, 0.0037)}px ${px(height, 0.0093)}px`, borderRadius: px(height, 0.0056) }}>● LIVE</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
