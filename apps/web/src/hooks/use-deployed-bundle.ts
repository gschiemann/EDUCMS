'use client';

/**
 * use-deployed-bundle — what bundle is this deployment serving right now?
 * (2026-09-21)
 *
 * ── WHY A HOOK, AND WHY NOW ─────────────────────────────────────────────
 * Three dashboard surfaces each carried their own byte-identical copy of
 * this fetch (the Screens page, Fleet Command Center, and the mobile fleet
 * view). That was survivable while the answer was one field. It stopped
 * being survivable the moment the answer became TWO fields that must be read
 * together: a copy that reads only `sha` grades every screen against an
 * identity the player does not reload on, which is exactly the bug this
 * change exists to kill ("App current 5/18" on a healthy fleet — Greg,
 * 2026-09-21: "why does every screen say resync on it"). One definition, so
 * a surface cannot silently keep half of it.
 *
 * ── THE TWO FIELDS ──────────────────────────────────────────────────────
 *   sha       — the git commit. Moves on EVERY commit, including ones that
 *               cannot change a single downloaded byte.
 *   bundleId  — a hash of the client-bundle build inputs
 *               (apps/web/scripts/build-info.cjs). Moves only when what the
 *               browser downloads can actually differ, and is therefore the
 *               identity the player decides to reload on.
 * `deriveBundleSkew` prefers `bundleId` when both sides report one and falls
 * back to `sha` otherwise — see `components/screens/bundleSkew.ts`.
 *
 * ── FAIL CLOSED ─────────────────────────────────────────────────────────
 * Both values stay null until a 2xx parses. A null deployed identity grades
 * every row 'unknown', which renders NOTHING — never a fleet-wide "out of
 * date" accusation off a failed fetch. `bundleId` is independently nullable:
 * a build that never ran the prebuild step reports `sha` only, and the skew
 * comparison falls back to it exactly as it behaved before this hook.
 *
 * ── CADENCE ─────────────────────────────────────────────────────────────
 * ONCE on mount, no interval — deliberately. The app-wide StaleBundleWatcher
 * owns mid-session deploys, and the mobile-performance standard forbids
 * adding pollers to always-mounted dashboard chrome. Do not turn this into a
 * timer.
 */

import { useEffect, useState } from 'react';

export interface DeployedBundle {
  /** Deployed git commit SHA (short form), or null if unknown. */
  sha: string | null;
  /** Deployed client-bundle identity, or null if this build stamped none. */
  bundleId: string | null;
}

const UNKNOWN: DeployedBundle = { sha: null, bundleId: null };

export function useDeployedBundle(): DeployedBundle {
  const [deployed, setDeployed] = useState<DeployedBundle>(UNKNOWN);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/build-info', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        if (cancelled) return;
        // Each field independently: a payload with a sha and no bundleId is
        // the normal shape for a build that skipped the prebuild step, and
        // must still deliver the sha.
        setDeployed({
          sha: typeof j?.sha === 'string' ? j.sha : null,
          bundleId: typeof j?.bundleId === 'string' ? j.bundleId : null,
        });
      } catch {
        /* fail closed — no chip beats a false accusation */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return deployed;
}
