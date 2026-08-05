#!/usr/bin/env node
/**
 * Tiny CORS-enabled static server for the local HLS sandbox stream
 * (media-integration testing, 2026-08-04). Serves the ffmpeg output dir on
 * :4747 with Access-Control-Allow-Origin:* so hls.js on localhost:3000 can
 * fetch the playlist + segments cross-origin.
 *
 * Run: node scripts/pos-sandbox/hls-server.mjs <dir> [port]
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

const ROOT = normalize(process.argv[2] || '.');
const PORT = Number(process.argv[3] || 4747);
const MIME = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.mp4': 'video/mp4', '.m4s': 'video/iso.segment' };

http.createServer(async (req, res) => {
  try {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!path.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const body = await readFile(path);
    const ext = path.slice(path.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
    res.end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`[hls-server] serving ${ROOT} on http://127.0.0.1:${PORT}`));
