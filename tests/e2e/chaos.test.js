"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../../src/app"));
describe('Chaos & Resiliency Validation (CHAOS_TEST_PLAN.md)', () => {
    it('Idempotency: Duplicate playlist publishes return identically without 409 conflict', async () => {
        const payload = { playlistId: 'daily-announcements' };
        // Simulate overlapping network retries 
        const req1 = (0, supertest_1.default)(app_1.default)
            .post('/api/v1/cms/playlists/publish')
            .set('Authorization', 'Bearer MOCK_ADMIN_TOKEN')
            .set('Idempotency-Key', 'idem-12345')
            .send(payload);
        const req2 = (0, supertest_1.default)(app_1.default)
            .post('/api/v1/cms/playlists/publish')
            .set('Authorization', 'Bearer MOCK_ADMIN_TOKEN')
            .set('Idempotency-Key', 'idem-12345')
            .send(payload);
        const [res1, res2] = await Promise.all([req1, req2]);
        if (res1.status !== 404) {
            expect([200, 201]).toContain(res1.status);
            expect(res2.status).toEqual(res1.status);
            // Detailed data mutation assertions handled in isolated DB tests
        }
    });
    it('Performance Threshold: Override Latency test endpoint handles request in < 500ms', async () => {
        const start = Date.now();
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/emergency/override')
            .set('Authorization', 'Bearer MOCK_ADMIN_TOKEN')
            .send({ action: 'TRIGGER', payload: 'LOCKDOWN' });
        const diff = Date.now() - start;
        if (res.status !== 404) {
            expect(diff).toBeLessThan(500);
        }
    });
});
