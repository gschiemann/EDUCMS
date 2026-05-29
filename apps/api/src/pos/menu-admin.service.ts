/**
 * MenuAdminService — operator-facing price-book console backend.
 * ──────────────────────────────────────────────────────────────────────
 *
 * The ADMIN half of menu-management-at-scale (2026-05-29). The device
 * read (`GET /screens/:id/menu`) and the webhook ingest live in
 * MenuService; this service powers the dashboard console at
 * `/[schoolId]/menu` (apps/web/src/lib/menu/menu-console-api.ts is the
 * contract). It owns:
 *
 *   • GET  /menu/catalog                                — grid rows (central catalog)
 *   • GET  /menu/locations                              — grid columns (child-location tenants)
 *   • GET  /menu/overrides                              — every per-location override (cells)
 *   • PUT  /menu/overrides/:locationTenantId/:menuItemId — upsert ONE override
 *   • DELETE /menu/overrides/:locationTenantId/:menuItemId — revert ONE override
 *   • POST /menu/overrides/bulk                         — apply across many locations (transactional)
 *   • POST /menu/import                                 — operator self-serve {menu} import (→ MenuService)
 *
 * Every method is tenant-scoped to the AUTHENTICATED user's tenant — the
 * caller passes `tenantId` derived from req.user, never from the body.
 * Item ids and location ids in the URL are verified to belong to the
 * tenant before any write, so a SCHOOL_ADMIN can't reach into another
 * tenant's price book by pasting a foreign uuid (cross-tenant IDOR
 * defense). Resolution logic is NOT reimplemented — the console mirrors
 * it client-side; the server stores raw overrides.
 *
 * MIRRORS pos.service.ts / menu.service.ts conventions: tenant from the
 * authed actor, `(this.prisma.client as any)` for the freshly-generated
 * menu models, AuditLog on every mutation (with before/after for price
 * changes), no per-row audit on bulk (one summary row).
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MenuService } from './menu.service';

/** One catalog row as the console grid renders it. Shape matches
 *  MenuCatalogItem in menu-console-api.ts. */
export interface AdminCatalogItem {
  id: string;
  externalId: string;
  name: string;
  description?: string;
  defaultPriceCents: number;
  category?: string;
  badges?: string[];
  imageUrl?: string;
  available: boolean;
}

/** One location (grid column). Shape matches MenuLocation. */
export interface AdminLocation {
  id: string;
  name: string;
  slug: string;
}

/** One per-location override (grid cell). Shape matches MenuOverride. */
export interface AdminOverride {
  locationTenantId: string;
  menuItemId: string;
  priceCents: number | null;
  isAvailable: boolean;
  soldOutUntil: string | null;
  isHidden: boolean;
}

/** A patch to apply to one override. Shape matches SetOverridePatch.
 *  `priceCents: null` reverts the price to inherited; `undefined` leaves
 *  it unchanged. */
export interface OverridePatch {
  priceCents?: number | null;
  isAvailable?: boolean;
  soldOutUntil?: string | null;
  isHidden?: boolean;
}

@Injectable()
export class MenuAdminService {
  private readonly logger = new Logger(MenuAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly menu: MenuService,
  ) {}

  // ─── Catalog (grid rows) ──────────────────────────────────────────

  /**
   * The tenant's central catalog items. One row per MenuItem across every
   * active catalog the tenant owns. There is no central per-item on/off
   * flag in the schema (visibility is per-location via overrides), so
   * `available` is always true at the catalog level — a location 86 lives
   * on the override, surfaced through the overrides read.
   */
  async listCatalog(tenantId: string): Promise<AdminCatalogItem[]> {
    const catalogs = await (this.prisma.client as any).menuCatalog.findMany({
      where: { tenantId, isActive: true },
      select: { id: true },
    });
    if (catalogs.length === 0) return [];
    const catalogIds = catalogs.map((c: any) => c.id);

    const [items, categories] = await Promise.all([
      (this.prisma.client as any).menuItem.findMany({
        where: { catalogId: { in: catalogIds } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      (this.prisma.client as any).menuCategory.findMany({
        where: { catalogId: { in: catalogIds } },
        select: { id: true, name: true },
      }),
    ]);

    const categoryNameById = new Map<string, string>();
    for (const c of categories) categoryNameById.set(c.id, c.name);

    return items.map(
      (i: any): AdminCatalogItem => ({
        id: i.id,
        externalId: i.externalId ?? i.id,
        name: i.name,
        description: i.description ?? undefined,
        defaultPriceCents: i.defaultPriceCents,
        category: i.categoryId
          ? (categoryNameById.get(i.categoryId) ?? undefined)
          : undefined,
        badges: [...(i.tags ?? []), ...(i.allergens ?? [])].filter(Boolean),
        imageUrl: i.imageUrl ?? undefined,
        available: true,
      }),
    );
  }

  // ─── Locations (grid columns) ─────────────────────────────────────

  /**
   * The tenant's locations = its child tenants (Tenant.parentId === this
   * tenant). A single-location operator (no children) gets the tenant
   * itself back as the one location, so the grid always renders at least
   * one column. Mirrors fetchMenuLocations() in the frontend, but
   * server-resolved so the console doesn't depend on the broader
   * /tenants/accessible payload.
   */
  async listLocations(tenantId: string): Promise<AdminLocation[]> {
    const children = await this.prisma.client.tenant.findMany({
      where: { parentId: tenantId },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    });
    if (children.length > 0) {
      return children.map((t) => ({ id: t.id, name: t.name, slug: t.slug }));
    }
    const self = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true },
    });
    return self ? [{ id: self.id, name: self.name, slug: self.slug }] : [];
  }

  /** The set of location-tenant ids the caller's tenant may write
   *  overrides for: its child tenants + itself (single-location case). */
  private async allowedLocationIds(tenantId: string): Promise<Set<string>> {
    const children = await this.prisma.client.tenant.findMany({
      where: { parentId: tenantId },
      select: { id: true },
    });
    const set = new Set<string>(children.map((c) => c.id));
    set.add(tenantId); // single-location operators target their own tenant
    return set;
  }

  // ─── Overrides (grid cells) ───────────────────────────────────────

  /** Every per-location override for the tenant's price book. Scoped by
   *  the override row's own tenantId (set on write to the caller's
   *  tenant), so there's no cross-tenant leakage. */
  async listOverrides(tenantId: string): Promise<AdminOverride[]> {
    const rows = await (
      this.prisma.client as any
    ).menuLocationOverride.findMany({
      where: { tenantId },
    });
    return rows.map(
      (r: any): AdminOverride => ({
        locationTenantId: r.locationTenantId,
        menuItemId: r.menuItemId,
        priceCents: r.priceCents ?? null,
        isAvailable: r.isAvailable !== false,
        soldOutUntil: r.soldOutUntil
          ? new Date(r.soldOutUntil).toISOString()
          : null,
        isHidden: r.isHidden === true,
      }),
    );
  }

  /** Load a menu item and assert it belongs to one of the caller tenant's
   *  catalogs. Returns the item or throws 404 (never reveals foreign
   *  items). */
  private async requireOwnedItem(
    tenantId: string,
    menuItemId: string,
  ): Promise<{ id: string }> {
    const item = await (this.prisma.client as any).menuItem.findFirst({
      where: { id: menuItemId, tenantId },
      select: { id: true },
    });
    if (!item)
      throw new NotFoundException('Menu item not found in this tenant.');
    return item;
  }

  /**
   * Upsert ONE per-location override (PUT /menu/overrides/:loc/:item).
   *
   * Semantics (matching the frontend contract):
   *   • priceCents: a number   → set the override price at this location.
   *   • priceCents: null       → revert the PRICE to inherited. If nothing
   *                              else on the row diverges from default
   *                              (available, not hidden, no sold-out
   *                              window), the whole row is deleted (full
   *                              inherit). Otherwise just the price clears.
   *   • priceCents: undefined  → leave the price unchanged.
   *   • isAvailable / isHidden / soldOutUntil → set when provided.
   *
   * Returns the resulting override (or a synthetic "all-inherited"
   * override when the row was deleted) so the client can normalize it.
   */
  async setOverride(
    tenantId: string,
    userId: string | null,
    locationTenantId: string,
    menuItemId: string,
    patch: OverridePatch,
  ): Promise<AdminOverride> {
    await this.requireOwnedItem(tenantId, menuItemId);

    const allowed = await this.allowedLocationIds(tenantId);
    if (!allowed.has(locationTenantId)) {
      throw new NotFoundException('Location not found in this tenant.');
    }

    const existing = await (
      this.prisma.client as any
    ).menuLocationOverride.findUnique({
      where: { locationTenantId_menuItemId: { locationTenantId, menuItemId } },
    });
    const before = existing?.priceCents ?? null;

    // Compute the resulting field values from existing + patch.
    const next = {
      priceCents:
        patch.priceCents === undefined
          ? (existing?.priceCents ?? null)
          : patch.priceCents, // number or explicit null
      isAvailable:
        patch.isAvailable === undefined
          ? (existing?.isAvailable ?? true)
          : !!patch.isAvailable,
      isHidden:
        patch.isHidden === undefined
          ? (existing?.isHidden ?? false)
          : !!patch.isHidden,
      soldOutUntil:
        patch.soldOutUntil === undefined
          ? (existing?.soldOutUntil ?? null)
          : this.coerceDate(patch.soldOutUntil),
    };

    // If the resulting row carries NO divergence from the inherited
    // default, delete it entirely (clean "revert to inherited"). This is
    // the behaviour the frontend's setOverride() doc describes for a
    // null-price patch.
    const isInheritDefault =
      next.priceCents === null &&
      next.isAvailable === true &&
      next.isHidden === false &&
      next.soldOutUntil === null;

    if (isInheritDefault) {
      if (existing) {
        await (this.prisma.client as any).menuLocationOverride.delete({
          where: {
            locationTenantId_menuItemId: { locationTenantId, menuItemId },
          },
        });
      }
      await this.audit(tenantId, userId, 'MENU_OVERRIDE_REVERT', menuItemId, {
        locationTenantId,
        menuItemId,
        priceBefore: before,
        priceAfter: null,
      });
      return {
        locationTenantId,
        menuItemId,
        priceCents: null,
        isAvailable: true,
        soldOutUntil: null,
        isHidden: false,
      };
    }

    const row = await (this.prisma.client as any).menuLocationOverride.upsert({
      where: { locationTenantId_menuItemId: { locationTenantId, menuItemId } },
      update: {
        priceCents: next.priceCents,
        isAvailable: next.isAvailable,
        isHidden: next.isHidden,
        soldOutUntil: next.soldOutUntil,
        source: 'manual',
      },
      create: {
        tenantId,
        locationTenantId,
        menuItemId,
        priceCents: next.priceCents,
        isAvailable: next.isAvailable,
        isHidden: next.isHidden,
        soldOutUntil: next.soldOutUntil,
        source: 'manual',
      },
    });

    await this.audit(tenantId, userId, 'MENU_OVERRIDE_SET', menuItemId, {
      locationTenantId,
      menuItemId,
      priceBefore: before,
      priceAfter: row.priceCents ?? null,
      isAvailable: row.isAvailable,
      isHidden: row.isHidden,
    });

    return {
      locationTenantId: row.locationTenantId,
      menuItemId: row.menuItemId,
      priceCents: row.priceCents ?? null,
      isAvailable: row.isAvailable !== false,
      soldOutUntil: row.soldOutUntil
        ? new Date(row.soldOutUntil).toISOString()
        : null,
      isHidden: row.isHidden === true,
    };
  }

  /** Delete ONE override entirely — full revert-to-inherited
   *  (DELETE /menu/overrides/:loc/:item). Idempotent: deleting a
   *  non-existent override is a no-op success. */
  async deleteOverride(
    tenantId: string,
    userId: string | null,
    locationTenantId: string,
    menuItemId: string,
  ): Promise<void> {
    await this.requireOwnedItem(tenantId, menuItemId);

    const existing = await (
      this.prisma.client as any
    ).menuLocationOverride.findUnique({
      where: { locationTenantId_menuItemId: { locationTenantId, menuItemId } },
      select: { tenantId: true, priceCents: true },
    });
    // Only delete a row that belongs to this tenant (defense-in-depth —
    // the override carries its own tenantId).
    if (existing && existing.tenantId === tenantId) {
      await (this.prisma.client as any).menuLocationOverride.delete({
        where: {
          locationTenantId_menuItemId: { locationTenantId, menuItemId },
        },
      });
      await this.audit(tenantId, userId, 'MENU_OVERRIDE_REVERT', menuItemId, {
        locationTenantId,
        menuItemId,
        priceBefore: existing.priceCents ?? null,
        priceAfter: null,
      });
    }
  }

  // ─── Bulk (the 50-location killer feature) ────────────────────────

  /**
   * Apply one patch across many locations for one item in a single
   * transaction (POST /menu/overrides/bulk). Empty/omitted
   * `locationTenantIds` = ALL of the tenant's locations. Each target is
   * upserted with the same delete-on-inherit-default rule as setOverride.
   *
   * One summary AuditLog row (high-write path; per-location rows would
   * spam the log).
   */
  async bulkSetOverride(
    tenantId: string,
    userId: string | null,
    body: {
      menuItemId?: string;
      locationTenantIds?: string[];
      patch?: OverridePatch;
    },
  ): Promise<{ updated: number }> {
    const menuItemId = String(body?.menuItemId ?? '').trim();
    if (!menuItemId) throw new BadRequestException('menuItemId is required.');
    const patch = body?.patch ?? {};
    if (
      patch.priceCents === undefined &&
      patch.isAvailable === undefined &&
      patch.isHidden === undefined &&
      patch.soldOutUntil === undefined
    ) {
      throw new BadRequestException(
        'patch must set at least one of priceCents / isAvailable / isHidden / soldOutUntil.',
      );
    }

    await this.requireOwnedItem(tenantId, menuItemId);

    const allowed = await this.allowedLocationIds(tenantId);
    let targets: string[];
    if (
      Array.isArray(body.locationTenantIds) &&
      body.locationTenantIds.length > 0
    ) {
      // Filter the requested set down to locations the tenant actually
      // owns — silently dropping foreign ids rather than 404'ing the whole
      // batch (a stale UID in a bulk set shouldn't fail the rest).
      targets = body.locationTenantIds.filter((id) => allowed.has(id));
      if (targets.length === 0) {
        throw new NotFoundException(
          'None of the supplied locations belong to this tenant.',
        );
      }
    } else {
      targets = Array.from(allowed);
    }

    const soldOut =
      patch.soldOutUntil === undefined
        ? undefined
        : this.coerceDate(patch.soldOutUntil);

    let updated = 0;
    await this.prisma.client.$transaction(async (tx) => {
      const orm = (tx as any).menuLocationOverride;
      for (const locationTenantId of targets) {
        const existing = await orm.findUnique({
          where: {
            locationTenantId_menuItemId: { locationTenantId, menuItemId },
          },
        });
        const next = {
          priceCents:
            patch.priceCents === undefined
              ? (existing?.priceCents ?? null)
              : patch.priceCents,
          isAvailable:
            patch.isAvailable === undefined
              ? (existing?.isAvailable ?? true)
              : !!patch.isAvailable,
          isHidden:
            patch.isHidden === undefined
              ? (existing?.isHidden ?? false)
              : !!patch.isHidden,
          soldOutUntil:
            soldOut === undefined ? (existing?.soldOutUntil ?? null) : soldOut,
        };

        const isInheritDefault =
          next.priceCents === null &&
          next.isAvailable === true &&
          next.isHidden === false &&
          next.soldOutUntil === null;

        if (isInheritDefault) {
          if (existing) {
            await orm.delete({
              where: {
                locationTenantId_menuItemId: { locationTenantId, menuItemId },
              },
            });
            updated++;
          }
          continue;
        }

        await orm.upsert({
          where: {
            locationTenantId_menuItemId: { locationTenantId, menuItemId },
          },
          update: {
            priceCents: next.priceCents,
            isAvailable: next.isAvailable,
            isHidden: next.isHidden,
            soldOutUntil: next.soldOutUntil,
            source: 'manual',
          },
          create: {
            tenantId,
            locationTenantId,
            menuItemId,
            priceCents: next.priceCents,
            isAvailable: next.isAvailable,
            isHidden: next.isHidden,
            soldOutUntil: next.soldOutUntil,
            source: 'manual',
          },
        });
        updated++;
      }
    });

    await this.audit(tenantId, userId, 'MENU_OVERRIDE_BULK', menuItemId, {
      menuItemId,
      locationsTargeted: targets.length,
      updated,
      patch: {
        priceCents: patch.priceCents,
        isAvailable: patch.isAvailable,
        isHidden: patch.isHidden,
        soldOutUntil: patch.soldOutUntil,
      },
    });

    return { updated };
  }

  // ─── Import (delegates to MenuService) ────────────────────────────

  /** Operator self-serve {menu} import (POST /menu/import). Wraps the
   *  custom-webhook ingest logic but session/JWT-authed + user-attributed.
   *  Returns `imported` (the count the frontend reads). */
  async importMenu(
    tenantId: string,
    userId: string | null,
    body: { menu?: unknown; catalogId?: unknown; catalogName?: unknown },
  ): Promise<{ imported: number; skipped: number; catalogId: string }> {
    const res = await this.menu.ingestOperatorMenu(tenantId, userId, body);
    return {
      imported: res.imported,
      skipped: res.skipped,
      catalogId: res.catalogId,
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────

  /** Parse an ISO/epoch date to a Date, or null. */
  private coerceDate(v: unknown): Date | null {
    if (v == null) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    if (typeof v === 'number' && Number.isFinite(v)) {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof v === 'string' && v.trim() !== '') {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  /** AuditLog helper for price-book mutations. Best-effort (a failed audit
   *  write logs a warning but doesn't fail the mutation — matches the
   *  existing menu/pos audit helpers). */
  private async audit(
    tenantId: string,
    userId: string | null,
    action: string,
    targetId: string,
    details: Record<string, unknown>,
  ) {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId,
          action,
          targetType: 'MenuLocationOverride',
          targetId,
          details: JSON.stringify(details),
        },
      });
    } catch (err: any) {
      this.logger.warn(`audit ${action} failed: ${err?.message || err}`);
    }
  }
}
