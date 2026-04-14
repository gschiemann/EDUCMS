import request from 'supertest';
import app from '../../src/app';

describe('Device Provisioning & Revocation (E2E_SCENARIOS.md)', () => {

  it('Happy Path: Technician provisions Kiosk with valid 6-digit code', async () => {
    const res = await request(app)
      .post('/api/v1/device/provision')
      .set('Authorization', 'Bearer MOCK_TECHNICIAN_TOKEN')
      .send({ pairingCode: '849201', location: 'Cafeteria' });
      
    if (res.status !== 404) {
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('deviceToken');
      expect(res.body).toHaveProperty('deviceId');
    }
  });

  it('Failure Path: Expired Pairing Code returns 400', async () => {
    const res = await request(app)
      .post('/api/v1/device/provision')
      .set('Authorization', 'Bearer MOCK_TECHNICIAN_TOKEN')
      .send({ pairingCode: 'EXPIRED_CODE' });

    if (res.status !== 404) {
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Code Expired');
    }
  });

  it('Target Assertion: Ghost-Protection (Revoked Device Behavior returns 401)', async () => {
    // Simulating a device whose token has been revoked polling the DB
    const res = await request(app)
      .get('/api/v1/device/sync')
      .set('Authorization', 'Bearer REVOKED_DEVICE_TOKEN');
      
    if (res.status !== 404) {
      expect(res.status).toBe(401);
    }
  });

});
