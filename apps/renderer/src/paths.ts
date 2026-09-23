/**
 * paths.ts — find the renderer package root from wherever the compiled module
 * runs (dist/ in production, dist-test/src/ under test).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | null = null;

/** Absolute path of apps/renderer (the directory holding its package.json). */
export function packageRoot(): string {
  if (cached) return cached;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        if (JSON.parse(fs.readFileSync(manifest, 'utf8')).name === 'renderer') {
          cached = dir;
          return dir;
        }
      } catch {
        /* not ours — keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('renderer: could not locate the package root (package.json with name "renderer")');
}
