/**
 * DataSourceController — Phase 3 "Custom data" feed proxy.
 *
 *   POST /api/v1/data-source/fetch
 *     body: { url: string, format: 'json' | 'csv' }
 *     → { rows: Array<Record<string,string>>, columns: string[], totalRows, format }
 *
 * Why a server proxy (not a direct browser fetch):
 *   1. SSRF gate — the operator-supplied URL flows through `safeFetch`
 *      so it can never reach an internal/metadata endpoint (the same
 *      gate the branding scraper + webhook delivery use).
 *   2. No CORS dance — the player/browser never makes the cross-origin
 *      request itself; it asks us, we fetch + normalize.
 *
 * Defense (matches the branding scrape endpoint):
 *   - JwtAuthGuard + RbacGuard, tenant-scoped (tenantId from the JWT,
 *     never the body).
 *   - DataSourceRateLimiter (per-tenant + global sliding window) AND a
 *     NestJS @Throttle per-IP wall.
 *   - AuditLog row on EVERY call (success + failure) with tenantId +
 *     userId + url + outcome.
 *   - Errors mapped generically — an SSRF rejection NEVER echoes the
 *     resolved IP or the response body back to the operator.
 */

import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

import { SsrfError, FetchTooLargeError } from '../branding/safe-fetch';
import { DataSourceService, CustomDataFormat } from './data-source.service';
import { DataSourceRateLimiter } from './data-source-rate-limiter';

interface FetchBody {
  url?: string;
  format?: string;
}

@Controller('api/v1/data-source')
export class DataSourceController {
  private readonly logger = new Logger(DataSourceController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: DataSourceService,
    private readonly limiter: DataSourceRateLimiter,
  ) {}

  @Post('fetch')
  @UseGuards(JwtAuthGuard, RbacGuard)
  // CONTRIBUTOR can edit templates / drafts, so they can wire a custom
  // feed too — matches the per-template brand-kit roles. SUPER/DISTRICT/
  // SCHOOL admins included.
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  // Per-IP wall in front of the per-tenant limiter — blunts a scripted
  // burst before it even resolves a tenant.
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async fetch(@Request() req: any, @Body() body: FetchBody) {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;

    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    const format: CustomDataFormat = body?.format === 'csv' ? 'csv' : 'json';

    if (!url) {
      throw new HttpException(
        { message: 'url is required', code: 'DATA_SOURCE_BAD_REQUEST' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (body?.format !== undefined && body.format !== 'json' && body.format !== 'csv') {
      throw new HttpException(
        { message: "format must be 'json' or 'csv'", code: 'DATA_SOURCE_BAD_REQUEST' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Second wall behind the per-IP throttle: per-tenant + global egress
    // cap. Throws 429 with a friendly reset message.
    this.limiter.check(tenantId);

    try {
      const result = await this.service.fetchNormalized(url, format);
      await this.audit(tenantId, userId, url, format, 'success', {
        rows: result.rows.length,
        totalRows: result.totalRows,
        columns: result.columns.length,
      });
      return result;
    } catch (e: any) {
      await this.audit(tenantId, userId, url, format, 'failed', {
        error: e?.name,
        // Cap the stored message; never store a response body.
        message: typeof e?.message === 'string' ? e.message.slice(0, 300) : undefined,
      });
      this.mapError(e);
      throw e; // unreachable — mapError always throws
    }
  }

  // ── helpers ──────────────────────────────────────────────────────

  private async audit(
    tenantId: string,
    userId: string,
    url: string,
    format: CustomDataFormat,
    outcome: 'success' | 'failed',
    extra: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.client.auditLog
      .create({
        data: {
          action: 'DATA_SOURCE_FETCH',
          targetType: 'tenant',
          targetId: tenantId,
          tenantId,
          userId,
          // The URL is operator-supplied + tenant-scoped; storing it is
          // intended forensic signal (matches BRANDING_SCRAPE). We do
          // NOT store the response body anywhere.
          details: JSON.stringify({ url: url.slice(0, 500), format, outcome, ...extra }),
        },
      })
      .catch(() => {
        /* audit is best-effort; never block the request on a log write */
      });
  }

  /**
   * Map internal errors to safe HTTP responses. Critically, an SSRF
   * rejection becomes a GENERIC 400 — it never reflects the resolved
   * private IP or any upstream body to the operator (anti-exfil).
   */
  private mapError(e: any): never {
    if (e instanceof SsrfError) {
      throw new HttpException(
        { message: 'That URL can’t be reached (it must be a public http(s) address).', code: 'DATA_SOURCE_SSRF' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (e instanceof FetchTooLargeError || e?.name === 'FetchTooLargeError') {
      throw new HttpException(
        { message: 'That feed is too large to import. Trim it under ~1.5MB.', code: 'DATA_SOURCE_TOO_LARGE' },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    // Parse failures from the service (invalid JSON / no rows / etc.).
    const msg = typeof e?.message === 'string' ? e.message : '';
    if (/JSON|array of rows|CSV|object/i.test(msg)) {
      throw new HttpException(
        { message: msg.slice(0, 200) || 'Could not read that feed.', code: 'DATA_SOURCE_PARSE_FAILED' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (e instanceof HttpException) throw e;
    this.logger.error(`Unhandled data-source error: ${e?.name || ''} ${e?.message || e}`);
    throw new HttpException(
      { message: 'Could not fetch that feed.', code: 'DATA_SOURCE_FETCH_FAILED' },
      HttpStatus.BAD_GATEWAY,
    );
  }
}
