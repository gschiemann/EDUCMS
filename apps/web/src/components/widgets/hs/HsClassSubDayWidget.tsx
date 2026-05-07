"use client";

/**
 * HsClassSubDayWidget — Substitute-day self-running plan, 3840×2160.
 *
 * Scene: serif-headline masthead, sub-introduction strip with avatar
 * and three "today" pills, a 5-step substitute plan card with the
 * current step highlighted, a right column of ground rules, "ask in
 * this order" people list, and a personal note from the absent
 * teacher, plus a 4-cell footer (up next / lunch / after school /
 * tomorrow).
 *
 * APPROVED 2026-05-07 — matches scratch/design/hs-district/hs-district-pack/class-subday.html
 * Operator: "these need to be wired in for the highschools"
 *
 * Editable widget regions (each a `data-field` in the JSX):
 *   - room                  → room.code + room.course
 *   - title kicker          → title.kicker + title.t1 + title.t2 (italic accent)
 *   - day                   → day.name + day.date + day.clock (live-ticking)
 *   - sub introduction      → sub.initial + sub.hi + sub.name + sub.pron + sub.blurb
 *   - 3 pills               → pill1.k/v + pill2.k/v + pill3.k/v
 *   - plan header           → plan.t1 + plan.t2 (scribble) + plan.t3 + plan.meta1 + plan.meta2
 *   - 5 plan steps          → step0..4 (n / t / d / 3-4 tags / when / badge)
 *   - ground-rules panel    → rules.title + rules.meta + rules.0..5 (ic / nm / sub / v)
 *   - "ask" panel (teal)    → ask.title + ask.meta + ask.0..3 (in / nm / role / v)
 *   - note panel (dark)     → note.title + note.meta + note.quote + note.sig
 *   - footer cells          → foot.0..3 (k / v / s)
 *
 * Live-clock note: day.clock defaults to "10:24" placeholder; when an
 * operator leaves the default, useHsLiveClock kicks in and renders the
 * real time. Operators who want a frozen marketing screenshot can
 * type any other value to pin it.
 */

import { HsStage } from './HsStage';
import { useHsLiveClock } from './useHsLiveClock';

export interface HsClassSubDayConfig {
  'room.code'?: string;
  'room.course'?: string;
  'title.kicker'?: string;
  'title.t1'?: string;
  'title.t2'?: string;
  'day.name'?: string;
  'day.date'?: string;
  'day.clock'?: string;
  'sub.initial'?: string;
  'sub.hi'?: string;
  'sub.name'?: string;
  'sub.pron'?: string;
  'sub.blurb'?: string;
  'pill1.k'?: string;
  'pill1.v'?: string;
  'pill2.k'?: string;
  'pill2.v'?: string;
  'pill3.k'?: string;
  'pill3.v'?: string;
  'plan.t1'?: string;
  'plan.t2'?: string;
  'plan.t3'?: string;
  'plan.meta1'?: string;
  'plan.meta2'?: string;
  'step0.n'?: string;
  'step0.t'?: string;
  'step0.d'?: string;
  'step0.tag1'?: string;
  'step0.tag2'?: string;
  'step0.tag3'?: string;
  'step0.when'?: string;
  'step0.badge'?: string;
  'step1.n'?: string;
  'step1.t'?: string;
  'step1.d'?: string;
  'step1.tag1'?: string;
  'step1.tag2'?: string;
  'step1.tag3'?: string;
  'step1.when'?: string;
  'step1.badge'?: string;
  'step2.n'?: string;
  'step2.t'?: string;
  'step2.d'?: string;
  'step2.tag1'?: string;
  'step2.tag2'?: string;
  'step2.tag3'?: string;
  'step2.tag4'?: string;
  'step2.when'?: string;
  'step2.badge'?: string;
  'step3.n'?: string;
  'step3.t'?: string;
  'step3.d'?: string;
  'step3.tag1'?: string;
  'step3.tag2'?: string;
  'step3.tag3'?: string;
  'step3.when'?: string;
  'step3.badge'?: string;
  'step4.n'?: string;
  'step4.t'?: string;
  'step4.d'?: string;
  'step4.tag1'?: string;
  'step4.tag2'?: string;
  'step4.tag3'?: string;
  'step4.when'?: string;
  'step4.badge'?: string;
  'rules.title'?: string;
  'rules.meta'?: string;
  'rules.0.ic'?: string;
  'rules.0.nm'?: string;
  'rules.0.sub'?: string;
  'rules.0.v'?: string;
  'rules.1.ic'?: string;
  'rules.1.nm'?: string;
  'rules.1.sub'?: string;
  'rules.1.v'?: string;
  'rules.2.ic'?: string;
  'rules.2.nm'?: string;
  'rules.2.sub'?: string;
  'rules.2.v'?: string;
  'rules.3.ic'?: string;
  'rules.3.nm'?: string;
  'rules.3.sub'?: string;
  'rules.3.v'?: string;
  'rules.4.ic'?: string;
  'rules.4.nm'?: string;
  'rules.4.sub'?: string;
  'rules.4.v'?: string;
  'rules.5.ic'?: string;
  'rules.5.nm'?: string;
  'rules.5.sub'?: string;
  'rules.5.v'?: string;
  'ask.title'?: string;
  'ask.meta'?: string;
  'ask.0.in'?: string;
  'ask.0.nm'?: string;
  'ask.0.role'?: string;
  'ask.0.v'?: string;
  'ask.1.in'?: string;
  'ask.1.nm'?: string;
  'ask.1.role'?: string;
  'ask.1.v'?: string;
  'ask.2.in'?: string;
  'ask.2.nm'?: string;
  'ask.2.role'?: string;
  'ask.2.v'?: string;
  'ask.3.in'?: string;
  'ask.3.nm'?: string;
  'ask.3.role'?: string;
  'ask.3.v'?: string;
  'note.title'?: string;
  'note.meta'?: string;
  'note.quote'?: string;
  'note.sig'?: string;
  'foot.0.k'?: string;
  'foot.0.v'?: string;
  'foot.0.s'?: string;
  'foot.1.k'?: string;
  'foot.1.v'?: string;
  'foot.1.s'?: string;
  'foot.2.k'?: string;
  'foot.2.v'?: string;
  'foot.2.s'?: string;
  'foot.3.k'?: string;
  'foot.3.v'?: string;
  'foot.3.s'?: string;
}

export const DEFAULTS: Required<HsClassSubDayConfig> = {
  'room.code': 'ROOM 218 · B-WING · WHS',
  'room.course': 'Algebra II · Period 3',
  'title.kicker': 'Today · Ms. Reyes is out',
  'title.t1': "We've got a ",
  'title.t2': 'sub day.',
  'day.name': 'Wednesday',
  'day.date': 'Oct 15 · A-day · regular bell',
  'day.clock': '10:24',
  'sub.initial': 'M',
  'sub.hi': "Hi everyone — I'm",
  'sub.name': 'Mr. Marcus Whitfield',
  'sub.pron': 'he · him',
  'sub.blurb': "I sub at Westridge two days a week and I taught math for 22 years before that. Ms. Reyes left a great plan for today — let's get through it together. I'll be at her desk; raise a hand if you need me.",
  'pill1.k': 'Period 3 · 51 min',
  'pill1.v': 'Bell 10:46',
  'pill2.k': 'Sub call code',
  'pill2.v': 'AESOP #84112',
  'pill3.k': 'Ms. Reyes back',
  'pill3.v': 'Thursday',
  'plan.t1': "Today's ",
  'plan.t2': 'plan',
  'plan.t3': ' · 5 steps',
  'plan.meta1': 'Self-running',
  'plan.meta2': 'Unit 4 · Day 3',
  'step0.n': '1',
  'step0.t': 'Warm-up · 5 problems on the board',
  'step0.d': "Solve quietly in your notebook. Answers in the back of the room when you're done — go check yourself.",
  'step0.tag1': 'Solo',
  'step0.tag2': 'Notebook',
  'step0.tag3': '5 problems',
  'step0.when': '10:00–10:08',
  'step0.badge': '✓ Done',
  'step1.n': '2',
  'step1.t': 'Watch · Khan Academy on factoring quadratics',
  'step1.d': '12-minute video on the projector. Take 3 notes per minute — one example, one rule, one question. Notes get stamped at the door.',
  'step1.tag1': 'Whole class',
  'step1.tag2': '12 min video',
  'step1.tag3': '3-per-min notes',
  'step1.when': '10:08–10:20',
  'step1.badge': '✓ Done',
  'step2.n': '3',
  'step2.t': 'Practice · packet pp. 41–43, problems 1–18',
  'step2.d': "Work with your shoulder partner. Skip nothing — circle anything you can't get past. We'll come back to the hard ones together. Calculators are fine.",
  'step2.tag1': 'Pairs',
  'step2.tag2': 'Packet',
  'step2.tag3': 'Calculators OK',
  'step2.tag4': 'Show work',
  'step2.when': '10:20–10:38',
  'step2.badge': '● Right now',
  'step3.n': '4',
  'step3.t': 'Share-out · 3 problems on the board',
  'step3.d': 'Volunteers put up #5, #11, and #17. Whole class checks the work, asks one question each. I\'ll moderate; Ms. Reyes wants real talk, not just "looks good."',
  'step3.tag1': 'Whole class',
  'step3.tag2': 'Whiteboard',
  'step3.tag3': '3 students',
  'step3.when': '10:38–10:44',
  'step3.badge': 'Up next',
  'step4.n': '5',
  'step4.t': 'Exit slip · drop on the way out',
  'step4.d': 'Half-sheet on the front desk. One question on factoring, one feeling-check, your name on top. Hand it to me as you leave — quietly, please.',
  'step4.tag1': 'Solo',
  'step4.tag2': 'Half-sheet',
  'step4.tag3': '2 min',
  'step4.when': '10:44–10:46',
  'step4.badge': 'Last step',
  'rules.title': "Today's ground rules",
  'rules.meta': 'Sub-day basics',
  'rules.0.ic': '🚻',
  'rules.0.nm': 'Restroom',
  'rules.0.sub': 'Sign the clipboard · one at a time',
  'rules.0.v': 'OK · 1 at a time',
  'rules.1.ic': '📱',
  'rules.1.nm': 'Phones',
  'rules.1.sub': 'Caddy by the door · pick up at bell',
  'rules.1.v': 'Caddy · away',
  'rules.2.ic': '💻',
  'rules.2.nm': 'Chromebooks',
  'rules.2.sub': 'Only for Khan video step',
  'rules.2.v': 'Step 2 only',
  'rules.3.ic': '🎧',
  'rules.3.nm': 'Headphones',
  'rules.3.sub': 'Solo work only · one ear',
  'rules.3.v': 'One ear OK',
  'rules.4.ic': '🍿',
  'rules.4.nm': 'Snacks',
  'rules.4.sub': 'Water yes · food no',
  'rules.4.v': 'Water only',
  'rules.5.ic': '🤝',
  'rules.5.nm': 'Talking',
  'rules.5.sub': 'Shoulder partner volume',
  'rules.5.v': 'Pairs OK',
  'ask.title': 'Stuck? ask in this order',
  'ask.meta': 'Then me · then office',
  'ask.0.in': 'PR',
  'ask.0.nm': 'Priya R. · row 1',
  'ask.0.role': 'Math captain · ask first',
  'ask.0.v': 'Row 1',
  'ask.1.in': 'JC',
  'ask.1.nm': 'Jordan C. · row 3',
  'ask.1.role': 'Knows the packet cold',
  'ask.1.v': 'Row 3',
  'ask.2.in': 'MW',
  'ask.2.nm': 'Me · Mr. Whitfield',
  'ask.2.role': 'At the teacher desk · raise a hand',
  'ask.2.v': 'Front desk',
  'ask.3.in': 'LK',
  'ask.3.nm': 'Mr. Liang next door · 220',
  'ask.3.role': "If I'm with someone — knock",
  'ask.3.v': 'Rm 220',
  'note.title': 'From Ms. Reyes',
  'note.meta': 'She emailed me at 6am',
  'note.quote': 'Tell them I trust them. Period 3 is my favorite — they know the routines and they help each other. If anyone finishes early, p. 44 is challenge problems. See everyone Thursday.',
  'note.sig': '— Ms. R · sent 6:14 am',
  'foot.0.k': 'Up next',
  'foot.0.v': 'Period 4 · Advisory',
  'foot.0.s': 'Same room · 10:50',
  'foot.1.k': 'Lunch',
  'foot.1.v': 'Block B · 11:42',
  'foot.1.s': 'Cafeteria · grill is hot today',
  'foot.2.k': 'After school',
  'foot.2.v': 'Math help · Rm 218',
  'foot.2.s': 'Mr. Liang covers · 3–4pm',
  'foot.3.k': 'Tomorrow',
  'foot.3.v': 'Ms. Reyes back',
  'foot.3.s': 'Quiz Friday · be ready',
};

export function HsClassSubDayWidget({ config, live }: { config?: HsClassSubDayConfig; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsClassSubDayConfig>;
  // Live clock — operator override wins; default placeholder ticks live.
  const now = useHsLiveClock(live !== false);
  const liveClock = c['day.clock'] === DEFAULTS['day.clock']
    ? now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : c['day.clock'];

  return (
    <HsStage
      stageStyle={{
        background: '#fff8e9',
        fontFamily: "'Inter', sans-serif",
        color: '#1a1408',
      }}
    >
      <style>{CSS}</style>

      {/* Background noise + soft warm glow */}
      <div className="hs-csd-bgfx" />

      {/* MASTHEAD */}
      <header className="hs-csd-mast">
        <div className="hs-csd-mast-room">
          <div className="hs-csd-mast-code" data-field="room.code" style={{ whiteSpace: 'pre-wrap' as const }}>{c['room.code']}</div>
          <div className="hs-csd-mast-name" data-field="room.course" style={{ whiteSpace: 'pre-wrap' as const }}>{c['room.course']}</div>
        </div>
        <div className="hs-csd-mast-center">
          <div className="hs-csd-mast-kicker">
            <span data-field="title.kicker" style={{ whiteSpace: 'pre-wrap' as const }}>{c['title.kicker']}</span>
          </div>
          <h1 className="hs-csd-mast-h1">
            <span data-field="title.t1" style={{ whiteSpace: 'pre-wrap' as const }}>{c['title.t1']}</span>
            <span className="hs-csd-mast-acc" data-field="title.t2" style={{ whiteSpace: 'pre-wrap' as const }}>{c['title.t2']}</span>
          </h1>
        </div>
        <div className="hs-csd-mast-right">
          <div className="hs-csd-mast-day" data-field="day.name" style={{ whiteSpace: 'pre-wrap' as const }}>{c['day.name']}</div>
          <div className="hs-csd-mast-date" data-field="day.date" style={{ whiteSpace: 'pre-wrap' as const }}>{c['day.date']}</div>
          <div className="hs-csd-mast-clock" data-field="day.clock" style={{ whiteSpace: 'pre-wrap' as const }}>{liveClock}</div>
        </div>
      </header>

      {/* SUB INTRODUCTION STRIP */}
      <section className="hs-csd-sub">
        <div className="hs-csd-sub-avatar" data-field="sub.initial" style={{ whiteSpace: 'pre-wrap' as const }}>{c['sub.initial']}</div>
        <div className="hs-csd-sub-text">
          <div className="hs-csd-sub-hi" data-field="sub.hi" style={{ whiteSpace: 'pre-wrap' as const }}>{c['sub.hi']}</div>
          <div className="hs-csd-sub-name">
            <span data-field="sub.name" style={{ whiteSpace: 'pre-wrap' as const }}>{c['sub.name']}</span>
            <span className="hs-csd-sub-pron" data-field="sub.pron" style={{ whiteSpace: 'pre-wrap' as const }}>{c['sub.pron']}</span>
          </div>
          <div className="hs-csd-sub-blurb" data-field="sub.blurb" style={{ whiteSpace: 'pre-wrap' as const }}>{c['sub.blurb']}</div>
        </div>
        <div className="hs-csd-sub-right">
          <div className="hs-csd-pill hs-csd-pill-warm">
            <span data-field="pill1.k" style={{ whiteSpace: 'pre-wrap' as const }}>{c['pill1.k']}</span>
            <span className="hs-csd-pill-v" data-field="pill1.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['pill1.v']}</span>
          </div>
          <div className="hs-csd-pill">
            <span data-field="pill2.k" style={{ whiteSpace: 'pre-wrap' as const }}>{c['pill2.k']}</span>
            <span className="hs-csd-pill-v" data-field="pill2.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['pill2.v']}</span>
          </div>
          <div className="hs-csd-pill">
            <span data-field="pill3.k" style={{ whiteSpace: 'pre-wrap' as const }}>{c['pill3.k']}</span>
            <span className="hs-csd-pill-v" data-field="pill3.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['pill3.v']}</span>
          </div>
        </div>
      </section>

      {/* PLAN CARD */}
      <article className="hs-csd-plan">
        <div className="hs-csd-plan-head">
          <h2 className="hs-csd-plan-h2">
            <span data-field="plan.t1" style={{ whiteSpace: 'pre-wrap' as const }}>{c['plan.t1']}</span>
            <span className="hs-csd-plan-scribble" data-field="plan.t2" style={{ whiteSpace: 'pre-wrap' as const }}>{c['plan.t2']}</span>
            <span data-field="plan.t3" style={{ whiteSpace: 'pre-wrap' as const }}>{c['plan.t3']}</span>
          </h2>
          <div className="hs-csd-plan-meta">
            <span data-field="plan.meta1" style={{ whiteSpace: 'pre-wrap' as const }}>{c['plan.meta1']}</span>
            <span className="hs-csd-plan-big" data-field="plan.meta2" style={{ whiteSpace: 'pre-wrap' as const }}>{c['plan.meta2']}</span>
          </div>
        </div>

        <div className="hs-csd-steps">
          {/* Step 0 — done */}
          <div className="hs-csd-step hs-csd-done">
            <div className="hs-csd-step-n"><span data-field="step0.n" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step0.n']}</span></div>
            <div className="hs-csd-step-body">
              <div className="hs-csd-step-t" data-field="step0.t" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step0.t']}</div>
              <div className="hs-csd-step-d" data-field="step0.d" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step0.d']}</div>
              <div className="hs-csd-step-tags">
                <span className="hs-csd-tag-ic" data-field="step0.tag1" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step0.tag1']}</span>
                <span data-field="step0.tag2" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step0.tag2']}</span>
                <span data-field="step0.tag3" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step0.tag3']}</span>
              </div>
            </div>
            <div className="hs-csd-step-right">
              <div className="hs-csd-step-when" data-field="step0.when" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step0.when']}</div>
              <div className="hs-csd-step-badge" data-field="step0.badge" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step0.badge']}</div>
            </div>
          </div>

          {/* Step 1 — done */}
          <div className="hs-csd-step hs-csd-done">
            <div className="hs-csd-step-n"><span data-field="step1.n" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step1.n']}</span></div>
            <div className="hs-csd-step-body">
              <div className="hs-csd-step-t" data-field="step1.t" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step1.t']}</div>
              <div className="hs-csd-step-d" data-field="step1.d" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step1.d']}</div>
              <div className="hs-csd-step-tags">
                <span className="hs-csd-tag-ic" data-field="step1.tag1" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step1.tag1']}</span>
                <span data-field="step1.tag2" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step1.tag2']}</span>
                <span data-field="step1.tag3" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step1.tag3']}</span>
              </div>
            </div>
            <div className="hs-csd-step-right">
              <div className="hs-csd-step-when" data-field="step1.when" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step1.when']}</div>
              <div className="hs-csd-step-badge" data-field="step1.badge" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step1.badge']}</div>
            </div>
          </div>

          {/* Step 2 — now */}
          <div className="hs-csd-step hs-csd-now">
            <div className="hs-csd-step-n"><span data-field="step2.n" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step2.n']}</span></div>
            <div className="hs-csd-step-body">
              <div className="hs-csd-step-t" data-field="step2.t" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step2.t']}</div>
              <div className="hs-csd-step-d" data-field="step2.d" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step2.d']}</div>
              <div className="hs-csd-step-tags">
                <span className="hs-csd-tag-ic" data-field="step2.tag1" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step2.tag1']}</span>
                <span data-field="step2.tag2" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step2.tag2']}</span>
                <span data-field="step2.tag3" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step2.tag3']}</span>
                <span data-field="step2.tag4" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step2.tag4']}</span>
              </div>
            </div>
            <div className="hs-csd-step-right">
              <div className="hs-csd-step-when" data-field="step2.when" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step2.when']}</div>
              <div className="hs-csd-step-badge" data-field="step2.badge" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step2.badge']}</div>
            </div>
          </div>

          {/* Step 3 — upcoming */}
          <div className="hs-csd-step">
            <div className="hs-csd-step-n"><span data-field="step3.n" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step3.n']}</span></div>
            <div className="hs-csd-step-body">
              <div className="hs-csd-step-t" data-field="step3.t" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step3.t']}</div>
              <div className="hs-csd-step-d" data-field="step3.d" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step3.d']}</div>
              <div className="hs-csd-step-tags">
                <span className="hs-csd-tag-ic" data-field="step3.tag1" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step3.tag1']}</span>
                <span data-field="step3.tag2" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step3.tag2']}</span>
                <span data-field="step3.tag3" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step3.tag3']}</span>
              </div>
            </div>
            <div className="hs-csd-step-right">
              <div className="hs-csd-step-when" data-field="step3.when" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step3.when']}</div>
              <div className="hs-csd-step-badge" data-field="step3.badge" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step3.badge']}</div>
            </div>
          </div>

          {/* Step 4 — upcoming */}
          <div className="hs-csd-step">
            <div className="hs-csd-step-n"><span data-field="step4.n" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step4.n']}</span></div>
            <div className="hs-csd-step-body">
              <div className="hs-csd-step-t" data-field="step4.t" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step4.t']}</div>
              <div className="hs-csd-step-d" data-field="step4.d" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step4.d']}</div>
              <div className="hs-csd-step-tags">
                <span className="hs-csd-tag-ic" data-field="step4.tag1" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step4.tag1']}</span>
                <span data-field="step4.tag2" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step4.tag2']}</span>
                <span data-field="step4.tag3" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step4.tag3']}</span>
              </div>
            </div>
            <div className="hs-csd-step-right">
              <div className="hs-csd-step-when" data-field="step4.when" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step4.when']}</div>
              <div className="hs-csd-step-badge" data-field="step4.badge" style={{ whiteSpace: 'pre-wrap' as const }}>{c['step4.badge']}</div>
            </div>
          </div>
        </div>
      </article>

      {/* RIGHT COLUMN: rules + ask + note */}
      <aside className="hs-csd-col">
        <div className="hs-csd-panel">
          <h3 className="hs-csd-panel-h3">
            <span data-field="rules.title" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.title']}</span>
            <span className="hs-csd-panel-meta" data-field="rules.meta" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.meta']}</span>
          </h3>
          <div className="hs-csd-rules">
            <div className="hs-csd-rule">
              <div className="hs-csd-rule-ic" data-field="rules.0.ic" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.0.ic']}</div>
              <div className="hs-csd-rule-nm">
                <span data-field="rules.0.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.0.nm']}</span>
                <small data-field="rules.0.sub" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.0.sub']}</small>
              </div>
              <div className="hs-csd-rule-v" data-field="rules.0.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.0.v']}</div>
            </div>
            <div className="hs-csd-rule">
              <div className="hs-csd-rule-ic" data-field="rules.1.ic" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.1.ic']}</div>
              <div className="hs-csd-rule-nm">
                <span data-field="rules.1.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.1.nm']}</span>
                <small data-field="rules.1.sub" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.1.sub']}</small>
              </div>
              <div className="hs-csd-rule-v hs-csd-rule-no" data-field="rules.1.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.1.v']}</div>
            </div>
            <div className="hs-csd-rule">
              <div className="hs-csd-rule-ic" data-field="rules.2.ic" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.2.ic']}</div>
              <div className="hs-csd-rule-nm">
                <span data-field="rules.2.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.2.nm']}</span>
                <small data-field="rules.2.sub" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.2.sub']}</small>
              </div>
              <div className="hs-csd-rule-v hs-csd-rule-maybe" data-field="rules.2.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.2.v']}</div>
            </div>
            <div className="hs-csd-rule">
              <div className="hs-csd-rule-ic" data-field="rules.3.ic" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.3.ic']}</div>
              <div className="hs-csd-rule-nm">
                <span data-field="rules.3.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.3.nm']}</span>
                <small data-field="rules.3.sub" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.3.sub']}</small>
              </div>
              <div className="hs-csd-rule-v hs-csd-rule-maybe" data-field="rules.3.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.3.v']}</div>
            </div>
            <div className="hs-csd-rule">
              <div className="hs-csd-rule-ic" data-field="rules.4.ic" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.4.ic']}</div>
              <div className="hs-csd-rule-nm">
                <span data-field="rules.4.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.4.nm']}</span>
                <small data-field="rules.4.sub" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.4.sub']}</small>
              </div>
              <div className="hs-csd-rule-v hs-csd-rule-no" data-field="rules.4.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.4.v']}</div>
            </div>
            <div className="hs-csd-rule">
              <div className="hs-csd-rule-ic" data-field="rules.5.ic" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.5.ic']}</div>
              <div className="hs-csd-rule-nm">
                <span data-field="rules.5.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.5.nm']}</span>
                <small data-field="rules.5.sub" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.5.sub']}</small>
              </div>
              <div className="hs-csd-rule-v" data-field="rules.5.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['rules.5.v']}</div>
            </div>
          </div>
        </div>

        <div className="hs-csd-panel hs-csd-panel-teal">
          <h3 className="hs-csd-panel-h3">
            <span data-field="ask.title" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.title']}</span>
            <span className="hs-csd-panel-meta" data-field="ask.meta" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.meta']}</span>
          </h3>
          <div className="hs-csd-ask">
            <div className="hs-csd-who">
              <div className="hs-csd-who-av" data-field="ask.0.in" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.0.in']}</div>
              <div className="hs-csd-who-nm">
                <span data-field="ask.0.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.0.nm']}</span>
                <small data-field="ask.0.role" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.0.role']}</small>
              </div>
              <div className="hs-csd-who-v" data-field="ask.0.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.0.v']}</div>
            </div>
            <div className="hs-csd-who">
              <div className="hs-csd-who-av hs-csd-who-av-t" data-field="ask.1.in" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.1.in']}</div>
              <div className="hs-csd-who-nm">
                <span data-field="ask.1.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.1.nm']}</span>
                <small data-field="ask.1.role" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.1.role']}</small>
              </div>
              <div className="hs-csd-who-v" data-field="ask.1.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.1.v']}</div>
            </div>
            <div className="hs-csd-who">
              <div className="hs-csd-who-av hs-csd-who-av-g" data-field="ask.2.in" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.2.in']}</div>
              <div className="hs-csd-who-nm">
                <span data-field="ask.2.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.2.nm']}</span>
                <small data-field="ask.2.role" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.2.role']}</small>
              </div>
              <div className="hs-csd-who-v" data-field="ask.2.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.2.v']}</div>
            </div>
            <div className="hs-csd-who">
              <div className="hs-csd-who-av hs-csd-who-av-r" data-field="ask.3.in" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.3.in']}</div>
              <div className="hs-csd-who-nm">
                <span data-field="ask.3.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.3.nm']}</span>
                <small data-field="ask.3.role" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.3.role']}</small>
              </div>
              <div className="hs-csd-who-v" data-field="ask.3.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ask.3.v']}</div>
            </div>
          </div>
        </div>

        <div className="hs-csd-panel hs-csd-panel-dark">
          <h3 className="hs-csd-panel-h3">
            <span data-field="note.title" style={{ whiteSpace: 'pre-wrap' as const }}>{c['note.title']}</span>
            <span className="hs-csd-panel-meta" data-field="note.meta" style={{ whiteSpace: 'pre-wrap' as const }}>{c['note.meta']}</span>
          </h3>
          <div className="hs-csd-note">
            <div className="hs-csd-note-quote" data-field="note.quote" style={{ whiteSpace: 'pre-wrap' as const }}>{c['note.quote']}</div>
            <div className="hs-csd-note-sig" data-field="note.sig" style={{ whiteSpace: 'pre-wrap' as const }}>{c['note.sig']}</div>
          </div>
        </div>
      </aside>

      {/* FOOTER */}
      <footer className="hs-csd-foot">
        <div className="hs-csd-foot-cell">
          <div className="hs-csd-foot-k" data-field="foot.0.k" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.0.k']}</div>
          <div className="hs-csd-foot-v">
            <span data-field="foot.0.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.0.v']}</span>
            <small data-field="foot.0.s" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.0.s']}</small>
          </div>
        </div>
        <div className="hs-csd-foot-cell">
          <div className="hs-csd-foot-k" data-field="foot.1.k" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.1.k']}</div>
          <div className="hs-csd-foot-v">
            <span data-field="foot.1.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.1.v']}</span>
            <small data-field="foot.1.s" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.1.s']}</small>
          </div>
        </div>
        <div className="hs-csd-foot-cell">
          <div className="hs-csd-foot-k" data-field="foot.2.k" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.2.k']}</div>
          <div className="hs-csd-foot-v">
            <span data-field="foot.2.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.2.v']}</span>
            <small data-field="foot.2.s" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.2.s']}</small>
          </div>
        </div>
        <div className="hs-csd-foot-cell">
          <div className="hs-csd-foot-k" data-field="foot.3.k" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.3.k']}</div>
          <div className="hs-csd-foot-v">
            <span data-field="foot.3.v" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.3.v']}</span>
            <small data-field="foot.3.s" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.3.s']}</small>
          </div>
        </div>
      </footer>
    </HsStage>
  );
}

/** Inlined CSS — keeps every pixel value identical to scratch/design/hs-district/hs-district-pack/class-subday.html. */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700;9..144,900&family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap');

.hs-csd-bgfx {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(1400px 900px at 0% 100%, rgba(217,122,44,.10), transparent 60%),
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='n'><feTurbulence baseFrequency='0.85' numOctaves='2'/><feColorMatrix values='0 0 0 0 0.4 0 0 0 0 0.3 0 0 0 0 0.1 0 0 0 0.04 0'/></filter><rect width='400' height='400' filter='url(%23n)'/></svg>");
  background-size: auto, 400px 400px;
}

@keyframes hsCsdBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: .3; } }
@keyframes hsCsdWave { 0%,100% { transform: rotate(-6deg); } 50% { transform: rotate(8deg); } }

/* MASTHEAD */
.hs-csd-mast {
  position: absolute; top: 0; left: 0; right: 0; height: 240px;
  background: #1a1408; color: #fff8e9;
  display: grid; grid-template-columns: auto 1fr auto;
  align-items: center; padding: 0 80px; gap: 48px; z-index: 5;
  border-bottom: 8px solid #d97a2c;
}
.hs-csd-mast-room { display: flex; flex-direction: column; line-height: 1; }
.hs-csd-mast-code {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px;
  letter-spacing: .28em; color: #d97a2c; text-transform: uppercase;
}
.hs-csd-mast-name {
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 96px;
  letter-spacing: -.02em; color: #fff; margin-top: 8px;
}
.hs-csd-mast-center { text-align: center; }
.hs-csd-mast-kicker {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .32em; color: #f4ead0; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 18px; line-height: 1;
}
.hs-csd-mast-kicker::before, .hs-csd-mast-kicker::after {
  content: ''; width: 60px; height: 3px; background: #d97a2c;
}
.hs-csd-mast-h1 {
  margin: 10px 0 0; font-family: 'Fraunces', serif; font-weight: 900; font-size: 120px;
  letter-spacing: -.04em; color: #fff; line-height: .9;
}
.hs-csd-mast-acc { color: #d97a2c; font-style: italic; }
.hs-csd-mast-right {
  display: flex; flex-direction: column; align-items: flex-end;
  line-height: 1; gap: 6px;
}
.hs-csd-mast-day {
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 64px;
  color: #fff; letter-spacing: -.02em;
}
.hs-csd-mast-date {
  font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 24px;
  color: #d97a2c; letter-spacing: .22em; text-transform: uppercase;
}
.hs-csd-mast-clock {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 36px;
  color: #fff; letter-spacing: .18em; margin-top: 6px;
  font-variant-numeric: tabular-nums;
}
.hs-csd-mast-clock::after {
  content: ''; display: inline-block; width: 10px; height: 10px;
  background: #d97a2c; border-radius: 50%; margin-left: 10px;
  animation: hsCsdBlink 1.4s steps(2) infinite; vertical-align: middle;
}

/* SUB INTRO STRIP */
.hs-csd-sub {
  position: absolute; top: 240px; left: 0; right: 0; height: 280px;
  display: grid; grid-template-columns: 480px 1fr auto;
  align-items: center; padding: 0 80px; gap: 48px;
  background: #fffbf0; border-bottom: 3px solid #d8c896; z-index: 4;
}
.hs-csd-sub-avatar {
  width: 280px; height: 280px; margin: -40px 0;
  background: #d97a2c; border: 6px solid #1a1408; border-radius: 50%;
  display: grid; place-items: center;
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 140px;
  color: #fff; letter-spacing: -.04em; position: relative;
  box-shadow: 0 16px 0 #9a4f12;
}
.hs-csd-sub-avatar::after {
  content: '👋'; position: absolute; bottom: -10px; right: -10px;
  width: 96px; height: 96px; background: #fff; border: 5px solid #1a1408;
  border-radius: 50%; display: grid; place-items: center; font-size: 54px;
  animation: hsCsdWave 2s ease-in-out infinite; transform-origin: 60% 80%;
}
.hs-csd-sub-text { display: flex; flex-direction: column; line-height: 1.05; }
.hs-csd-sub-hi {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px;
  letter-spacing: .28em; text-transform: uppercase; color: #9a4f12;
}
.hs-csd-sub-name {
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 108px;
  color: #1a1408; letter-spacing: -.03em; margin-top: 6px;
}
.hs-csd-sub-pron {
  font-family: 'Inter', sans-serif; font-weight: 600; font-size: 36px;
  color: #5e4f33; letter-spacing: 0; font-style: normal;
  margin-left: 14px; vertical-align: middle;
}
.hs-csd-sub-blurb {
  margin-top: 14px; font-family: 'Inter', sans-serif; font-weight: 500;
  font-size: 30px; color: #5e4f33; letter-spacing: 0; text-wrap: pretty;
  max-width: 1900px; line-height: 1.3;
}
.hs-csd-sub-right {
  display: flex; flex-direction: column; gap: 12px; align-items: stretch;
}
.hs-csd-pill {
  padding: 18px 28px; background: #1a1408; color: #fff;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .22em; text-transform: uppercase;
  display: flex; align-items: center; justify-content: space-between;
  gap: 24px; min-width: 520px;
}
.hs-csd-pill-v { color: #d97a2c; font-size: 30px; }
.hs-csd-pill-warm { background: #d97a2c; color: #fff; }
.hs-csd-pill-warm .hs-csd-pill-v { color: #fff; }

/* PLAN CARD */
.hs-csd-plan {
  position: absolute; top: 560px; left: 80px; width: 2380px; height: 1340px;
  background: #fffbf0; border: 4px solid #1a1408;
  box-shadow: 24px 24px 0 #1a1408;
  display: flex; flex-direction: column; z-index: 3;
}
.hs-csd-plan-head {
  padding: 32px 48px 22px; border-bottom: 3px solid #1a1408;
  display: flex; justify-content: space-between; align-items: flex-end;
  background: #d97a2c; color: #fff;
}
.hs-csd-plan-h2 {
  margin: 0; font-family: 'Fraunces', serif; font-weight: 900; font-size: 96px;
  letter-spacing: -.03em; line-height: 1; color: #fff;
}
.hs-csd-plan-scribble {
  display: inline-block; background: #fff; color: #d97a2c;
  padding: 0 .12em; transform: rotate(-1deg);
}
.hs-csd-plan-meta {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px;
  letter-spacing: .22em; text-transform: uppercase; color: #fff;
  text-align: right; line-height: 1.3;
}
.hs-csd-plan-big {
  display: block; font-family: 'Fraunces', serif; font-weight: 900; font-size: 60px;
  letter-spacing: -.02em; color: #fff; margin-top: 4px;
}

.hs-csd-steps {
  flex: 1; padding: 36px 48px;
  display: flex; flex-direction: column; gap: 20px;
}
.hs-csd-step {
  display: grid; grid-template-columns: 120px 1fr 280px;
  gap: 32px; align-items: flex-start;
  padding: 22px 28px; background: #fff; border: 3px solid #1a1408;
  box-shadow: 8px 8px 0 #d8c896; position: relative;
}
.hs-csd-step.hs-csd-now {
  box-shadow: 8px 8px 0 #d97a2c; background: #fffaef;
}
.hs-csd-step-n {
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 120px;
  line-height: .9; color: #1a1408; letter-spacing: -.06em;
}
.hs-csd-done .hs-csd-step-n {
  color: #8e7a52; text-decoration: line-through;
  text-decoration-thickness: 8px; text-decoration-color: #d97a2c;
}
.hs-csd-now .hs-csd-step-n { color: #d97a2c; }
.hs-csd-step-body { display: flex; flex-direction: column; gap: 6px; padding-top: 14px; }
.hs-csd-step-t {
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 54px;
  line-height: 1.05; color: #1a1408; letter-spacing: -.02em; text-wrap: balance;
}
.hs-csd-done .hs-csd-step-t { color: #5e4f33; }
.hs-csd-now .hs-csd-step-t { color: #9a4f12; }
.hs-csd-step-d {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 28px;
  line-height: 1.3; color: #5e4f33; text-wrap: pretty;
}
.hs-csd-step-tags {
  display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px;
}
.hs-csd-step-tags span {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 18px;
  letter-spacing: .2em; text-transform: uppercase;
  background: #f4ead0; color: #9a4f12; padding: 6px 12px; line-height: 1;
}
.hs-csd-step-tags .hs-csd-tag-ic { background: #1a1408; color: #fff8e9; }
.hs-csd-step-right {
  display: flex; flex-direction: column; align-items: flex-end;
  gap: 8px; padding-top: 10px;
}
.hs-csd-step-when {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px;
  letter-spacing: .18em; color: #1a1408; text-transform: uppercase;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.hs-csd-step-badge {
  padding: 8px 16px; font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 18px; letter-spacing: .2em; text-transform: uppercase;
  background: #f4ead0; color: #5e4f33; line-height: 1;
}
.hs-csd-done .hs-csd-step-badge { background: #1f7a4a; color: #fff; }
.hs-csd-now .hs-csd-step-badge {
  background: #d97a2c; color: #fff;
  animation: hsCsdBlink 1.6s steps(2) infinite;
}

/* RIGHT COLUMN */
.hs-csd-col {
  position: absolute; top: 560px; right: 80px; width: 1240px; height: 1340px;
  display: flex; flex-direction: column; gap: 24px; z-index: 3;
}
.hs-csd-panel {
  background: #fffbf0; border: 4px solid #1a1408;
  box-shadow: 16px 16px 0 #1a1408;
  padding: 28px 32px; display: flex; flex-direction: column;
}
.hs-csd-panel-dark {
  background: #1a1408; color: #fff8e9;
  box-shadow: 16px 16px 0 #d97a2c;
}
.hs-csd-panel-teal {
  background: #1f7a78; color: #fff;
  box-shadow: 16px 16px 0 #1a1408;
}
.hs-csd-panel-h3 {
  margin: 0 0 14px; font-family: 'Fraunces', serif; font-weight: 900; font-size: 60px;
  line-height: .95; letter-spacing: -.02em; color: #1a1408;
  border-bottom: 3px solid #1a1408; padding-bottom: 12px;
  display: flex; justify-content: space-between; align-items: baseline;
}
.hs-csd-panel-meta {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 20px;
  letter-spacing: .22em; color: #5e4f33; text-transform: uppercase;
}
.hs-csd-panel-dark .hs-csd-panel-h3 { color: #fff; border-color: #d97a2c; }
.hs-csd-panel-dark .hs-csd-panel-meta { color: #d97a2c; }
.hs-csd-panel-teal .hs-csd-panel-h3 { color: #fff; border-color: #fff; }
.hs-csd-panel-teal .hs-csd-panel-meta { color: rgba(255,255,255,.8); }

.hs-csd-rules { flex: 1; display: flex; flex-direction: column; gap: 14px; }
.hs-csd-rule {
  display: grid; grid-template-columns: auto 1fr auto;
  gap: 20px; align-items: center; padding: 14px 0;
  border-bottom: 2px dashed #d8c896;
}
.hs-csd-rule:last-child { border-bottom: 0; }
.hs-csd-rule-ic {
  width: 64px; height: 64px; border-radius: 50%; background: #f4ead0;
  display: grid; place-items: center; font-size: 36px; flex-shrink: 0;
}
.hs-csd-rule-nm {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 32px;
  color: #1a1408; letter-spacing: -.01em; line-height: 1.2;
}
.hs-csd-rule-nm small {
  display: block; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 22px;
  color: #5e4f33; margin-top: 2px; letter-spacing: 0;
}
.hs-csd-rule-v {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  color: #1f7a4a; letter-spacing: .2em; text-transform: uppercase;
  text-align: right; white-space: nowrap;
}
.hs-csd-rule-no { color: #c84a64; }
.hs-csd-rule-maybe { color: #9a4f12; }

.hs-csd-ask { display: flex; flex-direction: column; gap: 14px; }
.hs-csd-who {
  display: grid; grid-template-columns: auto 1fr auto;
  gap: 18px; align-items: center; padding: 14px 0;
  border-bottom: 2px dashed rgba(255,255,255,.18);
}
.hs-csd-who:last-child { border-bottom: 0; }
.hs-csd-who-av {
  width: 80px; height: 80px; border-radius: 50%;
  background: #d97a2c; color: #fff;
  display: grid; place-items: center;
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 36px;
  border: 3px solid #fff; flex-shrink: 0; letter-spacing: -.02em;
}
.hs-csd-who-av-t { background: #1f7a78; }
.hs-csd-who-av-r { background: #c84a64; }
.hs-csd-who-av-g { background: #1f7a4a; }
.hs-csd-who-nm {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 30px;
  color: #fff; letter-spacing: -.01em; line-height: 1.1;
}
.hs-csd-who-nm small {
  display: block; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 22px;
  color: rgba(255,255,255,.7); margin-top: 2px;
}
.hs-csd-who-v {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  color: #d97a2c; letter-spacing: .18em; text-transform: uppercase;
  text-align: right; white-space: nowrap;
}

.hs-csd-note { flex: 1; display: flex; flex-direction: column; justify-content: center; }
.hs-csd-note-quote {
  font-family: 'Fraunces', serif; font-weight: 500; font-style: italic;
  font-size: 42px; line-height: 1.25; color: #fff; text-wrap: pretty;
}
.hs-csd-note-quote::before {
  content: '"'; font-size: 120px; line-height: .6; color: #d97a2c;
  font-family: 'Fraunces'; margin-right: 8px; vertical-align: -0.4em;
}
.hs-csd-note-sig {
  margin-top: 18px; font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 22px; letter-spacing: .22em; color: #d97a2c; text-transform: uppercase;
}

/* FOOTER */
.hs-csd-foot {
  position: absolute; left: 0; right: 0; bottom: 0; height: 160px;
  background: #1a1408; color: #fff8e9;
  display: grid; grid-template-columns: repeat(4, 1fr);
  align-items: center; padding: 0 80px; gap: 48px; z-index: 5;
  border-top: 8px solid #d97a2c;
}
.hs-csd-foot-cell { display: flex; flex-direction: column; gap: 6px; line-height: 1.05; }
.hs-csd-foot-k {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .24em; color: #d97a2c; text-transform: uppercase;
}
.hs-csd-foot-v {
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 48px;
  color: #fff; letter-spacing: -.01em; text-wrap: balance;
}
.hs-csd-foot-v small {
  display: block; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 22px;
  color: rgba(255,255,255,.65); margin-top: 2px; letter-spacing: 0;
}
`;
