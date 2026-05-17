"use client";
/**
 * VenueOS · Houses of Worship widgets.
 */
import React from 'react';
import { resolveStyle, frameStyle } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

/* ════════════════ SERVICE TIMES ════════════════ */

export interface ServiceRow { day: string; subtitle: string; where: string; time: string; }
export interface ServiceTimesCfg extends BaseCfg { label?: string; services?: ServiceRow[]; }

export function ServiceTimesWidget({ config, live = true, height = 480 }: WidgetProps<ServiceTimesCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#f7f3e8', textColor: '#1f1742', accentColor: '#7c4dff', ...c.style });
  const label = c.label ?? 'Weekly Gatherings';
  const services: ServiceRow[] = c.services ?? [
    { day: 'Sunday', subtitle: 'Traditional Service', where: 'Main Sanctuary', time: '8:30 AM' },
    { day: 'Sunday', subtitle: 'Contemporary Service', where: 'Main Sanctuary', time: '10:30 AM' },
    { day: 'Sunday', subtitle: 'Spanish Service', where: 'East Chapel', time: '12:30 PM' },
    { day: 'Wednesday', subtitle: 'Midweek Prayer', where: 'Fellowship Hall', time: '7:00 PM' },
    { day: 'Friday', subtitle: 'Youth Gathering', where: 'Student Center', time: '7:30 PM' },
  ];

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '4%', left: '5%', right: '5%' }}>
        <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.062), letterSpacing: '0.08em' }}>{label.toUpperCase()}</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.25), letterSpacing: '-0.02em' }}>Service Times</div>
      </div>

      <div style={{ position: 'absolute', top: '34%', bottom: '4%', left: '5%', right: '5%' }}>
        {services.slice(0, 5).map((s, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid #e7e6e1', borderRadius: 18, padding: '2% 3%', marginBottom: i === services.length - 1 ? 0 : '1.5%', display: 'flex', alignItems: 'center' }}>
            <div style={{ flex: '2 0 0' }}>
              <div style={{ fontWeight: 700, fontSize: px(height, 0.083) }}>{s.day}</div>
              <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.05) }}>{s.subtitle}</div>
            </div>
            <div style={{ flex: '2 0 0', color: '#74767d', fontWeight: 600, fontSize: px(height, 0.058) }}>{s.where}</div>
            <div style={{ flex: '1 0 0', textAlign: 'right', fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: 800, fontSize: px(height, 0.1) }}>{s.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════ SERMON TITLE CARD ════════════════ */

export interface SermonTitleCardCfg extends BaseCfg {
  series?: string;
  title?: string;
  reference?: string;
  speaker?: string;
  date?: string;
}

export function SermonTitleCardWidget({ config, live = true, height = 480 }: WidgetProps<SermonTitleCardCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1f1742', textColor: '#fff', accentColor: '#ffd23a', accentColor2: '#7c4dff', ...c.style });
  const series = c.series ?? 'The Sermon on the Mount';
  const title = c.title ?? 'Blessed are the peacemakers';
  const reference = c.reference ?? 'Matthew 5:9';
  const speaker = c.speaker ?? 'Pastor Mara Lin';
  const date = c.date ?? 'Sunday · May 18, 2026';

  return (
    <div style={frameStyle(r)}>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'linear-gradient(180deg, #2a1f5e, #1f1742 60%)' }} />
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0 8px, rgba(255,255,255,0) 8px 16px)' }} />

      <div style={{ position: 'absolute', top: '6%', left: '6%', display: 'flex', alignItems: 'center' }}>
        <div style={{ width: px(height, 0.03), height: px(height, 0.03), borderRadius: '50%', background: r.accent.primary, marginRight: '2%' }} />
        <div style={{ fontWeight: 700, fontSize: px(height, 0.062), letterSpacing: '0.06em', color: '#dcd3ff' }}>SERMON · WEEK 4 OF 6</div>
      </div>

      <div style={{ position: 'absolute', top: '30%', left: '6%', right: '6%' }}>
        <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.096) }}>{series}</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.5), lineHeight: 0.95, letterSpacing: '-0.03em', marginTop: '2%' }}>{title}</div>
        <div style={{ color: '#dcd3ff', fontWeight: 700, fontSize: px(height, 0.096), marginTop: '4%', letterSpacing: '0.02em' }}>{reference}</div>
      </div>

      <div style={{ position: 'absolute', bottom: '5%', left: '6%', right: '6%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: px(height, 0.062), fontWeight: 600 }}>
        <span>{speaker}</span>
        <span style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>{date}</span>
      </div>
    </div>
  );
}

/* ════════════════ HYMN BOARD ════════════════ */

export interface Hymn { number: string; title: string; composer: string; verses: string; }
export interface HymnBoardCfg extends BaseCfg { hymns?: Hymn[]; }

export function HymnBoardWidget({ config, live = true, height = 480 }: WidgetProps<HymnBoardCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#f7f3e8', textColor: '#1f1742', accentColor: '#7c4dff', ...c.style });
  const hymns: Hymn[] = c.hymns ?? [
    { number: '14', title: 'Holy, Holy, Holy', composer: 'R. Heber & J. Dykes', verses: '1, 2, 4' },
    { number: '142', title: 'Be Thou My Vision', composer: 'Irish trad., M. Byrne', verses: 'all' },
    { number: '408', title: 'Take My Life and Let It Be', composer: 'F. R. Havergal', verses: '1-3' },
    { number: '267', title: 'Great Is Thy Faithfulness', composer: 'T. Chisholm & W. Runyan', verses: 'all' },
  ];

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '4%', left: '5%', right: '5%' }}>
        <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.066), letterSpacing: '0.08em' }}>TODAY&apos;S MUSIC</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.23), letterSpacing: '-0.02em' }}>Hymn Board</div>
      </div>

      <div style={{ position: 'absolute', top: '36%', bottom: '4%', left: '5%', right: '5%', display: 'flex', flexWrap: 'wrap' }}>
        {hymns.slice(0, 4).map((h, i) => {
          const col = i % 2;
          return (
            <div key={i} style={{ width: '49%', marginRight: col === 1 ? 0 : '2%', marginBottom: '2%', background: '#fff', border: `2px solid ${r.font.color}`, borderRadius: 24, padding: '3%', display: 'flex', alignItems: 'center' }}>
              <div style={{ marginRight: '4%', textAlign: 'center', flexShrink: 0 }}>
                <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.038), letterSpacing: '0.08em' }}>HYMN</div>
                <div style={{ fontWeight: 800, fontSize: px(height, 0.29), lineHeight: 1, letterSpacing: '-0.04em' }}>{h.number}</div>
              </div>
              <div style={{ flex: '1 0 0', paddingLeft: '4%', borderLeft: '1px solid #efeeea' }}>
                <div style={{ fontWeight: 700, fontSize: px(height, 0.075), lineHeight: 1.15 }}>{h.title}</div>
                <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.046), marginTop: '1%' }}>{h.composer}</div>
                <div style={{ marginTop: '2%', color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.046) }}>Verses {h.verses}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════ GIVING THERMOMETER ════════════════ */

export interface GivingThermometerCfg extends BaseCfg {
  label?: string;
  title?: string;
  goal?: number;
  raised?: number;
  donors?: number;
  daysLeft?: number;
  qrLabel?: string;
}

export function GivingThermometerWidget({ config, live = true, height = 480 }: WidgetProps<GivingThermometerCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1f1742', textColor: '#fff', accentColor: '#ffd23a', accentColor2: '#ff6b7a', ...c.style });
  const label = c.label ?? 'Capital Campaign';
  const title = c.title ?? 'Build the new student wing';
  const goal = c.goal ?? 250000;
  const raised = c.raised ?? 167200;
  const donors = c.donors ?? 312;
  const daysLeft = c.daysLeft ?? 47;
  const qrLabel = c.qrLabel ?? 'connect.firstchurch.org/give';
  const pct = Math.min(1, raised / goal);

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '6%', bottom: '6%', left: '6%', right: '38%' }}>
        <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.062), letterSpacing: '0.06em' }}>{label.toUpperCase()}</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.19), lineHeight: 1.0, letterSpacing: '-0.02em', marginTop: '2%' }}>{title}</div>

        <div style={{ display: 'flex', alignItems: 'baseline', marginTop: '5%' }}>
          <div style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.29), letterSpacing: '-0.03em', lineHeight: 1 }}>${(raised / 1000).toFixed(0)}K</div>
          <div style={{ color: '#dcd3ff', fontWeight: 700, fontSize: px(height, 0.07), marginLeft: '4%' }}>of ${(goal / 1000).toFixed(0)}K goal</div>
        </div>
        <div style={{ color: '#dcd3ff', fontWeight: 700, fontSize: px(height, 0.062), marginTop: '2%' }}>{donors} families giving · {daysLeft} days remaining</div>

        <div style={{ background: '#2a1f5e', border: '1px dashed #5d4cc1', borderRadius: 18, padding: '3%', display: 'flex', alignItems: 'center', marginTop: '5%' }}>
          <div style={{ width: px(height, 0.22), height: px(height, 0.22), background: '#fff', borderRadius: 10, padding: '1%', marginRight: '4%', flexShrink: 0 }}>
            <div style={{ width: '100%', height: '100%', background: 'repeating-conic-gradient(#000 0% 12%, #fff 0% 25%)' }} />
          </div>
          <div>
            <div style={{ color: '#dcd3ff', fontWeight: 700, fontSize: px(height, 0.05), letterSpacing: '0.06em' }}>SCAN TO GIVE</div>
            <div style={{ fontWeight: 700, fontSize: px(height, 0.066), marginTop: '1%' }}>{qrLabel}</div>
          </div>
        </div>
      </div>

      <div style={{ position: 'absolute', top: '6%', bottom: '6%', right: '6%', width: '28%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: px(height, 0.29), height: '88%', background: '#2a1f5e', border: `4px solid ${r.accent.primary}`, borderRadius: 80, overflow: 'hidden', display: 'flex', flexDirection: 'column-reverse' }}>
          <div style={{ width: '100%', height: `${pct * 100}%`, background: `linear-gradient(180deg, ${r.accent.secondary} 0%, ${r.accent.primary} 100%)` }} />
        </div>
      </div>
    </div>
  );
}

/* ════════════════ SCRIPTURE VERSE ════════════════ */

export interface ScriptureVerseCfg extends BaseCfg {
  text?: string;
  reference?: string;
  translation?: string;
}

export function ScriptureVerseWidget({ config, live = true, height = 480 }: WidgetProps<ScriptureVerseCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#fdfaf3', textColor: '#1f1742', accentColor: '#7c4dff', ...c.style });
  const text = c.text ?? 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.';
  const reference = c.reference ?? 'John 3:16';
  const translation = c.translation ?? 'KJV';

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '50%', left: '5%', right: '5%', transform: 'translateY(-50%)', textAlign: 'center' }}>
        <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.066), letterSpacing: '0.08em' }}>VERSE OF THE DAY</div>
        <div style={{ fontStyle: 'italic', fontWeight: 700, fontSize: px(height, 0.175), lineHeight: 1.2, letterSpacing: '-0.01em', marginTop: '3%' }}>&ldquo;{text}&rdquo;</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.11), marginTop: '4%', letterSpacing: '-0.01em' }}>{reference}</div>
        <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.054), marginTop: '1%' }}>{translation}</div>
      </div>
    </div>
  );
}

/* ════════════════ PRAYER REQUEST QR ════════════════ */

export interface PrayerRequestCfg extends BaseCfg { body?: string; qrLabel?: string; }

export function PrayerRequestQrWidget({ config, live = true, height = 480 }: WidgetProps<PrayerRequestCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0d0820', textColor: '#fff', accentColor: '#ffd23a', accentColor2: '#7c4dff', ...c.style });
  const body = c.body ?? 'Scan with your phone to send a confidential request to our prayer team. Replies within 24 hours.';
  const qrLabel = c.qrLabel ?? 'firstchurch.org/prayer';

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: '6%', bottom: '6%', left: '6%', right: '36%' }}>
        <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.062), letterSpacing: '0.08em' }}>WE&apos;RE PRAYING WITH YOU</div>
        <div style={{ fontWeight: 800, fontSize: px(height, 0.31), letterSpacing: '-0.02em', lineHeight: 1.0, marginTop: '4%' }}>Submit a<br/>prayer request</div>
        <div style={{ color: '#dcd3ff', fontWeight: 600, fontSize: px(height, 0.066), lineHeight: 1.4, marginTop: '5%' }}>{body}</div>

        <div style={{ display: 'flex', marginTop: '6%' }}>
          {['anonymous', 'private', 'confidential'].map(t => (
            <span key={t} style={{ background: '#1f1742', color: r.accent.primary, padding: '2% 4%', borderRadius: 999, fontWeight: 700, fontSize: px(height, 0.046), marginRight: '3%' }}>· {t} ·</span>
          ))}
        </div>
      </div>

      <div style={{ position: 'absolute', top: '50%', right: '6%', transform: 'translateY(-50%)', background: '#fff', borderRadius: 24, padding: '4%', textAlign: 'center' }}>
        <div style={{ width: px(height, 0.79), height: px(height, 0.79), background: 'repeating-conic-gradient(#000 0% 8%, #fff 0% 16%)', borderRadius: 14 }} />
        <div style={{ color: '#1f1742', fontWeight: 700, fontSize: px(height, 0.05), marginTop: '4%' }}>{qrLabel}</div>
      </div>
    </div>
  );
}
