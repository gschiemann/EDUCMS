/**
 * The publish-time VIDEO gate (video guarantee step 5, 2026-10-12;
 * docs/research/2026-10-11-launch-readiness/02-video-guarantee.md §4.3).
 *
 * Owner rule (Greg, 2026-10-11): "If a video is going to stutter, we better
 * keep them from putting that video on the screen." For every (target screen,
 * video in the playlist) the gate asks the shared pure `decidePlayback`
 * (@cms/api-types) with the screen's capability profile — measured on this
 * screen → measured on its model → declared by its WebView → class default →
 * unknown — and reports what it found:
 *
 *   VIDEO_PLAYBACK_GATE = warn (default) | enforce | off
 *     warn    — the publish goes through exactly as before; the response
 *               carries `playbackWarnings` naming the file and the screen(s)
 *               ("this video may stutter on <screen>; we will switch that
 *               screen to the 1080p copy automatically if it does").
 *     enforce — a file that cannot play smoothly on a screen and that no copy
 *               fixes is refused (422 VIDEO_SCREEN_CANNOT_PLAY) before any
 *               row is written, so the previous content stays on screen.
 *               Exception, owner decision B: a two-sided unit is NEVER
 *               refused (it must eventually play any combination natively) —
 *               it stays a warning in every mode.
 *     off     — nothing is evaluated.
 *
 * Unknown NEVER warns or blocks (no evidence → `unverified` → ok). A gate that
 * cannot run (a DB blip) says nothing and blocks nothing. Emergency playlists
 * (protected, or wired into the alert pipeline — the shared fail-closed check)
 * are never evaluated.
 *
 * Concurrency demand per screen: this playlist's video (1) + the template's
 * VIDEO zones + the unit's other faces that will (MIRROR of the target, or
 * targeted by this same publish) or currently do (a video sample in the last
 * few minutes) play video. The player's hidden next-up pre-mount is NOT
 * predicted here — it is measured (`screen_file_playback.concurrent_max`).
 */
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  decidePlayback,
  gateFinding,
  playbackGateMode,
  type PlaybackGateFinding,
} from '@cms/api-types';
import { PrismaService } from '../prisma/prisma.service';
import { playlistEmergencyUse } from '../emergency/emergency-content-use';
import { loadPlaybackCapability, type ClassEvidence } from '../telemetry/playback-capability.loader';
import { valid1080pRendition } from '../screens/video-rendition';
import { loadDemotedSources } from '../screens/playback-demotions';
import { normalizeFaceContentMode } from '../screens/screen-faces';

/** A screen's sibling face counts as "playing video now" when it reported a sample this recently. */
const SIBLING_VIDEO_WINDOW_MS = 150_000;
/** Target screens evaluated per publish (a group bigger than this is evaluated on its first N). */
export const PLAYBACK_GATE_SCREEN_LIMIT = 200;

export type PlaybackGateReason = 'capability' | 'measured-stutter' | 'over-capability' | 'concurrency' | 'two-sided';

/** One warning: one file, one reason, the screens it applies to. */
export interface PlaybackGateWarning {
  code: 'VIDEO_MAY_STUTTER' | 'VIDEO_SCREEN_CANNOT_PLAY';
  reason: PlaybackGateReason;
  assetId: string;
  /** The name the operator sees in the Media Library. */
  file: string;
  screens: Array<{ id: string; name: string }>;
  /** A validated 1080p copy exists (the closed loop can switch to it). */
  hasLighterCopy: boolean;
  max?: number;
  demand?: number;
  /** English; the dashboard translates from the fields above. */
  message: string;
}

export interface PlaybackGateResult {
  mode: ReturnType<typeof playbackGateMode>;
  warnings: PlaybackGateWarning[];
  /** Assets with a may-stutter finding and no 1080p copy yet — the caller queues one (never holds the publish). */
  copyWanted: Array<{ id: string; fileUrl: string; fileSize: number | null }>;
}

const RESOLUTION = /^\s*(\d+)\s*[x×X*]\s*(\d+)\s*$/;
const panelShortEdge = (resolution: string | null | undefined): number | null => {
  const m = RESOLUTION.exec(resolution ?? '');
  return m ? Math.min(Number(m[1]), Number(m[2])) : null;
};

function videoShape(meta: unknown): { shortEdge: number; longEdge: number; fps: number | null } | null {
  const m = (meta && typeof meta === 'object' ? meta : {}) as Record<string, any>;
  const dims = m.processedDimensions ?? m.originalDimensions;
  const w = Number(dims?.w ?? m.probe?.codedWidth ?? m.probe?.width);
  const h = Number(dims?.h ?? m.probe?.codedHeight ?? m.probe?.height);
  if (!(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)) return null;
  const fps = Number(m.probe?.fps);
  return { shortEdge: Math.min(w, h), longEdge: Math.max(w, h), fps: Number.isFinite(fps) && fps > 0 ? fps : null };
}

const fileNameOf = (asset: { id: string; originalName?: string | null; fileUrl?: string | null }): string => {
  const own = (asset.originalName || '').replace(/\s+/g, ' ').trim();
  if (own) return own;
  try {
    const last = decodeURIComponent(new URL(asset.fileUrl || '').pathname.split('/').pop() || '').trim();
    if (last) return last;
  } catch {
    /* not a URL */
  }
  return asset.id;
};

const listNames = (names: string[]): string => {
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
};

/** The English sentence for one warning (the dashboard translates from the fields). */
export function playbackGateMessage(w: Omit<PlaybackGateWarning, 'message'>): string {
  const where = listNames(w.screens.map((s) => s.name));
  const file = `“${w.file}”`;
  switch (w.reason) {
    case 'capability':
      return `${file} may stutter on ${where}. If it does, we will switch that screen to the 1080p copy automatically.`;
    case 'two-sided':
      return `${file} may stutter on ${where}: both sides of this display can't play video smoothly at the same time yet. It will keep playing.`;
    case 'concurrency':
      return `${file} may stutter on ${where}: it would play ${w.demand ?? 2} videos at once, and this screen plays ${w.max ?? 1} smoothly. It will keep playing.`;
    case 'measured-stutter':
      return `${file} may stutter on ${where}: this screen stuttered on video this size before, even with the lighter copy. It will keep playing.`;
    case 'over-capability':
    default:
      return `${file} may stutter on ${where}: this screen plays video up to ${w.max ?? 30} frames per second, and this video needs ${w.demand ?? 'more'}. It will keep playing.`;
  }
}

@Injectable()
export class PlaybackGateService {
  private readonly logger = new Logger(PlaybackGateService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get db(): any {
    return this.prisma.client as any;
  }

  /**
   * Evaluate one activation (a playlist onto a screen or a group). Throws the
   * 422 only in `enforce` mode; otherwise returns the warnings. Never throws
   * for its own failures.
   */
  async evaluate(tenantId: string, playlistId: string, screenId?: string | null, groupId?: string | null): Promise<PlaybackGateResult> {
    const mode = playbackGateMode(process.env);
    const empty: PlaybackGateResult = { mode, warnings: [], copyWanted: [] };
    if (mode === 'off' || (!screenId && !groupId)) return empty;
    let result: PlaybackGateResult;
    try {
      result = await this.run(tenantId, playlistId, screenId ?? null, groupId ?? null, mode);
    } catch (err) {
      // A gate that cannot run says nothing and blocks nothing.
      this.logger.warn(`[video-gate] could not evaluate playlist ${playlistId}: ${(err as Error)?.message ?? err}`);
      return empty;
    }
    if (mode === 'enforce') {
      const refused = result.warnings.filter((w) => w.code === 'VIDEO_SCREEN_CANNOT_PLAY' && w.reason !== 'two-sided');
      if (refused.length) throw playbackCannotPlayRefusal(refused);
    }
    return result;
  }

  private async run(
    tenantId: string,
    playlistId: string,
    screenId: string | null,
    groupId: string | null,
    mode: PlaybackGateResult['mode'],
  ): Promise<PlaybackGateResult> {
    const out: PlaybackGateResult = { mode, warnings: [], copyWanted: [] };
    const playlist = await this.db.playlist.findFirst({
      where: { id: playlistId, tenantId },
      select: {
        id: true,
        isProtected: true,
        items: {
          select: {
            asset: { select: { id: true, originalName: true, fileUrl: true, fileHash: true, fileSize: true, mimeType: true, processingMeta: true } },
          },
        },
        template: { select: { zones: { select: { widgetType: true } } } },
      },
    });
    if (!playlist || playlist.isProtected) return out;
    // Emergency content is never gated (fail-closed: a check that cannot run → skip).
    if ((await playlistEmergencyUse(this.db, [playlistId])) !== null) return out;

    const videos = new Map<string, any>();
    for (const item of playlist.items ?? []) {
      const a = item?.asset;
      if (a && typeof a.mimeType === 'string' && a.mimeType.startsWith('video/')) videos.set(a.id, a);
    }
    if (videos.size === 0) return out;
    const videoZones = (playlist.template?.zones ?? []).filter((z: any) => String(z?.widgetType).toUpperCase() === 'VIDEO').length;

    const screens: any[] = await this.db.screen.findMany({
      where: {
        tenantId,
        OR: [...(screenId ? [{ id: screenId }] : []), ...(groupId ? [{ screenGroupId: groupId }] : [])],
      },
      select: {
        id: true, name: true, tenantId: true, resolution: true, playerVersionCode: true, displayCapabilities: true,
        faceOfScreenId: true, faceContentMode: true,
      },
      take: PLAYBACK_GATE_SCREEN_LIMIT,
    });
    if (screens.length === 0) return out;
    const targetIds = new Set(screens.map((s) => s.id));
    const now = Date.now();
    const classCache = new Map<string, Promise<ClassEvidence>>();

    type Key = string;
    const grouped = new Map<Key, PlaybackGateWarning>();
    const add = (asset: any, f: Exclude<PlaybackGateFinding, { kind: 'ok' }>, screen: any) => {
      const code = f.kind === 'may-stutter' ? 'VIDEO_MAY_STUTTER' : 'VIDEO_SCREEN_CANNOT_PLAY';
      const reason: PlaybackGateReason = f.kind === 'may-stutter'
        ? 'capability'
        : f.reason === 'concurrency' && f.twoSided ? 'two-sided' : f.reason;
      const key = `${asset.id}|${code}|${reason}`;
      const has = !!valid1080pRendition(asset.processingMeta);
      const w: PlaybackGateWarning = grouped.get(key) ?? {
        code, reason, assetId: asset.id, file: fileNameOf(asset), screens: [], hasLighterCopy: has,
        ...(f.kind === 'cannot-play' && f.detail.max !== undefined ? { max: f.detail.max } : {}),
        ...(f.kind === 'cannot-play' && f.detail.demand !== undefined ? { demand: f.detail.demand } : {}),
        message: '',
      };
      if (!w.screens.some((s) => s.id === screen.id)) w.screens.push({ id: screen.id, name: screen.name || 'Screen' });
      grouped.set(key, w);
    };

    for (const screen of screens) {
      if (!screen.tenantId) continue;
      // The physical unit this screen belongs to (a double-sided display's faces are rows).
      const primaryId: string = screen.faceOfScreenId ?? screen.id;
      const unit: any[] = await this.db.screen.findMany({
        where: { tenantId, OR: [{ id: primaryId }, { faceOfScreenId: primaryId }] },
        select: { id: true, faceOfScreenId: true, faceContentMode: true, lastVideoReportAt: true },
        take: 8,
      });
      const twoSided = unit.length > 1;
      let siblingsWithVideo = 0;
      for (const o of unit) {
        if (o.id === screen.id) continue;
        const oMirrorsPrimary = !!o.faceOfScreenId && normalizeFaceContentMode(o.faceContentMode) === 'MIRROR';
        const selfMirrorsPrimary = !!screen.faceOfScreenId && normalizeFaceContentMode(screen.faceContentMode) === 'MIRROR';
        const mirrorsThis = (screen.id === primaryId && oMirrorsPrimary) || (selfMirrorsPrimary && o.id === primaryId);
        const recent = o.lastVideoReportAt ? now - new Date(o.lastVideoReportAt).getTime() <= SIBLING_VIDEO_WINDOW_MS : false;
        if (mirrorsThis || targetIds.has(o.id) || recent) siblingsWithVideo += 1;
      }
      const unitConcurrent = 1 + videoZones + siblingsWithVideo;

      const { capability } = await loadPlaybackCapability(this.db, screen, { classCache });
      const demoted = await loadDemotedSources(this.db, screen.id, tenantId);
      const panel = panelShortEdge(screen.resolution);
      for (const asset of videos.values()) {
        const shape = videoShape(asset.processingMeta);
        if (!shape) continue; // unknown size never warns
        const has1080p = !!valid1080pRendition(asset.processingMeta);
        const decision = decidePlayback(
          capability,
          { shortEdge: shape.shortEdge, longEdge: shape.longEdge, fps: shape.fps, panelShortEdge: panel, unitConcurrentVideos: unitConcurrent },
          { has1080p },
        );
        const finding = gateFinding(decision, {
          panelShortEdge: panel,
          twoSided,
          demoted: typeof asset.fileHash === 'string' && demoted.has(asset.fileHash.toLowerCase()),
          has1080p,
        });
        if (finding.kind === 'ok') continue;
        add(asset, finding, screen);
        if (finding.kind === 'may-stutter' && !has1080p && !out.copyWanted.some((c) => c.id === asset.id)) {
          out.copyWanted.push({ id: asset.id, fileUrl: asset.fileUrl, fileSize: asset.fileSize ?? null });
        }
      }
    }
    out.warnings = [...grouped.values()].map((w) => ({ ...w, message: playbackGateMessage(w) }));
    if (out.warnings.length) {
      this.logger.log(`[video-gate] ${mode}: ${out.warnings.length} warning(s) for playlist ${playlistId} — ${out.warnings.map((w) => `${w.reason}:${w.assetId}×${w.screens.length}`).join(', ')}`);
    }
    return out;
  }
}

/** The enforce-mode refusal: names every file and screen; nothing was written. */
export function playbackCannotPlayRefusal(warnings: PlaybackGateWarning[]): HttpException {
  const files = [...new Map(warnings.map((w) => [w.assetId, { assetId: w.assetId, name: w.file }] as const)).values()];
  const screens = [...new Map(warnings.flatMap((w) => w.screens).map((s) => [s.id, s] as const)).values()];
  return new HttpException(
    {
      code: 'VIDEO_SCREEN_CANNOT_PLAY',
      message: `${warnings.map((w) => w.message).join(' ')} The previous content stays on screen.`,
      files: files.slice(0, 100),
      screens: screens.slice(0, 100),
      warnings: warnings.slice(0, 50),
      reason: warnings[0]?.reason ?? null,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}
