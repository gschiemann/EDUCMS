import { test, expect } from './fixtures';

/**
 * health-endpoints.spec.ts — Verify API health probes return 200.
 *
 * These are pure HTTP tests — no DB seed required.
 * The /ready and /emergency-path endpoints may return 503 if DB is down;
 * we accept 200 or 503, but never a 5xx crash (500).
 */

test.describe('Health endpoints', () => {
  test('GET /api/v1/health returns 200', async ({ page }) => {
    const res = await page.request.get('http://localhost:8080/api/v1/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('uptime_s');
  });

  test('GET /api/v1/health/ready returns 200 or 503 (not 500)', async ({ page }) => {
    const res = await page.request.get('http://localhost:8080/api/v1/health/ready');
    // 200 = healthy, 503 = DB down but endpoint itself is alive — both are acceptable
    expect([200, 503]).toContain(res.status());
  });

  test('GET /api/v1/health/emergency-path returns 200 or 503 (not 500)', async ({ page }) => {
    const res = await page.request.get('http://localhost:8080/api/v1/health/emergency-path');
    // 200 = fully healthy, 503 = degraded but alive
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('checks');
  });

  test('health response body has expected shape', async ({ page }) => {
    const res = await page.request.get('http://localhost:8080/api/v1/health');
    expect(res.status()).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.status).toBe('string');
    expect(typeof body.uptime_s).toBe('number');
    expect(typeof body.ts).toBe('string');
  });
});
