"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sync_protocol_1 = require("../src/sync-protocol");
const vitest_1 = require("vitest");
(0, vitest_1.describe)('Orchestrator: Sync Protocol Enforcement Validation', () => {
    (0, vitest_1.it)('should validate and parse a securely formed and correct manifest', () => {
        const valid = {
            versionHash: 'abc123hash-v2.1',
            deviceId: '123e4567-e89b-12d3-a456-426614174000',
            assets: [{
                    id: '123e4567-e89b-12d3-a456-426614174001',
                    url: 'https://cdn.school-signage.com/signed-asset-url',
                    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                    type: 'video',
                    sizeBytes: 10485760
                }],
            schedule: [{
                    playlistId: '123e4567-e89b-12d3-a456-426614174002',
                    cronSchedule: '*/15 * * * *',
                    priority: 10
                }],
            settings: { brightness: 100 }
        };
        (0, vitest_1.expect)(() => (0, sync_protocol_1.validateManifest)(valid)).not.toThrow();
    });
    (0, vitest_1.it)('should securely reject manifests with unsafe asset configurations (e.g., bad SHA-256 lengths)', () => {
        const invalidAsset = {
            versionHash: 'corrupted-manifest',
            deviceId: '123e4567-e89b-12d3-a456-426614174000',
            assets: [{
                    id: '123e4567-e89b-12d3-a456-426614174003',
                    url: 'https://cdn.school-signage.com/bad-asset',
                    sha256: 'corrupted-short-hash', // INVALID: not 64 length
                    type: 'video',
                    sizeBytes: 10
                }],
            schedule: [],
            settings: {}
        };
        (0, vitest_1.expect)(() => (0, sync_protocol_1.validateManifest)(invalidAsset)).toThrowError(/Strict SHA-256 string validation required/);
    });
    // E2E Integration Suite has been unblocked and moved down the pipeline to e2e-orchestrator.spec.ts
});
