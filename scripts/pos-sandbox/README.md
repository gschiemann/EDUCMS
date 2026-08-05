# POS sandbox harness

Test every POS integration end-to-end — OAuth connect, catalog sync,
multi-location pricing, webhooks, auto-86 — with **zero external accounts**.
A local mock server emulates the four provider APIs (Square, Clover,
Lightspeed X-Series, Shopify) and the E2E driver runs the REAL API through
the complete pipeline, asserting every stage. Built + first run 2026-08-04;
full results in `docs/research/2026-08-04-pos-sandbox-test/00-REPORT.md`.

## One-time setup (isolated local DB — never prod)

```bash
# Local Postgres 16 (Homebrew). macOS needs the LC_ALL wrapper.
LC_ALL="en_US.UTF-8" /opt/homebrew/opt/postgresql@16/bin/pg_ctl \
  -D /opt/homebrew/var/postgresql@16 -l /tmp/pg16.log start

/opt/homebrew/opt/postgresql@16/bin/psql -h 127.0.0.1 -d postgres \
  -c "CREATE DATABASE venueos_pos_sandbox;"

DATABASE_URL="postgresql://$USER@127.0.0.1:5432/venueos_pos_sandbox" \
DIRECT_URL="postgresql://$USER@127.0.0.1:5432/venueos_pos_sandbox" \
  pnpm --filter @cms/database exec prisma db push --skip-generate

DATABASE_URL="postgresql://$USER@127.0.0.1:5432/venueos_pos_sandbox" \
DIRECT_URL="postgresql://$USER@127.0.0.1:5432/venueos_pos_sandbox" \
  pnpm db:seed

# The driver expects the seeded admin on the DISTRICT (chain) tenant and a
# SCHOOL_ADMIN on the child tenant (multi-location topology):
/opt/homebrew/opt/postgresql@16/bin/psql -h 127.0.0.1 -d venueos_pos_sandbox <<'SQL'
UPDATE users SET tenant_id='00000000-0000-0000-0000-000000000001' WHERE email='admin@springfield.edu';
UPDATE users SET role='SCHOOL_ADMIN' WHERE email='teacher@springfield.edu';
SQL
```

## Run

```bash
# 1. Mock POS providers on :4545
node scripts/pos-sandbox/mock-pos-server.mjs &

# 2. API on :8080 against the sandbox DB + mock providers
source scripts/pos-sandbox/sandbox.env.sh && pnpm dev:api &

# 3. The E2E driver (55 assertions; exit 0 = all green)
node scripts/pos-sandbox/run-e2e.mjs
```

To eyeball it in the dashboard: `pnpm dev:web`, log in as
`admin@springfield.edu` / `admin123`, open Settings → POS (connections +
store mapping) and Templates → "Live POS Menu" preview (live prices).
NOTE: the driver is idempotent-ish (upserts + eventId dedup rows persist);
for a pristine re-run, `DROP DATABASE` and redo setup.

## How it works

- `mock-pos-server.mjs` — one HTTP server, four provider emulations
  (paths never collide). Faithful response shapes: Square cursor
  pagination + `location_overrides` + `absent_at_location_ids`, Clover
  offset paging, Lightspeed `version.max` cursors, Shopify Link-header
  `page_info`. Authorize endpoints 302 back with `code`+`state` (+
  `merchant_id` / `domain_prefix` / `shop`), so even the browser Connect
  flow works against it.
- The provider modules honor `{SQUARE|CLOVER|LIGHTSPEED|SHOPIFY}_API_BASE`
  env overrides **only when `NODE_ENV !== 'production'`** — a prod deploy
  cannot be redirected. Set in `sandbox.env.sh`.
- `run-e2e.mjs` — logs in, drives authorize → callback → sync per provider,
  asserts `/pos/items` (counts, prices, 86'd exclusions), maps Square's
  Stadium store to the child tenant and asserts `menu_location_overrides`
  (price 1495 + absent-location 86), fires HMAC-signed Square webhooks
  (forged-signature 401, replay dedup, inventory auto-86), and pushes all
  three custom-webhook payload shapes (secret auth, eventId dedup).

## Real provider sandboxes (owner steps)

The mock proves OUR pipeline; a real-sandbox pass additionally proves the
providers' contracts. All four offer free sandboxes — see the report's
"Real sandbox signup steps" section. Set the real `*_CLIENT_ID/SECRET` env
vars, leave `*_API_BASE` unset, keep `SQUARE_ENV`/`CLOVER_ENV` at
`sandbox`, and use a public tunnel for the OAuth redirect URIs.

## EXTERNAL_HTML board verifier

`node ../../scripts/pos-sandbox/verify-applymenu.mjs` (run from `apps/web`
so `@playwright/test` resolves) proves the 31 `applyMenu()` signage boards
overlay live POS data: loads `signage/menus-pos/01` over HTTP in headless
chromium, posts the same `educms-overrides {menu:{items}}` message
WidgetRenderer auto-posts for `signage/{qsr,menus-pos,bar}` URLs, and
asserts a name-matched item's price flips to the POS price and an 86'd
item gets the sold-out treatment. Uses the live sandbox feed when the API
is up; falls back to an inline fixture.
