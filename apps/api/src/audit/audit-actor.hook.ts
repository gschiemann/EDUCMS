/**
 * Arms the `AuditLog.apiKeyId` Prisma middleware at boot.
 * ACC-06 follow-up, 2026-08-03.
 *
 * Lives as its own provider rather than inside `PrismaService` so the
 * attribution feature owns its own wiring: `PrismaService` already arms the
 * manifest content-rev hook, and stacking unrelated concerns in one
 * `onModuleInit` is how that file grows a second reason to change.
 *
 * Registered from `ApiKeysModule`, which is already `@Global`, so no
 * `app.module.ts` edit is needed.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { armAuditActorPrismaHook } from './audit-actor';

@Injectable()
export class AuditActorPrismaHook implements OnModuleInit {
  private readonly logger = new Logger(AuditActorPrismaHook.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // Never throw at boot for this: losing the hook costs forensic DETAIL on
    // api-key-driven action rows (they go back to anonymous, as they were
    // before 2026-08-03), and the guard's own API_KEY_REQUEST row still names
    // the key. It is not worth a crashloop.
    try {
      if (armAuditActorPrismaHook(this.prisma?.client)) {
        this.logger.log('Audit-actor hook armed — API-key actions stamp AuditLog.apiKeyId');
      } else {
        this.logger.warn(
          'Audit-actor hook NOT armed (no $use on this Prisma client) — API-key action rows ' +
            'stay anonymous; correlate via the guard API_KEY_REQUEST rows instead.',
        );
      }
    } catch (e) {
      this.logger.warn(
        `Audit-actor hook failed to arm: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}
