/**
 * @cms/scoreboard-cts/console-profiles — the registry that maps a
 * console *family* to its serial-port settings (so the bridge opens the
 * port correctly), its physical transport (native UART vs USB-serial),
 * and which decoder to drive.
 *
 * This is the small "ScoreSource / consoleProfile registry" piece the
 * score-data-ingestion research called for
 * (docs/research/2026-05-29-sports-provenue-gap/03-score-data-ingestion.md
 * item 1): keyed by console family → { serial settings, transport,
 * parser }. CTS and Daktronics drop in as registry entries; future
 * consoles (OES ISC9000, Electro-Mech) add a row here + a parser without
 * touching the bridge wiring.
 *
 * Pure data + types — no DOM, no parser instances. The bridge picks a
 * profile by id (query param / manifest config) and uses `.serial` to
 * open the Web Serial / native port, `.defaultTty` for the native open,
 * and `.decoder` to choose the parser.
 */

/** Serial line settings — the shape Web Serial's `port.open()` wants. */
export interface SerialSettings {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
}

/** Which decoder a profile drives. */
export type ConsoleDecoder = 'cts' | 'daktronics';

/**
 * How the player physically reads this console.
 *   - 'uart'       native hardware UART on the box (e.g. the EP6N /
 *                  ECBox3576 Phoenix terminal RS-232/RS-485 pins),
 *                  appears as /dev/ttyS*.
 *   - 'usb-serial' an FTDI USB↔serial adapter on a USB host port,
 *                  appears as /dev/ttyUSB*. This is the CTS-endorsed
 *                  "to a computer" path for the WTTC (its USB-B data
 *                  port → FTDI USB-RS232 → COM port). The EP6N is a
 *                  Linux box with USB host ports, so it reads the same
 *                  adapter as a PC would.
 */
export type ConsoleTransport = 'uart' | 'usb-serial';

/**
 * Aquatics sports the CTS decoder understands. Water polo is the
 * shipping target (Sprint 13 — first beta venue). Swimming is planned:
 * the CTS protocol family is the same, but swim adds lane-time / place
 * fields the water-polo `CtsGameState` doesn't model yet — so it stays a
 * known-future value here, not a wired one. (`packages/scoreboard-cts/
 * src/types.ts` is water-polo-only today.)
 */
export type CtsSport = 'water-polo' | 'swimming';

/**
 * Maturity of a profile against REAL hardware:
 *   - 'stable'      the established path — decoder matches the documented
 *                   protocol and has been exercised (bench / simulator).
 *   - 'provisional' wired + selectable, but the exact on-wire byte format
 *                   still needs a real-hardware capture to confirm. The
 *                   bridge still runs it; the label warns the operator.
 */
export type ConsoleStatus = 'stable' | 'provisional';

/** A console profile id. Extend as new consoles are supported. */
export type ConsoleProfileId = 'cts-gen6' | 'cts-gen7' | 'cts-wttc' | 'daktronics-allsport';

export interface ConsoleProfile {
  id: ConsoleProfileId;
  /** Human label for the bridge panel / dashboard picker. */
  label: string;
  /** Which decoder package entry handles this console's bytes. */
  decoder: ConsoleDecoder;
  /** Default serial settings for this console family. */
  serial: SerialSettings;
  /** Physical read path (native UART vs USB-serial adapter). */
  transport: ConsoleTransport;
  /** Default tty the player opens for this profile (overridable on-site
   *  via the `?ctsTty=` URL param). 'uart' → /dev/ttyS1; 'usb-serial' →
   *  /dev/ttyUSB0. */
  defaultTty: string;
  /** Aquatics sports this profile's decoder currently understands.
   *  Omitted for non-CTS consoles (Daktronics carries its own sport via
   *  the `daktronicsSport` prop). */
  sports?: CtsSport[];
  /** Hardware-maturity flag (see ConsoleStatus). */
  status: ConsoleStatus;
  /** One-line engineer/operator note shown in the picker help text. */
  notes?: string;
}

/**
 * The profile registry.
 *
 *   - cts-gen6           Colorado Time Systems System 6 / Gen 6.
 *                        RS-232 9600 / 8 / EVEN / 1 over a 1/4" jack,
 *                        read on the box's native UART (/dev/ttyS1).
 *                        Aquatics / water polo. The established path.
 *   - cts-wttc           CTS Wireless Tabletop Controller (WTTC-1).
 *                        Reached via its USB-B data port → an FTDI
 *                        USB↔serial adapter → /dev/ttyUSB0 (the same kit
 *                        CTS recommends for a PC). Decoder = CTS; the
 *                        WTTC is a WA-2/WA-3-generation unit, so the exact
 *                        byte format (legacy CTS vs Gen7/WA-2) is PENDING
 *                        a real-hardware capture — hence `provisional`.
 *                        See docs/research/2026-06-01-wttc-water-polo/.
 *   - daktronics-allsport
 *                        Daktronics All Sport 5000 / 5500 / 3000 Enhanced
 *                        RTD. RS-232 19200 / 8 / NONE / 1 via the Port
 *                        Expander. Football / basketball / baseball.
 */
export const CONSOLE_PROFILES: Record<ConsoleProfileId, ConsoleProfile> = {
  'cts-gen6': {
    id: 'cts-gen6',
    label: 'Colorado Time Systems (Gen 6 / System 6)',
    decoder: 'cts',
    serial: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'even' },
    transport: 'uart',
    defaultTty: '/dev/ttyS1',
    sports: ['water-polo'],
    status: 'stable',
    notes: 'Wired RS-232 (1/4" jack) into the box’s native UART.',
  },
  'cts-gen7': {
    id: 'cts-gen7',
    label: 'Colorado Time Systems (Gen 7 — RS-232 output)',
    decoder: 'cts',
    // Gen 7 exposes TWO scoreboard outputs: RS-232 (the legacy "CTS"
    // protocol — what CtsParser decodes, identical bytes to Gen 6) and
    // RS-485 ("Gen7/WA-2" — a DIFFERENT protocol we do NOT decode yet).
    // This profile = the RS-232 output, so it works today exactly like
    // Gen 6. If a venue only exposes the RS-485 output, that's a separate
    // future profile once the Gen7/WA-2 decoder lands.
    serial: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'even' },
    transport: 'uart',
    defaultTty: '/dev/ttyS1',
    sports: ['water-polo'],
    status: 'stable',
    notes: 'Tap the Gen 7 RS-232 scoreboard output (legacy CTS protocol). Its RS-485 "Gen7/WA-2" output is a different protocol, not yet decoded.',
  },
  'cts-wttc': {
    id: 'cts-wttc',
    label: 'CTS Wireless Tabletop Controller (WTTC)',
    decoder: 'cts',
    // Starting point = CTS’s standard 9600/8/E/1. Confirm against a
    // capture; override on-site with ?ctsBaud=/?ctsParity= if the WTTC
    // SCBD/USB feed differs.
    serial: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'even' },
    transport: 'usb-serial',
    defaultTty: '/dev/ttyUSB0',
    sports: ['water-polo'],
    status: 'provisional',
    notes: 'USB-B → FTDI USB-serial (/dev/ttyUSB0). Byte format pending a real-hardware capture — see docs/research/2026-06-01-wttc-water-polo.',
  },
  'daktronics-allsport': {
    id: 'daktronics-allsport',
    label: 'Daktronics All Sport 5000',
    decoder: 'daktronics',
    serial: { baudRate: 19200, dataBits: 8, stopBits: 1, parity: 'none' },
    transport: 'uart',
    defaultTty: '/dev/ttyS1',
    // 2026-06-09 Fable audit — honesty: the byte offsets (offsets.ts) are
    // derived from third-party reverse-engineering tables with UNCERTAIN
    // entries (playClock/possession) and have NOT been validated against a
    // real All Sport 5000 RTD capture. 'provisional' until a captured RTD
    // session confirms them (keep that capture as a test fixture, then
    // promote to 'stable'). Same evidence bar the water-polo profile uses.
    status: 'provisional',
    notes: 'Enhanced RTD over RS-232 via the Port Expander. Byte offsets pending a real-hardware capture — playClock/possession fields unconfirmed.',
  },
};

/** The default profile when none is specified — CTS Gen 6, to preserve
 *  the pre-existing single-console behavior exactly. */
export const DEFAULT_CONSOLE_PROFILE: ConsoleProfileId = 'cts-gen6';

/** Resolve a profile id (e.g. from a query param) to its profile,
 *  falling back to the default for any unknown value. */
export function resolveConsoleProfile(id: string | null | undefined): ConsoleProfile {
  if (id && id in CONSOLE_PROFILES) {
    return CONSOLE_PROFILES[id as ConsoleProfileId];
  }
  return CONSOLE_PROFILES[DEFAULT_CONSOLE_PROFILE];
}
