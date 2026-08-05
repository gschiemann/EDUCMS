#!/usr/bin/env node
/**
 * Mock POS sandbox server (2026-08-04).
 * ─────────────────────────────────────
 * Faithfully emulates the FOUR provider APIs our POS connectors call —
 * Square, Clover, Lightspeed X-Series, Shopify — on one local port, so the
 * REAL connector code (apps/api/src/pos/providers/*) can run a complete
 * OAuth → token exchange → catalog sync → per-location pricing pipeline
 * with zero external accounts. Endpoint paths never collide across
 * providers, so one server handles all four.
 *
 * Point the API at it with the dev-only base overrides (honored only when
 * NODE_ENV !== 'production'):
 *   SQUARE_API_BASE=http://127.0.0.1:4545
 *   CLOVER_API_BASE=http://127.0.0.1:4545
 *   LIGHTSPEED_API_BASE=http://127.0.0.1:4545
 *   SHOPIFY_API_BASE=http://127.0.0.1:4545
 * plus mock client ids/secrets (any non-empty value).
 *
 * What each provider emulates (matched to what our connectors parse):
 *   Square     POST /oauth2/token                GET /v2/locations
 *              GET  /v2/catalog/list             (cursor-paginated, 2 pages;
 *              ITEM variations w/ price_money, location_overrides,
 *              absent_at_location_ids — exercises per-location pricing)
 *              GET  /oauth2/authorize            (302 back w/ code+state —
 *              lets the real browser Connect flow complete too)
 *   Clover     POST /oauth/v2/token  POST /oauth/v2/refresh
 *              GET  /v3/merchants/:mid/categories  GET /v3/merchants/:mid/items
 *              GET  /oauth/v2/authorize          (302 back w/ merchant_id)
 *   Lightspeed POST /api/1.0/token (form-encoded)
 *              GET  /api/2.0/product_categories  GET /api/2.0/products
 *              (version.max cursor, terminates on empty data page)
 *              GET  /connect                     (302 back w/ domain_prefix)
 *   Shopify    POST /admin/oauth/access_token
 *              GET  /admin/api/:v/products.json  (Link-header page_info
 *              cursor, 2 pages)
 *              GET  /admin/oauth/authorize       (302 back w/ shop)
 *
 * Run: node scripts/pos-sandbox/mock-pos-server.mjs [port]   (default 4545)
 * Every request is logged to stdout: "<provider> <method> <path>".
 */
import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.argv[2] || process.env.MOCK_POS_PORT || 4545);

// ─── Helpers ────────────────────────────────────────────────────────────

function json(res, status, body, headers = {}) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': buf.length,
    ...headers,
  });
  res.end(buf);
}

function redirectBack(res, query, extraParams = {}) {
  const redirectUri = query.get('redirect_uri');
  const state = query.get('state') || '';
  if (!redirectUri) return json(res, 400, { error: 'missing redirect_uri' });
  const u = new URL(redirectUri);
  u.searchParams.set('code', `mock-code-${Date.now()}`);
  if (state) u.searchParams.set('state', state);
  for (const [k, v] of Object.entries(extraParams)) u.searchParams.set(k, v);
  res.writeHead(302, { Location: u.toString() });
  res.end();
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const nowPlusIso = (s) => new Date(Date.now() + s * 1000).toISOString();
const epochSecPlus = (s) => Math.floor(Date.now() / 1000) + s;

// ─── Square fixtures — "Sandbox Grill" (2 locations, per-loc pricing) ───

const SQ_MERCHANT = 'MOCK_SQ_MERCHANT';
export const SQ_LOCATIONS = [
  {
    id: 'SQ_LOC_MAIN',
    name: 'Sandbox Grill — Main St',
    address: { address_line_1: '100 Main St', locality: 'Walnut Creek', administrative_district_level_1: 'CA', postal_code: '94596' },
    timezone: 'America/Los_Angeles',
    status: 'ACTIVE',
  },
  {
    id: 'SQ_LOC_STADIUM',
    name: 'Sandbox Grill — Stadium Stand',
    address: { address_line_1: '1 Stadium Way', locality: 'Walnut Creek', administrative_district_level_1: 'CA', postal_code: '94597' },
    timezone: 'America/Los_Angeles',
    status: 'ACTIVE',
  },
];

const sqCategory = (id, name, ordinal) => ({
  type: 'CATEGORY', id, updated_at: '2026-08-01T12:00:00Z',
  category_data: { name, ordinal },
});
const sqItem = (id, name, categoryId, variations, extra = {}) => ({
  type: 'ITEM', id, updated_at: '2026-08-02T12:00:00Z', is_deleted: false,
  item_data: { name, category_id: categoryId, description: extra.description, variations },
  ...extra.objectFields,
});
const sqVar = (id, name, cents, locationOverrides) => ({
  id, updated_at: '2026-08-02T12:00:00Z', is_deleted: false,
  item_variation_data: {
    name,
    price_money: { amount: cents, currency: 'USD' },
    ...(locationOverrides ? { location_overrides: locationOverrides } : {}),
  },
});

// Page 1: categories + burgers. Page 2: drinks + sides (proves the cursor
// path). The Smash Burger carries a Stadium price override (+$3) and the
// Craft Lemonade is absent at the Stadium — both exercise the
// per-location pipeline end-to-end.
const SQ_CATALOG_PAGES = [
  {
    objects: [
      sqCategory('SQ_CAT_BURGERS', 'Burgers', 0),
      sqCategory('SQ_CAT_DRINKS', 'Drinks', 1),
      sqCategory('SQ_CAT_SIDES', 'Sides', 2),
      sqItem('SQ_ITEM_SMASH', 'Smash Burger', 'SQ_CAT_BURGERS', [
        sqVar('SQ_VAR_SMASH_REG', 'Regular', 1195, [
          { location_id: 'SQ_LOC_STADIUM', price_money: { amount: 1495, currency: 'USD' } },
        ]),
      ], { description: 'Double patty, griddled onions, house sauce' }),
      sqItem('SQ_ITEM_CLASSIC', 'Classic Cheeseburger', 'SQ_CAT_BURGERS', [
        sqVar('SQ_VAR_CLASSIC_SM', 'Single', 995),
        sqVar('SQ_VAR_CLASSIC_DB', 'Double', 1395),
      ]),
      sqItem('SQ_ITEM_VEGGIE', 'Veggie Stack', 'SQ_CAT_BURGERS', [
        sqVar('SQ_VAR_VEGGIE_REG', 'Regular', 1095),
      ]),
    ],
    cursor: 'MOCK_CURSOR_PAGE_2',
  },
  {
    objects: [
      sqItem('SQ_ITEM_LEMONADE', 'Craft Lemonade', 'SQ_CAT_DRINKS', [
        sqVar('SQ_VAR_LEMONADE_REG', 'Regular', 495),
      ], {
        description: 'Fresh-squeezed daily',
        objectFields: { present_at_all_locations: true, absent_at_location_ids: ['SQ_LOC_STADIUM'] },
      }),
      sqItem('SQ_ITEM_COLDBREW', 'Cold Brew', 'SQ_CAT_DRINKS', [
        sqVar('SQ_VAR_COLDBREW_REG', 'Regular', 550),
      ]),
      sqItem('SQ_ITEM_FRIES', 'Garlic Fries', 'SQ_CAT_SIDES', [
        sqVar('SQ_VAR_FRIES_REG', 'Regular', 595),
      ]),
      sqItem('SQ_ITEM_RINGS', 'Onion Rings', 'SQ_CAT_SIDES', [
        sqVar('SQ_VAR_RINGS_REG', 'Regular', 650),
      ]),
    ],
    // no cursor → last page
  },
];

// ─── Clover fixtures — "Mock Roastery" coffee shop ──────────────────────

const CLV_CATEGORIES = [
  { id: 'CLV_CAT_ESPRESSO', name: 'Espresso', sortOrder: 0 },
  { id: 'CLV_CAT_PASTRY', name: 'Pastries', sortOrder: 1 },
];
const CLV_ITEMS = [
  { id: 'CLV_ITEM_LATTE', name: 'Oat Latte', price: 575, categories: { elements: [{ id: 'CLV_CAT_ESPRESSO' }] }, hidden: false, available: true, modifiedTime: Date.now() },
  { id: 'CLV_ITEM_CAP', name: 'Cappuccino', price: 525, categories: { elements: [{ id: 'CLV_CAT_ESPRESSO' }] }, hidden: false, available: true, modifiedTime: Date.now() },
  { id: 'CLV_ITEM_MOCHA', name: 'Mocha', price: 625, categories: { elements: [{ id: 'CLV_CAT_ESPRESSO' }] }, hidden: false, available: true, modifiedTime: Date.now() },
  { id: 'CLV_ITEM_CROISSANT', name: 'Butter Croissant', price: 450, categories: { elements: [{ id: 'CLV_CAT_PASTRY' }] }, hidden: false, available: true, modifiedTime: Date.now() },
  { id: 'CLV_ITEM_SCONE', name: 'Blueberry Scone', price: 425, categories: { elements: [{ id: 'CLV_CAT_PASTRY' }] }, hidden: false, available: false, modifiedTime: Date.now() },
  { id: 'CLV_ITEM_SECRET', name: 'Off-Register Special', price: 999, categories: { elements: [] }, hidden: true, available: true, modifiedTime: Date.now() },
];

// ─── Lightspeed fixtures — "Mock Pro Shop" retail ───────────────────────

const LS_DOMAIN_PREFIX = 'mockstore';
const LS_CATEGORIES = [
  { id: 'LS_CAT_APPAREL', name: 'Apparel' },
  { id: 'LS_CAT_GEAR', name: 'Gear' },
];
const LS_PRODUCTS = [
  { id: 'LS_PROD_TEE', name: 'Team Tee', price_including_tax: 24.99, product_category: { id: 'LS_CAT_APPAREL', name: 'Apparel' }, active: true },
  { id: 'LS_PROD_HOODIE', name: 'Team Hoodie', price_including_tax: 54.99, product_category: { id: 'LS_CAT_APPAREL', name: 'Apparel' }, active: true },
  { id: 'LS_PROD_BOTTLE', name: 'Insulated Bottle', price_including_tax: 32.5, product_category: { id: 'LS_CAT_GEAR', name: 'Gear' }, active: true },
  { id: 'LS_PROD_BAG', name: 'Duffel Bag', price_including_tax: 79.0, product_category: { id: 'LS_CAT_GEAR', name: 'Gear' }, active: true },
];

// ─── Shopify fixtures — "Mock Merch" (2 pages via Link header) ──────────

const SHOPIFY_SHOP = 'mock-merch.myshopify.com';
const SHOPIFY_PAGE_1 = [
  {
    id: 9001, title: 'Spirit Jersey', product_type: 'Apparel', status: 'active',
    body_html: 'Limited-run spirit jersey', updated_at: '2026-08-01T00:00:00Z',
    variants: [
      { id: 1, title: 'S', price: '39.00', inventory_management: 'shopify', inventory_quantity: 12, inventory_policy: 'deny', updated_at: '2026-08-01T00:00:00Z' },
      { id: 2, title: 'XL', price: '39.00', inventory_management: 'shopify', inventory_quantity: 0, inventory_policy: 'deny', updated_at: '2026-08-01T00:00:00Z' },
    ],
  },
  {
    id: 9002, title: 'Logo Cap', product_type: 'Apparel', status: 'active',
    variants: [
      { id: 3, title: 'Default Title', price: '24.00', inventory_management: null, inventory_quantity: 0, inventory_policy: 'deny' },
    ],
  },
];
const SHOPIFY_PAGE_2 = [
  {
    id: 9003, title: 'Stadium Blanket', product_type: 'Accessories', status: 'active',
    variants: [
      { id: 4, title: 'Default Title', price: '45.00', inventory_management: 'shopify', inventory_quantity: 5, inventory_policy: 'continue' },
    ],
  },
  {
    id: 9004, title: 'Retired Pennant', product_type: 'Accessories', status: 'archived',
    variants: [
      { id: 5, title: 'Default Title', price: '15.00', inventory_management: null, inventory_quantity: 0, inventory_policy: 'deny' },
    ],
  },
];

// ─── Router ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = u.pathname;
  const q = u.searchParams;
  const tag = (provider) => console.log(`[mock-pos] ${provider.padEnd(10)} ${req.method} ${req.url}`);

  try {
    // ── Square ──────────────────────────────────────────────────────────
    if (p === '/oauth2/authorize') {
      tag('square');
      return redirectBack(res, q);
    }
    if (p === '/oauth2/token' && req.method === 'POST') {
      tag('square');
      await readBody(req);
      return json(res, 200, {
        access_token: 'mock-sq-access-token',
        refresh_token: 'mock-sq-refresh-token',
        expires_at: nowPlusIso(30 * 24 * 3600),
        merchant_id: SQ_MERCHANT,
        scope: 'MERCHANT_PROFILE_READ ITEMS_READ INVENTORY_READ',
        token_type: 'bearer',
      });
    }
    if (p === '/v2/locations') {
      tag('square');
      return json(res, 200, { locations: SQ_LOCATIONS });
    }
    if (p === '/v2/catalog/list') {
      tag('square');
      const cursor = q.get('cursor');
      const page = cursor === 'MOCK_CURSOR_PAGE_2' ? SQ_CATALOG_PAGES[1] : SQ_CATALOG_PAGES[0];
      return json(res, 200, page);
    }

    // ── Clover ──────────────────────────────────────────────────────────
    if (p === '/oauth/v2/authorize') {
      tag('clover');
      return redirectBack(res, q, { merchant_id: 'MOCK_CLV_MERCHANT' });
    }
    if (p === '/oauth/v2/token' && req.method === 'POST') {
      tag('clover');
      await readBody(req);
      return json(res, 200, {
        access_token: 'mock-clv-access-token',
        refresh_token: 'mock-clv-refresh-token',
        access_token_expiration: epochSecPlus(3600),
        merchant_id: 'MOCK_CLV_MERCHANT',
      });
    }
    if (p === '/oauth/v2/refresh' && req.method === 'POST') {
      tag('clover');
      await readBody(req);
      return json(res, 200, {
        access_token: 'mock-clv-access-token-2',
        refresh_token: 'mock-clv-refresh-token-2',
        access_token_expiration: epochSecPlus(3600),
      });
    }
    {
      const m = p.match(/^\/v3\/merchants\/([^/]+)\/(categories|items)$/);
      if (m) {
        tag('clover');
        const offset = Number(q.get('offset') || 0);
        if (m[2] === 'categories') {
          return json(res, 200, { elements: offset === 0 ? CLV_CATEGORIES : [] });
        }
        return json(res, 200, { elements: offset === 0 ? CLV_ITEMS : [] });
      }
    }

    // ── Lightspeed X-Series ────────────────────────────────────────────
    if (p === '/connect') {
      tag('lightspeed');
      return redirectBack(res, q, { domain_prefix: LS_DOMAIN_PREFIX });
    }
    if (p === '/api/1.0/token' && req.method === 'POST') {
      tag('lightspeed');
      await readBody(req);
      return json(res, 200, {
        access_token: 'mock-ls-access-token',
        refresh_token: 'mock-ls-refresh-token',
        expires_in: 3600,
        domain_prefix: LS_DOMAIN_PREFIX,
        scope: 'products:read',
      });
    }
    if (p === '/api/2.0/product_categories') {
      tag('lightspeed');
      const after = q.get('after');
      // First page → data + version.max; cursor page → empty data (stop).
      if (!after) return json(res, 200, { data: LS_CATEGORIES, version: { min: 0, max: 100 } });
      return json(res, 200, { data: [], version: { min: 100, max: 100 } });
    }
    if (p === '/api/2.0/products') {
      tag('lightspeed');
      const after = q.get('after');
      if (!after) return json(res, 200, { data: LS_PRODUCTS, version: { min: 0, max: 200 } });
      return json(res, 200, { data: [], version: { min: 200, max: 200 } });
    }

    // ── Shopify ─────────────────────────────────────────────────────────
    if (p === '/admin/oauth/authorize') {
      tag('shopify');
      return redirectBack(res, q, { shop: SHOPIFY_SHOP });
    }
    if (p === '/admin/oauth/access_token' && req.method === 'POST') {
      tag('shopify');
      await readBody(req);
      return json(res, 200, { access_token: 'mock-shopify-offline-token', scope: 'read_products' });
    }
    {
      const m = p.match(/^\/admin\/api\/[^/]+\/products\.json$/);
      if (m) {
        tag('shopify');
        const pageInfo = q.get('page_info');
        if (!pageInfo) {
          // Real Shopify puts the FULL next-page URL in the Link header; our
          // parser only extracts page_info from it, so any absolute URL works.
          const next = `<http://127.0.0.1:${PORT}${p}?page_info=MOCK_PAGE_2&limit=250>; rel="next"`;
          return json(res, 200, { products: SHOPIFY_PAGE_1 }, { Link: next });
        }
        return json(res, 200, { products: SHOPIFY_PAGE_2 });
      }
    }

    console.log(`[mock-pos] UNMATCHED   ${req.method} ${req.url}`);
    return json(res, 404, { error: `mock-pos: no route for ${req.method} ${p}` });
  } catch (err) {
    console.error('[mock-pos] handler error:', err);
    return json(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-pos] Mock POS sandbox listening on http://127.0.0.1:${PORT}`);
  console.log('[mock-pos] Providers: square | clover | lightspeed | shopify');
});
