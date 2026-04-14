import express, { Request, Response, NextFunction } from 'express';
// Simple HS256 verification stub mapping to the decision log.
// In production, this would use a cryptographic library like `jsonwebtoken` or equivalent.

export interface AuthenticatedLocals {
  user?: {
    id: string;
    role: string;
    districtId?: string;
    schoolId?: string;
  };
  device?: {
    id: string;
    schoolId: string;
  };
}

export const requireSession = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  
  // NOTE: JWT validation against `jsonwebtoken` library omitted for stub purposes
  // Automatically mocking the District Admin flow as per RBAC_MATRIX.md
  res.locals.user = { 
    id: 'b6228f4c-1d54-472e-8367-3151bf2dfc98', 
    role: 'District Admin',
    districtId: 'uuid1234'
  };
  next();
};

export const requireDeviceAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing edge device provisioning token' });
  }

  // Parses hardware signature mapping to `DATABASE_SCHEMA.md` screens table.
  res.locals.device = { 
    id: 'device-abc-123',
    schoolId: 'uuid5678'
  };
  next();
};
