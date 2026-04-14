import { Router, Request, Response } from 'express';
import { generateAndPublishManifest } from '../services/publishingService';
import { requireAuth } from '../middleware/auth';

export const cmsRouter = Router();

cmsRouter.use(requireAuth);

cmsRouter.post('/publish', async (req: Request, res: Response): Promise<void> => {
  const { schoolId, screenGroupId } = req.body;
  const user = (req as any).user;
  const ipAddress = req.ip || req.connection.remoteAddress || '127.0.0.1';

  try {
    const versionHash = await generateAndPublishManifest(schoolId, screenGroupId, user.id, ipAddress);
    res.status(202).json({ 
      message: 'Publishing snapshot successful', 
      versionHash 
    });
  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({ error: 'Failed to publish manifest' });
  }
});
