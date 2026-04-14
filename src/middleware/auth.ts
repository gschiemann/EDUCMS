import { Request, Response, NextFunction } from 'express';
import db from '../db/index';

/**
 * Standard Auth Middleware enforcing Session Identifier validation.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const sessionIdentifier = authHeader.split(' ')[1];

  try {
    // Look up the user strictly by their rotated session_identifier
    const userQuery = `
      SELECT id, email 
      FROM users 
      WHERE session_identifier = $1
    `;
    const result = await db.query(userQuery, [sessionIdentifier]);

    if (result.rowCount === 0) {
      res.status(403).json({ error: 'Invalid or expired session' });
      return;
    }

    // Attach user context for downstream handlers and audit logging
    (req as any).user = result.rows![0];
    next();
  } catch (error) {
    console.error('Auth verification error:', error);
    res.status(500).json({ error: 'Internal Server Error during auth' });
  }
}
