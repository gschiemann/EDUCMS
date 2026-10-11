/**
 * Card-failure emails (2026-10-11) — en / es / zh, plain text, pure.
 *
 * Three moments, each sent at most once per invoice (dunning-policy.ts):
 *   1  card declined        what happened, one link to update the card
 *   2  reminder             still failing — update it before the dashboard goes view-only
 *   3  now view-only        what still works (screens, emergency alerts), one link to restart
 *
 * Every email says the three things a customer needs: what happened, that
 * screens and emergency alerts keep working, and the ONE link that fixes it.
 * No card digits, no amounts owed, no marketing.
 */
import type { DunningNoticeStage } from './dunning-policy';
import { noticeLocaleOf, type NoticeLocale } from './trial-emails';

export interface DunningEmailInput {
  stage: DunningNoticeStage;
  locale: string | null | undefined;
  orgName: string;
  /** Stripe's next automatic retry, when one is scheduled. */
  nextAttemptAt: Date | null;
  billingUrl: string;
}

function dateIn(locale: NoticeLocale, d: Date): string {
  const tag = locale === 'zh' ? 'zh-CN' : locale === 'es' ? 'es-US' : 'en-US';
  return d.toLocaleDateString(tag, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function dunningEmail(input: DunningEmailInput): { subject: string; body: string; kind: string } {
  const l = noticeLocaleOf(input.locale);
  const kind = input.stage === 3 ? 'BILLING_VIEW_ONLY' : input.stage === 2 ? 'BILLING_CARD_REMINDER' : 'BILLING_CARD_DECLINED';
  const org = input.orgName;
  const url = input.billingUrl;
  const next = input.nextAttemptAt ? dateIn(l, input.nextAttemptAt) : null;

  if (l === 'es') {
    if (input.stage === 3) {
      return {
        kind,
        subject: 'Tu panel de VenueOS ahora es de solo lectura — tus pantallas siguen funcionando',
        body: [
          `No pudimos cobrar la tarjeta de ${org} después de varios intentos, así que el plan terminó.`,
          ``,
          `Tus pantallas siguen mostrando su contenido y las alertas de emergencia siguen funcionando.`,
          `El panel queda en solo lectura hasta que reinicies el plan.`,
          ``,
          `Reinicia el plan con una tarjeta (menos de un minuto, en la página segura de Stripe):`,
          url,
          ``,
          `— El equipo de VenueOS`,
        ].join('\n'),
      };
    }
    if (input.stage === 2) {
      return {
        kind,
        subject: 'Recordatorio: actualiza tu tarjeta para VenueOS',
        body: [
          `Seguimos sin poder cobrar la tarjeta de ${org}.`,
          next
            ? `Volveremos a intentarlo el ${next}. Si los cobros siguen fallando, el panel quedará en solo lectura.`
            : `Si no actualizas la tarjeta, el panel quedará en solo lectura.`,
          `Tus pantallas y las alertas de emergencia seguirán funcionando.`,
          ``,
          `Actualiza la tarjeta (menos de un minuto, en la página segura de Stripe):`,
          url,
          ``,
          `— El equipo de VenueOS`,
        ].join('\n'),
      };
    }
    return {
      kind,
      subject: 'Tu tarjeta fue rechazada — actualízala para VenueOS',
      body: [
        `No pudimos cobrar el pago más reciente de ${org}: la tarjeta fue rechazada.`,
        ...(next ? [`Volveremos a intentarlo automáticamente el ${next}.`] : []),
        `Tus pantallas y las alertas de emergencia siguen funcionando. Mientras tanto no se pueden vincular pantallas nuevas.`,
        ``,
        `Actualiza la tarjeta (menos de un minuto, en la página segura de Stripe):`,
        url,
        ``,
        `— El equipo de VenueOS`,
      ].join('\n'),
    };
  }

  if (l === 'zh') {
    if (input.stage === 3) {
      return {
        kind,
        subject: '您的 VenueOS 控制台现为只读——屏幕仍在正常播放',
        body: [
          `我们多次尝试后仍无法从 ${org} 的银行卡扣款，因此套餐已结束。`,
          ``,
          `您的屏幕会继续播放现有内容，紧急警报也照常有效。`,
          `在重新开通套餐之前，控制台为只读状态。`,
          ``,
          `使用银行卡重新开通套餐（在 Stripe 安全页面完成，不到一分钟）：`,
          url,
          ``,
          `— VenueOS 团队`,
        ].join('\n'),
      };
    }
    if (input.stage === 2) {
      return {
        kind,
        subject: '提醒：请更新您的 VenueOS 付款银行卡',
        body: [
          `我们仍无法从 ${org} 的银行卡扣款。`,
          next
            ? `我们将于 ${next} 再次尝试。如果扣款继续失败，控制台将变为只读。`
            : `如果不更新银行卡，控制台将变为只读。`,
          `屏幕和紧急警报会继续正常工作。`,
          ``,
          `更新银行卡（在 Stripe 安全页面完成，不到一分钟）：`,
          url,
          ``,
          `— VenueOS 团队`,
        ].join('\n'),
      };
    }
    return {
      kind,
      subject: '您的银行卡被拒——请更新 VenueOS 付款方式',
      body: [
        `${org} 最近一次付款未能完成：银行卡被拒。`,
        ...(next ? [`我们将于 ${next} 自动再次尝试。`] : []),
        `屏幕和紧急警报仍在正常工作。在此期间无法配对新屏幕。`,
        ``,
        `更新银行卡（在 Stripe 安全页面完成，不到一分钟）：`,
        url,
        ``,
        `— VenueOS 团队`,
      ].join('\n'),
    };
  }

  if (input.stage === 3) {
    return {
      kind,
      subject: 'Your VenueOS dashboard is now view-only — your screens are still playing',
      body: [
        `We couldn't charge the card for ${org} after several tries, so the plan has ended.`,
        ``,
        `Your screens keep showing their content, and emergency alerts keep working.`,
        `The dashboard is view-only until the plan is restarted.`,
        ``,
        `Restart the plan with a card (under a minute, on Stripe's secure page):`,
        url,
        ``,
        `— The VenueOS team`,
      ].join('\n'),
    };
  }
  if (input.stage === 2) {
    return {
      kind,
      subject: 'Reminder: update your card for VenueOS',
      body: [
        `We still can't charge the card for ${org}.`,
        next
          ? `We'll try again on ${next}. If payments keep failing, the dashboard becomes view-only.`
          : `If the card isn't updated, the dashboard becomes view-only.`,
        `Your screens and emergency alerts keep working either way.`,
        ``,
        `Update the card (under a minute, on Stripe's secure page):`,
        url,
        ``,
        `— The VenueOS team`,
      ].join('\n'),
    };
  }
  return {
    kind,
    subject: 'Your card was declined — update it for VenueOS',
    body: [
      `The latest payment for ${org} didn't go through: the card was declined.`,
      ...(next ? [`We'll try again automatically on ${next}.`] : []),
      `Your screens and emergency alerts keep working. New screens can't be paired until the card is updated.`,
      ``,
      `Update the card (under a minute, on Stripe's secure page):`,
      url,
      ``,
      `— The VenueOS team`,
    ].join('\n'),
  };
}
