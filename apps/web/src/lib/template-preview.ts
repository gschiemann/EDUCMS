/** Saved artwork data carried by playlists; previews never need a gallery lookup. */
export interface TemplatePreview {
  screenWidth: number;
  screenHeight: number;
  bgImage?: string | null;
  bgGradient?: string | null;
  bgColor?: string | null;
  zones: Array<{
    id?: string;
    widgetType: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex?: number | null;
    sceneId?: string | null;
    defaultConfig?: unknown;
  }>;
}

export function templatePreviewOf(value: unknown): TemplatePreview | null {
  if (!value || typeof value !== 'object') return null;
  const t = value as Partial<TemplatePreview>;
  if (!Array.isArray(t.zones) || !t.zones.length) return null;
  const positive = (n: unknown, fallback: number) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 16384 ? n : fallback;
  const firstScene = (value as { scenes?: Array<{ id: string }> }).scenes?.[0]?.id;
  const zones = t.zones.filter(z => typeof z?.widgetType === 'string' && (!firstScene || !z.sceneId || z.sceneId === firstScene)).map(z => ({
    ...z,
    x: Number.isFinite(z.x) ? z.x : 0,
    y: Number.isFinite(z.y) ? z.y : 0,
    width: positive(z.width, 100),
    height: positive(z.height, 100),
    defaultConfig: parseConfig(z.defaultConfig),
  }));
  return zones.length ? { ...t, screenWidth: positive(t.screenWidth, 1920), screenHeight: positive(t.screenHeight, 1080), zones } : null;
}

function parseConfig(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return {}; }
}
