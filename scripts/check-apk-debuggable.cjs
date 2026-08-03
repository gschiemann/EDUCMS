#!/usr/bin/env node
/*
 * PUBLISHED-ARTIFACT DEBUGGABLE GUARD
 * ==================================================================
 * Fails the build if an APK we are about to PUBLISH carries
 * `android:debuggable="true"`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `.github/workflows/android-player-apk.yml` runs `assembleDebug`,
 * renames the output to `edu-cms-player-v<VERSION>.apk`, and attaches it
 * to a PUBLIC GitHub Release on a `player-v*` tag. `/api/v1/player/apk/
 * latest` resolves to that asset — so the debug build IS the production
 * artifact on every K-12 kiosk in the field. A debuggable APK lets
 * anyone with adb access to the device attach a debugger to our process,
 * read its data dir, and drive the app. That is not acceptable on a
 * screen running life-safety lockdown alerts.
 *
 * THE ESCAPE HATCH (read this before you delete a line)
 * ----------------------------------------------------
 * Today's publish path STILL ships the debug build, so a naive gate
 * would instantly break every tagged release. The workflow therefore
 * sets `ALLOW_DEBUGGABLE_RELEASE=1` on the publish step TODAY, with a
 * TODO tied to the release-signing cutover. With that set, this script
 * still runs, still inspects the real artifact, still prints the
 * violation loudly — it just exits 0 instead of 1.
 *
 * That is deliberate: the gate is LIVE, WIRED and PROVEN by its own CI
 * output, and *removing that one env line* is what completes the fix.
 * See apps/player/RELEASE_SIGNING.md.
 *
 * NOTE the escape hatch ONLY downgrades a debuggable finding. A missing
 * artifact, an unreadable APK or an unparseable manifest still FAILS —
 * so a silently-not-running guard can't masquerade as a passing one.
 *
 * WHAT IT INSPECTS
 * ----------------
 * The artifact that is actually being published, not a proxy for it:
 *   - a `.apk`  → the APK's own binary AndroidManifest.xml, read
 *                 straight out of the zip (this is the strongest check:
 *                 it reads the published bytes)
 *   - a `.xml`  → a merged manifest (build/intermediates/merged_manifests/
 *                 <variant>/AndroidManifest.xml), plain text
 *   - a dir     → recursively collects both of the above under it
 *
 * Dependency-free on purpose (own zip reader + binary-XML parser, node
 * stdlib only) so the Android workflow does not need `pnpm install`.
 *
 * USAGE
 *   node scripts/check-apk-debuggable.cjs <path> [<path> ...]
 *   node scripts/check-apk-debuggable.cjs --warn-only <path>   # never fails
 *
 * EXIT CODES
 *   0  clean (or downgraded by --warn-only / ALLOW_DEBUGGABLE_RELEASE)
 *   1  debuggable artifact found, or the guard could not verify
 *   2  usage error
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MANIFEST_NAME = 'AndroidManifest.xml';
// android.R.attr.debuggable — the AOSP-assigned resource id. Used as a
// SECONDARY signal; the primary match is by attribute name + namespace,
// which does not depend on remembering a hex constant.
const RES_ID_DEBUGGABLE = 0x0101000f;
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

const IS_CI = !!process.env.GITHUB_ACTIONS;
const ALLOW = /^(1|true|yes)$/i.test(process.env.ALLOW_DEBUGGABLE_RELEASE || '');

// ─────────────────────────────────────────────────────────────────────
// Minimal ZIP reader (central-directory walk + raw inflate).
// An APK is a zip; AndroidManifest.xml is normally DEFLATEd.
// ─────────────────────────────────────────────────────────────────────

function readZipEntry(zipPath, wantedName) {
  const buf = fs.readFileSync(zipPath);

  // Locate the End Of Central Directory record by scanning backwards.
  // Max comment length is 65535, +22 for the EOCD itself.
  const EOCD_SIG = 0x06054b50;
  const maxBack = Math.min(buf.length, 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack && i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');

  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || totalEntries === 0xffff) {
    throw new Error('ZIP64 archive — unsupported by this guard');
  }

  let p = cdOffset;
  for (let n = 0; n < totalEntries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`corrupt central directory at entry ${n}`);
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    if (name === wantedName) {
      if (buf.readUInt32LE(localOff) !== 0x04034b50) {
        throw new Error('corrupt local file header');
      }
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.slice(dataStart, dataStart + compSize);
      if (method === 0) return raw;                       // STORED
      if (method === 8) return zlib.inflateRawSync(raw);  // DEFLATE
      throw new Error(`unsupported compression method ${method} for ${wantedName}`);
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  throw new Error(`${wantedName} not found inside the archive`);
}

// ─────────────────────────────────────────────────────────────────────
// Android binary XML (AXML) parser — only enough to answer one question.
// Layout reference: AOSP frameworks/base ResourceTypes.h
// ─────────────────────────────────────────────────────────────────────

const CHUNK_STRING_POOL = 0x0001;
const CHUNK_XML = 0x0003;
const CHUNK_RESOURCE_MAP = 0x0180;
const CHUNK_START_ELEMENT = 0x0102;

const TYPE_STRING = 0x03;
const TYPE_INT_BOOLEAN = 0x12;

function parseStringPool(buf, start) {
  const headerSize = buf.readUInt16LE(start + 2);
  const stringCount = buf.readUInt32LE(start + 8);
  const flags = buf.readUInt32LE(start + 16);
  const stringsStart = buf.readUInt32LE(start + 20);
  const isUtf8 = (flags & (1 << 8)) !== 0;

  const strings = new Array(stringCount);
  for (let i = 0; i < stringCount; i++) {
    const off = buf.readUInt32LE(start + headerSize + i * 4);
    let p = start + stringsStart + off;
    if (isUtf8) {
      // Two length fields: UTF-16 length, then byte length. Either may
      // use the high-bit continuation encoding.
      p += (buf[p] & 0x80) ? 2 : 1;
      let byteLen = buf[p];
      if (byteLen & 0x80) { byteLen = ((byteLen & 0x7f) << 8) | buf[p + 1]; p += 2; }
      else { p += 1; }
      strings[i] = buf.slice(p, p + byteLen).toString('utf8');
    } else {
      let len = buf.readUInt16LE(p);
      if (len & 0x8000) { len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p + 2); p += 4; }
      else { p += 2; }
      strings[i] = buf.slice(p, p + len * 2).toString('utf16le');
    }
  }
  return strings;
}

/**
 * @returns {{value: boolean|null, element: string|null, how: string|null}}
 *   value=null means the attribute is simply absent → NOT debuggable
 *   (that is Android's default and a legitimate PASS).
 */
function parseAxmlDebuggable(buf) {
  if (buf.length < 8 || buf.readUInt16LE(0) !== CHUNK_XML) {
    throw new Error('not an Android binary XML document');
  }
  const rootHeaderSize = buf.readUInt16LE(2);
  const total = Math.min(buf.readUInt32LE(4), buf.length);

  let strings = [];
  let resMap = [];
  const elements = [];

  let p = rootHeaderSize;
  while (p + 8 <= total) {
    const type = buf.readUInt16LE(p);
    const headerSize = buf.readUInt16LE(p + 2);
    const size = buf.readUInt32LE(p + 4);
    if (size < 8 || p + size > total) break; // truncated / malformed tail

    if (type === CHUNK_STRING_POOL) {
      strings = parseStringPool(buf, p);
    } else if (type === CHUNK_RESOURCE_MAP) {
      const count = (size - headerSize) >> 2;
      resMap = new Array(count);
      for (let i = 0; i < count; i++) resMap[i] = buf.readUInt32LE(p + headerSize + i * 4);
    } else if (type === CHUNK_START_ELEMENT) {
      elements.push({ start: p, headerSize });
    }
    p += size;
  }

  // A name-pool index is "debuggable" if EITHER the decoded string is
  // `debuggable` or the resource map maps it to android.R.attr.debuggable.
  const byResId = new Set();
  resMap.forEach((id, i) => { if (id === RES_ID_DEBUGGABLE) byResId.add(i); });

  const str = (i) => (i >= 0 && i < strings.length ? strings[i] : null);

  for (const el of elements) {
    const ext = el.start + el.headerSize;
    const elName = str(buf.readInt32LE(ext + 4)) || '<unknown>';
    const attributeStart = buf.readUInt16LE(ext + 8);
    const attributeSize = buf.readUInt16LE(ext + 10);
    const attributeCount = buf.readUInt16LE(ext + 12);

    for (let a = 0; a < attributeCount; a++) {
      const at = ext + attributeStart + a * attributeSize;
      if (at + 20 > buf.length) break;
      const nsIdx = buf.readInt32LE(at);
      const nameIdx = buf.readInt32LE(at + 4);
      const rawValueIdx = buf.readInt32LE(at + 8);
      const dataType = buf[at + 15];
      const data = buf.readUInt32LE(at + 16);

      const nameStr = str(nameIdx);
      const nsStr = str(nsIdx);
      const nameMatches = nameStr === 'debuggable' && (nsStr === ANDROID_NS || nsStr === null);
      const idMatches = byResId.has(nameIdx);
      if (!nameMatches && !idMatches) continue;

      let value;
      let how;
      if (dataType === TYPE_INT_BOOLEAN) {
        value = data !== 0;
        how = `typed boolean (0x${data.toString(16)})`;
      } else if (dataType === TYPE_STRING) {
        const s = (str(rawValueIdx) || '').trim().toLowerCase();
        value = s === 'true';
        how = `string "${s}"`;
      } else {
        // Unknown encoding — fail closed rather than guess.
        throw new Error(
          `android:debuggable present on <${elName}> with an unrecognised value ` +
          `type 0x${dataType.toString(16)} — cannot verify, refusing to pass`
        );
      }
      return { value, element: elName, how: `${how}, matched by ${nameMatches ? 'name' : 'resource-id'}` };
    }
  }
  return { value: null, element: null, how: null };
}

// ─────────────────────────────────────────────────────────────────────
// Plain-text merged manifest
// ─────────────────────────────────────────────────────────────────────

function parseTextManifestDebuggable(text) {
  const re = /android:debuggable\s*=\s*(["'])(.*?)\1/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[2].trim().toLowerCase();
    if (raw === 'true') return { value: true, how: 'literal "true"' };
    if (raw === 'false') continue;
    // @bool/…, ${placeholder}, anything unresolved → fail closed.
    throw new Error(
      `android:debuggable="${m[2]}" is not a resolved literal — cannot verify, refusing to pass`
    );
  }
  return { value: false, how: 'absent or explicitly false' };
}

// ─────────────────────────────────────────────────────────────────────
// Target collection
// ─────────────────────────────────────────────────────────────────────

function collectFromDir(dir, out, depth = 0) {
  if (depth > 12) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      collectFromDir(full, out, depth + 1);
    } else if (e.isFile()) {
      if (e.name.endsWith('.apk')) out.push(full);
      else if (e.name === MANIFEST_NAME && /merged_manifest/i.test(full)) out.push(full);
    }
  }
}

function inspect(target) {
  if (target.endsWith('.apk')) {
    const axml = readZipEntry(target, MANIFEST_NAME);
    const r = parseAxmlDebuggable(axml);
    return {
      debuggable: r.value === true,
      detail: r.value === null
        ? 'android:debuggable absent (Android default = false)'
        : `android:debuggable=${r.value} on <${r.element}> — ${r.how}`,
      kind: 'apk (published bytes)',
    };
  }
  if (!target.toLowerCase().endsWith('.xml')) {
    // Fail closed. Anything that is neither an .apk nor an .xml is not
    // something we can vouch for, and a guard must never report "OK" for
    // a file it did not actually understand (a wrong/blank path from the
    // workflow would otherwise masquerade as a clean run).
    throw new Error('unrecognised artifact type — expected a .apk or a merged AndroidManifest.xml');
  }
  const text = fs.readFileSync(target, 'utf8');
  if (!/<manifest[\s>]/.test(text) || !/<application[\s>/]/.test(text)) {
    throw new Error('.xml file is not an Android manifest (no <manifest>/<application> element) — refusing to vouch for it');
  }
  const r = parseTextManifestDebuggable(text);
  return { debuggable: r.value === true, detail: `merged manifest — ${r.how}`, kind: 'merged manifest' };
}

// ─────────────────────────────────────────────────────────────────────

function main(argv) {
  const warnOnly = argv.includes('--warn-only');
  const paths = argv.filter((a) => a !== '--warn-only' && !a.startsWith('--'));

  if (!paths.length) {
    console.error('usage: node scripts/check-apk-debuggable.cjs [--warn-only] <apk|manifest.xml|dir> ...');
    return 2;
  }

  const targets = [];
  const missing = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) { missing.push(p); continue; }
    if (fs.statSync(p).isDirectory()) collectFromDir(p, targets);
    else targets.push(p);
  }

  const errors = [];
  const debuggable = [];
  const clean = [];

  for (const t of targets) {
    try {
      const r = inspect(t);
      (r.debuggable ? debuggable : clean).push({ target: t, ...r });
    } catch (err) {
      errors.push({ target: t, msg: err.message });
    }
  }

  console.log('── published-artifact debuggable guard ──────────────────────');
  for (const c of clean) console.log(`  OK        ${c.target}\n              ${c.detail}`);
  for (const d of debuggable) console.log(`  DEBUGGABLE ${d.target}\n              ${d.detail}`);
  for (const e of errors) console.log(`  ERROR     ${e.target}\n              ${e.msg}`);
  for (const m of missing) console.log(`  MISSING   ${m}`);
  console.log('');

  // Hard failures that the escape hatch does NOT cover — a guard that
  // inspected nothing must never look like a guard that passed.
  let fatal = false;
  if (missing.length) {
    console.error(`FAIL: ${missing.length} artifact path(s) did not exist. The guard could not inspect what is being published.`);
    if (IS_CI) for (const m of missing) console.error(`::error::debuggable-guard: artifact not found: ${m}`);
    fatal = true;
  }
  if (errors.length) {
    console.error(`FAIL: ${errors.length} artifact(s) could not be verified.`);
    if (IS_CI) for (const e of errors) console.error(`::error::debuggable-guard: ${e.target}: ${e.msg}`);
    fatal = true;
  }
  if (!targets.length && !missing.length) {
    console.error('FAIL: no APK or merged manifest found in the given paths — nothing was actually checked.');
    if (IS_CI) console.error('::error::debuggable-guard: no artifacts found to inspect');
    fatal = true;
  }

  if (debuggable.length) {
    console.error('');
    console.error('  ############################################################');
    console.error('  #  PUBLISHED ARTIFACT IS DEBUGGABLE                        #');
    console.error('  ############################################################');
    console.error('');
    console.error('  android:debuggable="true" means anyone with adb access to a');
    console.error('  kiosk can attach a debugger, read the app data dir, and drive');
    console.error('  the process. These APKs go to K-12 screens running life-safety');
    console.error('  lockdown alerts. Fix: publish `assembleRelease`, not');
    console.error('  `assembleDebug` — see apps/player/RELEASE_SIGNING.md.');
    console.error('');
    for (const d of debuggable) console.error(`    ${d.target}`);
    console.error('');
  }

  if (fatal && !warnOnly) return 1;

  if (debuggable.length) {
    if (warnOnly) {
      console.error('(--warn-only: reporting, not failing.)');
      if (IS_CI) console.error('::warning::debuggable-guard: published artifact is debuggable (report-only run)');
      return 0;
    }
    if (ALLOW) {
      console.error('  ALLOW_DEBUGGABLE_RELEASE is set — DOWNGRADED TO A WARNING.');
      console.error('  This is the KNOWN, TEMPORARY state: CI still publishes the');
      console.error('  debug build. Removing that env line from');
      console.error('  .github/workflows/android-player-apk.yml is the step that');
      console.error('  completes the fix. See apps/player/RELEASE_SIGNING.md.');
      if (IS_CI) console.error('::warning::debuggable-guard: published APK is debuggable — suppressed by ALLOW_DEBUGGABLE_RELEASE (see apps/player/RELEASE_SIGNING.md)');
      return 0;
    }
    if (IS_CI) for (const d of debuggable) console.error(`::error::debuggable-guard: ${d.target} is debuggable and must not be published`);
    return 1;
  }

  if (fatal) {
    console.error('(--warn-only: reporting, not failing.)');
    return 0;
  }

  console.log(`OK — ${clean.length} published artifact(s) verified NOT debuggable.`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
