/* Merge gate: assert old data-field keys survive a board redesign.
   Usage: node key-gate.cjs <repoRelBoardPath> <newFileAbsPath>
   Old version read from git HEAD. Exits 1 if any old key is missing.       */
const { execSync } = require('child_process');
const fs = require('fs');

const rel = process.argv[2];
const newPath = process.argv[3];
const REPO = '/Users/gschiemann/Desktop/EDU CMS';

const keys = (s) => new Set([...s.matchAll(/data-field="([^"]+)"/g)].map((m) => m[1]).filter((k) => !k.includes("'")));
const old = keys(execSync(`git -C "${REPO}" show HEAD:"${rel}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
const neu = keys(fs.readFileSync(newPath, 'utf8'));

const removed = [...old].filter((k) => !neu.has(k));
const added = [...neu].filter((k) => !old.has(k));
console.log(JSON.stringify({ file: rel, old: old.size, new: neu.size, removed, added_count: added.length }));
if (removed.length) { console.error('KEY REGRESSION: ' + removed.join(', ')); process.exit(1); }
