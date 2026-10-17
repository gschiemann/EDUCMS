/**
 * The resolution a re-registration may store (2026-10-17, player rock-solid
 * program §1 "4K screens drop back"; Astra's resolution triage of 2026-10-15).
 *
 * WHY. The manifest picks a screen's video file from `Screen.resolution`
 * (`selectVideoFile`): a panel that fits inside 1920×1080 gets the 1080p copy,
 * anything bigger the original. Registration used to store any non-empty
 * report as authoritative (`body.resolution || existing.resolution`), and the
 * web player sends one of two very different things under that one field
 * (`getDeviceInfo()` in apps/web/src/app/player/page.tsx):
 *
 *   • `?w=&h=` from the page URL — the APK's PHYSICAL pixel count
 *     (`getRealDisplaySize()`, MainActivity.loadPlayer), or an operator's
 *     explicit override through the player's own resolution form;
 *   • `window.screen` otherwise — DPI-scaled CSS pixels that read 2–3× small
 *     on a HiDPI panel. A double-sided unit's face never gets `?w=&h=` on
 *     purpose (FacePlayerHost, 2026-09-19), and any page that lost its query
 *     falls back the same way.
 *
 * So one browser-sized report (1080×1668 on a 2160×3840 panel) silently moved
 * a 4K screen onto the 1080p copy until a later register said 4K again. The
 * user agent cannot tell the two apart: a face's WebView carries
 * `EduCmsPlayer/` too. The page now says which one it sent
 * (`resolutionSource`), and this rule keeps a known size unless the new one is
 * at least as large, or comes from the device itself.
 *
 * RULE
 *   • nothing / unparseable reported → keep what is stored (a known size is
 *     never replaced by garbage; with nothing stored, today's raw write);
 *   • nothing parseable stored → take the report (first fact wins);
 *   • a report at least as large (by pixel area — a rotation keeps the area) →
 *     take it; growth is always believable;
 *   • a SMALLER report → only when `resolutionSource === 'device'` (the URL's
 *     physical size: the APK, or an operator override). A legitimate panel
 *     change — the box moved to a smaller display — arrives exactly that way.
 *     A browser-sized report, and a report from a page that predates the
 *     field, never shrinks a known size.
 *
 * Pure; the caller passes the stored row's value and the request body.
 */

export type ResolutionSource = 'device' | 'browser';

export function parseResolution(resolution: unknown): { w: number; h: number } | null {
  const m = /^\s*(\d{2,6})\s*[x×X*]\s*(\d{2,6})\s*$/.exec(typeof resolution === 'string' ? resolution : '');
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
}

export function registeredResolution(
  stored: string | null | undefined,
  reported: unknown,
  source: unknown,
): string | null {
  const rep = typeof reported === 'string' ? reported.trim() : '';
  const kept = typeof stored === 'string' && stored ? stored : null;
  if (!rep) return kept;
  const next = parseResolution(rep);
  const prev = parseResolution(kept);
  if (!next) return prev ? kept : rep;
  if (!prev) return rep;
  if (next.w * next.h >= prev.w * prev.h) return rep;
  return source === 'device' ? rep : kept;
}
