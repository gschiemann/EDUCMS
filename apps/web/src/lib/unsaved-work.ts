/**
 * Unsaved-work registry — one place to ask "would a reload lose something?"
 *
 * A surface that holds edits the server does not have yet registers a check
 * while it is mounted. The same surfaces already guard `beforeunload`; they
 * register here in the same effect, so the browser prompt and this registry
 * can never disagree.
 *
 * Readers: StaleBundleWatcher asks before an automatic reload. A dirty answer,
 * or a check that throws (unknown), means "do not reload".
 *
 *   useEffect(() => {
 *     const off = registerUnsavedWork(() => hasChanges);
 *     return off;
 *   }, [hasChanges]);
 */

type DirtyCheck = () => boolean;

const checks = new Set<{ isDirty: DirtyCheck }>();

/** Register a dirty check; returns the unregister function. */
export function registerUnsavedWork(isDirty: DirtyCheck): () => void {
  // One entry per call, so the same function registered twice unregisters
  // independently.
  const entry = { isDirty };
  checks.add(entry);
  return () => {
    checks.delete(entry);
  };
}

/** True when any registered surface is dirty, or when a check cannot answer. */
export function hasUnsavedWork(): boolean {
  for (const entry of checks) {
    try {
      if (entry.isDirty()) return true;
    } catch {
      return true;
    }
  }
  return false;
}
