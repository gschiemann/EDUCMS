#!/usr/bin/env node
/**
 * POS sandbox E2E driver (2026-08-04).
 * ────────────────────────────────────
 * Drives the REAL API (localhost:8080) through the complete POS pipeline
 * against the mock provider server (mock-pos-server.mjs) and asserts every
 * stage:
 *
 *   1. OAuth connect (authorize → mock 302 → callback → token exchange)
 *      for square / clover / lightspeed-retail / shopify-pos
 *   2. Catalog sync → PosMenuItem/PosCategory rows (+ availability rules)
 *   3. Square multi-location: PosLocation sync, store→tenant mapping,
 *      per-location price override + absent-location 86 via the menu bridge
 *   4. Square webhook: HMAC signature gate, idempotency dedup, auto-86
 *      from inventory.count.updated
 *   5. Custom-webhook connector: all 3 payload shapes, secret auth,
 *      eventId dedup
 *
 * Prereqs (see README.md): local Postgres `venueos_pos_sandbox` seeded,
 * mock server on :4545, API on :8080 booted with the sandbox env.
 *
 * Run: node scripts/pos-sandbox/run-e2e.mjs
 * Exit 0 = all assertions passed. Non-zero = failures (printed).
 */
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const API = process.env.SANDBOX_API || 'http://localhost:8080/api/v1';
const MOCK = process.env.MOCK_POS_BASE || 'http://127.0.0.1:4545';
const SQUARE_SIG_KEY = process.env.SQUARE_WEBHOOK_SIG_KEY || 'mock-square-sig-key';
const PSQL = process.env.SANDBOX_PSQL || '/opt/homebrew/opt/postgresql@16/bin/psql';
const DB = process.env.SANDBOX_DB || 'venueos_pos_sandbox';
const ADMIN_EMAIL = 'admin@springfield.edu';
const ADMIN_PASSWORD = 'admin123';
const CHAIN_TENANT = '00000000-0000-0000-0000-000000000001';
const LOCATION_TENANT = '00000000-0000-0000-0000-000000000002';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function sql(query) {
  return execFileSync(PSQL, ['-h', '127.0.0.1', '-d', DB, '-tAc', query], {
    encoding: 'utf8',
  }).trim();
}

let TOKEN = '';
async function api(path, { method = 'GET', body, headers = {}, redirect = 'follow', rawBody } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    redirect,
    headers: {
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.clone().json();
  } catch {
    /* non-JSON (redirects etc.) */
  }
  return { res, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── 0. Login ───────────────────────────────────────────────────────────

async function login() {
  const { res, json } = await api('/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!res.ok || !json?.access_token) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  TOKEN = json.access_token;
  console.log(`\nLogged in as ${ADMIN_EMAIL} (tenant ${json?.user?.tenantId || '?'})`);
}

// ─── 1+2. OAuth connect + sync per provider ────────────────────────────

async function oauthConnect(provider, { shop } = {}) {
  console.log(`\n━━ ${provider}: OAuth connect ━━`);
  const authPath = `/pos/oauth/${provider}/authorize${shop ? `?shop=${encodeURIComponent(shop)}` : ''}`;
  const { res: aRes, json: aJson } = await api(authPath);
  check(`${provider}: authorize returns URL`, aRes.ok && !!aJson?.url, aJson?.url?.slice(0, 90) || `status ${aRes.status} ${JSON.stringify(aJson).slice(0, 120)}`);
  if (!aJson?.url) return null;

  // Follow the provider's authorize page (the mock) manually: it 302s back
  // to our API callback with code+state (+ per-provider extras).
  const mockRes = await fetch(aJson.url, { redirect: 'manual' });
  const cbUrl = mockRes.headers.get('location');
  check(`${provider}: mock authorize 302s to our callback`, mockRes.status === 302 && !!cbUrl, cbUrl?.slice(0, 100) || `status ${mockRes.status}`);
  if (!cbUrl) return null;

  // Hit the callback (public endpoint) and read the final web redirect.
  const cbRes = await fetch(cbUrl, { redirect: 'manual' });
  const doneUrl = cbRes.headers.get('location') || '';
  const ok = /status=ok/.test(doneUrl);
  check(`${provider}: callback → token exchange → status=ok`, ok, doneUrl.slice(0, 120));
  if (!ok) return null;

  // The connection row now exists; initial sync is fire-and-forget, so give
  // it a beat and then run a deterministic manual sync.
  await sleep(1500);
  const { json: conns } = await api('/pos/connections');
  const conn = (conns || []).find((c) => c.providerId === provider);
  check(`${provider}: connection row ACTIVE`, conn?.status === 'ACTIVE', `status=${conn?.status}`);
  if (!conn) return null;

  const { json: sync } = await api(`/pos/connections/${conn.id}/sync`, { method: 'POST' });
  check(`${provider}: manual sync ok`, sync?.status === 'ok', sync?.message || JSON.stringify(sync).slice(0, 150));
  return { conn, sync };
}

async function assertItems(provider, connectionId, expect) {
  const { json: items } = await api(`/pos/items?connectionId=${connectionId}`);
  const names = (items || []).map((i) => i.name).sort();
  check(
    `${provider}: /pos/items count (available only)`,
    (items || []).length === expect.count,
    `got ${(items || []).length}, want ${expect.count}: ${names.join(' | ').slice(0, 160)}`,
  );
  for (const [name, priceCents] of expect.prices || []) {
    const it = (items || []).find((i) => i.name === name);
    check(`${provider}: "${name}" price ${priceCents}¢`, it?.priceCents === priceCents, `got ${it?.priceCents}`);
  }
  for (const name of expect.absent || []) {
    check(`${provider}: "${name}" excluded (86'd/hidden)`, !(items || []).some((i) => i.name === name));
  }
}

// ─── 3. Square multi-location ──────────────────────────────────────────

async function squareMultiLocation(sqConn) {
  console.log(`\n━━ square: multi-location pricing ━━`);
  const { json: locs } = await api(`/pos/connections/${sqConn.id}/locations`);
  check('square: 2 PosLocations synced', (locs || []).length === 2, (locs || []).map((l) => l.externalId).join(', '));
  const stadium = (locs || []).find((l) => l.externalId === 'SQ_LOC_STADIUM');
  if (!stadium) return;

  const { res: mapRes } = await api(`/pos/connections/${sqConn.id}/locations/${stadium.id}`, {
    method: 'PUT',
    body: { locationTenantId: LOCATION_TENANT },
  });
  check('square: stadium mapped → location tenant', mapRes.ok);

  // Re-sync so the menu bridge writes the per-location overrides.
  const { json: sync } = await api(`/pos/connections/${sqConn.id}/sync`, { method: 'POST' });
  check('square: re-sync after mapping ok', sync?.status === 'ok');

  // DB truth: Smash Burger's stadium price override (1495 vs base 1195)…
  const smash = sql(
    `SELECT o.price_cents, o.is_available FROM menu_location_overrides o
     JOIN menu_items i ON i.id = o.menu_item_id
     WHERE i.name = 'Smash Burger' AND o.location_tenant_id = '${LOCATION_TENANT}';`,
  );
  check('square: per-location price override 1495¢ @ stadium', smash === '1495|t', `got "${smash}" (want "1495|t")`);

  // …and Craft Lemonade absent at the stadium (absent_at_location_ids).
  const lemonade = sql(
    `SELECT o.is_available FROM menu_location_overrides o
     JOIN menu_items i ON i.id = o.menu_item_id
     WHERE i.name = 'Craft Lemonade' AND o.location_tenant_id = '${LOCATION_TENANT}';`,
  );
  check('square: absent-at-location → 86 @ stadium', lemonade === 'f', `got "${lemonade}" (want "f")`);
}

// ─── 4. Square webhook (HMAC + dedup + auto-86) ────────────────────────

function squareSign(body) {
  const notificationUrl = 'http://localhost:8080/api/v1/pos/webhook/square';
  return createHmac('sha256', SQUARE_SIG_KEY).update(notificationUrl + body).digest('base64');
}

async function squareWebhook() {
  console.log(`\n━━ square: webhook receiver ━━`);

  // Bad signature must 401.
  const badBody = JSON.stringify({ event_id: 'evt-bad', type: 'catalog.version.updated', merchant_id: 'MOCK_SQ_MERCHANT' });
  const { res: badRes } = await api('/pos/webhook/square', {
    method: 'POST',
    rawBody: badBody,
    headers: { 'x-square-hmacsha256-signature': 'AAAA_not_a_real_signature' },
  });
  check('square-webhook: forged signature rejected 401', badRes.status === 401, `status ${badRes.status}`);

  // Valid catalog event → accepted + triggers re-sync.
  const catBody = JSON.stringify({ event_id: 'evt-catalog-1', type: 'catalog.version.updated', merchant_id: 'MOCK_SQ_MERCHANT' });
  const { res: catRes, json: catJson } = await api('/pos/webhook/square', {
    method: 'POST',
    rawBody: catBody,
    headers: { 'x-square-hmacsha256-signature': squareSign(catBody) },
  });
  check('square-webhook: signed catalog event accepted', catRes.ok && catJson?.ok === true, JSON.stringify(catJson));

  // Replay of the SAME event_id → deduped.
  const { json: dupJson } = await api('/pos/webhook/square', {
    method: 'POST',
    rawBody: catBody,
    headers: { 'x-square-hmacsha256-signature': squareSign(catBody) },
  });
  check('square-webhook: replay deduped', dupJson?.deduped === true, JSON.stringify(dupJson));

  // inventory.count.updated → auto-86 Garlic Fries at the mapped stadium.
  const invBody = JSON.stringify({
    event_id: 'evt-inventory-1',
    type: 'inventory.count.updated',
    merchant_id: 'MOCK_SQ_MERCHANT',
    data: {
      object: {
        inventory_counts: [
          { catalog_object_id: 'SQ_VAR_FRIES_REG', location_id: 'SQ_LOC_STADIUM', quantity: '0', state: 'OUT_OF_STOCK' },
        ],
      },
    },
  });
  const { res: invRes, json: invJson } = await api('/pos/webhook/square', {
    method: 'POST',
    rawBody: invBody,
    headers: { 'x-square-hmacsha256-signature': squareSign(invBody) },
  });
  check('square-webhook: inventory event accepted', invRes.ok && invJson?.ok === true, JSON.stringify(invJson));
  await sleep(1500); // auto-86 apply is fire-and-forget

  const fries = sql(
    `SELECT o.is_available, o.source FROM menu_location_overrides o
     JOIN menu_items i ON i.id = o.menu_item_id
     WHERE i.name = 'Garlic Fries' AND o.location_tenant_id = '${LOCATION_TENANT}';`,
  );
  check('square-webhook: auto-86 flipped Garlic Fries @ stadium', fries === 'f|square', `got "${fries}" (want "f|square")`);
}

// ─── 5. Custom webhook (bring-your-own POS) ────────────────────────────

const CUSTOM_SECRET = 'sandbox-shared-secret-123';

async function customWebhook() {
  console.log(`\n━━ custom-webhook: bring-your-own POS ━━`);

  const { res: connRes, json: connJson } = await api('/pos/connections', {
    method: 'POST',
    body: {
      providerId: 'custom-webhook',
      displayName: 'Sandbox Cafeteria Feed',
      credentials: { webhookSecret: CUSTOM_SECRET },
    },
  });
  check('custom: connection created', connRes.ok && !!connJson?.id, `status ${connRes.status}`);

  // Wrong secret → 401, no tenant leak.
  const { res: wrongRes } = await api('/pos/webhook/custom-webhook', {
    method: 'POST',
    body: { items: [{ id: 'x', name: 'X', priceCents: 100 }] },
    headers: { 'X-Webhook-Secret': 'wrong-secret' },
  });
  check('custom: wrong secret rejected 401', wrongRes.status === 401, `status ${wrongRes.status}`);

  // Shape 3: legacy flat items.
  const { json: push1 } = await api('/pos/webhook/custom-webhook', {
    method: 'POST',
    headers: { 'X-Webhook-Secret': CUSTOM_SECRET },
    body: {
      eventId: 'push-1',
      items: [
        { id: 'CW_PIZZA', name: 'Pepperoni Pizza Slice', price: 3.5, category: 'Entrees' },
        { id: 'CW_SALAD', name: 'Garden Salad', priceCents: 425, category: 'Sides', badges: ['V', 'GF'] },
        { id: 'CW_MILK', name: 'Chocolate Milk', priceCents: 150, category: 'Drinks' },
        { name: 'No-ID Item (must be skipped)' },
      ],
    },
  });
  check('custom: {items} push upserted 3, skipped 1', push1?.upserted === 3 && push1?.skipped === 1, JSON.stringify(push1));

  // eventId replay → deduped.
  const { json: replay } = await api('/pos/webhook/custom-webhook', {
    method: 'POST',
    headers: { 'X-Webhook-Secret': CUSTOM_SECRET },
    body: { eventId: 'push-1', items: [{ id: 'CW_PIZZA', name: 'Pepperoni Pizza Slice', priceCents: 9999 }] },
  });
  check('custom: eventId replay deduped', replay?.deduped === true, JSON.stringify(replay));

  // Shape 1: design-once menu + per-location override.
  const { json: push2 } = await api('/pos/webhook/custom-webhook', {
    method: 'POST',
    headers: { 'X-Webhook-Secret': CUSTOM_SECRET },
    body: {
      eventId: 'push-2',
      menu: [
        {
          externalId: 'CW_BOWL',
          name: 'Teriyaki Bowl',
          defaultPriceCents: 895,
          category: 'Entrees',
          locations: [{ locationTenantId: LOCATION_TENANT, priceCents: 995 }],
        },
      ],
    },
  });
  check('custom: {menu} push item + override', push2?.itemsUpserted === 1 && push2?.overridesUpserted === 1, JSON.stringify(push2));

  // Shape 2: availability (86) push.
  const { json: push3 } = await api('/pos/webhook/custom-webhook', {
    method: 'POST',
    headers: { 'X-Webhook-Secret': CUSTOM_SECRET },
    body: {
      eventId: 'push-3',
      availability: [{ externalId: 'CW_BOWL', available: false, locationTenantId: LOCATION_TENANT }],
    },
  });
  check('custom: {availability} 86 applied', push3?.overridesUpdated >= 1, JSON.stringify(push3));

  const bowl = sql(
    `SELECT o.is_available FROM menu_location_overrides o
     JOIN menu_items i ON i.id = o.menu_item_id
     WHERE i.external_id = 'CW_BOWL' AND o.location_tenant_id = '${LOCATION_TENANT}';`,
  );
  check('custom: DB shows Teriyaki Bowl 86d', bowl === 'f', `got "${bowl}"`);

  // Legacy flat items reached the widget feed.
  const { json: items } = await api('/pos/items');
  const pizza = (items || []).find((i) => i.name === 'Pepperoni Pizza Slice');
  check('custom: pushed item visible in /pos/items @ 350¢', pizza?.priceCents === 350, `got ${pizza?.priceCents}`);
}

// ─── Main ──────────────────────────────────────────────────────────────

try {
  await login();

  const square = await oauthConnect('square');
  if (square) {
    // 8 variations; Square list is available-only (all 8 available at base).
    await assertItems('square', square.conn.id, {
      count: 8,
      prices: [
        ['Smash Burger', 1195],
        ['Classic Cheeseburger / Double', 1395],
        ['Craft Lemonade', 495],
      ],
    });
  }

  const clover = await oauthConnect('clover');
  if (clover) {
    // 6 synced; Blueberry Scone (available:false) + Off-Register Special
    // (hidden:true) are excluded from the available-only feed.
    await assertItems('clover', clover.conn.id, {
      count: 4,
      prices: [['Oat Latte', 575]],
      absent: ['Blueberry Scone', 'Off-Register Special'],
    });
  }

  const lightspeed = await oauthConnect('lightspeed-retail');
  if (lightspeed) {
    await assertItems('lightspeed-retail', lightspeed.conn.id, {
      count: 4,
      prices: [['Team Tee', 2499], ['Insulated Bottle', 3250]],
    });
  }

  const shopify = await oauthConnect('shopify-pos', { shop: 'mock-merch.myshopify.com' });
  if (shopify) {
    // 5 variants synced; XL jersey (0 stock, deny) + Retired Pennant
    // (archived) excluded from the available-only feed.
    await assertItems('shopify-pos', shopify.conn.id, {
      count: 3,
      prices: [['Spirit Jersey / S', 3900], ['Logo Cap', 2400], ['Stadium Blanket', 4500]],
      absent: ['Spirit Jersey / XL', 'Retired Pennant'],
    });
  }

  if (square) await squareMultiLocation(square.conn);
  if (square) await squareWebhook();
  await customWebhook();
} catch (err) {
  check('E2E driver crashed', false, String(err?.message || err));
}

// ─── Summary ───────────────────────────────────────────────────────────

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`RESULT: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED:` : ' — ALL GREEN'}`);
for (const r of results.filter((r) => !r.ok)) console.log(`  ❌ ${r.name} — ${r.detail}`);
process.exit(failed ? 1 : 0);
