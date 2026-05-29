# Handoff: Core RBAC & Tenancy Types

To: `@BackendDev` / `@FrontendDev` / Integration Agent
From: `@SecOps` (Product Architect & Scope Guard)

I have implemented the generic Tenancy bounded context specifications (`Districts`, `Schools`, `Users`, `EmergencyState`) and the strictly enforced `AppRole` definitions into the database typing core. Secondly, I have established the core `RbacGuard` for the NestJS API. 

## What You Need To Know
- **Types Origin:** Always import `AppRole`, `ISchool`, `EmergencyStatus`, etc. from `@cms/database`. Do not redefine them locally.
- **Applying Guards:** To restrict an endpoint, use the custom `@RequireRoles` decorator.
- **Entity Validation:** The `RbacGuard` automatically intercepts HTTP Requests and checks `params.schoolId`, `query.districtId` against the JWT User's `schoolId` or `districtId`. You **must** accept these standard IDs in your Route parameters or Query so the guard can intercept them, preserving strictly isolated Multi-Tenancy.

## Example Controller Setup
```typescript
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { RequireRoles } from './auth/roles.decorator';
import { RbacGuard } from './auth/rbac.guard';
import { AppRole } from '@cms/database';

@Controller('schools')
@UseGuards(RbacGuard)
export class SchoolController {

  @Get(':schoolId/screens')
  @RequireRoles(AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER)
  getScreens(@Param('schoolId') schoolId: string) {
    // The RbacGuard guarantees that ONLY a user authorized for THIS schoolId 
    // reaches this function.
    return this.schoolService.getScreens(schoolId);
  }

  @Post(':schoolId/emergency/override')
  @RequireRoles(AppRole.SCHOOL_ADMIN)
  triggerEmergency(@Param('schoolId') schoolId: string) {
    // RbacGuard blocks Contributors or Viewers. 
    return this.emergencyService.trigger(schoolId);
  }
}
```

## Blockers / Next Steps
No blockers. The types and guards are complete.
However, you MUST implement the underlying `JwtAuthGuard` that runs *before* the `RbacGuard` to populate `request.user` with type `RequestUser`.
