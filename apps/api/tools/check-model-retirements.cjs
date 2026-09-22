#!/usr/bin/env node
/**
 * AI model retirement gate (audit W0-03, 2026-07-13).
 *
 * The 2026-07-12 audit found the API shipping models that providers had
 * ALREADY shut down (claude-3-5-haiku retired 2026-02-19, gemini-2.0-flash
 * shut down 2026-06-01, imagen-3.0 shut down 2025-11-10) — every affected
 * call was a customer-facing 404 and nothing warned us. This script is the
 * tripwire:
 *
 *   - a tracked model PAST its provider shutdown date that is still
 *     referenced in apps/api/src (excluding *.spec.ts) → EXIT 1 (red CI);
 *   - a tracked model within 60 days of shutdown → GitHub ::warning;
 *   - deprecated-without-a-date models → ::notice so they stay visible.
 *
 * When a provider announces a new date, add/update the entry here (source:
 * the provider lifecycle pages —
 *   https://platform.claude.com/docs/en/docs/about-claude/model-deprecations
 *   https://ai.google.dev/gemini-api/docs/deprecations
 *   https://developers.openai.com/api/docs/models/all ).
 *
 * 2026-09-22 — the model lineup is CATALOG DATA now (src/ai/ai-model-catalog.ts), refreshed daily
 * from the vendors' feeds, and a model is never sent within 14 days of its `retiresAt`. This gate
 * stays as the tripwire for a HARD-CODED id creeping back into src. One file is exempt by design:
 * src/ai/ai-legacy-models.ts maps retired ids FORWARD to a tier — every id in it is a lookup KEY,
 * never sent to a provider — so a retired id belongs there and nowhere else.
 *
 * Run: node apps/api/tools/check-model-retirements.cjs
 */
const fs = require('fs');
const path = require('path');

const WARN_DAYS = 60;

/** @type {{id: string, shutdown: string|null, replacement: string, note?: string}[]} */
const TRACKED = [
  {
    id: 'gemini-2.5-flash',
    shutdown: '2026-10-16',
    replacement: 'the catalog Google Standard tier (gemini-3.5-flash-lite today)',
    note: 'REMOVED from the sendable catalog 2026-09-22; saved choices heal via ai-legacy-models.ts',
  },
  {
    id: 'gemini-2.5-pro',
    shutdown: '2026-10-16',
    replacement: 'the catalog Google Premium tier (gemini-3.1-pro-preview today)',
    note: 'REMOVED from the sendable catalog 2026-09-22; saved choices heal via ai-legacy-models.ts',
  },
  {
    id: 'imagen-4.0-generate-001',
    shutdown: '2026-08-17',
    replacement: 'gemini-3.1-flash-image',
    note: 'MIGRATED 2026-07-20 — callGoogleImage now speaks gemini-3.1-flash-image generateContent. Entry kept as a tripwire: any re-introduced imagen reference reds CI after the shutdown date.',
  },
  {
    id: 'gpt-5',
    shutdown: null,
    replacement: 'the catalog OpenAI Premium tier (gpt-5.6-sol today)',
    note: 'marked deprecated by OpenAI; no longer sent — a saved gpt-5 heals to Premium (2026-09-22)',
  },
  {
    id: 'gpt-image-1',
    shutdown: null,
    replacement: 'gpt-image-2.5-sunburst / gpt-image-2 (ahead of it in the catalog image list)',
    note: 'marked deprecated by OpenAI; still served; last entry of the image fallback list',
  },
];

const SRC_ROOT = path.join(__dirname, '..', 'src');

// Files whose model ids are lookup KEYS that map a retired id forward — never sent (see header).
const FORWARD_MAP_FILES = new Set([path.join('ai', 'ai-legacy-models.ts')]);

function collectSources(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSources(p, out);
    else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !FORWARD_MAP_FILES.has(path.relative(SRC_ROOT, p))
    ) {
      out.push(p);
    }
  }
  return out;
}

function referencedIn(files, id) {
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    let idx = 0;
    while ((idx = text.indexOf(id, idx)) !== -1) {
      // Count only real references: the id inside a quoted string, not a
      // mention inside a comment. Cheap heuristic: quoted immediately
      // around the match.
      const before = text[idx - 1];
      if (before === "'" || before === '"' || before === '`') {
        hits.push(path.relative(process.cwd(), f));
        break;
      }
      idx += id.length;
    }
  }
  return hits;
}

const files = collectSources(SRC_ROOT, []);
const today = new Date();
let failed = false;

for (const m of TRACKED) {
  const hits = referencedIn(files, m.id);
  if (hits.length === 0) continue; // no longer shipped — nothing to police

  if (m.shutdown) {
    const cutoff = new Date(`${m.shutdown}T00:00:00Z`);
    const daysLeft = Math.floor((cutoff - today) / 86400000);
    if (daysLeft < 0) {
      failed = true;
      console.error(
        `::error::AI model "${m.id}" was shut down by its provider on ${m.shutdown} ` +
        `but is still referenced in: ${hits.join(', ')}. Replace with ${m.replacement}.` +
        (m.note ? ` NOTE: ${m.note}` : ''),
      );
    } else if (daysLeft <= WARN_DAYS) {
      console.log(
        `::warning::AI model "${m.id}" shuts down in ${daysLeft} days (${m.shutdown}). ` +
        `Referenced in: ${hits.join(', ')}. Plan the move to ${m.replacement}.` +
        (m.note ? ` NOTE: ${m.note}` : ''),
      );
    } else {
      console.log(`ok: ${m.id} — ${daysLeft} days until provider shutdown (${m.shutdown})`);
    }
  } else {
    console.log(
      `::notice::AI model "${m.id}" is provider-deprecated (no shutdown date yet). ` +
      `Successor: ${m.replacement}.`,
    );
  }
}

if (failed) {
  process.exit(1);
}
console.log('model-retirement gate: no dead models shipped.');
