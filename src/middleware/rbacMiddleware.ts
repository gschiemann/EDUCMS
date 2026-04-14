import { Request, Response, NextFunction } from 'express';
import { Role } from '@cms/auth-core';

/**
 * Strict Multi-Tenant Enforcement.
 * Checks the active API session against the `RBAC_MATRIX.md` constraints.
 */
export const requireRole = (minimumRoles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user;
    if (!user) {
      return res.status(401).json({ error: 'User context not found' });
    }

    if (!minimumRoles.includes(user.role as Role)) {
      return res.status(403).json({ error: `Action strictly forbidden for role: ${user.role}` });
    }
    
    // Explicit tenant isolation mapping: BOLA Security Core
    // Extracts targets from standard REST conventions (/api/v1/schools/:schoolId/...)
    const targetSchoolId = req.params.schoolId || req.body.schoolId || req.query.schoolId;
    const targetDistrictId = req.params.districtId || req.body.districtId || req.query.districtId;

    if (user.role === 'School Admin' || user.role === 'Contributor') {
       if (targetDistrictId) {
         return res.status(403).json({ error: 'BOLA Violation: School-scoped accounts cannot manipulate district context.' });
       }
       if (targetSchoolId && targetSchoolId !== user.schoolId) {
         return res.status(403).json({ error: 'BOLA Violation: Cross-tenant school mutation explicitly denied.' });
       }
    }

    if (user.role === 'District Admin') {
       if (targetDistrictId && targetDistrictId !== user.districtId) {
         return res.status(403).json({ error: 'BOLA Violation: Cross-tenant district mutation explicitly denied.' });
       }
    }
    
    next();
  };
};
