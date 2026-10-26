/**
 * The plan cards' words in Spanish and Chinese (2026-10-26, Settings
 * simplification — the plan names, one-liners and feature lists were
 * English-only; LICENSE_TIERS is the API's catalog and stays the English
 * source of truth).
 *
 * Prices are never typed here: every amount is computed from the tier's own
 * price fields, so a price change in LICENSE_TIERS changes these sentences
 * too. `billing-copy.spec.ts` holds every tier to the same number of features
 * in every language, so a feature added in English without a translation
 * fails the build instead of quietly mixing languages.
 */
import type { LicenseTier, LicenseTierId } from './billing';

export type BillingCopyLocale = 'en' | 'es' | 'zh';

export interface LicenseTierCopy {
  name: string;
  blurb: string;
  features: readonly string[];
}

/** What a plan card knows about its tier — a LicenseTier, or the API's JSON of one. */
export interface LicenseTierCopyInput {
  id: string;
  name: string;
  blurb: string;
  features: readonly string[];
  monthlyPriceCents?: LicenseTier['monthlyPriceCents'];
  annualPriceCents?: LicenseTier['annualPriceCents'];
  aiMonthlyPriceCents?: LicenseTier['aiMonthlyPriceCents'];
  aiAnnualPriceCents?: LicenseTier['aiAnnualPriceCents'];
  seatLimit?: LicenseTier['seatLimit'];
}
type PriceFields = LicenseTierCopyInput;

/** "$20" — whole US dollars, the way the plan cards show prices. */
function usd(cents: number | null | undefined): string {
  if (cents == null) return '';
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

function difference(a: number | null | undefined, b: number | null | undefined): string {
  return a != null && b != null ? usd(a - b) : '';
}

type CopyBuilder = (t: PriceFields) => LicenseTierCopy;

const ES: Record<LicenseTierId, CopyBuilder> = {
  FREE_TRIAL: (t) => ({
    name: 'Prueba gratuita',
    blurb: `14 días, hasta ${t.seatLimit ?? 3} pantallas, sin tarjeta de crédito. Incluye IA para probar.`,
    features: [
      `${t.seatLimit ?? 3} pantallas`,
      'Prueba de 14 días',
      'Biblioteca completa de plantillas',
      'Todas las integraciones',
      'IA incluida (2 diseños + 2 imágenes)',
      'Soporte por correo electrónico',
    ],
  }),
  MONTHLY: (t) => ({
    name: 'Mensual',
    blurb: `${usd(t.monthlyPriceCents)} por pantalla, facturado cada mes; ${usd(t.aiMonthlyPriceCents)} con IA. Cancela cuando quieras.`,
    features: [
      'Facturación por pantalla',
      'Biblioteca completa de plantillas',
      'Todas las integraciones (transmisión, punto de venta)',
      'Alertas de emergencia',
      `Complemento de IA: +${difference(t.aiMonthlyPriceCents, t.monthlyPriceCents)} / pantalla / mes`,
      'Soporte por correo electrónico y chat',
      'Cancela cuando quieras',
    ],
  }),
  ANNUAL: (t) => ({
    name: 'Anual',
    blurb: `${usd(t.annualPriceCents)} por pantalla al año; ${usd(t.aiAnnualPriceCents)} con IA. Dos meses gratis frente al plan mensual.`,
    features: [
      'Facturación por pantalla',
      'Dos meses gratis frente al plan mensual',
      'Biblioteca completa de plantillas',
      'Todas las integraciones (transmisión, punto de venta)',
      'Alertas de emergencia',
      `Complemento de IA: +${difference(t.aiAnnualPriceCents, t.annualPriceCents)} / pantalla / año`,
      'Soporte prioritario',
    ],
  }),
  COMP: () => ({
    name: 'Cortesía / socio',
    blurb: 'Otorgado por VenueOS. Gratis.',
    features: ['Personalizado: consulta las notas'],
  }),
  CUSTOM: () => ({
    name: 'Personalizado',
    blurb: 'Precio y límites acordados con VenueOS.',
    features: ['Acordado'],
  }),
};

const ZH: Record<LicenseTierId, CopyBuilder> = {
  FREE_TRIAL: (t) => ({
    name: '免费试用',
    blurb: `14 天，最多 ${t.seatLimit ?? 3} 块屏幕，无需信用卡。包含 AI 试用。`,
    features: [
      `${t.seatLimit ?? 3} 块屏幕`,
      '14 天试用',
      '完整模板库',
      '所有集成',
      '包含 AI（2 个设计 + 2 张图片）',
      '电子邮件支持',
    ],
  }),
  MONTHLY: (t) => ({
    name: '月付',
    blurb: `每块屏幕 ${usd(t.monthlyPriceCents)}，按月计费；含 AI 为 ${usd(t.aiMonthlyPriceCents)}。可随时取消。`,
    features: [
      '按屏幕计费',
      '完整模板库',
      '所有集成（直播、收银系统）',
      '紧急警报',
      `AI 附加功能：每块屏幕每月 +${difference(t.aiMonthlyPriceCents, t.monthlyPriceCents)}`,
      '电子邮件和在线聊天支持',
      '可随时取消',
    ],
  }),
  ANNUAL: (t) => ({
    name: '年付',
    blurb: `每块屏幕每年 ${usd(t.annualPriceCents)}；含 AI 为 ${usd(t.aiAnnualPriceCents)}。比月付多送两个月。`,
    features: [
      '按屏幕计费',
      '比月付多送两个月',
      '完整模板库',
      '所有集成（直播、收银系统）',
      '紧急警报',
      `AI 附加功能：每块屏幕每年 +${difference(t.aiAnnualPriceCents, t.annualPriceCents)}`,
      '优先支持',
    ],
  }),
  COMP: () => ({
    name: '赠送 / 合作伙伴',
    blurb: '由 VenueOS 授予。免费。',
    features: ['自定义——见备注'],
  }),
  CUSTOM: () => ({
    name: '自定义',
    blurb: '价格和限额与 VenueOS 协商确定。',
    features: ['协商确定'],
  }),
};

const BY_LOCALE: Record<'es' | 'zh', Record<LicenseTierId, CopyBuilder>> = { es: ES, zh: ZH };

/**
 * The words for one plan card. English (or a tier this build does not know)
 * returns the API's own strings unchanged.
 */
export function licenseTierCopy(tier: PriceFields, locale: string): LicenseTierCopy {
  const builders = locale === 'es' || locale === 'zh' ? BY_LOCALE[locale] : null;
  const build = builders?.[tier.id as LicenseTierId];
  if (!build) return { name: tier.name, blurb: tier.blurb, features: tier.features };
  return build(tier);
}
