/**
 * Muse beta (2026-10-07): the owner console had a "Wipe ALL Assets" button
 * that deleted every tenant's media. It was removed; the API route survives
 * only behind PLATFORM_ASSET_WIPE_ENABLED (off by default). This guards the
 * button from coming back in any owner-console source.
 */
import fs from 'fs';
import path from 'path';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(p, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

it('no owner-console surface calls the platform-wide asset wipe', () => {
  const superDir = path.resolve(__dirname, '..');
  const offenders = walk(superDir).filter((f) =>
    fs.readFileSync(f, 'utf8').includes('/super/storage/wipe-all-assets'),
  );
  expect(offenders).toEqual([]);
});
