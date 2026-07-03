/**
 * bug-notify.ts — shared "fix proposed" email trigger.
 *
 * Extracted 2026-07-03 (email-fix #4) so both notification call sites
 * — the manual chat-writeback endpoint (BugsController.writeback, ~line
 * 875 previously) and the automatic AI-analysis path
 * (BugAnalyzerService.analyze) — send the exact same email with the
 * exact same recipient-lookup logic instead of drifting apart.
 *
 * Always fire-and-forget: callers MUST NOT await this in a way that can
 * fail their primary flow. `notifyBugFixProposed` itself never throws —
 * every failure path (missing reporter, lookup failure, send failure)
 * is caught and logged internally.
 */
import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { EmailService } from '../email/email.service';

export interface BugFixProposedNotifyInput {
  bugId: string;
  /** Bug.userId — the original reporter, NOT the admin who may have
   *  triggered a re-analysis or written back a fix via chat. */
  reporterUserId: string | null;
  rootCause: string;
  confidence: number;
  filesAffectedCount: number;
}

/**
 * Look up the reporter's email from their user row and send the
 * "fix proposed" notification. Fire-and-forget by design — never
 * awaited by callers in a way that can fail the caller's primary
 * operation (persisting the PROPOSED status). Swallows every error
 * itself (lookup failure, missing email, send failure) and logs via
 * the caller's Logger instance.
 */
export function notifyBugFixProposed(
  prisma: PrismaService,
  email: EmailService,
  logger: Logger,
  input: BugFixProposedNotifyInput,
): void {
  if (!input.reporterUserId) return;
  prisma.client.user
    .findUnique({ where: { id: input.reporterUserId }, select: { email: true } })
    .then((reporter) => {
      if (!reporter?.email) return;
      return email.sendBugFixProposed({
        to: reporter.email,
        bugId: input.bugId,
        rootCause: input.rootCause,
        confidence: input.confidence,
        filesAffectedCount: input.filesAffectedCount,
      });
    })
    .catch((e: any) =>
      logger.warn(
        `[bug-email] sendBugFixProposed(${input.bugId}) failed: ${e?.message ?? e}`,
      ),
    );
}
