"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const publishingService_1 = require("../src/services/publishingService");
const index_1 = __importDefault(require("../src/db/index"));
// Mock DB wrapper to test logic independently of DB state
jest.mock('../src/db/index', () => ({
    query: jest.fn(),
    logAuditAction: jest.fn()
}));
describe('Idempotent Publishing Workflow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('generates a deterministic manifest and strictly parameterizes data access', async () => {
        // Mock the schedules query result
        index_1.default.query.mockResolvedValueOnce({
            rows: [
                { assetUrl: 'https://cdn.example.com/asset-1.mp4', hash: 'abc123hash', duration: 15, position: 1 },
                { assetUrl: 'https://cdn.example.com/asset-2.jpg', hash: 'def456hash', duration: 5, position: 2 }
            ]
        });
        // Mock manifest insertion
        index_1.default.query.mockResolvedValueOnce({
            rowCount: 1,
            rows: [{ id: 'version-id' }]
        });
        const versionHash = await (0, publishingService_1.generateAndPublishManifest)('school-abc', 'group-xyz', 'user-123', '127.0.0.1');
        expect(index_1.default.query).toHaveBeenCalledTimes(2); // One read, one write
        // Validate Audits
        expect(index_1.default.logAuditAction).toHaveBeenCalledWith('user-123', 'PUBLISH_MANIFEST', 'screen_group', 'group-xyz', expect.any(Object), '127.0.0.1');
        expect(versionHash).toBeDefined();
        // Verify parameterization of schedule search enforced
        expect(index_1.default.query).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM schedules s'), ['group-xyz'] // No raw interpolated user strings!
        );
    });
});
