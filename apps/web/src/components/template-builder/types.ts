/**
 * Touch interaction model (Phase D1 — v1 launch, 2026-05-11).
 *
 * Backward-compatible expansion of the legacy 3-type shape. Pre-D1
 * rows in the DB used `{ type: 'navigate' | 'show' | 'url'; target }` —
 * those keep working unchanged. v1 adds primitives that cover the
 * 95% case based on the competitive survey (Intuiface, OptiSigns
 * Engage, BrightAuthor, PandaSuite) without their decision-paralysis
 * "200+ triggers" bloat.
 *
 * Each variant uses `target` as the universal destination field so
 * DB serialization stays a flat object — the player runtime + the
 * builder editor narrow on `type` to interpret `target` correctly.
 *
 * 8 primitives ship in v1 (research recommended 12; the remaining 4
 * — multi-touch gestures, native modals, print, on-screen-notification
 * — defer to D2 once the foundation is proven).
 */
export type TouchActionConfig =
  // Legacy v0 — preserved verbatim so prod rows keep deserializing.
  // `navigate` was never wired in the player runtime; treat it as a
  // synonym for `goto-template` going forward.
  | { type: 'navigate'; target: string }
  | { type: 'show'; target: string }
  | { type: 'url'; target: string }
  // ── v1 additions ────────────────────────────────────────────
  // Open an external URL — either in the kiosk's main WebView
  // (overlay iframe) or in a new tab/browser. Default to overlay
  // since kiosks rarely have a browser chrome to receive a new tab.
  | { type: 'open-url'; target: string; openInNewTab?: boolean }
  // Play a video asset and auto-return to the previous scene/template
  // when it ends (the kiosk-native UX — visitor taps "Watch tour,"
  // video plays, returns home).
  | { type: 'play-video'; target: string; returnOnEnd?: boolean }
  // Navigate to another template within the same tenant. Effectively
  // a "scene change" until the TemplateScene model lands in D2.
  | { type: 'goto-template'; target: string; transition?: 'cut' | 'fade' }
  // Modal overlay on top of the current scene — shows an image or
  // short video without leaving the current template. Tap-outside
  // dismisses.
  | { type: 'show-overlay'; target: string }
  // Reset the idle countdown without changing screen — used on
  // "Stay on this page" buttons in long content where we don't
  // want the auto-return to fire.
  | { type: 'reset-idle' }
  // Toggle audio on/off for the current scene — accessibility win
  // for noisy lobbies + lets visitors silence on-screen videos.
  | { type: 'sound-toggle' }
  // Fire an outbound webhook with a small JSON payload. Used for
  // POS lookups, room-booking pings, parent-notification triggers.
  // Player POSTs the resolved screen + tenant ids in the body so
  // the receiving system can correlate.
  | {
      type: 'webhook';
      target: string;
      method?: 'POST' | 'GET';
      payload?: Record<string, unknown>;
    }
  // In-app notification to admins (uses NotificationsService).
  // Visitor-driven "request help" → instant page to the front office.
  | { type: 'request-help'; target?: string; body?: string };

/** Action shape after the runtime resolves any aliases. Used by the player. */
export type ResolvedTouchAction = TouchActionConfig;

export interface Zone {
  id: string;
  name: string;
  widgetType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  sortOrder: number;
  defaultConfig?: Record<string, unknown> | null;
  locked?: boolean;
  touchAction?: TouchActionConfig | null;
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  category?: string;
  orientation?: string;
  screenWidth: number;
  screenHeight: number;
  bgColor?: string | null;
  bgImage?: string | null;
  bgGradient?: string | null;
  isSystem?: boolean;
  status?: string;
  zones: Zone[];
}

export interface HistoryEntry {
  zones: Zone[];
  meta: {
    name: string;
    description: string;
    screenWidth: number;
    screenHeight: number;
    bgColor: string;
    bgGradient: string;
    bgImage: string;
  };
}

export type DragMode = 'move' | 'resize';
export type ResizeHandle = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface DragState {
  mode: DragMode;
  zoneId: string;
  handle?: ResizeHandle;
  startX: number;
  startY: number;
  orig: Zone;
  additionalSelectedIds?: string[];
  origMulti?: Record<string, Zone>;
}

export interface SnapLine {
  orientation: 'v' | 'h';
  position: number;
  kind: 'grid' | 'edge' | 'center' | 'canvas';
}
