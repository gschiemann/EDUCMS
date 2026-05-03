/**
 * Restaurant / QSR vertical — template presets.
 *
 * Same isolation pattern as fitness-presets.ts: kept in its own file so
 * the K-12 catalog stays uncontaminated and we can vertical-gate via
 * Tenant.vertical = 'QSR' at the templates list endpoint without
 * touching the K-12 preset list.
 *
 * Visual DNA (deliberately different from EDU's playful/Fredoka and
 * fitness's neon-on-charcoal):
 *   - Warm cream / charcoal / deep-red palette
 *   - Caramel + mustard accents (#e8b94a)
 *   - Bebas Neue display + Playfair italic + Inter body
 *   - Bold, appetizing, high-contrast for legibility from across a
 *     counter or drive-thru lane
 *
 * Widgets used (from /apps/web/src/components/widgets/restaurant/):
 *   • RESTAURANT_MENU_BOARD       — multi-column menu with chips
 *   • RESTAURANT_COMBO_CAROUSEL   — auto-rotating combo deals
 *   • RESTAURANT_WAIT_TIME        — counter-service wait readout
 *   • RESTAURANT_LOYALTY_TICKER   — rewards messaging strip
 *   • RESTAURANT_SPECIALS_CALLOUT — "today only" big-type promo
 *   • RESTAURANT_ALLERGY_LEGEND   — dietary chip legend strip
 *   • CLOCK / TICKER / WEATHER / IMAGE / RICH_TEXT (vertical-agnostic)
 *
 * All templates run at 3840×2160 (4K UHD landscape) unless otherwise
 * noted, matching the fitness pack and the K-12 v2 pack.
 */

import type { SystemPreset } from './system-presets';

export const RESTAURANT_TEMPLATE_PRESETS: SystemPreset[] = [
  // ════════════════════════════════════════════════════════════════
  // Preset 1 — Drive-Thru Menu Board
  // Three-column primary menu with combo highlights along the top.
  // Wide canvas + huge type so guests in their car can read every
  // line from 8-12 ft. Loyalty ticker pinned to the bottom for
  // ongoing program awareness.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'qsr-drive-thru-menu',
    name: 'Drive-Thru Menu Board',
    description:
      'Three-column primary menu with combo highlights along the top. Designed for drive-thru lanes — wide canvas, huge type, deep-red palette so guests can read every line through a windshield. Loyalty ticker pinned to the bottom for ongoing program awareness.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#1a1714',
    bgGradient:
      'radial-gradient(1200px 700px at 20% 10%, rgba(232,185,74,0.08), transparent 60%),' +
      'radial-gradient(1100px 700px at 80% 90%, rgba(122,31,31,0.10), transparent 60%),' +
      'linear-gradient(140deg, #1a1714 0%, #261c16 50%, #1a1714 100%)',
    zones: [
      // ── Combo carousel — top hero strip, full width × 26% tall ──
      {
        name: 'Featured Combos',
        widgetType: 'RESTAURANT_COMBO_CAROUSEL',
        x: 2, y: 3, width: 96, height: 26,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          title: 'COMBO DEALS',
          rotationMs: 8000,
          accentColor: '#e8b94a',
          combos: [
            {
              name: 'Big Burger Combo',
              includes: ['1/3 lb angus cheeseburger', 'Sea-salt fries', '22oz fountain drink'],
              price: '$9.99',
              emoji: '🍔',
              tileBg: '#7a1f1f',
              badge: 'BEST VALUE',
            },
            {
              name: 'Spicy Chicken Combo',
              includes: ['Buttermilk fried chicken', 'Onion rings', 'Strawberry lemonade'],
              price: '$10.49',
              emoji: '🍗',
              tileBg: '#b8650a',
              badge: 'CHEF PICK',
            },
            {
              name: 'Bacon Smash Combo',
              includes: ['Double smash burger', 'Loaded fries', 'Chocolate shake'],
              price: '$12.99',
              emoji: '🥓',
              tileBg: '#5a1212',
              badge: 'NEW',
            },
          ],
        },
      },
      // ── Three-column main menu — left/center/right ──
      {
        name: 'Burgers & Sandwiches',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 2, y: 32, width: 31, height: 56,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          title: 'BURGERS',
          subtitle: 'hand-smashed daily',
          columns: 1,
          theme: 'cream',
          accentColor: '#e8b94a',
          items: [
            { name: 'Classic Cheese',  desc: '1/3 lb angus, american, pickles',           price: '$8.99',  emoji: '🍔' },
            { name: 'Bacon Smash',     desc: 'double smash, applewood bacon',             price: '$10.49', emoji: '🥓' },
            { name: 'Crispy Chicken',  desc: 'buttermilk-brined, slaw, brioche',          price: '$9.49',  emoji: '🍗' },
            { name: 'Veggie Black Bean', desc: 'house patty, avocado, chipotle aioli',    price: '$8.99',  dietary: ['V'], emoji: '🥑' },
            { name: 'Mushroom Swiss',  desc: 'sautéed cremini, swiss, truffle aioli',     price: '$10.99', emoji: '🍄' },
          ],
        },
      },
      {
        name: 'Sides',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 34.5, y: 32, width: 31, height: 56,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          title: 'SIDES',
          subtitle: 'hand-cut · twice fried',
          columns: 1,
          theme: 'cream',
          accentColor: '#e8b94a',
          items: [
            { name: 'Sea-Salt Fries',  desc: 'hand-cut, fried twice',                     price: '$3.49',  dietary: ['V', 'GF'], emoji: '🍟' },
            { name: 'Onion Rings',     desc: 'beer-battered, house ranch',                price: '$4.49',  dietary: ['V'], emoji: '🧅' },
            { name: 'Loaded Fries',    desc: 'cheddar, bacon, scallion',                  price: '$5.99',  emoji: '🧀' },
            { name: 'House Salad',     desc: 'greens, tomato, cucumber, lemon vin.',      price: '$4.99',  dietary: ['V', 'GF'], emoji: '🥗' },
            { name: 'Mac & Cheese',    desc: 'three-cheese blend, herb crust',            price: '$5.49',  emoji: '🧀' },
          ],
        },
      },
      {
        name: 'Drinks & Shakes',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 67, y: 32, width: 31, height: 56,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          title: 'DRINKS',
          subtitle: 'refresh & restore',
          columns: 1,
          theme: 'cream',
          accentColor: '#e8b94a',
          items: [
            { name: 'Fountain Soda',       desc: 'free refills · 22oz cup',                price: '$2.79', dietary: ['V', 'GF'], emoji: '🥤' },
            { name: 'Strawberry Lemonade', desc: 'fresh-squeezed, muddled berries',        price: '$3.49', dietary: ['V', 'GF'], emoji: '🍋' },
            { name: 'Chocolate Shake',    desc: 'hand-spun, real ice cream',               price: '$4.99', emoji: '🥛' },
            { name: 'Vanilla Shake',      desc: 'madagascar bean · whipped cream',         price: '$4.99', emoji: '🍦' },
            { name: 'Iced Tea',            desc: 'unsweet · sweet · half-and-half',        price: '$2.49', dietary: ['V', 'GF'], emoji: '🍵' },
          ],
        },
      },
      // ── Loyalty ticker — bottom strip ──
      {
        name: 'Rewards Ticker',
        widgetType: 'RESTAURANT_LOYALTY_TICKER',
        x: 2, y: 90, width: 96, height: 8,
        zIndex: 2,
        sortOrder: 5,
        defaultConfig: {
          programName: 'REWARDS',
          theme: 'charcoal',
          accentColor: '#e8b94a',
          rotationMs: 6000,
          messages: [
            'Earn 1 point per $1 spent · 50 points = a free shake',
            'Birthday treat? Of course — every year, on us',
            'Members save 10% every Tuesday',
            'Join free at the counter or scan to enroll',
          ],
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 2 — Counter-Order Menu
  // Vertical menu sections arranged across two rows: Burgers/Chicken
  // up top, Sides/Drinks/Combos along the bottom. Compact column
  // layout — works well for a counter-order screen where guests
  // browse before stepping up to order.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'qsr-counter-order',
    name: 'Counter-Order Menu',
    description:
      'Vertical sections with photographic-style item cards arranged across the canvas — burgers/sides/drinks/combos in named columns. Designed for the menu wall above a counter so guests can browse comfortably before stepping up to order. Allergy legend strip across the bottom.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#fbf6ee',
    bgGradient:
      'radial-gradient(1100px 700px at 15% 0%, rgba(232,185,74,0.18), transparent 65%),' +
      'radial-gradient(900px 600px at 90% 100%, rgba(122,31,31,0.10), transparent 65%),' +
      'linear-gradient(160deg, #fbf6ee 0%, #f3e8d0 50%, #fbf6ee 100%)',
    zones: [
      // ── Header / brand strip ──
      {
        name: 'Brand Strip',
        widgetType: 'RICH_TEXT',
        x: 2, y: 2, width: 70, height: 8,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          html: '<h1 style="font-family:Bebas Neue,sans-serif;font-size:96px;letter-spacing:0.06em;margin:0;color:#7a1f1f;">SMASH & GRILL</h1><p style="font-family:Playfair Display,serif;font-style:italic;font-size:28px;color:#1a1714;opacity:0.7;margin:4px 0 0;">order at the counter · pickup at the window</p>',
        },
      },
      // ── Clock — top right ──
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 78, y: 2, width: 20, height: 8,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          theme: 'default',
          format: '12h',
          showSeconds: false,
          showDate: true,
        },
      },
      // ── Top row: 4 menu sections ──
      {
        name: 'Burgers',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 2, y: 12, width: 23.5, height: 50,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          title: 'BURGERS',
          subtitle: 'hand-smashed',
          columns: 1,
          theme: 'cream',
          accentColor: '#7a1f1f',
          items: [
            { name: 'Classic',         price: '$8.99',  desc: '1/3 lb angus, american', emoji: '🍔' },
            { name: 'Bacon Smash',     price: '$10.49', desc: 'double, bacon', emoji: '🥓' },
            { name: 'Mushroom Swiss',  price: '$10.99', desc: 'cremini, swiss, truffle', emoji: '🍄' },
            { name: 'Veggie',          price: '$8.99',  desc: 'black bean, avocado', dietary: ['V'], emoji: '🥑' },
          ],
        },
      },
      {
        name: 'Chicken',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 26, y: 12, width: 23.5, height: 50,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          title: 'CHICKEN',
          subtitle: 'buttermilk brined',
          columns: 1,
          theme: 'cream',
          accentColor: '#b8650a',
          items: [
            { name: 'Crispy Sandwich', price: '$9.49', desc: 'slaw, brioche', emoji: '🍗' },
            { name: 'Spicy Sandwich',  price: '$9.99', desc: 'pepper aioli', dietary: ['🌶'], emoji: '🌶️' },
            { name: 'Tenders (4)',     price: '$8.99', desc: 'choice of dip', emoji: '🍗' },
            { name: 'Wings (8)',       price: '$11.99',desc: 'buffalo · BBQ', emoji: '🍖' },
          ],
        },
      },
      {
        name: 'Sides',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 50.5, y: 12, width: 23.5, height: 50,
        zIndex: 2,
        sortOrder: 5,
        defaultConfig: {
          title: 'SIDES',
          subtitle: 'twice-fried · hand-cut',
          columns: 1,
          theme: 'cream',
          accentColor: '#3a8c4a',
          items: [
            { name: 'Sea-Salt Fries', price: '$3.49', dietary: ['V', 'GF'], emoji: '🍟' },
            { name: 'Onion Rings',    price: '$4.49', dietary: ['V'], emoji: '🧅' },
            { name: 'Loaded Fries',   price: '$5.99', desc: 'bacon, cheddar', emoji: '🧀' },
            { name: 'House Salad',    price: '$4.99', dietary: ['V', 'GF'], emoji: '🥗' },
          ],
        },
      },
      {
        name: 'Drinks',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 75, y: 12, width: 23, height: 50,
        zIndex: 2,
        sortOrder: 6,
        defaultConfig: {
          title: 'DRINKS',
          subtitle: 'shakes · sodas · tea',
          columns: 1,
          theme: 'cream',
          accentColor: '#0e6e8a',
          items: [
            { name: 'Fountain Soda',     price: '$2.79', dietary: ['V', 'GF'], emoji: '🥤' },
            { name: 'Iced Tea',          price: '$2.49', dietary: ['V', 'GF'], emoji: '🍵' },
            { name: 'Berry Lemonade',    price: '$3.49', dietary: ['V', 'GF'], emoji: '🍋' },
            { name: 'Hand-Spun Shake',   price: '$4.99', desc: 'choc · vanilla · strawberry', emoji: '🥛' },
          ],
        },
      },
      // ── Bottom row: combo carousel + specials ──
      {
        name: 'Combos',
        widgetType: 'RESTAURANT_COMBO_CAROUSEL',
        x: 2, y: 64, width: 60, height: 26,
        zIndex: 2,
        sortOrder: 7,
        defaultConfig: {
          title: 'BUILD A COMBO',
          rotationMs: 8000,
          accentColor: '#7a1f1f',
        },
      },
      {
        name: 'Today\'s Special',
        widgetType: 'RESTAURANT_SPECIALS_CALLOUT',
        x: 63, y: 64, width: 35, height: 26,
        zIndex: 2,
        sortOrder: 8,
        defaultConfig: {
          headline: 'LUNCH DEAL',
          subhead: 'weekdays 11am – 2pm',
          itemName: 'Smash + Fries + Drink',
          itemDesc: '',
          price: '$8.99',
          originalPrice: '$11.99',
          emoji: '🍔',
          theme: 'red',
        },
      },
      // ── Allergy legend bottom strip ──
      {
        name: 'Dietary Legend',
        widgetType: 'RESTAURANT_ALLERGY_LEGEND',
        x: 2, y: 92, width: 96, height: 6,
        zIndex: 2,
        sortOrder: 9,
        defaultConfig: {
          title: 'DIETARY GUIDE',
          layout: 'horizontal',
          theme: 'cream',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 3 — Coffee Shop Menu Board
  // Minimalist coffee + bakery menu with a daily-specials chip and
  // a chef-note panel for personality. Cream + warm-brown palette
  // appropriate for an espresso bar.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'qsr-coffee-shop-menu',
    name: 'Coffee Shop Menu Board',
    description:
      'Minimalist coffee + bakery menu with a daily-specials chip, chef-note panel, and a calm cream/brown palette appropriate for an espresso bar. Two columns of beverages, a small bakery section, and a today-only callout for the seasonal latte.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#fbf6ee',
    bgGradient:
      'radial-gradient(1000px 700px at 50% 0%, rgba(180,108,52,0.12), transparent 65%),' +
      'linear-gradient(160deg, #fbf6ee 0%, #f3e8d0 100%)',
    zones: [
      // ── Header / brand mark ──
      {
        name: 'Brand Mark',
        widgetType: 'RICH_TEXT',
        x: 0, y: 3, width: 100, height: 9,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          html: '<div style="text-align:center;"><div style="font-family:Playfair Display,serif;font-style:italic;font-size:32px;color:#1a1714;opacity:0.6;letter-spacing:0.4em;text-transform:uppercase;">est. 2018</div><h1 style="font-family:Bebas Neue,sans-serif;font-size:120px;letter-spacing:0.08em;margin:0;color:#5a3a1a;">CEDAR &amp; GRAIN</h1></div>',
        },
      },
      // ── Espresso menu (left) ──
      {
        name: 'Espresso',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 4, y: 14, width: 30, height: 70,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          title: 'ESPRESSO',
          subtitle: 'house roast · single origin',
          columns: 1,
          theme: 'cream',
          accentColor: '#5a3a1a',
          items: [
            { name: 'Espresso',      desc: 'house blend, double shot',                price: '$3.25', emoji: '☕' },
            { name: 'Americano',     desc: 'espresso + hot water',                    price: '$3.50', emoji: '☕' },
            { name: 'Cappuccino',    desc: 'equal parts espresso, milk, foam',        price: '$4.50', emoji: '☕' },
            { name: 'Latte',         desc: 'espresso, steamed milk',                  price: '$4.75', emoji: '🥛' },
            { name: 'Mocha',         desc: 'house chocolate, whipped cream',          price: '$5.25', emoji: '🍫' },
            { name: 'Cortado',       desc: '4oz, gibraltar style',                    price: '$4.25', emoji: '☕' },
          ],
        },
      },
      // ── Brewed & specialty (middle) ──
      {
        name: 'Brewed & Specialty',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 36, y: 14, width: 30, height: 70,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          title: 'BREWED',
          subtitle: 'pour-over & specialty',
          columns: 1,
          theme: 'cream',
          accentColor: '#5a3a1a',
          items: [
            { name: 'Drip Coffee',     desc: 'rotating single origin',               price: '$2.95', dietary: ['V', 'GF'], emoji: '☕' },
            { name: 'Pour-Over',       desc: 'V60, 4-min brew',                      price: '$5.50', dietary: ['V', 'GF'], emoji: '☕' },
            { name: 'Cold Brew',       desc: '24-hr steep',                          price: '$4.95', dietary: ['V', 'GF'], emoji: '🧊' },
            { name: 'Nitro Cold Brew', desc: 'on tap, naturally sweet',              price: '$5.50', dietary: ['V', 'GF'], emoji: '🧊' },
            { name: 'Matcha Latte',    desc: 'ceremonial-grade matcha',              price: '$5.25', dietary: ['V'], emoji: '🍵' },
            { name: 'Chai Latte',      desc: 'house-spiced black tea',               price: '$4.95', emoji: '🌿' },
          ],
        },
      },
      // ── Bakery (right column, top) ──
      {
        name: 'Bakery',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 68, y: 14, width: 28, height: 38,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          title: 'BAKERY',
          subtitle: 'baked daily, pre-7am',
          columns: 1,
          theme: 'cream',
          accentColor: '#b86c34',
          items: [
            { name: 'Croissant',      desc: 'all-butter, 3-day laminated',           price: '$3.75', emoji: '🥐' },
            { name: 'Almond Bear Claw',desc: 'frangipane, sliced almond',            price: '$4.25', emoji: '🥐' },
            { name: 'Cinnamon Roll',  desc: 'cream cheese glaze',                    price: '$4.50', emoji: '🍩' },
            { name: 'Banana Bread',   desc: 'walnut, brown butter',                  price: '$3.95', emoji: '🍞' },
          ],
        },
      },
      // ── Daily specials callout (right column, bottom) ──
      {
        name: 'Daily Special',
        widgetType: 'RESTAURANT_SPECIALS_CALLOUT',
        x: 68, y: 54, width: 28, height: 30,
        zIndex: 2,
        sortOrder: 5,
        defaultConfig: {
          headline: 'TODAY ONLY',
          subhead: 'hand-shaken with cardamom',
          itemName: 'Saffron Honey Latte',
          itemDesc: '',
          price: '$5.95',
          emoji: '🌼',
          theme: 'mustard',
        },
      },
      // ── Loyalty ticker bottom ──
      {
        name: 'Rewards Strip',
        widgetType: 'RESTAURANT_LOYALTY_TICKER',
        x: 0, y: 88, width: 100, height: 10,
        zIndex: 2,
        sortOrder: 6,
        defaultConfig: {
          programName: 'CG REWARDS',
          theme: 'cream',
          accentColor: '#5a3a1a',
          rotationMs: 5500,
          messages: [
            'Earn a free drink every 10 visits',
            'Bring your own cup · 25¢ off',
            'Free birthday pastry — every year',
            'Open 6am – 7pm · seven days a week',
          ],
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 4 — Pizza Shop Menu
  // By-the-slice pricing on the left, whole-pies on the right, with
  // a toppings legend strip and a "today only" pizza-of-the-day
  // callout. Tomato red + parmesan cream + basil green palette.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'qsr-pizza-shop-menu',
    name: 'Pizza Shop Menu',
    description:
      'By-the-slice pricing on the left, whole-pies on the right, with a toppings legend strip and a "today only" pizza-of-the-day callout. Tomato red + parmesan cream + basil green palette — every shape feels Italian.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#fbf6ee',
    bgGradient:
      'radial-gradient(1100px 700px at 0% 0%, rgba(122,31,31,0.18), transparent 60%),' +
      'radial-gradient(1100px 700px at 100% 100%, rgba(58,140,74,0.10), transparent 60%),' +
      'linear-gradient(160deg, #fbf6ee 0%, #f3e8d0 50%, #fbf6ee 100%)',
    zones: [
      // ── Banner / brand strip ──
      {
        name: 'Brand Strip',
        widgetType: 'RICH_TEXT',
        x: 2, y: 3, width: 96, height: 9,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          html: '<div style="text-align:center;"><h1 style="font-family:Bebas Neue,sans-serif;font-size:140px;letter-spacing:0.08em;margin:0;color:#7a1f1f;">VITTORIO\'S</h1><p style="font-family:Playfair Display,serif;font-style:italic;font-size:32px;color:#1a1714;opacity:0.7;margin:6px 0 0;">slice · pie · panini · est. 1986</p></div>',
        },
      },
      // ── By the slice (left half) ──
      {
        name: 'By the Slice',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 3, y: 14, width: 46, height: 70,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          title: 'BY THE SLICE',
          subtitle: 'fresh from the oven · all day',
          columns: 1,
          theme: 'cream',
          accentColor: '#7a1f1f',
          items: [
            { name: 'Cheese',          desc: 'mozz, san marzano, basil',              price: '$3.50', dietary: ['VG'], emoji: '🍕' },
            { name: 'Pepperoni',       desc: 'cup-and-char pepperoni',                price: '$4.00', emoji: '🍕' },
            { name: 'Sausage & Peppers', desc: 'fennel sausage, sweet peppers',       price: '$4.50', emoji: '🌶️' },
            { name: 'Margherita',      desc: 'fior di latte, basil, EVOO',            price: '$4.50', dietary: ['VG'], emoji: '🌿' },
            { name: 'White Garlic',    desc: 'ricotta, mozz, garlic, herbs',          price: '$4.25', dietary: ['VG'], emoji: '🧄' },
            { name: 'Veggie Supreme',  desc: 'pepper, onion, mushroom, olive',        price: '$4.50', dietary: ['VG'], emoji: '🥬' },
            { name: 'Hot Honey',       desc: 'soppressata, honey, calabrian chili',   price: '$5.00', dietary: ['🌶'], emoji: '🍯' },
          ],
        },
      },
      // ── Whole pies (right top) ──
      {
        name: 'Whole Pies',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 51, y: 14, width: 46, height: 50,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          title: 'WHOLE PIES',
          subtitle: '14" × 18" · ready in 12-15 min',
          columns: 2,
          theme: 'cream',
          accentColor: '#3a8c4a',
          items: [
            { name: 'Cheese',          desc: '14"',          price: '$18',  dietary: ['VG'], emoji: '🍕' },
            { name: 'Cheese',          desc: '18"',          price: '$24',  dietary: ['VG'], emoji: '🍕' },
            { name: 'Pepperoni',       desc: '14"',          price: '$22',  emoji: '🍕' },
            { name: 'Pepperoni',       desc: '18"',          price: '$28',  emoji: '🍕' },
            { name: 'Margherita',      desc: '14" only',     price: '$24',  dietary: ['VG'], emoji: '🌿' },
            { name: 'Sicilian',        desc: 'thick crust',  price: '$26',  dietary: ['VG'], emoji: '🍕' },
            { name: 'Build Your Own',  desc: '+ toppings',   price: 'from $20', emoji: '➕' },
            { name: 'Gluten-Free',     desc: '12" only',     price: '$22',  dietary: ['GF'], emoji: '🌾' },
          ],
        },
      },
      // ── Pizza of the day (right bottom) ──
      {
        name: 'Pizza of the Day',
        widgetType: 'RESTAURANT_SPECIALS_CALLOUT',
        x: 51, y: 66, width: 46, height: 18,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          headline: 'PIE OF THE DAY',
          subhead: 'until we run out',
          itemName: 'Brooklyn Hot Honey',
          itemDesc: 'soppressata, calabrian, honey',
          price: '$5',
          emoji: '🍕',
          theme: 'red',
        },
      },
      // ── Allergy legend bottom strip ──
      {
        name: 'Dietary Legend',
        widgetType: 'RESTAURANT_ALLERGY_LEGEND',
        x: 2, y: 88, width: 96, height: 10,
        zIndex: 2,
        sortOrder: 5,
        defaultConfig: {
          title: 'DIETARY GUIDE',
          layout: 'horizontal',
          theme: 'cream',
          accentColor: '#7a1f1f',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 5 — Sushi / Ramen Menu
  // Section dividers in serif type, modifier callouts, dark canvas
  // with deep teal + gold foil accents. Designed for an upmarket
  // counter-service sushi/ramen spot.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'qsr-sushi-ramen-menu',
    name: 'Sushi & Ramen Menu',
    description:
      'Section dividers in serif type, modifier callouts, dark canvas with deep teal + gold foil accents. Designed for an upmarket counter-service sushi/ramen spot. Three menu sections (sushi rolls, ramen bowls, small plates) plus a chef\'s recommendation callout.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#0e1f1f',
    bgGradient:
      'radial-gradient(1100px 700px at 20% 10%, rgba(232,185,74,0.08), transparent 60%),' +
      'radial-gradient(900px 600px at 80% 90%, rgba(14,90,90,0.20), transparent 60%),' +
      'linear-gradient(140deg, #0e1f1f 0%, #163030 50%, #0e1f1f 100%)',
    zones: [
      // ── Brand mark ──
      {
        name: 'Brand Mark',
        widgetType: 'RICH_TEXT',
        x: 0, y: 3, width: 100, height: 11,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          html: '<div style="text-align:center;color:#fbf6ee;"><div style="font-family:Playfair Display,serif;font-style:italic;font-size:34px;letter-spacing:0.4em;text-transform:uppercase;color:#e8b94a;opacity:0.85;">蕎麦・刺身・温</div><h1 style="font-family:Playfair Display,serif;font-weight:900;font-size:130px;letter-spacing:0.04em;margin:8px 0 0;color:#fbf6ee;">KAIDŌ</h1><p style="font-family:Playfair Display,serif;font-style:italic;font-size:28px;color:rgba(251,246,238,0.6);margin:2px 0 0;">noodles · sushi · small plates</p></div>',
        },
      },
      // ── Sushi rolls (left) ──
      {
        name: 'Sushi Rolls',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 3, y: 16, width: 30, height: 65,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          title: 'SUSHI ROLLS',
          subtitle: 'cut to order',
          columns: 1,
          theme: 'charcoal',
          accentColor: '#e8b94a',
          items: [
            { name: 'Spicy Tuna',      desc: 'ahi, sriracha aioli, scallion',         price: '$12', dietary: ['🌶'], emoji: '🍣' },
            { name: 'Salmon Avocado',  desc: 'fresh salmon, avocado, sesame',         price: '$11', emoji: '🥑' },
            { name: 'Dragon',          desc: 'eel, cucumber, avocado, kabayaki',      price: '$15', emoji: '🐉' },
            { name: 'Rainbow',         desc: 'crab, avocado, salmon, tuna, hamachi',  price: '$16', emoji: '🌈' },
            { name: 'Veggie Garden',   desc: 'cuke, avocado, carrot, sprout',         price: '$9',  dietary: ['V', 'GF'], emoji: '🥒' },
            { name: 'Tempura Shrimp',  desc: 'shrimp tempura, eel sauce, sesame',     price: '$13', emoji: '🍤' },
          ],
        },
      },
      // ── Ramen (middle) ──
      {
        name: 'Ramen',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 35, y: 16, width: 30, height: 65,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          title: 'RAMEN',
          subtitle: 'broth · 18 hr · slow simmer',
          columns: 1,
          theme: 'charcoal',
          accentColor: '#e8b94a',
          items: [
            { name: 'Tonkotsu',        desc: 'pork bone broth, chashu, scallion',     price: '$16', emoji: '🍜' },
            { name: 'Miso',            desc: 'red miso, corn, butter, nori',          price: '$15', dietary: ['VG'], emoji: '🍜' },
            { name: 'Shoyu',           desc: 'soy chicken broth, bamboo, egg',        price: '$15', emoji: '🍜' },
            { name: 'Spicy Tantan',    desc: 'sichuan chili, ground pork, sesame',    price: '$17', dietary: ['🌶'], emoji: '🌶️' },
            { name: 'Veggie Shio',     desc: 'kombu broth, mushroom, tofu',           price: '$14', dietary: ['V'], emoji: '🌿' },
            { name: 'Cold Tsukemen',   desc: 'thick broth dip, chilled noodles',      price: '$17', emoji: '🥶' },
          ],
        },
      },
      // ── Small plates (right) ──
      {
        name: 'Small Plates',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 67, y: 16, width: 30, height: 65,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          title: 'SMALL PLATES',
          subtitle: 'shared · served as ready',
          columns: 1,
          theme: 'charcoal',
          accentColor: '#e8b94a',
          items: [
            { name: 'Edamame',         desc: 'sea salt, lemon zest',                   price: '$5',  dietary: ['V', 'GF'], emoji: '🌱' },
            { name: 'Gyoza (5)',       desc: 'pork-cabbage, ponzu',                    price: '$8',  emoji: '🥟' },
            { name: 'Veggie Gyoza',    desc: 'mushroom-cabbage, chili oil',            price: '$8',  dietary: ['V'], emoji: '🥟' },
            { name: 'Karaage',         desc: 'crispy chicken, kewpie aioli',           price: '$9',  emoji: '🍗' },
            { name: 'Tuna Tataki',     desc: 'seared ahi, ponzu, sesame',              price: '$14', emoji: '🍣' },
            { name: 'Mochi Ice (3)',   desc: 'matcha · sesame · strawberry',           price: '$7',  dietary: ['VG'], emoji: '🍡' },
          ],
        },
      },
      // ── Chef's recommendation strip ──
      {
        name: 'Chef\'s Recommendation',
        widgetType: 'RESTAURANT_SPECIALS_CALLOUT',
        x: 3, y: 83, width: 94, height: 14,
        zIndex: 2,
        sortOrder: 5,
        defaultConfig: {
          headline: 'OMAKASE',
          subhead: 'chef\'s tasting · 8 courses · ¥/$ market',
          itemName: 'Reserved Seating',
          itemDesc: 'reservations recommended · Thur–Sun',
          price: '$65 pp',
          emoji: '🍱',
          theme: 'charcoal',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 6 — Daily Specials Promo
  // Full-bleed promo screen anchored by the SpecialsCallout widget
  // with a rotating ComboCarousel underneath. Loyalty ticker at the
  // bottom keeps program awareness visible. Designed for an entry-
  // way / window-facing screen meant to draw foot traffic.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'qsr-daily-specials-promo',
    name: 'Daily Specials Promo',
    description:
      'Full-bleed window-facing promo screen — anchored by a "today only" headline with rotating combo carousel underneath and loyalty ticker at the bottom. Designed for the entryway or storefront window where foot traffic decides whether to come in.',
    category: 'PROMO',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#1a1714',
    bgGradient:
      'radial-gradient(1400px 800px at 50% 30%, rgba(232,185,74,0.18), transparent 65%),' +
      'linear-gradient(160deg, #1a1714 0%, #261c16 50%, #1a1714 100%)',
    zones: [
      // ── Hero specials callout (top half) ──
      {
        name: 'Hero Specials',
        widgetType: 'RESTAURANT_SPECIALS_CALLOUT',
        x: 0, y: 0, width: 100, height: 56,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          headline: 'TODAY ONLY',
          subhead: 'while supplies last · until 9pm',
          itemName: 'Smash Burger Combo',
          itemDesc: '1/3 lb smash, fries & 22oz drink',
          price: '$5.99',
          originalPrice: '$11.99',
          emoji: '🍔',
          theme: 'red',
        },
      },
      // ── Rotating combo carousel (bottom-left) ──
      {
        name: 'More Combos',
        widgetType: 'RESTAURANT_COMBO_CAROUSEL',
        x: 2, y: 58, width: 64, height: 32,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          title: 'MORE DEALS',
          rotationMs: 7000,
          accentColor: '#e8b94a',
        },
      },
      // ── Wait time small panel (bottom-right) ──
      {
        name: 'Wait Time',
        widgetType: 'RESTAURANT_WAIT_TIME',
        x: 68, y: 58, width: 30, height: 32,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          title: 'CURRENT WAIT',
          estimateMins: 8,
          partiesAhead: 2,
          smsNumber: '85503',
          smsKeyword: 'QUEUE',
          venueName: 'our lobby',
        },
      },
      // ── Loyalty ticker bottom ──
      {
        name: 'Rewards Strip',
        widgetType: 'RESTAURANT_LOYALTY_TICKER',
        x: 0, y: 92, width: 100, height: 8,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          programName: 'REWARDS',
          theme: 'charcoal',
          accentColor: '#e8b94a',
          rotationMs: 5500,
          messages: [
            'Earn 1 point per $1 — 50 points = a free shake',
            'Members save 10% every Tuesday',
            'Birthday treat? Of course — every year, on us',
          ],
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 7 — Loyalty Rewards Board
  // Anchor the message "this is how the rewards program works" so
  // a guest can read it once and get it. Big "1 pt per $1" hero,
  // member of the week, milestone tiers, and a QR sign-up panel.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'qsr-loyalty-rewards-board',
    name: 'Loyalty Rewards Board',
    description:
      'A standalone "join the rewards program" screen — big "1 pt per $1" hero, member of the week, milestone tiers, and a QR sign-up panel. Designed for a quiet wall in the lobby where someone can read and decide to join in 30 seconds.',
    category: 'LOYALTY',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#fbf6ee',
    bgGradient:
      'radial-gradient(1100px 700px at 50% 0%, rgba(232,185,74,0.22), transparent 65%),' +
      'linear-gradient(160deg, #fbf6ee 0%, #f3e8d0 50%, #fbf6ee 100%)',
    zones: [
      // ── Header ──
      {
        name: 'Brand Header',
        widgetType: 'RICH_TEXT',
        x: 0, y: 3, width: 100, height: 8,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          html: '<div style="text-align:center;"><div style="font-family:Playfair Display,serif;font-style:italic;font-size:30px;color:#7a1f1f;letter-spacing:0.4em;text-transform:uppercase;">free to join · always</div><h1 style="font-family:Bebas Neue,sans-serif;font-size:120px;letter-spacing:0.06em;margin:0;color:#1a1714;">REWARDS</h1></div>',
        },
      },
      // ── Big "1 pt per $1" hero ──
      {
        name: 'Hero Earn Rate',
        widgetType: 'RESTAURANT_SPECIALS_CALLOUT',
        x: 4, y: 13, width: 56, height: 38,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          headline: '1 PT PER $1',
          subhead: 'spend a dollar, earn a point — anywhere, any item',
          itemName: '50 pts = a free coffee',
          itemDesc: '100 pts = free pastry · 250 pts = free combo',
          price: 'JOIN FREE',
          emoji: '⭐',
          theme: 'mustard',
        },
      },
      // ── Member of the week (right side) ──
      {
        name: 'Member of the Week',
        widgetType: 'RICH_TEXT',
        x: 62, y: 13, width: 34, height: 38,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          html: '<div style="height:100%;display:flex;flex-direction:column;justify-content:center;background:linear-gradient(140deg,#7a1f1f 0%,#4d0e0e 100%);border-radius:24px;padding:40px;color:#fbf6ee;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.25);"><div style="font-family:Playfair Display,serif;font-style:italic;font-size:24px;letter-spacing:0.3em;text-transform:uppercase;color:#e8b94a;opacity:0.9;">member of the week</div><div style="font-size:96px;line-height:1;margin:18px 0;">⭐</div><div style="font-family:Bebas Neue,sans-serif;font-size:64px;letter-spacing:0.04em;margin:0;">RACHEL P.</div><p style="font-family:Inter,sans-serif;font-weight:400;font-size:18px;line-height:1.4;color:rgba(251,246,238,0.85);margin:12px 0 0;">Visited every Friday for a year — earned 4 free shakes and a birthday cookie. Thanks Rachel.</p></div>',
        },
      },
      // ── Loyalty messaging ticker (mid strip) ──
      {
        name: 'Why Join Strip',
        widgetType: 'RESTAURANT_LOYALTY_TICKER',
        x: 4, y: 53, width: 92, height: 10,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          programName: 'PERKS',
          theme: 'cream',
          accentColor: '#7a1f1f',
          rotationMs: 5000,
          messages: [
            'Free birthday treat — every single year',
            'Members save 10% every Tuesday — no coupon needed',
            'Order ahead from the app · skip the line',
            'Refer a friend · both get $5 off',
            'Track your points in the app — never miss a reward',
          ],
        },
      },
      // ── Tier ladder (bottom-left) ──
      {
        name: 'Reward Tiers',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 4, y: 65, width: 56, height: 30,
        zIndex: 2,
        sortOrder: 5,
        defaultConfig: {
          title: 'REWARD TIERS',
          subtitle: 'redeem any time · points never expire',
          columns: 2,
          theme: 'cream',
          accentColor: '#7a1f1f',
          items: [
            { name: '50 pts',  price: 'Free Drip Coffee',     emoji: '☕' },
            { name: '100 pts', price: 'Free Pastry',          emoji: '🥐' },
            { name: '150 pts', price: 'Free Side',            emoji: '🍟' },
            { name: '200 pts', price: 'Free Hand-Spun Shake', emoji: '🥛' },
            { name: '250 pts', price: 'Free Combo',           emoji: '🍔' },
            { name: '500 pts', price: 'Free Family Bundle',   emoji: '🎁' },
          ],
        },
      },
      // ── QR sign-up panel (bottom-right) ──
      {
        name: 'Scan to Join',
        widgetType: 'RICH_TEXT',
        x: 62, y: 65, width: 34, height: 30,
        zIndex: 2,
        sortOrder: 6,
        defaultConfig: {
          html: '<div style="height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background:#fbf6ee;border:3px dashed #7a1f1f;border-radius:24px;padding:24px;"><div style="font-family:Bebas Neue,sans-serif;font-size:54px;letter-spacing:0.06em;color:#7a1f1f;margin:0;">SCAN TO JOIN</div><div style="width:160px;height:160px;background:#1a1714;margin:18px auto;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fbf6ee;font-size:80px;">▣</div><p style="font-family:Inter,sans-serif;font-size:20px;color:#1a1714;opacity:0.7;margin:0;">or sign up at the counter — takes 30 seconds</p></div>',
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset 8 — Wait Time Display
  // Lobby-facing display for counter-service / fast-casual where
  // dine-in seating fills up. Big wait readout, parties ahead,
  // SMS sign-up hint, plus a small specials callout to keep guests
  // engaged while they wait.
  // ════════════════════════════════════════════════════════════════
  {
    id: 'qsr-wait-time-display',
    name: 'Wait Time Display',
    description:
      'Lobby-facing display for counter-service / fast-casual venues where dine-in seating fills up. Big wait readout, parties ahead, SMS sign-up hint, plus a small specials callout to keep guests engaged while they wait. Pinned-bottom loyalty ticker.',
    category: 'PROMO',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#1a1714',
    bgGradient:
      'radial-gradient(1300px 800px at 50% 25%, rgba(214,138,31,0.18), transparent 65%),' +
      'linear-gradient(160deg, #1a1714 0%, #261c16 50%, #1a1714 100%)',
    zones: [
      // ── Big wait time readout (left, hero) ──
      {
        name: 'Wait Time',
        widgetType: 'RESTAURANT_WAIT_TIME',
        x: 2, y: 4, width: 60, height: 84,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          title: 'CURRENT WAIT',
          estimateMins: 12,
          partiesAhead: 4,
          smsNumber: '85503',
          smsKeyword: 'TABLE',
          venueName: 'our lobby',
        },
      },
      // ── Specials callout (right top) ──
      {
        name: 'Order While You Wait',
        widgetType: 'RESTAURANT_SPECIALS_CALLOUT',
        x: 64, y: 4, width: 34, height: 42,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          headline: 'ORDER AHEAD',
          subhead: 'app · web · skip the line',
          itemName: 'Pickup Window',
          itemDesc: 'we\'ll text when it\'s ready',
          price: '0 wait',
          emoji: '📲',
          theme: 'mustard',
        },
      },
      // ── Combo carousel (right bottom) ──
      {
        name: 'Featured Combos',
        widgetType: 'RESTAURANT_COMBO_CAROUSEL',
        x: 64, y: 48, width: 34, height: 40,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          title: 'TONIGHT\'S DEALS',
          rotationMs: 8000,
          accentColor: '#e8b94a',
        },
      },
      // ── Loyalty ticker bottom ──
      {
        name: 'Rewards Ticker',
        widgetType: 'RESTAURANT_LOYALTY_TICKER',
        x: 0, y: 90, width: 100, height: 10,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          programName: 'REWARDS',
          theme: 'charcoal',
          accentColor: '#e8b94a',
          rotationMs: 6000,
          messages: [
            'Earn 1 point per $1 — every visit counts',
            'Members can text us to skip the wait queue',
            'Free birthday treat · every year, on us',
            'Order ahead in the app — pickup, no wait',
          ],
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // Preset — Live POS Menu (Universal)
  //
  // 2026-05-03 — operator request: "do we need a new menu template
  // for the POS integrations?" — yes, this one.
  //
  // Drop-in template that renders WHATEVER is in the operator's
  // connected POS catalog. No hardcoded items, no hardcoded
  // categories — RESTAURANT_MENU_BOARD with `posSync: true` pulls
  // every available PosMenuItem at render time. As the operator
  // updates Square / Toast / Clover, the menu board updates with no
  // CMS changes.
  //
  // Purposefully understated visual chrome (no busy combo carousel,
  // no specials callout) — the live catalog IS the content. Big
  // title strip + clock + dietary legend + the menu board at full
  // size so prices and items stay legible at counter distance.
  //
  // Vertical: tagged QSR but works for BAR / RETAIL too — the
  // PosCategoryPicker in the editor lets the admin scope to a
  // specific category like "Burgers" or "On Tap" or "New Arrivals".
  // ════════════════════════════════════════════════════════════════
  {
    id: 'qsr-live-pos-menu',
    name: 'Live POS Menu',
    description:
      "Drops in next to your existing menu board and renders whatever's in your connected POS catalog — Square, Toast, Clover, Shopify, Stripe. No hardcoded items: as you update prices in your POS, the screen updates automatically. Optional category filter so you can run a 'Burgers Only' or 'On Tap' board on a specific zone.",
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#1a1714',
    bgGradient:
      'radial-gradient(1400px 800px at 15% 10%, rgba(232,185,74,0.08), transparent 60%),' +
      'radial-gradient(1100px 700px at 85% 90%, rgba(122,31,31,0.08), transparent 60%),' +
      'linear-gradient(135deg, #1a1714 0%, #221814 50%, #1a1714 100%)',
    zones: [
      // ── Title strip ──
      {
        name: 'Header',
        widgetType: 'RICH_TEXT',
        x: 2, y: 2, width: 76, height: 11,
        zIndex: 2,
        sortOrder: 1,
        defaultConfig: {
          html:
            '<div style="font-family:Bebas Neue,sans-serif;font-size:200px;line-height:.85;letter-spacing:.04em;color:#fbf6ee;">OUR MENU</div>' +
            '<div style="font-family:\'Playfair Display\',serif;font-style:italic;font-size:48px;color:#e8b94a;margin-top:8px;">live from our kitchen</div>',
        },
      },
      // ── Clock — top right ──
      {
        name: 'Clock',
        widgetType: 'CLOCK',
        x: 80, y: 2, width: 18, height: 11,
        zIndex: 2,
        sortOrder: 2,
        defaultConfig: {
          format: '12h',
          showSeconds: false,
          color: '#fbf6ee',
          fontSize: 120,
          align: 'right',
          theme: 'minimal',
        },
      },
      // ── Live menu board — main canvas. posSync ON so it pulls
      //    PosMenuItem from the connected POS. ──
      {
        name: 'Live menu',
        widgetType: 'RESTAURANT_MENU_BOARD',
        x: 2, y: 14, width: 96, height: 78,
        zIndex: 2,
        sortOrder: 3,
        defaultConfig: {
          title: 'TODAY\'S MENU',
          subtitle: 'updated live from our kitchen',
          theme: 'cream',
          accentColor: '#e8b94a',
          columns: 3,
          posSync: true,
          // posCategory left empty so the board shows EVERY available
          // item across every category. Operator can scope per-zone
          // via PropertiesPanel → "Category (optional)".
          posCategory: undefined,
          maxItems: 18,
          // items[] still provided as a graceful fallback when the
          // operator hasn't connected a POS yet — they see realistic
          // demo data rather than a blank board.
          items: [
            { name: 'Connect a POS', desc: 'Settings → POS to wire up your Square / Toast / Clover catalog.', price: '—' },
            { name: 'Items will sync automatically', desc: 'Your live catalog will replace this list.', price: '—' },
          ],
        },
      },
      // ── Dietary legend strip — pinned bottom ──
      {
        name: 'Dietary legend',
        widgetType: 'RESTAURANT_ALLERGY_LEGEND',
        x: 0, y: 92, width: 100, height: 8,
        zIndex: 2,
        sortOrder: 4,
        defaultConfig: {
          theme: 'charcoal',
          accentColor: '#e8b94a',
          legend: [
            { code: 'V',  label: 'Vegetarian' },
            { code: 'VG', label: 'Vegan' },
            { code: 'GF', label: 'Gluten-free' },
            { code: 'DF', label: 'Dairy-free' },
            { code: 'NF', label: 'Nut-free' },
            { code: 'S',  label: 'Spicy' },
          ],
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // 2026-05-03 — operator: "build out like 10 to 15 of those and make
  // them new cutting edge with POS or manual updating with both of them".
  //
  // Approach: 10 distinct vertical-slice presets composing the existing
  // RESTAURANT_* widgets (MENU_BOARD / COMBO_CAROUSEL / SPECIALS_CALLOUT
  // / WAIT_TIME / LOYALTY_TICKER / ALLERGY_LEGEND) in fresh layouts and
  // palettes. Every menu-board zone is pre-set with `posSync: true` AND
  // a `items` fallback array — operator toggles `posSync` off in the
  // editor's properties panel to switch a preset from auto-sync to
  // hand-typed. Both modes work without further setup.
  //
  // 4K canvas (3840×2160) so they pair with the gym + retail packs.
  // Each preset documents its inspiration and use-case in the
  // description so the gallery picker tells operators what they're
  // looking at before they hit "Customize".
  // ════════════════════════════════════════════════════════════════

  // ── 1. Modern Burger Joint — bold red + cream + gold ──────────────
  {
    id: 'qsr-modern-burger',
    name: 'Modern Burger Joint',
    description:
      'Bold red + cream burger-counter board. Combo carousel hero across the top, three-column main menu with photos beneath, dietary legend strip, loyalty ticker pinned. Toggle POS sync in the menu board properties to live-pull from Square / Toast / Clover.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#1a0a0a',
    bgGradient: 'radial-gradient(1400px 800px at 18% 12%, rgba(232,185,74,0.10), transparent 60%),' +
                'radial-gradient(1100px 700px at 82% 88%, rgba(122,31,31,0.18), transparent 60%),' +
                'linear-gradient(135deg, #1a0a0a 0%, #2a0f0f 50%, #1a0a0a 100%)',
    zones: [
      { name: 'Combo carousel', widgetType: 'RESTAURANT_COMBO_CAROUSEL', x: 2, y: 3, width: 96, height: 26, zIndex: 2, sortOrder: 1, defaultConfig: { title: 'COMBOS · BUILT TO SHARE', accentColor: '#e8b94a', rotationMs: 7000 } },
      { name: 'Menu board', widgetType: 'RESTAURANT_MENU_BOARD', x: 2, y: 31, width: 96, height: 58, zIndex: 2, sortOrder: 2, defaultConfig: { title: 'BURGERS & SIDES', subtitle: 'smashed fresh, sourdough buns', theme: 'red', accentColor: '#e8b94a', columns: 3, posSync: true, maxItems: 9 } },
      { name: 'Loyalty ticker', widgetType: 'RESTAURANT_LOYALTY_TICKER', x: 0, y: 91, width: 100, height: 9, zIndex: 2, sortOrder: 3, defaultConfig: { programName: 'CLUB BURGER', theme: 'charcoal', accentColor: '#e8b94a', rotationMs: 6000 } },
    ],
  },

  // ── 2. Artisan Pizza Counter — wood-fired oven aesthetic ──────────
  {
    id: 'qsr-artisan-pizza',
    name: 'Artisan Pizza Counter',
    description:
      'Wood-fired pizza board — cream background, charcoal accents, photo of the oven on the left, two-column menu (signatures + by-the-slice) with prices in display weight. Specials callout for the daily pie. POS sync toggle on the menu board for live-from-kitchen pricing.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#fbf6ee',
    bgGradient: 'radial-gradient(1500px 900px at 20% 15%, rgba(122,31,31,0.06), transparent 60%),' +
                'linear-gradient(180deg, #fbf6ee 0%, #f4ecd8 100%)',
    zones: [
      { name: 'Specials callout', widgetType: 'RESTAURANT_SPECIALS_CALLOUT', x: 2, y: 3, width: 96, height: 22, zIndex: 2, sortOrder: 1, defaultConfig: { tag: 'TODAY ONLY', headline: 'Margherita Verde — $14', sub: 'house mozz, basil, lemon-zested olive oil. While it lasts.', accentColor: '#7a1f1f', theme: 'cream' } },
      { name: 'Menu board', widgetType: 'RESTAURANT_MENU_BOARD', x: 2, y: 27, width: 96, height: 65, zIndex: 2, sortOrder: 2, defaultConfig: { title: 'WOOD-FIRED PIZZA', subtitle: 'naples-style, 90 seconds, blistered crust', theme: 'cream', accentColor: '#7a1f1f', columns: 2, posSync: true, maxItems: 8 } },
      { name: 'Allergy legend', widgetType: 'RESTAURANT_ALLERGY_LEGEND', x: 0, y: 93, width: 100, height: 7, zIndex: 2, sortOrder: 3, defaultConfig: { theme: 'cream', accentColor: '#7a1f1f' } },
    ],
  },

  // ── 3. Specialty Coffee Bar — matte black + brass + light wood ────
  {
    id: 'qsr-specialty-coffee',
    name: 'Specialty Coffee Bar',
    description:
      'Third-wave coffee shop board — matte black + brass accents. Beverage menu in two columns (espresso bar / pour-over / specialty), pastry case strip below, brewing-method callout. POS-sync friendly so the price changes when the roaster does.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#0a0908',
    bgGradient: 'radial-gradient(1300px 800px at 25% 15%, rgba(232,185,74,0.06), transparent 60%),' +
                'linear-gradient(180deg, #0a0908 0%, #14110d 100%)',
    zones: [
      { name: 'Espresso & pour-over', widgetType: 'RESTAURANT_MENU_BOARD', x: 2, y: 4, width: 60, height: 70, zIndex: 2, sortOrder: 1, defaultConfig: { title: 'ESPRESSO BAR', subtitle: 'single origin · lever-pulled · matched to the bean', theme: 'charcoal', accentColor: '#e8b94a', columns: 2, posSync: true, maxItems: 12 } },
      { name: 'Pastry case', widgetType: 'RESTAURANT_MENU_BOARD', x: 64, y: 4, width: 34, height: 70, zIndex: 2, sortOrder: 2, defaultConfig: { title: 'PASTRY CASE', subtitle: 'baked daily · gone by 11', theme: 'charcoal', accentColor: '#e8b94a', columns: 1, posSync: true, posCategory: 'Pastry', maxItems: 8 } },
      { name: 'Method callout', widgetType: 'RESTAURANT_SPECIALS_CALLOUT', x: 2, y: 77, width: 96, height: 14, zIndex: 2, sortOrder: 3, defaultConfig: { tag: 'TODAY · BREWING METHOD', headline: 'V60 Pour-Over — Ethiopia Yirgacheffe', sub: 'bright, citrus, jasmine. ask the barista.', accentColor: '#e8b94a', theme: 'charcoal' } },
      { name: 'Allergy legend', widgetType: 'RESTAURANT_ALLERGY_LEGEND', x: 0, y: 93, width: 100, height: 7, zIndex: 2, sortOrder: 4, defaultConfig: { theme: 'charcoal', accentColor: '#e8b94a' } },
    ],
  },

  // ── 4. Ramen / Asian Fusion — deep red + ink + neon ───────────────
  {
    id: 'qsr-ramen-fusion',
    name: 'Ramen / Asian Fusion',
    description:
      'Asian-fusion noodle bar — ink-black with hot-red + neon-cyan accents. Three-column ramen menu with bowl-deep descriptions, sides + drinks rail on the right, broth-of-the-day callout. POS-sync the bowl prices for a 86\'d-item display that updates live.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#0a0a0e',
    bgGradient: 'radial-gradient(1400px 800px at 12% 12%, rgba(255,42,77,0.10), transparent 60%),' +
                'radial-gradient(1100px 700px at 88% 88%, rgba(0,212,255,0.10), transparent 60%),' +
                'linear-gradient(135deg, #0a0a0e 0%, #14141c 50%, #0a0a0e 100%)',
    zones: [
      { name: 'Broth of the day', widgetType: 'RESTAURANT_SPECIALS_CALLOUT', x: 2, y: 3, width: 96, height: 18, zIndex: 2, sortOrder: 1, defaultConfig: { tag: 'BROTH OF THE DAY', headline: 'Tonkotsu Black Garlic — $18', sub: '12-hour pork bone, charred garlic oil, ajitama egg. limited bowls.', accentColor: '#ff2a4d', theme: 'charcoal' } },
      { name: 'Ramen menu', widgetType: 'RESTAURANT_MENU_BOARD', x: 2, y: 23, width: 70, height: 70, zIndex: 2, sortOrder: 2, defaultConfig: { title: 'RAMEN BAR', subtitle: 'house-pulled noodles, zero shortcuts', theme: 'charcoal', accentColor: '#ff2a4d', columns: 2, posSync: true, posCategory: 'Ramen', maxItems: 10 } },
      { name: 'Sides & drinks', widgetType: 'RESTAURANT_MENU_BOARD', x: 74, y: 23, width: 24, height: 70, zIndex: 2, sortOrder: 3, defaultConfig: { title: 'BENTO + DRINKS', subtitle: 'add-ons', theme: 'charcoal', accentColor: '#00d4ff', columns: 1, posSync: true, posCategory: 'Sides', maxItems: 8 } },
      { name: 'Allergy legend', widgetType: 'RESTAURANT_ALLERGY_LEGEND', x: 0, y: 94, width: 100, height: 6, zIndex: 2, sortOrder: 4, defaultConfig: { theme: 'charcoal', accentColor: '#ff2a4d' } },
    ],
  },

  // ── 5. Mexican Cantina — talavera + sun-baked terracotta ──────────
  {
    id: 'qsr-mexican-cantina',
    name: 'Mexican Cantina',
    description:
      'Mexican cantina — terracotta + papel-picado palette. Three-column menu (tacos / mains / sides), tequila & margarita callout, salsa-bar rail. Festive without being cliché. POS sync pulls from Toast / Square / Clover so happy-hour drink prices auto-update.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#2a0e08',
    bgGradient: 'radial-gradient(1400px 900px at 20% 15%, rgba(243,186,82,0.12), transparent 60%),' +
                'radial-gradient(1200px 800px at 80% 85%, rgba(192,57,43,0.18), transparent 60%),' +
                'linear-gradient(135deg, #2a0e08 0%, #401410 50%, #2a0e08 100%)',
    zones: [
      { name: 'Tequila bar callout', widgetType: 'RESTAURANT_SPECIALS_CALLOUT', x: 2, y: 3, width: 96, height: 19, zIndex: 2, sortOrder: 1, defaultConfig: { tag: 'AGAVE + LIME', headline: 'Margarita Flight — $24', sub: 'silver / reposado / añejo · house tajín rim · made tableside', accentColor: '#f3ba52', theme: 'red' } },
      { name: 'Tacos & mains', widgetType: 'RESTAURANT_MENU_BOARD', x: 2, y: 24, width: 96, height: 70, zIndex: 2, sortOrder: 2, defaultConfig: { title: 'CANTINA', subtitle: 'tacos · enchiladas · plates', theme: 'red', accentColor: '#f3ba52', columns: 3, posSync: true, maxItems: 12 } },
      { name: 'Allergy legend', widgetType: 'RESTAURANT_ALLERGY_LEGEND', x: 0, y: 94, width: 100, height: 6, zIndex: 2, sortOrder: 3, defaultConfig: { theme: 'charcoal', accentColor: '#f3ba52' } },
    ],
  },

  // ── 6. Bakery / Patisserie — soft cream + dusty rose + gold ───────
  {
    id: 'qsr-bakery-patisserie',
    name: 'Bakery / Patisserie',
    description:
      'European bakery / patisserie — soft cream with dusty-rose + gold. Pastry case as the primary surface, bread + viennoiserie split below, daily-bake countdown callout (uses POS-synced "Sold out today" status when posSync is on).',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#faf2e7',
    bgGradient: 'radial-gradient(1500px 900px at 22% 15%, rgba(212,165,154,0.18), transparent 60%),' +
                'radial-gradient(1200px 800px at 80% 90%, rgba(232,185,74,0.10), transparent 60%),' +
                'linear-gradient(180deg, #faf2e7 0%, #f0e2cc 100%)',
    zones: [
      { name: 'Today\'s bake countdown', widgetType: 'RESTAURANT_SPECIALS_CALLOUT', x: 2, y: 3, width: 96, height: 17, zIndex: 2, sortOrder: 1, defaultConfig: { tag: 'OUT OF THE OVEN AT 7AM', headline: 'Croissants, pain au chocolat, kouign-amann', sub: 'all hand-laminated. when the case is empty, that\'s it.', accentColor: '#d4a59a', theme: 'cream' } },
      { name: 'Pastry case', widgetType: 'RESTAURANT_MENU_BOARD', x: 2, y: 22, width: 96, height: 38, zIndex: 2, sortOrder: 2, defaultConfig: { title: 'PASTRY', subtitle: 'baked this morning', theme: 'cream', accentColor: '#d4a59a', columns: 4, posSync: true, posCategory: 'Pastry', maxItems: 12 } },
      { name: 'Breads & viennoiserie', widgetType: 'RESTAURANT_MENU_BOARD', x: 2, y: 62, width: 96, height: 30, zIndex: 2, sortOrder: 3, defaultConfig: { title: 'BREADS', subtitle: 'sourdough · baguette · brioche · ciabatta', theme: 'cream', accentColor: '#7a1f1f', columns: 3, posSync: true, posCategory: 'Bread', maxItems: 9 } },
      { name: 'Allergy legend', widgetType: 'RESTAURANT_ALLERGY_LEGEND', x: 0, y: 93, width: 100, height: 7, zIndex: 2, sortOrder: 4, defaultConfig: { theme: 'cream', accentColor: '#d4a59a' } },
    ],
  },

  // ── 7. Sports Bar Grill — game-day energy ─────────────────────────
  {
    id: 'qsr-sports-bar-grill',
    name: 'Sports Bar Grill',
    description:
      'Sports-bar grill menu pinned next to the TV — bold black + neon-yellow + hot-red. Wings + shareables left, mains right, half-time deals carousel on top. POS-synced for happy-hour pricing that flips at game start.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#0a0a0e',
    bgGradient: 'radial-gradient(1400px 800px at 18% 12%, rgba(215,255,30,0.08), transparent 60%),' +
                'radial-gradient(1100px 700px at 82% 88%, rgba(255,42,77,0.10), transparent 60%),' +
                'linear-gradient(135deg, #0a0a0e 0%, #14141c 50%, #0a0a0e 100%)',
    zones: [
      { name: 'Half-time deals', widgetType: 'RESTAURANT_COMBO_CAROUSEL', x: 2, y: 3, width: 96, height: 22, zIndex: 2, sortOrder: 1, defaultConfig: { title: 'HALF-TIME DEALS', accentColor: '#d7ff1e', rotationMs: 6000 } },
      { name: 'Wings + shareables', widgetType: 'RESTAURANT_MENU_BOARD', x: 2, y: 27, width: 47, height: 65, zIndex: 2, sortOrder: 2, defaultConfig: { title: 'WINGS · SHAREABLES', subtitle: 'order before the second quarter', theme: 'charcoal', accentColor: '#d7ff1e', columns: 1, posSync: true, posCategory: 'Wings', maxItems: 8 } },
      { name: 'Burgers + mains', widgetType: 'RESTAURANT_MENU_BOARD', x: 51, y: 27, width: 47, height: 65, zIndex: 2, sortOrder: 3, defaultConfig: { title: 'BURGERS · MAINS', subtitle: '8oz prime beef · house buns', theme: 'charcoal', accentColor: '#ff2a4d', columns: 1, posSync: true, posCategory: 'Mains', maxItems: 8 } },
      { name: 'Allergy legend', widgetType: 'RESTAURANT_ALLERGY_LEGEND', x: 0, y: 94, width: 100, height: 6, zIndex: 2, sortOrder: 4, defaultConfig: { theme: 'charcoal', accentColor: '#d7ff1e' } },
    ],
  },

  // ── 8. Brunch Spot — sage + cream + soft brass ────────────────────
  {
    id: 'qsr-brunch-spot',
    name: 'Brunch Spot',
    description:
      'Brunch board — sage green + cream + soft brass. Daypart split: savory left, sweet right, mimosa flight callout up top. Saturday & Sunday energy. POS sync for "available until 2pm" cutoff using your POS\'s 86\'d-item flag.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#faf6ed',
    bgGradient: 'radial-gradient(1500px 900px at 20% 15%, rgba(127,153,102,0.12), transparent 60%),' +
                'radial-gradient(1200px 800px at 80% 90%, rgba(232,185,74,0.10), transparent 60%),' +
                'linear-gradient(180deg, #faf6ed 0%, #ede4cc 100%)',
    zones: [
      { name: 'Mimosa flight', widgetType: 'RESTAURANT_SPECIALS_CALLOUT', x: 2, y: 3, width: 96, height: 18, zIndex: 2, sortOrder: 1, defaultConfig: { tag: 'BOTTOMLESS · UNTIL 2PM', headline: 'Mimosa Flight — $22', sub: 'classic · pomegranate · peach · grapefruit · 90 mins', accentColor: '#7f9966', theme: 'cream' } },
      { name: 'Savory plates', widgetType: 'RESTAURANT_MENU_BOARD', x: 2, y: 23, width: 47, height: 70, zIndex: 2, sortOrder: 2, defaultConfig: { title: 'SAVORY', subtitle: 'eggs · benedicts · hash · bowls', theme: 'cream', accentColor: '#7f9966', columns: 1, posSync: true, posCategory: 'Savory', maxItems: 8 } },
      { name: 'Sweet plates', widgetType: 'RESTAURANT_MENU_BOARD', x: 51, y: 23, width: 47, height: 70, zIndex: 2, sortOrder: 3, defaultConfig: { title: 'SWEET', subtitle: 'pancakes · french toast · granola', theme: 'cream', accentColor: '#e8b94a', columns: 1, posSync: true, posCategory: 'Sweet', maxItems: 8 } },
      { name: 'Allergy legend', widgetType: 'RESTAURANT_ALLERGY_LEGEND', x: 0, y: 94, width: 100, height: 6, zIndex: 2, sortOrder: 4, defaultConfig: { theme: 'cream', accentColor: '#7f9966' } },
    ],
  },

  // ── 9. Food Truck — chalkboard + neon + paper-flyer DIY vibe ──────
  {
    id: 'qsr-food-truck',
    name: 'Food Truck Window',
    description:
      'Food-truck window menu — chalkboard slate + neon-pink accents + DIY paper-flyer typography. Single-column hand-letter menu with prices, today\'s special hero on top. Wait-time display next to the menu board for honest line-of-sight expectations. Toggle POS sync if the truck has Square; manual works fine for paper-and-marker shops.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#1a1715',
    bgGradient: 'radial-gradient(1300px 800px at 25% 15%, rgba(255,42,77,0.18), transparent 60%),' +
                'linear-gradient(180deg, #1a1715 0%, #261f1c 100%)',
    zones: [
      { name: 'Today\'s special', widgetType: 'RESTAURANT_SPECIALS_CALLOUT', x: 2, y: 3, width: 96, height: 22, zIndex: 2, sortOrder: 1, defaultConfig: { tag: 'TODAY · LIMITED RUN', headline: 'Korean BBQ Tacos — $11', sub: 'kalbi · kimchi slaw · sesame oil · gone by 9pm probably', accentColor: '#ff2a4d', theme: 'red' } },
      { name: 'Menu board', widgetType: 'RESTAURANT_MENU_BOARD', x: 2, y: 27, width: 70, height: 65, zIndex: 2, sortOrder: 2, defaultConfig: { title: 'TONIGHT\'S MENU', subtitle: 'cash · card · venmo @theirhandle', theme: 'charcoal', accentColor: '#ff2a4d', columns: 1, posSync: false, maxItems: 8 } },
      { name: 'Wait time', widgetType: 'RESTAURANT_WAIT_TIME', x: 74, y: 27, width: 24, height: 65, zIndex: 2, sortOrder: 3, defaultConfig: { title: 'CURRENT WAIT', estimateMins: 8, partiesAhead: 3 } },
    ],
  },

  // ── 10. Fine Dining Wine List — black + gold + serif elegance ─────
  {
    id: 'qsr-fine-dining-wine',
    name: 'Fine Dining Wine List',
    description:
      'Fine-dining wine + tasting board. Black + gold + serif elegance. By-the-glass left, by-the-bottle right, sommelier\'s pick callout up top. Designed for restaurants that update prices weekly when the cellar moves. POS-synced for live price + vintage tracking; manual mode for a static "house" list.',
    category: 'MENU',
    orientation: 'LANDSCAPE',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '#08070a',
    bgGradient: 'radial-gradient(1400px 800px at 25% 15%, rgba(232,185,74,0.10), transparent 60%),' +
                'linear-gradient(180deg, #08070a 0%, #110f14 100%)',
    zones: [
      { name: "Sommelier's pick", widgetType: 'RESTAURANT_SPECIALS_CALLOUT', x: 2, y: 3, width: 96, height: 18, zIndex: 2, sortOrder: 1, defaultConfig: { tag: "SOMMELIER'S PICK · TONIGHT", headline: 'Barolo · 2018 G. Conterno — $185', sub: 'nebbiolo · 5 yr cellar · pairs with the duck. only 4 bottles left.', accentColor: '#e8b94a', theme: 'charcoal' } },
      { name: 'By the glass', widgetType: 'RESTAURANT_MENU_BOARD', x: 2, y: 23, width: 47, height: 70, zIndex: 2, sortOrder: 2, defaultConfig: { title: 'BY THE GLASS', subtitle: '5oz · 90 minute open · $14–$28', theme: 'charcoal', accentColor: '#e8b94a', columns: 1, posSync: true, posCategory: 'Wine — Glass', maxItems: 12 } },
      { name: 'By the bottle', widgetType: 'RESTAURANT_MENU_BOARD', x: 51, y: 23, width: 47, height: 70, zIndex: 2, sortOrder: 3, defaultConfig: { title: 'BY THE BOTTLE', subtitle: 'cellar selection · ask the sommelier', theme: 'charcoal', accentColor: '#e8b94a', columns: 1, posSync: true, posCategory: 'Wine — Bottle', maxItems: 12 } },
    ],
  },
];
