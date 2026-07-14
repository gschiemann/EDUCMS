import request from 'supertest';
const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';

describe('Device Provisioning & Revocation (E2E_SCENARIOS.md)', () => {

  it('Happy Path: Technician provisions Kiosk with valid 6-digit code', async () => {
    const res = await request(API_URL)
      .post('/api/v1/device/provision')
      .set('Authorization', 'Bearer MOCK_TECHNICIAN_TOKEN')
      .send({ pairingCode: '849201', location: 'Cafeteria' });
      
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('deviceToken');
    expect(res.body).toHaveProperty('deviceId');
  });

  it('Failure Path: Expired Pairing Code returns 400', async () => {
    const res = await request(API_URL)
      .post('/api/v1/device/provision')
      .set('Authorization', 'Bearer MOCK_TECHNICIAN_TOKEN')
      .send({ pairingCode: 'EXPIRED_CODE' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Code Expired');
  });

  it('Target Assertion: Ghost-Protection (Revoked Device Behavior returns 401)', async () => {
    // Simulating a device whose token has been revoked polling the DB
    const res = await request(API_URL)
      .get('/api/v1/device/sync')
      .set('Authorization', 'Bearer REVOKED_DEVICE_TOKEN');
      
    expect(res.status).toBe(401);
  });

});
