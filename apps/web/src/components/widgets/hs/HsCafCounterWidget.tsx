"use client";

/**
 * HsCafCounterWidget — Cafeteria Chef's Counter scene, 3840×2160.
 *
 * Restaurant-grade refined cafeteria board with a hero "today's plate"
 * card on the left, a live-status lines column on the right, an
 * allergen card strip across the bottom, and a marquee ticker. Paper-
 * stock palette (cream + ink + muted green + tomato accent), Fraunces
 * display + JetBrains Mono labels.
 *
 * APPROVED 2026-05-07 — matches scratch/design/hs-district/hs-district-pack/caf-counter.html
 * Operator: "these need to be wired in for the highschools"
 *
 * Editable widget regions (every text node has data-field):
 *   - school          → seal initials + est year
 *   - brand           → "Counter & Co." title + subtitle
 *   - day             → day name + date + open status
 *   - clock           → live header time chip (label + time)
 *   - block           → lunch block letter
 *   - harvest         → harvest of the month chip
 *   - meals           → meals served chip
 *   - tomorrow        → tomorrow's preview chip
 *   - plate           → hero plate (corner stamp, eyebrow, headline,
 *                       description, calories/protein/served/source/chef,
 *                       price tag k/v/sub, icon)
 *   - lines (×5)      → station status rows (name, sub, status)
 *   - sides (×5)      → counter sides rows (name, sub, price)
 *   - allergens (×6)  → allergen tiles (mark, name, sub) plus
 *                       "ask a chef" callout (k/v/nm)
 *   - ticker          → bottom marquee (tag + dual message copies)
 *
 * Live clock note: the header `clock.time` field auto-resolves to the
 * current local time when the operator leaves the placeholder
 * "11:24" untouched. Override to freeze for marketing screenshots.
 */

import { HsStage } from './HsStage';
import { useHsLiveClock } from './useHsLiveClock';

export interface HsCafCounterConfig {
  'school.initials'?: string;
  'school.est'?: string;
  'brand.t1'?: string;
  'brand.t2'?: string;
  'brand.sub'?: string;
  'day.name'?: string;
  'day.date'?: string;
  'day.status'?: string;
  'clock.label'?: string;
  'clock.time'?: string;
  'block.label'?: string;
  'block.value'?: string;
  'harvest.label'?: string;
  'harvest.value'?: string;
  'meals.label'?: string;
  'meals.value'?: string;
  'tomorrow.label'?: string;
  'tomorrow.value'?: string;
  'plate.corner'?: string;
  'plate.ic'?: string;
  'plate.priceK'?: string;
  'plate.priceV'?: string;
  'plate.priceSub'?: string;
  'plate.eyebrow'?: string;
  'plate.t1'?: string;
  'plate.t2'?: string;
  'plate.desc'?: string;
  'plate.cal'?: string;
  'plate.pro'?: string;
  'plate.served'?: string;
  'plate.source'?: string;
  'plate.chef'?: string;
  'lines.title'?: string;
  'lines.meta'?: string;
  'lines.0.nm'?: string;
  'lines.0.sub'?: string;
  'lines.0.st'?: string;
  'lines.1.nm'?: string;
  'lines.1.sub'?: string;
  'lines.1.st'?: string;
  'lines.2.nm'?: string;
  'lines.2.sub'?: string;
  'lines.2.st'?: string;
  'lines.3.nm'?: string;
  'lines.3.sub'?: string;
  'lines.3.st'?: string;
  'lines.4.nm'?: string;
  'lines.4.sub'?: string;
  'lines.4.st'?: string;
  'sides.title'?: string;
  'sides.meta'?: string;
  'sides.0.nm'?: string;
  'sides.0.sub'?: string;
  'sides.0.pr'?: string;
  'sides.1.nm'?: string;
  'sides.1.sub'?: string;
  'sides.1.pr'?: string;
  'sides.2.nm'?: string;
  'sides.2.sub'?: string;
  'sides.2.pr'?: string;
  'sides.3.nm'?: string;
  'sides.3.sub'?: string;
  'sides.3.pr'?: string;
  'sides.4.nm'?: string;
  'sides.4.sub'?: string;
  'sides.4.pr'?: string;
  'allergens.label'?: string;
  'allergens.title'?: string;
  'allergens.0.mark'?: string;
  'allergens.0.nm'?: string;
  'allergens.0.sub'?: string;
  'allergens.1.mark'?: string;
  'allergens.1.nm'?: string;
  'allergens.1.sub'?: string;
  'allergens.2.mark'?: string;
  'allergens.2.nm'?: string;
  'allergens.2.sub'?: string;
  'allergens.3.mark'?: string;
  'allergens.3.nm'?: string;
  'allergens.3.sub'?: string;
  'allergens.4.mark'?: string;
  'allergens.4.nm'?: string;
  'allergens.4.sub'?: string;
  'allergens.5.mark'?: string;
  'allergens.5.nm'?: string;
  'allergens.5.sub'?: string;
  'allergens.askK'?: string;
  'allergens.askV'?: string;
  'allergens.askNm'?: string;
  'ticker.tag'?: string;
  'ticker.message'?: string;
  'ticker.message2'?: string;
}

export const DEFAULTS: Required<HsCafCounterConfig> = {
  'school.initials': 'WHS',
  'school.est': 'EST. 1956',
  'brand.t1': 'Counter ',
  'brand.t2': ' Co.',
  'brand.sub': "Westridge Cafeteria · Chef's table",
  'day.name': 'Tuesday lunch',
  'day.date': 'Oct 14 · Service 10:58–1:18',
  'day.status': 'Open · the grill is hot',
  'clock.label': 'Right now',
  'clock.time': '11:24',
  'block.label': 'Lunch block',
  'block.value': 'B',
  'harvest.label': 'Harvest of the month',
  'harvest.value': 'Apple',
  'meals.label': 'Meals served today',
  'meals.value': '412',
  'tomorrow.label': 'Tomorrow',
  'tomorrow.value': 'Tacos',
  'plate.corner': "Today's plate · served hot",
  'plate.ic': '🍝',
  'plate.priceK': 'Full tray',
  'plate.priceV': '$4.50',
  'plate.priceSub': 'Cash · card · Boost',
  'plate.eyebrow': 'Special of the day',
  'plate.t1': 'Sunday-gravy ',
  'plate.t2': 'rigatoni.',
  'plate.desc': 'Slow-braised pork shoulder & beef chuck, hand-crushed San Marzano, basil from the Banner farm hoop-house, broken ricotta on top. Served with a slab of garlic focaccia.',
  'plate.cal': '680',
  'plate.pro': '38g',
  'plate.served': '11–1',
  'plate.source': 'Local 84%',
  'plate.chef': 'M. Russo',
  'lines.title': 'Lines · live status',
  'lines.meta': '5 stations · seat 380',
  'lines.0.nm': 'Line A · Hot Plate',
  'lines.0.sub': "Today's special & sides",
  'lines.0.st': 'Open · short wait',
  'lines.1.nm': 'Line B · Grill',
  'lines.1.sub': 'Smash burgers & chicken sandwich',
  'lines.1.st': 'Busy · 6 min',
  'lines.2.nm': 'Line C · Garden',
  'lines.2.sub': 'Salad bar · 8 toppings · 4 dressings',
  'lines.2.st': 'Open · grab & go',
  'lines.3.nm': 'Line D · Deli',
  'lines.3.sub': 'Build a sandwich · 6 breads · 4 proteins',
  'lines.3.st': 'Open · short wait',
  'lines.4.nm': 'Line E · Wok',
  'lines.4.sub': 'Stir fry · Wed & Fri only',
  'lines.4.st': 'Closed · back Wed',
  'sides.title': 'On the counter',
  'sides.meta': 'All include free fountain',
  'sides.0.nm': 'Caesar wedge',
  'sides.0.sub': 'Romaine heart · grana padano · sourdough crouton',
  'sides.0.pr': '$3.25',
  'sides.1.nm': 'Roasted root medley',
  'sides.1.sub': 'Carrot · parsnip · beet · thyme · GF · vegan',
  'sides.1.pr': '$2.75',
  'sides.2.nm': 'Garlic focaccia',
  'sides.2.sub': 'Pulled fresh from the oven at 11 & 12:15',
  'sides.2.pr': '$1.50',
  'sides.3.nm': 'Tomato-basil bisque',
  'sides.3.sub': 'Cup or bowl · grilled-cheese add-on $1.25',
  'sides.3.pr': '$2.75',
  'sides.4.nm': 'Gala apple · Banner farm',
  'sides.4.sub': 'Picked this morning · eat me first',
  'sides.4.pr': '$0.75',
  'allergens.label': "In today's hero",
  'allergens.title': 'Allergen card',
  'allergens.0.mark': '⚠',
  'allergens.0.nm': 'Wheat',
  'allergens.0.sub': 'Pasta · focaccia',
  'allergens.1.mark': '⚠',
  'allergens.1.nm': 'Dairy',
  'allergens.1.sub': 'Ricotta · butter',
  'allergens.2.mark': '✓',
  'allergens.2.nm': 'Egg-free',
  'allergens.2.sub': 'No eggs in sauce',
  'allergens.3.mark': '✓',
  'allergens.3.nm': 'Nut-free',
  'allergens.3.sub': 'Whole kitchen',
  'allergens.4.mark': '✓',
  'allergens.4.nm': 'Soy-free',
  'allergens.4.sub': 'Today only',
  'allergens.5.mark': '⚠',
  'allergens.5.nm': 'Pork',
  'allergens.5.sub': 'In gravy · sub avail.',
  'allergens.askK': 'Need something different?',
  'allergens.askV': 'Ask a chef.',
  'allergens.askNm': 'Daily GF · vegan plates ready by request — 10 min',
  'ticker.tag': 'From the kitchen',
  'ticker.message': 'All produce delivered fresh from Banner Farm and Westridge Greenhouse — within 12 miles · Free seconds on apples while they last · Bring your tray back · the dishwasher misses you · Smoothie bar Wednesday — strawberry-banana & mango · Senior & staff free coffee 7–8 every morning · Allergy or diet question? Ask Chef Russo at the counter',
  'ticker.message2': 'All produce delivered fresh from Banner Farm and Westridge Greenhouse — within 12 miles · Free seconds on apples while they last · Bring your tray back · the dishwasher misses you · Smoothie bar Wednesday — strawberry-banana & mango · Senior & staff free coffee 7–8 every morning · Allergy or diet question? Ask Chef Russo at the counter',
};

const WS = { whiteSpace: 'pre-wrap' as const };

export function HsCafCounterWidget({ config, live }: { config?: HsCafCounterConfig; live?: boolean }) {
  const c = { ...DEFAULTS, ...(config || {}) } as Required<HsCafCounterConfig>;
  // Live clock — keeps demo signage from showing a frozen "11:24" all
  // day. Operator override (any value other than the default placeholder)
  // wins so marketing screenshots stay reproducible.
  const now = useHsLiveClock(live !== false);
  const liveClock = c['clock.time'] === DEFAULTS['clock.time']
    ? now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : c['clock.time'];

  return (
    <HsStage
      stageStyle={{
        background: '#f3ece0',
        fontFamily: "'Inter', sans-serif",
        color: '#1c1814',
      }}
    >
      <style>{CSS}</style>
      <div className="hs-cafc-bg" />

      {/* MASTHEAD */}
      <header className="hs-cafc-mast">
        <div className="hs-cafc-mast-left">
          <div className="hs-cafc-seal">
            <div>
              <span data-field="school.initials" style={WS}>{c['school.initials']}</span>
              <span className="hs-cafc-est" data-field="school.est" style={WS}>{c['school.est']}</span>
            </div>
          </div>
          <h1 className="hs-cafc-title">
            <span data-field="brand.t1" style={WS}>{c['brand.t1']}</span>
            <span className="hs-cafc-amp">&amp;</span>
            <span data-field="brand.t2" style={WS}>{c['brand.t2']}</span>
            <span className="hs-cafc-sub" data-field="brand.sub" style={WS}>{c['brand.sub']}</span>
          </h1>
        </div>
        <div className="hs-cafc-mast-right">
          <div className="hs-cafc-day" data-field="day.name" style={WS}>{c['day.name']}</div>
          <div className="hs-cafc-date" data-field="day.date" style={WS}>{c['day.date']}</div>
          <div className="hs-cafc-open" data-field="day.status" style={WS}>{c['day.status']}</div>
        </div>
      </header>

      {/* CHIPS */}
      <section className="hs-cafc-chips">
        <div className="hs-cafc-chip hs-cafc-chip-lit">
          <div className="hs-cafc-chip-k" data-field="clock.label" style={WS}>{c['clock.label']}</div>
          <div className="hs-cafc-chip-v hs-cafc-chip-dot" data-field="clock.time" style={WS}>{liveClock}</div>
        </div>
        <div className="hs-cafc-chip">
          <div className="hs-cafc-chip-k" data-field="block.label" style={WS}>{c['block.label']}</div>
          <div className="hs-cafc-chip-v" data-field="block.value" style={WS}>{c['block.value']}</div>
        </div>
        <div className="hs-cafc-chip hs-cafc-chip-green">
          <div className="hs-cafc-chip-k" data-field="harvest.label" style={WS}>{c['harvest.label']}</div>
          <div className="hs-cafc-chip-v" data-field="harvest.value" style={WS}>{c['harvest.value']}</div>
        </div>
        <div className="hs-cafc-chip">
          <div className="hs-cafc-chip-k" data-field="meals.label" style={WS}>{c['meals.label']}</div>
          <div className="hs-cafc-chip-v" data-field="meals.value" style={WS}>{c['meals.value']}</div>
        </div>
        <div className="hs-cafc-chip hs-cafc-chip-tomato">
          <div className="hs-cafc-chip-k" data-field="tomorrow.label" style={WS}>{c['tomorrow.label']}</div>
          <div className="hs-cafc-chip-v" data-field="tomorrow.value" style={WS}>{c['tomorrow.value']}</div>
        </div>
      </section>

      {/* HERO PLATE */}
      <article className="hs-cafc-hero">
        <div className="hs-cafc-photo">
          <div className="hs-cafc-corner" data-field="plate.corner" style={WS}>{c['plate.corner']}</div>
          <div className="hs-cafc-ic" data-field="plate.ic" style={WS}>{c['plate.ic']}</div>
          <div className="hs-cafc-pricetag">
            <div>
              <div className="hs-cafc-pt-k" data-field="plate.priceK" style={WS}>{c['plate.priceK']}</div>
              <div className="hs-cafc-pt-v" data-field="plate.priceV" style={WS}>{c['plate.priceV']}</div>
              <div className="hs-cafc-pt-sub" data-field="plate.priceSub" style={WS}>{c['plate.priceSub']}</div>
            </div>
          </div>
        </div>
        <div className="hs-cafc-body">
          <div className="hs-cafc-eyebrow">
            <span data-field="plate.eyebrow" style={WS}>{c['plate.eyebrow']}</span>
          </div>
          <h1 className="hs-cafc-h1">
            <span data-field="plate.t1" style={WS}>{c['plate.t1']}</span>
            <span className="hs-cafc-acc" data-field="plate.t2" style={WS}>{c['plate.t2']}</span>
          </h1>
          <p className="hs-cafc-desc" data-field="plate.desc" style={WS}>{c['plate.desc']}</p>
          <div className="hs-cafc-meta">
            <div className="hs-cafc-it"><div className="hs-cafc-it-k">Calories</div><div className="hs-cafc-it-v" data-field="plate.cal" style={WS}>{c['plate.cal']}</div></div>
            <div className="hs-cafc-it"><div className="hs-cafc-it-k">Protein</div><div className="hs-cafc-it-v" data-field="plate.pro" style={WS}>{c['plate.pro']}</div></div>
            <div className="hs-cafc-it"><div className="hs-cafc-it-k">Served</div><div className="hs-cafc-it-v" data-field="plate.served" style={WS}>{c['plate.served']}</div></div>
            <div className="hs-cafc-it"><div className="hs-cafc-it-k">Sourced</div><div className="hs-cafc-it-v hs-cafc-v-green" data-field="plate.source" style={WS}>{c['plate.source']}</div></div>
            <div className="hs-cafc-it"><div className="hs-cafc-it-k">Chef</div><div className="hs-cafc-it-v hs-cafc-v-tomato" data-field="plate.chef" style={WS}>{c['plate.chef']}</div></div>
          </div>
        </div>
      </article>

      {/* RIGHT COLUMN — lines + sides */}
      <aside className="hs-cafc-col">
        <div className="hs-cafc-lines">
          <h3 className="hs-cafc-lines-h3">
            <span data-field="lines.title" style={WS}>{c['lines.title']}</span>
            <span className="hs-cafc-lines-meta" data-field="lines.meta" style={WS}>{c['lines.meta']}</span>
          </h3>
          <ul>
            <li>
              <div className="hs-cafc-line-dot" />
              <div className="hs-cafc-line-nm">
                <span data-field="lines.0.nm" style={WS}>{c['lines.0.nm']}</span>
                <span className="hs-cafc-line-sub" data-field="lines.0.sub" style={WS}>{c['lines.0.sub']}</span>
              </div>
              <div className="hs-cafc-line-st" data-field="lines.0.st" style={WS}>{c['lines.0.st']}</div>
            </li>
            <li className="hs-cafc-busy">
              <div className="hs-cafc-line-dot" />
              <div className="hs-cafc-line-nm">
                <span data-field="lines.1.nm" style={WS}>{c['lines.1.nm']}</span>
                <span className="hs-cafc-line-sub" data-field="lines.1.sub" style={WS}>{c['lines.1.sub']}</span>
              </div>
              <div className="hs-cafc-line-st" data-field="lines.1.st" style={WS}>{c['lines.1.st']}</div>
            </li>
            <li>
              <div className="hs-cafc-line-dot" />
              <div className="hs-cafc-line-nm">
                <span data-field="lines.2.nm" style={WS}>{c['lines.2.nm']}</span>
                <span className="hs-cafc-line-sub" data-field="lines.2.sub" style={WS}>{c['lines.2.sub']}</span>
              </div>
              <div className="hs-cafc-line-st" data-field="lines.2.st" style={WS}>{c['lines.2.st']}</div>
            </li>
            <li>
              <div className="hs-cafc-line-dot" />
              <div className="hs-cafc-line-nm">
                <span data-field="lines.3.nm" style={WS}>{c['lines.3.nm']}</span>
                <span className="hs-cafc-line-sub" data-field="lines.3.sub" style={WS}>{c['lines.3.sub']}</span>
              </div>
              <div className="hs-cafc-line-st" data-field="lines.3.st" style={WS}>{c['lines.3.st']}</div>
            </li>
            <li className="hs-cafc-closed">
              <div className="hs-cafc-line-dot" />
              <div className="hs-cafc-line-nm">
                <span data-field="lines.4.nm" style={WS}>{c['lines.4.nm']}</span>
                <span className="hs-cafc-line-sub" data-field="lines.4.sub" style={WS}>{c['lines.4.sub']}</span>
              </div>
              <div className="hs-cafc-line-st" data-field="lines.4.st" style={WS}>{c['lines.4.st']}</div>
            </li>
          </ul>
        </div>

        <div className="hs-cafc-sides">
          <h3 className="hs-cafc-sides-h3">
            <span data-field="sides.title" style={WS}>{c['sides.title']}</span>
            <span className="hs-cafc-sides-meta" data-field="sides.meta" style={WS}>{c['sides.meta']}</span>
          </h3>
          <ul>
            <li>
              <div className="hs-cafc-side-nm">
                <span data-field="sides.0.nm" style={WS}>{c['sides.0.nm']}</span>
                <span className="hs-cafc-side-sub" data-field="sides.0.sub" style={WS}>{c['sides.0.sub']}</span>
              </div>
              <div className="hs-cafc-side-pr" data-field="sides.0.pr" style={WS}>{c['sides.0.pr']}</div>
            </li>
            <li>
              <div className="hs-cafc-side-nm">
                <span data-field="sides.1.nm" style={WS}>{c['sides.1.nm']}</span>
                <span className="hs-cafc-side-sub" data-field="sides.1.sub" style={WS}>{c['sides.1.sub']}</span>
              </div>
              <div className="hs-cafc-side-pr" data-field="sides.1.pr" style={WS}>{c['sides.1.pr']}</div>
            </li>
            <li>
              <div className="hs-cafc-side-nm">
                <span data-field="sides.2.nm" style={WS}>{c['sides.2.nm']}</span>
                <span className="hs-cafc-side-sub" data-field="sides.2.sub" style={WS}>{c['sides.2.sub']}</span>
              </div>
              <div className="hs-cafc-side-pr" data-field="sides.2.pr" style={WS}>{c['sides.2.pr']}</div>
            </li>
            <li>
              <div className="hs-cafc-side-nm">
                <span data-field="sides.3.nm" style={WS}>{c['sides.3.nm']}</span>
                <span className="hs-cafc-side-sub" data-field="sides.3.sub" style={WS}>{c['sides.3.sub']}</span>
              </div>
              <div className="hs-cafc-side-pr" data-field="sides.3.pr" style={WS}>{c['sides.3.pr']}</div>
            </li>
            <li>
              <div className="hs-cafc-side-nm">
                <span data-field="sides.4.nm" style={WS}>{c['sides.4.nm']}</span>
                <span className="hs-cafc-side-sub" data-field="sides.4.sub" style={WS}>{c['sides.4.sub']}</span>
              </div>
              <div className="hs-cafc-side-pr" data-field="sides.4.pr" style={WS}>{c['sides.4.pr']}</div>
            </li>
          </ul>
        </div>
      </aside>

      {/* ALLERGEN STRIP */}
      <section className="hs-cafc-allergens">
        <div className="hs-cafc-allergens-lbl">
          <div className="hs-cafc-allergens-k" data-field="allergens.label" style={WS}>{c['allergens.label']}</div>
          <div className="hs-cafc-allergens-v" data-field="allergens.title" style={WS}>{c['allergens.title']}</div>
        </div>
        <div className="hs-cafc-a hs-cafc-a-bad">
          <div className="hs-cafc-a-mark" data-field="allergens.0.mark" style={WS}>{c['allergens.0.mark']}</div>
          <div className="hs-cafc-a-nm" data-field="allergens.0.nm" style={WS}>{c['allergens.0.nm']}</div>
          <div className="hs-cafc-a-sub" data-field="allergens.0.sub" style={WS}>{c['allergens.0.sub']}</div>
        </div>
        <div className="hs-cafc-a hs-cafc-a-bad">
          <div className="hs-cafc-a-mark" data-field="allergens.1.mark" style={WS}>{c['allergens.1.mark']}</div>
          <div className="hs-cafc-a-nm" data-field="allergens.1.nm" style={WS}>{c['allergens.1.nm']}</div>
          <div className="hs-cafc-a-sub" data-field="allergens.1.sub" style={WS}>{c['allergens.1.sub']}</div>
        </div>
        <div className="hs-cafc-a">
          <div className="hs-cafc-a-mark" data-field="allergens.2.mark" style={WS}>{c['allergens.2.mark']}</div>
          <div className="hs-cafc-a-nm" data-field="allergens.2.nm" style={WS}>{c['allergens.2.nm']}</div>
          <div className="hs-cafc-a-sub" data-field="allergens.2.sub" style={WS}>{c['allergens.2.sub']}</div>
        </div>
        <div className="hs-cafc-a">
          <div className="hs-cafc-a-mark" data-field="allergens.3.mark" style={WS}>{c['allergens.3.mark']}</div>
          <div className="hs-cafc-a-nm" data-field="allergens.3.nm" style={WS}>{c['allergens.3.nm']}</div>
          <div className="hs-cafc-a-sub" data-field="allergens.3.sub" style={WS}>{c['allergens.3.sub']}</div>
        </div>
        <div className="hs-cafc-a">
          <div className="hs-cafc-a-mark" data-field="allergens.4.mark" style={WS}>{c['allergens.4.mark']}</div>
          <div className="hs-cafc-a-nm" data-field="allergens.4.nm" style={WS}>{c['allergens.4.nm']}</div>
          <div className="hs-cafc-a-sub" data-field="allergens.4.sub" style={WS}>{c['allergens.4.sub']}</div>
        </div>
        <div className="hs-cafc-a hs-cafc-a-bad">
          <div className="hs-cafc-a-mark" data-field="allergens.5.mark" style={WS}>{c['allergens.5.mark']}</div>
          <div className="hs-cafc-a-nm" data-field="allergens.5.nm" style={WS}>{c['allergens.5.nm']}</div>
          <div className="hs-cafc-a-sub" data-field="allergens.5.sub" style={WS}>{c['allergens.5.sub']}</div>
        </div>
        <div className="hs-cafc-ask">
          <div className="hs-cafc-ask-k" data-field="allergens.askK" style={WS}>{c['allergens.askK']}</div>
          <div className="hs-cafc-ask-v" data-field="allergens.askV" style={WS}>{c['allergens.askV']}</div>
          <div className="hs-cafc-ask-nm" data-field="allergens.askNm" style={WS}>{c['allergens.askNm']}</div>
        </div>
      </section>

      {/* TICKER */}
      <div className="hs-cafc-ticker">
        <div className="hs-cafc-ticker-tag" data-field="ticker.tag" style={WS}>{c['ticker.tag']}</div>
        <div className="hs-cafc-ticker-msg">
          <span data-field="ticker.message" style={WS}>{c['ticker.message']}</span>
          <span>&nbsp;<span className="hs-cafc-ticker-star">◆</span>&nbsp;</span>
          <span data-field="ticker.message2" style={WS}>{c['ticker.message2']}</span>
        </div>
      </div>
    </HsStage>
  );
}

/** Inlined CSS — pixel-perfect against scratch/design/hs-district/hs-district-pack/caf-counter.html. */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,400;9..144,700;9..144,900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');

.hs-cafc-bg {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(1400px 900px at 80% 10%, rgba(202,161,74,.08), transparent 60%),
    radial-gradient(1400px 900px at 10% 100%, rgba(42,79,58,.07), transparent 60%),
    repeating-linear-gradient(0deg, rgba(0,0,0,.018) 0 1px, transparent 1px 3px);
}
@keyframes hsCafcBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: .3; } }
@keyframes hsCafcSc { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes hsCafcPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(42,79,58,.5); } 50% { box-shadow: 0 0 0 22px rgba(42,79,58,0); } }

/* MASTHEAD */
.hs-cafc-mast {
  position: absolute; top: 60px; left: 80px; right: 80px; height: 240px;
  display: flex; align-items: flex-end; justify-content: space-between;
  border-bottom: 5px solid #1c1814; padding-bottom: 24px; z-index: 4;
}
.hs-cafc-mast-left { display: flex; align-items: flex-end; gap: 36px; }
.hs-cafc-seal {
  width: 160px; height: 160px; background: #2a4f3a; color: #f3ece0;
  display: grid; place-items: center; text-align: center; line-height: 1;
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 60px;
  letter-spacing: -.01em; font-style: italic; border: 4px solid #1a3326;
}
.hs-cafc-est {
  display: block; font-family: 'JetBrains Mono', monospace; font-style: normal;
  font-weight: 500; font-size: 24px; color: #caa14a; letter-spacing: .22em; margin-top: 8px;
}
.hs-cafc-title {
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 200px;
  line-height: .85; letter-spacing: -.025em; color: #1c1814; margin: 0;
}
.hs-cafc-amp { color: #b8331f; font-style: italic; font-weight: 400; }
.hs-cafc-sub {
  display: block; font-family: 'JetBrains Mono', monospace; font-weight: 500;
  font-size: 30px; color: #2a4f3a; letter-spacing: .32em; text-transform: uppercase; margin-top: 16px;
}
.hs-cafc-mast-right { display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }
.hs-cafc-day {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 700;
  font-size: 80px; color: #1c1814; line-height: .9; letter-spacing: -.01em;
}
.hs-cafc-date {
  font-family: 'JetBrains Mono', monospace; font-weight: 500;
  font-size: 30px; letter-spacing: .22em; color: #5b5347; text-transform: uppercase;
}
.hs-cafc-open {
  padding: 12px 22px; background: #2a4f3a; color: #fff;
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 24px; letter-spacing: .22em; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 14px; margin-top: 10px;
}
.hs-cafc-open::before {
  content: ''; width: 14px; height: 14px; border-radius: 50%;
  background: #caa14a; animation: hsCafcPulse 1.8s ease-in-out infinite;
}

/* CHIPS */
.hs-cafc-chips {
  position: absolute; top: 340px; left: 80px; right: 80px;
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 24px; z-index: 3;
}
.hs-cafc-chip { background: #fff; border: 3px solid #1c1814; padding: 22px 28px; }
.hs-cafc-chip-k {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .22em; color: #5b5347; text-transform: uppercase; line-height: 1;
}
.hs-cafc-chip-v {
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 80px; line-height: 1;
  color: #1c1814; letter-spacing: -.02em; margin-top: 6px;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.hs-cafc-chip-lit { background: #1c1814; border-color: #1c1814; }
.hs-cafc-chip-lit .hs-cafc-chip-k { color: #caa14a; }
.hs-cafc-chip-lit .hs-cafc-chip-v { color: #f3ece0; }
.hs-cafc-chip-green { background: #2a4f3a; border-color: #1a3326; }
.hs-cafc-chip-green .hs-cafc-chip-k { color: rgba(255,255,255,.7); }
.hs-cafc-chip-green .hs-cafc-chip-v { color: #fff; }
.hs-cafc-chip-tomato { background: #b8331f; border-color: #7a1f12; }
.hs-cafc-chip-tomato .hs-cafc-chip-k { color: rgba(255,255,255,.75); }
.hs-cafc-chip-tomato .hs-cafc-chip-v { color: #fff; }
.hs-cafc-chip-dot::after {
  content: ''; display: inline-block; width: 14px; height: 14px;
  background: #caa14a; border-radius: 50%; margin-left: 12px;
  vertical-align: middle; animation: hsCafcBlink 1.4s steps(2) infinite;
}

/* HERO */
.hs-cafc-hero {
  position: absolute; top: 540px; left: 80px; width: 2280px; height: 1300px;
  background: #fff; border: 3px solid #1c1814; display: flex; flex-direction: column; z-index: 3;
}
.hs-cafc-photo {
  flex: 1; background: radial-gradient(circle at 50% 55%, #c97a3a 0%, #8a4a1e 35%, #3d1f0e 80%);
  position: relative; overflow: hidden; border-bottom: 3px solid #1c1814;
  display: grid; place-items: center;
}
.hs-cafc-photo::before {
  content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(45deg, transparent 0 80px, rgba(255,255,255,.04) 80px 82px);
}
.hs-cafc-photo::after {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(ellipse 1500px 900px at 50% 0%, rgba(255,236,196,.16), transparent 60%);
}
.hs-cafc-ic {
  font-size: 600px; line-height: 1;
  filter: drop-shadow(0 32px 60px rgba(0,0,0,.6)); z-index: 1;
}
.hs-cafc-pricetag {
  position: absolute; top: 48px; right: 48px; width: 280px; height: 280px;
  border-radius: 50%; background: #caa14a; color: #1c1814;
  display: grid; place-items: center; text-align: center; line-height: 1;
  transform: rotate(-8deg); box-shadow: 0 24px 50px rgba(0,0,0,.4);
  border: 6px solid #f3ece0; z-index: 2;
}
.hs-cafc-pt-k {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .22em; text-transform: uppercase; color: #2a4f3a;
}
.hs-cafc-pt-v {
  font-family: 'Fraunces', serif; font-weight: 900; font-style: italic;
  font-size: 140px; line-height: .95; letter-spacing: -.04em; color: #1c1814; margin: 6px 0;
}
.hs-cafc-pt-sub {
  font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 26px;
  letter-spacing: .18em; color: #5b5347; text-transform: uppercase;
}
.hs-cafc-corner {
  position: absolute; top: 48px; left: 48px; background: rgba(0,0,0,.55);
  color: #fff; backdrop-filter: blur(4px); padding: 16px 28px;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px;
  letter-spacing: .22em; text-transform: uppercase;
  display: flex; align-items: center; gap: 14px; z-index: 2;
}
.hs-cafc-corner::before {
  content: ''; width: 18px; height: 18px; background: #caa14a; border-radius: 50%;
  animation: hsCafcBlink 1.4s steps(2) infinite;
}
.hs-cafc-body { padding: 48px 64px 56px; display: flex; flex-direction: column; gap: 14px; }
.hs-cafc-eyebrow {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 30px;
  letter-spacing: .34em; text-transform: uppercase; color: #b8331f;
  display: flex; align-items: center; gap: 18px;
}
.hs-cafc-eyebrow::before { content: ''; height: 4px; width: 64px; background: #b8331f; }
.hs-cafc-h1 {
  margin: 0; font-family: 'Fraunces', serif; font-weight: 900; font-style: italic;
  font-size: 200px; line-height: .85; letter-spacing: -.03em; color: #1c1814;
}
.hs-cafc-acc { color: #b8331f; font-style: italic; }
.hs-cafc-desc {
  margin: 8px 0 0; font-family: 'Fraunces', serif; font-weight: 400;
  font-size: 42px; line-height: 1.3; color: #5b5347; max-width: 2000px; font-style: italic;
}
.hs-cafc-meta {
  margin-top: 14px; border-top: 3px solid #1c1814; padding-top: 24px;
  display: flex; justify-content: space-between; gap: 32px;
}
.hs-cafc-it { display: flex; flex-direction: column; gap: 4px; }
.hs-cafc-it-k {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .22em; text-transform: uppercase; color: #5b5347;
}
.hs-cafc-it-v {
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 48px; line-height: 1;
  color: #1c1814; letter-spacing: -.01em; font-variant-numeric: tabular-nums;
}
.hs-cafc-v-green { color: #2a4f3a; }
.hs-cafc-v-tomato { color: #b8331f; }

/* RIGHT COLUMN */
.hs-cafc-col {
  position: absolute; top: 540px; right: 80px; width: 1340px; height: 1300px;
  display: flex; flex-direction: column; gap: 24px; z-index: 3;
}
.hs-cafc-lines { background: #2a4f3a; color: #fff; border: 3px solid #1a3326; padding: 28px 32px; }
.hs-cafc-lines-h3 {
  margin: 0 0 14px; font-family: 'Fraunces', serif; font-weight: 900; font-style: italic;
  font-size: 54px; line-height: 1; letter-spacing: -.02em; color: #fff;
  display: flex; justify-content: space-between; align-items: baseline;
}
.hs-cafc-lines-meta {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .22em; color: #caa14a; text-transform: uppercase; font-style: normal;
}
.hs-cafc-lines ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.hs-cafc-lines li {
  display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 18px;
  padding: 14px 0; border-bottom: 1px dashed rgba(255,255,255,.18);
}
.hs-cafc-lines li:last-child { border-bottom: 0; }
.hs-cafc-line-dot { width: 18px; height: 18px; border-radius: 50%; background: #caa14a; }
.hs-cafc-busy .hs-cafc-line-dot { background: #ff7a4a; }
.hs-cafc-closed .hs-cafc-line-dot { background: rgba(255,255,255,.3); }
.hs-cafc-line-nm {
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 42px; line-height: 1.05;
  color: #fff; letter-spacing: -.01em; font-style: italic;
}
.hs-cafc-line-sub {
  display: block; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 28px;
  color: rgba(255,255,255,.7); letter-spacing: 0; font-style: normal; margin-top: 2px;
}
.hs-cafc-line-st {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .22em; text-transform: uppercase; color: #caa14a;
  text-align: right; white-space: nowrap;
}
.hs-cafc-busy .hs-cafc-line-st { color: #ffb18a; }
.hs-cafc-closed .hs-cafc-line-st { color: rgba(255,255,255,.5); }
.hs-cafc-closed .hs-cafc-line-nm { color: rgba(255,255,255,.6); }

.hs-cafc-sides {
  flex: 1; background: #fff; border: 3px solid #1c1814; padding: 28px 32px;
  display: flex; flex-direction: column;
}
.hs-cafc-sides-h3 {
  margin: 0 0 14px; font-family: 'Fraunces', serif; font-weight: 900; font-style: italic;
  font-size: 54px; line-height: 1; letter-spacing: -.02em; color: #1c1814;
  border-bottom: 3px solid #1c1814; padding-bottom: 14px;
  display: flex; justify-content: space-between; align-items: baseline;
}
.hs-cafc-sides-meta {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .22em; color: #5b5347; text-transform: uppercase; font-style: normal;
}
.hs-cafc-sides ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; flex: 1; }
.hs-cafc-sides li {
  display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 24px;
  padding: 13px 0; border-bottom: 1px dashed #cdbfa3;
}
.hs-cafc-sides li:last-child { border-bottom: 0; }
.hs-cafc-side-nm {
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 38px; line-height: 1.05;
  color: #1c1814; letter-spacing: -.01em;
}
.hs-cafc-side-sub {
  display: block; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 28px;
  color: #5b5347; letter-spacing: 0; margin-top: 2px;
}
.hs-cafc-side-pr {
  font-family: 'Fraunces', serif; font-weight: 900; font-size: 48px; line-height: 1;
  color: #b8331f; letter-spacing: -.02em; font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* ALLERGEN STRIP */
.hs-cafc-allergens {
  position: absolute; left: 80px; right: 80px; bottom: 160px; height: 200px;
  display: grid; grid-template-columns: auto repeat(6, 1fr) auto; gap: 16px; z-index: 3;
}
.hs-cafc-allergens-lbl {
  background: #1c1814; color: #f3ece0; padding: 0 28px;
  display: flex; flex-direction: column; justify-content: center;
  border: 3px solid #1c1814; min-width: 280px;
}
.hs-cafc-allergens-k {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px;
  letter-spacing: .22em; color: #caa14a; text-transform: uppercase;
}
.hs-cafc-allergens-v {
  font-family: 'Fraunces', serif; font-weight: 900; font-style: italic; font-size: 54px;
  color: #fff; line-height: .95; letter-spacing: -.02em; margin-top: 6px;
}
.hs-cafc-a {
  background: #fff; border: 3px solid #1c1814; padding: 14px 18px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; text-align: center;
}
.hs-cafc-a-bad { background: #e9dfca; }
.hs-cafc-a-mark {
  font-family: 'Fraunces', serif; font-weight: 900; font-style: italic;
  font-size: 60px; line-height: 1; color: #2a4f3a;
}
.hs-cafc-a-bad .hs-cafc-a-mark { color: #b8331f; }
.hs-cafc-a-nm {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 24px;
  letter-spacing: .18em; color: #1c1814; text-transform: uppercase; line-height: 1;
}
.hs-cafc-a-sub {
  font-family: 'Inter', sans-serif; font-weight: 500; font-size: 26px;
  color: #5b5347; line-height: 1.1;
}
.hs-cafc-ask {
  background: #2a4f3a; color: #fff; border: 3px solid #1a3326; padding: 14px 24px;
  display: flex; flex-direction: column; justify-content: center; min-width: 300px;
}
.hs-cafc-ask-k {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 28px;
  letter-spacing: .22em; color: #caa14a; text-transform: uppercase; line-height: 1;
}
.hs-cafc-ask-v {
  font-family: 'Fraunces', serif; font-weight: 900; font-style: italic; font-size: 34px;
  line-height: 1.05; color: #fff; margin-top: 6px; letter-spacing: -.01em;
}
.hs-cafc-ask-nm {
  font-family: 'Inter', sans-serif; font-weight: 600; font-size: 22px;
  color: rgba(255,255,255,.85); margin-top: 6px;
}

/* TICKER */
.hs-cafc-ticker {
  position: absolute; left: 0; right: 0; bottom: 0; height: 96px;
  background: #2a4f3a; color: #f3ece0;
  display: flex; align-items: center; overflow: hidden; z-index: 5;
  border-top: 6px solid #caa14a;
}
.hs-cafc-ticker-tag {
  flex: 0 0 auto; background: #caa14a; color: #2a4f3a;
  font-family: 'Fraunces', serif; font-weight: 900; font-style: italic;
  font-size: 40px; padding: 0 36px; height: 100%;
  display: flex; align-items: center; letter-spacing: -.02em; gap: 16px;
}
.hs-cafc-ticker-msg {
  font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 30px;
  padding-left: 36px; white-space: nowrap; letter-spacing: .18em;
  text-transform: uppercase; color: #fff; animation: hsCafcSc 90s linear infinite;
}
.hs-cafc-ticker-star { color: #caa14a; margin: 0 22px; }
`;
