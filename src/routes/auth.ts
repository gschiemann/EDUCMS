import { Router } from 'express';

const authRouter = Router();

// POST /api/v1/auth/login
authRouter.post('/login', (req, res) => {
  // Mock login handling
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Generate a mock JWT for the swagger spec
  const token = 'mock.jwt.token.rotation';
  return res.status(200).json({
    token,
    user: { email, role: 'ADMIN' },
    message: 'Login successful'
  });
});

export default authRouter;
