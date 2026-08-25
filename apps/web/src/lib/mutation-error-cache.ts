import { MutationCache } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BURST_ERROR_MESSAGE,
  ERROR_TOAST_DURATION_MS,
  MUTATION_ERROR_TOAST_ID,
  humanizeMutationError,
  initialBurstState,
  isGlobalErrorSuppressed,
  planErrorToast,
  type BurstState,
} from './mutation-error-toast';

/**
 * Kill silent mutation failure, app-wide (operator-trust wave).
 *
 * Dozens of mutations used to fail with NO operator-visible sign: the
 * optimistic toggle in `use-api.ts` rolled back inside that mutation's own
 * `onError` and the operator was left with a control that just… snapped
 * back. TanStack Query v5 runs this cache-level `onError` IN ADDITION to
 * every per-mutation `onError`, so all those rollbacks keep working exactly
 * as before — the operator just finally SEES what happened.
 *
 * Opt-out: `useMutation({ meta: { suppressGlobalError: true } })` for
 * surfaces that already render an inline error / their own alert, so nothing
 * double-reports.
 *
 * There is at most ONE mutation-error toast on screen at a time — see
 * MUTATION_ERROR_TOAST_ID for why (sonner's programmatic dismiss-by-id does
 * not work in 2.0.8; reusing the id does).
 *
 * Lives in `lib/` rather than inline in providers.tsx so it can be tested
 * against a real QueryClient without mounting the whole provider tree.
 */
export function buildMutationCache(): MutationCache {
  // Burst state belongs to the cache (one per QueryClient) rather than a
  // module global, so it can't leak between tests or React roots.
  let burst: BurstState = initialBurstState;

  return new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (isGlobalErrorSuppressed(mutation.options.meta)) return;

      const planned = planErrorToast(burst, Date.now());
      burst = planned.state;

      // Always the SAME toast id: sonner replaces in place, so an outage
      // that fails eight in-flight mutations leaves ONE toast rather than a
      // wall of them. Once several land inside the burst window, naming the
      // individual failure stops being useful — say what's actually going on.
      toast.error(planned.collapsed ? BURST_ERROR_MESSAGE : humanizeMutationError(error), {
        id: MUTATION_ERROR_TOAST_ID,
        duration: ERROR_TOAST_DURATION_MS,
      });
    },
  });
}
