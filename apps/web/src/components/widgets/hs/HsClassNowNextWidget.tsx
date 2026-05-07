"use client";

/**
 * HsClassNowNextWidget — In-classroom "now / next" 4K display, 3840×2160.
 *
 * Scene: current activity hero (what to do RIGHT NOW), today's flow
 * agenda with current step pulsing, do-now + exit-ticket pair cards,
 * homework / class announcement / quiet shoutout band, and a footer
 * showing what's up next after this period.
 *
 * APPROVED 2026-05-07 — matches scratch/design/hs-district/hs-district-pack/class-nownext.html
 * Operator: "these need to be wired in for the highschools"
 *
 * Editable widget regions (each a `data-field` in the JSX):
 *   - room                  → room.code (room + wing label)
 *   - course                → course.name + course.teacher
 *   - clock                 → clock.label + clock.time (live ticks)
 *   - status                → status.label (class-in-session badge)
 *   - progress strip        → progress.lbl + progress.pct + progress.end
 *   - now hero              → now.eyebrow + now.t1 + now.t2 (highlighted) + now.t3 + now.lede
 *                            + now.targetK + now.targetV + 4 meta tiles
 *   - agenda (5 steps)      → agenda.title + agenda.meta + agenda.0..4 (n / nm / sub / t)
 *   - do-now card           → donow.tag + donow.q + donow.note + donow.k + donow.where
 *   - exit-ticket card      → exit.tag + exit.q + exit.note + exit.k + exit.where
 *   - homework band         → hw.tag + hw.title + hw.meta + hw.0..3 (ic / nm / due)
 *   - class announcement    → ann.tag + ann.title + ann.body + ann.when + ann.where
 *   - quiet shoutout        → celebrate.tag + celebrate.title + celebrate.body + celebrate.ic + celebrate.cap
 *   - footer                → foot.k1/v1 + foot.k2/v2 + foot2.day + foot2.cycle
 *
 * Live-clock note: clock.time defaults to "10:24" placeholder; when an
 * operator leaves the default, useHsLiveClock kicks in and renders the
 * real time. Operators who want a frozen marketing screenshot can
 * type any other value to pin it.
 */

import { HsStage } from './HsStage';
import { useHsLiveClock } from './useHsLiveClock';

export interface HsClassNowNextConfig {
  'room.code'?: string;
  'course.name'?: string;
  'course.teacher'?: string;
  'clock.label'?: string;
  'clock.time'?: string;
  'status.label'?: string;
  'progress.lbl'?: string;
  'progress.pct'?: string;
  'progress.end'?: string;
  'now.eyebrow'?: string;
  'now.t1'?: string;
  'now.t2'?: string;
  'now.t3'?: string;
  'now.lede'?: string;
  'now.targetK'?: string;
  'now.targetV'?: string;
  'now.work'?: string;
  'now.left'?: string;
  'now.mat'?: string;
  'now.std'?: string;
  'agenda.title'?: string;
  'agenda.meta'?: string;
  'agenda.0.n'?: string;
  'agenda.0.nm'?: string;
  'agenda.0.sub'?: string;
  'agenda.0.t'?: string;
  'agenda.1.n'?: string;
  'agenda.1.nm'?: string;
  'agenda.1.sub'?: string;
  'agenda.1.t'?: string;
  'agenda.2.n'?: string;
  'agenda.2.nm'?: string;
  'agenda.2.sub'?: string;
  'agenda.2.t'?: string;
  'agenda.3.n'?: string;
  'agenda.3.nm'?: string;
  'agenda.3.sub'?: string;
  'agenda.3.t'?: string;
  'agenda.4.n'?: string;
  'agenda.4.nm'?: string;
  'agenda.4.sub'?: string;
  'agenda.4.t'?: string;
  'donow.tag'?: string;
  'donow.q'?: string;
  'donow.note'?: string;
  'donow.k'?: string;
  'donow.where'?: string;
  'exit.tag'?: string;
  'exit.q'?: string;
  'exit.note'?: string;
  'exit.k'?: string;
  'exit.where'?: string;
  'hw.tag'?: string;
  'hw.title'?: string;
  'hw.meta'?: string;
  'hw.0.ic'?: string;
  'hw.0.nm'?: string;
  'hw.0.due'?: string;
  'hw.1.ic'?: string;
  'hw.1.nm'?: string;
  'hw.1.due'?: string;
  'hw.2.ic'?: string;
  'hw.2.nm'?: string;
  'hw.2.due'?: string;
  'hw.3.ic'?: string;
  'hw.3.nm'?: string;
  'hw.3.due'?: string;
  'ann.tag'?: string;
  'ann.title'?: string;
  'ann.body'?: string;
  'ann.when'?: string;
  'ann.where'?: string;
  'celebrate.tag'?: string;
  'celebrate.title'?: string;
  'celebrate.body'?: string;
  'celebrate.ic'?: string;
  'celebrate.cap'?: string;
  'foot.k1'?: string;
  'foot.v1'?: string;
  'foot.k2'?: string;
  'foot.v2'?: string;
  'foot2.day'?: string;
  'foot2.cycle'?: string;
}

export const DEFAULTS: Required<HsClassNowNextConfig> = {
  'room.code': 'ROOM 218 · B-WING',
  'course.name': 'AP English Literature · Period 3',
  'course.teacher': 'Ms. Han · whan@westridge.org · office hrs Tue/Thu 3–4',
  'clock.label': 'Now',
  'clock.time': '10:24',
  'status.label': 'Class in session',
  'progress.lbl': 'Period 3 · 51 min block',
  'progress.pct': '42% · 22 min in',
  'progress.end': 'Bell at 10:46',
  'now.eyebrow': 'Right now · do this',
  'now.t1': 'Annotate Beloved ',
  'now.t2': 'pp. 84–112',
  'now.t3': ' with a partner.',
  'now.lede': "Mark anywhere Sethe's memory interrupts the present tense. Three colors: pencil for the interruption, blue for the trigger, pink for whose voice is speaking. We'll share at 10:38.",
  'now.targetK': "Today's learning target · I can…",
  'now.targetV': 'trace how Morrison uses non-linear narration to reveal trauma the characters cannot speak about directly, and explain it with two pieces of textual evidence.',
  'now.work': 'Pairs',
  'now.left': '14 min',
  'now.mat': 'Book + 3 pens',
  'now.std': 'RL.11–12.3',
  'agenda.title': "Today's flow",
  'agenda.meta': '5 moves · 51 min',
  'agenda.0.n': '1',
  'agenda.0.nm': 'Do-now: free write',
  'agenda.0.sub': 'In your journal · what comes back?',
  'agenda.0.t': '5 min',
  'agenda.1.n': '2',
  'agenda.1.nm': 'Mini-lesson · narrative time',
  'agenda.1.sub': 'Slide 12 · the rememory frame',
  'agenda.1.t': '10 min',
  'agenda.2.n': '3',
  'agenda.2.nm': 'Pair annotation · pp. 84–112',
  'agenda.2.sub': 'Pencil · blue · pink — three colors',
  'agenda.2.t': '20 min',
  'agenda.3.n': '4',
  'agenda.3.nm': 'Whip-around share',
  'agenda.3.sub': 'One quote each · 30 seconds',
  'agenda.3.t': '10 min',
  'agenda.4.n': '5',
  'agenda.4.nm': 'Exit ticket',
  'agenda.4.sub': 'Index card · I can statement',
  'agenda.4.t': '6 min',
  'donow.tag': 'Do now · started 10:00',
  'donow.q': "What's a memory that comes back uninvited?",
  'donow.note': "Free-write 4 minutes. No editing, no judging. We're not sharing this — it's yours. Keep your pen moving.",
  'donow.k': 'Closed at 10:05',
  'donow.where': 'In your journal · p. 38',
  'exit.tag': 'Exit ticket · before the bell',
  'exit.q': 'In one sentence — how does rememory differ from remembering?',
  'exit.note': "Index card on my desk on the way out. Name in the corner. We'll open class with three of these tomorrow.",
  'exit.k': 'Due 10:46',
  'exit.where': "Drop on Ms. Han's desk",
  'hw.tag': 'Homework · this week',
  'hw.title': 'Read & annotate',
  'hw.meta': '3 things due · check Schoology',
  'hw.0.ic': '📖',
  'hw.0.nm': 'Beloved pp. 113–148 · annotate motifs',
  'hw.0.due': 'Wed',
  'hw.1.ic': '✏',
  'hw.1.nm': 'Lit-circle prep questions · 2 per chapter',
  'hw.1.due': 'Thu',
  'hw.2.ic': '📤',
  'hw.2.nm': 'First draft · close-read paragraph',
  'hw.2.due': 'Fri 11:59p',
  'hw.3.ic': '📚',
  'hw.3.nm': 'Optional · Morrison Nobel speech audio',
  'hw.3.due': 'Anytime',
  'ann.tag': 'Class announcement',
  'ann.title': 'Lit-circles start Thursday — bring your annotated text.',
  'ann.body': "Groups of four. You picked them last week — list is on the board. We'll spend the whole period in circles; bring your book, your annotations, and the discussion question I gave you.",
  'ann.when': 'Thursday · Period 3',
  'ann.where': 'Right here · Rm 218',
  'celebrate.tag': 'Quiet shoutout',
  'celebrate.title': 'Sam & Priya — your annotations are gorgeous.',
  'celebrate.body': "Sam's marginalia on the river scene found something I missed — bring that lens to today's pair work. Priya, your color-coding is the new standard. Show one neighbor.",
  'celebrate.ic': '★',
  'celebrate.cap': 'Period 3 · week of Oct 14',
  'foot.k1': 'Up next:',
  'foot.v1': 'P4 Advisory · Rm 218 · 10:50',
  'foot.k2': 'Then:',
  'foot.v2': 'Lunch B · 11:42',
  'foot2.day': 'Wednesday · A-day · regular bell',
  'foot2.cycle': 'Cycle 7 · day 3 of 8',
};

export function HsClassNowNextWidget({ config, live }: { config?: HsClassNowNextConfig; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsClassNowNextConfig>;
  // Live clock — operator override wins; default placeholder ticks live.
  const now = useHsLiveClock(live !== false);
  const liveClock = c['clock.time'] === DEFAULTS['clock.time']
    ? now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : c['clock.time'];

  return (
    <HsStage
      stageStyle={{
        background: '#fafafa',
        fontFamily: "'Inter', sans-serif",
        color: '#0e0f12',
      }}
    >
      <style>{CSS}</style>

      {/* Background grid + soft brand glow */}
      <div className="hs-cnn-bgfx" />

      {/* HEADER */}
      <header className="hs-cnn-head">
        <div className="hs-cnn-head-left">
          <div className="hs-cnn-room">
            <span data-field="room.code" style={{ whiteSpace: 'pre-wrap' as const }}>{c['room.code']}</span>
          </div>
          <div className="hs-cnn-who">
            <div className="hs-cnn-who-name" data-field="course.name" style={{ whiteSpace: 'pre-wrap' as const }}>{c['course.name']}</div>
            <div className="hs-cnn-who-sub" data-field="course.teacher" style={{ whiteSpace: 'pre-wrap' as const }}>{c['course.teacher']}</div>
          </div>
        </div>
        <div className="hs-cnn-head-right">
          <div className="hs-cnn-stat">
            <div className="hs-cnn-stat-k" data-field="clock.label" style={{ whiteSpace: 'pre-wrap' as const }}>{c['clock.label']}</div>
            <div className="hs-cnn-stat-v" data-field="clock.time" style={{ whiteSpace: 'pre-wrap' as const }}>{liveClock}</div>
          </div>
          <div className="hs-cnn-badge">
            <span data-field="status.label" style={{ whiteSpace: 'pre-wrap' as const }}>{c['status.label']}</span>
          </div>
        </div>
      </header>

      {/* PERIOD STRIP */}
      <section className="hs-cnn-progress">
        <div className="hs-cnn-progress-lbl" data-field="progress.lbl" style={{ whiteSpace: 'pre-wrap' as const }}>{c['progress.lbl']}</div>
        <div className="hs-cnn-progress-bar" />
        <div className="hs-cnn-progress-pct" data-field="progress.pct" style={{ whiteSpace: 'pre-wrap' as const }}>{c['progress.pct']}</div>
        <div className="hs-cnn-progress-end" data-field="progress.end" style={{ whiteSpace: 'pre-wrap' as const }}>{c['progress.end']}</div>
      </section>

      {/* NOW HERO */}
      <article className="hs-cnn-now">
        <div className="hs-cnn-now-stripe" />
        <div className="hs-cnn-now-body">
          <div className="hs-cnn-now-eyebrow">
            <span data-field="now.eyebrow" style={{ whiteSpace: 'pre-wrap' as const }}>{c['now.eyebrow']}</span>
          </div>
          <h1 className="hs-cnn-now-h1">
            <span data-field="now.t1" style={{ whiteSpace: 'pre-wrap' as const }}>{c['now.t1']}</span>
            <span className="hs-cnn-hl" data-field="now.t2" style={{ whiteSpace: 'pre-wrap' as const }}>{c['now.t2']}</span>
            <span data-field="now.t3" style={{ whiteSpace: 'pre-wrap' as const }}>{c['now.t3']}</span>
          </h1>
          <p className="hs-cnn-now-lede" data-field="now.lede" style={{ whiteSpace: 'pre-wrap' as const }}>{c['now.lede']}</p>
          <div className="hs-cnn-now-target">
            <div className="hs-cnn-now-target-k" data-field="now.targetK" style={{ whiteSpace: 'pre-wrap' as const }}>{c['now.targetK']}</div>
            <div className="hs-cnn-now-target-v" data-field="now.targetV" style={{ whiteSpace: 'pre-wrap' as const }}>{c['now.targetV']}</div>
          </div>
          <div className="hs-cnn-now-meta">
            <div className="hs-cnn-now-meta-it">
              <div className="hs-cnn-now-meta-k">Working in</div>
              <div className="hs-cnn-now-meta-v" data-field="now.work" style={{ whiteSpace: 'pre-wrap' as const }}>{c['now.work']}</div>
            </div>
            <div className="hs-cnn-now-meta-it">
              <div className="hs-cnn-now-meta-k">Time left</div>
              <div className="hs-cnn-now-meta-v hs-cnn-brand" data-field="now.left" style={{ whiteSpace: 'pre-wrap' as const }}>{c['now.left']}</div>
            </div>
            <div className="hs-cnn-now-meta-it">
              <div className="hs-cnn-now-meta-k">Materials</div>
              <div className="hs-cnn-now-meta-v" data-field="now.mat" style={{ whiteSpace: 'pre-wrap' as const }}>{c['now.mat']}</div>
            </div>
            <div className="hs-cnn-now-meta-it">
              <div className="hs-cnn-now-meta-k">Standard</div>
              <div className="hs-cnn-now-meta-v hs-cnn-warm" data-field="now.std" style={{ whiteSpace: 'pre-wrap' as const }}>{c['now.std']}</div>
            </div>
          </div>
        </div>
      </article>

      {/* RIGHT COLUMN: agenda + do-now/exit pair */}
      <aside className="hs-cnn-col">
        <div className="hs-cnn-agenda">
          <h3 className="hs-cnn-agenda-h3">
            <span data-field="agenda.title" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.title']}</span>
            <span className="hs-cnn-agenda-meta" data-field="agenda.meta" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.meta']}</span>
          </h3>
          <ul className="hs-cnn-agenda-ul">
            <li className="hs-cnn-agenda-li hs-cnn-done">
              <div className="hs-cnn-agenda-step"><span data-field="agenda.0.n" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.0.n']}</span></div>
              <div className="hs-cnn-agenda-nm">
                <span data-field="agenda.0.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.0.nm']}</span>
                <span className="hs-cnn-agenda-sub" data-field="agenda.0.sub" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.0.sub']}</span>
              </div>
              <div className="hs-cnn-agenda-t" data-field="agenda.0.t" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.0.t']}</div>
            </li>
            <li className="hs-cnn-agenda-li hs-cnn-done">
              <div className="hs-cnn-agenda-step"><span data-field="agenda.1.n" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.1.n']}</span></div>
              <div className="hs-cnn-agenda-nm">
                <span data-field="agenda.1.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.1.nm']}</span>
                <span className="hs-cnn-agenda-sub" data-field="agenda.1.sub" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.1.sub']}</span>
              </div>
              <div className="hs-cnn-agenda-t" data-field="agenda.1.t" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.1.t']}</div>
            </li>
            <li className="hs-cnn-agenda-li hs-cnn-now-li">
              <div className="hs-cnn-agenda-step"><span data-field="agenda.2.n" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.2.n']}</span></div>
              <div className="hs-cnn-agenda-nm">
                <span data-field="agenda.2.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.2.nm']}</span>
                <span className="hs-cnn-agenda-sub" data-field="agenda.2.sub" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.2.sub']}</span>
              </div>
              <div className="hs-cnn-agenda-t" data-field="agenda.2.t" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.2.t']}</div>
            </li>
            <li className="hs-cnn-agenda-li">
              <div className="hs-cnn-agenda-step"><span data-field="agenda.3.n" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.3.n']}</span></div>
              <div className="hs-cnn-agenda-nm">
                <span data-field="agenda.3.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.3.nm']}</span>
                <span className="hs-cnn-agenda-sub" data-field="agenda.3.sub" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.3.sub']}</span>
              </div>
              <div className="hs-cnn-agenda-t" data-field="agenda.3.t" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.3.t']}</div>
            </li>
            <li className="hs-cnn-agenda-li">
              <div className="hs-cnn-agenda-step"><span data-field="agenda.4.n" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.4.n']}</span></div>
              <div className="hs-cnn-agenda-nm">
                <span data-field="agenda.4.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.4.nm']}</span>
                <span className="hs-cnn-agenda-sub" data-field="agenda.4.sub" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.4.sub']}</span>
              </div>
              <div className="hs-cnn-agenda-t" data-field="agenda.4.t" style={{ whiteSpace: 'pre-wrap' as const }}>{c['agenda.4.t']}</div>
            </li>
          </ul>
        </div>

        <div className="hs-cnn-pair">
          <div className="hs-cnn-card">
            <div className="hs-cnn-card-tag" data-field="donow.tag" style={{ whiteSpace: 'pre-wrap' as const }}>{c['donow.tag']}</div>
            <h4 className="hs-cnn-card-h4" data-field="donow.q" style={{ whiteSpace: 'pre-wrap' as const }}>{c['donow.q']}</h4>
            <p className="hs-cnn-card-p" data-field="donow.note" style={{ whiteSpace: 'pre-wrap' as const }}>{c['donow.note']}</p>
            <div className="hs-cnn-card-when">
              <span className="hs-cnn-card-when-k" data-field="donow.k" style={{ whiteSpace: 'pre-wrap' as const }}>{c['donow.k']}</span>
              <span data-field="donow.where" style={{ whiteSpace: 'pre-wrap' as const }}>{c['donow.where']}</span>
            </div>
          </div>
          <div className="hs-cnn-card hs-cnn-exit">
            <div className="hs-cnn-card-tag" data-field="exit.tag" style={{ whiteSpace: 'pre-wrap' as const }}>{c['exit.tag']}</div>
            <h4 className="hs-cnn-card-h4" data-field="exit.q" style={{ whiteSpace: 'pre-wrap' as const }}>{c['exit.q']}</h4>
            <p className="hs-cnn-card-p" data-field="exit.note" style={{ whiteSpace: 'pre-wrap' as const }}>{c['exit.note']}</p>
            <div className="hs-cnn-card-when">
              <span className="hs-cnn-card-when-k" data-field="exit.k" style={{ whiteSpace: 'pre-wrap' as const }}>{c['exit.k']}</span>
              <span data-field="exit.where" style={{ whiteSpace: 'pre-wrap' as const }}>{c['exit.where']}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* HOMEWORK / ANNOUNCEMENT BAND */}
      <section className="hs-cnn-band">
        <div className="hs-cnn-b">
          <div className="hs-cnn-b-tag" data-field="hw.tag" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.tag']}</div>
          <h4 className="hs-cnn-b-h4" data-field="hw.title" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.title']}</h4>
          <div className="hs-cnn-b-meta" data-field="hw.meta" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.meta']}</div>
          <ul className="hs-cnn-b-ul">
            <li className="hs-cnn-urgent">
              <div className="hs-cnn-b-ic" data-field="hw.0.ic" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.0.ic']}</div>
              <div data-field="hw.0.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.0.nm']}</div>
              <div className="hs-cnn-b-due" data-field="hw.0.due" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.0.due']}</div>
            </li>
            <li>
              <div className="hs-cnn-b-ic" data-field="hw.1.ic" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.1.ic']}</div>
              <div data-field="hw.1.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.1.nm']}</div>
              <div className="hs-cnn-b-due" data-field="hw.1.due" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.1.due']}</div>
            </li>
            <li>
              <div className="hs-cnn-b-ic" data-field="hw.2.ic" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.2.ic']}</div>
              <div data-field="hw.2.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.2.nm']}</div>
              <div className="hs-cnn-b-due" data-field="hw.2.due" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.2.due']}</div>
            </li>
            <li>
              <div className="hs-cnn-b-ic" data-field="hw.3.ic" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.3.ic']}</div>
              <div data-field="hw.3.nm" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.3.nm']}</div>
              <div className="hs-cnn-b-due" data-field="hw.3.due" style={{ whiteSpace: 'pre-wrap' as const }}>{c['hw.3.due']}</div>
            </li>
          </ul>
        </div>

        <div className="hs-cnn-b hs-cnn-dark">
          <div className="hs-cnn-b-tag" data-field="ann.tag" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ann.tag']}</div>
          <h4 className="hs-cnn-b-h4" data-field="ann.title" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ann.title']}</h4>
          <p className="hs-cnn-b-p" data-field="ann.body" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ann.body']}</p>
          <div className="hs-cnn-b-when">
            <span data-field="ann.when" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ann.when']}</span>
            <span className="hs-cnn-b-where" data-field="ann.where" style={{ whiteSpace: 'pre-wrap' as const }}>{c['ann.where']}</span>
          </div>
        </div>

        <div className="hs-cnn-b hs-cnn-green">
          <div className="hs-cnn-b-tag" data-field="celebrate.tag" style={{ whiteSpace: 'pre-wrap' as const }}>{c['celebrate.tag']}</div>
          <h4 className="hs-cnn-b-h4" data-field="celebrate.title" style={{ whiteSpace: 'pre-wrap' as const }}>{c['celebrate.title']}</h4>
          <p className="hs-cnn-b-p" data-field="celebrate.body" style={{ whiteSpace: 'pre-wrap' as const }}>{c['celebrate.body']}</p>
          <ul style={{ marginTop: 'auto', padding: 0, listStyle: 'none' }}>
            <li className="hs-cnn-b-cap">
              <div className="hs-cnn-b-ic hs-cnn-b-ic-light" data-field="celebrate.ic" style={{ whiteSpace: 'pre-wrap' as const }}>{c['celebrate.ic']}</div>
              <span data-field="celebrate.cap" style={{ whiteSpace: 'pre-wrap' as const }}>{c['celebrate.cap']}</span>
            </li>
          </ul>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="hs-cnn-foot">
        <div className="hs-cnn-foot-left">
          <span>
            <span className="hs-cnn-foot-k" data-field="foot.k1" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.k1']}</span>{' '}
            <span data-field="foot.v1" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.v1']}</span>
          </span>
          <span>
            <span className="hs-cnn-foot-k" data-field="foot.k2" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.k2']}</span>{' '}
            <span data-field="foot.v2" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot.v2']}</span>
          </span>
        </div>
        <div className="hs-cnn-foot-right">
          <span data-field="foot2.day" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot2.day']}</span>
          <span data-field="foot2.cycle" style={{ whiteSpace: 'pre-wrap' as const }}>{c['foot2.cycle']}</span>
        </div>
      </footer>
    </HsStage>
  );
}

/** Inlined CSS — keeps every pixel value identical to scratch/design/hs-district/hs-district-pack/class-nownext.html. */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&family=Caveat:wght@500;700&display=swap');

.hs-cnn-bgfx {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(1600px 1000px at 100% 0%, rgba(26,78,216,.04), transparent 60%),
    linear-gradient(rgba(0,0,0,.02) 1px, transparent 1px) 0 0/180px 180px,
    linear-gradient(90deg, rgba(0,0,0,.02) 1px, transparent 1px) 0 0/180px 180px;
}

@keyframes hsCnnBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: .3; } }
@keyframes hsCnnPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(26,78,216,.45); } 50% { box-shadow: 0 0 0 28px rgba(26,78,216,0); } }

/* HEADER */
.hs-cnn-head {
  position: absolute; top: 0; left: 0; right: 0; height: 200px;
  padding: 0 80px; display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid #dcdde2; background: #fff; z-index: 5;
}
.hs-cnn-head-left { display: flex; align-items: center; gap: 32px; }
.hs-cnn-room {
  padding: 14px 22px; background: #0e0f12; color: #fff;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 32px;
  letter-spacing: .22em; text-transform: uppercase; line-height: 1;
}
.hs-cnn-who { display: flex; flex-direction: column; line-height: 1.05; }
.hs-cnn-who-name {
  font-family: 'Inter', sans-serif; font-weight: 900; font-size: 64px;
  letter-spacing: -.02em; color: #0e0f12;
}
.hs-cnn-who-sub {
  font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 24px;
  color: #54585f; letter-spacing: .18em; margin-top: 6px; text-transform: uppercase;
}
.hs-cnn-head-right { display: flex; align-items: center; gap: 24px; }
.hs-cnn-stat { display: flex; flex-direction: column; align-items: flex-end; line-height: 1; }
.hs-cnn-stat-k {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px;
  letter-spacing: .24em; color: #54585f; text-transform: uppercase;
}
.hs-cnn-stat-v {
  font-family: 'Inter', sans-serif; font-weight: 900; font-size: 64px;
  color: #0e0f12; letter-spacing: -.02em; margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
.hs-cnn-stat-v::after {
  content: ''; display: inline-block; width: 10px; height: 10px;
  background: #1a4ed8; border-radius: 50%; margin-left: 8px;
  vertical-align: middle; animation: hsCnnBlink 1.4s steps(2) infinite;
}
.hs-cnn-badge {
  padding: 14px 22px; background: #e6ecff; color: #1a4ed8;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .22em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 14px;
  border: 2px solid rgba(26,78,216,.25); border-radius: 8px;
}
.hs-cnn-badge::before {
  content: ''; width: 14px; height: 14px; border-radius: 50%;
  background: #1a4ed8; animation: hsCnnPulse 1.8s ease-in-out infinite;
}

/* PERIOD STRIP */
.hs-cnn-progress {
  position: absolute; top: 200px; left: 0; right: 0; height: 80px;
  background: #e6ecff; display: flex; align-items: center;
  padding: 0 80px; gap: 32px; z-index: 4;
  border-bottom: 1px solid rgba(26,78,216,.25);
}
.hs-cnn-progress-lbl {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  color: #1a4ed8; letter-spacing: .22em; text-transform: uppercase; white-space: nowrap;
}
.hs-cnn-progress-bar {
  flex: 1; height: 18px; background: rgba(26,78,216,.18);
  border-radius: 999px; overflow: hidden; position: relative;
}
.hs-cnn-progress-bar::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: 42%; background: #1a4ed8; border-radius: 999px;
}
.hs-cnn-progress-bar::after {
  content: ''; position: absolute; left: 42%; top: 50%;
  transform: translate(-50%, -50%); width: 32px; height: 32px;
  border-radius: 50%; background: #1a4ed8;
  box-shadow: 0 0 0 8px rgba(26,78,216,.18);
}
.hs-cnn-progress-pct {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  color: #1a4ed8; letter-spacing: .18em; font-variant-numeric: tabular-nums; white-space: nowrap;
}
.hs-cnn-progress-end {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  color: #0e0f12; letter-spacing: .18em; text-transform: uppercase; white-space: nowrap;
}

/* NOW HERO */
.hs-cnn-now {
  position: absolute; top: 340px; left: 80px; width: 2400px; height: 1240px;
  background: #fff; border: 3px solid #0e0f12;
  display: flex; flex-direction: column; z-index: 3;
}
.hs-cnn-now-stripe { height: 24px; background: #1a4ed8; }
.hs-cnn-now-body {
  flex: 1; padding: 56px 64px 48px;
  display: flex; flex-direction: column; gap: 18px;
}
.hs-cnn-now-eyebrow {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px;
  letter-spacing: .32em; text-transform: uppercase; color: #1a4ed8;
  display: flex; align-items: center; gap: 18px;
}
.hs-cnn-now-eyebrow::before { content: ''; height: 4px; width: 60px; background: #1a4ed8; }
.hs-cnn-now-h1 {
  margin: 0; font-family: 'Inter', sans-serif; font-weight: 900; font-size: 240px;
  line-height: .9; letter-spacing: -.04em; color: #0e0f12; text-wrap: balance;
}
.hs-cnn-hl {
  background: linear-gradient(180deg, transparent 60%, #fff48a 60%);
  padding: 0 .04em;
}
.hs-cnn-now-lede {
  margin: 0; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 48px;
  line-height: 1.25; color: #54585f; max-width: 2150px; text-wrap: pretty;
}
.hs-cnn-now-target {
  margin-top: 18px; padding: 28px 36px; background: #e6ecff;
  border-left: 8px solid #1a4ed8; display: flex; flex-direction: column; gap: 8px;
}
.hs-cnn-now-target-k {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .28em; text-transform: uppercase; color: #1a4ed8;
}
.hs-cnn-now-target-v {
  font-family: 'Inter', sans-serif; font-weight: 700; font-size: 60px;
  line-height: 1.1; color: #0e0f12; letter-spacing: -.01em; text-wrap: balance;
}
.hs-cnn-now-meta {
  margin-top: auto; display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 24px; border-top: 3px solid #0e0f12; padding-top: 28px;
}
.hs-cnn-now-meta-it { display: flex; flex-direction: column; line-height: 1; }
.hs-cnn-now-meta-k {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px;
  letter-spacing: .22em; text-transform: uppercase; color: #54585f;
}
.hs-cnn-now-meta-v {
  font-family: 'Inter', sans-serif; font-weight: 900; font-size: 54px;
  color: #0e0f12; letter-spacing: -.02em; margin-top: 8px;
  font-variant-numeric: tabular-nums;
}
.hs-cnn-brand { color: #1a4ed8; }
.hs-cnn-warm { color: #f1853a; }

/* RIGHT COLUMN */
.hs-cnn-col {
  position: absolute; top: 340px; right: 80px; width: 1220px; height: 1240px;
  display: flex; flex-direction: column; gap: 24px; z-index: 3;
}

/* AGENDA */
.hs-cnn-agenda {
  flex: 1; background: #fff; border: 3px solid #0e0f12;
  padding: 28px 32px; display: flex; flex-direction: column; overflow: hidden;
}
.hs-cnn-agenda-h3 {
  margin: 0; font-family: 'Inter', sans-serif; font-weight: 900; font-size: 54px;
  line-height: 1; letter-spacing: -.02em; color: #0e0f12;
  border-bottom: 3px solid #0e0f12; padding-bottom: 14px;
  display: flex; justify-content: space-between; align-items: baseline;
}
.hs-cnn-agenda-meta {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px;
  letter-spacing: .22em; color: #54585f; text-transform: uppercase;
}
.hs-cnn-agenda-ul {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; flex: 1; justify-content: space-around;
}
.hs-cnn-agenda-li {
  display: grid; grid-template-columns: auto 1fr auto;
  align-items: center; gap: 18px; padding: 14px 0;
  border-bottom: 1px dashed #dcdde2; position: relative;
}
.hs-cnn-agenda-li:last-child { border-bottom: 0; }
.hs-cnn-agenda-step {
  width: 64px; height: 64px; border-radius: 50%;
  border: 3px solid #dcdde2; display: grid; place-items: center;
  font-family: 'Inter', sans-serif; font-weight: 900; font-size: 30px;
  color: #54585f; background: #fff; flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.hs-cnn-done .hs-cnn-agenda-step { background: #0e0f12; border-color: #0e0f12; color: #fff; }
.hs-cnn-done .hs-cnn-agenda-step::after { content: '✓'; font-size: 36px; }
.hs-cnn-done .hs-cnn-agenda-step span { display: none; }
.hs-cnn-now-li .hs-cnn-agenda-step {
  background: #1a4ed8; border-color: #0f2f8a; color: #fff;
  box-shadow: 0 0 0 6px rgba(26,78,216,.2);
  animation: hsCnnPulse 2s ease-in-out infinite;
}
.hs-cnn-agenda-nm {
  font-family: 'Inter', sans-serif; font-weight: 800; font-size: 36px;
  line-height: 1.1; color: #0e0f12; letter-spacing: -.01em;
}
.hs-cnn-done .hs-cnn-agenda-nm {
  color: #54585f; text-decoration: line-through; text-decoration-color: rgba(0,0,0,.4);
}
.hs-cnn-now-li .hs-cnn-agenda-nm { color: #1a4ed8; }
.hs-cnn-agenda-sub {
  display: block; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 28px;
  color: #54585f; margin-top: 2px; letter-spacing: 0; text-decoration: none;
}
.hs-cnn-agenda-t {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px;
  letter-spacing: .18em; color: #0e0f12; text-transform: uppercase;
  text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums;
}
.hs-cnn-now-li .hs-cnn-agenda-t { color: #1a4ed8; }

/* DO-NOW + EXIT */
.hs-cnn-pair {
  display: grid; grid-template-rows: 1fr 1fr; gap: 24px;
  flex: 0 0 auto; height: 520px;
}
.hs-cnn-card {
  background: #fff; border: 3px solid #0e0f12;
  padding: 24px 28px; display: flex; flex-direction: column; position: relative;
}
.hs-cnn-card-tag {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px;
  letter-spacing: .28em; text-transform: uppercase; color: #f1853a;
  display: inline-flex; align-items: center; gap: 14px;
}
.hs-cnn-card-tag::before { content: ''; width: 24px; height: 6px; background: currentColor; }
.hs-cnn-exit .hs-cnn-card-tag { color: #d1456b; }
.hs-cnn-card-h4 {
  margin: 6px 0 8px; font-family: 'Inter', sans-serif; font-weight: 900; font-size: 46px;
  line-height: 1.05; color: #0e0f12; letter-spacing: -.02em; text-wrap: balance;
}
.hs-cnn-card-p {
  margin: 0; font-family: 'Caveat', cursive; font-weight: 500; font-size: 36px;
  line-height: 1.25; color: #3a3530; max-width: 1200px;
}
.hs-cnn-card-when {
  margin-top: auto; padding-top: 14px; border-top: 2px dashed #dcdde2;
  display: flex; justify-content: space-between; align-items: baseline;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px;
  letter-spacing: .18em; color: #54585f; text-transform: uppercase;
}
.hs-cnn-card-when-k { color: #0e0f12; }

/* HOMEWORK / ANNOUNCEMENT BAND */
.hs-cnn-band {
  position: absolute; left: 80px; right: 80px; bottom: 96px; height: 440px;
  display: grid; grid-template-columns: 1fr 1.1fr 1fr; gap: 24px; z-index: 3;
}
.hs-cnn-b {
  background: #fff; border: 3px solid #0e0f12;
  padding: 28px 32px; display: flex; flex-direction: column; gap: 8px;
}
.hs-cnn-b-tag {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .28em; text-transform: uppercase; color: #1a4ed8;
  display: inline-flex; align-items: center; gap: 14px; line-height: 1;
}
.hs-cnn-b-tag::before { content: ''; width: 28px; height: 6px; background: currentColor; }
.hs-cnn-b-h4 {
  margin: 6px 0 0; font-family: 'Inter', sans-serif; font-weight: 900; font-size: 60px;
  line-height: 1; color: #0e0f12; letter-spacing: -.02em; text-wrap: balance;
}
.hs-cnn-b-meta {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .22em; text-transform: uppercase; color: #54585f; margin-top: 4px;
}
.hs-cnn-b-ul {
  margin: 14px 0 0; padding: 0; list-style: none;
  display: flex; flex-direction: column; gap: 10px;
}
.hs-cnn-b-ul li {
  display: grid; grid-template-columns: auto 1fr auto;
  align-items: baseline; gap: 14px;
  font-family: 'Inter', sans-serif; font-weight: 600; font-size: 30px;
  color: #0e0f12; line-height: 1.2;
}
.hs-cnn-b-due {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px;
  letter-spacing: .18em; color: #d1456b; text-transform: uppercase; white-space: nowrap;
}
.hs-cnn-b-ic {
  width: 36px; height: 36px; border-radius: 50%; background: #f0f0ee;
  display: grid; place-items: center; font-size: 24px;
  font-family: 'JetBrains Mono'; font-weight: 700; color: #54585f;
}
.hs-cnn-urgent .hs-cnn-b-due { color: #f1853a; }
.hs-cnn-dark { background: #0e0f12; color: #fff; border-color: #0e0f12; }
.hs-cnn-dark .hs-cnn-b-tag { color: #fff48a; }
.hs-cnn-dark .hs-cnn-b-h4 { color: #fff; }
.hs-cnn-dark .hs-cnn-b-meta { color: rgba(255,255,255,.65); }
.hs-cnn-b-p {
  margin: 14px 0 0; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 28px;
  color: rgba(255,255,255,.78); line-height: 1.3;
}
.hs-cnn-b-when {
  margin-top: auto; display: flex; justify-content: space-between;
  align-items: baseline; font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 28px; letter-spacing: .22em; color: #fff48a;
  text-transform: uppercase; border-top: 2px dashed rgba(255,255,255,.18); padding-top: 14px;
}
.hs-cnn-b-where { color: rgba(255,255,255,.65); }
.hs-cnn-green { background: #1f8a5a; color: #fff; border-color: #155f3d; }
.hs-cnn-green .hs-cnn-b-tag { color: #dff6e7; }
.hs-cnn-green .hs-cnn-b-h4 { color: #fff; }
.hs-cnn-green .hs-cnn-b-meta { color: rgba(255,255,255,.7); }
.hs-cnn-green .hs-cnn-b-p { color: rgba(255,255,255,.85); }
.hs-cnn-b-cap {
  display: grid; grid-template-columns: auto 1fr;
  color: rgba(255,255,255,.85); font-size: 28px; font-weight: 600;
  align-items: center; gap: 14px;
}
.hs-cnn-b-ic-light { background: rgba(255,255,255,.15); color: #fff; }

/* FOOTER */
.hs-cnn-foot {
  position: absolute; left: 0; right: 0; bottom: 0; height: 96px;
  background: #0e0f12; color: #fff;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 80px; z-index: 5;
}
.hs-cnn-foot-left {
  display: flex; align-items: center; gap: 36px;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .22em; text-transform: uppercase;
}
.hs-cnn-foot-k { color: #fff48a; }
.hs-cnn-foot-right {
  display: flex; align-items: center; gap: 24px;
  font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 28px;
  color: rgba(255,255,255,.7); letter-spacing: .18em; text-transform: uppercase;
}
`;
