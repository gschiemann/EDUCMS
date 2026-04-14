import { Router, Request, Response } from 'express';
import db from '../db/index';

export const deviceRouter = Router();

/**
 * Idempotent Device Sync Endpoint
 * Compares current device hash via If-None-Match ETag header against active snapshot.
 */
deviceRouter.get('/sync', async (req: Request, res: Response): Promise<void> => {
  const activeDeviceHash = req.headers['if-none-match'];
  const deviceToken = req.headers['authorization']?.split('Bearer ')[1];

  if (!deviceToken) {
    res.status(401).json({ error: 'Missing Device Token' });
    return;
  }

  try {
    // Authenticate device token cleanly using parameterization
    const authQuery = `
      SELECT id, screen_group_id, school_id 
      FROM screens 
      WHERE device_token = $1 AND status != 'revoked'
    `;
    const authResult = await db.query(authQuery, [deviceToken]);
    
    if (authResult.rowCount === 0) {
      res.status(403).json({ error: 'Invalid or Revoked Device Token' });
      return;
    }

    const screen = authResult.rows![0];

    // Check for emergency overrides FIRST. These preempt the normal state machine.
    const emergencyQuery = `
      SELECT payload FROM emergency_override_state
      WHERE (school_id = $1 OR district_id = (SELECT district_id FROM schools WHERE id = $1))
      AND active = true
      LIMIT 1
    `;
    const emergencyResult = await db.query(emergencyQuery, [screen.school_id]);

    if (emergencyResult.rowCount && emergencyResult.rowCount > 0 && emergencyResult.rows![0]) {
       // Return immediately with override, skipping caching mechanisms
       res.status(200).json({ override: emergencyResult.rows![0].payload });
       return;
    }

    // Identifies current published manifest
    const manifestQuery = `
      SELECT version_hash, manifest_payload 
      FROM content_versions 
      WHERE school_id = $1 
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    const manifestResult = await db.query(manifestQuery, [screen.school_id]);

    if (!manifestResult.rowCount || manifestResult.rowCount === 0) {
      res.status(404).json({ error: 'No active content' });
      return;
    }

    const { version_hash, manifest_payload } = manifestResult.rows![0];

    // ETag caching layer Implementation
    res.setHeader('ETag', version_hash);
    if (activeDeviceHash === version_hash) {
       res.status(304).send(); // Not Modified - Player can continue serving from local disk cache
       return;
    }

    // Provide the new payload for atomic swap caching
    res.status(200).json(manifest_payload);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
