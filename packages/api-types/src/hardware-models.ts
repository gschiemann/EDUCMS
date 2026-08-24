/**
 * VenueOS — hardware-target catalog.
 *
 * Single source of truth for the player-hardware models VenueOS officially
 * supports. Drives:
 *   - Screen.hardwareModel column (schema.prisma — additive nullable)
 *   - GET /api/v1/hardware/catalog (dashboard renders capability matrix)
 *   - Per-screen "Hardware" panel in the dashboard's Diagnostics drawer
 *     (only the cells true for the screen's hardware model appear)
 *   - Sport-engine UI gating — dual-RS232 wiring panel only on EP6N,
 *     GPIO panic-button setup only where caps.gpioIn > 0, etc.
 *   - Chromium-min warning chip — anything ≤ 83 surfaces a CLAUDE.md
 *     rule #10 reminder ("uses long-hand CSS — no `inset` shorthand,
 *     no flex `gap`").
 *
 * 2026-05-27 — added with the EP6N becoming the canonical sports-vertical
 * player (docs/EP6N_HARDWARE_EVAL.md). Existing screens row hardwareModel
 * defaults to NULL = "unknown" — the dashboard treats null as a passive
 * state (no capability chips, no warnings, no I/O panels). New screens
 * paired after this commit get the operator a dropdown to pick the model.
 *
 * IMPORTANT: when adding a new HardwareModel:
 *   1. Add the literal to `HardwareModel` union (this file)
 *   2. Add an entry to HARDWARE_CATALOG (this file) — TypeScript will
 *      not compile until every union member has a catalog entry
 *      thanks to Record<HardwareModel, HardwareCapabilities>
 *   3. The runtime check in hardware-models.spec.ts also asserts this
 *      so a typo in either side fails CI loudly
 *   4. Existing screens are unaffected — hardwareModel stays NULL on
 *      every paired-pre-launch row until an admin picks the value
 */

export type HardwareModel =
  | 'goodview-ep6n'
  | 'goodview-ecbox3576'
  | 'novastar-taurus'
  | 'maxhub-l55vec'
  | 'pi5'
  | 'generic-android'
  | 'web'
  | 'unknown';

/** Every model literal exposed to UI / API consumers, in catalog-display order. */
export const HARDWARE_MODELS: readonly HardwareModel[] = [
  'goodview-ep6n',
  'goodview-ecbox3576',
  'novastar-taurus',
  'maxhub-l55vec',
  'pi5',
  'generic-android',
  'web',
  'unknown',
] as const;

/**
 * What a player-hardware device can do. Every flag is queried at least once
 * in the dashboard to gate UI ("show GPIO setup only if gpioIn > 0") and
 * eventually at the player layer to refuse misconfiguration ("the operator
 * tried to wire a Stream Deck on RS232 #2 but caps.serialPorts < 2").
 */
export interface HardwareCapabilities {
  /** Display name shown in dashboards. */
  name: string;
  /** Vendor / SKU URL. Null when the device doesn't have a public spec page. */
  productPageUrl?: string | null;
  /** SoC + OS combo, single-line for display. */
  socOs: string;
  /** Verticals this hardware is recommended for (informational). */
  recommendedVerticals: string[];
  /**
   * The orientation this chassis PHYSICALLY IS, when the product only exists
   * one way up (a floor-standing kiosk / totem). Omitted for the normal case
   * of a flat panel that can be hung either way.
   *
   * ⚠️ WHY THIS EXISTS (2026-08-24). Orientation cannot be read off the
   * panel: a MAXHUB L55VEC kiosk reports a 3840×2160 LANDSCAPE framebuffer
   * even though the product cannot be mounted landscape at all, while a
   * Goodview M43GUQ hung portrait reports 2160×3840 because its ROM was
   * configured for it. Same mounting, opposite readings, and no Android API
   * distinguishes them — so an operator was forced to set portrait by hand on
   * a unit that is only ever portrait.
   *
   * The MODEL is the signal the framebuffer isn't. When the chassis only
   * exists one way up, that is a hardware fact we can assert without asking.
   * Only set this for hardware that genuinely cannot be mounted the other
   * way; a panel an operator MIGHT rotate must stay undeclared, or we would
   * be overriding a real installation choice with a guess.
   */
  nativeOrientation?: 'PORTRAIT' | 'LANDSCAPE';
  /** Whether the device has each capability. */
  caps: {
    /** # of native RS232 ports on the device's I/O ring (not via USB-serial adapter). */
    serialPorts: number;
    /** Native RS485 differential serial. */
    rs485: boolean;
    /** GPIO input lines (dry-contact / panic-button / fire-alarm panel). */
    gpioIn: number;
    /** GPIO output lines (relay drive — door strike, status lamp, horn). */
    gpioOut: number;
    /** HDMI INPUT — broadcast capture, ref-cam, customer-supplied source. */
    hdmiIn: boolean;
    /** HDMI OUTPUT — drives the display. */
    hdmiOut: boolean;
    /** Dedicated network IN jack. */
    rj45In: boolean;
    /** Passthrough OUT to a downstream device. */
    rj45Out: boolean;
    /** Voltage exposed on an aux power pin (e.g. EP6N Phoenix terminal 12V), or null. */
    powerOutVolts: number | null;
    /** NPU compute in INT8 TOPS (0 = no NPU / not exposed). */
    npuTops: number;
    /** Application processor core count. */
    cpuCores: number;
    /** Installed RAM in GB. */
    ramGb: number;
    /** Internal storage in GB. */
    storageGb: number;
    /** Decodes 4K H.264 / H.265. */
    decode4k: boolean;
    /** Passive cooling (no fan failure mode). */
    fanless: boolean;
    /** Vendor explicitly rates the device for 24/7 duty. */
    duty247Rated: boolean;
    /**
     * Minimum Chromium major version the device's WebView reports.
     * Anything <= 83 triggers CLAUDE.md rule #10 — UI surfaces a warning
     * so widget authors avoid `inset` shorthand, `gap` on flex, etc.
     * 999 = "modern Chromium" (web / generic Android with current WebView).
     */
    chromiumMin: number;
  };
}

/**
 * Authoritative capability matrix.
 *
 * 2026-05-27 — every entry below is sourced from a real spec sheet
 * referenced in docs/. Do NOT invent capability values; if you don't have
 * the vendor doc, set the field to a conservative default (false / 0) and
 * leave a TODO so the next operator can verify.
 */
export const HARDWARE_CATALOG: Record<HardwareModel, HardwareCapabilities> = {
  // Source: docs/EP6N_HARDWARE_EVAL.md (2026-05-27). All fields confirmed
  // against the EP6N V1.0 spec sheet Greg dropped.
  'goodview-ep6n': {
    name: 'Goodview EP6N',
    productPageUrl: 'https://www.goodview-display.com/',
    socOs: 'Rockchip RK3576 (8-core A72+A53 @ 2.2 GHz) · Android 14',
    recommendedVerticals: ['SPORTS', 'K12', 'CORPORATE'],
    caps: {
      serialPorts: 2,
      rs485: true,
      gpioIn: 2,
      gpioOut: 2,
      hdmiIn: true,
      hdmiOut: true,
      rj45In: true,
      rj45Out: true,
      powerOutVolts: 12,
      npuTops: 6,
      cpuCores: 8,
      ramGb: 4,
      storageGb: 64,
      decode4k: true,
      fanless: true,
      duty247Rated: true,
      // Android 14 ships Chromium-current WebView (updateable via Play
      // Store). Conservative floor: 120 (Android 14 launched Q4 2023
      // with Chromium 119; Play-Store-updateable WebView keeps pace).
      chromiumMin: 120,
    },
  },

  // Source: docs/ECBOX3576_CTS_SETUP.md (existing). RK3576 same SoC family
  // as EP6N but trimmed I/O ring — single Phoenix-RS232, no HDMI IN,
  // no GPIO, no RJ45 passthrough, ~2/16 RAM/storage typical.
  'goodview-ecbox3576': {
    name: 'Goodview ECBox 3576',
    productPageUrl: 'https://www.goodview-display.com/',
    socOs: 'Rockchip RK3576 · Android 14',
    recommendedVerticals: ['K12', 'CORPORATE', 'QSR'],
    caps: {
      serialPorts: 1,
      rs485: true,
      gpioIn: 0,
      gpioOut: 0,
      hdmiIn: false,
      hdmiOut: true,
      rj45In: true,
      rj45Out: false,
      powerOutVolts: null,
      // RK3576 has a 3 TOPS NPU per Rockchip datasheet; ECBox doesn't
      // expose it through a documented userland yet so leave headroom
      // accurate but flagged as not-yet-customer-facing.
      npuTops: 3,
      cpuCores: 8,
      ramGb: 2,
      storageGb: 16,
      decode4k: true,
      fanless: true,
      // ECBox doc says "commercial duty" without explicit 24/7 stamp;
      // mark false to drive the dashboard chip honestly.
      duty247Rated: false,
      chromiumMin: 120,
    },
  },

  // Source: NovaStar Taurus controllers. Chromium 83 is the production
  // pain point — CLAUDE.md rule #10 exists because of this device. One
  // HDMI out (drives the LED wall), no other I/O. Player IS the LED
  // controller in this deployment topology.
  'novastar-taurus': {
    name: 'NovaStar Taurus (LED controller-native)',
    productPageUrl: 'https://www.novastar.tech/',
    socOs: 'NovaStar SoC · Android 7 (Chromium 83 WebView)',
    recommendedVerticals: ['SPORTS', 'RETAIL', 'CORPORATE'],
    caps: {
      serialPorts: 0,
      rs485: false,
      gpioIn: 0,
      gpioOut: 0,
      hdmiIn: false,
      hdmiOut: true,
      rj45In: true,
      rj45Out: false,
      powerOutVolts: null,
      npuTops: 0,
      cpuCores: 4,
      ramGb: 2,
      storageGb: 16,
      decode4k: false,
      // Active cooling in the rack-mounted units; mark false rather than
      // claim fanless and surprise an operator.
      fanless: false,
      // NovaStar markets 24/7 LED operation; the SoC is sized for it.
      duty247Rated: true,
      // THE Chromium-83 device. CLAUDE.md rule #10.
      chromiumMin: 83,
    },
  },

  // Source: Raspberry Pi 5 4GB. Linux + Chromium (latest stable on Pi OS
  // tracks within a few weeks of upstream). GPIO via 40-pin header; no
  // native RS232 (use USB-serial adapter if needed).
  pi5: {
    name: 'Raspberry Pi 5',
    productPageUrl: 'https://www.raspberrypi.com/products/raspberry-pi-5/',
    socOs: 'Broadcom BCM2712 (4× A76 @ 2.4 GHz) · Pi OS (Chromium-current)',
    recommendedVerticals: ['K12', 'CORPORATE', 'GYM'],
    caps: {
      // 40-pin header exposes UART; not the same as a Phoenix RS232 port.
      // Mark 0 to keep the dual-RS232 wiring panel hidden on Pi.
      serialPorts: 0,
      rs485: false,
      // 40-pin header: ~26 usable GPIO. Mark a conservative pair for the
      // "two emergency dry-contact" use case; the Pi can drive more but
      // we don't expose the full pin map in the dashboard.
      gpioIn: 2,
      gpioOut: 2,
      hdmiIn: false,
      hdmiOut: true,
      rj45In: true,
      rj45Out: false,
      powerOutVolts: 5, // 5V/3.3V rails on the header
      npuTops: 0,
      cpuCores: 4,
      ramGb: 4,
      storageGb: 32,
      decode4k: true,
      fanless: false,
      // Pi has no formal 24/7 rating — Yodeck etc. ship them but mark
      // honestly so the operator knows the spec sheet doesn't promise it.
      duty247Rated: false,
      chromiumMin: 120,
    },
  },

  // Source: generic Android stick / set-top box (the "no-name" tier).
  // Single HDMI out, no special I/O, modern Chromium via Play Services.
  'maxhub-l55vec': {
    name: 'MAXHUB L55VEC portrait kiosk',
    productPageUrl: null,
    socOs: 'Amlogic T982 (t982_ar301) · Android 13 · Chromium 101',
    recommendedVerticals: ['RETAIL', 'QSR', 'CORPORATE'],
    // ⭐ The whole point of this entry. A floor-standing kiosk chassis: it
    // cannot be mounted landscape, yet it reports a 3840×2160 LANDSCAPE
    // framebuffer, so every resolution-based guess gets it exactly wrong.
    nativeOrientation: 'PORTRAIT',
    caps: {
      // SoC/OS/Chromium above are READ FROM A REAL UNIT (Build.* + UA of the
      // operator's own L55VEC). The I/O and memory figures below are NOT —
      // they are the conservative generic-Android defaults, deliberately not
      // invented from a spec sheet nobody here has read. They gate optional
      // UI only (serial panels, GPIO setup); understating them hides a panel
      // rather than offering one the hardware cannot honour. Correct them
      // from the vendor datasheet when someone has it in hand.
      serialPorts: 0,
      rs485: false,
      gpioIn: 0,
      gpioOut: 0,
      hdmiIn: false,
      hdmiOut: true,
      rj45In: true,
      rj45Out: false,
      powerOutVolts: null,
      npuTops: 0,
      cpuCores: 4,
      ramGb: 2,
      storageGb: 16,
      decode4k: true,
      fanless: false,
      duty247Rated: false,
      chromiumMin: 101,
    },
  },
  'generic-android': {
    name: 'Generic Android player',
    productPageUrl: null,
    socOs: 'Various ARM · Android 11+ (Chromium-current WebView)',
    recommendedVerticals: ['K12', 'QSR', 'FASHION'],
    caps: {
      serialPorts: 0,
      rs485: false,
      gpioIn: 0,
      gpioOut: 0,
      hdmiIn: false,
      hdmiOut: true,
      rj45In: true,
      rj45Out: false,
      powerOutVolts: null,
      npuTops: 0,
      cpuCores: 4,
      ramGb: 2,
      storageGb: 16,
      decode4k: true,
      fanless: false,
      duty247Rated: false,
      chromiumMin: 100,
    },
  },

  // Source: any browser-driven kiosk (Chrome / Firefox / Safari / Edge).
  // No physical I/O; "modern Chromium" is the floor (999 = "we don't
  // know, but it's current"). Hides every hardware-gated panel.
  web: {
    name: 'Browser kiosk',
    productPageUrl: null,
    socOs: 'Host OS · Browser-driven (modern Chromium / WebKit / Gecko)',
    recommendedVerticals: ['K12', 'CORPORATE', 'RETAIL', 'GYM', 'QSR', 'FASHION'],
    caps: {
      serialPorts: 0,
      rs485: false,
      gpioIn: 0,
      gpioOut: 0,
      hdmiIn: false,
      hdmiOut: false,
      rj45In: false,
      rj45Out: false,
      powerOutVolts: null,
      npuTops: 0,
      cpuCores: 0,
      ramGb: 0,
      storageGb: 0,
      decode4k: false,
      fanless: false,
      duty247Rated: false,
      chromiumMin: 999,
    },
  },

  // Sentinel for "we have no idea what this is" — the default for every
  // screen row created before hardwareModel was a column, AND for any
  // newly paired screen whose operator hasn't picked a model yet. Every
  // hardware-gated UI element MUST be hidden when caps come from this
  // entry. Safe defaults = all false / 0. chromiumMin set high so the
  // CLAUDE.md rule #10 warning chip never shows for "unknown" (we don't
  // know it's Chromium 83 either).
  unknown: {
    name: 'Unknown / unassigned',
    productPageUrl: null,
    socOs: 'Unassigned — operator has not picked a hardware model',
    recommendedVerticals: [],
    caps: {
      serialPorts: 0,
      rs485: false,
      gpioIn: 0,
      gpioOut: 0,
      hdmiIn: false,
      hdmiOut: false,
      rj45In: false,
      rj45Out: false,
      powerOutVolts: null,
      npuTops: 0,
      cpuCores: 0,
      ramGb: 0,
      storageGb: 0,
      decode4k: false,
      fanless: false,
      duty247Rated: false,
      chromiumMin: 999,
    },
  },
};

/**
 * Resolve a raw string from the DB / API to a known HardwareModel.
 * Null / unknown strings collapse to 'unknown' so the UI gracefully
 * shows "Unassigned" instead of leaking a bad enum value.
 */
export function resolveHardwareModel(input: string | null | undefined): HardwareModel {
  if (!input) return 'unknown';
  const lc = input.toLowerCase().trim();
  return (HARDWARE_MODELS as readonly string[]).includes(lc)
    ? (lc as HardwareModel)
    : 'unknown';
}

/** Get capabilities for a model, falling back to 'unknown' (all-false) if invalid. */
export function capabilitiesFor(input: string | null | undefined): HardwareCapabilities {
  return HARDWARE_CATALOG[resolveHardwareModel(input)];
}
