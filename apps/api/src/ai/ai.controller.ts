/**
 * AiController — REST surface for the AI content generator.
 *
 *   POST /api/v1/ai/generate
 *     body: { intent, context, tone?, count?, vertical? }
 *     returns: { options: [{ text }], intent }
 *
 * Sprint top-tier (2026-05-03). All ADMIN+ + CONTRIBUTOR — gated below
 * RESTRICTED_VIEWER so read-only roles can't burn AI budget.
 */

import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { AiService } from './ai.service';
import type { AiGenerateRequest } from './ai.service';

// Audit-W2 fix (2026-05-25) — was accepting raw @Body() with no
// runtime validation. A malformed `count: "abc"` reached
// Math.max(NaN, 1) → NaN, which then got interpolated as
// "Generate NaN distinct options" in the prompt. The FE clamps
// with Number.isFinite but the API is the boundary, not the FE.
//
// Bounds match the service's downstream clamps:
//   - intent: free-text but the service rejects unknown intents
//     via SYSTEM_PROMPTS lookup
//   - context: 1..2000 chars (service caps at 2000)
//   - tone: enum (service rejects unknown tones)
//   - count: 1..5 int (service clamps to same range; this just
//     rejects NaN / strings / negatives at the edge)
//   - vertical: 1..40 chars (service rejects via isVertical())
const AiGenerateSchema = z.object({
  intent: z.string().min(1).max(64),
  context: z.string().min(1).max(2000),
  tone: z.enum(['energetic', 'elegant', 'playful', 'serious', 'casual']).optional(),
  count: z.number().int().min(1).max(5).optional(),
  vertical: z.string().min(1).max(40).optional(),
}).passthrough();

// Slice 1d (2026-06-16) — inline text rewrite. Transforms ONE widget
// field's text. All bounds mirror the service's downstream validation
// (field-map allow-list, op-specific required params); this is the API
// boundary so a malformed body never reaches the model.
const AiRewriteSchema = z.object({
  widgetType: z.string().min(1).max(64),
  fieldKey: z.string().min(1).max(64),
  currentText: z.string().min(1).max(2000),
  op: z.enum(['rewrite', 'shorten', 'expand', 'fit_to_zone', 'punch', 'fix_grammar', 'translate', 'custom']),
  targetLang: z.string().max(40).optional(),
  instruction: z.string().max(400).optional(),
  zonePx: z.object({ w: z.number(), h: z.number() }).optional(),
  fontSize: z.number().optional(),
  vertical: z.string().min(1).max(40).optional(),
}).passthrough();
type AiRewriteBody = z.infer<typeof AiRewriteSchema>;

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('generate')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async generate(
    @Request() req: any,
    @Body(new ZodValidationPipe(AiGenerateSchema)) body: AiGenerateRequest,
  ) {
    return this.ai.generate({
      ...body,
      tenantId: req.user.tenantId,
      userId: req.user.id, // 2026-05-26 audit AI-P0-4 — required for AuditLog
    });
  }

  // Slice 1d (2026-06-16) — inline rewrite chips. Same roles as generate
  // (ADMIN+ + CONTRIBUTOR; below RESTRICTED_VIEWER). The service validates
  // the field against the shared TEXT_FIELDS map + sanitizes the output.
  @Post('text/rewrite')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async rewriteText(
    @Request() req: any,
    @Body(new ZodValidationPipe(AiRewriteSchema)) body: AiRewriteBody,
  ) {
    return this.ai.rewriteText({
      ...body,
      tenantId: req.user.tenantId,
      userId: req.user.id,
    });
  }
}
