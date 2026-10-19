import { Injectable, RequestMethod, type NestMiddleware } from '@nestjs/common';
import type { RouteInfo } from '@nestjs/common/interfaces';
import { FieldBuildsService } from './field-builds.service';

/**
 * The two routes that consult the field-build gate, and the only two that read
 * `field_build_windows`: the player's update check and the private field
 * download (player-ota.controller.ts — unchanged; it reads the window through
 * field-candidate.ts's default argument). Never a manifest poll.
 * field-window-gate.http.spec.ts drives both through the real controller.
 */
export const FIELD_GATE_ROUTES: RouteInfo[] = [
  { path: 'api/v1/player/update-check', method: RequestMethod.POST },
  { path: 'api/v1/player/field-apk/:sha', method: RequestMethod.GET },
];

/** An update check never waits longer than this on the window read; it then uses the last row read. */
export const GATE_READ_BUDGET_MS = 3_000;

/**
 * One cached read (≤ 10 s old, one query in flight) before the handler runs.
 * Never fails the request: a slow or failed read leaves the last window read
 * in place — its expiry is still enforced at the call.
 */
@Injectable()
export class FieldWindowGateMiddleware implements NestMiddleware {
  constructor(private readonly fieldBuilds: FieldBuildsService) {}

  async use(_req: unknown, _res: unknown, next: (error?: unknown) => void): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.fieldBuilds.refreshGateWindow(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, GATE_READ_BUDGET_MS);
          timer.unref?.();
        }),
      ]);
    } catch {
      /* the read logs its own failure */
    } finally {
      if (timer) clearTimeout(timer);
    }
    next();
  }
}
