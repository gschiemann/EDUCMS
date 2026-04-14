import { Request, Response, NextFunction } from 'express';

/**
 * RT-03 Mitigation: Stale Sessions After Role Downgrade.
 * Prevents active sessions from propagating commands if revoked globally.
 */

// Mock Redis client interface
interface MockRedis {
  sismember(key: string, value: string): Promise<number>;
}

const redis: MockRedis = {
  sismember: async () => 0 // Mock implementation
};

export const requireActiveSession = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Check global token blocklist for immediate revocation (RT-03)
    const isRevoked = await redis.sismember('jwt_revocation_list', token);
    
    if (isRevoked === 1) {
      console.warn(`[SEC] Denied access for revoked JWT: ${token}`);
      return res.status(401).json({ error: "Session revoked or role changed." });
    }

    // In a real app we'd jwt.verify() here.
    // Assuming passed:
    next();
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error verifying token." });
  }
};
