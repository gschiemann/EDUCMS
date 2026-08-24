/**
 * VenueOS — hardware **presentation** + per-vertical recommendation layer.
 *
 * The TECHNICAL capability catalog (serialPorts, gpioIn, npuTops, chromiumMin,
 * etc.) lives in `./hardware-models` (Agent A, commit c175aab). This file
 * layers the presentational + sales-side metadata on top:
 *   - Per-model presentation: blurb, highlights, order link, approx price,
 *     `hasWiringPanel`, caveats, `chromium83` shortcut.
 *   - `VERTICAL_RECOMMENDED_HARDWARE` — vertical → recommended model ID
 *     (SPORTS → goodview-ep6n).
 *   - `HARDWARE_IO_UPSELLS` — "while you have the EP6N, set up these
 *     integrations" cards for the pair-screen wizard.
 *   - `hardwareConciergeBlurb()` — top-pinned recommendation copy for the
 *     Integration Concierge.
 *
 * Two files, one source of truth: `HardwareModel` and `HARDWARE_MODELS` are
 * re-exported from `./hardware-models` so the union is identical across the
 * codebase.
 *
 * 2026-05-27 — Goodview EP6N became the canonical sports-vertical hardware
 * target (docs/EP6N_HARDWARE_EVAL.md). New sports installs lead with EP6N;
 * existing ECBox3576 / Taurus / Pi5 / generic-android / web players keep
 * their entries for legacy + budget paths.
 */

import { HARDWARE_MODELS, type HardwareModel } from './hardware-models';

/**
 * Per-model presentational metadata for the picker + Concierge.
 *
 * This is sales-side data — "what does the buyer see?". The technical
 * capability matrix (does this model have GPIO? Dual RS232?) lives on
 * `HARDWARE_CATALOG` in `./hardware-models`. Both keyed off the same
 * `HardwareModel` union.
 */
export interface HardwarePresentation {
  id: HardwareModel;
  name: string;
  manufacturer: string;
  /** Plain-English one-liner for the picker. */
  blurb: string;
  /** Bullet list of standout capabilities. */
  highlights: string[];
  /** Order-this URL for buyers (spec doc when no public e-commerce link). */
  orderHref: string | null;
  /** Approx price (null = bring-your-own / TBD). */
  approxPriceUsd: number | null;
  /** Whether this model has the I/O ring for the WiringPanel
   *  (GPIO, RS232 #2, HDMI IN). Convenience flag — derive from
   *  `HARDWARE_CATALOG[id].caps` if you want the granular truth. */
  hasWiringPanel: boolean;
  /** Caveats / known limits the buyer should see before choosing. */
  caveats?: string[];
  /** Chromium-83 ceiling? Surfaces a Tailwind/inset warning in the picker.
   *  Same data as `HARDWARE_CATALOG[id].caps.chromiumMin <= 83`. */
  chromium83: boolean;
}

export const HARDWARE_PRESENTATIONS: Record<HardwareModel, HardwarePresentation> = {
  'goodview-ep6n': {
    id: 'goodview-ep6n',
    name: 'Goodview EP6N',
    manufacturer: 'Shanghai Goodview Electronic Technology',
    blurb:
      'Standard sports player. Same RK3576 SoC + Android 14 as the ECBox3576 with a richer I/O ring — dual native RS232, GPIO IN×2 / OUT×2, HDMI IN (broadcast capture), RJ45 in+out passthrough, 12V aux out, 6 TOPS NPU, all-aluminum passive cooling, 24/7 duty rating.',
    highlights: [
      'Dual native RS232 + GPIO IN/OUT (fire-alarm + panic-button hardwiring)',
      'HDMI IN — broadcast capture for streaming overlay',
      'RJ45 IN + OUT passthrough — single network drop',
      '6 TOPS NPU — on-device alt-text + auto-celebration',
    ],
    orderHref: '/docs/EP6N_HARDWARE_EVAL.md',
    approxPriceUsd: null, // pricing pending
    hasWiringPanel: true,
    chromium83: false,
  },
  'goodview-ecbox3576': {
    id: 'goodview-ecbox3576',
    name: 'Goodview ECBox3576',
    manufacturer: 'Shanghai Goodview Electronic Technology',
    blurb:
      'Legacy / budget sports player. Same RK3576 SoC + Android 14 as the EP6N but single RS232 only, no GPIO, no HDMI IN.',
    highlights: [
      'RK3576 + Android 14 (same APK as EP6N)',
      'Single RS232 on Phoenix terminal — CTS Gen 6 path',
      'Lower BOM than EP6N for budget pilot installs',
    ],
    orderHref: '/docs/ECBOX3576_CTS_SETUP.md',
    approxPriceUsd: 350,
    hasWiringPanel: false,
    caveats: [
      'No HDMI IN — broadcast capture needs a separate USB capture card',
      'No GPIO — fire-alarm + panic-button integrations not available',
    ],
    chromium83: false,
  },
  'maxhub-l55vec': {
    id: 'maxhub-l55vec',
    name: 'MAXHUB L55VEC portrait kiosk',
    manufacturer: 'MAXHUB',
    blurb:
      'Floor-standing 55" portrait kiosk. Fixed-orientation chassis — VenueOS sets it portrait automatically on pair, because the panel itself reports landscape and cannot be trusted to say which way up it is.',
    highlights: [
      'Portrait orientation applied automatically — no setup question',
      'Amlogic T982 · Android 13 · Chromium 101',
      '3840x2160 panel',
    ],
    orderHref: null,
    approxPriceUsd: null,
    hasWiringPanel: false,
    caveats: [
      'Reports a 3840x2160 LANDSCAPE framebuffer despite being a portrait-only chassis — orientation comes from the model, never the reported resolution',
      'I/O and memory figures in HARDWARE_CATALOG are conservative defaults, not vendor-datasheet values',
    ],
    chromium83: false,
  },
  'novastar-taurus': {
    id: 'novastar-taurus',
    name: 'NovaStar Taurus T6 / T6N',
    manufacturer: 'NovaStar',
    blurb:
      'LED controller-native deployment. Player runs ON the Taurus controller; player → LED, no separate processor. The cost-killer for HS gyms with existing Taurus hardware.',
    highlights: [
      'Player + LED controller in one box',
      'No HDMI output cable / no separate processor',
      'Best for installs where the Taurus is already on-site',
    ],
    orderHref: '/docs/PLAYER_APK_NOVA_TAURUS.md',
    approxPriceUsd: null,
    hasWiringPanel: false,
    caveats: [
      'Chromium 83 (June 2020) — code MUST follow CLAUDE.md rule #10 (no `inset` shorthand, no flex `gap`, no backdrop-filter)',
      'No serial, no GPIO, no HDMI IN',
    ],
    chromium83: true,
  },
  pi5: {
    id: 'pi5',
    name: 'Raspberry Pi 5',
    manufacturer: 'Raspberry Pi Foundation',
    blurb:
      'Generic Linux player. Best for installs where Android isn\'t required or where the integrator already has Pi5 expertise.',
    highlights: [
      'GPIO header for custom integrations',
      'Cheap + globally available',
      'Best for one-off / hobbyist deploys',
    ],
    orderHref: 'https://www.raspberrypi.com/products/raspberry-pi-5/',
    approxPriceUsd: 80,
    hasWiringPanel: false,
    caveats: [
      'No native RS232 — needs a USB-to-serial adapter for CTS',
      'Active cooling (fan) — has a fan-failure mode at 2am',
    ],
    chromium83: false,
  },
  'generic-android': {
    id: 'generic-android',
    name: 'Generic Android player',
    manufacturer: 'Various',
    blurb:
      'Any Android 7+ box with HDMI out. Used for one-off installs where a tested hardware target isn\'t available.',
    highlights: ['HDMI out', 'Android System WebView'],
    orderHref: null,
    approxPriceUsd: null,
    hasWiringPanel: false,
    caveats: [
      'Capability varies wildly — no GPIO / no serial / no HDMI IN assumptions',
      'Test the specific make/model before recommending to a customer',
    ],
    chromium83: false,
  },
  web: {
    id: 'web',
    name: 'Browser-only player',
    manufacturer: 'n/a',
    blurb:
      'Run the player as a web page in any modern browser. Best for previewing content from a laptop or quick-demo scenarios.',
    highlights: ['No hardware required', 'Same code path as the kiosk'],
    orderHref: null,
    approxPriceUsd: null,
    hasWiringPanel: false,
    caveats: [
      'No offline cache tier',
      'No serial / no GPIO / no HDMI IN — every "hardware" integration is unavailable',
    ],
    chromium83: false,
  },
  unknown: {
    id: 'unknown',
    name: 'Unknown / not set',
    manufacturer: 'n/a',
    blurb:
      'Hardware model not yet selected. Per-screen UI shows no hardware-gated panels until a model is chosen.',
    highlights: [],
    orderHref: null,
    approxPriceUsd: null,
    hasWiringPanel: false,
    chromium83: false,
  },
};

/**
 * Recommended hardware for each vertical. Operators see this on the
 * "What hardware do you have?" pair step + the "Recommended hardware"
 * onboarding step.
 */
export const VERTICAL_RECOMMENDED_HARDWARE: Partial<Record<string, HardwareModel>> = {
  SPORTS: 'goodview-ep6n',
};

/**
 * Per-vertical "while you're at it" recommended I/O setups, surfaced
 * only when the picked model supports the WiringPanel (currently
 * EP6N-only).
 */
export interface HardwareIoUpsell {
  id: string;
  title: string;
  blurb: string;
  /** Which screen-settings panel handles this (Agent B's WiringPanel). */
  configureHref: string | null;
  /** Doc / spec link for the operator. */
  docHref: string;
  /** Which hardware models surface this card. */
  models: HardwareModel[];
}

export const HARDWARE_IO_UPSELLS: HardwareIoUpsell[] = [
  {
    id: 'fire-alarm-dry-contact',
    title: 'Wire a fire-alarm dry contact',
    blurb:
      "Wire the building fire panel's dry contact into GPIO IN. Triggers an evacuate alert across this screen automatically.",
    configureHref: null,
    docHref: '/docs/EP6N_HARDWARE_EVAL.md',
    models: ['goodview-ep6n'],
  },
  {
    id: 'panic-button',
    title: 'Wire a hardware panic button',
    blurb:
      'A physical panic button on the wall → GPIO IN. Same audit-logged trigger as the mobile panic page but no phone required.',
    configureHref: null,
    docHref: '/docs/EP6N_HARDWARE_EVAL.md',
    models: ['goodview-ep6n'],
  },
  {
    id: 'broadcast-hdmi-in',
    title: 'Capture broadcast feed via HDMI IN',
    blurb:
      'Plug NFHS Network / Hudl / venue broadcast feed into HDMI IN. The scorebug composites on top — board + livestream from one player.',
    configureHref: null,
    docHref: '/docs/EP6N_HARDWARE_EVAL.md',
    models: ['goodview-ep6n'],
  },
  // 2026-05-27 — "Stream Deck via RS232 #2" upsell removed. Stream Deck
  // is a USB HID device — it plugs into the operator's laptop / tablet
  // and emits keyboard shortcuts the dashboard picks up. It does NOT
  // talk RS232 to the player. The card was added under a confused
  // premise by an agent; the RS232 'streamdeck' role value remains in
  // the schema for forward-compat with any future serial-cue device
  // that ships an ASCII line protocol over RS232.
  {
    id: 'status-lamp-gpio-out',
    title: 'Wire a status lamp / horn',
    blurb:
      'GPIO OUT drives a relay to a lobby lamp or audible horn during emergency states. Visible safety signal beyond the screen content.',
    configureHref: null,
    docHref: '/docs/EP6N_HARDWARE_EVAL.md',
    models: ['goodview-ep6n'],
  },
  {
    id: 'cts-rs232-1',
    title: 'Hook up a CTS Gen 6 console (RS232 #1)',
    blurb:
      'Read the existing Daktronics All Sport / CTS Gen 6 scoring console via RS232 #1. Live game clock straight off the wall console.',
    configureHref: null,
    docHref: '/docs/ECBOX3576_CTS_SETUP.md',
    models: ['goodview-ep6n', 'goodview-ecbox3576'],
  },
];

/**
 * Resolve upsells for a chosen hardware model.
 */
export function upsellsForHardware(
  model: HardwareModel | null | undefined,
): HardwareIoUpsell[] {
  if (!model) return [];
  return HARDWARE_IO_UPSELLS.filter((u) => u.models.includes(model));
}

/**
 * Per-vertical hardware blurb shown in the Integration Concierge as a
 * top-pinned recommendation. Returns null if the vertical has no
 * recommended hardware yet.
 */
export function hardwareConciergeBlurb(vertical: string): {
  modelId: HardwareModel;
  name: string;
  blurb: string;
  required_for: string[];
  href: string;
} | null {
  const modelId = VERTICAL_RECOMMENDED_HARDWARE[vertical];
  if (!modelId) return null;
  const def = HARDWARE_PRESENTATIONS[modelId];
  if (!def) return null;

  if (vertical === 'SPORTS') {
    return {
      modelId,
      name: def.name,
      blurb: `${def.name} media player — required for: dual-serial scoring console (CTS Gen 6 + Stream Deck), GPIO emergency integration (fire-alarm dry contact, panic button), broadcast streaming overlay (HDMI IN).`,
      required_for: [
        'dual-serial scoring console',
        'GPIO emergency integration',
        'broadcast streaming overlay',
      ],
      href: def.orderHref || '/docs/EP6N_HARDWARE_EVAL.md',
    };
  }

  return {
    modelId,
    name: def.name,
    blurb: def.blurb,
    required_for: def.highlights.slice(0, 3),
    href: def.orderHref || '#',
  };
}
