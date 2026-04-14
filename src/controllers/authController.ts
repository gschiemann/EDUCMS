import { Request, Response, Router } from 'express';
import { pool } from '../db/pool';
import * as argon2 from 'argon2';
import crypto from 'crypto';

export const authRouter = Router();

/**
 * POST /api/v1/auth/login
 * Validates user credentials using Argon2id against the Database to resist GPU cracking vectors.
 * Issues a cryptographically random session token (Stub for JWT) to comply with OPENAPI_SPEC.yaml.
 */
authRouter.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body; 

  try {
    // Parameterized DB fetch against the multi-tenant users table
    const userRes = await pool.query(
      `SELECT id, password_hash FROM users WHERE email = $1`,
      [username]
    );

    if (userRes.rowCount === 0) {
      // Intentionally ambiguous error response to prevent user enumeration
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { id, password_hash } = userRes.rows[0];

    // Perform Argon2 memory-hard algorithmic verification
    const valid = await argon2.verify(password_hash, password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Role mapping would typically be aggregated from the `memberships` table here.
    const sessionToken = crypto.randomBytes(32).toString('hex');
    
    // Log the active session in DB for strict invalidation capabilities (forced logout)
    await pool.query(
      `UPDATE users SET session_identifier = $1 WHERE id = $2`,
      [sessionToken, id]
    );

    return res.status(200).json({ sessionToken });
  } catch (error) {
    console.error('Authentication Execution Failure:', error);
    return res.status(500).json({ error: 'Internal Authentication Failure' });
  }
});
