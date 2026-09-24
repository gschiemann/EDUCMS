/**
 * PointerEvent for jsdom (test-only).
 *
 * jsdom 26 — what jest-environment-jsdom 30 bundles — has no PointerEvent, so
 * `fireEvent.pointerEnter(el, { pointerType: 'touch' })` falls back to a bare
 * `Event` and `pointerType` never reaches React: a suite cannot tell a mouse
 * hover from a tap. Suites that assert that distinction (the playlist video
 * thumbnails must never play on touch) import this file first.
 *
 * Deliberately NOT in jest.setup.ts: a global PointerEvent would change how
 * every existing suite's `fireEvent.pointer*` calls construct their events.
 * Defined only when missing, so a jsdom that ships PointerEvent is left alone.
 */
type PointerEventInitLike = MouseEventInit & {
  pointerId?: number;
  pointerType?: string;
  isPrimary?: boolean;
  width?: number;
  height?: number;
  pressure?: number;
  tangentialPressure?: number;
  tiltX?: number;
  tiltY?: number;
  twist?: number;
};

if (typeof window !== 'undefined' && typeof (window as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    readonly width: number;
    readonly height: number;
    readonly pressure: number;
    readonly tangentialPressure: number;
    readonly tiltX: number;
    readonly tiltY: number;
    readonly twist: number;
    constructor(type: string, init: PointerEventInitLike = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? '';
      this.isPrimary = init.isPrimary ?? false;
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.pressure = init.pressure ?? 0;
      this.tangentialPressure = init.tangentialPressure ?? 0;
      this.tiltX = init.tiltX ?? 0;
      this.tiltY = init.tiltY ?? 0;
      this.twist = init.twist ?? 0;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { configurable: true, writable: true, value: PointerEventPolyfill });
}

export {};
