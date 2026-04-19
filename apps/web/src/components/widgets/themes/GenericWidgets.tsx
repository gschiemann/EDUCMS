"use client";

/**
 * Generic widget types that work across ANY theme (no shape-based
 * variants needed). These give each category its own visual vocabulary
 * without requiring 18 × N themed components.
 *
 * New widget types introduced:
 *   - QUOTE       — big pull-quote with author, inspirational flavor
 *   - STATS       — 3 stat cards in a row (number + label)
 *   - MENU_ITEM   — food card: name + description + allergen chips
 *   - SCOREBOARD  — home-vs-away scorebug with scores + time
 *   - SCHEDULE_GRID — period-by-period schedule table
 *   - ATTENDANCE  — live attendance stat with percentage bar
 *   - BIRTHDAYS   — today's birthdays, cake emoji per student
 *   - HONOR_ROLL  — scrolling list of recognized students
 *
 * All use FitText for auto-sizing and accept config. A theme's bgColor
 * bleeds through so these inherit palette automatically.
 */

import React, { useEffect, useState } from 'react';
import { FitText } from './FitText';
import { EditableText } from './EditableText';

// ─── QUOTE ─────────────────────────────────────────────────
export function QuoteWidget({ config, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const text = config.quote || '"Believe you can and you\'re halfway there."';
  const author = config.author || '— Theodore Roosevelt';
  return (
    <div className="absolute inset-0" style={{ padding: '5%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: 'rgba(255,255,255,0.95)',
        borderRadius: 24,
        boxShadow: '0 16px 40px rgba(0,0,0,0.15)',
        padding: '6%',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Giant open-quote mark */}
        <div style={{
          position: 'absolute',
          top: '-2%', left: '4%',
          fontSize: 'clamp(60px,18cqh,240px)',
          fontFamily: "'Fraunces', 'Georgia', serif",
          fontWeight: 900,
          color: 'rgba(99,102,241,0.3)',
          lineHeight: 1,
          pointerEvents: 'none',
        }}>“</div>
        <div style={{ flex: '1 1 76%', minHeight: 0, padding: '6% 4% 2% 4%', position: 'relative', zIndex: 1 }}>
          <EditableText configKey="quote" onConfigChange={onConfigChange}
            max={320} min={14}
            style={{ fontFamily: "'Fraunces', 'Georgia', serif", fontStyle: 'italic', color: '#1f2937', fontWeight: 600 }}>
            {text}
          </EditableText>
        </div>
        <div style={{ flex: '0 0 18%', minHeight: 0, textAlign: 'right' }}>
          <EditableText configKey="author" onConfigChange={onConfigChange}
            max={100} min={10} wrap={false}
            style={{ fontFamily: "'Fredoka', system-ui, sans-serif", fontWeight: 700, color: '#6366f1' }}>
            {author}
          </EditableText>
        </div>
      </div>
    </div>
  );
}

// ─── STATS ─────────────────────────────────────────────────
// Three stat cards in a row. config.stats = [{value, label}, ...]
export function StatsWidget({ config }: { config: any; compact?: boolean }) {
  const defaultStats = [
    { value: '97%', label: 'ATTENDANCE' },
    { value: '4.2', label: 'AVG GPA' },
    { value: '84', label: 'CLUBS' },
  ];
  const stats = Array.isArray(config.stats) && config.stats.length ? config.stats : defaultStats;
  const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6'];
  return (
    <div className="absolute inset-0 flex items-stretch" style={{ padding: '3%', gap: '3%' }}>
      {stats.slice(0, 5).map((s: any, i: number) => (
        <div key={i} style={{
          flex: 1, minWidth: 0,
          background: 'rgba(255,255,255,0.95)',
          borderRadius: 20,
          boxShadow: '0 10px 24px rgba(0,0,0,0.12)',
          padding: '8% 4%',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          borderTop: `6px solid ${colors[i % colors.length]}`,
        }}>
          <div style={{ flex: '0 0 62%', minHeight: 0 }}>
            <FitText max={280} min={20} wrap={false}
              style={{ fontFamily: "'Fredoka', system-ui, sans-serif", fontWeight: 800, color: colors[i % colors.length] }}>
              {s.value || '—'}
            </FitText>
          </div>
          <div style={{ flex: '0 0 38%', minHeight: 0 }}>
            <FitText max={80} min={8} wrap={false}
              style={{ fontFamily: "'Fredoka', system-ui, sans-serif", fontWeight: 700, color: '#374151', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>
              {s.label || ''}
            </FitText>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── MENU ITEM ─────────────────────────────────────────────
// A food card with name + description + allergen chips.
export function MenuItemWidget({ config, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const name = config.itemName || "Today's Special";
  const description = config.description || 'Fresh, seasonal, made from scratch.';
  const allergens: string[] = Array.isArray(config.allergens) ? config.allergens : ['V', 'GF'];
  const price = config.price || '';
  return (
    <div className="absolute inset-0" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: '#FFF9ED',
        borderRadius: 18,
        border: '4px solid #D97706',
        boxShadow: '0 12px 28px rgba(120,70,0,0.25)',
        padding: '4%',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ flex: '0 0 35%', minHeight: 0, display: 'flex', alignItems: 'baseline', gap: '4%' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <EditableText configKey="itemName" onConfigChange={onConfigChange}
              max={220} min={14} wrap={false} center={false}
              style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, color: '#1F2937' }}>
              {name}
            </EditableText>
          </div>
          {price && (
            <div style={{ flex: '0 0 28%', minWidth: 0 }}>
              <FitText max={100} min={10} wrap={false} center={false}
                style={{ fontFamily: "'Fredoka', system-ui", fontWeight: 800, color: '#D97706' }}>
                {price}
              </FitText>
            </div>
          )}
        </div>
        <div style={{ flex: '1 1 45%', minHeight: 0, padding: '2% 0' }}>
          <EditableText configKey="description" onConfigChange={onConfigChange}
            max={100} min={10} center={false}
            style={{ fontFamily: "'Fredoka', system-ui", color: '#4B5563', fontWeight: 500 }}>
            {description}
          </EditableText>
        </div>
        <div style={{ flex: '0 0 20%', minHeight: 0, display: 'flex', alignItems: 'center', gap: '2%' }}>
          {allergens.map((a, i) => (
            <span key={i} style={{
              background: '#D97706', color: '#fff',
              padding: '0.25em 0.75em',
              borderRadius: 999,
              fontSize: 'clamp(10px,3cqh,20px)',
              fontFamily: "'Fredoka', system-ui",
              fontWeight: 700,
              letterSpacing: '0.05em',
            }}>{a}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── SCOREBOARD ────────────────────────────────────────────
// HOME vs AWAY scorebug. Live-tickable countdown too.
export function ScoreboardWidget({ config, onConfigChange }: { config: any; compact?: boolean; onConfigChange?: (p: Record<string, any>) => void }) {
  const home = config.homeName || 'EAGLES';
  const away = config.awayName || 'COUGARS';
  const homeScore = config.homeScore ?? 0;
  const awayScore = config.awayScore ?? 0;
  const period = config.period || '1ST · 8:42';
  const status = config.status || 'TONIGHT';
  return (
    <div className="absolute inset-0" style={{ padding: '2%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: 'linear-gradient(180deg,#0B1228,#050812)',
        borderRadius: 14,
        border: '3px solid #D4AF37',
        boxShadow: '0 20px 50px rgba(0,0,0,0.55)',
        padding: '3%',
        color: '#fff',
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', gridTemplateRows: 'auto 1fr auto', gap: '2%',
      }}>
        {/* Status strip */}
        <div style={{ gridColumn: '1 / -1', textAlign: 'center' }}>
          <FitText max={60} min={8} wrap={false}
            style={{ fontFamily: "'JetBrains Mono',monospace", color: '#FFB020', letterSpacing: '0.2em' }}>
            {status.toUpperCase()}
          </FitText>
        </div>
        {/* Home */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3%' }}>
          <div style={{ width: '100%', flex: '0 0 34%', minHeight: 0 }}>
            <EditableText configKey="homeName" onConfigChange={onConfigChange}
              max={140} min={10} wrap={false}
              style={{ fontFamily: "'Bebas Neue','Oswald',system-ui", color: '#fff', letterSpacing: '0.08em' }}>
              {home}
            </EditableText>
          </div>
          <div style={{ width: '100%', flex: '1 1 66%', minHeight: 0 }}>
            <FitText max={400} min={30} wrap={false}
              style={{ fontFamily: "'JetBrains Mono',monospace", color: '#FFB020', fontWeight: 800 }}>
              {String(homeScore)}
            </FitText>
          </div>
        </div>
        {/* VS column */}
        <div style={{ alignSelf: 'center', padding: '0 4%' }}>
          <FitText max={140} min={16} wrap={false}
            style={{ fontFamily: "'Bebas Neue',system-ui", color: '#D4AF37' }}>
            VS
          </FitText>
        </div>
        {/* Away */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3%' }}>
          <div style={{ width: '100%', flex: '0 0 34%', minHeight: 0 }}>
            <EditableText configKey="awayName" onConfigChange={onConfigChange}
              max={140} min={10} wrap={false}
              style={{ fontFamily: "'Bebas Neue',system-ui", color: '#fff', letterSpacing: '0.08em' }}>
              {away}
            </EditableText>
          </div>
          <div style={{ width: '100%', flex: '1 1 66%', minHeight: 0 }}>
            <FitText max={400} min={30} wrap={false}
              style={{ fontFamily: "'JetBrains Mono',monospace", color: '#FFB020', fontWeight: 800 }}>
              {String(awayScore)}
            </FitText>
          </div>
        </div>
        {/* Period */}
        <div style={{ gridColumn: '1 / -1', textAlign: 'center' }}>
          <FitText max={80} min={9} wrap={false}
            style={{ fontFamily: "'JetBrains Mono',monospace", color: '#D4AF37', letterSpacing: '0.15em' }}>
            {period}
          </FitText>
        </div>
      </div>
    </div>
  );
}

// ─── SCHEDULE GRID ─────────────────────────────────────────
export function ScheduleGridWidget({ config }: { config: any; compact?: boolean }) {
  const defaultPeriods = [
    { num: '1', name: 'Homeroom', time: '8:00 – 8:15' },
    { num: '2', name: 'English', time: '8:20 – 9:15' },
    { num: '3', name: 'Math', time: '9:20 – 10:15' },
    { num: '4', name: 'Science', time: '10:20 – 11:15' },
    { num: '5', name: 'Lunch', time: '11:20 – 12:00' },
    { num: '6', name: 'History', time: '12:05 – 1:00' },
    { num: '7', name: 'PE', time: '1:05 – 2:00' },
    { num: '8', name: 'Art', time: '2:05 – 3:00' },
  ];
  const periods = Array.isArray(config.periods) && config.periods.length ? config.periods : defaultPeriods;
  return (
    <div className="absolute inset-0" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: 'rgba(255,255,255,0.96)',
        borderRadius: 18,
        boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        padding: '2% 3%',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{ flex: '0 0 12%', minHeight: 0, borderBottom: '3px solid #6366f1', paddingBottom: '1%' }}>
          <FitText max={60} min={10} wrap={false} center={false}
            style={{ fontFamily: "'Fredoka', system-ui", fontWeight: 800, color: '#1f2937', letterSpacing: '0.12em', textTransform: 'uppercase' as const }}>
            Today's Schedule
          </FitText>
        </div>
        <div style={{ flex: '1 1 88%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {periods.slice(0, 8).map((p: any, i: number) => (
            <div key={i} style={{
              flex: 1, minHeight: 0,
              display: 'grid',
              gridTemplateColumns: '12% 1fr 30%',
              gap: '2%',
              alignItems: 'center',
              borderBottom: i < periods.length - 1 ? '1px solid rgba(99,102,241,0.15)' : 'none',
            }}>
              <div style={{ minHeight: 0 }}>
                <FitText max={48} min={8} wrap={false}
                  style={{ fontFamily: "'JetBrains Mono',monospace", color: '#6366f1', fontWeight: 800 }}>
                  {p.num}
                </FitText>
              </div>
              <div style={{ minHeight: 0 }}>
                <FitText max={60} min={9} wrap={false} center={false}
                  style={{ fontFamily: "'Fredoka', system-ui", fontWeight: 700, color: '#1f2937' }}>
                  {p.name}
                </FitText>
              </div>
              <div style={{ minHeight: 0 }}>
                <FitText max={36} min={8} wrap={false} center={false}
                  style={{ fontFamily: "'JetBrains Mono',monospace", color: '#6b7280' }}>
                  {p.time}
                </FitText>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ATTENDANCE TICKER ─────────────────────────────────────
export function AttendanceWidget({ config }: { config: any; compact?: boolean }) {
  const present = config.presentPct ?? 97;
  const total = config.totalStudents ?? 624;
  const absent = Math.max(0, Math.round(total * (1 - present / 100)));
  return (
    <div className="absolute inset-0" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: 'linear-gradient(135deg,#10b981,#059669)',
        borderRadius: 18,
        boxShadow: '0 14px 32px rgba(5,150,105,0.35)',
        padding: '4%',
        color: '#fff',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ flex: '0 0 20%', minHeight: 0 }}>
          <FitText max={60} min={10} wrap={false} center={false}
            style={{ fontFamily: "'Fredoka',system-ui", color: 'rgba(255,255,255,0.85)', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>
            Attendance Today
          </FitText>
        </div>
        <div style={{ flex: '1 1 60%', minHeight: 0 }}>
          <FitText max={400} min={40} wrap={false}
            style={{ fontFamily: "'Fredoka',system-ui", fontWeight: 800, color: '#fff' }}>
            {present}%
          </FitText>
        </div>
        <div style={{ flex: '0 0 20%', minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4%' }}>
          <div style={{ background: 'rgba(0,0,0,0.22)', borderRadius: 10, padding: '4%', textAlign: 'center' }}>
            <FitText max={60} min={8} wrap={false}
              style={{ fontFamily: "'Fredoka',system-ui", fontWeight: 700 }}>
              {total - absent} present
            </FitText>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.22)', borderRadius: 10, padding: '4%', textAlign: 'center' }}>
            <FitText max={60} min={8} wrap={false}
              style={{ fontFamily: "'Fredoka',system-ui", fontWeight: 700 }}>
              {absent} absent
            </FitText>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BIRTHDAYS ─────────────────────────────────────────────
export function BirthdaysWidget({ config }: { config: any; compact?: boolean }) {
  const defaultNames: string[] = ['Morgan P.', 'Samir K.', 'Ava L.'];
  const names: string[] = Array.isArray(config.birthdays) && config.birthdays.length ? config.birthdays : defaultNames;
  return (
    <div className="absolute inset-0" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: 'linear-gradient(135deg,#FBCFE8,#DDD6FE)',
        borderRadius: 18,
        boxShadow: '0 12px 28px rgba(236,72,153,0.3)',
        padding: '4%',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ flex: '0 0 24%', minHeight: 0, textAlign: 'center' }}>
          <FitText max={90} min={10} wrap={false}
            style={{ fontFamily: "'Caveat',cursive", color: '#BE185D', fontWeight: 700 }}>
            🎂 Happy Birthday!
          </FitText>
        </div>
        <div style={{ flex: '1 1 76%', minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2%' }}>
          {names.slice(0, 5).map((n, i) => (
            <div key={i} style={{ minHeight: 0, flex: 1 }}>
              <FitText max={120} min={10} wrap={false}
                style={{ fontFamily: "'Fredoka',system-ui", fontWeight: 700, color: '#1f2937' }}>
                🎈 {n}
              </FitText>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── HONOR ROLL ────────────────────────────────────────────
export function HonorRollWidget({ config }: { config: any; compact?: boolean }) {
  const defaultStudents = [
    { name: 'Jordan Lee',    reason: 'Perfect attendance + top math score' },
    { name: 'Maria Santos',  reason: 'Kindness award — lunchroom helper' },
    { name: 'Tyler Chen',    reason: 'Band district selection' },
    { name: 'Ava Patel',     reason: 'Essay contest — 1st place' },
  ];
  const students = Array.isArray(config.students) && config.students.length ? config.students : defaultStudents;
  return (
    <div className="absolute inset-0" style={{ padding: '3%' }}>
      <div style={{
        position: 'relative', width: '100%', height: '100%',
        background: 'linear-gradient(180deg,#1F2937,#111827)',
        borderRadius: 18,
        boxShadow: '0 16px 32px rgba(0,0,0,0.45)',
        padding: '3% 4%',
        color: '#fff',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ flex: '0 0 16%', minHeight: 0, textAlign: 'center', borderBottom: '2px solid #D4AF37', paddingBottom: '1%' }}>
          <FitText max={70} min={10} wrap={false}
            style={{ fontFamily: "'Fraunces',serif", color: '#D4AF37', letterSpacing: '0.12em', textTransform: 'uppercase' as const }}>
            ★ Honor Roll ★
          </FitText>
        </div>
        <div style={{ flex: '1 1 84%', minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', paddingTop: '2%' }}>
          {students.slice(0, 5).map((s: any, i: number) => (
            <div key={i} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ flex: '0 0 55%', minHeight: 0 }}>
                <FitText max={72} min={10} wrap={false} center={false}
                  style={{ fontFamily: "'Fraunces',serif", fontWeight: 800, color: '#fff' }}>
                  {s.name}
                </FitText>
              </div>
              <div style={{ flex: '0 0 45%', minHeight: 0 }}>
                <FitText max={40} min={8} wrap={false} center={false}
                  style={{ fontFamily: "'Fredoka',system-ui", color: 'rgba(255,255,255,0.7)', fontStyle: 'italic' }}>
                  — {s.reason}
                </FitText>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
