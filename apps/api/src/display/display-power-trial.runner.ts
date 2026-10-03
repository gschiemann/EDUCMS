/**
 * display-power-trial.runner — run ONE staff power trial from configuration.
 *
 * A power trial (display.service.ts, 2026-10-03) is how a real panel sleep is
 * tried on glass before a mechanism is trusted: timeout-sleep only, with a
 * mandatory dead-man wake window, audited as a trial. The HTTP door needs a
 * platform-staff session. This is the second door, for when the person running
 * the trial has the deploy console and no browser session: set
 *
 *   DISPLAY_POWER_TRIAL_ONCE=<screenId>|<wakeAfterSeconds>|<nonce>
 *
 * (or `<screenId>|on|<nonce>` for a hard POWER_ON — the recovery direction: it
 * re-asserts the panel's wake path, restores its screen timeout and makes it
 * report its state again) and the API runs that once, 90 s after it boots (screens need a moment
 * to reconnect their push channel to a new container). It goes through the
 * SAME `applyAction` gate as the HTTP door — emergency interlock included — and
 * its audit row carries the nonce, which is what makes it once: a restart or a
 * second replica finds that row and does nothing. A new trial needs a new
 * nonce. Unset (the normal state) this does nothing at all.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveEmergencyHold } from './display-emergency-hold';
import { DisplayService } from './display.service';

export interface PowerTrialOnce {
  screenId: string;
  /** The trial's dead-man wake window; `null` means "send POWER_ON" instead of a trial. */
  wakeAfterMs: number | null;
  nonce: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse `DISPLAY_POWER_TRIAL_ONCE`. Anything malformed is "not set" — never a guess. */
export function parsePowerTrialOnce(raw: string | undefined): PowerTrialOnce | null {
  const parts = (raw ?? '').trim().split('|');
  if (parts.length !== 3) return null;
  const [screenId, seconds, nonce] = parts.map((p) => p.trim());
  if (!UUID.test(screenId) || !/^(\d{1,3}|on)$/.test(seconds) || !/^[a-z0-9-]{4,40}$/i.test(nonce)) return null;
  return { screenId, wakeAfterMs: seconds === 'on' ? null : Number(seconds) * 1000, nonce };
}

/** The marker the audit row carries, and the idempotency check looks for. */
export const powerTrialReason = (nonce: string) => `staff power trial via DISPLAY_POWER_TRIAL_ONCE nonce=${nonce}`;

@Injectable()
export class DisplayPowerTrialRunner implements OnApplicationBootstrap {
  private readonly logger = new Logger(DisplayPowerTrialRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly display: DisplayService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    const trial = parsePowerTrialOnce(process.env.DISPLAY_POWER_TRIAL_ONCE);
    if (!trial) return;
    const timer = setTimeout(() => {
      void this.runOnce(trial).catch((e) => this.logger.warn(`power trial did not run: ${e?.message ?? e}`));
    }, 90_000);
    timer.unref?.();
  }

  /** Public for the spec. Returns what happened, in one word. */
  async runOnce(trial: PowerTrialOnce): Promise<'ran' | 'already-ran' | 'no-screen' | 'refused'> {
    const reason = powerTrialReason(trial.nonce);
    // ten-ok: system actor with no request tenant — the screen id comes from the deploy configuration set by platform staff, and everything below is scoped to the tenant THIS row names.
    const screen = await this.prisma.client.screen.findUnique({
      where: { id: trial.screenId },
      select: { id: true, tenantId: true, displayCapabilities: true, lastPushConnectedAt: true },
    });
    if (!screen?.tenantId) {
      this.logger.warn(`power trial: screen ${trial.screenId} not found`);
      return 'no-screen';
    }
    const seen = await this.prisma.client.auditLog.findFirst({
      where: { tenantId: screen.tenantId, targetId: screen.id, details: { contains: `nonce=${trial.nonce}` } },
      select: { id: true },
    });
    if (seen) return 'already-ran';

    const emergencyHold = await resolveEmergencyHold(this.prisma, { id: screen.id, tenantId: screen.tenantId });
    try {
      const result = await this.display.applyAction({
        screenId: screen.id,
        tenantId: screen.tenantId,
        userId: null,
        ...(trial.wakeAfterMs === null
          ? { action: 'POWER_ON' as const }
          : { action: 'POWER_OFF' as const, revertAfterMs: trial.wakeAfterMs, powerTrial: true }),
        reason,
        capabilities: screen.displayCapabilities ?? null,
        lastPushConnectedAt: screen.lastPushConnectedAt ?? null,
        emergencyHold,
      });
      this.logger.log(`power trial sent to screen=${screen.id} wakeAfterMs=${trial.wakeAfterMs} result=${JSON.stringify(result).slice(0, 300)}`);
      return 'ran';
    } catch (e: any) {
      this.logger.warn(`power trial refused for screen=${screen.id}: ${e?.code ?? ''} ${e?.message ?? e}`);
      return 'refused';
    }
  }
}
