/**
 * Custom message — the words and numbers the card shows (2026-10-26).
 *
 * The Broadcast page is gone: a typed-in message is now a card on the
 * Emergency page. This module holds the PURE parts of that card — what a
 * stored severity reads as, how a live message describes where it is, how long
 * it stays — so they are unit-tested without mounting anything.
 *
 * The mapping from the wire's three severities to the two an operator sees
 * (Info, Critical) lives in `@cms/api-types` (`customMessageSeverity`), shared
 * with the API, so a stored `WARN` row reads as Info everywhere.
 *
 * PURE — no React, no store, no network.
 */

import { customMessageSeverity, type CustomMessageSeverity } from '@cms/api-types';
import type { LiveMessage } from '@/lib/emergency-api';
import type { Translate } from '@/lib/emergency-target';

export type CustomMessageKind = CustomMessageSeverity;

/** The most characters one message may carry. A banner clips what does not fit — say so up front. */
export const CUSTOM_MESSAGE_MAX_CHARS = 500;

/** How long a message stays on screens unless it is cleared first, in minutes. Five is what it always was. */
export const CUSTOM_MESSAGE_DURATIONS_MIN = [5, 15, 30, 60] as const;
export const DEFAULT_CUSTOM_MESSAGE_MINUTES = 5;

/** Info or Critical — what an operator sees for ANY stored severity (WARN reads as Info). */
export function liveMessageKind(message: Pick<LiveMessage, 'severity'>): CustomMessageKind {
  return customMessageSeverity(message.severity);
}

/** The kind of emergency message a row is, for its small label ("Custom message", "Staff SOS", "Media alert"). */
export function liveMessageTypeKey(message: Pick<LiveMessage, 'type'>): string {
  switch (message.type) {
    case 'SOS':
      return 'emergency.message.typeSos';
    case 'MEDIA_ALERT':
      return 'emergency.message.typeMedia';
    default:
      return 'emergency.message.typeText';
  }
}

const NAMES_SHOWN = 3;

/**
 * Where a live message is, in words:
 *   "All screens" · "2 screens: Lobby, Gym" · "5 screens: Lobby, Gym, Cafe and 2 more"
 *   "A screen group" · "1 screen"
 */
export function liveMessageTargetLabel(t: Translate, message: LiveMessage): string {
  if (message.sendId) {
    const names = (message.targetScreens ?? [])
      .map((s) => s.name)
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    const count = message.targetScreenCount ?? names.length;
    if (names.length === 0) return t('emergency.message.targetCount', { count });
    const shown = names.slice(0, NAMES_SHOWN);
    return names.length > NAMES_SHOWN
      ? t('emergency.message.targetNamesMore', { count, names: shown.join(', '), more: names.length - NAMES_SHOWN })
      : t('emergency.message.targetNames', { count, names: shown.join(', ') });
  }
  if (message.scopeType === 'tenant') return t('emergency.target.allScreens');
  if (message.scopeType === 'group') return t('emergency.message.targetGroup');
  return t('emergency.message.targetCount', { count: 1 });
}

/** "2:15 PM" for a message that expires at `expiresAt` (UNIX seconds), or null for "until cleared". */
export function formatUntil(expiresAt: number | null | undefined, locale?: string): string | null {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) return null;
  try {
    return new Date(expiresAt * 1000).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return null;
  }
}

/** The label on a duration chip ("5 min", "1 hour"), as a catalog key + values. */
export function durationLabel(t: Translate, minutes: number): string {
  return minutes >= 60 && minutes % 60 === 0
    ? t('emergency.message.hours', { count: minutes / 60 })
    : t('emergency.message.minutes', { count: minutes });
}
