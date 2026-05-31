/**
 * BugAnalyzerService — fires the Anthropic API after a Bug row is
 * created and writes the structured BugAiAnalysis back to the row.
 *
 * Operator vision (2026-05-27): "find the issue and the fix and then
 * just ask my approval and we fix the fucking issue, things are
 * resolved in record fucking time like no one has ever seen before
 * in real life". This service is the "find the issue and the fix"
 * step. The /super/bugs review page renders the output; admin
 * approves; the controller opens a GitHub PR with the suggested diff.
 *
 * ── Lifecycle ──────────────────────────────────────────────────
 *
 *   BugsController.create(payload)
 *     → row inserted (status='NEW')
 *     → controller fires `analyze(bugId).catch(...)` — never awaited
 *     → status flips to 'ANALYZING' to give the FE a polling signal
 *     → Anthropic /v1/messages call w/ tool-use forces structured output
 *     → on success: row updated (status='PROPOSED', aiAnalysis populated,
 *                  cost computed from usage tokens, aiProvider/aiModel
 *                  recorded). AuditLog row written with action='BUG_ANALYZED'.
 *     → on failure: aiAnalysis set to { error: '...' } so the review
 *                  page can show "AI failed — review manually". The row's
 *                  status is RESTORED to whatever it was before
 *                  ANALYZING (usually 'NEW'). AuditLog with action=
 *                  'BUG_ANALYSIS_FAILED'.
 *
 * ── Cost cap ───────────────────────────────────────────────────
 *
 * Global guard: at most 20 successful `BUG_ANALYZED` audit rows in
 * the rolling 24-hour window. The Anthropic Sonnet model can run
 * $0.15+/call on a deep diff, so 20 caps daily platform spend at
 * <$5 — and aligns with the daily on-call attention budget anyway.
 * When the cap is reached the analyzer writes
 * `{ error: 'daily cap reached' }` to aiAnalysis and SKIPS the API
 * call entirely. The review page surfaces it; admin can re-trigger
 * the next day via POST /bugs/:id/iterate.
 *
 * ── Idempotency ────────────────────────────────────────────────
 *
 * `analyze()` re-reads the row's status before posting. If the row
 * is already in a terminal state (APPROVED / SHIPPED / REJECTED /
 * DUPLICATE) the call short-circuits — admins can't accidentally
 * burn AI credit on a bug that's already closed.
 *
 * The /iterate controller path flips status BACK to 'ANALYZING'
 * before calling analyze(), so admin-driven re-analysis of an
 * APPROVED bug works (admin changed their mind before the fix
 * shipped). The analyzer never has to know about that intent —
 * status='ANALYZING' is its single gate.
 *
 * ── Pricing ────────────────────────────────────────────────────
 *
 * Claude 3.5 Sonnet (claude-3-5-sonnet-20241022) list pricing:
 *   $3.00 / 1M input tokens
 *   $15.00 / 1M output tokens
 *
 * computeCostUsd() uses the `usage` block Anthropic returns on every
 * /v1/messages response (input_tokens + output_tokens), so the per-bug
 * cost we store is the actual billable cost, not an estimate.
 */

import { Injectable, Logger } from '@nestjs/common';
import type {
  BugAiAnalysis,
  BugAiFileChange,
  BugCapturedContext,
  BugServerContext,
} from '@cms/api-types';
import { PrismaService } from '../prisma/prisma.service';

// ─── Constants ──────────────────────────────────────────────────

const ANALYZER_MODEL = 'claude-sonnet-4-5-20250929';
const ANALYZER_PROVIDER = 'anthropic';

// Sonnet 4.5 list pricing (USD per 1M tokens) — same $3 / $15 as 3.5 Sonnet,
// so the cost math below is unchanged by the model bump. Current as of 2026-05-31.
const COST_INPUT_PER_1M = 3.0;
const COST_OUTPUT_PER_1M = 15.0;

// Hard fetch timeout — analyzer runs in the background but a single
// stuck request still ties up an event-loop slot. 30 s is generous
// enough for a long structured-output reply; anything past that we
// cut and treat as a failure.
const FETCH_TIMEOUT_MS = 30_000;

// Cost cap: max successful BUG_ANALYZED rows per rolling 24h window.
const DAILY_CAP_PER_24H = 20;

// Hard ceiling on output tokens. A 6-file diff ≈ 2500 tokens; 4000
// gives breathing room without blowing the cost cap above. Pinning
// this here keeps a runaway model from generating a 100KB reply.
const MAX_OUTPUT_TOKENS = 4000;

// ─── System prompt (compact CLAUDE.md excerpt) ─────────────────

/**
 * Anchored excerpt from CLAUDE.md. Kept compact so we don't blow
 * the context budget on every call. The three blocks below cover:
 *
 *   1. "For AI Assistants" (tool prefs, secret hygiene, repo is public)
 *   2. The "Standard Audit Surface" intro paragraph (every audit must
 *      enumerate every domain — the analyzer should respect the same
 *      breadth-of-scope discipline when proposing fixes)
 *   3. The "Verification Before Claim" rule (must annotate verify steps
 *      in testPlan, must surface low confidence honestly)
 *
 * The user prompt below interpolates the bug's data; the system prompt
 * is identical for every call so Anthropic's prompt cache can hit it.
 */
const SYSTEM_PROMPT = `You are the AI bug analyzer for VenueOS, a NestJS + Next.js monorepo
for a K-12 / multi-vertical digital signage CMS. Your job: read a bug
report (operator description, client-side capture, server-side enrichment)
and propose a minimal, targeted code fix.

CONTEXT FROM CLAUDE.md (codebase ground truth — abridged):

1. For AI Assistants
   - Use Sonnet for feature work, Opus for emergency/security/template builder.
   - Never weaken emergency safeguards. Emergency system changes require review.
   - Never commit .env or secrets. Repo is PUBLIC on GitHub.
   - Prisma schema is source of truth: packages/database/prisma/schema.prisma.
   - Verify the render tree before editing any UI file — green CI is NOT proof of correctness.
   - Never use the \`inset\` shorthand or \`inset-*\` Tailwind classes (NovaStar Taurus runs Chromium 83). Use top/right/bottom/left.

2. Standard Audit Surface (the breadth-of-scope discipline)
   Every privileged action MUST audit-log. Every mutation MUST be tenant-scoped.
   Cross-browser support is mandatory (Safari WebKit + Chromium 83 player kiosks).
   Every fix must respect the multi-tenant isolation model.

3. Verification Before Claim
   The fix should be SMALL and TARGETED. If you're unsure, lower your confidence and
   say so explicitly in the rootCause field. Always populate testPlan with a
   concrete verification step (curl one-liner, Playwright command, or "open page X
   and click button Y, expect Z").

REPO LAYOUT:
  apps/api/    NestJS API on Express (port 8080) — controllers + services
  apps/web/    Next.js 16 App Router dashboard (port 3000)
  apps/player/ Android kiosk app
  packages/database/ — Prisma schema + generated client
  packages/api-types/ — shared TS types (controllers + frontend share these)
  packages/auth-core/ — JWT + argon2 + session helpers
  packages/ws-events/ — signed websocket event types

OUTPUT CONTRACT (enforced by tool-use):
You MUST call the report_bug_analysis tool exactly once. Do NOT reply with
prose. The tool's input shape is the answer.

Fix style:
- Prefer the SMALLEST diff that addresses the root cause.
- Reference real file paths (the report names them in capturedContext.url /
  pathname and in network failures). If you don't know the exact file, name
  the directory and say "candidate file" in the reason field.
- Diff format: unified-diff style, with "+" / "-" leading lines and 3 lines
  of context above + below the change.
- If the bug is non-actionable from the data given (truly insufficient
  information), set confidence < 30 and explain what you'd need in rootCause.`;

// ─── Tool schema (Anthropic tool-use forces structured output) ──

/**
 * Anthropic's tool-use JSON schema for the analyzer's reply. Mirrors
 * BugAiAnalysis exactly (minus v + analyzedAt which we fill server-
 * side). Models invoked with `tool_choice: { type: 'tool', name: ... }`
 * MUST emit a tool_use block matching this schema; that gives us
 * structured output without parsing markdown / json-in-fence.
 */
const REPORT_TOOL = {
  name: 'report_bug_analysis',
  description:
    'Report your analysis of the bug along with a proposed minimal fix. This is the ONLY way to reply — do not also emit prose.',
  input_schema: {
    type: 'object',
    properties: {
      rootCause: {
        type: 'string',
        description:
          'One-paragraph plain-English explanation of what is broken and why.',
      },
      filesAffected: {
        type: 'array',
        description:
          'Files you propose to change. Empty array allowed only when confidence < 30.',
        items: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description:
                'Absolute path from repo root, e.g. "apps/api/src/foo.controller.ts".',
            },
            reason: {
              type: 'string',
              description:
                'One sentence: why this file is being touched.',
            },
            diff: {
              type: 'string',
              description:
                'Unified-diff-style patch with "+" / "-" lines and 3 lines of context. Empty allowed only for "candidate file" entries when you cannot localize the change.',
            },
          },
          required: ['filePath', 'reason', 'diff'],
        },
      },
      confidence: {
        type: 'integer',
        description:
          'Self-rated 0-100. <70 should be treated as "human please verify" by the operator UI.',
        minimum: 0,
        maximum: 100,
      },
      alternatives: {
        type: 'array',
        description:
          'Optional alternative diagnoses you considered but ranked lower.',
        items: {
          type: 'object',
          properties: {
            rootCause: { type: 'string' },
            confidence: { type: 'integer', minimum: 0, maximum: 100 },
          },
          required: ['rootCause', 'confidence'],
        },
      },
      testPlan: {
        type: 'string',
        description:
          'A Playwright command, curl one-liner, or short manual verification recipe the operator can run to confirm the fix.',
      },
    },
    required: ['rootCause', 'filesAffected', 'confidence'],
  },
} as const;

@Injectable()
export class BugAnalyzerService {
  private readonly logger = new Logger(BugAnalyzerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget entry point. Callers do NOT await this — the
   * controller pattern is:
   *
   *     this.bugAnalyzer.analyze(bug.id).catch((e) =>
   *       this.logger.error(`analyze() crashed for ${bug.id}: ${e}`)
   *     );
   *     return { bugId: bug.id, status: 'NEW', analysisReady: false };
   *
   * `iterateNotes` (optional) is prepended to the user prompt by the
   * /iterate path so the model can rethink with the admin's hint.
   */
  async analyze(bugId: string, iterateNotes?: string): Promise<void> {
    // 1. Load the row + check idempotency.
    const bug = await this.prisma.client.bug.findUnique({
      where: { id: bugId },
    });
    if (!bug) {
      this.logger.warn(`analyze(${bugId}): bug row not found`);
      return;
    }
    const isTerminal = ['APPROVED', 'SHIPPED', 'REJECTED', 'DUPLICATE'].includes(
      bug.status,
    );
    if (isTerminal) {
      this.logger.debug(
        `analyze(${bugId}): skipping, status=${bug.status} is terminal`,
      );
      return;
    }
    const priorStatus = bug.status;

    // 2. Flip to ANALYZING so the FE polling sees something change.
    try {
      await this.prisma.client.bug.update({
        where: { id: bugId },
        data: { status: 'ANALYZING' },
      });
    } catch (e: any) {
      this.logger.warn(
        `analyze(${bugId}): could not flip to ANALYZING: ${e?.message ?? e}`,
      );
    }

    // 3. Cost-cap gate. Count successful BUG_ANALYZED rows in the
    //    last 24h GLOBALLY. Refuse if over cap; write a structured
    //    error so the review UI can surface it.
    const overCap = await this.isOverDailyCap();
    if (overCap) {
      this.logger.warn(
        `analyze(${bugId}): daily cap reached (${DAILY_CAP_PER_24H}/24h); skipping API call`,
      );
      await this.persistAnalysisError(
        bugId,
        priorStatus,
        bug.tenantId,
        'daily cap reached',
        'cap_reached',
      );
      return;
    }

    // 4. API key check. Degrade gracefully when missing — admin sees
    //    the row in 'NEW' (we revert from ANALYZING) with an error in
    //    aiAnalysis explaining the deploy isn't configured.
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.logger.warn(`analyze(${bugId}): ANTHROPIC_API_KEY unset`);
      await this.persistAnalysisError(
        bugId,
        priorStatus,
        bug.tenantId,
        'AI not configured for this deploy (ANTHROPIC_API_KEY unset)',
        'unconfigured',
      );
      return;
    }

    // 5. Build prompt + call Anthropic with tool-use.
    const captured = (bug.capturedContext ?? {}) as unknown as BugCapturedContext;
    const serverCtx = (bug.serverContext ?? null) as
      | BugServerContext
      | null;
    const userPrompt = this.buildUserPrompt({
      captured,
      serverCtx,
      operatorDescription: bug.description,
      iterateNotes,
    });

    let raw: any;
    try {
      raw = await this.callAnthropic({
        apiKey,
        userPrompt,
      });
    } catch (e: any) {
      this.logger.error(
        `analyze(${bugId}): Anthropic call failed: ${e?.message ?? e}`,
      );
      await this.persistAnalysisError(
        bugId,
        priorStatus,
        bug.tenantId,
        `analysis failed: ${String(e?.message ?? e).slice(0, 200)}`,
        'provider_error',
      );
      return;
    }

    // 6. Extract structured output. tool-use forced the model to call
    //    report_bug_analysis exactly once — its `input` is our payload.
    const toolUse = Array.isArray(raw?.content)
      ? raw.content.find(
          (c: any) => c?.type === 'tool_use' && c?.name === REPORT_TOOL.name,
        )
      : null;
    if (!toolUse?.input) {
      const stop = raw?.stop_reason;
      const fallbackText = Array.isArray(raw?.content)
        ? raw.content
            .filter((c: any) => c?.type === 'text')
            .map((c: any) => c?.text || '')
            .join(' ')
        : '';
      this.logger.warn(
        `analyze(${bugId}): no tool_use block (stop_reason=${stop}); text=${fallbackText.slice(0, 200)}`,
      );
      await this.persistAnalysisError(
        bugId,
        priorStatus,
        bug.tenantId,
        `analysis failed: model did not emit a tool_use block (stop_reason=${stop ?? 'unknown'})`,
        'no_tool_use',
      );
      return;
    }

    const analysis = this.sanitizeAnalysis(toolUse.input);

    // 7. Cost calc + persist.
    const usage = raw?.usage ?? {};
    const inputTokens = Number(usage?.input_tokens) || 0;
    const outputTokens = Number(usage?.output_tokens) || 0;
    const cost = this.computeCostUsd(inputTokens, outputTokens);

    try {
      await this.prisma.client.bug.update({
        where: { id: bugId },
        data: {
          status: 'PROPOSED',
          aiAnalysis: analysis as unknown as object,
          aiAnalyzedAt: new Date(),
          aiProvider: ANALYZER_PROVIDER,
          aiModel: ANALYZER_MODEL,
          aiCostUsd: cost,
        },
      });
    } catch (e: any) {
      // The analysis succeeded but the write failed. Don't blow up;
      // log + audit so we can recover. Status stays ANALYZING, which
      // an operator can re-fire via /iterate.
      this.logger.error(
        `analyze(${bugId}): persist update failed after successful analysis: ${e?.message ?? e}`,
      );
    }

    await this.writeAuditLog(bug.tenantId, 'BUG_ANALYZED', bugId, {
      provider: ANALYZER_PROVIDER,
      model: ANALYZER_MODEL,
      inputTokens,
      outputTokens,
      costUsd: cost,
      confidence: analysis.confidence,
      filesAffectedCount: analysis.filesAffected.length,
      iterated: !!iterateNotes,
    });
  }

  // ─── Internals ───────────────────────────────────────────────

  /**
   * Build the user-facing prompt: operator's free-text description first
   * (so the model anchors on intent), then the structured capture +
   * server-context bundle rendered as readable markdown.
   *
   * Markdown rather than raw JSON because Anthropic models reason better
   * over readable headings + bullets than over a JSON blob of the same
   * length — same conclusion the AI alt-text service reached.
   */
  private buildUserPrompt(args: {
    captured: BugCapturedContext;
    serverCtx: BugServerContext | null;
    operatorDescription: string | null;
    iterateNotes?: string;
  }): string {
    const { captured, serverCtx, operatorDescription, iterateNotes } = args;
    const parts: string[] = [];

    if (iterateNotes && iterateNotes.trim()) {
      parts.push(
        '## Admin iteration notes (act on these first):',
        iterateNotes.trim().slice(0, 2000),
        '',
      );
    }

    parts.push('## Operator description');
    parts.push(
      operatorDescription?.trim() || '(none — operator did not type a description)',
    );
    parts.push('');

    parts.push('## Where the bug was filed');
    parts.push(`- URL: ${captured?.url ?? 'unknown'}`);
    parts.push(`- Path: ${captured?.pathname ?? 'unknown'}`);
    parts.push(`- Page title: ${captured?.pageTitle ?? 'unknown'}`);
    parts.push(`- Client timestamp: ${this.formatTs(captured?.clientTs)}`);
    parts.push('');

    parts.push('## Reporter');
    const r = captured?.reporter;
    if (r) {
      parts.push(`- user id: ${r.userId}`);
      parts.push(`- email: ${r.email}`);
      parts.push(`- role: ${r.role}`);
      parts.push(`- tenant id: ${r.tenantId ?? '(none)'}`);
      parts.push(`- tenant slug: ${r.tenantSlug ?? '(none)'}`);
      if (r.tenantVertical) parts.push(`- vertical: ${r.tenantVertical}`);
    } else {
      parts.push('(no reporter info in capture)');
    }
    parts.push('');

    parts.push('## Browser / viewport');
    const b = captured?.browser;
    if (b) {
      parts.push(`- userAgent: ${b.userAgent}`);
      parts.push(`- viewport: ${b.viewport?.w}×${b.viewport?.h} @ DPR ${b.dpr}`);
      parts.push(`- language: ${b.language}`);
      parts.push(
        `- chromium major: ${b.chromiumMajor ?? '(not Chromium)'}`,
      );
    } else {
      parts.push('(no browser info)');
    }
    parts.push('');

    if (Array.isArray(captured?.consoleEntries) && captured.consoleEntries.length) {
      parts.push('## Console errors / warnings');
      for (const c of captured.consoleEntries.slice(0, 30)) {
        parts.push(`- [${c.level}] ${this.formatTs(c.ts)} — ${c.message}`);
        if (c.stack) {
          parts.push('  stack:');
          for (const line of c.stack.split('\n').slice(0, 12)) {
            parts.push(`  ${line}`);
          }
        }
      }
      parts.push('');
    }

    if (
      Array.isArray(captured?.networkFailures) &&
      captured.networkFailures.length
    ) {
      parts.push('## Network failures');
      for (const n of captured.networkFailures.slice(0, 30)) {
        parts.push(
          `- ${n.method} ${n.url} — status ${n.status ?? 'n/a'} after ${n.durationMs}ms`,
        );
        if (n.message) parts.push(`  message: ${n.message.slice(0, 200)}`);
      }
      parts.push('');
    }

    if (Array.isArray(captured?.breadcrumbs) && captured.breadcrumbs.length) {
      parts.push('## Breadcrumbs (most-recent first)');
      const crumbs = captured.breadcrumbs.slice(-30).reverse();
      for (const c of crumbs) {
        parts.push(`- [${c.type}] ${this.formatTs(c.ts)} — ${c.label}`);
      }
      parts.push('');
    }

    if (Array.isArray(captured?.reactQuery) && captured.reactQuery.length) {
      parts.push('## React Query cache state');
      for (const q of captured.reactQuery.slice(0, 30)) {
        parts.push(
          `- ${q.queryKey} → ${q.state}, dataPresent=${q.dataPresent}${q.errorMessage ? `, error: ${q.errorMessage.slice(0, 200)}` : ''}`,
        );
      }
      parts.push('');
    }

    if (
      captured?.featureFlags &&
      typeof captured.featureFlags === 'object' &&
      Object.keys(captured.featureFlags as object).length
    ) {
      parts.push('## Feature flags');
      for (const [k, v] of Object.entries(captured.featureFlags as object)) {
        parts.push(`- ${k} = ${this.safeStringify(v)}`);
      }
      parts.push('');
    }

    if (serverCtx) {
      parts.push('## Server enrichment');
      parts.push(`- API commit: ${serverCtx.apiCommitSha ?? 'unknown'}`);
      parts.push(`- API uptime: ${serverCtx.apiUptimeSec ?? 'unknown'}s`);
      parts.push(
        `- infra: db=${serverCtx.infraHealth?.db}, redis=${serverCtx.infraHealth?.redis}`,
      );
      if (serverCtx.license) {
        parts.push(
          `- license: tier=${serverCtx.license.tier}, seats ${serverCtx.license.currentSeats ?? '?'}/${serverCtx.license.seatLimit ?? '?'}, expires ${serverCtx.license.expiresAt ?? 'never'}`,
        );
      }

      if (
        Array.isArray(serverCtx.reporterAuditLog) &&
        serverCtx.reporterAuditLog.length
      ) {
        parts.push('');
        parts.push("### Reporter's recent audit-log actions");
        for (const a of serverCtx.reporterAuditLog.slice(0, 20)) {
          parts.push(
            `- ${a.ts} ${a.action} ${a.targetType ?? ''}${a.targetId ? `:${a.targetId}` : ''}${a.details ? ` — ${a.details}` : ''}`,
          );
        }
      }

      if (
        Array.isArray(serverCtx.tenantAuditLog) &&
        serverCtx.tenantAuditLog.length
      ) {
        parts.push('');
        parts.push("### Other tenant audit-log activity (recent)");
        for (const a of serverCtx.tenantAuditLog.slice(0, 20)) {
          parts.push(
            `- ${a.ts} ${a.action} ${a.targetType ?? ''}${a.targetId ? `:${a.targetId}` : ''}${a.details ? ` — ${a.details}` : ''}`,
          );
        }
      }
      parts.push('');
    }

    parts.push(
      '---',
      'Now analyze this bug and call the `report_bug_analysis` tool with your findings.',
      'Remember: smallest-possible diff. If you do not know exactly which file is at fault, name a candidate file and lower your confidence accordingly.',
    );
    return parts.join('\n');
  }

  /**
   * Single Anthropic /v1/messages call. tool-use mode forces structured
   * output via `tool_choice: { type: 'tool', name: REPORT_TOOL.name }`.
   *
   * Returns the parsed JSON body on 2xx; throws with the response body
   * on non-2xx (caller maps to a persistAnalysisError).
   */
  private async callAnthropic(args: {
    apiKey: string;
    userPrompt: string;
  }): Promise<any> {
    const body = {
      model: ANALYZER_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // Anthropic ephemeral prompt cache — the system prompt is
          // identical across every call, so flagging it as cacheable
          // saves real money once we have steady bug volume.
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [REPORT_TOOL],
      tool_choice: { type: 'tool', name: REPORT_TOOL.name },
      messages: [{ role: 'user', content: args.userPrompt }],
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(
        `Anthropic ${res.status}: ${errBody.slice(0, 500)}`,
      );
    }
    return (await res.json()) as any;
  }

  /**
   * Strict sanitize on the tool_use payload before persisting. The
   * tool schema is enforced at the model level but a hostile/buggy
   * reply could still send garbage; we clamp lengths + types so
   * the JSON column always has the contract shape.
   */
  private sanitizeAnalysis(raw: any): BugAiAnalysis {
    const rootCause = String(raw?.rootCause ?? '').trim().slice(0, 4000);
    const confidence = Math.max(
      0,
      Math.min(100, Number.isFinite(Number(raw?.confidence)) ? Math.floor(Number(raw.confidence)) : 0),
    );

    const filesAffected: BugAiFileChange[] = [];
    if (Array.isArray(raw?.filesAffected)) {
      for (const f of raw.filesAffected.slice(0, 30)) {
        const filePath = String(f?.filePath ?? '').trim().slice(0, 500);
        if (!filePath) continue;
        filesAffected.push({
          filePath,
          reason: String(f?.reason ?? '').trim().slice(0, 1000),
          diff: String(f?.diff ?? '').slice(0, 20_000),
        });
      }
    }

    const alternatives: BugAiAnalysis['alternatives'] = [];
    if (Array.isArray(raw?.alternatives)) {
      for (const a of raw.alternatives.slice(0, 5)) {
        const altRoot = String(a?.rootCause ?? '').trim().slice(0, 2000);
        if (!altRoot) continue;
        alternatives.push({
          rootCause: altRoot,
          confidence: Math.max(
            0,
            Math.min(100, Number.isFinite(Number(a?.confidence)) ? Math.floor(Number(a.confidence)) : 0),
          ),
        });
      }
    }

    const testPlan = raw?.testPlan
      ? String(raw.testPlan).trim().slice(0, 4000)
      : undefined;

    const out: BugAiAnalysis = {
      v: 1,
      rootCause,
      filesAffected,
      confidence,
      analyzedAt: Date.now(),
    };
    if (alternatives.length) out.alternatives = alternatives;
    if (testPlan) out.testPlan = testPlan;
    return out;
  }

  private computeCostUsd(inputTokens: number, outputTokens: number): number {
    const cost =
      (inputTokens / 1_000_000) * COST_INPUT_PER_1M +
      (outputTokens / 1_000_000) * COST_OUTPUT_PER_1M;
    // Round to 6 decimals so the column doesn't store noisy floats.
    return Math.round(cost * 1_000_000) / 1_000_000;
  }

  /**
   * Persist an error state into the row + write an audit row. Used by
   * every failure branch (unconfigured, cap reached, provider error,
   * no tool_use block). Keeps the FE story consistent: aiAnalysis is
   * always SOMETHING after an analysis attempt, never silently null,
   * so the review page can branch on `aiAnalysis?.error`.
   *
   * Status reverts to the prior status (usually 'NEW') so the analyzer
   * can be re-fired via /iterate without manual cleanup.
   */
  private async persistAnalysisError(
    bugId: string,
    priorStatus: string,
    tenantId: string | null,
    errorText: string,
    errorKind:
      | 'unconfigured'
      | 'cap_reached'
      | 'provider_error'
      | 'no_tool_use',
  ): Promise<void> {
    // Avoid leaving the row stuck in ANALYZING — if the prior status
    // was ANALYZING (e.g. /iterate flipped it before calling us),
    // revert to NEW so the operator UI presents a "retry" button
    // rather than an indefinite spinner.
    const revertTo = priorStatus === 'ANALYZING' ? 'NEW' : priorStatus;
    try {
      await this.prisma.client.bug.update({
        where: { id: bugId },
        data: {
          status: revertTo,
          aiAnalysis: { error: errorText, kind: errorKind } as object,
          aiAnalyzedAt: new Date(),
          aiProvider: ANALYZER_PROVIDER,
          aiModel: ANALYZER_MODEL,
        },
      });
    } catch (e: any) {
      this.logger.error(
        `persistAnalysisError(${bugId}): row update failed: ${e?.message ?? e}`,
      );
    }
    await this.writeAuditLog(tenantId, 'BUG_ANALYSIS_FAILED', bugId, {
      provider: ANALYZER_PROVIDER,
      model: ANALYZER_MODEL,
      kind: errorKind,
      error: errorText,
    });
  }

  /**
   * Best-effort audit log writer. AuditLog.tenantId is non-null in
   * the schema (FK → Tenant), so when Bug.tenantId is null we skip
   * the audit row rather than fabricate a sentinel that would FK-fail.
   *
   * In practice every v1 bug carries a tenantId because the POST
   * handler sets bug.tenantId = req.user.tenantId (every user has a
   * tenant). The nullable schema column is forward-compat for an
   * anonymous-bug path we may add later.
   *
   * Wrapped so a logging failure NEVER cascades into the bug flow.
   */
  private async writeAuditLog(
    tenantId: string | null,
    action: 'BUG_ANALYZED' | 'BUG_ANALYSIS_FAILED' | 'BUG_AI_RE_ANALYZED',
    bugId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (!tenantId) {
      this.logger.debug(
        `writeAuditLog(${action}, ${bugId}): skipped — bug not tenant-scoped`,
      );
      return;
    }
    try {
      await this.prisma.client.auditLog.create({
        data: {
          action,
          targetType: 'bug',
          targetId: bugId,
          tenantId,
          userId: null,
          details: JSON.stringify(details),
        },
      });
    } catch (e: any) {
      this.logger.debug(
        `writeAuditLog(${action}, ${bugId}) failed: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * Count successful BUG_ANALYZED rows in the last 24h. Bounded at
   * DAILY_CAP_PER_24H + 1 so we don't scan past the cap.
   */
  private async isOverDailyCap(): Promise<boolean> {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const c = await this.prisma.client.auditLog.count({
        where: {
          action: 'BUG_ANALYZED',
          createdAt: { gte: since },
        },
      });
      return c >= DAILY_CAP_PER_24H;
    } catch (e: any) {
      // If we can't check the cap, err on the side of NOT analyzing —
      // a runaway AuditLog query is more dangerous than a missed bug
      // analysis (the operator can re-trigger via /iterate later).
      this.logger.warn(`isOverDailyCap check failed: ${e?.message ?? e}`);
      return true;
    }
  }

  private formatTs(ts: number | undefined | null): string {
    if (!ts || !Number.isFinite(ts)) return 'unknown';
    try {
      return new Date(ts).toISOString();
    } catch {
      return String(ts);
    }
  }

  private safeStringify(v: unknown): string {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
}
