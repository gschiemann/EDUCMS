"use client";

/**
 * HsCafMarketWidget — Cafeteria Market Hall scene, 3840×2160.
 *
 * Food-hall directory: 5 color-coded stations across the canvas (grill,
 * garden, bowl, deli, sweets), each with a featured dish, price tag,
 * allergen tags and live status. Bottom strip pairs a "this week's
 * grill drop" 5-day list with a 3-tile info panel (free-and-reduced,
 * Boost balance, harvest), and a marquee ticker.
 *
 * APPROVED 2026-05-07 — matches scratch/design/hs-district/hs-district-pack/caf-market.html
 * Operator: "these need to be wired in for the highschools"
 *
 * Editable widget regions (every text node has data-field):
 *   - school          → seal initials + est year
 *   - brand           → "The Market." headline + supertitle
 *   - day             → day name + date + open status
 *   - clock           → live header time chip (label + time)
 *   - block           → lunch block letter
 *   - meals           → trays-out chip
 *   - local           → local-sourced chip
 *   - stn0..stn4      → 5 stations (label, num, price, ic, stamp,
 *                       eyebrow, name, desc, t1..t4 tags, status, line)
 *   - week            → grill drop title + meta + 5 day rows (d, nm)
 *   - info            → 3 info tiles (k, v, sub)
 *   - ticker          → bottom marquee (tag + dual message copies)
 *
 * Live clock note: header `clock.time` resolves to the local current
 * time when the operator leaves the placeholder "11:24" untouched.
 * Override to freeze for marketing screenshots.
 */

import { HsStage } from './HsStage';
import { useHsLiveClock } from './useHsLiveClock';

export interface HsCafMarketConfig {
  'school.initials'?: string;
  'school.est'?: string;
  'brand.sup'?: string;
  'brand.t1'?: string;
  'brand.t2'?: string;
  'day.name'?: string;
  'day.date'?: string;
  'day.status'?: string;
  'clock.label'?: string;
  'clock.time'?: string;
  'block.label'?: string;
  'block.value'?: string;
  'meals.label'?: string;
  'meals.value'?: string;
  'local.label'?: string;
  'local.value'?: string;
  'stn0.label'?: string;
  'stn0.num'?: string;
  'stn0.price'?: string;
  'stn0.ic'?: string;
  'stn0.stamp'?: string;
  'stn0.eyebrow'?: string;
  'stn0.name'?: string;
  'stn0.desc'?: string;
  'stn0.t1'?: string;
  'stn0.t2'?: string;
  'stn0.t3'?: string;
  'stn0.t4'?: string;
  'stn0.status'?: string;
  'stn0.line'?: string;
  'stn1.label'?: string;
  'stn1.num'?: string;
  'stn1.price'?: string;
  'stn1.ic'?: string;
  'stn1.stamp'?: string;
  'stn1.eyebrow'?: string;
  'stn1.name'?: string;
  'stn1.desc'?: string;
  'stn1.t1'?: string;
  'stn1.t2'?: string;
  'stn1.t3'?: string;
  'stn1.t4'?: string;
  'stn1.status'?: string;
  'stn1.line'?: string;
  'stn2.label'?: string;
  'stn2.num'?: string;
  'stn2.price'?: string;
  'stn2.ic'?: string;
  'stn2.stamp'?: string;
  'stn2.eyebrow'?: string;
  'stn2.name'?: string;
  'stn2.desc'?: string;
  'stn2.t1'?: string;
  'stn2.t2'?: string;
  'stn2.t3'?: string;
  'stn2.t4'?: string;
  'stn2.status'?: string;
  'stn2.line'?: string;
  'stn3.label'?: string;
  'stn3.num'?: string;
  'stn3.price'?: string;
  'stn3.ic'?: string;
  'stn3.stamp'?: string;
  'stn3.eyebrow'?: string;
  'stn3.name'?: string;
  'stn3.desc'?: string;
  'stn3.t1'?: string;
  'stn3.t2'?: string;
  'stn3.t3'?: string;
  'stn3.t4'?: string;
  'stn3.status'?: string;
  'stn3.line'?: string;
  'stn4.label'?: string;
  'stn4.num'?: string;
  'stn4.price'?: string;
  'stn4.ic'?: string;
  'stn4.stamp'?: string;
  'stn4.eyebrow'?: string;
  'stn4.name'?: string;
  'stn4.desc'?: string;
  'stn4.t1'?: string;
  'stn4.t2'?: string;
  'stn4.t3'?: string;
  'stn4.t4'?: string;
  'stn4.status'?: string;
  'stn4.line'?: string;
  'week.title'?: string;
  'week.meta'?: string;
  'week.0.d'?: string;
  'week.0.nm'?: string;
  'week.1.d'?: string;
  'week.1.nm'?: string;
  'week.2.d'?: string;
  'week.2.nm'?: string;
  'week.3.d'?: string;
  'week.3.nm'?: string;
  'week.4.d'?: string;
  'week.4.nm'?: string;
  'info.0k'?: string;
  'info.0v'?: string;
  'info.0s'?: string;
  'info.1k'?: string;
  'info.1v'?: string;
  'info.1s'?: string;
  'info.2k'?: string;
  'info.2v'?: string;
  'info.2s'?: string;
  'ticker.tag'?: string;
  'ticker.message'?: string;
  'ticker.message2'?: string;
}

export const DEFAULTS: Required<HsCafMarketConfig> = {
  'school.initials': 'WHS',
  'school.est': 'EST. 1956',
  'brand.sup': 'Westridge Cafeteria · 5 stations · 1 ID swipe',
  'brand.t1': 'The Market',
  'brand.t2': '.',
  'day.name': 'Tuesday',
  'day.date': 'Oct 14 · Wk 7 · A-day',
  'day.status': 'All stations open',
  'clock.label': 'Now',
  'clock.time': '11:24',
  'block.label': 'Lunch block',
  'block.value': 'B',
  'meals.label': 'Trays out',
  'meals.value': '412',
  'local.label': 'Local sourced',
  'local.value': '84%',
  'stn0.label': 'Grill',
  'stn0.num': 'No. 01',
  'stn0.price': '$4.50',
  'stn0.ic': '🍔',
  'stn0.stamp': 'Hot · 8 min wait',
  'stn0.eyebrow': 'Featured · today',
  'stn0.name': 'Smash double · house sauce',
  'stn0.desc': 'Two thin patties, American, dill, brioche. Veggie-smash on Beyond available — sub $0 with student ID.',
  'stn0.t1': 'Beef',
  'stn0.t2': 'Wheat',
  'stn0.t3': 'Dairy',
  'stn0.t4': 'Halal',
  'stn0.status': 'Open · grill is hot',
  'stn0.line': 'Line 8',
  'stn1.label': 'Garden',
  'stn1.num': 'No. 02',
  'stn1.price': '$4.00',
  'stn1.ic': '🥗',
  'stn1.stamp': 'Build · pay by weight',
  'stn1.eyebrow': 'Build your own',
  'stn1.name': 'Salad bar · 8 toppings',
  'stn1.desc': 'Romaine, kale, spring mix, four dressings made in-house. Add chickpea, tofu or grilled chicken at the counter.',
  'stn1.t1': 'Vegan-able',
  'stn1.t2': 'GF',
  'stn1.t3': 'Nut-free',
  'stn1.t4': 'Halal',
  'stn1.status': 'Open · grab & go',
  'stn1.line': 'Line 2',
  'stn2.label': 'Bowl',
  'stn2.num': 'No. 03',
  'stn2.price': '$4.75',
  'stn2.ic': '🍜',
  'stn2.stamp': 'Hot · made to order',
  'stn2.eyebrow': "Today's wok",
  'stn2.name': 'Teriyaki rice bowl',
  'stn2.desc': 'Brown rice, charred broccoli, sesame slaw, choice of teriyaki tofu, chicken, or beef short rib. Brothy ramen on Friday.',
  'stn2.t1': 'Soy',
  'stn2.t2': 'Sesame',
  'stn2.t3': 'GF rice opt',
  'stn2.t4': 'Vegan opt',
  'stn2.status': 'Open · 10 min wait',
  'stn2.line': 'Line 14',
  'stn3.label': 'Deli',
  'stn3.num': 'No. 04',
  'stn3.price': '$3.75',
  'stn3.ic': '🥪',
  'stn3.stamp': 'Made fresh · hourly',
  'stn3.eyebrow': 'Sandwich counter',
  'stn3.name': 'Italian hero · pickled onion',
  'stn3.desc': 'Soppressata, capicola, sharp provolone, oil & vinegar on a sub roll. Six breads, four proteins, two pickles.',
  'stn3.t1': 'Pork',
  'stn3.t2': 'Wheat',
  'stn3.t3': 'Dairy',
  'stn3.t4': 'Halal opt',
  'stn3.status': 'Open · short wait',
  'stn3.line': 'Line 4',
  'stn4.label': 'Sweets & sip',
  'stn4.num': 'No. 05',
  'stn4.price': '$2.50',
  'stn4.ic': '🍪',
  'stn4.stamp': 'Bake at 11 & 12:15',
  'stn4.eyebrow': 'From the bake-off',
  'stn4.name': 'Brown-butter cookie',
  'stn4.desc': 'Pulled hot every 75 minutes. Strawberry-banana smoothies on the side. Oat-milk by request — no upcharge.',
  'stn4.t1': 'Wheat',
  'stn4.t2': 'Dairy',
  'stn4.t3': 'Egg',
  'stn4.t4': 'Nut-free',
  'stn4.status': 'Open · cookies hot',
  'stn4.line': 'Line 1',
  'week.title': "This week's grill drop",
  'week.meta': 'Station 01 · Mon–Fri',
  'week.0.d': 'Mon',
  'week.0.nm': 'Crispy chicken sando',
  'week.1.d': 'Tue · today',
  'week.1.nm': 'Smash double',
  'week.2.d': 'Wed',
  'week.2.nm': 'BBQ pulled pork',
  'week.3.d': 'Thu',
  'week.3.nm': 'Buffalo chicken wrap',
  'week.4.d': 'Fri',
  'week.4.nm': 'Fish & chips',
  'info.0k': 'Free & reduced',
  'info.0v': 'All set',
  'info.0s': 'Apply at the office or online any time',
  'info.1k': 'Boost balance',
  'info.1v': '$24.50',
  'info.1s': 'Check the kiosk by the doors',
  'info.2k': 'Harvest',
  'info.2v': 'Apple',
  'info.2s': 'Banner farm · 12 miles · Galas this week',
  'ticker.tag': 'Today at the market',
  'ticker.message': "All five stations open all three lunch blocks · Bring your tray to the dish window — leave the trash · Free seconds on Banner-farm apples while they last · Smoothie bar Wednesday, ramen pop-up Friday · Vegan, GF, halal: ask any chef and we'll plate it · Lunch B and C still have seats around the courtyard if you want sun",
  'ticker.message2': "All five stations open all three lunch blocks · Bring your tray to the dish window — leave the trash · Free seconds on Banner-farm apples while they last · Smoothie bar Wednesday, ramen pop-up Friday · Vegan, GF, halal: ask any chef and we'll plate it · Lunch B and C still have seats around the courtyard if you want sun",
};

const WS = { whiteSpace: 'pre-wrap' as const };

export function HsCafMarketWidget({ config, live }: { config?: HsCafMarketConfig; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsCafMarketConfig>;
  // Live clock — operator override (anything other than the default
  // placeholder) wins so marketing screenshots stay reproducible.
  const now = useHsLiveClock(live !== false);
  const liveClock = c['clock.time'] === DEFAULTS['clock.time']
    ? now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : c['clock.time'];

  return (
    <HsStage
      stageStyle={{
        background: '#fbf6ee',
        fontFamily: "'Archivo', sans-serif",
        color: '#181613',
      }}
    >
      <style>{CSS}</style>
      <div className="hs-cafm-bg" />

      {/* MASTHEAD */}
      <header className="hs-cafm-mast">
        <div className="hs-cafm-seal">
          <div>
            <span data-field="school.initials" style={WS}>{c['school.initials']}</span>
            <span className="hs-cafm-est" data-field="school.est" style={WS}>{c['school.est']}</span>
          </div>
        </div>
        <div className="hs-cafm-title">
          <div className="hs-cafm-sup" data-field="brand.sup" style={WS}>{c['brand.sup']}</div>
          <div className="hs-cafm-name">
            <span data-field="brand.t1" style={WS}>{c['brand.t1']}</span>
            <span className="hs-cafm-acc" data-field="brand.t2" style={WS}>{c['brand.t2']}</span>
          </div>
        </div>
        <div className="hs-cafm-mast-right">
          <div className="hs-cafm-day" data-field="day.name" style={WS}>{c['day.name']}</div>
          <div className="hs-cafm-date" data-field="day.date" style={WS}>{c['day.date']}</div>
          <div className="hs-cafm-open" data-field="day.status" style={WS}>{c['day.status']}</div>
        </div>
      </header>

      {/* CHIPS */}
      <section className="hs-cafm-chips">
        <div className="hs-cafm-chip hs-cafm-chip-ink">
          <div className="hs-cafm-chip-k" data-field="clock.label" style={WS}>{c['clock.label']}</div>
          <div className="hs-cafm-chip-v hs-cafm-chip-dot" data-field="clock.time" style={WS}>{liveClock}</div>
        </div>
        <div className="hs-cafm-chip hs-cafm-chip-s1">
          <div className="hs-cafm-chip-k" data-field="block.label" style={WS}>{c['block.label']}</div>
          <div className="hs-cafm-chip-v" data-field="block.value" style={WS}>{c['block.value']}</div>
        </div>
        <div className="hs-cafm-chip">
          <div className="hs-cafm-chip-k" data-field="meals.label" style={WS}>{c['meals.label']}</div>
          <div className="hs-cafm-chip-v" data-field="meals.value" style={WS}>{c['meals.value']}</div>
        </div>
        <div className="hs-cafm-chip hs-cafm-chip-s2">
          <div className="hs-cafm-chip-k" data-field="local.label" style={WS}>{c['local.label']}</div>
          <div className="hs-cafm-chip-v" data-field="local.value" style={WS}>{c['local.value']}</div>
        </div>
      </section>

      {/* STATIONS GRID */}
      <section className="hs-cafm-grid">
        {/* Station 0 — Grill */}
        <article className="hs-cafm-stn hs-cafm-s1">
          <div className="hs-cafm-top">
            <span data-field="stn0.label" style={WS}>{c['stn0.label']}</span>
            <span className="hs-cafm-num" data-field="stn0.num" style={WS}>{c['stn0.num']}</span>
          </div>
          <div className="hs-cafm-photo">
            <div className="hs-cafm-pricetag" data-field="stn0.price" style={WS}>{c['stn0.price']}</div>
            <div className="hs-cafm-ic" data-field="stn0.ic" style={WS}>{c['stn0.ic']}</div>
            <div className="hs-cafm-stamp" data-field="stn0.stamp" style={WS}>{c['stn0.stamp']}</div>
          </div>
          <div className="hs-cafm-body">
            <div className="hs-cafm-eyebrow" data-field="stn0.eyebrow" style={WS}>{c['stn0.eyebrow']}</div>
            <h2 className="hs-cafm-h2" data-field="stn0.name" style={WS}>{c['stn0.name']}</h2>
            <p className="hs-cafm-desc" data-field="stn0.desc" style={WS}>{c['stn0.desc']}</p>
            <div className="hs-cafm-tags">
              <span className="hs-cafm-t hs-cafm-t-warn" data-field="stn0.t1" style={WS}>{c['stn0.t1']}</span>
              <span className="hs-cafm-t hs-cafm-t-warn" data-field="stn0.t2" style={WS}>{c['stn0.t2']}</span>
              <span className="hs-cafm-t hs-cafm-t-warn" data-field="stn0.t3" style={WS}>{c['stn0.t3']}</span>
              <span className="hs-cafm-t hs-cafm-t-ok" data-field="stn0.t4" style={WS}>{c['stn0.t4']}</span>
            </div>
            <div className="hs-cafm-meta">
              <div className="hs-cafm-meta-open" data-field="stn0.status" style={WS}>{c['stn0.status']}</div>
              <div className="hs-cafm-meta-line" data-field="stn0.line" style={WS}>{c['stn0.line']}</div>
            </div>
          </div>
        </article>

        {/* Station 1 — Garden */}
        <article className="hs-cafm-stn hs-cafm-s2">
          <div className="hs-cafm-top">
            <span data-field="stn1.label" style={WS}>{c['stn1.label']}</span>
            <span className="hs-cafm-num" data-field="stn1.num" style={WS}>{c['stn1.num']}</span>
          </div>
          <div className="hs-cafm-photo">
            <div className="hs-cafm-pricetag" data-field="stn1.price" style={WS}>{c['stn1.price']}</div>
            <div className="hs-cafm-ic" data-field="stn1.ic" style={WS}>{c['stn1.ic']}</div>
            <div className="hs-cafm-stamp" data-field="stn1.stamp" style={WS}>{c['stn1.stamp']}</div>
          </div>
          <div className="hs-cafm-body">
            <div className="hs-cafm-eyebrow" data-field="stn1.eyebrow" style={WS}>{c['stn1.eyebrow']}</div>
            <h2 className="hs-cafm-h2" data-field="stn1.name" style={WS}>{c['stn1.name']}</h2>
            <p className="hs-cafm-desc" data-field="stn1.desc" style={WS}>{c['stn1.desc']}</p>
            <div className="hs-cafm-tags">
              <span className="hs-cafm-t hs-cafm-t-ok" data-field="stn1.t1" style={WS}>{c['stn1.t1']}</span>
              <span className="hs-cafm-t hs-cafm-t-ok" data-field="stn1.t2" style={WS}>{c['stn1.t2']}</span>
              <span className="hs-cafm-t hs-cafm-t-ok" data-field="stn1.t3" style={WS}>{c['stn1.t3']}</span>
              <span className="hs-cafm-t hs-cafm-t-ok" data-field="stn1.t4" style={WS}>{c['stn1.t4']}</span>
            </div>
            <div className="hs-cafm-meta">
              <div className="hs-cafm-meta-open" data-field="stn1.status" style={WS}>{c['stn1.status']}</div>
              <div className="hs-cafm-meta-line" data-field="stn1.line" style={WS}>{c['stn1.line']}</div>
            </div>
          </div>
        </article>

        {/* Station 2 — Bowl */}
        <article className="hs-cafm-stn hs-cafm-s3">
          <div className="hs-cafm-top">
            <span data-field="stn2.label" style={WS}>{c['stn2.label']}</span>
            <span className="hs-cafm-num" data-field="stn2.num" style={WS}>{c['stn2.num']}</span>
          </div>
          <div className="hs-cafm-photo">
            <div className="hs-cafm-pricetag" data-field="stn2.price" style={WS}>{c['stn2.price']}</div>
            <div className="hs-cafm-ic" data-field="stn2.ic" style={WS}>{c['stn2.ic']}</div>
            <div className="hs-cafm-stamp" data-field="stn2.stamp" style={WS}>{c['stn2.stamp']}</div>
          </div>
          <div className="hs-cafm-body">
            <div className="hs-cafm-eyebrow" data-field="stn2.eyebrow" style={WS}>{c['stn2.eyebrow']}</div>
            <h2 className="hs-cafm-h2" data-field="stn2.name" style={WS}>{c['stn2.name']}</h2>
            <p className="hs-cafm-desc" data-field="stn2.desc" style={WS}>{c['stn2.desc']}</p>
            <div className="hs-cafm-tags">
              <span className="hs-cafm-t hs-cafm-t-warn" data-field="stn2.t1" style={WS}>{c['stn2.t1']}</span>
              <span className="hs-cafm-t hs-cafm-t-warn" data-field="stn2.t2" style={WS}>{c['stn2.t2']}</span>
              <span className="hs-cafm-t hs-cafm-t-ok" data-field="stn2.t3" style={WS}>{c['stn2.t3']}</span>
              <span className="hs-cafm-t hs-cafm-t-ok" data-field="stn2.t4" style={WS}>{c['stn2.t4']}</span>
            </div>
            <div className="hs-cafm-meta">
              <div className="hs-cafm-meta-open" data-field="stn2.status" style={WS}>{c['stn2.status']}</div>
              <div className="hs-cafm-meta-line" data-field="stn2.line" style={WS}>{c['stn2.line']}</div>
            </div>
          </div>
        </article>

        {/* Station 3 — Deli */}
        <article className="hs-cafm-stn hs-cafm-s4">
          <div className="hs-cafm-top">
            <span data-field="stn3.label" style={WS}>{c['stn3.label']}</span>
            <span className="hs-cafm-num" data-field="stn3.num" style={WS}>{c['stn3.num']}</span>
          </div>
          <div className="hs-cafm-photo">
            <div className="hs-cafm-pricetag" data-field="stn3.price" style={WS}>{c['stn3.price']}</div>
            <div className="hs-cafm-ic" data-field="stn3.ic" style={WS}>{c['stn3.ic']}</div>
            <div className="hs-cafm-stamp" data-field="stn3.stamp" style={WS}>{c['stn3.stamp']}</div>
          </div>
          <div className="hs-cafm-body">
            <div className="hs-cafm-eyebrow" data-field="stn3.eyebrow" style={WS}>{c['stn3.eyebrow']}</div>
            <h2 className="hs-cafm-h2" data-field="stn3.name" style={WS}>{c['stn3.name']}</h2>
            <p className="hs-cafm-desc" data-field="stn3.desc" style={WS}>{c['stn3.desc']}</p>
            <div className="hs-cafm-tags">
              <span className="hs-cafm-t hs-cafm-t-warn" data-field="stn3.t1" style={WS}>{c['stn3.t1']}</span>
              <span className="hs-cafm-t hs-cafm-t-warn" data-field="stn3.t2" style={WS}>{c['stn3.t2']}</span>
              <span className="hs-cafm-t hs-cafm-t-warn" data-field="stn3.t3" style={WS}>{c['stn3.t3']}</span>
              <span className="hs-cafm-t hs-cafm-t-ok" data-field="stn3.t4" style={WS}>{c['stn3.t4']}</span>
            </div>
            <div className="hs-cafm-meta">
              <div className="hs-cafm-meta-open" data-field="stn3.status" style={WS}>{c['stn3.status']}</div>
              <div className="hs-cafm-meta-line" data-field="stn3.line" style={WS}>{c['stn3.line']}</div>
            </div>
          </div>
        </article>

        {/* Station 4 — Sweets & sip */}
        <article className="hs-cafm-stn hs-cafm-s5">
          <div className="hs-cafm-top">
            <span data-field="stn4.label" style={WS}>{c['stn4.label']}</span>
            <span className="hs-cafm-num" data-field="stn4.num" style={WS}>{c['stn4.num']}</span>
          </div>
          <div className="hs-cafm-photo">
            <div className="hs-cafm-pricetag" data-field="stn4.price" style={WS}>{c['stn4.price']}</div>
            <div className="hs-cafm-ic" data-field="stn4.ic" style={WS}>{c['stn4.ic']}</div>
            <div className="hs-cafm-stamp" data-field="stn4.stamp" style={WS}>{c['stn4.stamp']}</div>
          </div>
          <div className="hs-cafm-body">
            <div className="hs-cafm-eyebrow" data-field="stn4.eyebrow" style={WS}>{c['stn4.eyebrow']}</div>
            <h2 className="hs-cafm-h2" data-field="stn4.name" style={WS}>{c['stn4.name']}</h2>
            <p className="hs-cafm-desc" data-field="stn4.desc" style={WS}>{c['stn4.desc']}</p>
            <div className="hs-cafm-tags">
              <span className="hs-cafm-t hs-cafm-t-warn" data-field="stn4.t1" style={WS}>{c['stn4.t1']}</span>
              <span className="hs-cafm-t hs-cafm-t-warn" data-field="stn4.t2" style={WS}>{c['stn4.t2']}</span>
              <span className="hs-cafm-t hs-cafm-t-warn" data-field="stn4.t3" style={WS}>{c['stn4.t3']}</span>
              <span className="hs-cafm-t hs-cafm-t-ok" data-field="stn4.t4" style={WS}>{c['stn4.t4']}</span>
            </div>
            <div className="hs-cafm-meta">
              <div className="hs-cafm-meta-open" data-field="stn4.status" style={WS}>{c['stn4.status']}</div>
              <div className="hs-cafm-meta-line" data-field="stn4.line" style={WS}>{c['stn4.line']}</div>
            </div>
          </div>
        </article>
      </section>

      {/* WEEK + INFO STRIP */}
      <section className="hs-cafm-strip">
        <div className="hs-cafm-week">
          <div className="hs-cafm-week-hdr">
            <h3 className="hs-cafm-week-h3" data-field="week.title" style={WS}>{c['week.title']}</h3>
            <div className="hs-cafm-week-meta" data-field="week.meta" style={WS}>{c['week.meta']}</div>
          </div>
          <ul>
            <li>
              <div className="hs-cafm-week-d" data-field="week.0.d" style={WS}>{c['week.0.d']}</div>
              <div className="hs-cafm-week-nm" data-field="week.0.nm" style={WS}>{c['week.0.nm']}</div>
            </li>
            <li className="hs-cafm-week-today">
              <div className="hs-cafm-week-d" data-field="week.1.d" style={WS}>{c['week.1.d']}</div>
              <div className="hs-cafm-week-nm" data-field="week.1.nm" style={WS}>{c['week.1.nm']}</div>
            </li>
            <li>
              <div className="hs-cafm-week-d" data-field="week.2.d" style={WS}>{c['week.2.d']}</div>
              <div className="hs-cafm-week-nm" data-field="week.2.nm" style={WS}>{c['week.2.nm']}</div>
            </li>
            <li>
              <div className="hs-cafm-week-d" data-field="week.3.d" style={WS}>{c['week.3.d']}</div>
              <div className="hs-cafm-week-nm" data-field="week.3.nm" style={WS}>{c['week.3.nm']}</div>
            </li>
            <li>
              <div className="hs-cafm-week-d" data-field="week.4.d" style={WS}>{c['week.4.d']}</div>
              <div className="hs-cafm-week-nm" data-field="week.4.nm" style={WS}>{c['week.4.nm']}</div>
            </li>
          </ul>
        </div>

        <div className="hs-cafm-info">
          <div className="hs-cafm-info-it">
            <div className="hs-cafm-info-k" data-field="info.0k" style={WS}>{c['info.0k']}</div>
            <div className="hs-cafm-info-v hs-cafm-info-v-s2" data-field="info.0v" style={WS}>{c['info.0v']}</div>
            <div className="hs-cafm-info-sub" data-field="info.0s" style={WS}>{c['info.0s']}</div>
          </div>
          <div className="hs-cafm-info-it">
            <div className="hs-cafm-info-k" data-field="info.1k" style={WS}>{c['info.1k']}</div>
            <div className="hs-cafm-info-v" data-field="info.1v" style={WS}>{c['info.1v']}</div>
            <div className="hs-cafm-info-sub" data-field="info.1s" style={WS}>{c['info.1s']}</div>
          </div>
          <div className="hs-cafm-info-it">
            <div className="hs-cafm-info-k" data-field="info.2k" style={WS}>{c['info.2k']}</div>
            <div className="hs-cafm-info-v hs-cafm-info-v-s1" data-field="info.2v" style={WS}>{c['info.2v']}</div>
            <div className="hs-cafm-info-sub" data-field="info.2s" style={WS}>{c['info.2s']}</div>
          </div>
        </div>
      </section>

      {/* TICKER */}
      <div className="hs-cafm-ticker">
        <div className="hs-cafm-ticker-tag" data-field="ticker.tag" style={WS}>{c['ticker.tag']}</div>
        <div className="hs-cafm-ticker-msg">
          <span data-field="ticker.message" style={WS}>{c['ticker.message']}</span>
          <span>&nbsp;<span className="hs-cafm-ticker-star">◆</span>&nbsp;</span>
          <span data-field="ticker.message2" style={WS}>{c['ticker.message2']}</span>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — pixel-perfect against scratch/design/hs-district/hs-district-pack/caf-market.html. */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800;900&family=Archivo+Narrow:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap');

.hs-cafm-bg {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(1400px 800px at 50% -10%, rgba(232,74,58,.08), transparent 60%),
    repeating-linear-gradient(0deg, rgba(0,0,0,.018) 0 1px, transparent 1px 3px);
}
@keyframes hsCafmBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: .3; } }
@keyframes hsCafmSc { from { transform: translateX(0); } to { transform: translateX(-50%); } }

/* MASTHEAD */
.hs-cafm-mast {
  position: absolute; top: 60px; left: 80px; right: 80px; height: 240px;
  display: grid; grid-template-columns: auto 1fr auto; gap: 48px; align-items: center;
  border-bottom: 6px solid #181613; padding-bottom: 0; z-index: 4;
}
.hs-cafm-seal {
  width: 200px; height: 200px; background: #181613; color: #fbf6ee;
  display: grid; place-items: center; text-align: center; line-height: 1;
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 74px;
  letter-spacing: -.02em;
}
.hs-cafm-est {
  display: block; font-family: 'DM Mono', monospace; font-weight: 500; font-size: 26px;
  color: #caa14a; letter-spacing: .22em; margin-top: 10px;
}
.hs-cafm-title { display: flex; flex-direction: column; line-height: .9; }
.hs-cafm-sup {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 30px;
  letter-spacing: .34em; color: #5a544a; text-transform: uppercase; margin-bottom: 14px;
}
.hs-cafm-name {
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 200px;
  letter-spacing: -.04em; color: #181613; text-transform: uppercase;
}
.hs-cafm-acc { color: #e84a3a; }
.hs-cafm-mast-right { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.hs-cafm-day {
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 80px; line-height: .9;
  color: #181613; letter-spacing: -.02em;
}
.hs-cafm-date {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 28px;
  letter-spacing: .22em; color: #5a544a; text-transform: uppercase;
}
.hs-cafm-open {
  margin-top: 6px; padding: 12px 22px; background: #2f8c4f; color: #fff;
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .22em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 14px;
}
.hs-cafm-open::before {
  content: ''; width: 14px; height: 14px; border-radius: 50%; background: #fff;
  animation: hsCafmBlink 1.4s steps(2) infinite;
}

/* CHIPS */
.hs-cafm-chips {
  position: absolute; top: 340px; left: 80px; right: 80px;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; z-index: 3;
}
.hs-cafm-chip {
  background: #fff; border: 4px solid #181613; padding: 22px 28px;
  display: flex; justify-content: space-between; align-items: center; gap: 18px;
}
.hs-cafm-chip-k {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 30px;
  letter-spacing: .22em; color: #5a544a; text-transform: uppercase; line-height: 1;
}
.hs-cafm-chip-v {
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 84px; line-height: 1;
  color: #181613; letter-spacing: -.02em; font-variant-numeric: tabular-nums; white-space: nowrap;
}
.hs-cafm-chip-ink { background: #181613; }
.hs-cafm-chip-ink .hs-cafm-chip-k { color: #caa14a; }
.hs-cafm-chip-ink .hs-cafm-chip-v { color: #fbf6ee; }
.hs-cafm-chip-s1 { background: #e84a3a; border-color: #a82414; }
.hs-cafm-chip-s1 .hs-cafm-chip-k { color: rgba(255,255,255,.78); }
.hs-cafm-chip-s1 .hs-cafm-chip-v { color: #fff; }
.hs-cafm-chip-s2 { background: #2f8c4f; border-color: #1a5c33; }
.hs-cafm-chip-s2 .hs-cafm-chip-k { color: rgba(255,255,255,.78); }
.hs-cafm-chip-s2 .hs-cafm-chip-v { color: #fff; }
.hs-cafm-chip-dot::after {
  content: ''; display: inline-block; width: 14px; height: 14px;
  background: #fff; border-radius: 50%; margin-left: 12px; vertical-align: middle;
  animation: hsCafmBlink 1.4s steps(2) infinite;
}

/* STATIONS GRID */
.hs-cafm-grid {
  position: absolute; top: 540px; left: 80px; right: 80px; height: 1240px;
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 24px; z-index: 3;
}
.hs-cafm-stn {
  position: relative; display: flex; flex-direction: column;
  background: #fff; border: 4px solid #181613; overflow: hidden;
}
.hs-cafm-top {
  height: 120px; color: #fff;
  display: flex; align-items: center; justify-content: space-between; padding: 0 28px;
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 54px;
  letter-spacing: -.02em; text-transform: uppercase;
}
.hs-cafm-num {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 32px;
  letter-spacing: .22em; opacity: .7; text-transform: uppercase;
}
.hs-cafm-photo {
  height: 520px; position: relative; overflow: hidden;
  display: grid; place-items: center; border-bottom: 4px solid #181613;
}
.hs-cafm-photo::before {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(45deg, transparent 0 60px, rgba(0,0,0,.06) 60px 62px);
}
.hs-cafm-ic {
  font-size: 340px; line-height: 1;
  filter: drop-shadow(0 16px 32px rgba(0,0,0,.4)); z-index: 1;
}
.hs-cafm-pricetag {
  position: absolute; top: 24px; right: 24px; background: #fff; color: #181613;
  padding: 14px 22px; font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 60px;
  line-height: 1; letter-spacing: -.03em; border: 4px solid #181613;
  font-variant-numeric: tabular-nums; z-index: 2;
}
.hs-cafm-stamp {
  position: absolute; bottom: 24px; left: 24px; background: rgba(0,0,0,.55); color: #fff;
  padding: 10px 18px; font-family: 'DM Mono', monospace; font-weight: 700; font-size: 28px;
  letter-spacing: .22em; text-transform: uppercase; backdrop-filter: blur(4px); z-index: 2;
}
.hs-cafm-body { padding: 24px 28px 22px; display: flex; flex-direction: column; flex: 1; }
.hs-cafm-eyebrow {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 30px;
  letter-spacing: .24em; text-transform: uppercase; line-height: 1;
}
.hs-cafm-h2 {
  margin: 8px 0 6px; font-family: 'Archivo', sans-serif; font-weight: 900;
  font-size: 52px; line-height: .95; letter-spacing: -.02em; color: #181613;
}
.hs-cafm-desc {
  margin: 0; font-family: 'Archivo Narrow', sans-serif; font-weight: 500;
  font-size: 30px; line-height: 1.3; color: #5a544a; flex: 1;
}
.hs-cafm-tags {
  display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px;
  border-top: 2px solid #d8cdb6; padding-top: 14px;
}
.hs-cafm-t {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .18em; text-transform: uppercase;
  background: #f2eadc; color: #181613; padding: 8px 14px; line-height: 1;
}
.hs-cafm-t-warn { background: #ffe2dc; color: #a82414; }
.hs-cafm-t-ok { background: #dcefe1; color: #1a5c33; }
.hs-cafm-meta {
  display: flex; justify-content: space-between; align-items: center;
  border-top: 2px solid #d8cdb6; margin-top: 14px; padding-top: 12px;
}
.hs-cafm-meta-open {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 26px;
  letter-spacing: .22em; text-transform: uppercase; color: #1a5c33;
  display: flex; align-items: center; gap: 10px;
}
.hs-cafm-meta-open::before {
  content: ''; width: 10px; height: 10px; border-radius: 50%; background: #2f8c4f;
  animation: hsCafmBlink 1.4s steps(2) infinite;
}
.hs-cafm-meta-line {
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 30px;
  color: #181613; letter-spacing: -.01em; font-variant-numeric: tabular-nums;
}

.hs-cafm-s1 .hs-cafm-top { background: #e84a3a; }
.hs-cafm-s1 .hs-cafm-eyebrow { color: #a82414; }
.hs-cafm-s1 .hs-cafm-photo { background: linear-gradient(135deg, #5a1a10, #a8311a); }
.hs-cafm-s2 .hs-cafm-top { background: #2f8c4f; }
.hs-cafm-s2 .hs-cafm-eyebrow { color: #1a5c33; }
.hs-cafm-s2 .hs-cafm-photo { background: linear-gradient(135deg, #1a4626, #3aa15a); }
.hs-cafm-s3 .hs-cafm-top { background: #f0a830; }
.hs-cafm-s3 .hs-cafm-eyebrow { color: #a36b15; }
.hs-cafm-s3 .hs-cafm-photo { background: linear-gradient(135deg, #5a3a10, #d8a040); }
.hs-cafm-s4 .hs-cafm-top { background: #3a6dc7; }
.hs-cafm-s4 .hs-cafm-eyebrow { color: #1f4a99; }
.hs-cafm-s4 .hs-cafm-photo { background: linear-gradient(135deg, #142a5a, #3a6dc7); }
.hs-cafm-s5 .hs-cafm-top { background: #7c4ec7; }
.hs-cafm-s5 .hs-cafm-eyebrow { color: #4a2d80; }
.hs-cafm-s5 .hs-cafm-photo { background: linear-gradient(135deg, #3a1a5a, #7c4ec7); }

/* WEEK + INFO STRIP */
.hs-cafm-strip {
  position: absolute; left: 80px; right: 80px; bottom: 160px; height: 200px;
  display: grid; grid-template-columns: 1fr 1.2fr; gap: 24px; z-index: 3;
}
.hs-cafm-week {
  background: #181613; color: #fbf6ee; padding: 20px 28px;
  display: flex; flex-direction: column; gap: 8px;
}
.hs-cafm-week-hdr { display: flex; justify-content: space-between; align-items: baseline; }
.hs-cafm-week-h3 {
  margin: 0; font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 36px;
  color: #fff; letter-spacing: -.01em; text-transform: uppercase;
}
.hs-cafm-week-meta {
  font-family: 'DM Mono', monospace; font-weight: 500; font-size: 28px;
  color: #caa14a; letter-spacing: .22em; text-transform: uppercase;
}
.hs-cafm-week ul {
  list-style: none; padding: 0; margin: 0;
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; flex: 1;
}
.hs-cafm-week li {
  padding: 10px 12px; border: 2px solid rgba(255,255,255,.18);
  display: flex; flex-direction: column; justify-content: space-between;
}
.hs-cafm-week-today { background: #e84a3a; border-color: #a82414; }
.hs-cafm-week-d {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 26px;
  letter-spacing: .22em; color: #caa14a; text-transform: uppercase; line-height: 1;
}
.hs-cafm-week-today .hs-cafm-week-d { color: #fff; }
.hs-cafm-week-nm {
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 30px;
  line-height: 1.05; color: #fff; letter-spacing: -.01em; margin-top: 8px;
}
.hs-cafm-info {
  background: #fff; border: 4px solid #181613; padding: 20px 28px;
  display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 24px; align-items: center;
}
.hs-cafm-info-it { display: flex; flex-direction: column; }
.hs-cafm-info-k {
  font-family: 'DM Mono', monospace; font-weight: 700; font-size: 30px;
  letter-spacing: .24em; text-transform: uppercase; color: #5a544a; line-height: 1;
}
.hs-cafm-info-v {
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 54px; line-height: 1.05;
  color: #181613; letter-spacing: -.02em; margin-top: 6px;
}
.hs-cafm-info-sub {
  font-family: 'Archivo Narrow', sans-serif; font-weight: 500; font-size: 28px;
  color: #5a544a; margin-top: 4px;
}
.hs-cafm-info-v-s2 { color: #1a5c33; }
.hs-cafm-info-v-s1 { color: #a82414; }

/* TICKER */
.hs-cafm-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 96px;
  background: #181613; color: #fbf6ee;
  display: flex; align-items: center; overflow: hidden; z-index: 5;
  border-top: 6px solid #e84a3a;
}
.hs-cafm-ticker-tag {
  flex: 0 0 auto; background: #e84a3a; color: #fff;
  font-family: 'Archivo', sans-serif; font-weight: 900; font-size: 36px;
  padding: 0 36px; height: 100%;
  display: flex; align-items: center; letter-spacing: -.01em; text-transform: uppercase; gap: 16px;
}
.hs-cafm-ticker-tag::before {
  content: ''; width: 18px; height: 18px; background: #fff; border-radius: 50%;
  animation: hsCafmBlink 1.4s steps(2) infinite;
}
.hs-cafm-ticker-msg {
  font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 32px;
  padding-left: 36px; white-space: nowrap; letter-spacing: .04em;
  text-transform: uppercase; animation: hsCafmSc 90s linear infinite;
}
.hs-cafm-ticker-star { color: #e84a3a; margin: 0 22px; }
`;
