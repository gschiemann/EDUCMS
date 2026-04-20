import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StickType = 'roku' | 'fire-tv' | 'apple-tv' | 'chromecast' | 'android-tv';

export type StickStatus = 'online' | 'offline' | 'unknown';

export type StickCommand =
  | 'launch_app'
  | 'power'
  | 'home'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'select'
  | 'back'
  | 'volume_up'
  | 'volume_down'
  | 'mute';

export interface StickRecord {
  id: string;
  /** Human display name — e.g. "Lobby TV Roku". */
  name: string;
  /** Hardware type — determines which protocol the kiosk relay uses
   *  (Roku ECP / Fire TV ADB / Apple TV IP Remote / etc.). */
  type: StickType;
  /** LAN IP address of the stick (same network as the kiosk). */
  ip: string;
  /** Optional room or zone label — e.g. "Cardio Floor", "Spin Studio". */
  room?: string;
  /** Last-known connection status. Only the kiosk relay can write 'online'
   *  or 'offline'; the API sets 'unknown' on creation. */
  status: StickStatus;
  /** ISO timestamp of the last status update received from a kiosk relay. */
  lastSeenAt: string | null;
  /** Tenant the stick belongs to. */
  tenantId: string;
}

// ─── Phase-1 in-memory store ──────────────────────────────────────────────────
//
// TODO (phase-2): migrate to a `Stick` Prisma model in packages/database.
// Schema fields will mirror StickRecord (id, name, type, ip, room, status,
// lastSeenAt, tenantId). A Prisma migration is NOT needed for phase-1 — the
// in-memory Map gives us the API surface while the Android APK LAN relay is
// being wired up. The backend endpoint contract (URLs, request/response shapes)
// is stable; only the storage layer changes in phase-2.
//
// Keys: tenantId → StickRecord[].
const STICKS = new Map<string, StickRecord[]>();

function getForTenant(tenantId: string): StickRecord[] {
  if (!STICKS.has(tenantId)) STICKS.set(tenantId, []);
  return STICKS.get(tenantId)!;
}

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * StickControlController — manage and command streaming sticks (Roku,
 * Fire TV, Apple TV, Chromecast, Android TV) that are plugged into
 * gym TVs on the same LAN as the paired kiosk.
 *
 * All endpoints are scoped to the caller's tenant via `req.user.tenantId`
 * (same pattern as ScreensController).
 *
 * Architecture note (phase-1):
 *   The actual LAN HTTP calls (Roku ECP, Fire TV ADB, Apple TV companion
 *   protocol) are NOT made from this NestJS process — this API never touches
 *   the gym's LAN directly. Instead, `POST /:stickId/command` publishes a
 *   signed `STICK_COMMAND` WebSocket message on the tenant's Redis channel.
 *   The gym's Android kiosk (running the paired player APK on the same LAN
 *   as the stick) subscribes to that channel, receives the command, and
 *   executes the appropriate native HTTP/ADB call against the stick's IP.
 *   This design means zero inbound firewall holes — the kiosk initiates
 *   the WebSocket outbound, and stick commands ride that existing channel.
 *
 * Wiring the Android relay:
 *   The APK-side handler is in `app/src/main/java/...StickCommandHandler.kt`
 *   (to be created). It must listen for `STICK_COMMAND` events, verify the
 *   signature via the same HMAC key used for other realtime messages, and
 *   dispatch to `RokuEcpClient`, `FireTvAdbClient`, etc. based on `stickType`.
 */
@Controller('api/v1/fitness/sticks')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
export class StickControlController {
  constructor(
    private readonly redisService: RedisService,
    private readonly signer: WebsocketSignerService,
  ) {}

  // ─── GET / — list all sticks for the caller's tenant ───────────────────────

  /**
   * List all streaming sticks registered to the caller's tenant.
   *
   * @returns Array<{ id, name, type, ip, room, status, lastSeenAt }>
   */
  @Get()
  list(@Request() req: any): Omit<StickRecord, 'tenantId'>[] {
    const tenantId: string = req.user.tenantId;
    return getForTenant(tenantId).map(({ tenantId: _t, ...rest }) => rest);
  }

  // ─── POST / — register a new stick ─────────────────────────────────────────

  /**
   * Register a new streaming stick to the caller's tenant.
   *
   * Body: { name: string, type: StickType, ip: string, room?: string }
   *
   * @returns The newly created StickRecord (without tenantId).
   */
  @Post()
  register(
    @Request() req: any,
    @Body() body: { name?: string; type?: StickType; ip?: string; room?: string },
  ): Omit<StickRecord, 'tenantId'> {
    const tenantId: string = req.user.tenantId;

    if (!body.name?.trim()) {
      throw new HttpException('name is required', HttpStatus.BAD_REQUEST);
    }
    if (!body.type) {
      throw new HttpException('type is required (roku | fire-tv | apple-tv | chromecast | android-tv)', HttpStatus.BAD_REQUEST);
    }
    if (!body.ip?.trim()) {
      throw new HttpException('ip is required', HttpStatus.BAD_REQUEST);
    }

    const stick: StickRecord = {
      id: crypto.randomUUID(),
      name: body.name.trim(),
      type: body.type,
      ip: body.ip.trim(),
      room: body.room?.trim() || undefined,
      status: 'unknown',
      lastSeenAt: null,
      tenantId,
    };

    getForTenant(tenantId).push(stick);

    const { tenantId: _t, ...rest } = stick;
    return rest;
  }

  // ─── DELETE /:stickId — remove a stick ─────────────────────────────────────

  /**
   * Remove a registered stick from the caller's tenant.
   *
   * @returns { deleted: true, stickId }
   */
  @Delete(':stickId')
  remove(
    @Request() req: any,
    @Param('stickId') stickId: string,
  ): { deleted: boolean; stickId: string } {
    const tenantId: string = req.user.tenantId;
    const sticks = getForTenant(tenantId);
    const idx = sticks.findIndex((s) => s.id === stickId);

    if (idx === -1) {
      throw new HttpException('Stick not found', HttpStatus.NOT_FOUND);
    }

    sticks.splice(idx, 1);
    return { deleted: true, stickId };
  }

  // ─── POST /:stickId/command — enqueue a remote command ─────────────────────

  /**
   * Enqueue a remote-control command for a specific stick.
   *
   * Body: { command: StickCommand, appId?: string }
   *   `appId` is required when command === 'launch_app'. For Roku ECP it
   *   is the channel id (e.g. '12' for Netflix); for Fire TV ADB it is
   *   the package name (e.g. 'com.netflix.ninja').
   *
   * Phase-1 behaviour: the command is logged to console, then published
   * as a signed STICK_COMMAND WebSocket message on the tenant's Redis channel.
   * The kiosk APK running on the gym's LAN receives it and executes the
   * actual LAN HTTP/ADB call.
   *
   * TODO (phase-2, APK side): implement StickCommandHandler.kt in the
   * Android APK. It should:
   *   1. Subscribe to the tenant Redis WS channel (already done for player).
   *   2. Filter for type === 'STICK_COMMAND'.
   *   3. Verify the HMAC signature via WebAppBridge.verifySignedMessage().
   *   4. Route payload.command to the appropriate client:
   *        roku       → RokuEcpClient.send(stickIp, command, appId)
   *        fire-tv    → FireTvAdbClient.send(stickIp, command, appId)
   *        apple-tv   → AppleTvCompanionClient.send(stickIp, command, appId)
   *        chromecast → ChromecastCastV2Client.launch(appId)
   *        android-tv → AdbClient.send(stickIp, command)
   *   5. POST the result back to GET /:stickId/status (via HTTP + device JWT)
   *      so the dashboard widget can flip from 'launching' → 'ready'.
   *
   * @returns { queued: true, command, stickId }
   */
  @Post(':stickId/command')
  async command(
    @Request() req: any,
    @Param('stickId') stickId: string,
    @Body() body: { command?: StickCommand; appId?: string },
  ): Promise<{ queued: boolean; command: string; stickId: string }> {
    const tenantId: string = req.user.tenantId;
    const sticks = getForTenant(tenantId);
    const stick = sticks.find((s) => s.id === stickId);

    if (!stick) {
      throw new HttpException('Stick not found', HttpStatus.NOT_FOUND);
    }

    const cmd = body.command;
    if (!cmd) {
      throw new HttpException('command is required', HttpStatus.BAD_REQUEST);
    }

    if (cmd === 'launch_app' && !body.appId) {
      throw new HttpException('appId is required for launch_app command', HttpStatus.BAD_REQUEST);
    }

    // Phase-1: log command for observability.
    console.log(
      `[StickControl] tenant=${tenantId} stick=${stickId} (${stick.name} @ ${stick.ip}) cmd=${cmd}` +
        (body.appId ? ` appId=${body.appId}` : ''),
    );

    // Sign + publish to the tenant's Redis channel.
    // The Android kiosk APK (paired player on the gym's LAN) subscribes to
    // this channel and will execute the actual Roku ECP / Fire TV ADB call.
    const signed = this.signer.signMessage('STICK_COMMAND', {
      stickId,
      stickName: stick.name,
      stickType: stick.type,
      stickIp: stick.ip,
      command: cmd,
      appId: body.appId ?? null,
      requestedBy: req.user.id ?? req.user.userId ?? null,
    });

    try {
      await this.redisService.publish(`tenant:${tenantId}`, signed);
    } catch (e) {
      // Non-fatal: Redis publish failure doesn't block the API response.
      // The kiosk will retry on its next poll cycle, and the gym's staff
      // can re-issue the command from the dashboard.
      console.warn('[StickControl] Redis publish failed:', (e as Error).message);
    }

    return { queued: true, command: cmd, stickId };
  }

  // ─── GET /:stickId/status — read last-known stick status ───────────────────

  /**
   * Return the last-known status of a specific stick.
   *
   * Phase-1: echoes what is stored in the in-memory record. The kiosk
   * APK updates the status by calling this endpoint with a PATCH body
   * once it confirms the LAN command succeeded or the stick stopped
   * responding. That PATCH endpoint will be added in phase-2 alongside
   * the Prisma migration and the APK relay handler.
   *
   * @returns { id, name, type, ip, room, status, lastSeenAt }
   */
  @Get(':stickId/status')
  getStatus(
    @Request() req: any,
    @Param('stickId') stickId: string,
  ): Omit<StickRecord, 'tenantId'> {
    const tenantId: string = req.user.tenantId;
    const stick = getForTenant(tenantId).find((s) => s.id === stickId);

    if (!stick) {
      throw new HttpException('Stick not found', HttpStatus.NOT_FOUND);
    }

    const { tenantId: _t, ...rest } = stick;
    return rest;
  }
}
