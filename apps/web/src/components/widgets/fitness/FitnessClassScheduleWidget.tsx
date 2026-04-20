'use client';

/**
 * FitnessClassScheduleWidget — today's gym class schedule on a wall display.
 *
 * Designed for locker rooms, lobby, and cardio floor. Members glance up
 * and instantly see what's coming next without fumbling with an app.
 *
 * Key rendering logic:
 *   • `highlightNextClass` (default true) detects the next upcoming class
 *     based on 24h time comparison and gives it a neon-glowing left bar +
 *     a pulsing "NEXT" chip. The widget doesn't need a live clock feed —
 *     it reads the current time on the client.
 *   • `showPastClasses` (default false) hides classes that already ended
 *     today at 35% opacity so the schedule doesn't feel stale mid-day.
 *   • `maxRows` caps how many classes render — useful for small zones.
 *   • Intensity indicator: 1-3 dot meter (easy/moderate/hard) using
 *     green / amber / red so it's scannable from a treadmill.
 *   • Studio chip: tiny pill in a muted accent tint, corner-grouped with
 *     instructor name so each row has a clear information hierarchy.
 *
 * Widget type: FITNESS_CLASS_SCHEDULE
 */

export interface FitnessClassScheduleClass {
  /** Display time — e.g. "7:00 AM", "12:30 PM". Used for the "next" detection. */
  time: string;
  name: string;
  instructor?: string;
  studio?: string;
  intensity?: 'easy' | 'moderate' | 'hard';
  /** Duration in minutes. Shown in the row only when present. */
  durationMin?: number;
}

export interface FitnessClassScheduleConfig {
  classes?: FitnessClassScheduleClass[];
  /** Widget title. Default: "TODAY'S CLASSES" */
  title?: string;
  /** Neon accent hex. Default: #00d4ff electric blue */
  accentColor?: string;
  /** Cap rows shown. Default: 6 */
  maxRows?: number;
  /** Highlight the next upcoming class. Default: true */
  highlightNextClass?: boolean;
  /** Show past classes at 35% opacity instead of hiding. Default: false */
  showPastClasses?: boolean;
}

// ─── Demo data — realistic gym day, shown when config.classes is unset ───
const DEMO_CLASSES: FitnessClassScheduleClass[] = [
  { time: '6:00 AM', name: 'Morning Flow Yoga',     instructor: 'Sara K.',   studio: 'Studio A', intensity: 'easy',     durationMin: 60 },
  { time: '7:30 AM', name: 'Spin Circuit',           instructor: 'Marcus T.', studio: 'Cycle Room', intensity: 'hard',  durationMin: 45 },
  { time: '9:00 AM', name: 'Barre Fusion',           instructor: 'Lena M.',   studio: 'Studio B', intensity: 'moderate', durationMin: 50 },
  { time: '10:30 AM', name: 'Aqua Aerobics',         instructor: 'James R.',  studio: 'Pool',     intensity: 'easy',     durationMin: 45 },
  { time: '12:00 PM', name: 'HIIT Blast',            instructor: 'Riya P.',   studio: 'Turf',     intensity: 'hard',     durationMin: 30 },
  { time: '1:30 PM', name: 'Pilates Core',           instructor: 'Ana S.',    studio: 'Studio A', intensity: 'moderate', durationMin: 55 },
  { time: '5:00 PM', name: 'Kickboxing',             instructor: 'Marcus T.', studio: 'Turf',     intensity: 'hard',     durationMin: 45 },
  { time: '6:30 PM', name: 'Restorative Yoga',       instructor: 'Sara K.',   studio: 'Studio B', intensity: 'easy',     durationMin: 60 },
];

/** Parse a 12-hour time string ("7:30 AM") to minutes-since-midnight. */
function parseTime(t: string): number {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return -1;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (period === 'AM' && h === 12) h = 0;
  if (period === 'PM' && h !== 12) h += 12;
  return h * 60 + min;
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function FitnessClassScheduleWidget({
  config,
  live: _live,
}: {
  config?: FitnessClassScheduleConfig;
  live?: boolean;
}) {
  const c: FitnessClassScheduleConfig = config || {};
  const accent = c.accentColor || '#00d4ff';
  const title = c.title || "TODAY'S CLASSES";
  const maxRows = c.maxRows ?? 6;
  const highlightNext = c.highlightNextClass !== false;
  const showPast = c.showPastClasses === true;

  const allClasses = (c.classes && c.classes.length > 0) ? c.classes : DEMO_CLASSES;

  // ─── Classify classes as past / next / future ───
  const now = nowMinutes();

  type ClassRow = FitnessClassScheduleClass & {
    _isPast: boolean;
    _isNext: boolean;
    _minutesMark: number;
  };

  const annotated: ClassRow[] = allClasses.map((cls) => {
    const start = parseTime(cls.time);
    const end = start >= 0 && cls.durationMin ? start + cls.durationMin : start;
    const isPast = end >= 0 && end < now;
    return { ...cls, _isPast: isPast, _isNext: false, _minutesMark: start };
  });

  // Find the next class — the first one that hasn't ended yet.
  if (highlightNext) {
    const nextIdx = annotated.findIndex((r) => !r._isPast && r._minutesMark >= 0);
    if (nextIdx >= 0) annotated[nextIdx]._isNext = true;
  }

  const visible = annotated
    .filter((r) => showPast || !r._isPast || r._isNext)
    .slice(0, maxRows);

  // Intensity dots config
  const intensityDots: Record<string, { count: number; color: string }> = {
    easy:     { count: 1, color: '#22c55e' },
    moderate: { count: 2, color: '#f59e0b' },
    hard:     { count: 3, color: '#ef4444' },
  };

  return (
    <div className="fcsw-root" style={{ '--fcsw-accent': accent } as React.CSSProperties}>
      <style>{CSS}</style>

      {/* Charcoal gradient + radial glow + grain */}
      <div className="fcsw-bg" />
      <div className="fcsw-glow" />
      <div className="fcsw-grain" aria-hidden />

      {/* Title bar */}
      <div className="fcsw-header">
        <span className="fcsw-title-dot" />
        <span className="fcsw-title">{title}</span>
        <span className="fcsw-date">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      </div>

      {/* Class rows */}
      <div className="fcsw-list" role="list">
        {visible.map((cls, i) => {
          const dots = cls.intensity ? intensityDots[cls.intensity] : null;
          return (
            <div
              key={i}
              className={
                'fcsw-row' +
                (cls._isNext ? ' fcsw-row--next' : '') +
                (cls._isPast && !cls._isNext ? ' fcsw-row--past' : '')
              }
              role="listitem"
            >
              {/* Neon left bar — only shown on the next class */}
              {cls._isNext && <div className="fcsw-next-bar" aria-hidden />}

              {/* Time column */}
              <div className="fcsw-time">{cls.time}</div>

              {/* Class name + instructor */}
              <div className="fcsw-meta">
                <div className="fcsw-class-name">
                  {cls.name}
                  {cls._isNext && (
                    <span className="fcsw-next-chip" aria-label="Next class">NEXT</span>
                  )}
                </div>
                <div className="fcsw-instructor-row">
                  {cls.instructor && (
                    <span className="fcsw-instructor">{cls.instructor}</span>
                  )}
                  {cls.durationMin && (
                    <span className="fcsw-duration">{cls.durationMin} min</span>
                  )}
                </div>
              </div>

              {/* Intensity + studio */}
              <div className="fcsw-right">
                {dots && (
                  <div className="fcsw-intensity" aria-label={`Intensity: ${cls.intensity}`}>
                    {Array.from({ length: 3 }, (_, di) => (
                      <span
                        key={di}
                        className="fcsw-dot"
                        style={{
                          background: di < dots.count ? dots.color : 'rgba(255,255,255,0.12)',
                          boxShadow: di < dots.count ? `0 0 6px ${dots.color}` : 'none',
                        }}
                      />
                    ))}
                  </div>
                )}
                {cls.studio && (
                  <div className="fcsw-studio-chip">{cls.studio}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Count of additional classes not shown */}
      {allClasses.length > maxRows && (
        <div className="fcsw-more">
          +{allClasses.length - maxRows} more classes today
        </div>
      )}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&family=Inter+Mono:wght@400;500&display=swap');

.fcsw-root {
  position: absolute; inset: 0;
  overflow: hidden;
  color: #f8fafc;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
}

/* ─── Background stack ─── */
.fcsw-bg {
  position: absolute; inset: 0; z-index: 0;
  background: linear-gradient(160deg, #07070c 0%, #0a0a0f 55%, #0b0b10 100%);
}
.fcsw-glow {
  position: absolute; inset: -20%; z-index: 1;
  pointer-events: none;
  background: radial-gradient(700px 400px at 15% 10%, var(--fcsw-accent, #00d4ff), transparent 65%);
  opacity: 0.09;
  filter: blur(72px);
}
.fcsw-grain {
  position: absolute; inset: 0; z-index: 2;
  pointer-events: none;
  opacity: 0.04;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>");
  mix-blend-mode: overlay;
}

/* ─── Header ─── */
.fcsw-header {
  position: relative; z-index: 10;
  display: flex; align-items: center; gap: clamp(6px, 1.2cqw, 12px);
  padding: clamp(12px, 3cqh, 22px) clamp(14px, 3.5cqw, 28px) clamp(8px, 2cqh, 14px);
  border-bottom: 1px solid rgba(255,255,255,0.07);
}
.fcsw-title-dot {
  flex-shrink: 0;
  width: clamp(7px, 1.2cqh, 11px);
  height: clamp(7px, 1.2cqh, 11px);
  border-radius: 50%;
  background: var(--fcsw-accent, #00d4ff);
  box-shadow: 0 0 14px var(--fcsw-accent, #00d4ff);
  animation: fcsw-blink 2s ease-in-out infinite;
}
@keyframes fcsw-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}
.fcsw-title {
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(13px, 2.8cqh, 26px);
  letter-spacing: 0.25em;
  color: var(--fcsw-accent, #00d4ff);
  text-shadow: 0 0 20px var(--fcsw-accent, #00d4ff);
  text-transform: uppercase;
  flex: 1;
}
.fcsw-date {
  font-family: 'Inter', sans-serif;
  font-size: clamp(10px, 1.5cqh, 13px);
  font-weight: 500;
  color: #475569;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

/* ─── Class list ─── */
.fcsw-list {
  position: relative; z-index: 10;
  display: flex; flex-direction: column;
  padding: 0 clamp(10px, 2.5cqw, 24px);
  overflow: hidden;
}

/* ─── Individual row ─── */
.fcsw-row {
  position: relative;
  display: flex; align-items: center;
  gap: clamp(8px, 2cqw, 18px);
  padding: clamp(9px, 1.8cqh, 16px) clamp(8px, 1.5cqw, 14px);
  border-bottom: 1px solid rgba(255,255,255,0.055);
  border-radius: 6px;
  margin: 1px 0;
  transition: background 300ms ease;
}
.fcsw-row:last-child {
  border-bottom: none;
}
/* Next class — glowing highlight row */
.fcsw-row--next {
  background: rgba(0, 212, 255, 0.06);
  border-bottom-color: rgba(0, 212, 255, 0.12);
}
/* Past classes — ghosted */
.fcsw-row--past {
  opacity: 0.35;
}

/* ─── Neon left accent bar (next class only) ─── */
.fcsw-next-bar {
  position: absolute;
  left: 0; top: 12%; bottom: 12%;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--fcsw-accent, #00d4ff);
  box-shadow: 0 0 14px var(--fcsw-accent, #00d4ff), 0 0 4px var(--fcsw-accent, #00d4ff);
  animation: fcsw-bar-pulse 2.2s ease-in-out infinite;
}
@keyframes fcsw-bar-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 14px var(--fcsw-accent, #00d4ff); }
  50%      { opacity: 0.65; box-shadow: 0 0 28px var(--fcsw-accent, #00d4ff); }
}

/* ─── Time column ─── */
.fcsw-time {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  font-size: clamp(11px, 1.9cqh, 17px);
  color: #94a3b8;
  letter-spacing: 0.04em;
  white-space: nowrap;
  flex-shrink: 0;
  width: clamp(62px, 13cqw, 110px);
  /* Row that is "next" gets slightly brighter time */
}
.fcsw-row--next .fcsw-time {
  color: var(--fcsw-accent, #00d4ff);
  text-shadow: 0 0 10px var(--fcsw-accent, #00d4ff);
}

/* ─── Class name + instructor ─── */
.fcsw-meta {
  flex: 1;
  min-width: 0;
}
.fcsw-class-name {
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: clamp(12px, 2.2cqh, 20px);
  color: #f1f5f9;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex; align-items: center; gap: clamp(5px, 1cqw, 10px);
}
.fcsw-row--next .fcsw-class-name {
  font-size: clamp(13px, 2.6cqh, 23px);
  color: #ffffff;
}

/* NEXT pill */
.fcsw-next-chip {
  display: inline-block;
  padding: 2px clamp(5px, 0.8cqw, 8px);
  background: var(--fcsw-accent, #00d4ff);
  color: #020617;
  font-family: 'Outfit', sans-serif;
  font-weight: 800;
  font-size: clamp(8px, 1.3cqh, 11px);
  letter-spacing: 0.2em;
  border-radius: 3px;
  text-shadow: none;
  flex-shrink: 0;
  animation: fcsw-chip-pulse 1.8s ease-in-out infinite;
  box-shadow: 0 0 12px var(--fcsw-accent, #00d4ff);
}
@keyframes fcsw-chip-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 10px var(--fcsw-accent, #00d4ff); }
  50%      { opacity: 0.8; box-shadow: 0 0 22px var(--fcsw-accent, #00d4ff); }
}

.fcsw-instructor-row {
  display: flex; align-items: center; gap: clamp(6px, 1.2cqw, 12px);
  margin-top: 2px;
}
.fcsw-instructor {
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: clamp(10px, 1.5cqh, 13px);
  color: #64748b;
}
.fcsw-duration {
  font-family: 'JetBrains Mono', monospace;
  font-size: clamp(9px, 1.3cqh, 12px);
  color: #475569;
  font-weight: 500;
}

/* ─── Right column: intensity + studio ─── */
.fcsw-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: clamp(4px, 0.8cqh, 7px);
  flex-shrink: 0;
}

/* 3-dot intensity meter */
.fcsw-intensity {
  display: flex; align-items: center; gap: 3px;
}
.fcsw-dot {
  width: clamp(6px, 1cqh, 9px);
  height: clamp(6px, 1cqh, 9px);
  border-radius: 50%;
  transition: background 200ms;
}

/* Studio chip */
.fcsw-studio-chip {
  padding: 2px clamp(5px, 0.9cqw, 9px);
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 99px;
  font-family: 'Inter', sans-serif;
  font-size: clamp(9px, 1.3cqh, 11px);
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #94a3b8;
  white-space: nowrap;
}

/* ─── "N more" footer ─── */
.fcsw-more {
  position: relative; z-index: 10;
  padding: clamp(6px, 1.2cqh, 10px) clamp(14px, 3.5cqw, 28px);
  font-family: 'Inter', sans-serif;
  font-size: clamp(9px, 1.4cqh, 12px);
  color: #334155;
  letter-spacing: 0.04em;
  border-top: 1px solid rgba(255,255,255,0.05);
}
`;
