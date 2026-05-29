/**
 * MenuService — design-once catalog + per-location override resolution.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Menu-management-at-scale (2026-05-29). The data model the codebase
 * audit said was missing: a CENTRAL catalog ("design once") whose items
 * carry a DEFAULT price, plus per-location OVERRIDES (the "price book")
 * for price + availability + 86. See
 * docs/research/2026-05-29-menu-mgmt-scale/.
 *
 * This service owns three responsibilities:
 *
 *   1. resolveMenuForLocation(locationTenantId, daypart?)
 *      — the heart. Joins MenuItem (default price) with this location's
 *        MenuLocationOverride rows and applies the resolution rule:
 *          price   = override.priceCents ?? item.defaultPriceCents
 *          visible = !isHidden && isAvailable
 *                    && (soldOutUntil == null || soldOutUntil < now)
 *        Dayparting filters categories by the LOCATION's local time.
 *
 *   2. ingestCustomWebhookMenu(conn, payload)
 *      — extends the bring-your-own-POS custom-webhook handler to accept
 *        a { menu: [...] } payload: upsert MenuItem + per-location
 *        MenuLocationOverride rows. Tenant ALWAYS comes from the
 *        connection (never client input). AuditLog'd.
 *
 *   3. applyAutoEightySix(conn, items)
 *      — flips MenuLocationOverride.isAvailable=false (+ soldOutUntil)
 *        when a POS reports an item out of stock (Square
 *        `inventory.count.updated` or custom-webhook
 *        { items:[{externalId, available:false}] }). The hide-filter in
 *        resolveMenuForLocation already exists; this provides the SIGNAL.
 *
 * MIRRORS pos.service.ts conventions: `(this.prisma.client as any)` for
 * the freshly-generated models, connection-derived tenant, idempotency
 * via ProcessedPosEvent, AuditLog on every config mutation.
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** A single resolved menu item as a location's screen should render it.
 *  Shape is intentionally compatible with what MenuBoardWidget maps
 *  (name / description / priceCents / badges) so the device endpoint
 *  drops straight into the existing renderer. */
export interface ResolvedMenuItem {
  id: string;
  externalId: string | null;
  name: string;
  description: string | null;
  /** Resolved per-location price (override ?? default), in cents. */
  priceCents: number;
  /** True when this location overrode the default price. */
  priceOverridden: boolean;
  imageUrl: string | null;
  allergens: string[];
  tags: string[];
  category: string | null;
  categoryId: string | null;
  sortOrder: number;
}

export interface ResolvedMenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  /** Daypart this category is bound to, if any (already filtered out of
   *  the result when not active — present for debugging / UI hints). */
  daypartId: string | null;
}

export interface ResolvedMenu {
  locationTenantId: string;
  generatedAt: string;
  categories: ResolvedMenuCategory[];
  items: ResolvedMenuItem[];
}

@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Resolution — the heart ───────────────────────────────────────

  /**
   * Resolve the menu a given LOCATION should display right now.
   *
   * @param locationTenantId the child (location) tenant whose overrides
   *   apply. NEVER client-supplied — callers derive it from a verified
   *   token / connection / screen row.
   * @param opts.catalogTenantId optional owning tenant to scope catalogs
   *   to. When the location tenant differs from the catalog-owning chain
   *   tenant (the normal multi-location case), pass the chain tenant id;
   *   otherwise catalogs owned by the location tenant itself are used.
   * @param opts.catalogId optional — resolve a single catalog only.
   * @param opts.now injectable clock for tests.
   * @param opts.includeHidden when true, returns hidden/86'd items too
   *   (with a flag) — for an admin price-book console preview. Defaults
   *   false (player path → only visible items).
   */
  async resolveMenuForLocation(
    locationTenantId: string,
    opts?: {
      catalogTenantId?: string;
      catalogId?: string;
      now?: Date;
      includeHidden?: boolean;
    },
  ): Promise<ResolvedMenu> {
    const now = opts?.now ?? new Date();
    // Catalogs are owned by the chain tenant (or, for a single-location
    // operator, the location tenant itself). Default to the location
    // tenant's own catalogs when no chain tenant is given.
    const catalogTenantId = opts?.catalogTenantId ?? locationTenantId;

    const catalogWhere: any = { tenantId: catalogTenantId, isActive: true };
    if (opts?.catalogId) catalogWhere.id = opts.catalogId;

    const catalogs = await (this.prisma.client as any).menuCatalog.findMany({
      where: catalogWhere,
      select: { id: true },
    });
    if (catalogs.length === 0) {
      return { locationTenantId, generatedAt: now.toISOString(), categories: [], items: [] };
    }
    const catalogIds = catalogs.map((c: any) => c.id);

    // Pull categories (with daypart) + items in two scoped queries, plus
    // this location's overrides keyed by menuItemId.
    const [categories, items] = await Promise.all([
      (this.prisma.client as any).menuCategory.findMany({
        where: { catalogId: { in: catalogIds } },
        include: { daypart: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      (this.prisma.client as any).menuItem.findMany({
        where: { catalogId: { in: catalogIds } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);

    const itemIds = items.map((i: any) => i.id);
    const overrides =
      itemIds.length === 0
        ? []
        : await (this.prisma.client as any).menuLocationOverride.findMany({
            where: { locationTenantId, menuItemId: { in: itemIds } },
          });
    const overrideByItem = new Map<string, any>();
    for (const o of overrides) overrideByItem.set(o.menuItemId, o);

    // Which categories are active right now (daypart filter by the
    // location's local time). A category with no daypart is always active.
    const activeCategoryIds = new Set<string>();
    const resolvedCategories: ResolvedMenuCategory[] = [];
    const categoryNameById = new Map<string, string>();
    for (const cat of categories) {
      categoryNameById.set(cat.id, cat.name);
      const active = !cat.daypart || this.isDaypartActive(cat.daypart, now);
      if (active) {
        activeCategoryIds.add(cat.id);
        resolvedCategories.push({
          id: cat.id,
          name: cat.name,
          sortOrder: cat.sortOrder,
          daypartId: cat.daypartId ?? null,
        });
      }
    }

    const resolvedItems: ResolvedMenuItem[] = [];
    for (const item of items) {
      // Items in a category that's currently dayparted-out are dropped
      // (unless includeHidden). Items with no category are always eligible.
      if (item.categoryId && !activeCategoryIds.has(item.categoryId) && !opts?.includeHidden) {
        continue;
      }
      const ov = overrideByItem.get(item.id);
      const visible = this.isItemVisible(ov, now);
      if (!visible && !opts?.includeHidden) continue;

      const priceOverridden = ov?.priceCents != null;
      const priceCents = priceOverridden ? ov.priceCents : item.defaultPriceCents;
      resolvedItems.push({
        id: item.id,
        externalId: item.externalId ?? null,
        name: item.name,
        description: item.description ?? null,
        priceCents,
        priceOverridden,
        imageUrl: item.imageUrl ?? null,
        allergens: item.allergens ?? [],
        tags: item.tags ?? [],
        category: item.categoryId ? categoryNameById.get(item.categoryId) ?? null : null,
        categoryId: item.categoryId ?? null,
        sortOrder: item.sortOrder,
      });
    }

    return {
      locationTenantId,
      generatedAt: now.toISOString(),
      categories: resolvedCategories,
      items: resolvedItems,
    };
  }

  /**
   * Is a menu-location override currently "available"?
   *   visible = !isHidden && isAvailable
   *             && (soldOutUntil == null || soldOutUntil < now)
   * No override row → item inherits the catalog default and is visible.
   */
  isItemVisible(override: any | undefined | null, now: Date = new Date()): boolean {
    if (!override) return true;
    if (override.isHidden) return false;
    if (override.isAvailable === false) return false;
    if (override.soldOutUntil && new Date(override.soldOutUntil).getTime() > now.getTime()) {
      // still inside the temporary sold-out window
      return false;
    }
    return true;
  }

  /**
   * Is a daypart active at `now` in its own timezone? A daypart is active
   * when (a) today's local weekday is in `daysOfWeek` (empty = every day)
   * AND (b) the local time is within [timeStart, timeEnd] (wraparound
   * supported). Mirrors player-ota's isInsideMaintenanceWindow tz logic.
   *
   * Safety: a malformed daypart (bad tz / bad HH:MM) → active (least
   * surprising: the category stays visible rather than vanishing).
   */
  isDaypartActive(daypart: any, now: Date = new Date()): boolean {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: daypart.timezone,
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
      });
      const parts = fmt.formatToParts(now);
      const hh = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
      const mm = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
      const wkLabel = parts.find((p) => p.type === 'weekday')?.value || '';
      const WK: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const dow = WK[wkLabel];

      const days: number[] = Array.isArray(daypart.daysOfWeek) ? daypart.daysOfWeek : [];
      if (days.length > 0 && dow != null && !days.includes(dow)) return false;

      const [sh, sm] = String(daypart.timeStart).split(':').map((n: string) => parseInt(n, 10));
      const [eh, em] = String(daypart.timeEnd).split(':').map((n: string) => parseInt(n, 10));
      if (![sh, sm, eh, em].every(Number.isFinite)) return true; // malformed → active

      const nowMin = hh * 60 + mm;
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      if (startMin === endMin) return true; // zero-length = treat as all-day
      if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
      // Wraparound (e.g. 22:00 → 02:00): active after start OR before end.
      return nowMin >= startMin || nowMin < endMin;
    } catch {
      return true; // bad config → active (don't vanish content)
    }
  }

  // ─── Custom-webhook { menu } ingest ───────────────────────────────

  /**
   * Ingest a custom-webhook `{ menu: [...] }` push. Each entry is an item
   * with a default price + optional per-location overrides + availability.
   * Upserts MenuItem (by catalog+externalId) and, for each `locations`
   * entry, a MenuLocationOverride (by location+item).
   *
   * The connection (already resolved from the shared secret) determines
   * the tenant — the body NEVER carries a tenantId, and we never trust one
   * if present.
   *
   * Documented payload shape:
   *   {
   *     menu: [
   *       {
   *         externalId | id,            // stable id (required)
   *         name,                       // required
   *         description?, imageUrl?,
   *         defaultPriceCents | price,  // base price (cents or major-unit)
   *         category?,                  // category NAME (auto-created)
   *         allergens?: string[], tags?: string[],
   *         sortOrder?: number,
   *         locations?: [               // per-location overrides
   *           { locationTenantId | locationId,   // which location (required)
   *             priceCents | price?,             // null/absent = inherit
   *             isAvailable?: boolean,           // 86 flag
   *             soldOutUntil?: ISO string,
   *             isHidden?: boolean }
   *         ]
   *       }, ...
   *     ],
   *     catalogId?: string,             // target a specific catalog
   *     catalogName?: string            // or name the auto-created one
   *   }
   *
   * Idempotency: the caller (controller) claims the event via
   * ProcessedPosEvent before invoking this when an event id is present.
   * High-write hot path — no per-item audit; one summary AuditLog row.
   */
  async ingestCustomWebhookMenu(
    conn: any,
    payload: { menu?: unknown; catalogId?: unknown; catalogName?: unknown },
  ): Promise<{ itemsUpserted: number; overridesUpserted: number; skipped: number; catalogId: string }> {
    const rawMenu = Array.isArray((payload as any)?.menu) ? (payload as any).menu : null;
    if (!rawMenu) {
      throw new BadRequestException('Body must be { "menu": [ ... ] }.');
    }
    if (rawMenu.length > 2000) {
      throw new BadRequestException('Too many menu items in one push (max 2000). Split into batches.');
    }

    const tenantId = conn.tenantId as string;
    const catalog = await this.resolveOrCreateCatalog(
      tenantId,
      conn.id,
      typeof payload.catalogId === 'string' ? payload.catalogId : undefined,
      typeof payload.catalogName === 'string' ? payload.catalogName : undefined,
    );

    // Cache category name → id within this catalog so repeated category
    // names across items don't re-query / re-create.
    const categoryIdByName = new Map<string, string>();

    let itemsUpserted = 0;
    let overridesUpserted = 0;
    let skipped = 0;

    for (const raw of rawMenu) {
      const norm = this.normalizeMenuItem(raw);
      if (!norm) {
        skipped++;
        continue;
      }

      let categoryId: string | null = null;
      if (norm.category) {
        categoryId = await this.resolveOrCreateCategory(
          tenantId,
          catalog.id,
          norm.category,
          categoryIdByName,
        );
      }

      const item = await (this.prisma.client as any).menuItem.upsert({
        where: { catalogId_externalId: { catalogId: catalog.id, externalId: norm.externalId } },
        update: {
          name: norm.name,
          description: norm.description,
          defaultPriceCents: norm.defaultPriceCents,
          imageUrl: norm.imageUrl,
          allergens: norm.allergens,
          tags: norm.tags,
          sortOrder: norm.sortOrder,
          ...(categoryId ? { categoryId } : {}),
        },
        create: {
          tenantId,
          catalogId: catalog.id,
          categoryId,
          externalId: norm.externalId,
          name: norm.name,
          description: norm.description,
          defaultPriceCents: norm.defaultPriceCents,
          imageUrl: norm.imageUrl,
          allergens: norm.allergens,
          tags: norm.tags,
          sortOrder: norm.sortOrder,
        },
      });
      itemsUpserted++;

      // Per-location overrides.
      for (const loc of norm.locations) {
        await (this.prisma.client as any).menuLocationOverride.upsert({
          where: {
            locationTenantId_menuItemId: {
              locationTenantId: loc.locationTenantId,
              menuItemId: item.id,
            },
          },
          update: {
            priceCents: loc.priceCents,
            isAvailable: loc.isAvailable,
            soldOutUntil: loc.soldOutUntil,
            isHidden: loc.isHidden,
            source: 'custom-webhook',
          },
          create: {
            tenantId,
            locationTenantId: loc.locationTenantId,
            menuItemId: item.id,
            priceCents: loc.priceCents,
            isAvailable: loc.isAvailable,
            soldOutUntil: loc.soldOutUntil,
            isHidden: loc.isHidden,
            source: 'custom-webhook',
          },
        });
        overridesUpserted++;
      }
    }

    await this.audit(tenantId, null, 'MENU_INGEST_CUSTOM_WEBHOOK', catalog.id, {
      connectionId: conn.id,
      itemsUpserted,
      overridesUpserted,
      skipped,
    });

    return { itemsUpserted, overridesUpserted, skipped, catalogId: catalog.id };
  }

  // ─── Auto-86 ──────────────────────────────────────────────────────

  /**
   * Apply an auto-86 signal: mark items unavailable (optionally with a
   * soldOutUntil timer) for one or more locations. Drives:
   *   • custom-webhook { items: [{ externalId, available:false,
   *       soldOutUntil?, locationTenantId? }] }
   *   • Square inventory.count.updated (handled in MenuSquareSync, which
   *     resolves Square variation ids → externalId + location, then calls
   *     this).
   *
   * If an entry has no `locationTenantId`, the 86 applies to EVERY mapped
   * location for the connection (chain-wide 86 — "we're out of the
   * pumpkin spice everywhere"). Resolves the item by catalog+externalId
   * within the connection's catalogs.
   *
   * Setting `available:true` clears the 86 (isAvailable=true,
   * soldOutUntil=null) for the targeted location(s).
   *
   * Tenant always from the connection. AuditLog'd.
   */
  async applyAutoEightySix(
    conn: any,
    entries: Array<{
      externalId: string;
      available: boolean;
      soldOutUntil?: Date | null;
      locationTenantId?: string | null;
    }>,
  ): Promise<{ overridesUpdated: number; itemsMatched: number; skipped: number }> {
    const tenantId = conn.tenantId as string;

    // All catalogs for this connection's tenant + this connection.
    const catalogs = await (this.prisma.client as any).menuCatalog.findMany({
      where: { tenantId, OR: [{ connectionId: conn.id }, { connectionId: null }] },
      select: { id: true },
    });
    const catalogIds = catalogs.map((c: any) => c.id);
    if (catalogIds.length === 0) {
      return { overridesUpdated: 0, itemsMatched: 0, skipped: entries.length };
    }

    // Mapped locations for this connection (for chain-wide 86 fan-out).
    const posLocations = await (this.prisma.client as any).posLocation.findMany({
      where: { connectionId: conn.id, locationTenantId: { not: null } },
      select: { locationTenantId: true },
    });
    const mappedLocationTenantIds: string[] = posLocations
      .map((l: any) => l.locationTenantId)
      .filter(Boolean);

    let overridesUpdated = 0;
    let itemsMatched = 0;
    let skipped = 0;

    for (const entry of entries) {
      const externalId = String(entry?.externalId ?? '').trim();
      if (!externalId) {
        skipped++;
        continue;
      }
      const item = await (this.prisma.client as any).menuItem.findFirst({
        where: { catalogId: { in: catalogIds }, externalId },
        select: { id: true },
      });
      if (!item) {
        skipped++;
        continue;
      }
      itemsMatched++;

      const targetLocations = entry.locationTenantId
        ? [entry.locationTenantId]
        : mappedLocationTenantIds;
      if (targetLocations.length === 0) {
        // No location to scope to — skip (a chain-wide 86 with zero
        // mapped locations is a no-op, not an error).
        continue;
      }

      const isAvailable = entry.available === true;
      const soldOutUntil = isAvailable ? null : entry.soldOutUntil ?? null;

      for (const locationTenantId of targetLocations) {
        await (this.prisma.client as any).menuLocationOverride.upsert({
          where: {
            locationTenantId_menuItemId: { locationTenantId, menuItemId: item.id },
          },
          update: { isAvailable, soldOutUntil, source: conn.providerId || 'auto-86' },
          create: {
            tenantId,
            locationTenantId,
            menuItemId: item.id,
            isAvailable,
            soldOutUntil,
            // priceCents intentionally left null → inherits default; an
            // 86 must never silently wipe a location's price override.
            source: conn.providerId || 'auto-86',
          },
        });
        overridesUpdated++;
      }
    }

    await this.audit(tenantId, null, 'MENU_AUTO_86', conn.id, {
      connectionId: conn.id,
      entries: entries.length,
      itemsMatched,
      overridesUpdated,
      skipped,
    });

    return { overridesUpdated, itemsMatched, skipped };
  }

  /**
   * Apply a Square `inventory.count.updated` payload as auto-86. Square
   * `inventory_counts[]` carry `catalog_object_id` (the item VARIATION
   * id), `location_id`, `quantity`, and `state`. We:
   *   • resolve `location_id` → our locationTenantId via PosLocation
   *     (skip counts for locations we haven't mapped),
   *   • resolve `catalog_object_id` → our MenuItem externalId (Square
   *     sync stores it as `${itemId}:${variationId}`, so we match a
   *     MenuItem whose externalId == the variation id OR ends with
   *     `:${variationId}`),
   *   • flip availability: quantity <= 0 (or state OUT_OF_STOCK / NONE)
   *     → isAvailable=false; otherwise restore (isAvailable=true).
   *
   * Tenant from the connection. Reuses the override upsert in
   * applyAutoEightySix via per-(item,location) writes. AuditLog'd.
   */
  async applySquareInventoryCounts(
    conn: any,
    counts: Array<{
      catalog_object_id?: string;
      location_id?: string;
      quantity?: string | number;
      state?: string;
    }>,
  ): Promise<{ overridesUpdated: number; itemsMatched: number; skipped: number }> {
    const tenantId = conn.tenantId as string;

    // location_id → locationTenantId for THIS connection's mapped stores.
    const posLocations = await (this.prisma.client as any).posLocation.findMany({
      where: { connectionId: conn.id, locationTenantId: { not: null } },
      select: { externalId: true, locationTenantId: true },
    });
    const locTenantByExternal = new Map<string, string>();
    for (const l of posLocations) locTenantByExternal.set(l.externalId, l.locationTenantId);

    // Catalogs (and their items) for this connection's tenant.
    const catalogs = await (this.prisma.client as any).menuCatalog.findMany({
      where: { tenantId, OR: [{ connectionId: conn.id }, { connectionId: null }] },
      select: { id: true },
    });
    const catalogIds = catalogs.map((c: any) => c.id);
    if (catalogIds.length === 0) {
      return { overridesUpdated: 0, itemsMatched: 0, skipped: counts.length };
    }

    let overridesUpdated = 0;
    let itemsMatched = 0;
    let skipped = 0;

    for (const c of counts) {
      const variationId = String(c?.catalog_object_id ?? '').trim();
      const locationExternalId = String(c?.location_id ?? '').trim();
      if (!variationId || !locationExternalId) {
        skipped++;
        continue;
      }
      const locationTenantId = locTenantByExternal.get(locationExternalId);
      if (!locationTenantId) {
        // Inventory for a location we don't manage — ignore.
        skipped++;
        continue;
      }

      // Match the MenuItem: exact externalId, or the `${itemId}:${variationId}`
      // form Square's catalog sync produces.
      const item = await (this.prisma.client as any).menuItem.findFirst({
        where: {
          catalogId: { in: catalogIds },
          OR: [{ externalId: variationId }, { externalId: { endsWith: `:${variationId}` } }],
        },
        select: { id: true },
      });
      if (!item) {
        skipped++;
        continue;
      }
      itemsMatched++;

      const qty = typeof c.quantity === 'string' ? Number(c.quantity) : c.quantity;
      const state = String(c?.state ?? '').toUpperCase();
      const outOfStock =
        state === 'OUT_OF_STOCK' || state === 'NONE' || (Number.isFinite(qty as number) && (qty as number) <= 0);

      await (this.prisma.client as any).menuLocationOverride.upsert({
        where: {
          locationTenantId_menuItemId: { locationTenantId, menuItemId: item.id },
        },
        update: {
          isAvailable: !outOfStock,
          // Square restocks restore availability; no temporary timer here
          // (Square's count IS the source of truth, re-fired on restock).
          soldOutUntil: null,
          source: 'square',
        },
        create: {
          tenantId,
          locationTenantId,
          menuItemId: item.id,
          isAvailable: !outOfStock,
          soldOutUntil: null,
          source: 'square',
        },
      });
      overridesUpdated++;
    }

    await this.audit(tenantId, null, 'MENU_AUTO_86', conn.id, {
      connectionId: conn.id,
      provider: 'square',
      counts: counts.length,
      itemsMatched,
      overridesUpdated,
      skipped,
    });

    return { overridesUpdated, itemsMatched, skipped };
  }

  // ─── helpers ──────────────────────────────────────────────────────

  /** Find (or create) the catalog this push targets. A custom-webhook
   *  connection gets one default catalog unless an explicit id/name is
   *  given. */
  private async resolveOrCreateCatalog(
    tenantId: string,
    connectionId: string,
    catalogId?: string,
    catalogName?: string,
  ): Promise<{ id: string }> {
    if (catalogId) {
      const found = await (this.prisma.client as any).menuCatalog.findFirst({
        where: { id: catalogId, tenantId },
        select: { id: true },
      });
      if (found) return found;
      // An explicit id that doesn't belong to this tenant is rejected —
      // never write into another tenant's catalog.
      throw new BadRequestException('catalogId not found for this connection.');
    }
    // Reuse the connection's existing catalog if one exists; else create.
    const existing = await (this.prisma.client as any).menuCatalog.findFirst({
      where: { tenantId, connectionId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;
    const created = await (this.prisma.client as any).menuCatalog.create({
      data: {
        tenantId,
        connectionId,
        name: catalogName || 'Menu',
        isActive: true,
      },
      select: { id: true },
    });
    return created;
  }

  /** Find (or create) a category by NAME within a catalog. POS providers
   *  rarely expose stable category ids, so we key on the human name. */
  private async resolveOrCreateCategory(
    tenantId: string,
    catalogId: string,
    name: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const cached = cache.get(name);
    if (cached) return cached;
    const existing = await (this.prisma.client as any).menuCategory.findFirst({
      where: { catalogId, name },
      select: { id: true },
    });
    if (existing) {
      cache.set(name, existing.id);
      return existing.id;
    }
    const created = await (this.prisma.client as any).menuCategory.create({
      data: { tenantId, catalogId, name },
      select: { id: true },
    });
    cache.set(name, created.id);
    return created.id;
  }

  /** Coerce one inbound { menu } entry to our MenuItem shape + parsed
   *  per-location overrides, or null if it lacks the minimum (id + name). */
  private normalizeMenuItem(raw: any): {
    externalId: string;
    name: string;
    description: string | null;
    defaultPriceCents: number;
    imageUrl: string | null;
    allergens: string[];
    tags: string[];
    sortOrder: number;
    category: string | null;
    locations: Array<{
      locationTenantId: string;
      priceCents: number | null;
      isAvailable: boolean;
      soldOutUntil: Date | null;
      isHidden: boolean;
    }>;
  } | null {
    if (!raw || typeof raw !== 'object') return null;
    const externalId = String(raw.externalId ?? raw.id ?? '').trim();
    const name = String(raw.name ?? '').trim();
    if (!externalId || !name) return null;

    const defaultPriceCents = this.coercePriceCents(
      raw.defaultPriceCents ?? raw.priceCents,
      raw.price,
    );

    const allergens = this.coerceStringArray(raw.allergens).slice(0, 24);
    const tags = this.coerceStringArray(raw.tags).slice(0, 24);
    const sortOrder = Number.isFinite(Number(raw.sortOrder)) ? Math.trunc(Number(raw.sortOrder)) : 0;

    const rawLocations = Array.isArray(raw.locations) ? raw.locations : [];
    const locations: Array<{
      locationTenantId: string;
      priceCents: number | null;
      isAvailable: boolean;
      soldOutUntil: Date | null;
      isHidden: boolean;
    }> = [];
    for (const lraw of rawLocations) {
      if (!lraw || typeof lraw !== 'object') continue;
      const locationTenantId = String(lraw.locationTenantId ?? lraw.locationId ?? '').trim();
      if (!locationTenantId) continue;
      // priceCents: explicit null/absent = inherit (null). A given value
      // is coerced; we DON'T fall back to 0 here (0 would be a real free
      // price), so only set when a parseable value is present.
      let priceCents: number | null = null;
      if (lraw.priceCents != null || lraw.price != null) {
        priceCents = this.coercePriceCentsOrNull(lraw.priceCents, lraw.price);
      }
      locations.push({
        locationTenantId,
        priceCents,
        isAvailable: lraw.isAvailable === false ? false : true,
        soldOutUntil: this.coerceDate(lraw.soldOutUntil),
        isHidden: lraw.isHidden === true,
      });
    }

    return {
      externalId,
      name,
      description: raw.description != null ? String(raw.description) : null,
      defaultPriceCents,
      imageUrl: raw.imageUrl != null ? String(raw.imageUrl) : null,
      allergens,
      tags,
      sortOrder,
      category: raw.category != null ? String(raw.category) : null,
      locations,
    };
  }

  private coerceStringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x)).filter(Boolean);
  }

  /** Non-negative integer cents (0 on anything unparseable). */
  private coercePriceCents(cents: unknown, major: unknown): number {
    const n = this.coercePriceCentsOrNull(cents, major);
    return n == null ? 0 : n;
  }

  /** Integer cents or null when nothing parseable was supplied. Accepts
   *  integer cents (`priceCents`) or a major-unit number/string (`price`,
   *  e.g. 7.99 → 799). */
  private coercePriceCentsOrNull(cents: unknown, major: unknown): number | null {
    if (typeof cents === 'number' && Number.isFinite(cents)) {
      return Math.max(0, Math.round(cents));
    }
    if (typeof cents === 'string' && cents.trim() !== '' && Number.isFinite(Number(cents))) {
      return Math.max(0, Math.round(Number(cents)));
    }
    const m = typeof major === 'string' ? Number(major) : major;
    if (typeof m === 'number' && Number.isFinite(m)) {
      return Math.max(0, Math.round(m * 100));
    }
    return null;
  }

  /** Parse an ISO date string / epoch ms into a Date, or null. */
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

  /** AuditLog helper for menu config mutations. Mirrors PosService.audit. */
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
          targetType: 'MenuCatalog',
          targetId,
          details: JSON.stringify(details),
        },
      });
    } catch (err: any) {
      this.logger.warn(`audit ${action} failed: ${err?.message || err}`);
    }
  }
}
