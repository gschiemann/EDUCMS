/**
 * Retail vertical — template presets.
 *
 * Kept in its own file (mirrors fitness-presets.ts) so the EDU
 * vertical and the per-vertical packs stay independently editable.
 * At seed time each row is tagged with vertical='RETAIL' via
 * ensure-system-presets.ts so a school never sees retail templates
 * and a retail tenant never sees K-12 ones.
 *
 * Visual DNA — editorial / boutique / department-store window:
 *   - Warm parchment + ink palette (faf6f1 / 1a1411) with muted
 *     crimson accent (9a2d2d) and gold for premium accents.
 *   - Playfair Display for headlines, Inter for body — never the
 *     bubbly Fredoka/Outfit fonts the EDU pack uses.
 *   - Generous whitespace, restrained color, big imagery. Reads as
 *     Nordstrom / Saks / Madewell, not Best Buy.
 *
 * Widgets used:
 *   • RETAIL_STOREFRONT_HOURS  — store-hours card with open pill
 *   • RETAIL_PRICE_CALLOUT     — single-product big-price hero
 *   • RETAIL_SALE_COUNTDOWN    — "Sale ends in 2d 14h"
 *   • RETAIL_PRODUCT_GRID      — N-column lookbook grid
 *   • RETAIL_WAYFINDING_MAP    — store map with department callouts
 *   • RETAIL_LOYALTY_QR        — "Earn rewards" + scan-to-join QR
 *   • RETAIL_LOOKBOOK_CAROUSEL — auto-rotating fashion-style hero
 *   • IMAGE / TICKER           — shared with EDU (vertical-agnostic)
 *
 * 8 presets:
 *   1. Storefront Welcome Board (LOBBY)
 *   2. Sale / BOGO Promo (PROMO)
 *   3. New Arrivals Lookbook (LOOKBOOK)
 *   4. Aisle Wayfinding (LOBBY)
 *   5. Loyalty Member Spotlight (PROMO)
 *   6. Window Display Looping Promo (PROMO, portrait 2160×3840)
 *   7. End-Cap Featured Product (PRICING)
 *   8. Holiday / Seasonal Promo (HOLIDAYS)
 */

import type { SystemPreset } from './system-presets';

export const RETAIL_TEMPLATE_PRESETS: SystemPreset[] = [
  // ════════════════════════════════════════════════════════════════
  // Preset 1 — Storefront Welcome Board (LOBBY)
  // The first screen the shopper sees stepping into the store: store
  // hours card + a rotating lookbook carousel hero. The hours card
  // pins to the left rail; the carousel takes the majority of the
  // canvas with editorial captions.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'retail-storefront-welcome',
    name: 'Storefront Welcome Board',
    description:
      'The first screen shoppers see when they walk in: a rotating editorial lookbook hero takes the majority of the canvas, a store-hours card with live open/closed indicator pins the left rail, and a tracked-uppercase ticker runs along the very bottom. Works in landscape on any 16:9 entrance display.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#faf6f1',
    bgGradient:
      'radial-gradient(1200px 700px at 80% 20%, rgba(154,45,45,0.06), transparent 60%),' +
      'linear-gradient(180deg, #faf6f1 0%, #f3ece1 100%)',
    zones: [
      // ── Lookbook hero — anchors the right ¾ of the canvas ──
      {
        name: 'Welcome Lookbook',
        widgetType: 'RETAIL_LOOKBOOK_CAROUSEL',
        x: 28, y: 4, width: 70, height: 84,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          rotationMs: 7000,
          fadeMs: 900,
          accentColor: '#e8c87a',
          slides: [
            {
              eyebrow: 'SS26 · NEW IN',
              headline: 'A New Season Begins',
              subhead: 'Lighter layers, refined silhouettes.',
              price: 'From $89',
              swatchColor: '#dccfb8',
              emoji: '👗',
            },
            {
              eyebrow: 'EVERYDAY ESSENTIALS',
              headline: 'Made to Outlast',
              subhead: 'Quietly luxurious leather, hand-finished.',
              price: '$320',
              swatchColor: '#8b6f4e',
              emoji: '👜',
            },
            {
              eyebrow: 'LIMITED RUN',
              headline: 'The Cashmere Edit',
              subhead: 'Pure Mongolian fiber · 60 pieces only.',
              price: '$248',
              swatchColor: '#bfa68a',
              emoji: '🧣',
            },
          ],
        },
      },
      // ── Store hours card — left rail ──
      {
        name: 'Store Hours',
        widgetType: 'RETAIL_STOREFRONT_HOURS',
        x: 2, y: 4, width: 24, height: 84,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          eyebrow: 'EST. 1998 · MAIN STREET',
          headline: 'Welcome.',
          subhead: 'A new season is here.',
          accentColor: '#9a2d2d',
        },
      },
      // ── Editorial ticker along the bottom ──
      {
        name: 'Storefront Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 8,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          messages: [
            'COMPLIMENTARY GIFT WRAP · ASK AN ASSOCIATE',
            'FREE SHIPPING ON ORDERS OVER $100',
            'NEW ARRIVALS LANDING WEEKLY · BACK ROOM',
            'MEMBERS EARN 5% BACK ON EVERY PURCHASE',
          ],
          speed: 'slow',
          theme: 'default',
          textColor: '#1a1411',
          bgColor: '#faf6f1',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 2 — Sale / BOGO Promo (PROMO)
  // Big sale price hero with countdown to sale-end timer below.
  // Used for storefront windows + interior end-caps during sales.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'retail-sale-bogo-promo',
    name: 'Sale / BOGO Promo',
    description:
      'Conversion-focused sale display: a full-bleed price callout with a strike-through original price and percentage-off starburst, plus a live countdown to when the sale ends. Designed for storefront windows and end-caps during seasonal promotions.',
    category: 'PROMO',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#1a1411',
    bgGradient:
      'radial-gradient(1400px 800px at 30% 50%, rgba(154,45,45,0.18), transparent 60%),' +
      'linear-gradient(135deg, #1a1411 0%, #2a1f1c 100%)',
    zones: [
      // ── Price callout hero — top 60% of canvas ──
      {
        name: 'Sale Price Hero',
        widgetType: 'RETAIL_PRICE_CALLOUT',
        x: 0, y: 0, width: 100, height: 60,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          eyebrow: 'BUY ONE GET ONE FREE',
          headline: 'Spring Sweater Sale',
          subhead: 'Mix and match — every color, every fit.',
          salePrice: '$39',
          originalPrice: '$79',
          sellingPoints: [
            'Buy one, get one free — same or lesser value',
            'Online and in-store · today only',
            'Members earn 2x rewards on every pair',
          ],
          emoji: '🧥',
          swatchColor: '#dccfb8',
          bgColor: '#faf6f1',
          inkColor: '#1a1411',
          accentColor: '#9a2d2d',
        },
      },
      // ── Sale countdown — bottom 40% ──
      {
        name: 'Sale Countdown',
        widgetType: 'RETAIL_SALE_COUNTDOWN',
        x: 0, y: 60, width: 100, height: 40,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          eyebrow: 'SALE ENDS IN',
          headline: 'BOGO Ends Sunday at Midnight',
          fineprint: 'Online and in-store · while supplies last',
          finishedMessage: 'Sale extended · ask an associate',
          bgColor: '#1a1411',
          inkColor: '#faf6f1',
          accentColor: '#e8c87a',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 3 — New Arrivals Lookbook (LOOKBOOK)
  // 3-up product grid with prices + a "shop now" QR rail on the right.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'retail-new-arrivals-lookbook',
    name: 'New Arrivals Lookbook',
    description:
      'Editorial 3-up product grid with names, prices, and badges, plus a "scan to shop online" QR rail on the right so shoppers can save items to their phone before the in-store fitting room. Designed for the new-arrivals wall or feature-table sign.',
    category: 'LOOKBOOK',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#faf6f1',
    bgGradient: 'linear-gradient(180deg, #faf6f1 0%, #f3ece1 100%)',
    zones: [
      // ── Product grid — left 70% ──
      {
        name: 'New Arrivals Grid',
        widgetType: 'RETAIL_PRODUCT_GRID',
        x: 2, y: 4, width: 66, height: 92,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          heading: 'New This Week',
          subheading: 'JUST LANDED · ON THE FLOOR NOW',
          columns: 3,
          accentColor: '#9a2d2d',
          inkColor: '#1a1411',
          bgColor: '#faf6f1',
          products: [
            { name: 'Linen Trench Coat',   price: '$248', salePrice: '$179', swatchColor: '#e6dccd', emoji: '🧥', badge: 'SALE',     category: 'Outerwear' },
            { name: 'Silk Knot Scarf',     price: '$89',                     swatchColor: '#c9b6a0', emoji: '🧣', badge: 'NEW',      category: 'Accessories' },
            { name: 'Leather Crossbody',   price: '$320',                    swatchColor: '#8b6f4e', emoji: '👜', badge: 'FEATURED', category: 'Bags' },
            { name: 'Cashmere Crewneck',   price: '$248',                    swatchColor: '#bfa68a', emoji: '👕', badge: 'NEW',      category: 'Knitwear' },
            { name: 'Suede Loafers',       price: '$195',                    swatchColor: '#9a7a52', emoji: '👞', badge: 'LIMITED',  category: 'Footwear' },
            { name: 'Wide-Brim Sun Hat',   price: '$85',                     swatchColor: '#cfb990', emoji: '👒', badge: 'NEW',      category: 'Accessories' },
          ],
        },
      },
      // ── Loyalty QR rail — right 30% ──
      {
        name: 'Shop Now QR',
        widgetType: 'RETAIL_LOYALTY_QR',
        x: 70, y: 4, width: 28, height: 92,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          eyebrow: 'SHOP THE LOOKBOOK',
          headline: 'Save it to your phone.',
          subhead: 'Scan once · Reserve in store · Skip the line',
          ctaText: 'Scan to shop',
          qrFootnote: 'or visit yourstore.com/new',
          perks: [
            'Reserve a fitting room',
            'Save favorites to your wishlist',
            'Members earn 5% back',
          ],
          bgColor: '#1a1411',
          inkColor: '#faf6f1',
          accentColor: '#e8c87a',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 4 — Aisle Wayfinding (LOBBY)
  // Store directory with department callouts. Lives in the lobby or
  // by the elevator on multi-floor stores.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'retail-aisle-wayfinding',
    name: 'Aisle Wayfinding',
    description:
      'A clean store directory with department blocks, "you are here" pin, and an editorial header. Helps shoppers orient themselves the moment they walk in — useful for multi-floor or wide-format stores.',
    category: 'LOBBY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#faf6f1',
    bgGradient: 'linear-gradient(180deg, #faf6f1 0%, #efe8dc 100%)',
    zones: [
      // ── Wayfinding map — main canvas ──
      {
        name: 'Store Map',
        widgetType: 'RETAIL_WAYFINDING_MAP',
        x: 2, y: 4, width: 96, height: 84,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          heading: 'Store Directory',
          subheading: 'FIND YOUR DEPARTMENT',
          accentColor: '#9a2d2d',
          inkColor: '#1a1411',
          bgColor: '#faf6f1',
          departments: [
            { name: 'Womens',      x: 6,  y: 10, width: 40, height: 32, color: '#e8dcc8', emoji: '👗' },
            { name: 'Mens',        x: 54, y: 10, width: 40, height: 32, color: '#cfd8dc', emoji: '👔' },
            { name: 'Footwear',    x: 6,  y: 50, width: 28, height: 30, color: '#d7c4a3', emoji: '👟' },
            { name: 'Accessories', x: 38, y: 50, width: 24, height: 30, color: '#c9b6a0', emoji: '👜', highlight: true },
            { name: 'Beauty',      x: 66, y: 50, width: 28, height: 30, color: '#f0d6d6', emoji: '💄' },
          ],
          youAreHere: { x: 50, y: 92 },
        },
      },
      // ── Bottom info ticker ──
      {
        name: 'Wayfinding Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 8,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          messages: [
            'CUSTOMER SERVICE · LEFT OF MAIN ENTRANCE',
            'GIFT WRAP · ACCESSORIES DESK',
            'PERSONAL SHOPPING · 2ND FLOOR · BY APPOINTMENT',
            'RESTROOMS · DOWN THE BACK CORRIDOR',
          ],
          speed: 'slow',
          theme: 'default',
          textColor: '#1a1411',
          bgColor: '#faf6f1',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 5 — Loyalty Member Spotlight (PROMO)
  // Big QR + 3 perk pitch for the loyalty signup. Lives near the
  // checkout and the cosmetics counter.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'retail-loyalty-spotlight',
    name: 'Loyalty Member Spotlight',
    description:
      'Editorial pitch for the store loyalty program with 3 ranked perks and a big "scan to join" QR code. Designed for the checkout-line endcap or the cosmetics counter where the conversion rate on members-club signups is highest.',
    category: 'PROMO',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#faf6f1',
    bgGradient:
      'radial-gradient(1400px 800px at 75% 30%, rgba(232,200,122,0.12), transparent 60%),' +
      'linear-gradient(180deg, #faf6f1 0%, #f3ece1 100%)',
    zones: [
      // ── Loyalty QR widget — full canvas (it has its own internal layout) ──
      {
        name: 'Loyalty Pitch',
        widgetType: 'RETAIL_LOYALTY_QR',
        x: 2, y: 4, width: 96, height: 84,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          eyebrow: 'MEMBERS CLUB · FREE TO JOIN',
          headline: 'Earn rewards every visit.',
          subhead: 'Free to join · Members-only events · Birthday gift',
          ctaText: 'Scan to join',
          qrFootnote: 'or sign up at the register',
          perks: [
            '5% back on every purchase',
            'Early access to new arrivals',
            'Birthday gift each year + double points',
          ],
          bgColor: '#faf6f1',
          inkColor: '#1a1411',
          accentColor: '#9a2d2d',
        },
      },
      // ── Editorial ticker bottom ──
      {
        name: 'Loyalty Ticker',
        widgetType: 'TICKER',
        x: 0, y: 90, width: 100, height: 8,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          messages: [
            'NO PURCHASE NECESSARY · ASK AN ASSOCIATE',
            '500,000 MEMBERS AND COUNTING',
            'EXCLUSIVE MEMBER PRICING ON THE FIRST FRIDAY OF EVERY MONTH',
            'YOUR FIRST PURCHASE AS A MEMBER EARNS 2X REWARDS',
          ],
          speed: 'slow',
          theme: 'default',
          textColor: '#1a1411',
          bgColor: '#faf6f1',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 6 — Window Display Looping Promo (PROMO, portrait)
  // Vertical 2160×3840 lookbook for storefront window displays.
  // Full-bleed editorial imagery with bottom caption.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'retail-window-display-portrait',
    name: 'Window Display Looping Promo',
    description:
      'Vertical 2160×3840 storefront window display: a continuously crossfading editorial lookbook with full-bleed imagery, bottom-anchored caption, and a footer URL. Designed for the storefront-window vertical TV that passers-by glance at from the sidewalk.',
    category: 'PROMO',
    orientation: 'PORTRAIT',
    screenWidth: 2160,
    screenHeight: 3840,
    bgColor: '#1a1411',
    zones: [
      // ── Full-bleed lookbook carousel ──
      {
        name: 'Window Lookbook',
        widgetType: 'RETAIL_LOOKBOOK_CAROUSEL',
        x: 0, y: 0, width: 100, height: 96,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          rotationMs: 8000,
          fadeMs: 1100,
          accentColor: '#e8c87a',
          inkColor: '#ffffff',
          slides: [
            {
              eyebrow: 'SS26 COLLECTION',
              headline: 'Step Inside.',
              subhead: 'A new season begins today.',
              price: 'From $89',
              swatchColor: '#dccfb8',
              emoji: '👗',
            },
            {
              eyebrow: 'EVERYDAY LUXURY',
              headline: 'Built to Outlast',
              subhead: 'Hand-finished leather, made to age beautifully.',
              price: '$320',
              swatchColor: '#8b6f4e',
              emoji: '👜',
            },
            {
              eyebrow: 'LIMITED RUN · 60 PIECES',
              headline: 'The Cashmere Edit',
              subhead: 'Pure Mongolian fiber, knit by hand.',
              price: '$248',
              swatchColor: '#bfa68a',
              emoji: '🧣',
            },
            {
              eyebrow: 'THE NEW NEUTRAL',
              headline: 'Linen Reimagined',
              subhead: 'Cool, soft, effortlessly tailored.',
              price: '$179',
              swatchColor: '#e6dccd',
              emoji: '🧥',
            },
          ],
        },
      },
      // ── Footer URL strip at the bottom ──
      {
        name: 'Storefront URL',
        widgetType: 'TICKER',
        x: 0, y: 96, width: 100, height: 4,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          messages: [
            'YOURSTORE.COM · @YOURSTORE',
            'NOW OPEN · MAIN STREET',
            'SCAN ANY TAG TO SAVE IT TO YOUR PHONE',
          ],
          speed: 'slow',
          theme: 'default',
          textColor: '#e8c87a',
          bgColor: '#0f0a08',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 7 — End-Cap Featured Product (PRICING)
  // Single-product hero with big price callout + 3 selling points
  // and a smaller "shop the look" QR. Lives at the end of an aisle.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'retail-endcap-featured',
    name: 'End-Cap Featured Product',
    description:
      'Department-store end-cap display: one product, one big price, one decision. The price callout takes the majority of the canvas with a percentage-off starburst, three editorial selling points sit alongside, and a small loyalty QR rail invites the shopper to save it to their phone.',
    category: 'PRICING',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#faf6f1',
    bgGradient: 'linear-gradient(180deg, #faf6f1 0%, #efe8dc 100%)',
    zones: [
      // ── Price callout — left 72% of canvas ──
      {
        name: 'Featured Product',
        widgetType: 'RETAIL_PRICE_CALLOUT',
        x: 0, y: 0, width: 72, height: 100,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          eyebrow: 'END-CAP FEATURED · LIMITED STOCK',
          headline: 'Cashmere Crewneck',
          subhead: 'A wardrobe staple, retailored for SS26.',
          salePrice: '$49',
          originalPrice: '$79',
          sellingPoints: [
            'Hand-finished in Italy',
            'Pure Mongolian cashmere',
            'Limited stock — 60 pieces',
          ],
          emoji: '🧥',
          swatchColor: '#dccfb8',
          bgColor: '#faf6f1',
          inkColor: '#1a1411',
          accentColor: '#9a2d2d',
        },
      },
      // ── Loyalty QR rail — right 28% ──
      {
        name: 'Save to Phone',
        widgetType: 'RETAIL_LOYALTY_QR',
        x: 72, y: 0, width: 28, height: 100,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          eyebrow: 'SAVE IT',
          headline: 'Phone-friendly.',
          subhead: 'Scan to add to your wishlist.',
          ctaText: 'Scan',
          qrFootnote: 'or visit yourstore.com',
          perks: [
            'Reserve in store',
            'Members earn 5% back',
            'Track restocks instantly',
          ],
          bgColor: '#1a1411',
          inkColor: '#faf6f1',
          accentColor: '#e8c87a',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 8 — Holiday / Seasonal Promo (HOLIDAYS)
  // Themed seasonal hero — Black Friday / Mother's Day / Back-to-School
  // style. Big price callout + countdown to event.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'retail-holiday-seasonal',
    name: 'Holiday / Seasonal Promo',
    description:
      'Themed seasonal sale display — works for Black Friday, Mother\'s Day, Back-to-School, or any tentpole event. Big price callout dominates the upper canvas, a live countdown to the seasonal deadline pins the bottom, and the editorial palette can be retuned per holiday by swapping accentColor.',
    category: 'HOLIDAYS',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#0f0a08',
    bgGradient:
      'radial-gradient(1600px 900px at 25% 30%, rgba(232,200,122,0.20), transparent 60%),' +
      'radial-gradient(1200px 700px at 80% 80%, rgba(154,45,45,0.18), transparent 60%),' +
      'linear-gradient(135deg, #0f0a08 0%, #1f1411 100%)',
    zones: [
      // ── Seasonal price callout hero ──
      {
        name: 'Holiday Hero',
        widgetType: 'RETAIL_PRICE_CALLOUT',
        x: 0, y: 0, width: 100, height: 62,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          eyebrow: 'BLACK FRIDAY · DOORS OPEN AT 8AM',
          headline: 'Doorbusters · Up to 60% Off',
          subhead: 'Storewide savings · in store and online.',
          salePrice: '$29',
          originalPrice: '$89',
          sellingPoints: [
            'Doorbusters limited to first 100 customers',
            'Members earn 3x rewards all weekend',
            'Free gift with $150 purchase',
          ],
          emoji: '🛍️',
          swatchColor: '#3a2a20',
          bgColor: '#0f0a08',
          inkColor: '#faf6f1',
          accentColor: '#e8c87a',
        },
      },
      // ── Sale countdown — middle band ──
      {
        name: 'Doors Open Countdown',
        widgetType: 'RETAIL_SALE_COUNTDOWN',
        x: 0, y: 62, width: 100, height: 30,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          eyebrow: 'DOORS OPEN IN',
          headline: 'Be First In · Get the Doorbusters',
          fineprint: 'Line up at the Main Street entrance · 50 free totes for early arrivals',
          finishedMessage: 'WE\'RE OPEN — STEP INSIDE',
          bgColor: '#0f0a08',
          inkColor: '#faf6f1',
          accentColor: '#e8c87a',
        },
      },
      // ── Bottom info strip ──
      {
        name: 'Holiday Ticker',
        widgetType: 'TICKER',
        x: 0, y: 92, width: 100, height: 8,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          messages: [
            'BLACK FRIDAY · ENDS SUNDAY MIDNIGHT',
            'COMPLIMENTARY GIFT WRAP ALL WEEKEND',
            'EXTRA 10% OFF FOR MEMBERS · STACK WITH ANY DEAL',
            'SHOP ONLINE AT YOURSTORE.COM',
          ],
          speed: 'normal',
          theme: 'default',
          textColor: '#e8c87a',
          bgColor: '#0f0a08',
        },
      },
    ],
  },
];
