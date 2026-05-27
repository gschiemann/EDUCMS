/**
 * HardwareController — read-only catalog endpoint for the dashboard's
 * Hardware panel.
 *
 * 2026-05-27 — foundation layer. With the Goodview EP6N now the canonical
 * sports-vertical player (commit 39f8ac2 / docs/EP6N_HARDWARE_EVAL.md),
 * the dashboard needs to render:
 *   - A dropdown of every known hardware model (per-screen Diagnostics)
 *   - Capability badges accurate to the picked model
 *   - A Chromium-83 warning chip on Taurus deployments
 *
 * One source of truth: packages/api-types/src/hardware-models.ts. This
 * controller is a thin pass-through so the dashboard never imports
 * `@cms/api-types` at runtime (clean API/UI separation; the API owns
 * the contract).
 *
 * Auth: JwtAuthGuard only. Every authenticated role can read the catalog
 * — no tenant data leaks (the catalog is product-level constant data).
 * RBAC for who can MUTATE a Screen's hardwareModel lives in the screens
 * controller's existing PUT /:id endpoint (SUPER/DISTRICT/SCHOOL_ADMIN).
 *
 * Cache: the catalog is a build-time constant, so we serialize it
 * once at boot and ship a strong `Cache-Control: public, max-age=3600`
 * — the operator picks a model once per screen at install time. The
 * dashboard React Query layer also caches in-process per session.
 */

import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  HARDWARE_CATALOG,
  HARDWARE_MODELS,
  type HardwareCapabilities,
  type HardwareModel,
} from '@cms/api-types';

interface HardwareCatalogEntry extends HardwareCapabilities {
  /** The canonical model id (e.g. 'goodview-ep6n'). */
  id: HardwareModel;
}

interface HardwareCatalogResponse {
  /** Catalog rows, in display order. */
  models: HardwareCatalogEntry[];
  /** When the catalog was built (boot time of this API instance). */
  generatedAt: string;
}

// Build the response once at module load. The catalog is a static
// constant; we don't pay a serialization cost per request.
const CATALOG_RESPONSE: HardwareCatalogResponse = {
  models: HARDWARE_MODELS.map((id) => ({ id, ...HARDWARE_CATALOG[id] })),
  generatedAt: new Date().toISOString(),
};

@Controller('api/v1/hardware')
@UseGuards(JwtAuthGuard)
export class HardwareController {
  /**
   * GET /api/v1/hardware/catalog
   *
   * Returns the static HARDWARE_CATALOG plus a generatedAt timestamp
   * so a dashboard can detect a redeploy and invalidate its cache.
   * One hour Cache-Control matches React Query's default stale-time
   * for product-constant data.
   */
  @Get('catalog')
  catalog(@Res({ passthrough: true }) res: Response): HardwareCatalogResponse {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return CATALOG_RESPONSE;
  }
}
