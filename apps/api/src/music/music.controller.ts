/**
 * MusicController — endpoints supporting the MusicPlayerWidget.
 *
 *   GET    /api/v1/music/somafm/stations    — curated SomaFM stations
 *   POST   /api/v1/music/npr-stations       — NPR station finder by lat/lng
 *   GET    /api/v1/music/oauth/spotify/redirect — placeholder OAuth start
 *   GET    /api/v1/music/oauth/apple/redirect  — placeholder OAuth start
 *
 * Created 2026-05-25 (music-overhaul). The widget itself works without
 * any of these — SomaFM and NTS stream URLs are hard-coded in
 * MusicPlayerWidget.tsx. These endpoints exist so the Properties
 * panel can populate dropdowns + the operator can start the
 * Apple/Spotify OAuth flow once credentials are configured.
 *
 * OAuth scaffolding is deliberately NOT live. We surface
 * "Coming soon — Notify me when ready" on the widget itself; the
 * redirect endpoints below 503 if the env vars aren't set, which
 * matches how billing degrades when STRIPE_SECRET_KEY is missing
 * (see CLAUDE.md billing setup). To turn on Spotify-for-Business:
 *   - Create a Spotify Developer app, get client_id + client_secret
 *   - Set SPOTIFY_BUSINESS_CLIENT_ID / SPOTIFY_BUSINESS_CLIENT_SECRET
 *   - Redirect URI: https://<your-domain>/api/v1/music/oauth/spotify/callback
 * Apple Music for Business is a B2B commercial agreement — we add the
 * env vars APPLE_MUSIC_TEAM_ID / APPLE_MUSIC_KEY_ID / APPLE_MUSIC_PRIVATE_KEY
 * once the partnership ships.
 */
import { Body, Controller, Get, Post, Query, Request, Res, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { MusicService } from './music.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/music')
export class MusicController {
  constructor(private readonly svc: MusicService) {}

  @Get('somafm/stations')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER)
  listSomafmStations() {
    return this.svc.listSomafmStations();
  }

  // The widget exposes a "find local NPR stations" picker in
  // Properties. The operator pastes lat/lng (from the Sprint 8 fleet-
  // map screen-positioning UI), we return the nearest stations.
  @Post('npr-stations')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  findNprStations(@Body() body: { latitude: number; longitude: number; radius?: number }) {
    return this.svc.findNprStations({
      latitude: Number(body?.latitude),
      longitude: Number(body?.longitude),
      radiusKm: Math.max(5, Math.min(500, Number(body?.radius) || 80)),
    });
  }

  // Placeholder OAuth-start endpoints. When the env vars are absent
  // we 503 with a clear message — the widget UI already shows the
  // "Coming soon — Notify me" mailto: CTA, so the operator never
  // hits these by accident in the field. Kept here so the OAuth
  // route is reserved for when the partnership lands.
  @Get('oauth/spotify/redirect')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  spotifyOauthStart(@Request() req: any, @Res() res: Response) {
    const clientId = process.env.SPOTIFY_BUSINESS_CLIENT_ID;
    if (!clientId) {
      throw new ServiceUnavailableException(
        'Spotify for Business OAuth not configured. Set SPOTIFY_BUSINESS_CLIENT_ID and SPOTIFY_BUSINESS_CLIENT_SECRET to enable.',
      );
    }
    // Placeholder — real OAuth flow lands when commercial agreement
    // is finalized. The redirect URI must match what the operator
    // registered in their Spotify Developer app.
    const redirectUri = process.env.SPOTIFY_BUSINESS_REDIRECT_URI
      || `https://${req.headers.host}/api/v1/music/oauth/spotify/callback`;
    const state = Buffer.from(JSON.stringify({ tenantId: req.user.tenantId, userId: req.user.id })).toString('base64url');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'streaming user-read-playback-state user-modify-playback-state',
      redirect_uri: redirectUri,
      state,
    });
    return res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
  }

  @Get('oauth/apple/redirect')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  appleOauthStart() {
    const teamId = process.env.APPLE_MUSIC_TEAM_ID;
    if (!teamId) {
      throw new ServiceUnavailableException(
        'Apple Music for Business is not configured for this deploy. The partnership / developer-token signing chain is pending — contact sales@venueos.com for activation status.',
      );
    }
    // Apple Music's developer-token flow is signed JWT not OAuth —
    // this endpoint exists as a uniform entry point for the widget
    // UI but the real handshake will be a different shape once we
    // light it up. Kept as placeholder.
    throw new ServiceUnavailableException('Apple Music for Business activation in progress — sales is finalizing the agreement.');
  }
}
