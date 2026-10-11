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
 * Customer-facing "fix proposed" notification — intentionally sends nothing
 * (2026-10-11): proposals are an internal review step. Never throws.
 */
export function notifyBugFixProposed(
  _prisma: PrismaService,
  _email: EmailService,
  logger: Logger,
  input: BugFixProposedNotifyInput,
): void {
  // A proposed fix is an INTERNAL review step (root cause, confidence, diff).
  // The reporting customer is told two things only: "we received your report"
  // (sendBugFiled) and "it's fixed" (sendBugFixShipped). Owner alerts for
  // proposals go through the SUPER_ADMIN paths, never this one. Kept as a
  // named no-op so both call sites stay identical and the intent is explicit.
  logger.debug(
    `[bug-email] fix proposed for ${input.bugId}: reporter not emailed (internal review step)`,
  );
}
