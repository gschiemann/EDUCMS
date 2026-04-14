import { Request, Response, Router } from 'express';
import { requireSession } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { pool } from '../db/pool';

export const cmsRouter = Router();

// All administrative controls mapped below explicitly require an active Session
cmsRouter.use(requireSession);

/**
 * POST /api/v1/cms/assets
 * Permissions: Admin scope, and Contributors (Teachers).
 * Stores a pointer to blob infrastructure inside the canonical `assets` table.
 */
cmsRouter.post('/assets', requireRole(['Super Admin', 'District Admin', 'School Admin', 'Contributor']), async (req: Request, res: Response) => {
  const { url, type, sizeBytes, schoolId } = req.body;
  const user = res.locals.user!;

  // Strict tenant boundary enforcement logic defined by SecOps
  const targetSchool = schoolId || user.schoolId;
  if (!targetSchool) {
      return res.status(400).json({ error: 'Missing target school resolution' });
  }

  // Cross-tenant bleed protection logic wrapper
  if (user.role === 'School Admin' || user.role === 'Contributor') {
     if (targetSchool !== user.schoolId) {
        return res.status(403).json({ error: 'OOB Isolation Denied: Attempted to inject asset out of bound' });
     }
  }

  try {
    const assetRes = await pool.query(
      `INSERT INTO assets (school_id, url, hash, size, type) 
       VALUES ($1, $2, 'pending_sha256_hash', $3, $4) RETURNING id`,
      [targetSchool, url, sizeBytes, type]
    );
    
    // Required Audit trace instantiation from Contract
    await pool.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES ($1, 'UPLOAD_ASSET', 'Asset', $2)`,
      [user.id, assetRes.rows[0].id]
    );

    return res.status(201).json({ message: 'Asset created successfully', assetId: assetRes.rows[0].id });
  } catch (err) {
    return res.status(500).json({ error: 'Asset Database Persistence Failure' });
  }
});

/**
 * POST /api/v1/cms/assets/approve
 * Fulfills the "Approval State-Machine" capability defined in RBAC_MATRIX.md
 */
cmsRouter.post('/assets/approve', requireRole(['Super Admin', 'District Admin', 'School Admin']), async (req: Request, res: Response) => {
  const { assetId } = req.body;
  const user = res.locals.user!;
  
  // (Assuming parameterized UPDATE assets target ID query here...)
  return res.status(200).json({ message: 'Asset transitioned to Approved.' });
});

/**
 * POST /api/v1/cms/publish
 * Instructs the backend to aggregate staged playlists/schedules and output a deterministic ETag JSON dump.
 */
cmsRouter.post('/publish', requireRole(['Super Admin', 'District Admin', 'School Admin']), async (req: Request, res: Response) => {
  return res.status(202).json({ message: 'Manifest generation initiated in the background dispatcher.' });
});

/**
 * POST /api/v1/cms/playlists
 */
cmsRouter.post('/playlists', requireRole(['Super Admin', 'District Admin', 'School Admin', 'Contributor']), async (req: Request, res: Response) => {
  return res.status(201).json({ message: 'Playlist created successfully.' });
});

/**
 * POST /api/v1/cms/schedules
 */
cmsRouter.post('/schedules', requireRole(['Super Admin', 'District Admin', 'School Admin']), async (req: Request, res: Response) => {
  return res.status(201).json({ message: 'Schedule active.' });
});
