/**
 * Locale-aware vertical / hierarchy terminology (2026-07-22).
 *
 * The canonical English nouns live in @cms/api-types (VERTICAL_LABELS,
 * VERTICAL_GROUP_NOUN, CANONICAL_ROLE_LABELS) — a SHARED package the backend
 * also imports, so we do NOT fork it per locale. Instead this web-side map
 * localizes the visible nouns useTenantCopy() hands to the UI. The `en`
 * column MUST stay byte-identical to the api-types values so English behavior
 * is unchanged; es/zh are the translations. If a vertical/role is missing
 * here for a locale we fall back to the English (never a raw key).
 *
 * Covered nouns (the ones that actually render): vertical entity singular/
 * plural (VerticalSwitcherCard "Store"), hierarchy nouns Location/Locations/
 * Primary + "Location settings" (settings + dashboard), and the 5 role labels
 * (top-bar user menu + sidebar).
 */
import type { AppLocale } from './config';

type Vertical =
  | 'K12' | 'GYM' | 'RETAIL' | 'CORPORATE' | 'QSR' | 'FASHION' | 'BAR'
  | 'HEALTHCARE' | 'HOSPITALITY' | 'RESTAURANT' | 'SPORTS' | 'WORSHIP';

interface Noun { singular: string; plural: string; }

const VERTICAL_ENTITY: Record<AppLocale, Record<Vertical, Noun>> = {
  en: {
    K12: { singular: 'School', plural: 'Schools' },
    GYM: { singular: 'Gym', plural: 'Gyms' },
    RETAIL: { singular: 'Store', plural: 'Stores' },
    CORPORATE: { singular: 'Office', plural: 'Offices' },
    QSR: { singular: 'Restaurant', plural: 'Restaurants' },
    FASHION: { singular: 'Boutique', plural: 'Boutiques' },
    BAR: { singular: 'Bar', plural: 'Bars' },
    HEALTHCARE: { singular: 'Practice', plural: 'Practices' },
    HOSPITALITY: { singular: 'Property', plural: 'Properties' },
    RESTAURANT: { singular: 'Restaurant', plural: 'Restaurants' },
    SPORTS: { singular: 'Venue', plural: 'Venues' },
    WORSHIP: { singular: 'Church', plural: 'Churches' },
  },
  es: {
    K12: { singular: 'Escuela', plural: 'Escuelas' },
    GYM: { singular: 'Gimnasio', plural: 'Gimnasios' },
    RETAIL: { singular: 'Tienda', plural: 'Tiendas' },
    CORPORATE: { singular: 'Oficina', plural: 'Oficinas' },
    QSR: { singular: 'Restaurante', plural: 'Restaurantes' },
    FASHION: { singular: 'Boutique', plural: 'Boutiques' },
    BAR: { singular: 'Bar', plural: 'Bares' },
    HEALTHCARE: { singular: 'Consulta', plural: 'Consultas' },
    HOSPITALITY: { singular: 'Propiedad', plural: 'Propiedades' },
    RESTAURANT: { singular: 'Restaurante', plural: 'Restaurantes' },
    SPORTS: { singular: 'Sede', plural: 'Sedes' },
    WORSHIP: { singular: 'Iglesia', plural: 'Iglesias' },
  },
  zh: {
    K12: { singular: '学校', plural: '学校' },
    GYM: { singular: '健身房', plural: '健身房' },
    RETAIL: { singular: '门店', plural: '门店' },
    CORPORATE: { singular: '办公室', plural: '办公室' },
    QSR: { singular: '餐厅', plural: '餐厅' },
    FASHION: { singular: '精品店', plural: '精品店' },
    BAR: { singular: '酒吧', plural: '酒吧' },
    HEALTHCARE: { singular: '诊所', plural: '诊所' },
    HOSPITALITY: { singular: '物业', plural: '物业' },
    RESTAURANT: { singular: '餐厅', plural: '餐厅' },
    SPORTS: { singular: '场馆', plural: '场馆' },
    WORSHIP: { singular: '教堂', plural: '教堂' },
  },
};

/** Hierarchy nouns — same for every vertical (per the 2026-06-01 unification). */
const HIERARCHY: Record<AppLocale, {
  orgSingular: string; orgPlural: string; groupSingular: string;
  groupPlural: string; settingsSectionTitle: string;
}> = {
  en: { orgSingular: 'Location', orgPlural: 'Locations', groupSingular: 'Primary', groupPlural: 'Primary', settingsSectionTitle: 'Location settings' },
  es: { orgSingular: 'Ubicación', orgPlural: 'Ubicaciones', groupSingular: 'Principal', groupPlural: 'Principal', settingsSectionTitle: 'Ajustes de la ubicación' },
  zh: { orgSingular: '场所', orgPlural: '场所', groupSingular: '主账户', groupPlural: '主账户', settingsSectionTitle: '场所设置' },
};

/** Role enum → localized label (canonical set, same across verticals). */
const ROLE_LABELS: Record<AppLocale, Record<string, string>> = {
  en: { SUPER_ADMIN: 'Platform Admin', DISTRICT_ADMIN: 'Super Admin', SCHOOL_ADMIN: 'Admin', CONTRIBUTOR: 'Editor', RESTRICTED_VIEWER: 'Viewer' },
  es: { SUPER_ADMIN: 'Administrador de plataforma', DISTRICT_ADMIN: 'Superadministrador', SCHOOL_ADMIN: 'Administrador', CONTRIBUTOR: 'Editor', RESTRICTED_VIEWER: 'Visualizador' },
  zh: { SUPER_ADMIN: '平台管理员', DISTRICT_ADMIN: '超级管理员', SCHOOL_ADMIN: '管理员', CONTRIBUTOR: '编辑', RESTRICTED_VIEWER: '查看者' },
};

export function localizedVerticalEntity(locale: AppLocale, vertical: string): Noun {
  const table = VERTICAL_ENTITY[locale] ?? VERTICAL_ENTITY.en;
  return table[vertical as Vertical] ?? VERTICAL_ENTITY.en[vertical as Vertical] ?? { singular: vertical, plural: vertical };
}

export function localizedHierarchy(locale: AppLocale) {
  return HIERARCHY[locale] ?? HIERARCHY.en;
}

export function localizedRoleLabel(locale: AppLocale, role: string): string {
  return (ROLE_LABELS[locale] ?? ROLE_LABELS.en)[role] ?? ROLE_LABELS.en[role] ?? role;
}
