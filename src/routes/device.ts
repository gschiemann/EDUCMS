import { Router } from 'express';

export const deviceRouter = Router();

// GET /api/v1/device/sync
deviceRouter.get('/sync', (req, res) => {
  const etag = req.headers['if-none-match'];
  const currentManifestHash = 'v1.2.3';

  if (etag === currentManifestHash) {
    return res.status(304).send(); // Not Modified
  }

  res.status(200).json({
    version: currentManifestHash,
    assets: [],
    schedules: []
  });
});

// POST /api/v1/device/heartbeat
deviceRouter.post('/heartbeat', (req, res) => {
  res.status(200).json({ message: 'Successfully logged' });
});

export default deviceRouter;
