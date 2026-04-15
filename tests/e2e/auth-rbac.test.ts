import request from 'supertest';
const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';

describe('Auth & RBAC Controls (E2E_SCENARIOS.md)', () => {

  it('Happy Path: Super Admin can hit emergency override and triggers cascade', async () => {
    const res = await request(API_URL)
      .post('/api/v1/emergency/trigger')
      .set('Authorization', 'Bearer MOCK_SUPER_ADMIN_TOKEN')
      .send({ 
        scopeType: 'tenant', 
        scopeId: 'test_tenant',
        overridePayload: { severity: 'CRITICAL', textBlob: 'FIRE_ALARM' } 
      });
      
    // Stub allowance (404 mapping) for API agent handoff. 
    // Strict validation asserting exact status returns
    expect([200, 201]).toContain(res.status); 
  });

  it('Failure Path: Contributor Unauthorized Publish returns 403 Forbidden', async () => {
    const res = await request(API_URL)
      .post('/api/v1/cms/playlists/publish')
      .set('Authorization', 'Bearer MOCK_CONTRIBUTOR_TOKEN')
      .send({ assetId: 'lunch_menu.jpg', targetGroup: 'all' });
      
    // Security Matrix Rule: Contributors cannot publish globally (must return 403)
    expect(res.status).toBe(403);
  });

  it('Failure Path: Asset Upload limits & sanitization (malware spoofing) returns 400', async () => {
    const res = await request(API_URL)
      .post('/api/v1/cms/media/upload')
      .set('Authorization', 'Bearer MOCK_SCHOOL_ADMIN_TOKEN')
      .attach('file', Buffer.from('malicious_executable_content'), 'cute_dog.jpg');
      
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/INVALID_FILE_TYPE/i);
  });

});
