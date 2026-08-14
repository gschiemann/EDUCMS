/**
 * DisplayVendorRecipesController — SUPER_ADMIN CRUD for vendor display
 * recipes.
 *
 *   GET    /api/v1/display-recipes
 *   PUT    /api/v1/display-recipes/:vendorId   (upsert)
 *   DELETE /api/v1/display-recipes/:vendorId
 *
 * WHY THIS EXISTS: "a new vendor is a DB row, not an APK release." Goodview,
 * Taurus and TCL each expose brightness/blank/wake through a different
 * broadcast, sysfs node or Settings key. Rather than bake a vendor SDK into
 * the player we ship the RECIPE and a generic executor runs it. Without a
 * write path that promise would be a costume, so it lives here.
 *
 * PLATFORM-OWNED, NOT TENANT-OWNED. A recipe describes a hardware SKU, not a
 * customer's data, and every tenant with that SKU needs the same one — hence
 * no tenantId on the model and SUPER_ADMIN-only writes. The AuditLog row
 * still needs a tenant (the column is non-null), so it is written against
 * the acting SUPER_ADMIN's own tenant.
 *
 * ⚠️ THE RECIPE IS UNTRUSTED INPUT AT THE PLAYER. What is validated here is
 * STRUCTURE (DisplayVendorRecipeSchema). The SECURITY boundary is the
 * player's native allowlist, which no recipe can widen:
 *   - sysfs paths must canonicalize (symlinks resolved, no "..") under
 *     /sys/class/backlight/ or /sys/class/leds/ — nothing else, ever;
 *   - broadcast actions must match an allowlisted prefix set, with no
 *     explicit component/package targeting and no extras beyond the typed
 *     ones in the schema;
 *   - Settings writes are limited to Settings.System — never Secure, never
 *     Global;
 *   - no shell execution of any kind.
 * A recipe failing that validation is REJECTED WHOLE and logged, never
 * partially applied. Do NOT relax the schema here on the assumption that the
 * device will catch it: defence in depth means both ends refuse.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AppRole } from '@cms/database';
import {
  DisplayVendorRecipeUpsertSchema,
  type DisplayVendorRecipeUpsertInput,
} from '@cms/api-types';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { clearDisplayManifestCache } from './display-manifest';
import { DISPLAY_AUDIT_ACTIONS, DisplayService } from './display.service';

@Controller('api/v1/display-recipes')
@UseGuards(JwtAuthGuard, RbacGuard)
export class DisplayVendorRecipesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly display: DisplayService,
  ) {}

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN)
  async list() {
    return this.prisma.client.displayVendorRecipe.findMany({
      orderBy: [{ priority: 'desc' }, { vendorId: 'asc' }],
    });
  }

  @Put(':vendorId')
  @RequireRoles(AppRole.SUPER_ADMIN)
  async upsert(
    @Param('vendorId') vendorId: string,
    @Req() req: any,
    @Body(new ZodValidationPipe(DisplayVendorRecipeUpsertSchema))
    body: DisplayVendorRecipeUpsertInput,
  ) {
    if (body.recipe.vendorId !== vendorId) {
      throw new HttpException(
        {
          code: 'DISPLAY_RECIPE_VENDOR_MISMATCH',
          message: `recipe.vendorId ('${body.recipe.vendorId}') must match the path ('${vendorId}')`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const row = await this.prisma.client.displayVendorRecipe.upsert({
      where: { vendorId },
      create: {
        vendorId,
        name: body.name,
        recipe: body.recipe as any,
        isActive: body.isActive ?? true,
        priority: body.priority ?? 0,
        notes: body.notes ?? null,
      } as any,
      update: {
        name: body.name,
        recipe: body.recipe as any,
        isActive: body.isActive ?? true,
        priority: body.priority ?? 0,
        notes: body.notes ?? null,
      } as any,
    });

    // The manifest block memoises the catalog against the manifest content
    // rev; DisplayVendorRecipe is in MANIFEST_FED_MODELS so the Prisma hook
    // already bumps it. Clearing here too costs nothing and makes the change
    // visible even if that hook is ever unarmed (it is skipped in tests).
    clearDisplayManifestCache();

    const tenantId =
      req.user?.tenantId || req.user?.schoolId || req.user?.districtId || null;
    if (tenantId) {
      await this.display.writeAudit({
        action: DISPLAY_AUDIT_ACTIONS.RECIPE_UPSERTED,
        targetType: 'display_vendor_recipe',
        targetId: vendorId,
        tenantId,
        userId: req.user?.id ?? req.user?.userId ?? null,
        details: {
          name: body.name,
          isActive: body.isActive ?? true,
          priority: body.priority ?? 0,
        },
      });
    }
    return row;
  }

  @Delete(':vendorId')
  @RequireRoles(AppRole.SUPER_ADMIN)
  async remove(@Param('vendorId') vendorId: string, @Req() req: any) {
    const result = await this.prisma.client.displayVendorRecipe.deleteMany({
      where: { vendorId },
    });
    if (result.count === 0) {
      throw new HttpException(
        {
          code: 'DISPLAY_RECIPE_NOT_FOUND',
          message: 'Vendor recipe not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }
    clearDisplayManifestCache();
    const tenantId =
      req.user?.tenantId || req.user?.schoolId || req.user?.districtId || null;
    if (tenantId) {
      await this.display.writeAudit({
        action: DISPLAY_AUDIT_ACTIONS.RECIPE_DELETED,
        targetType: 'display_vendor_recipe',
        targetId: vendorId,
        tenantId,
        userId: req.user?.id ?? req.user?.userId ?? null,
        details: {},
      });
    }
    return { success: true };
  }
}
