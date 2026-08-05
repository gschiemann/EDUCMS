# POS sandbox environment (2026-08-04) — source before booting the API.
#   source scripts/pos-sandbox/sandbox.env.sh && pnpm dev:api
# Isolated local Postgres + mock POS providers on :4545. All values are
# mock/dev-only; nothing here touches production.

export DATABASE_URL="postgresql://gschiemann@127.0.0.1:5432/venueos_pos_sandbox"
export DIRECT_URL="postgresql://gschiemann@127.0.0.1:5432/venueos_pos_sandbox"
export REDIS_URL="redis://localhost:6379"
export PORT=8080
export NODE_ENV=development
export CSRF_ENFORCE=false

# Mock OAuth apps (any non-empty value satisfies providerOAuthConfigured).
export SQUARE_CLIENT_ID=mock-square-client
export SQUARE_CLIENT_SECRET=mock-square-secret
export SQUARE_WEBHOOK_SIG_KEY=mock-square-sig-key
export SQUARE_ENV=sandbox
export CLOVER_CLIENT_ID=mock-clover-client
export CLOVER_CLIENT_SECRET=mock-clover-secret
export LIGHTSPEED_CLIENT_ID=mock-ls-client
export LIGHTSPEED_CLIENT_SECRET=mock-ls-secret
export SHOPIFY_CLIENT_ID=mock-shopify-client
export SHOPIFY_CLIENT_SECRET=mock-shopify-secret

# Dev-only base overrides → the local mock POS server.
export SQUARE_API_BASE=http://127.0.0.1:4545
export CLOVER_API_BASE=http://127.0.0.1:4545
export LIGHTSPEED_API_BASE=http://127.0.0.1:4545
export SHOPIFY_API_BASE=http://127.0.0.1:4545

# OAuth redirect + webhook notification URL derivation.
export PUBLIC_API_BASE_URL=http://localhost:8080
export WEB_PUBLIC_URL=http://localhost:3000
