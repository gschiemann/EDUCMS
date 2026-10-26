/**
 * Standard emergency wording — what a screen shows for an alert type when the
 * organization has not added a picture or video of its own (2026-10-26).
 *
 * Owner decision (Settings simplification, 2026-10-24) — "default emergency
 * wording for every alert type, so each alert is ready on day 1" — and the
 * owner's approval of the words themselves (2026-10-26, "update the emergency
 * words thats fine"). The lead's life-safety standard for every line:
 *
 *   - one short headline plus one or two short action lines, calm and
 *     directive, in the style of the Standard Response Protocol
 *     ("LOCKDOWN — Locks, lights, out of sight");
 *   - NEVER claim what VenueOS does not do: no "police have been notified",
 *     "help is on the way", "doors are locked". VenueOS only puts the alert on
 *     the screens;
 *   - no drill wording here: a drill keeps its own board, marked DRILL;
 *   - English, Spanish and Chinese.
 *
 * Where it is used:
 *   - the manifest's bulletproof fallback board (apps/api screens.controller,
 *     `DEFAULT_EMERGENCY`) — a LIVE alert of a known type with no content of
 *     its own, no operator-typed message and no scope note. Anything the
 *     organization set always wins; this never overwrites an organization's
 *     own text or media (nothing is written anywhere);
 *   - Settings → Emergency, which previews exactly that board.
 *
 * Screens have no language setting, so the board is shown in English (the
 * same as the generic board it replaces); `es` / `zh` let the dashboard
 * explain the words to a Spanish or Chinese-speaking operator.
 *
 * ⚠️ Emergency content. Any change to these words needs the owner's sign-off
 * (CLAUDE.md "WARNING: Emergency System Changes") — and a change here changes
 * every screen that has no content of its own for that alert type.
 */

export type EmergencyWordingKind = 'lockdown' | 'secure' | 'hold' | 'evacuate' | 'weather' | 'medical';
export type EmergencyWordingLocale = 'en' | 'es' | 'zh';

export interface EmergencyStandardWording {
  /** The first line, in capitals for English and Spanish. */
  headline: string;
  /** One or two short action lines. */
  lines: readonly string[];
}

export const EMERGENCY_WORDING_KINDS: readonly EmergencyWordingKind[] = [
  'lockdown',
  'secure',
  'hold',
  'evacuate',
  'weather',
  'medical',
];

export const EMERGENCY_STANDARD_WORDING: Readonly<
  Record<EmergencyWordingLocale, Readonly<Record<EmergencyWordingKind, EmergencyStandardWording>>>
> = {
  en: {
    lockdown: { headline: 'LOCKDOWN', lines: ['Locks, lights, out of sight.', 'Stay quiet. Do not open the door.'] },
    secure: { headline: 'SECURE', lines: ['Get inside. Lock outside doors.', 'Stay inside until you are told it is safe.'] },
    hold: { headline: 'HOLD', lines: ['Stay in your room or area.', 'Keep the halls clear.'] },
    evacuate: { headline: 'EVACUATE', lines: ['Leave the building now.', 'Go to your meeting point.'] },
    weather: { headline: 'SEVERE WEATHER', lines: ['Go to your shelter area now.', 'Stay away from windows.'] },
    medical: { headline: 'MEDICAL EMERGENCY', lines: ['Keep this area clear.', 'Follow staff directions.'] },
  },
  es: {
    lockdown: { headline: 'CIERRE DE EMERGENCIA', lines: ['Cierre con llave, apague las luces y manténgase fuera de la vista.', 'Guarde silencio. No abra la puerta.'] },
    secure: { headline: 'ASEGURAR', lines: ['Entre al edificio. Cierre con llave las puertas exteriores.', 'Quédese adentro hasta que le digan que es seguro.'] },
    hold: { headline: 'PERMANEZCAN EN SU LUGAR', lines: ['Quédese en su salón o área.', 'Mantenga despejados los pasillos.'] },
    evacuate: { headline: 'EVACUAR', lines: ['Salga del edificio ahora.', 'Vaya a su punto de reunión.'] },
    weather: { headline: 'CLIMA SEVERO', lines: ['Vaya ahora a su área de refugio.', 'Manténgase lejos de las ventanas.'] },
    medical: { headline: 'EMERGENCIA MÉDICA', lines: ['Mantenga despejada esta área.', 'Siga las indicaciones del personal.'] },
  },
  zh: {
    lockdown: { headline: '封锁', lines: ['锁门、关灯、躲到看不见的地方。', '保持安静，不要开门。'] },
    secure: { headline: '安全警戒', lines: ['进入室内，锁好外门。', '留在室内，直到接到安全通知。'] },
    hold: { headline: '原地等待', lines: ['留在您的教室或区域内。', '保持走廊畅通。'] },
    evacuate: { headline: '疏散', lines: ['立即离开建筑物。', '前往您的集合点。'] },
    weather: { headline: '恶劣天气', lines: ['立即前往避难区域。', '远离窗户。'] },
    medical: { headline: '医疗紧急情况', lines: ['请保持此区域畅通。', '听从工作人员的指示。'] },
  },
};

/** 'LOCKDOWN' / 'lockdown' → 'lockdown'; anything else (a severity, a typo) → null. */
export function emergencyWordingKind(type: unknown): EmergencyWordingKind | null {
  const k = String(type ?? '').trim().toLowerCase();
  return (EMERGENCY_WORDING_KINDS as readonly string[]).includes(k) ? (k as EmergencyWordingKind) : null;
}

export function standardEmergencyWording(
  kind: EmergencyWordingKind,
  locale: EmergencyWordingLocale = 'en',
): EmergencyStandardWording {
  return (EMERGENCY_STANDARD_WORDING[locale] ?? EMERGENCY_STANDARD_WORDING.en)[kind];
}

/**
 * The text of the board: the headline, a blank line, then the action lines —
 * the same `\n\n` paragraph shape the fallback board has always used, so
 * every player bundle lays it out the same way.
 */
export function standardEmergencyText(kind: EmergencyWordingKind, locale: EmergencyWordingLocale = 'en'): string {
  const w = standardEmergencyWording(kind, locale);
  return `${w.headline}\n\n${w.lines.join('\n')}`;
}
