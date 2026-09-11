/**
 * §19 WIDGET TRUTH — "empty means empty", proven by MOUNTING the real widgets.
 *
 * The operator added his first widget (FITNESS_AD_BANNER) to a gym tenant and
 * the canvas showed "YOUR GYM · New Member Special · 50% off first month ·
 * PRESENTED BY Your Gym" — a finished-looking ad he could not edit a word of,
 * because none of it was his. It was `DEMO_CREATIVES`, rendered BECAUSE he had
 * no creatives. The Properties panel said "No creatives yet"; the canvas said
 * otherwise. His words: "added the first widget and i cant edit anything on it,
 * wtf are we doing here bro".
 *
 * These tests go through `WidgetPreview` — the real render path, the same one
 * BuilderZone and the player's rendererBundle use — because a test that imports
 * the widget function directly proves nothing about what reaches an operator.
 *
 * THE RULE, both halves asserted for every widget below:
 *
 *   BUILDER (`renderSurface` unset — canvas, gallery thumb, preview modal):
 *     an unconfigured widget names the NEXT ACTION in the operator's words and
 *     shows NO fabricated content.
 *
 *   PLAYER  (`renderSurface="player"` — a real screen on a wall, set only by
 *     app/player/rendererBundle.tsx):
 *     an unconfigured widget shows NO fabricated content AND NO authoring
 *     prompt. A lobby screen telling a gym member to "Add your first creative"
 *     is as bad as one advertising a sale that does not exist. It still
 *     occupies its zone, so only that zone goes quiet.
 *
 * And in both surfaces, a CONFIGURED widget renders the operator's own words —
 * the regression that would make "empty means empty" mean "nothing ever works".
 */

import { render, screen } from '@testing-library/react';
import { WidgetPreview, warmVariantRegistry } from '../WidgetRenderer';
import { warmAllWidgetFamilies } from '../widget-families';

// jsdom has no ResizeObserver; WidgetEmptyState measures its own box to scale
// type from the zone (never from the viewport). Same polyfill the sibling
// render-surface suites install.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

// Widget families load from their own chunks (P1-1, 2026-09-03), so a proxy
// renders `null` until its chunk resolves. These tests render and assert in the
// same tick, so the families must be warm first — otherwise every "the canvas
// does NOT show the fabricated copy" assertion would pass against an EMPTY
// container. That is a false green, not a pass, and it is exactly the trap this
// suite exists to close.
beforeAll(async () => {
  await warmAllWidgetFamilies();
  await warmVariantRegistry();
});

function mount(
  widgetType: string,
  config: Record<string, unknown> = {},
  opts: { renderSurface?: 'player' } = {},
) {
  return render(
    <div style={{ position: 'relative', width: 800, height: 400 }}>
      <WidgetPreview
        widgetType={widgetType}
        config={config}
        width={100}
        height={100}
        renderSurface={opts.renderSurface}
      />
    </div>,
  );
}

/** Every string the old hardcoded demo data put on an operator's canvas. */
const FABRICATIONS: Record<string, string[]> = {
  FITNESS_AD_BANNER: [
    'Your Gym',
    'New Member Special',
    'Local Smoothie Co.',
    'Yoga Studio Downtown',
    'YOUR BRAND HERE',
    'Upload a creative to feature your promotion',
  ],
  FITNESS_CLASS_SCHEDULE: ['Morning Flow Yoga', 'Spin Circuit', 'Sara K.', 'Marcus T.', 'Cycle Room'],
  FITNESS_TRAINING_VIDEO: ['LEG PRESS', 'Coach Rivera', 'Keep your back flat against the pad throughout the movement'],
  RESTAURANT_MENU_BOARD: ['Classic Cheeseburger', '$8.99', 'Bacon Smash', 'made fresh daily'],
  BAR_TAP_LIST: ['Pliny the Elder', 'Russian River', 'Heady Topper'],
  RETAIL_PRODUCT_GRID: ['Linen Trench Coat', '$248', 'Silk Knot Scarf'],
  RETAIL_PRICE_CALLOUT: ['Cashmere Crewneck', '$49', '$79', 'Pure Mongolian cashmere', 'FEATURED · END-CAP DEAL'],
  RETAIL_STOREFRONT_HOURS: ['EST. 1998 · MAIN STREET', 'Step inside · A new season is here.', '10am – 8pm', '11am – 6pm'],
};

function expectNoFabrication(widgetType: string) {
  for (const phrase of FABRICATIONS[widgetType] || []) {
    expect(screen.queryByText((_, el) => !!el?.textContent?.includes(phrase))).toBeNull();
  }
}

describe('§19 — an unconfigured widget never fabricates content', () => {
  const CASES: Array<[string, string]> = [
    ['FITNESS_AD_BANNER', 'Add your first creative'],
    ['FITNESS_CLASS_SCHEDULE', 'Add your first class'],
    ['FITNESS_TRAINING_VIDEO', 'Add a training video'],
    ['RESTAURANT_MENU_BOARD', 'Add your first menu item'],
    ['BAR_TAP_LIST', 'Add your first tap'],
    ['RETAIL_PRODUCT_GRID', 'Add your first product'],
    ['RETAIL_PRICE_CALLOUT', 'Add the product and its price'],
    ['RETAIL_STOREFRONT_HOURS', 'Add your opening hours'],
  ];

  describe.each(CASES)('%s', (widgetType, nextAction) => {
    it('BUILDER: names the next action and fabricates nothing', () => {
      mount(widgetType, {});
      // The operator is told what to do, in his words.
      expect(screen.getByText(nextAction)).toBeInTheDocument();
      expect(document.querySelector('[data-widget-empty="builder"]')).not.toBeNull();
      expectNoFabrication(widgetType);
    });

    it('PLAYER: shows neither fabricated content nor an authoring prompt', () => {
      mount(widgetType, {}, { renderSurface: 'player' });
      // No authoring prompt in front of the public...
      expect(screen.queryByText(nextAction)).toBeNull();
      expect(screen.queryByText(/Properties →/)).toBeNull();
      // ...and no invented content either.
      expectNoFabrication(widgetType);
      // The zone is still held — a hole in the board is its own failure.
      const quiet = document.querySelector('[data-widget-empty="player"]') as HTMLElement | null;
      expect(quiet).not.toBeNull();
      expect(quiet!.style.width).toBe('100%');
      expect(quiet!.style.height).toBe('100%');
    });
  });
});

describe('§19 — a CONFIGURED widget renders the operator\'s own words', () => {
  it('FITNESS_AD_BANNER shows the creative the gym typed, on both surfaces', () => {
    const config = {
      creatives: [{ id: 'c1', advertiser: 'Iron Works Gym', headline: 'Bring a friend free in July' }],
    };
    const builder = mount('FITNESS_AD_BANNER', config);
    expect(screen.getByText('Bring a friend free in July')).toBeInTheDocument();
    expect(screen.queryByText('Add your first creative')).toBeNull();
    builder.unmount();

    mount('FITNESS_AD_BANNER', config, { renderSurface: 'player' });
    expect(screen.getByText('Bring a friend free in July')).toBeInTheDocument();
  });

  it('RESTAURANT_MENU_BOARD shows the kitchen\'s own dish and price', () => {
    mount('RESTAURANT_MENU_BOARD', {
      items: [{ name: 'Green Chile Burger', price: '$12.00', desc: 'hatch chile, jack' }],
    });
    expect(screen.getByText('Green Chile Burger')).toBeInTheDocument();
    expect(screen.getByText('$12.00')).toBeInTheDocument();
    expectNoFabrication('RESTAURANT_MENU_BOARD');
  });

  it('FITNESS_AD_BANNER ignores rows the operator added but never filled in', () => {
    // An all-blank row used to reach the "synth creative" card, which printed
    // 'YOUR BRAND HERE' and 'Upload a creative to feature your promotion' —
    // an authoring prompt, on a live gym wall.
    mount('FITNESS_AD_BANNER', { creatives: [{ id: 'blank', imageUrl: '', headline: '', advertiser: '' }] });
    expect(screen.getByText('Add your first creative')).toBeInTheDocument();
    expectNoFabrication('FITNESS_AD_BANNER');
  });
});

describe('§19 — a claim a widget cannot back is not made at all', () => {
  it('RETAIL_STOREFRONT_HOURS does not say OPEN NOW off invented hours', () => {
    // The old widget merged DEMO_HOURS UNDER the operator's own, so any day he
    // had not filled in carried invented trading hours — and those hours drove
    // this live OPEN NOW / CLOSED pill. A shopper could be told the door is
    // open on a day the shop is shut.
    mount('RETAIL_STOREFRONT_HOURS', { headline: 'Welcome.' });
    expect(screen.queryByText('OPEN NOW')).toBeNull();
    expect(screen.queryByText('CLOSED')).toBeNull();
    expect(screen.queryByText('OPEN TODAY')).toBeNull();
  });

  it('RETAIL_STOREFRONT_HOURS marks an unstated day as unstated, not Closed', () => {
    mount('RETAIL_STOREFRONT_HOURS', { openHours: { mon: '9am – 5pm' } });
    expect(screen.getByText('9am – 5pm')).toBeInTheDocument();
    // Six unstated days. "Closed" would be a fabricated claim about the door.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(6);
  });
});
