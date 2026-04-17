import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';

type CheckState = 'ok' | 'fail' | 'fallback';

interface HealthReport {
  status: 'ok' | 'degraded' | 'not-ready';
  checks: Record<string, CheckState>;
  uptime_s: number;
  ts: string;
  commit?: string;
}

@Controller('api/v1/health')
export class HealthController {
  private readonly startedAt = Date.now();
  private readonly commit = process.env.GIT_COMMIT_SHA || 'dev';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly wsSigner: WebsocketSignerService,
  ) {}

  private baseReport(): HealthReport {
    return {
      status: 'ok',
      checks: {},
      uptime_s: Math.floor((Date.now() - this.startedAt) / 1000),
      ts: new Date().toISOString(),
      commit: this.commit,
    };
  }

  @Get()
  liveness(): HealthReport {
    return this.baseReport();
  }

  @Get('ready')
  async readiness(): Promise<HealthReport> {
    const report = this.baseReport();

    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      report.checks.db = 'ok';
    } catch {
      report.checks.db = 'fail';
      report.status = 'not-ready';
    }

    if (report.status === 'not-ready') {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }

  @Get('emergency-path')
  async emergencyPath(): Promise<HealthReport> {
    const report = this.baseReport();

    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      report.checks.db = 'ok';
    } catch {
      report.checks.db = 'fail';
      report.status = 'degraded';
    }

    const pub = this.redis.publisher;
    if (pub && pub.status === 'ready') {
      try {
        const pong = await pub.ping();
        report.checks.redis = pong === 'PONG' ? 'ok' : 'fail';
      } catch {
        report.checks.redis = 'fail';
      }
    } else {
      report.checks.redis = 'fallback';
    }

    try {
      const signed = this.wsSigner.signMessage('health.probe', { probe: true });
      report.checks.ws_signer = signed.signature ? 'ok' : 'fail';
    } catch {
      report.checks.ws_signer = 'fail';
      report.status = 'degraded';
    }

    if (report.checks.db === 'fail' || report.checks.ws_signer === 'fail') {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
