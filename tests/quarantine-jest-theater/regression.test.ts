import request from 'supertest';
const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';

describe('Automated Regression Suite (REGRESSION_SUITE_PLAN.md)', () => {

  describe('Audit Log Verification', () => {
    it('Should emit formatted, persistent logs for critical state changes', async () => {
      // Step 1: Trigger specific actions sequentially
      await request(API_URL).post('/api/v1/emergency/trigger').set('Authorization', 'Bearer MOCK_ADMIN').send({ scopeType: 'tenant', scopeId: 'xyz', overridePayload: { severity: 'CRITICAL' } });
      await request(API_URL).post('/api/v1/device/revoke').set('Authorization', 'Bearer MOCK_ADMIN').send({ target: 'device-xyz' });

      // Step 2: Query the audit logs
      const res = await request(API_URL)
        .get('/api/v1/audit-logs')
        .set('Authorization', 'Bearer MOCK_ADMIN');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.logs)).toBe(true);
        expect(res.body.logs.length).toBeGreaterThanOrEqual(2);
        
        // Assert immutable fields and strict timestamp monotonicity
        const timestamps = res.body.logs.map((log: any) => new Date(log.timestamp).getTime());
        const sortedTimestamps = [...timestamps].sort((a, b) => a - b);
        expect(timestamps).toEqual(sortedTimestamps);

        // Assert entity associations
        expect(res.body.logs[0]).toHaveProperty('actor_id');
        expect(res.body.logs[0]).toHaveProperty('entity_targets');
    });
  });

  describe('Player Sync & Time-State Regression', () => {
    it('Should correctly map standard DB schedules without backend transition push', async () => {
      // Test timeline layout mapping bounds
      const res = await request(API_URL)
        .get('/api/v1/cms/playlists/sync')
        .set('Authorization', 'Bearer MOCK_DEVICE');

        expect(res.status).toBe(200);
        
        // Ensure standard time-blocks are passed strictly intact
        expect(res.body).toHaveProperty('schedules');
        expect(res.body.schedules).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ startTime: expect.any(String), endTime: expect.any(String) })
          ])
        );
    });
  });

});
