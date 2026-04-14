import request from 'supertest';
import { app } from '../../src/app';

// Mocking the database pool for test encapsulation
jest.mock('../../src/db/pool', () => ({
  pool: {
    query: jest.fn()
  }
}));

import { pool } from '../../src/db/pool';

describe('Phase 2 API: Device Sync Operations', () => {

  it('rejects unauthenticated requests lacking a DeviceAuth token', async () => {
    const res = await request(app).get('/api/v1/device/sync');
    expect(res.status).toBe(401);
  });

  it('returns 304 Not Modified if the hardware already has the latest ETag', async () => {
    // Mock the DB returning the current hash
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ version_hash: 'hash-version-1', manifest_payload: {} }]
    });

    const res = await request(app)
      .get('/api/v1/device/sync')
      .set('Authorization', 'Bearer valid_crypto_device_token')
      .set('If-None-Match', 'hash-version-1');

    expect(res.status).toBe(304);
  });

  it('returns a full 200 JSON payload if the hardware needs an update', async () => {
    const mockManifest = { 
       versionHash: 'hash-version-2', 
       deviceId: 'mock', 
       assets: [], 
       schedule: [], 
       settings: {} 
    };

    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ version_hash: 'hash-version-2', manifest_payload: mockManifest }]
    });

    const res = await request(app)
      .get('/api/v1/device/sync')
      .set('Authorization', 'Bearer valid_crypto_device_token')
      .set('If-None-Match', 'hash-version-1'); // Old hash mapping

    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe('hash-version-2');
    expect(res.body.versionHash).toBe('hash-version-2');
  });
});
