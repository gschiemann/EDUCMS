import { gatewayClientIp, isGatewayControlPlanePath } from '../gatewayPaths';

/**
 * P0-1 — what the same-origin gateway is allowed to carry.
 *
 * This allowlist IS the security boundary of an unauthenticated proxy sitting
 * in front of the API. Two failure modes to pin forever:
 *   • too NARROW → a gateway device pairs but loses manifests/emergencies
 *     (worse than never pairing at all — the whole reason this is not a
 *     registration-only fix);
 *   • too WIDE → the dashboard/admin plane becomes proxyable from the web
 *     origin, and the API's own origin protections stop meaning anything.
 */
describe('isGatewayControlPlanePath — the player control plane IS carried', () => {
  const CARRIED = [
    // identity + pairing lifecycle
    '/api/v1/screens/register',
    '/api/v1/screens/status/test-fp-123',
    '/api/v1/screens/status/test-fp-123/ota-state',
    '/api/v1/screens/status/test-fp-123/crash-report',
    '/api/v1/screens/unpair/test-fp-123',
    // per-screen device plane
    '/api/v1/screens/scr_1/manifest',
    // 2026-09-02 — the cheap change detector the emergency backstop polls in
    // place of a full manifest fetch. Without it a gateway-only device falls
    // back to full manifest fetches forever.
    '/api/v1/screens/scr_1/emergency-rev',
    '/api/v1/screens/scr_1/cache-status',
    '/api/v1/screens/scr_1/render-proof',
    '/api/v1/screens/scr_1/emergency-assets',
    '/api/v1/screens/scr_1/display-capabilities',
    '/api/v1/screens/scr_1/stream-ticket',
    '/api/v1/screens/scr_1/orientation/device',
    // emergency reconcile
    '/api/v1/emergency/messages',
    '/api/v1/emergency/status',
    // realtime fallbacks + sync clock
    '/api/v1/realtime/sse',
    '/api/v1/realtime/poll',
    '/api/v1/realtime/time',
    // OTA metadata + diagnostics + liveness
    '/api/v1/player/update-check',
    '/api/v1/player/manager-update-check',
    '/api/v1/player/latest-version-public',
    '/api/v1/player-logs/scr_1',
    '/api/v1/notifications/help',
    '/api/v1/health',
    '/api/v1/health/ready',
    '/api/v1/health/emergency-path',
    // playback telemetry
    '/api/v1/analytics/touch-events',
    '/api/v1/templates/tpl_1/playback',
  ];

  it.each(CARRIED)('carries %s', (p) => {
    expect(isGatewayControlPlanePath(p)).toBe(true);
  });
});

describe('isGatewayControlPlanePath — everything else is REFUSED', () => {
  const REFUSED = [
    // admin / dashboard plane — must never be proxyable
    '/api/v1/auth/login',
    '/api/v1/users',
    '/api/v1/tenants/me',
    '/api/v1/billing/checkout',
    '/api/v1/ai/generate',
    '/api/v1/assets/upload',
    '/api/v1/emergency/trigger',
    '/api/v1/screens/scr_1/display-control',
    '/api/v1/screens/scr_1/revoke-credential',
    '/api/v1/screens/pair',
    '/api/v1/screens',
    '/api/v1/screens/fleet',
    // media + the URL fetcher — not control plane
    '/api/v1/proxy/web',
    '/api/v1/screens/scr_1/menu',
    // wrong prefix / shape
    '/api/v2/screens/register',
    '/api/v1',
    '/screens/register',
    '/api/cron/keepwarm',
    '',
    // traversal + encoded separators
    '/api/v1/screens/../auth/login',
    '/api/v1/screens/register/../../auth/login',
    '/api/v1/screens%2fregister',
    '/api/v1//screens/register',
    // nesting past an allowed prefix
    '/api/v1/screens/scr_1/manifest/extra',
    '/api/v1/screens/register/extra',
  ];

  it.each(REFUSED)('refuses %s', (p) => {
    expect(isGatewayControlPlanePath(p)).toBe(false);
  });

  it('refuses non-strings without throwing', () => {
    expect(isGatewayControlPlanePath(undefined)).toBe(false);
    expect(isGatewayControlPlanePath(null)).toBe(false);
    expect(isGatewayControlPlanePath(42)).toBe(false);
  });
});

describe('gatewayClientIp', () => {
  const get = (h: Record<string, string>) => (n: string) => h[n] ?? null;

  it('prefers the platform-set x-real-ip (not client-forgeable)', () => {
    expect(
      gatewayClientIp(get({ 'x-real-ip': '99.65.178.111', 'x-forwarded-for': '1.2.3.4' })),
    ).toBe('99.65.178.111');
  });

  it('falls back to x-vercel-forwarded-for, then the leftmost XFF entry', () => {
    expect(gatewayClientIp(get({ 'x-vercel-forwarded-for': '99.65.178.111, 10.0.0.1' }))).toBe(
      '99.65.178.111',
    );
    expect(gatewayClientIp(get({ 'x-forwarded-for': '99.65.178.111, 10.0.0.1' }))).toBe(
      '99.65.178.111',
    );
  });

  it('returns null when there is nothing to forward (the API then uses its own rule)', () => {
    expect(gatewayClientIp(get({}))).toBeNull();
    expect(gatewayClientIp(get({ 'x-forwarded-for': '' }))).toBeNull();
  });
});
