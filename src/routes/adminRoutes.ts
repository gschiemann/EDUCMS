import { Router, Request, Response } from 'express';
import db from '../db/index';
import { requireAuth } from '../middleware/auth';

export const adminRouter = Router();

adminRouter.use(requireAuth);

adminRouter.get('/schools', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    
    // In a full implementation, this maps tightly to `memberships` table for scope filtering.
    // For now, implementing the core skeleton.
    const query = `
      SELECT s.id, s.name, s.district_id 
      FROM schools s
      JOIN memberships m ON m.school_id = s.id OR m.district_id = s.district_id
      WHERE m.user_id = $1
    `;
    
    const result = await db.query(query, [user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch schools' });
  }
});
