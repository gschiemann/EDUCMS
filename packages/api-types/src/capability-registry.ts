/**
 * Capability Registry — the §21 "verification-before-claim" keystone.
 *
 * The 2026-07-12 world-class audit's linchpin finding (§21): "green CI can be
 * green without running, and product/help/marketing claims conflict with code."
 * The structural fix is ONE server-owned typed registry that every claim,
 * integration tile, and QA status resolves against — so a feature can never be
 * a "coming-soon wearing a real-button costume," and a VERIFIED capability can
 * never lack the evidence that proves it.
 *
 * This module is the registry + its typed contract. Its enforcing CONSUMER is
 * scripts/check-capability-registry.cjs (a CI gate) — without a consumer a
 * registry is just another dead catalog (the exact anti-pattern the audit flags
 * in the widget layer), so the gate is shipped WITH it.
 *
 * HONESTY RULE: a capability's `state` must reflect reality. VERIFIED /
 * PRODUCTION / HARDWARE_CERTIFIED REQUIRE a real `evidenceTest` (a spec path or
 * CI job that actually proves it). A `publicClaim` (customer-facing assertion)
 * is only allowed when the state is one a customer can rely on — never on
 * NOT_BUILT / EXPERIMENTAL / DEPRECATED / RETIRED. The gate enforces both.
 *
 * NEXT EXTENSION (documented, not yet built): scan public marketing/help
 * surfaces and fail CI when a shipped claim has no registered capability
 * (audit TRUTH-001). This registry is the substrate that makes that possible.
 */

/** Lifecycle state of a capability. Ordered least→most production-ready. */
export type CapabilityState =
  | 'NOT_BUILT' // does not exist; must never carry a publicClaim that says it works
  | 'INTERNAL' // exists for internal/testing use only
  | 'EXPERIMENTAL' // spike/prototype; not customer-relied-upon
  | 'BETA' // usable, limited, labeled Beta to customers
  | 'CONFIGURED' // wired up, but not proven by a real end-to-end operation
  | 'VERIFIED' // proven by an automated evidence test in CI
  | 'PRODUCTION' // VERIFIED + running in production with a live canary
  | 'HARDWARE_CERTIFIED' // proven on the physical target device/firmware
  | 'DEPRECATED' // still works but on a sunset path
  | 'RETIRED'; // removed / no longer works

/** States a customer may safely rely on — a publicClaim is only allowed here. */
export const CLAIMABLE_STATES: ReadonlySet<CapabilityState> = new Set([
  'BETA',
  'CONFIGURED',
  'VERIFIED',
  'PRODUCTION',
  'HARDWARE_CERTIFIED',
]);

/** States that REQUIRE a resolvable evidenceTest (they assert proven behavior). */
export const EVIDENCE_REQUIRED_STATES: ReadonlySet<CapabilityState> = new Set([
  'VERIFIED',
  'PRODUCTION',
  'HARDWARE_CERTIFIED',
]);

export interface Capability {
  /** kebab-case stable id. */
  id: string;
  name: string;
  domain: string;
  state: CapabilityState;
  /** Accountable owner (team/role). */
  owner: string;
  /** Where it surfaces (route, feature, integration). */
  surface: string;
  /** The customer-facing claim, if any. null = we make no public claim. */
  publicClaim: string | null;
  /** Repo-relative spec/test path OR a CI job name that proves the state.
   *  REQUIRED for VERIFIED/PRODUCTION/HARDWARE_CERTIFIED. */
  evidenceTest: string | null;
  /** ISO date the evidence last passed, or null. */
  verifiedAt: string | null;
  /** ISO expiry after which the evidence is considered stale, or null. */
  expiresAt: string | null;
  /** Honest limitations a reader must know. */
  limitations: string;
  /** Other capability ids this depends on. */
  dependsOn: string[];
}

/**
 * The registry. Seeded HONESTLY as of 2026-07-17 with what is actually true on
 * master — every VERIFIED entry points at a spec that exists and passes; every
 * unbuilt/deferred feature is stated as such with NO false publicClaim.
 */
export const CAPABILITY_REGISTRY: ReadonlyArray<Capability> = [
  // ── Verified this program (Wave-0 + launch-readiness) ──
  {
    id: 'pricing-plan-truth',
    name: 'Per-screen pricing is one source of truth',
    domain: 'billing',
    state: 'VERIFIED',
    owner: 'billing',
    surface: 'pricing page / signup / /license/tiers / billing UI / checkout',
    publicClaim: '$25 per screen / month, or $240 / screen / year ($20/mo effective).',
    evidenceTest: 'packages/api-types/src/billing.spec.ts',
    verifiedAt: '2026-07-16',
    expiresAt: null,
    limitations: 'Full PlanCatalog lifecycle (TRIALING→…→CANCELLED) + dunning is PLAN-001B, not yet built.',
    dependsOn: [],
  },
  {
    id: 'free-trial-14d-3screen',
    name: '14-day / 3-screen free trial',
    domain: 'billing',
    state: 'CONFIGURED',
    owner: 'billing',
    surface: 'signup / FREE_TRIAL tier',
    publicClaim: 'Free 14-day trial, up to 3 screens, no credit card.',
    evidenceTest: 'packages/api-types/src/billing.spec.ts',
    verifiedAt: '2026-07-16',
    limitations:
      'The no-license default seat ceiling is the env PILOT_SEAT_LIMIT (default 1000 for internal testing), NOT enforced at 3 until the PLAN-001A entitlement backfill lands. Set PILOT_SEAT_LIMIT=3 to enforce.',
    expiresAt: null,
    dependsOn: ['pricing-plan-truth'],
  },
  {
    id: 'emergency-signed-fanout-gate',
    name: 'Emergency messages HMAC-verified before Redis fan-out',
    domain: 'emergency',
    state: 'VERIFIED',
    owner: 'realtime/security',
    surface: 'emergency trigger/all-clear → Redis → WS/SSE → player',
    publicClaim: null,
    evidenceTest: 'apps/api/src/security/ws-signature.spec.ts',
    verifiedAt: '2026-07-16',
    expiresAt: null,
    limitations:
      'Server-side HMAC gate is the primary control. Player-side Ed25519 device verification (ControlEnvelopeV2, EVT-001) is the multi-week hardening, not yet built. NOT hardware-drilled on a physical fleet this cycle.',
    dependsOn: [],
  },
  {
    id: 'usb-offline-bundle-contract',
    name: 'USB export bundle matches the Android ingester contract',
    domain: 'storage',
    state: 'VERIFIED',
    owner: 'player/api',
    surface: 'usb-export → Android UsbIngester',
    publicClaim: null,
    evidenceTest: 'apps/api/src/usb-export/usb-bundle-contract.spec.ts',
    verifiedAt: '2026-07-16',
    expiresAt: null,
    limitations:
      'Contract + null-hash + per-screen emergency playlists verified in code. Android-side screen-binding/expiry enforcement + a physical device-lab ingest (AND-001) are NOT done.',
    dependsOn: [],
  },
  {
    id: 'ai-byok-no-silent-platform-spend',
    name: 'Unreadable BYOK key errors instead of silently spending platform credits',
    domain: 'ai',
    state: 'VERIFIED',
    owner: 'ai platform',
    surface: 'AI provider key resolution',
    publicClaim: null,
    evidenceTest: 'apps/api/src/ai/ai.service.spec.ts',
    verifiedAt: '2026-07-16',
    expiresAt: null,
    limitations:
      'Per-batch fan-out spend headroom is enforced; the atomic USD-micros cross-request reservation ledger (AI-003A/B) is NOT built.',
    dependsOn: [],
  },
  {
    id: 'boot-secret-validation',
    name: 'All load-bearing secrets validated at boot',
    domain: 'ops',
    state: 'VERIFIED',
    owner: 'platform',
    surface: 'API bootstrap',
    publicClaim: null,
    evidenceTest: 'apps/api/src/security/required-secret.spec.ts',
    verifiedAt: '2026-07-16',
    expiresAt: null,
    limitations: 'Sports feed secret ROTATION (W0-01) is a Railway env action, not code — still owner-pending.',
    dependsOn: [],
  },
  {
    id: 'oidc-multi-replica-login',
    name: 'OIDC SSO login survives a multi-replica callback',
    domain: 'auth',
    state: 'VERIFIED',
    owner: 'auth',
    surface: 'OIDC login/callback',
    publicClaim: null,
    evidenceTest: 'apps/api/src/sso/sso-oidc-state.spec.ts',
    verifiedAt: '2026-07-16',
    expiresAt: null,
    limitations: 'OIDC only. SAML is NOT built (see saml-sso). Needs a real Google/Entra/Okta test-tenant canary for PRODUCTION.',
    dependsOn: [],
  },
  {
    id: 'sse-revocation-recheck',
    name: 'Open SSE emergency stream closes on device-token revocation',
    domain: 'realtime',
    state: 'VERIFIED',
    owner: 'realtime',
    surface: 'SSE stream',
    publicClaim: null,
    evidenceTest: 'apps/api/src/realtime/sse.service.spec.ts',
    verifiedAt: '2026-07-16',
    expiresAt: null,
    limitations: 'Re-check is ~30s, fail-open on transient Redis error (never drops a live emergency stream on a blip).',
    dependsOn: [],
  },
  {
    id: 'template-quarantine',
    name: 'Broken / demo / licensing-risk templates are quarantined from the gallery',
    domain: 'templates',
    state: 'VERIFIED',
    owner: 'design system',
    surface: 'template gallery / builder picker / homepage / from-preset clone',
    publicClaim: null,
    evidenceTest: 'apps/api/src/templates/template-quarantine.spec.ts',
    verifiedAt: '2026-07-16',
    expiresAt: null,
    limitations: 'Interim hardcoded denylist. The full TemplateRelease approval pipeline (TPL-002) is NOT built.',
    dependsOn: [],
  },
  {
    id: 'tenant-isolation-static-gate',
    name: 'No new unscoped bare-id access to tenant-owned data',
    domain: 'security',
    state: 'VERIFIED',
    owner: 'backend security',
    surface: 'CI (Tenant Isolation workflow)',
    publicClaim: null,
    evidenceTest: 'apps/api/src/security/tenant-isolation-gate.spec.ts',
    verifiedAt: '2026-07-17',
    expiresAt: null,
    limitations:
      'Static gate over a 214-site ratchet-down baseline; blocks NEW leaks. Deny-by-default typed-tenant-repository migration (TEN-001 full) that burns the baseline to zero is NOT built.',
    dependsOn: [],
  },
  {
    id: 'ai-model-retirement-gate',
    name: 'CI warns before a shipped AI model retires; no dead default models',
    domain: 'ai',
    state: 'VERIFIED',
    owner: 'ai platform',
    surface: 'CI (model-retirement check)',
    publicClaim: null,
    evidenceTest: 'apps/api/tools/check-model-retirements.cjs',
    verifiedAt: '2026-07-16',
    expiresAt: null,
    limitations: 'Proves a KNOWN-retired id was removed; cannot prove a new id is GA — a live per-provider canary is still owed.',
    dependsOn: [],
  },
  {
    id: 'dependency-advisory-gate',
    name: 'Production dependency graph has no HIGH/CRITICAL advisories',
    domain: 'ops',
    state: 'VERIFIED',
    owner: 'platform',
    surface: 'CI (Production Dependency Audit)',
    publicClaim: null,
    evidenceTest: 'scripts/npm-advisory-audit.cjs',
    verifiedAt: '2026-07-16',
    expiresAt: null,
    limitations: 'Prod-closure via pnpm ls --prod → npm bulk advisory endpoint (the legacy pnpm-audit endpoint was retired).',
    dependsOn: [],
  },
  {
    id: 'taurus-chromium83-safety',
    name: 'No new Chromium-83-forbidden CSS in player/widget surfaces',
    domain: 'cross-browser',
    state: 'VERIFIED',
    owner: 'frontend/player',
    surface: 'CI (Taurus Safety)',
    publicClaim: null,
    evidenceTest: 'apps/web/tools/check-taurus-safety.cjs',
    verifiedAt: '2026-07-17',
    expiresAt: null,
    limitations: 'Static scan + inset-serialization AST guard. No exact Chromium-83 or physical Taurus runtime in CI (BROW-001).',
    dependsOn: [],
  },

  {
    id: 'audit-log-append-only',
    name: 'Audit history is append-only at the storage layer (UPDATE/DELETE/TRUNCATE blocked)',
    domain: 'forensics',
    state: 'VERIFIED',
    owner: 'security/backend',
    surface: 'audit_logs DB triggers',
    publicClaim: null,
    evidenceTest: 'apps/api/src/security/audit-immutability.spec.ts',
    verifiedAt: '2026-07-17',
    expiresAt: null,
    limitations:
      'Row trigger blocks UPDATE/DELETE (permitting only FK user-id anonymization); statement trigger blocks TRUNCATE. Behaviorally proven on real Postgres 16 (docker) and re-applied on every deploy via prisma migrate deploy. The API DB-role privilege restriction (INSERT/SELECT-only) + WORM export are the remaining §16 hardening, not done.',
    dependsOn: [],
  },

  // ── Honestly NOT verified / not built — NO false publicClaim ──
  {
    id: 'saml-sso',
    name: 'SAML single sign-on',
    domain: 'auth',
    state: 'NOT_BUILT',
    owner: 'auth',
    surface: 'SSO',
    publicClaim: null, // MUST stay null until built — marketing must not claim SAML
    evidenceTest: null,
    verifiedAt: null,
    expiresAt: null,
    limitations:
      'passport-saml was removed (CVE-2025-54419); SSO endpoints fail closed. Ship/defer/remove is a Greg ADR (Non-delegable Definition of Ready). OIDC (Google/Microsoft/Okta) genuinely works — see oidc-multi-replica-login.',
    dependsOn: [],
  },
  {
    id: 'google-byok-image-gen',
    name: 'Google BYOK AI image generation',
    domain: 'ai',
    state: 'DEPRECATED',
    owner: 'ai platform',
    surface: 'AI image (Google provider, tenant BYOK key)',
    publicClaim: null,
    evidenceTest: null,
    verifiedAt: null,
    expiresAt: '2026-08-17', // imagen-4.0-generate-001 shutdown
    limitations:
      'Runs on imagen-4.0-generate-001, which Google shuts down 2026-08-17. Migration to gemini-3.1-flash-image is code-drafted but NOT live-verified; must land + be canary-tested before the shutdown. BYOK only (no platform spend).',
    dependsOn: [],
  },
  {
    id: 'authed-axe-a11y',
    name: 'Authenticated accessibility (axe) coverage',
    domain: 'accessibility',
    state: 'CONFIGURED',
    owner: 'frontend/QA',
    surface: 'CI (Accessibility axe-core)',
    publicClaim: null,
    evidenceTest: null, // runs unauthenticated shells today — cannot claim VERIFIED
    verifiedAt: null,
    expiresAt: null,
    limitations:
      'axe currently scans mostly unauthenticated shells; authed dashboard/builder/emergency routes + the 221-error jsx-a11y backlog are A11Y-001, not done.',
    dependsOn: [],
  },
  {
    id: 'sports-hardware-console',
    name: 'Daktronics / CTS hardware scoreboard ingest',
    domain: 'sports',
    state: 'EXPERIMENTAL',
    owner: 'sports/partnerships',
    surface: 'console bridge',
    publicClaim: null,
    evidenceTest: null,
    verifiedAt: null,
    expiresAt: null,
    limitations:
      'Generic HMAC feed is the only end-to-end path. Daktronics is provisional; CTS water-polo strongest. NO physical hardware certification (SPT-001/003). Do not market any console as "certified."',
    dependsOn: [],
  },
];
