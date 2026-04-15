import { Injectable, CanActivate, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// -----------------------------------------------------------------
// DEPRECATED — DO NOT USE
// -----------------------------------------------------------------
// This barrel file contained a SECOND, competing auth system using
// Passport's AuthGuard('jwt') and a simple string-based RolesGuard.
//
// The canonical auth system is:
//   - JwtAuthGuard    → ./jwt-auth.guard.ts  (manual JWT verify + Redis revocation)
//   - RbacGuard       → ./rbac.guard.ts      (AppRole enum + tenant scoping)
//   - RequireRoles    → ./roles.decorator.ts  (decorator for AppRole-based access)
//
// If you're importing from this file, switch to the canonical imports:
//   import { JwtAuthGuard } from './jwt-auth.guard';
//   import { RbacGuard } from './rbac.guard';
//   import { RequireRoles } from './roles.decorator';
// -----------------------------------------------------------------

// Re-export canonical guards so existing imports don't break at runtime
export { JwtAuthGuard } from './jwt-auth.guard';
export { RbacGuard as RolesGuard } from './rbac.guard';
export { RequireRoles as Roles } from './roles.decorator';
