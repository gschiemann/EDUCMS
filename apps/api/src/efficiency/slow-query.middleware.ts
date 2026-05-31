import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EfficiencyMetricsService } from './efficiency-metrics.service';

/**
 * SlowQueryMiddleware
 *
 * Registers a Prisma $use middleware that logs any query slower than
 * SLOW_QUERY_THRESHOLD_MS (default 200ms). Entries are surfaced in the
 * /super/efficiency slow-query table.
 *
 * Pattern: this service registers itself in onModuleInit so it runs once
 * after NestJS has wired all DI. The Prisma client is the global singleton
 * from @cms/database, so the middleware applies to every query from every
 * module without each controller having to know about it.
 *
 * Overhead: one Date.now() call before and after each query (O(1)).
 * Slow-query recording only happens when the threshold is crossed, so
 * fast queries have zero additional work beyond the timestamp pair.
 */
@Injectable()
export class SlowQueryMiddleware implements OnModuleInit {
  private readonly logger = new Logger('SlowQuery');
  private readonly thresholdMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: EfficiencyMetricsService,
  ) {
    this.thresholdMs = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '200', 10);
  }

  onModuleInit() {
    // Prisma $use middleware. The `params` object carries `model`, `action`,
    // and `args`. We wrap next(params) with a timer and only record/log when
    // duration exceeds the threshold.
    //
    // Note: Prisma warns that $use is deprecated in Prisma 5+ in favour of
    // client extensions, but this codebase uses the global PrismaClient
    // singleton and $use remains supported. The pattern matches how other
    // middlewares are applied in this repo.
    this.prisma.client.$use(async (params, next) => {
      const start = Date.now();
      const result = await next(params);
      // 2026-05-30 (lead hardening) — slow-query LOGGING is wrapped so a
      // failure in the metrics path can never throw between the resolved
      // query and `return result`, which would lose the row and surface as a
      // query error. The query itself (next(params)) already ran above.
      try {
        const duration = Date.now() - start;
        if (duration >= this.thresholdMs) {
          const model = params.model ?? 'unknown';
          const action = params.action ?? 'unknown';
          this.logger.warn(
            `[slow-query] ${model}.${action} took ${duration}ms (threshold: ${this.thresholdMs}ms)`,
          );
          this.metrics.recordSlowQuery(model, action, duration);
        }
      } catch {
        /* observability must never break a real query */
      }

      return result;
    });

    this.logger.log(
      `Slow-query logging active — threshold ${this.thresholdMs}ms`,
    );
  }
}
