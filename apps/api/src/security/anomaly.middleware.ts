import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AnomalyMiddleware implements NestMiddleware {
  private readonly logger = new Logger('SecurityAnomaly');

  use(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];
    const deviceId = req.headers['x-device-id'] || 'unknown';

    // Mock implementation for anomaly logging requirement
    // Detects rapid geographic shifts or mismatched headers (to be expanded with Redis geo checks)
    if (!userAgent) {
      this.logger.warn(JSON.stringify({
        alert: 'ANOMALY_DETECTED',
        reason: 'Missing User-Agent',
        ip,
        deviceId
      }));
    }

    // Pass through normally
    next();
  }
}
