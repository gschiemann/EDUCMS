import {
  Controller, Get, Post, Put, Delete, Body, Param, Query,
  UseGuards, Request, HttpException, HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { SYSTEM_TEMPLATE_PRESETS } from './system-presets';

@Controller('api/v1/templates')
@UseGuards(JwtAuthGuard, RbacGuard)
export class TemplatesController {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────
  // LIST — tenant templates + system presets
  // ───────────────────────────────────────────────────────

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(
    @Request() req: any,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('includeSystem') includeSystem?: string,
  ) {
    const tenantId = req.user.tenantId;

    const where: any = {
      OR: [
        { tenantId },
        // Always include system templates so teachers see presets
        ...(includeSystem !== 'false' ? [{ isSystem: true }] : []),
      ],
    };

    if (category) where.category = category;
    if (status) where.status = status;

    return this.prisma.client.template.findMany({
      where,
      include: {
        zones: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { zones: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  // ───────────────────────────────────────────────────────
  // GET — single template with all zones
  // ───────────────────────────────────────────────────────

  @Get('system/presets')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async getSystemPresets() {
    // Return the in-memory preset definitions (for UI to show even before seeding)
    return SYSTEM_TEMPLATE_PRESETS;
  }

  @Get('widget-types')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async getWidgetTypes() {
    // Returns available widget types with metadata for the template builder UI
    return WIDGET_TYPE_CATALOG;
  }

  @Get(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async get(@Request() req: any, @Param('id') id: string) {
    const template = await this.prisma.client.template.findFirst({
      where: {
        id,
        OR: [{ tenantId: req.user.tenantId }, { isSystem: true }],
      },
      include: {
        zones: { orderBy: { sortOrder: 'asc' } },
        createdBy: { select: { id: true, email: true, role: true } },
      },
    });
    if (!template) return { error: 'Not found' };
    return template;
  }

  // ───────────────────────────────────────────────────────
  // CREATE — new template with optional initial zones
  // ───────────────────────────────────────────────────────

  @Post()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async create(
    @Request() req: any,
    @Body() body: {
      name: string;
      description?: string;
      category?: string;
      orientation?: string;
      screenWidth?: number;
      screenHeight?: number;
      bgColor?: string;
      bgImage?: string;
      bgGradient?: string;
      zones?: Array<{
        name: string;
        widgetType: string;
        x: number;
        y: number;
        width: number;
        height: number;
        zIndex?: number;
        sortOrder?: number;
        defaultConfig?: any;
      }>;
    },
  ) {
    if (!body.name?.trim()) {
      throw new HttpException('Template name is required', HttpStatus.BAD_REQUEST);
    }

    // Validate zones don't overflow the canvas
    if (body.zones) {
      for (const zone of body.zones) {
        validateZoneBounds(zone);
      }
    }

    // Derive orientation from dimensions if not explicitly set
    const screenWidth = body.screenWidth || 1920;
    const screenHeight = body.screenHeight || 1080;
    const orientation = body.orientation || (screenHeight > screenWidth ? 'PORTRAIT' : 'LANDSCAPE');

    return this.prisma.client.template.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name.trim(),
        description: body.description || null,
        category: body.category || 'CUSTOM',
        orientation,
        screenWidth,
        screenHeight,
        bgColor: body.bgColor || null,
        bgImage: body.bgImage || null,
        bgGradient: body.bgGradient || null,
        createdById: req.user.id,
        zones: body.zones
          ? {
              create: body.zones.map((z, i) => ({
                name: z.name,
                widgetType: z.widgetType,
                x: z.x,
                y: z.y,
                width: z.width,
                height: z.height,
                zIndex: z.zIndex ?? 0,
                sortOrder: z.sortOrder ?? i,
                defaultConfig: z.defaultConfig ? JSON.stringify(z.defaultConfig) : null,
              })),
            }
          : undefined,
      },
      include: {
        zones: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  // ───────────────────────────────────────────────────────
  // CREATE FROM PRESET — one-click template from system preset
  // ───────────────────────────────────────────────────────

  @Post('from-preset/:presetId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async createFromPreset(
    @Request() req: any,
    @Param('presetId') presetId: string,
    @Body() body: { name?: string },
  ) {
    // Try database first (seeded system templates)
    let source = await this.prisma.client.template.findFirst({
      where: { id: presetId, isSystem: true },
      include: { zones: { orderBy: { sortOrder: 'asc' } } },
    });

    // Fall back to in-memory presets
    if (!source) {
      const preset = SYSTEM_TEMPLATE_PRESETS.find((p) => p.id === presetId);
      if (!preset) {
        throw new HttpException('Preset not found', HttpStatus.NOT_FOUND);
      }
      // Use preset data directly
      return this.prisma.client.template.create({
        data: {
          tenantId: req.user.tenantId,
          name: body.name || preset.name,
          description: preset.description,
          category: preset.category,
          orientation: preset.orientation,
          screenWidth: preset.screenWidth || (preset.orientation === 'PORTRAIT' ? 1080 : 1920),
          screenHeight: preset.screenHeight || (preset.orientation === 'PORTRAIT' ? 1920 : 1080),
          createdById: req.user.id,
          zones: {
            create: preset.zones.map((z, i) => ({
              name: z.name,
              widgetType: z.widgetType,
              x: z.x,
              y: z.y,
              width: z.width,
              height: z.height,
              zIndex: z.zIndex ?? 0,
              sortOrder: z.sortOrder ?? i,
              defaultConfig: z.defaultConfig ? JSON.stringify(z.defaultConfig) : null,
            })),
          },
        },
        include: { zones: { orderBy: { sortOrder: 'asc' } } },
      });
    }

    // Clone from database system template
    return this.prisma.client.template.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name || `${source.name} (Copy)`,
        description: source.description,
        category: source.category,
        orientation: source.orientation,
        screenWidth: source.screenWidth,
        screenHeight: source.screenHeight,
        bgColor: source.bgColor,
        bgImage: source.bgImage,
        bgGradient: source.bgGradient,
        createdById: req.user.id,
        zones: {
          create: source.zones.map((z) => ({
            name: z.name,
            widgetType: z.widgetType,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: z.zIndex,
            sortOrder: z.sortOrder,
            defaultConfig: z.defaultConfig,
          })),
        },
      },
      include: { zones: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  // ───────────────────────────────────────────────────────
  // DUPLICATE — clone any template the user has access to
  // ───────────────────────────────────────────────────────

  @Post(':id/duplicate')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async duplicate(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { name?: string },
  ) {
    const source = await this.prisma.client.template.findFirst({
      where: {
        id,
        OR: [{ tenantId: req.user.tenantId }, { isSystem: true }],
      },
      include: { zones: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!source) return { error: 'Not found' };

    return this.prisma.client.template.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name || `${source.name} (Copy)`,
        description: source.description,
        category: source.category,
        orientation: source.orientation,
        screenWidth: source.screenWidth,
        screenHeight: source.screenHeight,
        bgColor: source.bgColor,
        bgImage: source.bgImage,
        bgGradient: source.bgGradient,
        createdById: req.user.id,
        zones: {
          create: source.zones.map((z) => ({
            name: z.name,
            widgetType: z.widgetType,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: z.zIndex,
            sortOrder: z.sortOrder,
            defaultConfig: z.defaultConfig,
          })),
        },
      },
      include: { zones: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  // ───────────────────────────────────────────────────────
  // UPDATE — template metadata (name, description, status)
  // ───────────────────────────────────────────────────────

  @Put(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      description?: string;
      category?: string;
      orientation?: string;
      screenWidth?: number;
      screenHeight?: number;
      status?: string;
      bgColor?: string | null;
      bgImage?: string | null;
      bgGradient?: string | null;
    },
  ) {
    const template = await this.prisma.client.template.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!template) return { error: 'Not found' };
    if (template.isSystem) {
      throw new HttpException('Cannot modify system templates. Duplicate it first.', HttpStatus.FORBIDDEN);
    }

    return this.prisma.client.template.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name.trim() }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.category && { category: body.category }),
        ...(body.orientation && { orientation: body.orientation }),
        ...(body.screenWidth && { screenWidth: body.screenWidth }),
        ...(body.screenHeight && { screenHeight: body.screenHeight }),
        ...(body.status && { status: body.status }),
        ...(body.bgColor !== undefined && { bgColor: body.bgColor }),
        ...(body.bgImage !== undefined && { bgImage: body.bgImage }),
        ...(body.bgGradient !== undefined && { bgGradient: body.bgGradient }),
      },
      include: { zones: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  // ───────────────────────────────────────────────────────
  // REPLACE ZONES — atomic zone layout update (like playlist items)
  // The frontend builder sends the complete zone layout, and we
  // replace everything in a transaction for consistency.
  // ───────────────────────────────────────────────────────

  @Put(':id/zones')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async replaceZones(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: {
      zones: Array<{
        name: string;
        widgetType: string;
        x: number;
        y: number;
        width: number;
        height: number;
        zIndex?: number;
        sortOrder?: number;
        defaultConfig?: any;
      }>;
    },
  ) {
    const template = await this.prisma.client.template.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!template) return { error: 'Not found' };
    if (template.isSystem) {
      throw new HttpException('Cannot modify system templates. Duplicate it first.', HttpStatus.FORBIDDEN);
    }

    // Validate all zones
    for (const zone of body.zones) {
      validateZoneBounds(zone);
    }

    // Atomic replace: delete all existing zones then create new ones
    await this.prisma.client.$transaction([
      this.prisma.client.templateZone.deleteMany({ where: { templateId: id } }),
      ...body.zones.map((z, i) =>
        this.prisma.client.templateZone.create({
          data: {
            templateId: id,
            name: z.name,
            widgetType: z.widgetType,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: z.zIndex ?? 0,
            sortOrder: z.sortOrder ?? i,
            defaultConfig: z.defaultConfig ? JSON.stringify(z.defaultConfig) : null,
          },
        }),
      ),
    ]);

    return this.prisma.client.template.findUnique({
      where: { id },
      include: { zones: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  // ───────────────────────────────────────────────────────
  // DELETE — remove a custom template
  // ───────────────────────────────────────────────────────

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const template = await this.prisma.client.template.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!template) return { error: 'Not found' };
    if (template.isSystem) {
      throw new HttpException('Cannot delete system templates', HttpStatus.FORBIDDEN);
    }

    // Cascade deletes zones automatically via Prisma relation
    await this.prisma.client.template.delete({ where: { id } });
    return { deleted: true };
  }
}

// ───────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────

function validateZoneBounds(zone: { x: number; y: number; width: number; height: number }) {
  if (zone.x < 0 || zone.y < 0 || zone.width <= 0 || zone.height <= 0) {
    throw new HttpException(
      `Zone dimensions must be positive. Got x=${zone.x} y=${zone.y} w=${zone.width} h=${zone.height}`,
      HttpStatus.BAD_REQUEST,
    );
  }
  if (zone.x + zone.width > 100.01 || zone.y + zone.height > 100.01) {
    throw new HttpException(
      `Zone overflows the canvas (100×100). x+w=${zone.x + zone.width}, y+h=${zone.y + zone.height}`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Widget type catalog — used by the frontend template builder to render
 * the palette of available widgets with friendly names, icons, and
 * descriptions that make sense to teachers.
 */
const WIDGET_TYPE_CATALOG = [
  {
    type: 'VIDEO',
    label: 'Video Player',
    icon: 'play-circle',
    description: 'Play a video file or stream',
    category: 'media',
  },
  {
    type: 'IMAGE',
    label: 'Single Image',
    icon: 'image',
    description: 'Display a photo or graphic',
    category: 'media',
  },
  {
    type: 'IMAGE_CAROUSEL',
    label: 'Photo Slideshow',
    icon: 'images',
    description: 'Rotate through multiple photos automatically',
    category: 'media',
  },
  {
    type: 'PLAYLIST',
    label: 'Content Playlist',
    icon: 'list-video',
    description: 'Play a sequence of mixed content from a playlist',
    category: 'media',
  },
  {
    type: 'WEBPAGE',
    label: 'Website / Web App',
    icon: 'globe',
    description: 'Embed any website, Google Slide, or web tool',
    category: 'web',
  },
  {
    type: 'TEXT',
    label: 'Text Block',
    icon: 'type',
    description: 'Simple text with custom font, size, and color',
    category: 'web',
  },
  {
    type: 'RICH_TEXT',
    label: 'Rich Text',
    icon: 'file-text',
    description: 'Formatted text with headings, bold, lists, and links',
    category: 'web',
  },
  {
    type: 'RSS_FEED',
    label: 'News Feed',
    icon: 'rss',
    description: 'Show headlines from any RSS news source',
    category: 'web',
  },
  {
    type: 'SOCIAL_FEED',
    label: 'Social Media',
    icon: 'share-2',
    description: 'Display posts from a social media account',
    category: 'web',
  },
  {
    type: 'ANNOUNCEMENT',
    label: 'Announcement',
    icon: 'megaphone',
    description: 'Highlight an important message with eye-catching styling',
    category: 'education',
  },
  {
    type: 'BELL_SCHEDULE',
    label: 'Bell Schedule',
    icon: 'bell',
    description: 'Show class periods with the current one highlighted',
    category: 'education',
  },
  {
    type: 'LUNCH_MENU',
    label: 'Lunch Menu',
    icon: 'utensils',
    description: "Display today's cafeteria menu",
    category: 'education',
  },
  {
    type: 'CALENDAR',
    label: 'School Calendar',
    icon: 'calendar',
    description: 'Show upcoming events from a calendar feed',
    category: 'education',
  },
  {
    type: 'COUNTDOWN',
    label: 'Countdown Timer',
    icon: 'timer',
    description: 'Count down to a special event (prom, graduation, break)',
    category: 'education',
  },
  {
    type: 'STAFF_SPOTLIGHT',
    label: 'Staff Spotlight',
    icon: 'user-check',
    description: 'Feature a teacher or staff member with photo and quote',
    category: 'education',
  },
  {
    type: 'CLOCK',
    label: 'Clock',
    icon: 'clock',
    description: 'Current time display',
    category: 'utility',
  },
  {
    type: 'WEATHER',
    label: 'Weather',
    icon: 'cloud-sun',
    description: 'Local weather conditions and forecast',
    category: 'utility',
  },
  {
    type: 'LOGO',
    label: 'School Logo',
    icon: 'shield',
    description: 'Display your school or district logo',
    category: 'utility',
  },
  {
    type: 'TICKER',
    label: 'Scrolling Ticker',
    icon: 'arrow-right',
    description: 'Scrolling text banner for quick updates',
    category: 'utility',
  },
  {
    type: 'EMPTY',
    label: 'Empty Placeholder',
    icon: 'square',
    description: 'Reserve a zone to fill in later',
    category: 'utility',
  },
];
