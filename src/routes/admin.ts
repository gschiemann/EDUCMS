import { Router } from 'express';

export const adminRouter = Router();

// Used when AuthSession is fully wired. Let's just mock the HTTP layer for now per Gate 1.
// GET /api/v1/admin/schools
adminRouter.get('/schools', (req, res) => {
  res.status(200).json([
    { id: '1', name: 'Lincoln High', created_at: '2026-04-10T12:00:00Z' }
  ]);
});

// GET /api/v1/admin/users
adminRouter.get('/users', (req, res) => {
  res.status(200).json([
    { id: 'u1', email: 'teacher@lincoln.edu', role: 'TEACHER' },
    { id: 'u2', email: 'admin@district.edu', role: 'ADMIN' }
  ]);
});

// POST /api/v1/admin/users
adminRouter.post('/users', (req, res) => {
  res.status(201).json({ message: 'User created' });
});

// GET /api/v1/admin/audit
adminRouter.get('/audit', (req, res) => {
  res.status(200).json([
    { action: 'LOGIN', actor: 'teacher@lincoln.edu', timestamp: '2026-04-14T05:00:00Z' }
  ]);
});

export default adminRouter;
