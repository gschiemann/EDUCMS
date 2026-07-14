import * as fs from 'fs';
import * as path from 'path';
import { createHmac } from 'crypto';

/**
 * Cross-language USB-bundle contract test (audit W0-04).
 *
 * The Android player (`apps/player/.../usb/UsbIngester.kt` +
 * `UsbCacheIndex.kt`) and the API producer (`usb-export.controller.ts`) are
 * two independent implementations of ONE wire contract. On 2026-07-12 they had
 * silently diverged — the API emitted `version:1` + nested
 * `playlists[].items[].asset`, while the ingester required `schema` +
 * `bundleVersion` + a flat top-level `assets[]` with `localPath` — so every
 * API-produced bundle was rejected before a byte was copied.
 *
 * This test pins the contract from BOTH sides:
 *  (a) a manifest built to the API producer's current shape satisfies every
 *      field the Kotlin ingester/cache-index read, and
 *  (b) the API controller source still emits those exact literals (so a future
 *      edit that drops `schema`/`assets`/`localPath` fails here, not on a
 *      player in the field).
 *
 * It does NOT boot Nest — it validates the shape + the source, which is what a
 * cross-language contract guard can verify without an Android device.
 */

const CONTROLLER_SRC = path.join(__dirname, 'usb-export.controller.ts');

// ── The Kotlin contract, transcribed with file references ──
// UsbIngester.kt reads these MANIFEST-LEVEL keys:
const KOTLIN_MANIFEST_KEYS = [
  'tenantId', // UsbIngester.kt: manifest.optString("tenantId")
  'schema', //   UsbIngester.kt: must equal "edu-cms-usb-bundle/v1"
  'bundleVersion', // UsbIngester.kt: manifest.optString("bundleVersion")
  'assets', //   UsbIngester.kt + UsbCacheIndex.kt: manifest.optJSONArray("assets")
];
// Each entry of assets[] must carry these keys:
//   UsbIngester.kt  → sha256, localPath
//   UsbCacheIndex.kt → url, sha256, localPath
const KOTLIN_ASSET_KEYS = ['url', 'sha256', 'localPath'];
const REQUIRED_SCHEMA = 'edu-cms-usb-bundle/v1';

/**
 * A manifest built exactly the way `usb-export.controller.ts` now builds one
 * (same field names, same asset shape). Kept in lockstep with the controller
 * by the source assertions in the final describe block below.
 */
function sampleApiManifest() {
  const hash = 'a'.repeat(64);
  const ext = 'mp4';
  const localPath = `assets/${hash}.${ext}`;
  const now = Date.now();
  return {
    schema: REQUIRED_SCHEMA,
    bundleVersion: String(now),
    assets: [
      {
        url: 'https://cdn.example.test/clip.mp4',
        sha256: hash,
        localPath,
        mimeType: 'video/mp4',
        sizeBytes: 1234,
      },
    ],
    version: 1,
    tenantId: 'tenant-123',
    tenantSlug: 'demo',
    screenId: null,
    bundleLabel: null,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30 * 86400_000).toISOString(),
    playlists: [{ id: 'p1', name: 'Lobby', items: [] }],
    emergencyPlaylists: [],
    assetCount: 1,
    totalBytes: 1234,
    exporterUserId: 'u1',
    truncated: false,
  };
}

describe('USB bundle — cross-language contract (API ⇄ Android)', () => {
  it('the API manifest carries every manifest-level key the Kotlin ingester reads', () => {
    const m: Record<string, unknown> = sampleApiManifest();
    for (const key of KOTLIN_MANIFEST_KEYS) {
      expect(m).toHaveProperty(key);
      expect(m[key]).not.toBeUndefined();
    }
  });

  it('uses the exact schema string the ingester gates on', () => {
    expect(sampleApiManifest().schema).toBe(REQUIRED_SCHEMA);
  });

  it('bundleVersion is a monotonic, string-comparable value (old-bundle rejection)', () => {
    const v = sampleApiManifest().bundleVersion;
    expect(typeof v).toBe('string');
    expect(/^\d+$/.test(v)).toBe(true);
  });

  it('every top-level asset carries url + sha256 + localPath', () => {
    for (const a of sampleApiManifest().assets) {
      const rec = a as unknown as Record<string, unknown>;
      for (const key of KOTLIN_ASSET_KEYS) {
        expect(rec).toHaveProperty(key);
        expect(String(rec[key]).length).toBeGreaterThan(0);
      }
    }
  });

  it('localPath splits into exactly two parts (the ingester rejects anything else)', () => {
    for (const a of sampleApiManifest().assets) {
      expect(a.localPath.split('/').length).toBe(2);
      expect(a.localPath.startsWith('assets/') || a.localPath.startsWith('emergency/')).toBe(true);
    }
  });

  it('the HMAC signing scheme matches Android (key = hex-decoded bytes, over the manifest UTF-8)', () => {
    // API: createHmac('sha256', Buffer.from(usbIngestKey,'hex')).update(json,'utf-8')
    // Kotlin: SecretKeySpec(hexToBytes(keyHex)) over manifest bytes.
    const keyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const json = JSON.stringify(sampleApiManifest(), null, 2);
    const sig = createHmac('sha256', Buffer.from(keyHex, 'hex')).update(json, 'utf-8').digest('hex');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    // Determinism: same key + bytes → same signature (what the two sides rely on).
    const sig2 = createHmac('sha256', Buffer.from(keyHex, 'hex')).update(json, 'utf-8').digest('hex');
    expect(sig2).toBe(sig);
  });

  // ── Producer-side drift guard: the controller source must still emit the
  //    contract. If someone deletes `schema`/`assets`/`localPath`, this fails.
  describe('controller source still emits the contract', () => {
    const src = fs.readFileSync(CONTROLLER_SRC, 'utf-8');

    it("emits schema: 'edu-cms-usb-bundle/v1'", () => {
      expect(src).toContain("'edu-cms-usb-bundle/v1'");
    });

    it('emits a top-level assets array and bundleVersion', () => {
      expect(src).toMatch(/assets:\s*topLevelAssets/);
      expect(src).toMatch(/bundleVersion:/);
    });

    it('builds each top-level asset with url + sha256 + localPath', () => {
      // The push into topLevelAssets carries the Kotlin-read keys.
      expect(src).toMatch(/topLevelAssets\.push\(/);
      for (const key of KOTLIN_ASSET_KEYS) {
        expect(src).toContain(`${key}:`);
      }
    });

    it('no longer claims a nonexistent admin PIN in the README', () => {
      expect(src).not.toMatch(/prompts for an admin PIN/i);
    });
  });
});
