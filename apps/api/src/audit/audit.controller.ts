import { Controller, Get } from '@nestjs/common';
import { AuditLogEntry } from '@cms/api-types';

@Controller('api/v1/admin/audit')
export class AuditController {
  @Get()
  getRecentActivity(): AuditLogEntry[] {
    return [
      {
        id: "aud_01",
        action: "Playlist Updated",
        actorId: "usr_skinner",
        subjectId: "Springfield High - Assembly",
        ipAddress: "192.168.1.50",
        timestamp: new Date().toISOString(),
        diff: { status: "ACTIVE" }
      },
      {
        id: "aud_02",
        action: "Emergency Clear",
        actorId: "usr_chalmers",
        subjectId: "District Wide",
        ipAddress: "10.0.0.1",
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        diff: null
      }
    ];
  }
}
