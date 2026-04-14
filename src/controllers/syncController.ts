import { Request, Response, Router } from 'express';
import { requireDeviceAuth } from '../middleware/authMiddleware';
import { SyncManifest } from '../sync-protocol'; // Using the Orchestrator's exact schema
import { pool } from '../db/pool';

export const syncRouter = Router();

/**
 * GET /api/v1/device/sync
 * Securely distributes the mathematically correct Manifest to devices.
 * Requires `DeviceAuth` bearer token parsed via `requireDeviceAuth`.
 * Handles 304 ETag checking to prevent network starvation.
 */
syncRouter.get('/sync', requireDeviceAuth, async (req: Request, res: Response) => {
  const device = res.locals.device;
  const clientEtag = req.headers['if-none-match'];

  try {
    // 1. Parameterized SQL query ensuring no injection
    const dbRes = await pool.query(
      `SELECT version_hash, manifest_payload 
       FROM content_versions 
       WHERE school_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [device.schoolId]
    );

    if (dbRes.rowCount === 0) {
      return res.status(404).json({ error: 'No active payload assigned to this school boundary.' });
    }

    const { version_hash, manifest_payload } = dbRes.rows[0];

    // 2. Strict Offline Polling Rule: ETag Matching
    if (clientEtag === version_hash) {
      return res.status(304).send(); // Not Modified! Network conserved.
    }

    // 3. Return payload adhering to the Contract
    return res.setHeader('ETag', version_hash).json(manifest_payload);
    
  } catch (error) {
    console.error('Database Sync Error:', error);
    return res.status(500).json({ error: 'Internal Hardware Sync Failure' });
  }
});
