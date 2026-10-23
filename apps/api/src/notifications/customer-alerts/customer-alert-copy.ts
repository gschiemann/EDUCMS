/**
 * Customer alert emails — the WORDS (2026-10-23). en / es / zh, plain text,
 * pure. Same shape as the other transactional mail (email.service.ts): short
 * lines, one or two links, signed "— The VenueOS team".
 *
 * Privacy: the only names an email carries are screen and location names.
 * Never a person, an address, an IP or a device id.
 */

export type AlertLocale = 'en' | 'es' | 'zh';

export function alertLocaleOf(v: string | null | undefined): AlertLocale {
  return v === 'es' || v === 'zh' ? v : 'en';
}

export type ScreenItemKind = 'OFFLINE' | 'BACK_ONLINE' | 'NO_CONTENT' | 'CONTENT_RESTORED';

export interface ScreenAlertItem {
  kind: ScreenItemKind;
  screenName: string;
  locationName: string;
  /** How long the problem has lasted / lasted, in whole minutes. */
  minutes?: number;
  /** NO_CONTENT only: the player itself says its files could not be loaded. */
  contentUnavailable?: boolean;
}

export interface AlertLinks {
  screensUrl: string;
  manageUrl: string;
}

export interface RenderedEmail {
  subject: string;
  body: string;
}

/** Most screens one email lists by name; the rest are counted. */
export const MAX_LISTED = 20;

const T = {
  en: {
    sign: '— The VenueOS team',
    manage: 'Manage alert emails',
    open: 'Open your screens',
    more: (n: number) => `…and ${n} more`,
    min: (m: number) => (m === 1 ? '1 minute' : `${m} minutes`),
    subj: {
      OFFLINE: (one: string | null, n: number, loc: string) =>
        one ? `VenueOS: ${one} is offline at ${loc}` : `VenueOS: ${n} screens offline at ${loc}`,
      BACK_ONLINE: (one: string | null, n: number, loc: string) =>
        one ? `VenueOS: ${one} is back online at ${loc}` : `VenueOS: ${n} screens back online at ${loc}`,
      NO_CONTENT: (one: string | null, n: number, loc: string) =>
        one
          ? `VenueOS: ${one} is on but not showing content at ${loc}`
          : `VenueOS: ${n} screens not showing content at ${loc}`,
      CONTENT_RESTORED: (one: string | null, n: number, loc: string) =>
        one
          ? `VenueOS: ${one} is showing content again at ${loc}`
          : `VenueOS: ${n} screens showing content again at ${loc}`,
    },
    intro: {
      OFFLINE: (loc: string) => `These screens at ${loc} have stopped checking in:`,
      BACK_ONLINE: (loc: string) => `These screens at ${loc} are back online:`,
      NO_CONTENT: (loc: string) => `These screens at ${loc} are online but have not shown your content for at least 20 minutes:`,
      CONTENT_RESTORED: (loc: string) => `These screens at ${loc} are showing your content again:`,
    },
    line: {
      OFFLINE: (m?: number) => (m ? `offline for ${T.en.min(m)}` : 'offline'),
      BACK_ONLINE: (m?: number) => (m ? `was offline for ${T.en.min(m)}` : 'back online'),
      NO_CONTENT: (m?: number, unavailable?: boolean) =>
        unavailable ? 'showing "Content unavailable" (its scheduled files could not be loaded)' : m ? `no picture confirmed for ${T.en.min(m)}` : 'no picture confirmed',
      CONTENT_RESTORED: () => 'showing content',
    },
    outro: {
      OFFLINE: (siteWide: boolean) =>
        siteWide
          ? 'They all dropped at about the same time, which usually means the internet or power at the site is down.'
          : 'Common causes: the screen was unplugged or switched off at the wall, or its network is down.',
      NO_CONTENT: () => 'Restarting the screen from the Screens page usually fixes this.',
    },
    later: {
      OFFLINE: 'We will email you again when they are back online.',
      NO_CONTENT: 'We will email you again when your content is back.',
    },
    digestSubj: (n: number, org: string) => `VenueOS: ${n} screen updates for ${org}`,
    digestIntro: (org: string) =>
      `We held back some alerts so your inbox would not fill up. Here is what happened at ${org}:`,
    digestKind: { OFFLINE: 'Offline', BACK_ONLINE: 'Back online', NO_CONTENT: 'Not showing content', CONTENT_RESTORED: 'Showing content again' },
  },
  es: {
    sign: '— El equipo de VenueOS',
    manage: 'Administrar los correos de alerta',
    open: 'Abrir tus pantallas',
    more: (n: number) => `…y ${n} más`,
    min: (m: number) => (m === 1 ? '1 minuto' : `${m} minutos`),
    subj: {
      OFFLINE: (one: string | null, n: number, loc: string) =>
        one ? `VenueOS: ${one} está sin conexión en ${loc}` : `VenueOS: ${n} pantallas sin conexión en ${loc}`,
      BACK_ONLINE: (one: string | null, n: number, loc: string) =>
        one ? `VenueOS: ${one} volvió a estar en línea en ${loc}` : `VenueOS: ${n} pantallas volvieron a estar en línea en ${loc}`,
      NO_CONTENT: (one: string | null, n: number, loc: string) =>
        one
          ? `VenueOS: ${one} está encendida pero no muestra contenido en ${loc}`
          : `VenueOS: ${n} pantallas no muestran contenido en ${loc}`,
      CONTENT_RESTORED: (one: string | null, n: number, loc: string) =>
        one
          ? `VenueOS: ${one} vuelve a mostrar contenido en ${loc}`
          : `VenueOS: ${n} pantallas vuelven a mostrar contenido en ${loc}`,
    },
    intro: {
      OFFLINE: (loc: string) => `Estas pantallas de ${loc} dejaron de reportarse:`,
      BACK_ONLINE: (loc: string) => `Estas pantallas de ${loc} volvieron a estar en línea:`,
      NO_CONTENT: (loc: string) => `Estas pantallas de ${loc} están en línea, pero llevan al menos 20 minutos sin mostrar tu contenido:`,
      CONTENT_RESTORED: (loc: string) => `Estas pantallas de ${loc} vuelven a mostrar tu contenido:`,
    },
    line: {
      OFFLINE: (m?: number) => (m ? `sin conexión desde hace ${T.es.min(m)}` : 'sin conexión'),
      BACK_ONLINE: (m?: number) => (m ? `estuvo sin conexión ${T.es.min(m)}` : 'en línea'),
      NO_CONTENT: (m?: number, unavailable?: boolean) =>
        unavailable
          ? 'muestra "Contenido no disponible" (no se pudieron cargar sus archivos programados)'
          : m
            ? `sin imagen confirmada desde hace ${T.es.min(m)}`
            : 'sin imagen confirmada',
      CONTENT_RESTORED: () => 'mostrando contenido',
    },
    outro: {
      OFFLINE: (siteWide: boolean) =>
        siteWide
          ? 'Todas se desconectaron casi al mismo tiempo; normalmente eso significa que falla el internet o la electricidad en el sitio.'
          : 'Causas comunes: la pantalla se desenchufó o se apagó en la pared, o su red no funciona.',
      NO_CONTENT: () => 'Reiniciar la pantalla desde la página Pantallas suele resolverlo.',
    },
    later: {
      OFFLINE: 'Te escribiremos de nuevo cuando vuelvan a estar en línea.',
      NO_CONTENT: 'Te escribiremos de nuevo cuando tu contenido vuelva a verse.',
    },
    digestSubj: (n: number, org: string) => `VenueOS: ${n} novedades de pantallas en ${org}`,
    digestIntro: (org: string) =>
      `Agrupamos algunas alertas para no llenar tu bandeja de entrada. Esto es lo que pasó en ${org}:`,
    digestKind: { OFFLINE: 'Sin conexión', BACK_ONLINE: 'De nuevo en línea', NO_CONTENT: 'Sin mostrar contenido', CONTENT_RESTORED: 'Vuelve a mostrar contenido' },
  },
  zh: {
    sign: '— VenueOS 团队',
    manage: '管理提醒邮件',
    open: '打开屏幕列表',
    more: (n: number) => `……另有 ${n} 块`,
    min: (m: number) => `${m} 分钟`,
    subj: {
      OFFLINE: (one: string | null, n: number, loc: string) =>
        one ? `VenueOS：${loc} 的 ${one} 已离线` : `VenueOS：${loc} 有 ${n} 块屏幕离线`,
      BACK_ONLINE: (one: string | null, n: number, loc: string) =>
        one ? `VenueOS：${loc} 的 ${one} 已恢复在线` : `VenueOS：${loc} 有 ${n} 块屏幕已恢复在线`,
      NO_CONTENT: (one: string | null, n: number, loc: string) =>
        one ? `VenueOS：${loc} 的 ${one} 已开机但未显示内容` : `VenueOS：${loc} 有 ${n} 块屏幕未显示内容`,
      CONTENT_RESTORED: (one: string | null, n: number, loc: string) =>
        one ? `VenueOS：${loc} 的 ${one} 已恢复显示内容` : `VenueOS：${loc} 有 ${n} 块屏幕已恢复显示内容`,
    },
    intro: {
      OFFLINE: (loc: string) => `${loc} 的以下屏幕已停止上报状态：`,
      BACK_ONLINE: (loc: string) => `${loc} 的以下屏幕已恢复在线：`,
      NO_CONTENT: (loc: string) => `${loc} 的以下屏幕在线，但已至少 20 分钟没有显示您的内容：`,
      CONTENT_RESTORED: (loc: string) => `${loc} 的以下屏幕已恢复显示您的内容：`,
    },
    line: {
      OFFLINE: (m?: number) => (m ? `已离线 ${T.zh.min(m)}` : '离线'),
      BACK_ONLINE: (m?: number) => (m ? `曾离线 ${T.zh.min(m)}` : '已恢复在线'),
      NO_CONTENT: (m?: number, unavailable?: boolean) =>
        unavailable ? '显示“内容不可用”（排定的文件无法加载）' : m ? `已有 ${T.zh.min(m)} 未确认画面` : '未确认画面',
      CONTENT_RESTORED: () => '正在显示内容',
    },
    outro: {
      OFFLINE: (siteWide: boolean) =>
        siteWide
          ? '这些屏幕几乎同时掉线，通常说明现场的网络或电源出现了问题。'
          : '常见原因：屏幕被拔掉电源或在墙上关闭，或其网络中断。',
      NO_CONTENT: () => '在“屏幕”页面重启该屏幕通常可以解决。',
    },
    later: {
      OFFLINE: '屏幕恢复在线后，我们会再发邮件通知您。',
      NO_CONTENT: '内容恢复显示后，我们会再发邮件通知您。',
    },
    digestSubj: (n: number, org: string) => `VenueOS：${org} 的 ${n} 条屏幕动态`,
    digestIntro: (org: string) => `为避免邮件过多，我们合并了部分提醒。以下是 ${org} 的情况：`,
    digestKind: { OFFLINE: '离线', BACK_ONLINE: '恢复在线', NO_CONTENT: '未显示内容', CONTENT_RESTORED: '恢复显示内容' },
  },
} as const;

function listLines<I>(items: readonly I[], fmt: (i: I) => string, more: (n: number) => string): string[] {
  const lines = items.slice(0, MAX_LISTED).map((i) => `  • ${fmt(i)}`);
  if (items.length > MAX_LISTED) lines.push(`  ${more(items.length - MAX_LISTED)}`);
  return lines;
}

/** One location, one kind of event: "3 screens offline at Lincoln Elementary". */
export function renderScreenAlertEmail(
  locale: AlertLocale,
  input: { kind: ScreenItemKind; locationName: string; items: readonly ScreenAlertItem[]; siteWide?: boolean },
  links: AlertLinks,
): RenderedEmail {
  const t = T[locale];
  const n = input.items.length;
  const one = n === 1 ? input.items[0].screenName : null;
  const subject = t.subj[input.kind](one, n, input.locationName);
  const line = (i: ScreenAlertItem): string => {
    const detail =
      i.kind === 'NO_CONTENT' ? t.line.NO_CONTENT(i.minutes, i.contentUnavailable) : t.line[i.kind](i.minutes);
    return `${i.screenName} — ${detail}`;
  };
  const body: string[] = [t.intro[input.kind](input.locationName), '', ...listLines(input.items, line, t.more), ''];
  if (input.kind === 'OFFLINE') body.push(t.outro.OFFLINE(!!input.siteWide), t.later.OFFLINE, '');
  if (input.kind === 'NO_CONTENT') body.push(t.outro.NO_CONTENT(), t.later.NO_CONTENT, '');
  body.push(`${t.open}: ${links.screensUrl}`, '', `${t.manage}: ${links.manageUrl}`, '', t.sign);
  return { subject, body: body.join('\n') };
}

/** The org's held alerts, in one email, once it is under its hourly limit again. */
export function renderDigestEmail(
  locale: AlertLocale,
  input: { orgName: string; items: readonly ScreenAlertItem[] },
  links: AlertLinks,
): RenderedEmail {
  const t = T[locale];
  const line = (i: ScreenAlertItem) => `${t.digestKind[i.kind]}: ${i.screenName} (${i.locationName})`;
  return {
    subject: t.digestSubj(input.items.length, input.orgName),
    body: [
      t.digestIntro(input.orgName),
      '',
      ...listLines(input.items, line, t.more),
      '',
      `${t.open}: ${links.screensUrl}`,
      '',
      `${t.manage}: ${links.manageUrl}`,
      '',
      t.sign,
    ].join('\n'),
  };
}

// ─── Emergency record copies ──────────────────────────────────────────────

const ALERT_TYPE: Record<AlertLocale, Record<string, string>> = {
  en: { LOCKDOWN: 'Lockdown', EVACUATE: 'Evacuate', EVACUATION: 'Evacuate', WEATHER: 'Severe weather', SHELTER: 'Shelter', HOLD: 'Hold', SECURE: 'Secure', MEDICAL: 'Medical', FIRE: 'Fire' },
  es: { LOCKDOWN: 'Confinamiento', EVACUATE: 'Evacuación', EVACUATION: 'Evacuación', WEATHER: 'Clima severo', SHELTER: 'Refugio', HOLD: 'Permanecer en el lugar', SECURE: 'Asegurar', MEDICAL: 'Emergencia médica', FIRE: 'Incendio' },
  zh: { LOCKDOWN: '封锁', EVACUATE: '疏散', EVACUATION: '疏散', WEATHER: '恶劣天气', SHELTER: '避难', HOLD: '原地等待', SECURE: '安全戒备', MEDICAL: '医疗急救', FIRE: '火警' },
};

const E = {
  en: {
    alertWord: 'Emergency',
    subjTrig: (type: string, drill: boolean, where: string) =>
      drill ? `VenueOS: ${type} drill started at ${where}` : `VenueOS: ${type} alert sent to ${where}`,
    subjClear: (drill: boolean, where: string) => (drill ? `VenueOS: Drill ended at ${where}` : `VenueOS: All clear sent to ${where}`),
    where: (first: string, others: number) => (others > 0 ? `${first} and ${others} other location${others === 1 ? '' : 's'}` : first),
    trig: (type: string, drill: boolean, where: string, screens?: number) =>
      `${drill ? `A ${type} DRILL was started at` : `A ${type} alert was sent to`} ${where}${screens ? ` (${screens} screen${screens === 1 ? '' : 's'})` : ''}.`,
    clear: (drill: boolean, where: string) =>
      drill ? `The drill at ${where} was ended. Screens are going back to their normal content.` : `An all-clear was sent to ${where}. Screens are going back to their normal content.`,
    locations: 'Locations:',
    time: 'Time',
    record: 'This is a record copy for your files. There is nothing you need to do from this email.',
    open: 'Open emergency alerts',
  },
  es: {
    alertWord: 'Emergencia',
    subjTrig: (type: string, drill: boolean, where: string) =>
      drill ? `VenueOS: Simulacro de ${type} iniciado en ${where}` : `VenueOS: Alerta de ${type} enviada a ${where}`,
    subjClear: (drill: boolean, where: string) => (drill ? `VenueOS: Simulacro terminado en ${where}` : `VenueOS: Fin de la alerta enviado a ${where}`),
    where: (first: string, others: number) => (others > 0 ? `${first} y ${others} ubicación${others === 1 ? '' : 'es'} más` : first),
    trig: (type: string, drill: boolean, where: string, screens?: number) =>
      `${drill ? `Se inició un SIMULACRO de ${type} en` : `Se envió una alerta de ${type} a`} ${where}${screens ? ` (${screens} pantalla${screens === 1 ? '' : 's'})` : ''}.`,
    clear: (drill: boolean, where: string) =>
      drill ? `Se terminó el simulacro en ${where}. Las pantallas vuelven a su contenido normal.` : `Se envió el fin de la alerta a ${where}. Las pantallas vuelven a su contenido normal.`,
    locations: 'Ubicaciones:',
    time: 'Hora',
    record: 'Esta es una copia para tus registros. No necesitas hacer nada desde este correo.',
    open: 'Abrir las alertas de emergencia',
  },
  zh: {
    alertWord: '紧急',
    subjTrig: (type: string, drill: boolean, where: string) =>
      drill ? `VenueOS：${where} 已开始${type}演练` : `VenueOS：已向 ${where} 发送${type}警报`,
    subjClear: (drill: boolean, where: string) => (drill ? `VenueOS：${where} 的演练已结束` : `VenueOS：已向 ${where} 发送解除警报`),
    where: (first: string, others: number) => (others > 0 ? `${first} 及其他 ${others} 个地点` : first),
    trig: (type: string, drill: boolean, where: string, screens?: number) =>
      `${drill ? `${where} 已开始${type}演练` : `已向 ${where} 发送${type}警报`}${screens ? `（${screens} 块屏幕）` : ''}。`,
    clear: (drill: boolean, where: string) =>
      drill ? `${where} 的演练已结束，屏幕正在恢复正常内容。` : `已向 ${where} 发送解除警报，屏幕正在恢复正常内容。`,
    locations: '地点：',
    time: '时间',
    record: '这是一份存档副本，您无需通过此邮件进行任何操作。',
    open: '打开紧急警报',
  },
} as const;

export function emergencyTypeLabel(locale: AlertLocale, type: string | null | undefined): string {
  const key = String(type ?? '').trim().toUpperCase();
  return ALERT_TYPE[locale][key] ?? E[locale].alertWord;
}

export function renderEmergencyEmail(
  locale: AlertLocale,
  input: {
    event: 'TRIGGERED' | 'CLEARED';
    alertType?: string | null;
    isDrill: boolean;
    locationNames: readonly string[];
    screenCount?: number;
    at: Date;
  },
  links: { emergencyUrl: string; manageUrl: string },
): RenderedEmail {
  const e = E[locale];
  const names = input.locationNames.length ? input.locationNames : ['—'];
  const where = e.where(names[0], names.length - 1);
  const type = emergencyTypeLabel(locale, input.alertType);
  const subject = input.event === 'TRIGGERED' ? e.subjTrig(type, input.isDrill, where) : e.subjClear(input.isDrill, where);
  const when = input.at.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const body: string[] = [
    input.event === 'TRIGGERED' ? e.trig(type, input.isDrill, where, input.screenCount) : e.clear(input.isDrill, where),
    '',
  ];
  if (names.length > 1) {
    body.push(e.locations, ...listLines(names, (n) => n, T[locale].more), '');
  }
  body.push(`${e.time}: ${when}`, '', e.record, '', `${e.open}: ${links.emergencyUrl}`, '', `${T[locale].manage}: ${links.manageUrl}`, '', T[locale].sign);
  return { subject, body: body.join('\n') };
}
