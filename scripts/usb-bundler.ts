#!/usr/bin/env node
/**
 * EduCMS USB Bundler — Sprint 7B
 *
 * Operator-facing CLI. Takes a list of asset URLs (or a tenant manifest
 * fetched from the dashboard), downloads each file, computes SHA-256, lays
 * out a USB-ready folder, and signs the manifest with the tenant's HMAC key.
 * Plug the resulting USB stick into a paired Android player and the
 * UsbIngester reads + verifies + applies.
 *
 * Usage:
 *   pnpm tsx scripts/usb-bundler.ts \
 *     --tenant <tenantId> \
 *     --key <hmac-hex> \
 *     --out /media/USBSTICK \
 *     --asset https://cdn.example/lockdown.mp4 \
 *     --asset https://cdn.example/evac-map.jpg \
 *     [--emergency-asset https://cdn.example/lockdown.mp4]   # mark as emergency tier
 *     [--bundle-version v2026-04-17-1]                       # default = ISO timestamp
 *
 * Or, use a JSON spec file:
 *   pnpm tsx scripts/usb-bundler.ts --spec spec.json --key <hmac>
 *
 *   spec.json:
 *     {
 *       "tenantId": "...",
 *       "bundleVersion": "v2026-04-17-1",
 *       "assets": [
 *         { "url": "https://...", "emergency": false },
 *         { "url": "https://...", "emergency": true }
 *       ]
 *     }
 *
 * Output layout (matches the spec the Android UsbIngester expects):
 *
 *   <out>/edu-cms-content/
 *     manifest.json        ← signed bundle manifest
 *     manifest.sig         ← HMAC-SHA256 of manifest.json (hex)
 *     assets/
 *       <sha256>.<ext>     ← regular playlist assets
 *     emergency/
 *       <sha256>.<ext>     ← emergency-tier assets (never evicted on player)
 *
 * Security:
 *   - Tenant HMAC key signs the manifest. The Android side verifies before
 *     applying. Never check the key into git or share publicly.
 *   - Filenames are content-addressed (SHA-256). Tampering changes the name.
 *   - The CLI never writes the key to disk; only reads it from --key argv
 *     or EDU_USB_KEY env var.
 */

import { createHash, createHmac } from 'crypto';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { readFileSync } from 'fs';

// ────────────────────────────────────────────────────────────────────────
// Args
// ────────────────────────────────────────────────────────────────────────

type Args = {
  tenant?: string;
  key?: string;
  out?: string;
  bundleVersion?: string;
  assets: Array<{ url: string; emergency: boolean }>;
  spec?: string;
  help?: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { assets: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--tenant': out.tenant = next(); break;
      case '--key': out.key = next(); break;
      case '--out': out.out = next(); break;
      case '--bundle-version': out.bundleVersion = next(); break;
      case '--asset': out.assets.push({ url: next(), emergency: false }); break;
      case '--emergency-asset': out.assets.push({ url: next(), emergency: true }); break;
      case '--spec': out.spec = next(); break;
      case '-h':
      case '--help': out.help = true; break;
      default:
        console.error(`Unknown flag: ${a}`);
        process.exit(2);
    }
  }
  return out;
}

function usage() {
  console.log(`
EduCMS USB Bundler

Required:
  --tenant <id>             Tenant ID the bundle is intended for
  --key <hmac-hex>          Tenant HMAC key (or set EDU_USB_KEY env var)
  --out <dir>               Mount point of the USB stick

Content (one or both):
  --asset <url>             Add a regular playlist asset
  --emergency-asset <url>   Add an asset to the never-evict emergency tier

OR provide a JSON spec:
  --spec <file.json>

Optional:
  --bundle-version <str>    Defaults to ISO timestamp

Example:
  pnpm tsx scripts/usb-bundler.ts \\
    --tenant 12abc-... \\
    --key \$EDU_USB_KEY \\
    --out /media/USBSTICK \\
    --asset https://cdn.example/welcome.mp4 \\
    --emergency-asset https://cdn.example/lockdown.mp4
`);
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); process.exit(0); }

  // Load spec file if provided.
  if (args.spec) {
    const raw = readFileSync(args.spec, 'utf8');
    const spec = JSON.parse(raw);
    args.tenant ??= spec.tenantId;
    args.bundleVersion ??= spec.bundleVersion;
    for (const a of spec.assets || []) args.assets.push({ url: a.url, emergency: !!a.emergency });
  }

  const key = args.key || process.env.EDU_USB_KEY;
  if (!args.tenant) { console.error('--tenant required'); process.exit(2); }
  if (!key)         { console.error('--key required (or EDU_USB_KEY env var)'); process.exit(2); }
  if (!args.out)    { console.error('--out required'); process.exit(2); }
  if (args.assets.length === 0) { console.error('No --asset or --emergency-asset given'); process.exit(2); }

  const root = join(args.out, 'edu-cms-content');
  const assetsDir = join(root, 'assets');
  const emergencyDir = join(root, 'emergency');
  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(emergencyDir, { recursive: true });

  console.log(`📦 Building bundle for tenant ${args.tenant}`);
  console.log(`   ${args.assets.length} asset(s) → ${root}`);

  type ManifestAsset = { url: string; sha256: string; size: number; mime: string; localPath: string; tier: 'playlist' | 'emergency' };
  const manifestAssets: ManifestAsset[] = [];

  for (const a of args.assets) {
    const tier = a.emergency ? 'emergency' : 'playlist';
    const tierDir = a.emergency ? emergencyDir : assetsDir;

    process.stdout.write(`  ↳ [${tier}] ${a.url} … `);
    const res = await fetch(a.url);
    if (!res.ok) {
      console.log(`FAILED (HTTP ${res.status})`);
      process.exit(1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const mime = res.headers.get('content-type') || 'application/octet-stream';
    const ext = guessExt(a.url, mime);
    const filename = `${sha256}${ext}`;
    const fullPath = join(tierDir, filename);
    if (!existsSync(fullPath)) writeFileSync(fullPath, buf);
    manifestAssets.push({
      url: a.url,
      sha256,
      size: buf.length,
      mime,
      localPath: `${tier === 'emergency' ? 'emergency' : 'assets'}/${filename}`,
      tier,
    });
    console.log(`${(buf.length / (1024 * 1024)).toFixed(2)} MB  ✓ ${sha256.slice(0, 12)}…`);
  }

  // Build the manifest payload (sorted for stable hash).
  const manifest = {
    schema: 'edu-cms-usb-bundle/v1',
    tenantId: args.tenant,
    bundleVersion: args.bundleVersion || new Date().toISOString().replace(/[:.]/g, '-'),
    createdAt: new Date().toISOString(),
    assets: manifestAssets.sort((a, b) => a.sha256.localeCompare(b.sha256)),
  };

  const manifestJson = JSON.stringify(manifest, null, 2);
  writeFileSync(join(root, 'manifest.json'), manifestJson, 'utf8');

  // HMAC-SHA256 over the canonical manifest bytes.
  const sig = createHmac('sha256', Buffer.from(key, 'hex')).update(manifestJson).digest('hex');
  writeFileSync(join(root, 'manifest.sig'), sig, 'utf8');

  const totalBytes = manifestAssets.reduce((n, a) => n + a.size, 0);
  const emergencyCount = manifestAssets.filter(a => a.tier === 'emergency').length;

  console.log(`\n✓ Bundle written to ${root}`);
  console.log(`  schema: ${manifest.schema}`);
  console.log(`  version: ${manifest.bundleVersion}`);
  console.log(`  assets: ${manifestAssets.length} (${emergencyCount} emergency)`);
  console.log(`  size:   ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`  sig:    ${sig.slice(0, 16)}…`);
  console.log(`\nSafely eject the USB and walk it to a paired EduCMS Player.`);
  console.log(`The player will prompt for an admin PIN before applying.`);
}

function guessExt(url: string, mime: string): string {
  const fromUrl = extname(new URL(url).pathname);
  if (fromUrl) return fromUrl;
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('webm')) return '.webm';
  return '.bin';
}

main().catch(e => { console.error(e); process.exit(1); });
