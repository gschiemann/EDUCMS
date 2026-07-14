import request from 'supertest';
const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';

describe('All-Clear Restoration Tests (CHAOS_TEST_PLAN.md)', () => {

  it('Resolves emergencies and restores peace-time playback state within 10s', async () => {
    // 1. Enter emergency state
    const triggerRes = await request(API_URL).post('/api/v1/emergency/trigger')
      .set('Authorization', 'Bearer MOCK_ADMIN')
      .send({ scopeType: 'tenant', scopeId: 'test_tenant', overridePayload: { textBlob: 'FIRE_ALARM', severity: 'CRITICAL' } });

    let overrideId = triggerRes.body?.overrideId || triggerRes.body?.payload?.overrideId;

    // 2. Clear emergency state
    const start = Date.now();
    const res = await request(API_URL).post(`/api/v1/emergency/${overrideId}/all-clear`)
      .set('Authorization', 'Bearer MOCK_ADMIN')
      .send({ force: true });
    
    // Simulate HTTP polling fallback for devices that missed WebSockets
    const syncRes = await request(API_URL).get('/api/v1/device/sync')
      .set('Authorization', 'Bearer MOCK_DEVICE');

    const totalTimeMs = Date.now() - start;

    expect(res.status).toBe(200);
    
    // Verification: Fallback recovery indicates standard playlist is restored
    expect(syncRes.body.state).not.toBe('EMERGENCY');
    expect(syncRes.body.state).toBe('STANDARD_PLAYBACK');

    // Fleet must be able to poll resolution loop within `< 10 seconds` limit bounds
    expect(totalTimeMs).toBeLessThan(10000); 
  });

});
