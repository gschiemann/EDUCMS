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

import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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

// Slice 2a (2026-06-16) — chat-to-edit. NL instruction + the selected
// zones' current state → a validated field-mutation diff. The model output
// is re-validated server-side (validateChatEditDiff), so this schema only
// bounds the inputs (cap the zones array so a tampered client can't DoS).
const AiChatEditSchema = z.object({
  instruction: z.string().min(1).max(500),
  zones: z.array(z.object({
    id: z.string().min(1).max(128),
    widgetType: z.string().min(1).max(64),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    zIndex: z.number().optional(),
    defaultConfig: z.record(z.string(), z.any()).optional(),
    // Packaged EXTERNAL_HTML boards (B11 fix): the FE sends the board's
    // parsed [data-field] inventory so chat can target its copy. The service
    // re-normalizes (normalizeChatFields) — this only bounds the shape.
    chatFields: z.array(z.object({
      key: z.string().min(1).max(64),
      label: z.string().max(80).optional(),
      value: z.string().max(400).optional(),
    })).max(48).optional(),
  }).passthrough()).min(1).max(12),
  vertical: z.string().min(1).max(40).optional(),
}).passthrough();
type AiChatEditBody = z.infer<typeof AiChatEditSchema>;

// Whole-board TRANSLATE (2026-07-05) — localize every text element in one
// click. The service re-validates the model output through the chat-edit
// security spine (validateChatEditDiff) and strips to text-only, so this
// schema only bounds inputs: a language code + the board's zones (cap 40 so a
// tampered client can't DoS the provider).
const AiTranslateSchema = z.object({
  targetLang: z.string().min(2).max(10),
  zones: z.array(z.object({
    id: z.string().min(1).max(128),
    widgetType: z.string().min(1).max(64),
    defaultConfig: z.record(z.string(), z.any()).optional(),
  }).passthrough()).min(1).max(40),
  vertical: z.string().min(1).max(40).optional(),
}).passthrough();
type AiTranslateBody = z.infer<typeof AiTranslateSchema>;

// 2026-06-26 — AI image generation. The prompt drives a paid image-model
// call (~$0.04+/image), so the API boundary caps it tight: non-empty,
// ≤1000 chars, and a fixed orientation enum the service re-validates.
const AiImageSchema = z.object({
  prompt: z.string().min(1).max(1000),
  size: z.enum(['1024x1024', '1792x1024', '1024x1792']).optional(),
}).passthrough();
type AiImageBody = z.infer<typeof AiImageSchema>;

// Wave B / editor-crush B1 (2026-07-02) — rehost a Pexels URL the operator
// picked in the "Stock photos" tab into our own Supabase bucket. The
// service re-validates the URL is actually on the trusted Pexels host
// (isRehostablePexelsUrl) before ever fetching it — this schema just bounds
// the shape at the API edge.
const AiStockRehostSchema = z.object({
  url: z.string().min(1).max(2000),
}).passthrough();
type AiStockRehostBody = z.infer<typeof AiStockRehostSchema>;

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

  // Slice 2a (2026-06-16) — chat-to-edit. Returns a server-validated diff;
  // the FE shows a review card and applies it as one undoable commit.
  @Post('edit/resolve')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async resolveChatEdit(
    @Request() req: any,
    @Body(new ZodValidationPipe(AiChatEditSchema)) body: AiChatEditBody,
  ) {
    return this.ai.resolveChatEdit({
      ...body,
      tenantId: req.user.tenantId,
      userId: req.user.id,
    });
  }

  // Whole-board TRANSLATE (2026-07-05) — one click localizes every text
  // element. Returns a server-validated, TEXT-ONLY diff the FE applies as one
  // undoable commit. Same roles as chat-edit.
  @Post('translate')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async translateBoard(
    @Request() req: any,
    @Body(new ZodValidationPipe(AiTranslateSchema)) body: AiTranslateBody,
  ) {
    return this.ai.translateBoard({
      ...body,
      tenantId: req.user.tenantId,
      userId: req.user.id,
    });
  }

  // 2026-06-26 — AI image generation. Type a prompt → get a custom,
  // on-brand image saved to the asset library. Same roles as generate
  // (ADMIN+ + CONTRIBUTOR; below RESTRICTED_VIEWER so read-only roles
  // can't burn the image budget). The service degrades gracefully when
  // the tenant has no image-capable provider (Anthropic/platform →
  // AI_IMAGE_UNAVAILABLE, not a 500). We pass the caller's role so the
  // created asset honors the same review gate as a manual upload.
  @Post('image')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async generateImage(
    @Request() req: any,
    @Body(new ZodValidationPipe(AiImageSchema)) body: AiImageBody,
  ) {
    return this.ai.generateImage({
      ...body,
      tenantId: req.user.tenantId,
      userId: req.user.id,
      role: req.user.role,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Wave B / editor-crush B1 (2026-07-02) — in-editor Pexels stock-photo
  // search. Thin authenticated proxy over StockImageService: the Pexels key
  // stays server-side (Authorization header, never logged — see
  // StockImageService), and the "Stock photos" tab in the asset/background
  // pickers calls this instead of a free-text URL. Same role gate as
  // generate/image (ADMIN+ + CONTRIBUTOR, below RESTRICTED_VIEWER); GET
  // because it's read-only (no cost — Pexels' free tier, no AI spend), but
  // still throttled since it fans out to a metered third-party API.
  // ─────────────────────────────────────────────────────────────────────
  @Get('stock-search')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async stockSearch(
    @Query('q') q?: string,
    @Query('orientation') orientation?: string,
  ) {
    const results = await this.ai.searchStockPhotos({
      query: (q ?? '').slice(0, 200),
      orientation: orientation === 'portrait' ? 'portrait' : 'landscape',
      limit: 12,
    });
    // `configured` lets the FE distinguish "no key set — hide the tab" from
    // "key set, this query just had no hits" without a second round-trip.
    return { results, configured: this.ai.isStockConfigured() };
  }

  // Re-host an operator-picked Pexels photo into our own Supabase bucket
  // (same durability rationale as the AI-keep flow's attachKeptBoardPhoto).
  // Best-effort: on any failure the service returns { url: undefined } and
  // the FE falls back to using the raw Pexels URL directly — the photo
  // still renders, it just isn't mirrored.
  @Post('stock-rehost')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async stockRehost(
    @Request() req: any,
    @Body(new ZodValidationPipe(AiStockRehostSchema)) body: AiStockRehostBody,
  ) {
    const url = await this.ai.rehostStockPhoto(req.user.tenantId, body.url);
    return { url };
  }
}
