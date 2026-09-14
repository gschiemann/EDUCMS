// Deterministic, zero-LLM "proactive suggestion" engine for the template
// builder (flagship Slice 1a, 2026-06-16). It lints the open board against
// the SAME hard constraints we already encode in CI (Taurus-safety, touch
// tap-targets, on-screen geometry) and returns one-tap-fix suggestions that
// apply through the store's updateZone(id, patch, commit:true) path — so the
// fix is a normal, undoable edit. No network, no provider, no cost, and the
// checks are uniquely ours because the rules ARE our device constraints.
//
// v1 is intentionally geometry-only (no widget-config key guessing) so every
// fix is provably correct: off-screen elements, untappable touch targets, and
// hairline elements. Contrast / 8-ft font-size / brand-palette checks are a
// fast-follow once the per-widget config keys are confirmed (see BUILD-LOG).
import type { Zone } from './types';

export type SuggestionSeverity = 'warn' | 'tip';

export interface Suggestion {
  /** Stable id per (rule, zone) so React keys + dismissal stay consistent. */
  id: string;
  severity: SuggestionSeverity;
  /** The zone this is about (so the panel can select/jump to it). */
  zoneId?: string;
  /** Short chip label. */
  title: string;
  /** One-line plain-English explanation for a non-technical operator. */
  detail: string;
  /** Optional one-tap fix: a zone patch applied via updateZone(zoneId, patch, true). */
  fix?: { label: string; patch: Partial<Zone> };
}

export interface SuggestionInput {
  zones: Zone[];
  screenWidth: number;
  screenHeight: number;
  isTouchEnabled: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const MIN_TAP_PX = 44; // WCAG / Apple HIG minimum touch target
const TAP_TARGET_PX = 48; // grow targets to a comfortable 48 (a hair over the floor)
const TINY_PCT = 3; // below this in either dimension is almost always a mistake
// Text-bearing widgets. Overlap between two of these is the classic signage
// layout fire (copy rendered on top of copy → unreadable). We only flag
// text-on-text so we never nag about intentional layering — text on a
// background panel, a logo over a photo, a badge in a corner.
const TEXT_WIDGETS = new Set(['TEXT', 'RICH_TEXT', 'ANNOUNCEMENT', 'TICKER', 'QUOTE', 'HEADLINE']);
const OVERLAP_MIN_RATIO = 0.35; // intersection ≥35% of the smaller block = a real collision

function zoneLabel(z: Zone): string {
  const n = (z.name || '').trim();
  if (n) return n;
  return (z.widgetType || 'Element').replace(/_/g, ' ').toLowerCase();
}

/**
 * Compute the (possibly multiple) suggestions for the current board.
 * Pure + synchronous — safe to call on every render (cheap; O(zones)).
 */
export function computeSuggestions(input: SuggestionInput): Suggestion[] {
  const { zones, screenWidth, screenHeight, isTouchEnabled } = input;
  const out: Suggestion[] = [];
  if (!Array.isArray(zones) || zones.length === 0) return out;

  const w = screenWidth > 0 ? screenWidth : 1920;
  const h = screenHeight > 0 ? screenHeight : 1080;

  for (const z of zones) {
    // Codex T02 (2026-09-13): a locked zone is still DIAGNOSED — a locked
    // off-screen widget is exactly the kind of thing Review exists to catch —
    // but never auto-fixed: geometry patches are ignored on locked zones
    // (M0-7), so a "fix" would silently do nothing. The fix is stripped below.
    const x = Number(z.x) || 0;
    const y = Number(z.y) || 0;
    const zw = Number(z.width) || 0;
    const zh = Number(z.height) || 0;
    const label = zoneLabel(z);

    // ── 1. OFF-SCREEN — runs past a canvas edge (top text-overlap fire) ──
    const fitW = clamp(zw, 1, 100);
    const fitH = clamp(zh, 1, 100);
    const fitX = clamp(x, 0, 100 - fitW);
    const fitY = clamp(y, 0, 100 - fitH);
    const offScreen = fitX !== x || fitY !== y || fitW !== zw || fitH !== zh;
    if (offScreen) {
      out.push({
        id: `offscreen:${z.id}`,
        severity: 'warn',
        zoneId: z.id,
        title: `Off-screen: ${label}`,
        detail: 'This element runs past the screen edge, so part of it won’t show. Pull it fully into frame.',
        fix: { label: 'Bring into frame', patch: { x: round1(fitX), y: round1(fitY), width: round1(fitW), height: round1(fitH) } },
      });
      continue; // don't double-flag an off-screen zone for size
    }

    // ── 2. UNTAPPABLE — interactive touch target below ~44px ──
    const isInteractive = !!z.touchAction && (z.touchAction as { type?: string }).type !== undefined;
    if (isTouchEnabled && isInteractive) {
      const pxW = Math.round((zw / 100) * w);
      const pxH = Math.round((zh / 100) * h);
      if (pxW < MIN_TAP_PX || pxH < MIN_TAP_PX) {
        const needW = Math.max(zw, (TAP_TARGET_PX / w) * 100);
        const needH = Math.max(zh, (TAP_TARGET_PX / h) * 100);
        const newW = clamp(needW, 1, 100);
        const newH = clamp(needH, 1, 100);
        out.push({
          id: `taptarget:${z.id}`,
          severity: 'warn',
          zoneId: z.id,
          title: `Hard to tap: ${label}`,
          detail: `This is a tappable element but it’s only ${pxW}×${pxH}px on this screen — below the ~44px finger-friendly minimum.`,
          fix: {
            label: 'Make it tappable',
            patch: {
              width: round1(newW),
              height: round1(newH),
              x: round1(clamp(x, 0, 100 - newW)),
              y: round1(clamp(y, 0, 100 - newH)),
            },
          },
        });
        continue;
      }
    }

    // ── 3. HAIRLINE — almost certainly an accidental nudge ──
    if (zw < TINY_PCT || zh < TINY_PCT) {
      const newW = Math.max(zw, 8);
      const newH = Math.max(zh, 6);
      out.push({
        id: `tiny:${z.id}`,
        severity: 'tip',
        zoneId: z.id,
        title: `Very small: ${label}`,
        detail: 'This element is tiny — likely shrunk by accident. Tap to review it, or resize to a sensible size.',
        fix: {
          label: 'Resize',
          patch: {
            width: round1(clamp(newW, 1, 100)),
            height: round1(clamp(newH, 1, 100)),
            x: round1(clamp(x, 0, 100 - clamp(newW, 1, 100))),
            y: round1(clamp(y, 0, 100 - clamp(newH, 1, 100))),
          },
        },
      });
    }
  }

  // ── 4. OVERLAPPING TEXT — two text blocks sitting on top of each other.
  //    The #1 non-touch layout fire (and a touch one too): unreadable copy.
  //    Text-on-text only, ≥35% of the smaller block, so intentional layering
  //    (text on a background, logo on a photo) is never flagged. Informational
  //    — selecting jumps to the top block so the operator can nudge it. ──
  // Codex T02 (2026-09-13): two scenes are never on screen together, so text in
  // scene A cannot overlap text in scene B. Evaluate each scene with the SHARED
  // zones (no sceneId) that play under it; a board without scenes is one group.
  // Shared-vs-shared pairs repeat per scene, so findings are deduplicated by id.
  const allText = zones.filter((z) => TEXT_WIDGETS.has(String(z.widgetType || '').toUpperCase()));
  const sceneIds = Array.from(new Set(allText.map((z) => z.sceneId).filter((id): id is string => !!id)));
  const shared = allText.filter((z) => !z.sceneId);
  const groups = sceneIds.length === 0 ? [allText] : sceneIds.map((sid) => shared.concat(allText.filter((z) => z.sceneId === sid)));
  const seenOverlap = new Set<string>();
  for (const textZones of groups) for (let i = 0; i < textZones.length; i++) {
    for (let j = i + 1; j < textZones.length; j++) {
      const a = textZones[i];
      const b = textZones[j];
      const pairId = `overlap:${[a.id, b.id].sort().join('~')}`;
      if (seenOverlap.has(pairId)) continue;
      const ax = Number(a.x) || 0, ay = Number(a.y) || 0, aw = Number(a.width) || 0, ah = Number(a.height) || 0;
      const bx = Number(b.x) || 0, by = Number(b.y) || 0, bw = Number(b.width) || 0, bh = Number(b.height) || 0;
      const ix = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
      const iy = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
      const interArea = ix * iy;
      if (interArea <= 0) continue;
      const minArea = Math.min(aw * ah, bw * bh);
      if (minArea > 0 && interArea / minArea >= OVERLAP_MIN_RATIO) {
        const top = (Number(a.zIndex) || 0) >= (Number(b.zIndex) || 0) ? a : b;
        const other = top === a ? b : a;
        seenOverlap.add(pairId);
        out.push({
          id: pairId,
          severity: 'warn',
          zoneId: top.id,
          title: `Overlapping text: ${zoneLabel(top)}`,
          detail: `“${zoneLabel(top)}” and “${zoneLabel(other)}” sit on top of each other — the text will be hard to read. Move one apart.`,
        });
      }
    }
  }

  // Locked zones: keep the diagnosis, drop the one-tap fix, say why.
  const lockedIds = new Set(zones.filter((z) => z.locked).map((z) => z.id));
  for (const sug of out) {
    if (sug.zoneId && lockedIds.has(sug.zoneId) && sug.fix) {
      delete sug.fix;
      sug.detail += ' This element is locked — unlock it to move or resize it.';
    }
  }

  // warnings before tips
  out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warn' ? -1 : 1));
  return out;
}
