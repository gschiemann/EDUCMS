/**
 * Bug-reporter capture utility — assembles a BugCapturedContext bundle
 * that ships in POST /api/v1/bugs.
 *
 * 2026-05-27 — Frontend side of the one-click Bug Reporter described in
 * `packages/api-types/src/bugs.ts`. The button calls `captureBugBundle`,
 * we screenshot the viewport with html2canvas, gather window / navigator
 * state, snapshot the four ringbuffers, and return a structured payload
 * the backend stores verbatim in `Bug.capturedContext`.
 *
 * Privacy posture: we never look at `<input type="password">` values or
 * intercept request bodies. The bundle CAN contain free-form text the
 * operator typed into a "What went wrong?" textarea — that's by design.
 */

import html2canvas from 'html2canvas';
import type { BugCapturedContext, BugClientBrowserInfo } from '@cms/api-types';
import { detectCapabilities } from './capabilities';
import { snapshotBugRingbuffers } from './bug-ringbuffers';
import { useUIStore } from '@/store/ui-store';
import { isFeatureEnabled, FLAGS, type FlagKey } from './feature-flags';

/** Stay well under the contract's 2 MB cap. We aim for ≤ 1.5 MB so a
 *  bit of network noise / b64 overhead doesn't push us over. */
const SCREENSHOT_TARGET_BYTES = 1.5 * 1024 * 1024;

/** Hard ceiling — never ship anything larger than this. The contract
 *  caps the API at 2 MB; pass that and the upload fails. */
const SCREENSHOT_HARD_MAX_BYTES = 2 * 1024 * 1024;

/** Captured device-pixel ratio multiplier for html2canvas. A high DPR
 *  on a 4K monitor would produce a huge image; clamp to 2 so we don't
 *  ship 12 MP screenshots. */
const SCREENSHOT_SCALE_MAX = 2;

export interface CaptureBugInput {
  /** Optional free-text description from the operator. */
  description?: string;
}

export interface CapturedBugBundle {
  captured: BugCapturedContext;
  /** Base64-encoded PNG, ready to POST. Undefined when capture failed —
   *  the bug still files, just without a screenshot. */
  screenshotBase64?: string;
}

/**
 * Single entry point the BugReporterButton calls. Always resolves with a
 * usable bundle, even if individual steps (screenshot, flags) fail — the
 * goal is to never block the operator from reporting a bug.
 */
export async function captureBugBundle(input: CaptureBugInput = {}): Promise<CapturedBugBundle> {
  const captured = buildCapturedContext(input.description);
  let screenshotBase64: string | undefined;
  try {
    screenshotBase64 = await captureScreenshot();
  } catch (err) {
    // Don't throw — bug submission must work without a screenshot too.
    console.warn('[bug-capture] screenshot failed', err);
    screenshotBase64 = undefined;
  }
  return { captured, screenshotBase64 };
}

// ─── Captured context (sync — instantaneous) ─────────────────────────

function buildCapturedContext(description?: string): BugCapturedContext {
  const ring = snapshotBugRingbuffers();
  const reporter = getReporterIdentity();
  return {
    v: 1,
    clientTs: Date.now(),
    url: typeof window !== 'undefined' ? window.location.href : '',
    pathname: typeof window !== 'undefined' ? window.location.pathname : '',
    pageTitle: typeof document !== 'undefined' ? document.title : '',
    description: description?.trim() || undefined,
    reporter,
    browser: getBrowserInfo(),
    breadcrumbs: ring.breadcrumbs,
    networkFailures: ring.networkFailures,
    consoleEntries: ring.consoleEntries,
    reactQuery: ring.reactQuery,
    featureFlags: getFeatureFlagSnapshot(),
  };
}

function getReporterIdentity(): BugCapturedContext['reporter'] {
  // Same store the rest of the dashboard reads. We never trust this on
  // the server — the API re-derives identity from the session — but it's
  // useful for debugging session-mismatch bugs.
  const user = useUIStore.getState().user;
  return {
    userId: user?.id || '',
    email: user?.email || '',
    role: user?.role || '',
    tenantId: user?.tenantId || null,
    tenantSlug: user?.tenantSlug || null,
    tenantVertical: user?.tenantVertical || null,
  };
}

function getBrowserInfo(): BugClientBrowserInfo {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      userAgent: '',
      language: '',
      viewport: { w: 0, h: 0 },
      dpr: 1,
      chromiumMajor: null,
      capabilities: {},
    };
  }
  let capabilities: Record<string, unknown> = {};
  try {
    capabilities = detectCapabilities() as unknown as Record<string, unknown>;
  } catch {
    capabilities = {};
  }
  const chromiumMajor =
    typeof capabilities.chromiumMajor === 'number' && capabilities.chromiumMajor > 0
      ? (capabilities.chromiumMajor as number)
      : null;
  return {
    userAgent: navigator.userAgent || '',
    language: navigator.language || '',
    viewport: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio || 1,
    chromiumMajor,
    capabilities,
  };
}

function getFeatureFlagSnapshot(): Record<string, unknown> {
  // Best-effort — flags that throw return undefined and get pruned.
  const snap: Record<string, unknown> = {};
  try {
    for (const key of Object.values(FLAGS) as FlagKey[]) {
      try {
        snap[key as string] = isFeatureEnabled(key);
      } catch {
        /* skip this flag */
      }
    }
  } catch {
    /* return empty */
  }
  return snap;
}

// ─── Screenshot (async — costliest step) ─────────────────────────────

async function captureScreenshot(): Promise<string | undefined> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
  const root = document.body;
  if (!root) return undefined;

  // Heuristic scale — start at min(dpr, 2). If the resulting PNG is too
  // big, halve and re-render.
  let scale = Math.min(window.devicePixelRatio || 1, SCREENSHOT_SCALE_MAX);
  if (scale < 0.25) scale = 0.25;

  for (let attempt = 0; attempt < 3; attempt++) {
    let canvas: HTMLCanvasElement;
    try {
      canvas = await html2canvas(root, {
        scale,
        // Render off-DOM so the operator doesn't see a flash of the
        // capture overlay.
        useCORS: true,
        // Cross-origin images may taint the canvas; honour it best-effort.
        allowTaint: false,
        // Don't try to log anything to the console during render.
        logging: false,
        // 2026-05-27 — html2canvas chokes on Tailwind v4's `oklch()`
        // color tokens (it parses CSS values with a regex that doesn't
        // grok the new color spec) on Safari, throwing "Attempting to
        // parse an unsupported color function 'oklch'". Workaround:
        // ignore elements with `data-bug-capture-skip` so we can flag
        // any problem subtree; the gradient blobs in DashboardLayout
        // are already on a fixed solid color when rendered, so they
        // capture fine. If a customer's tenant adds a custom widget
        // that breaks parsing, the catch below shows them an empty
        // screenshot instead of crashing the whole report.
        ignoreElements: (el) => el.hasAttribute('data-bug-capture-skip'),
        // Limit to viewport — full-document captures explode in size on
        // long admin pages.
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        x: window.scrollX,
        y: window.scrollY,
        backgroundColor: '#ffffff',
      });
    } catch (err) {
      console.warn('[bug-capture] html2canvas threw', err);
      return undefined;
    }

    // PNG first (lossless) — JPEG fallback if PNG is too large.
    let dataUrl = canvas.toDataURL('image/png');
    let bytes = estimateBase64Bytes(dataUrl);

    if (bytes > SCREENSHOT_TARGET_BYTES) {
      // Try JPEG at 0.85 quality — usually cuts size 4-6×.
      const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const jpegBytes = estimateBase64Bytes(jpegDataUrl);
      if (jpegBytes < bytes) {
        dataUrl = jpegDataUrl;
        bytes = jpegBytes;
      }
    }

    // Strip the data: prefix so the backend just gets the b64 payload.
    const b64 = stripDataUrlPrefix(dataUrl);

    if (bytes <= SCREENSHOT_HARD_MAX_BYTES) {
      return b64;
    }

    // Still too big — halve the scale and retry.
    scale = scale / 2;
    if (scale < 0.25) {
      // Bail out — at quarter dpr we'd still be over budget. Return
      // nothing rather than ship a 4 MB blob.
      return undefined;
    }
  }
  return undefined;
}

function estimateBase64Bytes(dataUrl: string): number {
  // data:image/png;base64,XXXX...  →  size = length(XXXX) * 3 / 4
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}
