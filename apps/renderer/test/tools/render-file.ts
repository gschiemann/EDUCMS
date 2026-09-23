/**
 * Dev tool: render one HTML file through a real in-process renderer and write
 * the image, thumb and metrics next to each other.
 *
 *   pnpm --filter renderer exec tsc -p tsconfig.test.json
 *   node dist-test/test/tools/render-file.js <board.html> [outDir] [canvasW] [canvasH]
 *
 * `/templates/…` assets are inlined as data: URIs first, the way the API
 * hands boards over.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findChromium, inlineWebAssets, smallImageDataUri } from '../helpers/env.js';
import { postRender, startTestServer } from '../helpers/server.js';

async function main() {
  const [file, outDirArg, w, h] = process.argv.slice(2);
  if (!file) throw new Error('usage: render-file <board.html> [outDir] [canvasW] [canvasH]');
  const outDir = outDirArg ?? '.renders';
  const chromium = findChromium();
  if (!chromium) throw new Error('no Chromium found (set CHROME_PATH)');
  const server = await startTestServer({ executablePath: chromium });
  try {
    let html = inlineWebAssets(fs.readFileSync(file, 'utf8'));
    if (html.includes('__SMALL_IMAGE__')) html = html.split('__SMALL_IMAGE__').join(await smallImageDataUri());
    const t0 = Date.now();
    const res = await postRender(server.url, {
      html,
      canvasWidth: Number(w ?? 3840),
      canvasHeight: Number(h ?? 2160),
    });
    const wall = Date.now() - t0;
    fs.mkdirSync(outDir, { recursive: true });
    const base = path.join(outDir, path.basename(file).replace(/\.html?$/i, ''));
    if (res.status !== 200) {
      console.log(JSON.stringify({ status: res.status, body: res.json }, null, 2));
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(`${base}.webp`, Buffer.from(res.json.image, 'base64'));
    fs.writeFileSync(`${base}.thumb.webp`, Buffer.from(res.json.thumb, 'base64'));
    fs.writeFileSync(`${base}.metrics.json`, JSON.stringify(res.json.metrics, null, 2));
    console.log(
      JSON.stringify(
        {
          wallMs: wall,
          timings: res.json.timings,
          imageBytes: Buffer.from(res.json.image, 'base64').length,
          thumbBytes: Buffer.from(res.json.thumb, 'base64').length,
          chromium: res.json.chromium,
          wrote: [`${base}.webp`, `${base}.thumb.webp`, `${base}.metrics.json`],
        },
        null,
        2,
      ),
    );
  } finally {
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
