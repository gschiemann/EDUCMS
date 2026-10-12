/**
 * Trial reminder emails (2026-10-11) — en / es / zh, plain text, pure.
 *
 * Three moments, each sent at most once (trial-policy.ts `dueTrialNotice`):
 *   1  seven days left      friendly heads-up, one link
 *   2  one day left         same, sooner
 *   3  trial ended          what still works (screens, emergency alerts),
 *                           what is paused, one link
 *
 * Every email says the same three things a customer actually needs: when, what
 * happens to their screens (nothing goes dark), and the one link that fixes it.
 * No card number, no price table, no marketing.
 */
import type { TrialNoticeStage } from './trial-policy';
import { TRIAL_GRACE_DAYS } from './trial-policy';
import { PLAN_PRICES } from './ai-plan';

export type NoticeLocale = 'en' | 'es' | 'zh';

export interface TrialEmailInput {
  stage: TrialNoticeStage;
  locale: string | null | undefined;
  orgName: string;
  trialEndsAt: Date;
  billingUrl: string;
}

const money = (cents: number) => `$${Math.round(cents / 100)}`;

function dateIn(locale: NoticeLocale, d: Date): string {
  const tag = locale === 'zh' ? 'zh-CN' : locale === 'es' ? 'es-US' : 'en-US';
  return d.toLocaleDateString(tag, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function noticeLocaleOf(v: string | null | undefined): NoticeLocale {
  return v === 'es' || v === 'zh' ? v : 'en';
}

export function trialEmail(input: TrialEmailInput): { subject: string; body: string; kind: string } {
  const l = noticeLocaleOf(input.locale);
  const when = dateIn(l, input.trialEndsAt);
  // 2026-10-12 pricing: VenueOS $20/mo · $200/yr; VenueOS + AI $25/mo · $250/yr.
  const m = money(PLAN_PRICES.monthlyCents);
  const y = money(PLAN_PRICES.annualCents);
  const mAi = money(PLAN_PRICES.monthlyAiCents);
  const yAi = money(PLAN_PRICES.annualAiCents);
  const kind = input.stage === 3 ? 'TRIAL_ENDED' : input.stage === 2 ? 'TRIAL_REMINDER_1D' : 'TRIAL_REMINDER_7D';
  const org = input.orgName;
  const url = input.billingUrl;

  if (l === 'es') {
    if (input.stage === 3) {
      return {
        kind,
        subject: `Tu prueba gratuita de VenueOS terminó — tus pantallas siguen funcionando`,
        body: [
          `La prueba gratuita de ${org} terminó el ${when}.`,
          ``,
          `Tus pantallas siguen mostrando su contenido y las alertas de emergencia siguen funcionando.`,
          `Por ahora no puedes vincular pantallas nuevas. Si no agregas un método de pago en ${TRIAL_GRACE_DAYS} días, el panel quedará en solo lectura.`,
          ``,
          `Agrega un método de pago (menos de un minuto, en la página segura de Stripe):`,
          url,
          ``,
          `${m} por pantalla al mes, o ${y} por pantalla al año — con IA, ${mAi} al mes o ${yAi} al año.`,
          ``,
          `— El equipo de VenueOS`,
        ].join('\n'),
      };
    }
    const left = input.stage === 2 ? 'mañana' : 'en 7 días';
    return {
      kind,
      subject: `Tu prueba gratuita de VenueOS termina ${left}`,
      body: [
        `La prueba gratuita de ${org} termina el ${when}.`,
        ``,
        `Agrega un método de pago ahora y no perderás ningún día: el primer cobro es el ${when}.`,
        url,
        ``,
        `${m} por pantalla al mes, o ${y} por pantalla al año (dos meses gratis) — con IA, ${mAi} al mes o ${yAi} al año.`,
        `Tus pantallas y las alertas de emergencia nunca se apagan por un tema de facturación.`,
        ``,
        `— El equipo de VenueOS`,
      ].join('\n'),
    };
  }

  if (l === 'zh') {
    if (input.stage === 3) {
      return {
        kind,
        subject: `您的 VenueOS 免费试用已结束——屏幕仍在正常播放`,
        body: [
          `${org} 的免费试用已于 ${when} 结束。`,
          ``,
          `您的屏幕会继续播放现有内容，紧急警报也照常有效。`,
          `目前暂时无法配对新屏幕。如果 ${TRIAL_GRACE_DAYS} 天内未添加付款方式，控制台将变为只读。`,
          ``,
          `添加付款方式（在 Stripe 安全页面完成，不到一分钟）：`,
          url,
          ``,
          `每块屏幕每月 ${m}，或每块屏幕每年 ${y}；含 AI 版为每月 ${mAi} 或每年 ${yAi}。`,
          ``,
          `— VenueOS 团队`,
        ].join('\n'),
      };
    }
    const left = input.stage === 2 ? '明天' : '7 天后';
    return {
      kind,
      subject: `您的 VenueOS 免费试用将于${left}结束`,
      body: [
        `${org} 的免费试用将于 ${when} 结束。`,
        ``,
        `现在添加付款方式不会损失任何试用天数：首次扣款日期为 ${when}。`,
        url,
        ``,
        `每块屏幕每月 ${m}，或每块屏幕每年 ${y}（相当于免费两个月）；含 AI 版为每月 ${mAi} 或每年 ${yAi}。`,
        `屏幕和紧急警报绝不会因为账单问题而停止。`,
        ``,
        `— VenueOS 团队`,
      ].join('\n'),
    };
  }

  if (input.stage === 3) {
    return {
      kind,
      subject: `Your VenueOS free trial has ended — your screens are still playing`,
      body: [
        `The free trial for ${org} ended on ${when}.`,
        ``,
        `Your screens keep showing their content, and emergency alerts keep working.`,
        `For now you can't pair new screens. If no payment method is added within ${TRIAL_GRACE_DAYS} days, the dashboard becomes view-only.`,
        ``,
        `Add a payment method (under a minute, on Stripe's secure page):`,
        url,
        ``,
        `${m} per screen per month, or ${y} per screen per year — with AI, ${mAi} a month or ${yAi} a year.`,
        ``,
        `— The VenueOS team`,
      ].join('\n'),
    };
  }
  const left = input.stage === 2 ? 'tomorrow' : 'in 7 days';
  return {
    kind,
    subject: `Your VenueOS free trial ends ${left}`,
    body: [
      `The free trial for ${org} ends on ${when}.`,
      ``,
      `Add a payment method now and you keep every trial day — your first charge is on ${when}.`,
      url,
      ``,
      `${m} per screen per month, or ${y} per screen per year (two months free) — with AI, ${mAi} a month or ${yAi} a year.`,
      `Your screens and emergency alerts never switch off over billing.`,
      ``,
      `— The VenueOS team`,
    ].join('\n'),
  };
}
