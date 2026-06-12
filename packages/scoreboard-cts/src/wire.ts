/**
 * CtsWireParser — the production decode front-door (2026-06-12 cutover).
 *
 * Drop-in replacement for the legacy `CtsParser` with the SAME public API
 * (feed / onUpdate / getState / reset / flush / getLastClockPacketAt /
 * getClockPacketIntervalMs — the surface CtsBridge consumes), but backed
 * by the REAL wire decoders:
 *
 *   wire: 'classic'  → ClassicCtsDecoder (legacy RS-232; validated against
 *                      real console captures in __tests__/fixtures)
 *   wire: 'gen7wa2'  → Gen7Parser (WTTC RS-485 stream; reference-parity,
 *                      pending a real-hardware capture)
 *
 * Both feed the shared ChannelGrid → configurable F872 water-polo
 * extractor, so venue Define-Module deviations are a map override, not a
 * code change. The legacy CtsParser (self-invented framing that only our
 * old emulator spoke — see real-wire.test.ts) stays exported for one
 * release for any straggler imports, but nothing in the app should
 * construct it anymore.
 */

import { ClassicCtsDecoder } from './classic';
import { Gen7Parser } from './gen7';
import {
  ChannelGrid,
  emptySnapshot,
  extractWaterPolo,
  resolveWaterPoloMap,
  WaterPoloChannelMap,
} from './grid';
import type { CtsFullSnapshot, CtsUpdateListener } from './types';

export type CtsWireFormat = 'classic' | 'gen7wa2';

export interface CtsWireParserOptions {
  /** Wire framing. Defaults to 'classic' (Gen 6 / System 6 / Gen 7 RS-232). */
  wire?: CtsWireFormat;
  /** Venue channel-map override merged over the F872 defaults. */
  waterPoloMap?: Partial<WaterPoloChannelMap> | null;
  /** Diagnostics hook (checksum failures, invalid channels). */
  onWarning?: (msg: string) => void;
}

export class CtsWireParser {
  readonly wire: CtsWireFormat;

  private readonly map: WaterPoloChannelMap;
  private readonly listeners = new Set<CtsUpdateListener>();
  private snapshot: CtsFullSnapshot = emptySnapshot();

  private classic: ClassicCtsDecoder | null = null;
  private gen7: Gen7Parser | null = null;

  // Clock cadence — same semantics the legacy parser exposed for the
  // bridge's clockRunning derivation (T2-1): wall-clock timestamps of the
  // last two CLOCK-value changes. At tenths cadence the interval is
  // ~100ms; at whole-second cadence ~1000ms. "Running" upstream =
  // now < lastClockPacketAt + interval × 1.5.
  private lastClockAt = 0;
  private prevClockAt = 0;
  private lastClockValue = '';

  // Change-only emission (legacy-parser parity): a console idly re-sending
  // the same display image must not fan duplicate updates into the bridge's
  // POST throttle. receivedAt is excluded from the comparison.
  private lastEmittedKey = '';

  constructor(private readonly opts: CtsWireParserOptions = {}) {
    this.wire = opts.wire === 'gen7wa2' ? 'gen7wa2' : 'classic';
    this.map = resolveWaterPoloMap(opts.waterPoloMap);
    this.initDecoders();
  }

  private initDecoders(): void {
    if (this.wire === 'gen7wa2') {
      this.gen7 = new Gen7Parser({
        waterPoloMap: this.opts.waterPoloMap,
        onWarning: this.opts.onWarning,
      });
      this.gen7.subscribe((snap) => this.adopt(snap));
      this.classic = null;
    } else {
      this.classic = new ClassicCtsDecoder({
        onGridChange: (grid) => this.extractClassic(grid),
        onWarning: this.opts.onWarning,
      });
      this.gen7 = null;
    }
  }

  /** The decoded display image (diagnostics / capture reconciliation). */
  get grid(): ChannelGrid | null {
    return this.gen7 ? this.gen7.grid : this.classic ? this.classic.grid : null;
  }

  public feed(bytes: Uint8Array | number[]): void {
    if (this.gen7) {
      this.gen7.feed(bytes);
      return;
    }
    this.classic?.feed(bytes);
  }

  /** Legacy API parity — both real framings commit per byte/packet, so
   *  there is no partial-module tail to force out. */
  public flush(): void {
    /* no-op by design */
  }

  public onUpdate(listener: CtsUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getState(): CtsFullSnapshot {
    return this.snapshot;
  }

  public reset(): void {
    this.snapshot = emptySnapshot();
    this.lastClockAt = 0;
    this.prevClockAt = 0;
    this.lastClockValue = '';
    this.lastEmittedKey = '';
    this.initDecoders();
  }

  public getLastClockPacketAt(): number {
    return this.lastClockAt;
  }

  public getClockPacketIntervalMs(): number {
    if (this.lastClockAt === 0 || this.prevClockAt === 0) return 0;
    return this.lastClockAt - this.prevClockAt;
  }

  private extractClassic(grid: ChannelGrid): void {
    const next = extractWaterPolo(grid, this.map, this.snapshot, false, Date.now());
    this.adopt(next);
  }

  private adopt(next: CtsFullSnapshot): void {
    if (next.clock && next.clock !== this.lastClockValue) {
      this.prevClockAt = this.lastClockAt;
      this.lastClockAt = Date.now();
      this.lastClockValue = next.clock;
    }
    this.snapshot = next;
    const key = JSON.stringify({ ...next, receivedAt: 0 });
    if (key === this.lastEmittedKey) return;
    this.lastEmittedKey = key;
    for (const fn of this.listeners) fn(this.snapshot);
  }
}
