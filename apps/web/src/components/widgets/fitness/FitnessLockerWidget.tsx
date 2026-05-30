"use client";

/**
 * FitnessLockerWidget — 4K members-lobby scene, 3840×2160 (Locker theme).
 *
 * Ported from scratch/design/fitness/06-locker.html via the HsStage
 * transform:scale pattern. Every pixel size is FIXED (matches the
 * HTML mockup); DO NOT regress to vw/%.
 *
 * Visual DNA — old-school athletic locker room aesthetic:
 *   - Wood paneling (#5b3c20) repeating-stripe outer frame
 *   - Cream paper (#f3ead4) inset with soft red/gold radial wash
 *   - Varsity red (#b8302a) banner with double-cream border + gold stars
 *   - Archivo Black display + Bebas Neue accents + Outfit body +
 *     JetBrains Mono labels
 *   - Top double-bordered banner (1987 establishment vibe)
 *   - 5-column stat strip (members in, floor temp, pool, sauna, courts)
 *   - 3-column main grid: Member of the Month (1.4fr), Today's Classes,
 *     Lost & Found
 *   - Dark wood footer ribbon with mono caps + gold accents
 *
 * Editable hotspots — every text element has a `data-field` attribute
 * matching the HTML mockup exactly. PropertiesPanel matches via
 * THEMED_WIDGET_FIELDS or the auto-form generator. Field keys use
 * dot notation:
 *   banner.top, banner.title, banner.sub
 *   strip.l1..5, strip.v1..5, strip.u1..5
 *   mod.tag, mod.init, mod.t1, mod.t2, mod.role, mod.quote,
 *     mod.s1v, mod.s1l, mod.s2v, mod.s2l, mod.s3v, mod.s3l
 *   sched.tag, sched.t1..7, sched.i1..7, sched.r1..7
 *   lf.tag, lf.n1..7, lf.i1..7, lf.d1..7
 *   foot.l, foot.c, foot.r
 */

import { HsStage } from '../hs/HsStage';
import { sanitizeWidgetHtml } from '@/lib/sanitize-html';

export interface FitnessLockerConfig {
  // Gym logo — optional image for the banner area
  gymLogoUrl?: string;
  // Banner
  'banner.top'?: string;
  'banner.title'?: string;
  'banner.sub'?: string;
  // Strip — 5 cells
  'strip.l1'?: string; 'strip.v1'?: string; 'strip.u1'?: string;
  'strip.l2'?: string; 'strip.v2'?: string; 'strip.u2'?: string;
  'strip.l3'?: string; 'strip.v3'?: string; 'strip.u3'?: string;
  'strip.l4'?: string; 'strip.v4'?: string; 'strip.u4'?: string;
  'strip.l5'?: string; 'strip.v5'?: string; 'strip.u5'?: string;
  // Member of the month
  'mod.tag'?: string;
  'mod.init'?: string;
  'mod.t1'?: string;
  'mod.t2'?: string;
  'mod.role'?: string;
  'mod.quote'?: string;
  'mod.s1v'?: string; 'mod.s1l'?: string;
  'mod.s2v'?: string; 'mod.s2l'?: string;
  'mod.s3v'?: string; 'mod.s3l'?: string;
  // Class schedule — 7 rows
  'sched.tag'?: string;
  'sched.t1'?: string; 'sched.i1'?: string; 'sched.r1'?: string;
  'sched.t2'?: string; 'sched.i2'?: string; 'sched.r2'?: string;
  'sched.t3'?: string; 'sched.i3'?: string; 'sched.r3'?: string;
  'sched.t4'?: string; 'sched.i4'?: string; 'sched.r4'?: string;
  'sched.t5'?: string; 'sched.i5'?: string; 'sched.r5'?: string;
  'sched.t6'?: string; 'sched.i6'?: string; 'sched.r6'?: string;
  'sched.t7'?: string; 'sched.i7'?: string; 'sched.r7'?: string;
  // Lost & Found — 7 rows
  'lf.tag'?: string;
  'lf.n1'?: string; 'lf.i1'?: string; 'lf.d1'?: string;
  'lf.n2'?: string; 'lf.i2'?: string; 'lf.d2'?: string;
  'lf.n3'?: string; 'lf.i3'?: string; 'lf.d3'?: string;
  'lf.n4'?: string; 'lf.i4'?: string; 'lf.d4'?: string;
  'lf.n5'?: string; 'lf.i5'?: string; 'lf.d5'?: string;
  'lf.n6'?: string; 'lf.i6'?: string; 'lf.d6'?: string;
  'lf.n7'?: string; 'lf.i7'?: string; 'lf.d7'?: string;
  // Footer
  'foot.l'?: string;
  'foot.c'?: string;
  'foot.r'?: string;
}

/* eslint-disable @typescript-eslint/quotes */
export const DEFAULTS: Record<string, string> = {
  // Gym logo image upload (optional — shown above the banner title)
  'gymLogoUrl':   '',
  'banner.top':   'EST. 1987 ★ MEMBERS ONLY ★ NORTH GATE',
  'banner.title': 'THE LOCKER.',
  'banner.sub':   '★ TUESDAY · MARCH 18 · 6:14 AM ★',

  'strip.l1': '▸ MEMBERS IN',  'strip.v1': '142',  'strip.u1': 'CHECKED IN TODAY',
  'strip.l2': '▸ FLOOR TEMP',  'strip.v2': '68°',  'strip.u2': 'SET POINT',
  'strip.l3': '▸ POOL',        'strip.v3': '82°',  'strip.u3': 'LANES OPEN · 4/6',
  'strip.l4': '▸ SAUNA',       'strip.v4': '185°', 'strip.u4': 'OPEN UNTIL 10P',
  'strip.l5': '▸ COURTS',      'strip.v5': '3/4',  'strip.u5': 'BOOK AT DESK',

  'mod.tag':   '★ MEMBER OF THE MONTH',
  'mod.init':  'DR',
  'mod.t1':    'Diane ',
  'mod.t2':    'Reyes.',
  'mod.role':  '★ 23 YEARS ON THE FLOOR · LANE 3 REGULAR',
  'mod.quote': '"Started swimming here when my kids were in elementary. They\'re grown now. I\'m still here at 5:45 every weekday."',
  'mod.s1v':   '847',  'mod.s1l': 'VISITS / YR',
  'mod.s2v':   '2.1k', 'mod.s2l': 'MILES SWUM',
  'mod.s3v':   '5:45', 'mod.s3l': 'USUAL TIME',

  'sched.tag': "▸ TODAY'S CLASSES · STUDIO B",
  'sched.t1':  '6:00A',  'sched.i1': 'SUNRISE SPIN',     'sched.r1': 'CYCLE',
  'sched.t2':  '7:30A',  'sched.i2': 'POWER YOGA',       'sched.r2': 'STUDIO B',
  'sched.t3':  '9:00A',  'sched.i3': 'AQUA FIT',         'sched.r3': 'POOL',
  'sched.t4':  '10:30A', 'sched.i4': 'SILVER STRENGTH',  'sched.r4': 'STUDIO A',
  'sched.t5':  '12:00P', 'sched.i5': 'EXPRESS HIIT',     'sched.r5': 'FUNC FLOOR',
  'sched.t6':  '5:30P',  'sched.i6': 'BARBELL CLUB',     'sched.r6': 'STRENGTH RM',
  'sched.t7':  '7:00P',  'sched.i7': 'RESTORE',          'sched.r7': 'STUDIO B',

  'lf.tag': '★ LOST & FOUND',
  'lf.n1': '#41', 'lf.i1': 'Black Hydroflask, "MARGO" sticker',     'lf.d1': '3/14',
  'lf.n2': '#42', 'lf.i2': 'Apple Watch, brown leather band',        'lf.d2': '3/14',
  'lf.n3': '#43', 'lf.i3': 'Pair of AirPods, scratched case',        'lf.d3': '3/15',
  'lf.n4': '#44', 'lf.i4': "Single nylon glove, women's M",          'lf.d4': '3/16',
  'lf.n5': '#45', 'lf.i5': 'Toyota key fob + house key',             'lf.d5': '3/16',
  'lf.n6': '#46', 'lf.i6': 'Reading glasses, tortoise frames',       'lf.d6': '3/17',
  'lf.n7': '#47', 'lf.i7': 'Wedding band, engraved "B+M 2014"',      'lf.d7': '3/17',

  'foot.l': '★ FRONT DESK · X1 · 7AM–10PM',
  'foot.c': 'SAUNA CLOSING TUE 11P FOR DEEP CLEAN — RE-OPEN WED 5A',
  'foot.r': 'EST <b>1987</b>',
};
/* eslint-enable @typescript-eslint/quotes */

function pick(cfg: FitnessLockerConfig | undefined, key: keyof typeof DEFAULTS): string {
  return ((cfg as any)?.[key] as string | undefined) ?? DEFAULTS[key];
}

export function FitnessLockerWidget({ config }: { config?: FitnessLockerConfig }) {
  return (
    <HsStage
      stageClassName="fl-stage"
      stageStyle={{
        background:
          'repeating-linear-gradient(90deg, #5b3c20 0 60px, #4a3018 60px 62px, #5b3c20 62px 122px, #6b4828 122px 124px), #5b3c20',
        color: '#1a1208',
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      <style>{CSS}</style>

      <div className="fl-paper">

        {/* Header banner */}
        <div className="fl-banner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {pick(config, 'gymLogoUrl') && (
            <img src={pick(config, 'gymLogoUrl')} alt="Gym logo" className="fl-gym-logo" />
          )}
          <div className="fl-banner-top" data-field="banner.top">{pick(config, 'banner.top')}</div>
          <h1 className="fl-banner-title" data-field="banner.title">{pick(config, 'banner.title')}</h1>
          <div className="fl-banner-sub" data-field="banner.sub">{pick(config, 'banner.sub')}</div>
        </div>

        {/* Stat strip */}
        <div className="fl-strip">
          <div className="fl-cell">
            <div className="fl-lbl" data-field="strip.l1">{pick(config, 'strip.l1')}</div>
            <div className="fl-val" data-field="strip.v1">{pick(config, 'strip.v1')}</div>
            <div className="fl-uni" data-field="strip.u1">{pick(config, 'strip.u1')}</div>
          </div>
          <div className="fl-cell">
            <div className="fl-lbl" data-field="strip.l2">{pick(config, 'strip.l2')}</div>
            <div className="fl-val" data-field="strip.v2">{pick(config, 'strip.v2')}</div>
            <div className="fl-uni" data-field="strip.u2">{pick(config, 'strip.u2')}</div>
          </div>
          <div className="fl-cell">
            <div className="fl-lbl" data-field="strip.l3">{pick(config, 'strip.l3')}</div>
            <div className="fl-val" data-field="strip.v3">{pick(config, 'strip.v3')}</div>
            <div className="fl-uni" data-field="strip.u3">{pick(config, 'strip.u3')}</div>
          </div>
          <div className="fl-cell">
            <div className="fl-lbl" data-field="strip.l4">{pick(config, 'strip.l4')}</div>
            <div className="fl-val" data-field="strip.v4">{pick(config, 'strip.v4')}</div>
            <div className="fl-uni" data-field="strip.u4">{pick(config, 'strip.u4')}</div>
          </div>
          <div className="fl-cell">
            <div className="fl-lbl" data-field="strip.l5">{pick(config, 'strip.l5')}</div>
            <div className="fl-val" data-field="strip.v5">{pick(config, 'strip.v5')}</div>
            <div className="fl-uni" data-field="strip.u5">{pick(config, 'strip.u5')}</div>
          </div>
        </div>

        {/* Main 3-column grid */}
        <div className="fl-grid">

          {/* Member of the Month */}
          <div className="fl-card fl-mod">
            <div className="fl-tag" data-field="mod.tag">{pick(config, 'mod.tag')}</div>
            <div className="fl-mod-row">
              <div className="fl-ph" data-field="mod.init">{pick(config, 'mod.init')}</div>
              <div className="fl-mod-body">
                <div className="fl-nm">
                  <span data-field="mod.t1">{pick(config, 'mod.t1')}</span>
                  <em data-field="mod.t2">{pick(config, 'mod.t2')}</em>
                </div>
                <div className="fl-role" data-field="mod.role">{pick(config, 'mod.role')}</div>
                <div className="fl-quote" data-field="mod.quote">{pick(config, 'mod.quote')}</div>
                <div className="fl-stats">
                  <div className="fl-s">
                    <b data-field="mod.s1v">{pick(config, 'mod.s1v')}</b>
                    <span data-field="mod.s1l">{pick(config, 'mod.s1l')}</span>
                  </div>
                  <div className="fl-s">
                    <b data-field="mod.s2v">{pick(config, 'mod.s2v')}</b>
                    <span data-field="mod.s2l">{pick(config, 'mod.s2l')}</span>
                  </div>
                  <div className="fl-s">
                    <b data-field="mod.s3v">{pick(config, 'mod.s3v')}</b>
                    <span data-field="mod.s3l">{pick(config, 'mod.s3l')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Class schedule */}
          <div className="fl-card fl-sched">
            <div className="fl-tag" data-field="sched.tag">{pick(config, 'sched.tag')}</div>
            <div className="fl-sched-item">
              <div className="fl-tm" data-field="sched.t1">{pick(config, 'sched.t1')}</div>
              <div className="fl-ti" data-field="sched.i1">{pick(config, 'sched.i1')}</div>
              <div className="fl-rm" data-field="sched.r1">{pick(config, 'sched.r1')}</div>
            </div>
            <div className="fl-sched-item">
              <div className="fl-tm" data-field="sched.t2">{pick(config, 'sched.t2')}</div>
              <div className="fl-ti" data-field="sched.i2">{pick(config, 'sched.i2')}</div>
              <div className="fl-rm" data-field="sched.r2">{pick(config, 'sched.r2')}</div>
            </div>
            <div className="fl-sched-item">
              <div className="fl-tm" data-field="sched.t3">{pick(config, 'sched.t3')}</div>
              <div className="fl-ti" data-field="sched.i3">{pick(config, 'sched.i3')}</div>
              <div className="fl-rm" data-field="sched.r3">{pick(config, 'sched.r3')}</div>
            </div>
            <div className="fl-sched-item">
              <div className="fl-tm" data-field="sched.t4">{pick(config, 'sched.t4')}</div>
              <div className="fl-ti" data-field="sched.i4">{pick(config, 'sched.i4')}</div>
              <div className="fl-rm" data-field="sched.r4">{pick(config, 'sched.r4')}</div>
            </div>
            <div className="fl-sched-item">
              <div className="fl-tm" data-field="sched.t5">{pick(config, 'sched.t5')}</div>
              <div className="fl-ti" data-field="sched.i5">{pick(config, 'sched.i5')}</div>
              <div className="fl-rm" data-field="sched.r5">{pick(config, 'sched.r5')}</div>
            </div>
            <div className="fl-sched-item">
              <div className="fl-tm" data-field="sched.t6">{pick(config, 'sched.t6')}</div>
              <div className="fl-ti" data-field="sched.i6">{pick(config, 'sched.i6')}</div>
              <div className="fl-rm" data-field="sched.r6">{pick(config, 'sched.r6')}</div>
            </div>
            <div className="fl-sched-item">
              <div className="fl-tm" data-field="sched.t7">{pick(config, 'sched.t7')}</div>
              <div className="fl-ti" data-field="sched.i7">{pick(config, 'sched.i7')}</div>
              <div className="fl-rm" data-field="sched.r7">{pick(config, 'sched.r7')}</div>
            </div>
          </div>

          {/* Lost and Found */}
          <div className="fl-card fl-lf">
            <div className="fl-tag" data-field="lf.tag">{pick(config, 'lf.tag')}</div>
            <div className="fl-lf-item">
              <div className="fl-num" data-field="lf.n1">{pick(config, 'lf.n1')}</div>
              <div className="fl-it" data-field="lf.i1">{pick(config, 'lf.i1')}</div>
              <div className="fl-dt" data-field="lf.d1">{pick(config, 'lf.d1')}</div>
            </div>
            <div className="fl-lf-item">
              <div className="fl-num" data-field="lf.n2">{pick(config, 'lf.n2')}</div>
              <div className="fl-it" data-field="lf.i2">{pick(config, 'lf.i2')}</div>
              <div className="fl-dt" data-field="lf.d2">{pick(config, 'lf.d2')}</div>
            </div>
            <div className="fl-lf-item">
              <div className="fl-num" data-field="lf.n3">{pick(config, 'lf.n3')}</div>
              <div className="fl-it" data-field="lf.i3">{pick(config, 'lf.i3')}</div>
              <div className="fl-dt" data-field="lf.d3">{pick(config, 'lf.d3')}</div>
            </div>
            <div className="fl-lf-item">
              <div className="fl-num" data-field="lf.n4">{pick(config, 'lf.n4')}</div>
              <div className="fl-it" data-field="lf.i4">{pick(config, 'lf.i4')}</div>
              <div className="fl-dt" data-field="lf.d4">{pick(config, 'lf.d4')}</div>
            </div>
            <div className="fl-lf-item">
              <div className="fl-num" data-field="lf.n5">{pick(config, 'lf.n5')}</div>
              <div className="fl-it" data-field="lf.i5">{pick(config, 'lf.i5')}</div>
              <div className="fl-dt" data-field="lf.d5">{pick(config, 'lf.d5')}</div>
            </div>
            <div className="fl-lf-item">
              <div className="fl-num" data-field="lf.n6">{pick(config, 'lf.n6')}</div>
              <div className="fl-it" data-field="lf.i6">{pick(config, 'lf.i6')}</div>
              <div className="fl-dt" data-field="lf.d6">{pick(config, 'lf.d6')}</div>
            </div>
            <div className="fl-lf-item">
              <div className="fl-num" data-field="lf.n7">{pick(config, 'lf.n7')}</div>
              <div className="fl-it" data-field="lf.i7">{pick(config, 'lf.i7')}</div>
              <div className="fl-dt" data-field="lf.d7">{pick(config, 'lf.d7')}</div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="fl-foot">
          <div data-field="foot.l">{pick(config, 'foot.l')}</div>
          <div data-field="foot.c">{pick(config, 'foot.c')}</div>
          <div className="fl-foot-r" data-field="foot.r" dangerouslySetInnerHTML={{ __html: sanitizeWidgetHtml(pick(config, 'foot.r')) }} />
        </div>

      </div>
    </HsStage>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@500;700&family=Outfit:wght@400;700;900&family=Bebas+Neue&display=swap');

.fl-paper {
  position: absolute; top: 80px; right: 80px; bottom: 80px; left: 80px;
  background: #f3ead4;
  background-image:
    radial-gradient(circle at 20% 30%, rgba(184,48,42,.04) 0, transparent 30%),
    radial-gradient(circle at 80% 70%, rgba(200,160,74,.05) 0, transparent 35%);
  box-shadow: 0 30px 80px rgba(0,0,0,.6), inset 0 0 0 8px #3a2510, inset 0 0 0 16px #f3ead4;
  padding: 60px 80px;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: 40px;
}

.fl-banner {
  background: #b8302a; color: #f3ead4;
  padding: 36px 50px;
  border: 6px double #f3ead4;
  position: relative;
}
.fl-gym-logo { height: 80px; width: auto; object-fit: contain; object-position: left center; margin-bottom: 16px; display: block; filter: brightness(10); }
.fl-banner::before, .fl-banner::after {
  content: '\\2605';
  position: absolute;
  font-size: 80px;
  top: 50%;
  transform: translateY(-50%);
  color: #c8a04a;
}
.fl-banner::before { left: 60px; }
.fl-banner::after  { right: 60px; }
.fl-banner-top {
  font-family: 'JetBrains Mono'; font-size: 32px; letter-spacing: .5em;
  text-align: center; opacity: .85;
}
.fl-banner-title {
  margin: 8px 0 0;
  font-family: 'Archivo Black'; font-size: 200px; line-height: .9; letter-spacing: -.03em;
  text-align: center;
  text-shadow: 6px 6px 0 #3a2510;
}
.fl-banner-sub {
  font-family: 'Bebas Neue'; font-size: 54px; letter-spacing: .18em;
  text-align: center; margin-top: 14px; color: #c8a04a;
}

.fl-strip {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 24px;
}
.fl-cell {
  background: #f3ead4; border: 4px solid #5b3c20;
  padding: 24px 28px;
}
.fl-lbl {
  font-family: 'JetBrains Mono'; font-size: 24px; letter-spacing: .28em; color: #b8302a;
}
.fl-val {
  font-family: 'Archivo Black'; font-size: 90px; line-height: .9; color: #1a1208; margin-top: 6px;
}
.fl-uni {
  font-family: 'Bebas Neue'; font-size: 32px; letter-spacing: .1em; color: #6b513a; margin-top: 4px;
}

.fl-grid {
  display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 32px;
}

.fl-card {
  background: #f3ead4; border: 6px solid #5b3c20;
  padding: 32px 38px; position: relative;
}
.fl-tag {
  font-family: 'JetBrains Mono'; font-size: 24px; letter-spacing: .28em; color: #b8302a;
  border-bottom: 3px double #5b3c20; padding-bottom: 14px; margin-bottom: 20px;
}

.fl-mod-row {
  display: flex; gap: 32px; align-items: flex-start; margin-top: 20px;
}
.fl-ph {
  width: 280px; height: 280px; border-radius: 50%; flex: none;
  border: 8px solid #b8302a; background: #c8a04a;
  display: grid; place-items: center;
  font-family: 'Archivo Black'; font-size: 140px; color: #3a2510;
}
.fl-mod-body { min-width: 0; }
.fl-nm {
  font-family: 'Archivo Black'; font-size: 96px; line-height: .9;
}
.fl-nm em { font-style: normal; color: #b8302a; }
.fl-role {
  font-family: 'Bebas Neue'; font-size: 42px; letter-spacing: .06em;
  color: #b8302a; margin-top: 6px;
}
.fl-quote {
  font-family: 'Outfit'; font-style: italic; font-size: 36px; color: #1a1208;
  line-height: 1.3; margin-top: 18px; max-width: 900px;
}
.fl-stats {
  display: flex; gap: 36px; margin-top: 24px;
}
.fl-s {
  font-family: 'JetBrains Mono'; font-size: 30px; letter-spacing: .15em; color: #6b513a;
}
.fl-s b {
  display: block; font-family: 'Archivo Black'; font-size: 64px; color: #b8302a; letter-spacing: 0;
}

.fl-sched-item {
  display: flex; gap: 24px; padding: 20px 0;
  border-bottom: 2px solid #5b3c20; align-items: baseline;
}
.fl-sched-item:last-child { border-bottom: 0; }
.fl-tm {
  font-family: 'Archivo Black'; font-size: 46px; color: #b8302a;
  flex: none; width: 160px;
}
.fl-ti {
  font-family: 'Bebas Neue'; font-size: 46px; letter-spacing: .04em;
  flex: 1; line-height: 1;
}
.fl-rm {
  font-family: 'JetBrains Mono'; font-size: 24px; color: #6b513a; letter-spacing: .1em;
}

.fl-lf-item {
  display: flex; gap: 18px; padding: 18px 0;
  border-bottom: 2px dashed #5b3c20; align-items: baseline;
}
.fl-lf-item:last-child { border-bottom: 0; }
.fl-num {
  font-family: 'JetBrains Mono'; font-size: 30px; color: #b8302a; font-weight: 700;
  flex: none; width: 70px;
}
.fl-it {
  font-family: 'Outfit'; font-weight: 700; font-size: 38px; flex: 1;
}
.fl-dt {
  font-family: 'JetBrains Mono'; font-size: 26px; color: #6b513a; letter-spacing: .1em;
}

.fl-foot {
  display: flex; justify-content: space-between; align-items: center;
  background: #3a2510; color: #f3ead4;
  padding: 24px 40px;
  font-family: 'JetBrains Mono'; font-size: 32px; letter-spacing: .18em;
}
.fl-foot b { color: #c8a04a; }
`;
